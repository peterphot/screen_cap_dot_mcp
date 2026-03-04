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
 *
 * Element targeting: click, type, and hover steps can use:
 * - `selector` (CSS) or `ref` (a11y snapshot ref ID) — handled by performClick/Type/Hover
 * - `match` (semantic a11y match) — resolved at runtime via resolveMatch from a11y-matcher
 */

import { join } from "node:path";
import { resolveConfigDir, confineDir, safeWriteFile } from "../util/path-confinement.js";
import type { Page, ScreenRecorder } from "puppeteer-core";
import { ensurePage, DEFAULT_TIMEOUT_MS } from "../browser.js";
import { smartWait } from "../util/wait-strategies.js";
import logger from "../util/logger.js";
import type { FlowDefinition, FlowStep } from "./schema.js";
import { DEFAULT_VISIBILITY_TIMEOUT_MS } from "./schema.js";
import { performClick, performType, performHover } from "../util/actions.js";
import { clickAtCoordinates, hoverAtCoordinates } from "../cdp-helpers.js";
import { clickByBackendNodeId, typeByBackendNodeId, hoverByBackendNodeId } from "../cdp-helpers.js";
import { validateNavigationUrl } from "../util/url-validation.js";
import { clearRefs, resolveRef } from "../ref-store.js";
import { resolveMatch } from "../util/a11y-matcher.js";
import type { A11ySnapshotNode } from "../util/a11y-formatter.js";

// ── Path confinement ──────────────────────────────────────────────────────

/**
 * Read the allowed flow output directory.
 * Read lazily so env var changes and test overrides take effect.
 */
function getFlowOutputDir(): string {
  return resolveConfigDir("FLOW_OUTPUT_DIR", "/tmp/screen-cap-flows");
}

