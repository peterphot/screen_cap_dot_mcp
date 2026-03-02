/**
 * FlowRunner — Executes flow definitions step-by-step.
 *
 * Given a validated FlowDefinition, the runner:
 * 1. Creates a timestamped output directory for the run
 * 2. Optionally starts video recording (based on flow config)
 * 3. Executes each step sequentially, calling into BrowserManager
 * 4. Captures screenshots and a11y snapshots at labeled steps
 * 5. Continues on step failure (capture error screenshot, log, keep going)
 * 6. Writes a manifest.json summarizing the run
 * 7. Stops recording at end
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page, ScreenRecorder } from "puppeteer-core";
import { ensurePage } from "../browser.js";
import { smartWait } from "../util/wait-strategies.js";
import logger from "../util/logger.js";
import type { FlowDefinition, FlowStep } from "./schema.js";

// ── Types ────────────────────────────────────────────────────────────────

export interface StepResult {
  stepIndex: number;
  action: string;
  label?: string;
  success: boolean;
  error?: string;
  screenshotPath?: string;
  a11yPath?: string;
  durationMs: number;
}

export interface FlowRunResult {
  flowName: string;
  outputDir: string;
  steps: StepResult[];
  recordingPath?: string;
  totalDurationMs: number;
  manifestPath: string;
}

// ── FlowRunner ───────────────────────────────────────────────────────────

export class FlowRunner {
  /**
   * Execute a flow definition.
   *
   * @param flow - Validated flow definition
   * @param recordOverride - Override the flow's recording config (true/false)
   * @returns Results with step outcomes and artifact paths
   */
  async run(flow: FlowDefinition, recordOverride?: boolean): Promise<FlowRunResult> {
    const runStart = Date.now();
    const page = await ensurePage();

    // Create output directory
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeName = flow.name.replace(/[^a-zA-Z0-9_-]/g, "_");
    const outputDir = join("output", `${safeName}-${timestamp}`);
    await mkdir(outputDir, { recursive: true });

    logger.info(`Flow "${flow.name}" started — output: ${outputDir}`);

    // Determine if we should record
    const shouldRecord = recordOverride ?? flow.recording?.enabled ?? false;
    let recorder: ScreenRecorder | null = null;
    let recordingPath: string | undefined;

    if (shouldRecord) {
      const format = flow.recording?.format ?? "mp4";
      recordingPath = join(outputDir, `recording.${format}`);
      recorder = await page.screencast({
        path: recordingPath as `${string}.${typeof format}`,
        format,
      });
      logger.info(`Recording started: ${recordingPath}`);
    }

    // Execute steps
    const stepResults: StepResult[] = [];

    for (let i = 0; i < flow.steps.length; i++) {
      const step = flow.steps[i];
      const stepStart = Date.now();
      const result: StepResult = {
        stepIndex: i,
        action: step.action,
        label: step.label,
        success: false,
        durationMs: 0,
      };

      try {
        await this.executeStep(page, step, outputDir);
        result.success = true;

        // Capture labeled screenshot/a11y if this step has a label
        if (step.label && step.action !== "screenshot" && step.action !== "a11y_snapshot") {
          const { screenshotPath, a11yPath } = await this.captureArtifacts(
            page, outputDir, i, step.label,
          );
          result.screenshotPath = screenshotPath;
          result.a11yPath = a11yPath;
        }
      } catch (err) {
        result.error = (err as Error).message;
        logger.warn(`Step ${i} (${step.action}) failed: ${result.error}`);

        // Capture error screenshot
        try {
          const errScreenshot = join(outputDir, `error-step-${i}.png`);
          const buffer = (await page.screenshot()) as Buffer;
          await writeFile(errScreenshot, buffer);
          result.screenshotPath = errScreenshot;
        } catch {
          // Ignore screenshot failure during error handling
        }
      }

      result.durationMs = Date.now() - stepStart;
      stepResults.push(result);
    }

    // Stop recording
    if (recorder) {
      await recorder.stop();
      logger.info(`Recording stopped: ${recordingPath}`);
    }

    const totalDurationMs = Date.now() - runStart;

    // Write manifest
    const manifestPath = join(outputDir, "manifest.json");
    const manifest = {
      flowName: flow.name,
      description: flow.description,
      outputDir,
      recordingPath,
      totalDurationMs,
      steps: stepResults,
    };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    logger.info(`Flow "${flow.name}" completed in ${totalDurationMs}ms`);

    return {
      flowName: flow.name,
      outputDir,
      steps: stepResults,
      recordingPath,
      totalDurationMs,
      manifestPath,
    };
  }

  // ── Step execution ───────────────────────────────────────────────────

  private async executeStep(page: Page, step: FlowStep, outputDir: string): Promise<void> {
    switch (step.action) {
      case "navigate":
        await page.goto(step.url, {
          waitUntil: step.waitUntil ?? "load",
          timeout: 60000,
        });
        break;

      case "click":
        await page.waitForSelector(step.selector, { visible: true });
        await page.click(step.selector);
        break;

      case "type":
        if (step.clear) {
          await page.click(step.selector, { clickCount: 3 });
        } else {
          await page.click(step.selector);
        }
        await page.type(step.selector, step.text);
        break;

      case "wait":
        await this.executeWait(page, step);
        break;

      case "scroll":
        await page.evaluate(
          (dir: string, amt: number, sel?: string) => {
            const target = sel ? document.querySelector(sel) : window;
            if (sel && !target) throw new Error(`Element not found: ${sel}`);
            const deltaX = dir === "right" ? amt : dir === "left" ? -amt : 0;
            const deltaY = dir === "down" ? amt : dir === "up" ? -amt : 0;
            (target as Element | Window).scrollBy(deltaX, deltaY);
          },
          step.direction ?? "down",
          step.amount ?? 500,
          step.selector,
        );
        break;

      case "screenshot": {
        const label = step.label ?? `step-screenshot`;
        const screenshotPath = join(outputDir, `${label}.png`);
        if (step.selector) {
          const el = await page.$(step.selector);
          if (!el) throw new Error(`Element not found: ${step.selector}`);
          const buffer = (await el.screenshot()) as Buffer;
          await writeFile(screenshotPath, buffer);
        } else {
          const buffer = (await page.screenshot({ fullPage: step.fullPage ?? false })) as Buffer;
          await writeFile(screenshotPath, buffer);
        }
        break;
      }

      case "a11y_snapshot": {
        const label = step.label ?? `step-a11y`;
        const a11yPath = join(outputDir, `${label}.json`);
        const snapshot = await page.accessibility.snapshot({
          interestingOnly: step.interestingOnly ?? true,
        });
        await writeFile(a11yPath, JSON.stringify(snapshot, null, 2));
        break;
      }

      case "evaluate":
        await page.evaluate(step.script);
        break;

      case "sleep":
        await new Promise((resolve) => setTimeout(resolve, step.duration));
        break;
    }
  }

  private async executeWait(
    page: Page,
    step: Extract<FlowStep, { action: "wait" }>,
  ): Promise<void> {
    const timeout = step.timeout ?? 30000;

    switch (step.strategy) {
      case "selector":
        if (!step.selector) throw new Error("wait/selector requires a selector field");
        await page.waitForSelector(step.selector, { visible: true, timeout });
        break;

      case "network_idle":
        await page.waitForNetworkIdle({ timeout });
        break;

      case "smart":
        await smartWait(page, timeout);
        break;

      case "delay":
        await new Promise((resolve) => setTimeout(resolve, step.delay ?? 1000));
        break;

      case "function":
        if (!step.function) throw new Error("wait/function requires a function field");
        await page.waitForFunction(step.function, { timeout });
        break;
    }
  }

  // ── Artifact capture ─────────────────────────────────────────────────

  private async captureArtifacts(
    page: Page,
    outputDir: string,
    stepIndex: number,
    label: string,
  ): Promise<{ screenshotPath?: string; a11yPath?: string }> {
    const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, "_");
    const result: { screenshotPath?: string; a11yPath?: string } = {};

    try {
      const screenshotPath = join(outputDir, `${stepIndex}-${safeLabel}.png`);
      const buffer = (await page.screenshot()) as Buffer;
      await writeFile(screenshotPath, buffer);
      result.screenshotPath = screenshotPath;
    } catch {
      logger.warn(`Failed to capture screenshot for step ${stepIndex} ("${label}")`);
    }

    try {
      const a11yPath = join(outputDir, `${stepIndex}-${safeLabel}-a11y.json`);
      const snapshot = await page.accessibility.snapshot({ interestingOnly: true });
      await writeFile(a11yPath, JSON.stringify(snapshot, null, 2));
      result.a11yPath = a11yPath;
    } catch {
      logger.warn(`Failed to capture a11y for step ${stepIndex} ("${label}")`);
    }

    return result;
  }
}
