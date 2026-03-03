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

import { mkdir, writeFile, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { Page, ScreenRecorder } from "puppeteer-core";
import { ensurePage, DEFAULT_TIMEOUT_MS } from "../browser.js";
import { smartWait } from "../util/wait-strategies.js";
import logger from "../util/logger.js";
import type { FlowDefinition, FlowStep } from "./schema.js";
import { validateSelectorOrRef } from "../util/validate-selector-or-ref.js";
import { clickByBackendNodeId, typeByBackendNodeId, hoverByBackendNodeId } from "../cdp-helpers.js";
import { clearRefs } from "../ref-store.js";

// ── Path confinement ──────────────────────────────────────────────────────

/**
 * Read the allowed flow output directory.
 * Read lazily so env var changes and test overrides take effect.
 * Defaults to /tmp/screen-cap-flows.
 */
function getFlowOutputDir(): string {
  const raw = process.env.FLOW_OUTPUT_DIR ?? "/tmp/screen-cap-flows";
  const resolved = resolve(raw);
  if (resolved === "/") {
    throw new Error("FLOW_OUTPUT_DIR must not resolve to the filesystem root.");
  }
  return resolved;
}

function isWithinDir(resolvedPath: string, allowedDir: string): boolean {
  return resolvedPath.startsWith(allowedDir + "/") || resolvedPath === allowedDir;
}

async function confinePathToFlowDir(
  filePath: string,
): Promise<{ resolvedPath: string } | { error: string }> {
  const flowDir = getFlowOutputDir();
  const resolvedPath = resolve(filePath);

  if (!isWithinDir(resolvedPath, flowDir)) {
    return { error: `Path must be within ${flowDir}` };
  }

  await mkdir(dirname(resolvedPath), { recursive: true });

  const realDir = await realpath(dirname(resolvedPath));
  const realFlowDir = await realpath(flowDir);
  if (!isWithinDir(realDir, realFlowDir)) {
    return { error: `Path must be within ${flowDir} (symlink detected)` };
  }

  return { resolvedPath: resolve(realDir, basename(resolvedPath)) };
}

// ── URL validation ────────────────────────────────────────────────────────

function validateNavigationUrl(url: string): { href: string } | { error: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { error: `Invalid URL "${url}"` };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { error: `Only http: and https: URLs are allowed, got "${parsed.protocol}"` };
  }
  return { href: parsed.href };
}

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

    // Create output directory within confined flow output dir
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeName = flow.name.replace(/[^a-zA-Z0-9_-]/g, "_");
    const flowDir = getFlowOutputDir();
    const rawOutputDir = join(flowDir, `${safeName}-${timestamp}`);
    const dirResult = await confinePathToFlowDir(join(rawOutputDir, "placeholder"));
    if ("error" in dirResult) {
      throw new Error(dirResult.error);
    }
    const outputDir = dirname(dirResult.resolvedPath);
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
        await this.executeStep(page, step, outputDir, i);
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
        result.error = err instanceof Error ? err.message : String(err);
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

  private async executeStep(page: Page, step: FlowStep, outputDir: string, stepIndex: number): Promise<void> {
    switch (step.action) {
      case "navigate": {
        const urlResult = validateNavigationUrl(step.url);
        if ("error" in urlResult) {
          throw new Error(urlResult.error);
        }
        await page.goto(urlResult.href, {
          waitUntil: step.waitUntil ?? "load",
          timeout: DEFAULT_TIMEOUT_MS,
        });
        clearRefs();
        break;
      }

      case "click": {
        const resolved = validateSelectorOrRef(step.selector, step.ref);
        if ("error" in resolved) throw new Error(resolved.error);
        if (resolved.type === "ref") {
          await clickByBackendNodeId(resolved.backendNodeId);
        } else {
          await page.waitForSelector(resolved.value, { visible: true });
          await page.click(resolved.value);
        }
        break;
      }

      case "type": {
        const resolved = validateSelectorOrRef(step.selector, step.ref);
        if ("error" in resolved) throw new Error(resolved.error);
        if (resolved.type === "ref") {
          await typeByBackendNodeId(resolved.backendNodeId, step.text, step.clear);
        } else {
          if (step.clear) {
            await page.click(resolved.value, { clickCount: 3 });
          } else {
            await page.click(resolved.value);
          }
          await page.type(resolved.value, step.text);
        }
        break;
      }

      case "hover": {
        const resolved = validateSelectorOrRef(step.selector, step.ref);
        if ("error" in resolved) throw new Error(resolved.error);
        if (resolved.type === "ref") {
          await hoverByBackendNodeId(resolved.backendNodeId);
        } else {
          await page.waitForSelector(resolved.value, { visible: true });
          await page.hover(resolved.value);
        }
        break;
      }

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
        const rawLabel = step.label ?? `step-${stepIndex}-screenshot`;
        const label = rawLabel.replace(/[^a-zA-Z0-9_-]/g, "_");
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
        const rawLabel = step.label ?? `step-${stepIndex}-a11y`;
        const label = rawLabel.replace(/[^a-zA-Z0-9_-]/g, "_");
        const a11yPath = join(outputDir, `${label}.json`);
        const snapshot = await page.accessibility.snapshot({
          interestingOnly: step.interestingOnly ?? true,
        });
        await writeFile(a11yPath, JSON.stringify(snapshot, null, 2));
        break;
      }

      case "evaluate":
        if (process.env.ALLOW_EVALUATE !== "true") {
          throw new Error("evaluate is disabled. Set ALLOW_EVALUATE=true to enable arbitrary JS execution.");
        }
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
        await page.waitForSelector(step.selector, { visible: true, timeout });
        break;

      case "network_idle":
        await page.waitForNetworkIdle({ timeout });
        break;

      case "smart":
        await smartWait(page, timeout);
        break;

      case "delay":
        await new Promise((resolve) => setTimeout(resolve, step.delay));
        break;

      case "function":
        if (process.env.ALLOW_EVALUATE !== "true") {
          throw new Error("wait/function is disabled. Set ALLOW_EVALUATE=true to enable arbitrary JS execution.");
        }
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