async function confineDirToFlowOutputDir(
  dirPath: string,
): Promise<{ resolvedDir: string } | { error: string }> {
  return confineDir(dirPath, getFlowOutputDir());
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
    const dirResult = await confineDirToFlowOutputDir(rawOutputDir);
    if ("error" in dirResult) {
      throw new Error(dirResult.error);
    }
    const outputDir = dirResult.resolvedDir;

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
        // When a match step is labeled, take the a11y snapshot once and reuse
        // it for both match resolution and artifact capture.
        let cachedSnapshot: A11ySnapshotNode | undefined;
        const hasMatch = "match" in step && step.match;
        const needsArtifacts = step.label && step.action !== "screenshot" && step.action !== "a11y_snapshot";

        if (hasMatch && needsArtifacts) {
          const snap = await page.accessibility.snapshot({ interestingOnly: false });
          if (snap) cachedSnapshot = snap as A11ySnapshotNode;
        }

        await this.executeStep(page, step, outputDir, i, cachedSnapshot);
        result.success = true;

        // Capture labeled screenshot/a11y if this step has a label
        if (needsArtifacts) {
          const { screenshotPath, a11yPath } = await this.captureArtifacts(
            page, outputDir, i, step.label!, cachedSnapshot,
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
          await safeWriteFile(errScreenshot, buffer);
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
    await safeWriteFile(manifestPath, JSON.stringify(manifest, null, 2));

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

  private async executeStep(
    page: Page, step: FlowStep, outputDir: string, stepIndex: number,
    cachedSnapshot?: A11ySnapshotNode,
  ): Promise<void> {
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

      case "click":
        if (step.match) {
          const opts = cachedSnapshot ? { snapshot: cachedSnapshot } : undefined;
          const resolved = await resolveMatch(step.match, opts);
          await clickByBackendNodeId(resolved.backendNodeId);
        } else {
          await performClick(step.selector, step.ref, page);
        }
        break;

      case "click_at":
        await clickAtCoordinates(step.x, step.y);
        break;

      case "type":
        if (step.match) {
          const opts = cachedSnapshot ? { snapshot: cachedSnapshot } : undefined;
          const resolved = await resolveMatch(step.match, opts);
          await typeByBackendNodeId(resolved.backendNodeId, step.text, step.clear);
        } else {
          await performType(step.text, step.selector, step.ref, step.clear, page);
        }
        break;

      case "hover":
        if (step.match) {
          const opts = cachedSnapshot ? { snapshot: cachedSnapshot } : undefined;
          const resolved = await resolveMatch(step.match, opts);
          await hoverByBackendNodeId(resolved.backendNodeId);
        } else {
          await performHover(step.selector, step.ref, page);
        }
        break;

      case "hover_at":
        await hoverAtCoordinates(step.x, step.y);
        break;

      case "press_key":
        await page.keyboard.press(step.key);
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
        const rawLabel = step.label ?? `step-${stepIndex}-screenshot`;
        const label = rawLabel.replace(/[^a-zA-Z0-9_-]/g, "_");
        const screenshotPath = join(outputDir, `${label}.png`);
        if (step.selector) {
          const el = await page.$(step.selector);
          if (!el) throw new Error(`Element not found: ${step.selector}`);
          const buffer = (await el.screenshot()) as Buffer;
          await safeWriteFile(screenshotPath, buffer);
        } else {
          const buffer = (await page.screenshot({ fullPage: step.fullPage ?? false })) as Buffer;
          await safeWriteFile(screenshotPath, buffer);
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
        await safeWriteFile(a11yPath, JSON.stringify(snapshot, null, 2));
        break;
      }

      case "evaluate":
        if (process.env.ALLOW_EVALUATE !== "true") {
          throw new Error("evaluate is disabled. Set ALLOW_EVALUATE=true to enable arbitrary JS execution.");
        }
        logger.warn(`[AUDIT] Flow evaluate step. Script length: ${step.script.length} chars`);
        await page.evaluate(step.script);
        break;

      case "sleep":
        await new Promise((resolve) => setTimeout(resolve, step.duration));
        break;

      case "if_visible":
      case "if_not_visible": {
        const isVisible = await this.checkVisibility(page, step, cachedSnapshot);
        const conditionMet = step.action === "if_visible" ? isVisible : !isVisible;
        const branch = conditionMet ? step.then : step.else;

        // Cache a single snapshot for the branch if any nested steps use match
        // SAFETY: Zod schema validates then/else as arrays of valid FlowStep objects
        const branchSteps = branch as FlowStep[];
        let branchSnapshot = cachedSnapshot;
        if (!branchSnapshot) {
          const hasMatch = branchSteps.some((s) => "match" in s && (s as Record<string, unknown>).match);
          if (hasMatch) {
            const snap = await page.accessibility.snapshot({ interestingOnly: false });
            if (snap) branchSnapshot = snap as A11ySnapshotNode;
          }
        }

        // Nested steps use fail-fast semantics: an error in a nested step
        // propagates up and fails the entire conditional step.
        for (const nestedStep of branchSteps) {
          await this.executeStep(page, nestedStep, outputDir, stepIndex, branchSnapshot);
        }
        break;
      }
    }
  }

  // ── Conditional visibility check ────────────────────────────────────

  /**
   * Check whether the condition target is "visible":
   * - selector: uses waitForSelector with short timeout (actual DOM visibility check)
   * - ref: checks if the ref is registered (does NOT verify current DOM visibility)
   * - match: uses resolveMatch against a11y tree (actual a11y tree check)
   */
  private async checkVisibility(
    page: Page,
    step: { selector?: string; ref?: string; match?: { role?: string; name?: string; index?: number }; timeout?: number },
    cachedSnapshot?: A11ySnapshotNode,
  ): Promise<boolean> {
    const timeout = step.timeout ?? DEFAULT_VISIBILITY_TIMEOUT_MS;

    if (step.selector) {
      try {
        await page.waitForSelector(step.selector, { visible: true, timeout });
        return true;
      } catch {
        return false;
      }
    }

    if (step.ref) {
      const backendNodeId = resolveRef(step.ref);
      return backendNodeId !== undefined;
    }

    if (step.match) {
      try {
        const opts = cachedSnapshot ? { snapshot: cachedSnapshot } : undefined;
        await resolveMatch(step.match, opts);
        return true;
      } catch {
        return false;
      }
    }

    // Should not happen with validated schema
    return false;
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
        logger.warn(`[AUDIT] Flow waitForFunction step. Function length: ${step.function.length} chars`);
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
    cachedSnapshot?: A11ySnapshotNode,
  ): Promise<{ screenshotPath?: string; a11yPath?: string }> {
    const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, "_");

    const [screenshotResult, a11yResult] = await Promise.allSettled([
      (async () => {
        const screenshotPath = join(outputDir, `${stepIndex}-${safeLabel}.png`);
        const buffer = (await page.screenshot()) as Buffer;
        await safeWriteFile(screenshotPath, buffer);
        return screenshotPath;
      })(),
      (async () => {
        const a11yPath = join(outputDir, `${stepIndex}-${safeLabel}-a11y.json`);
        const snapshot = cachedSnapshot ?? await page.accessibility.snapshot({ interestingOnly: true });
        await safeWriteFile(a11yPath, JSON.stringify(snapshot, null, 2));
        return a11yPath;
      })(),
    ]);

    if (screenshotResult.status === "rejected") {
      logger.warn(`Failed to capture screenshot for step ${stepIndex} ("${label}")`);
    }
    if (a11yResult.status === "rejected") {
      logger.warn(`Failed to capture a11y for step ${stepIndex} ("${label}")`);
    }

    return {
      screenshotPath: screenshotResult.status === "fulfilled" ? screenshotResult.value : undefined,
      a11yPath: a11yResult.status === "fulfilled" ? a11yResult.value : undefined,
    };
  }
}
