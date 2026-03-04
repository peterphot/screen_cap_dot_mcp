/**
 * FlowValidator — Dry-run validation of flow definitions.
 *
 * Given a validated FlowDefinition, the validator checks whether all
 * selector/ref/match targets resolve to existing elements WITHOUT executing
 * any actions. Returns a structured report per step.
 *
 * Step classification:
 * - Selector steps (click, type, hover with `selector`; wait/selector):
 *   Validated via page.waitForSelector with configurable timeout.
 * - Ref steps (click, type, hover with `ref`):
 *   Validated via resolveRef returning a valid backendNodeId.
 * - Match steps (click, type, hover with `match`):
 *   Validated via resolveMatch from a11y-matcher.
 * - Non-targetable steps (navigate, scroll, sleep, screenshot, evaluate,
 *   a11y_snapshot, click_at, hover_at, wait/smart, wait/network_idle,
 *   wait/delay, wait/function):
 *   Marked as "skip" (no validation needed).
 */

import { ensurePage } from "../browser.js";
import { resolveRef } from "../ref-store.js";
import { resolveMatch } from "../util/a11y-matcher.js";
import type { A11ySnapshotNode } from "../util/a11y-formatter.js";
import type { FlowDefinition, FlowStep } from "./schema.js";
import logger from "../util/logger.js";

// ── Types ────────────────────────────────────────────────────────────────

export interface ValidationStepResult {
  index: number;
  action: string;
  label?: string;
  status: "ok" | "missing" | "skip";
  detail?: string;
}

export interface ValidationReport {
  valid: boolean;
  steps: ValidationStepResult[];
}

export interface ValidateOptions {
  /** Timeout in ms for each selector check. Default: 5000. */
  timeout?: number;
}

// ── FlowValidator ────────────────────────────────────────────────────────

export class FlowValidator {
  /**
   * Validate a flow definition without executing any actions.
   *
   * @param flow - Validated flow definition
   * @param options - Optional configuration (timeout)
   * @returns Structured validation report
   */
  async validate(
    flow: FlowDefinition,
    options?: ValidateOptions,
  ): Promise<ValidationReport> {
    const timeout = options?.timeout ?? 5000;
    const page = await ensurePage();
    const stepResults: ValidationStepResult[] = [];

    // Cache a single a11y snapshot if any match steps exist
    const hasMatchSteps = flow.steps.some(
      (s) => (s.action === "click" || s.action === "type" || s.action === "hover") && "match" in s,
    );
    let cachedSnapshot: A11ySnapshotNode | undefined;
    if (hasMatchSteps) {
      const raw = await page.accessibility.snapshot({ interestingOnly: false });
      if (raw) {
        cachedSnapshot = raw as A11ySnapshotNode;
      }
    }

    for (let i = 0; i < flow.steps.length; i++) {
      const step = flow.steps[i];
      const result = await this.validateStep(page, step, i, timeout, cachedSnapshot);
      stepResults.push(result);
    }

    const valid = stepResults.every((s) => s.status !== "missing");

    const counts = stepResults.reduce(
      (acc, s) => { acc[s.status]++; return acc; },
      { ok: 0, missing: 0, skip: 0 },
    );

    logger.info(
      `Flow "${flow.name}" validation: ${valid ? "PASS" : "FAIL"} ` +
        `(${counts.ok} ok, ${counts.missing} missing, ${counts.skip} skip)`,
    );

    return { valid, steps: stepResults };
  }

  // ── Step validation ─────────────────────────────────────────────────

  private async validateStep(
    page: { waitForSelector: (selector: string, opts: { timeout: number }) => Promise<unknown> },
    step: FlowStep,
    index: number,
    timeout: number,
    cachedSnapshot?: A11ySnapshotNode,
  ): Promise<ValidationStepResult> {
    const base: Pick<ValidationStepResult, "index" | "action" | "label"> = {
      index,
      action: step.action,
      label: step.label,
    };

    // Check if this is a targetable step (click, type, hover with selector/ref/match)
    if (this.isTargetableStep(step)) {
      return this.validateTargetableStep(page, step, base, timeout, cachedSnapshot);
    }

    // Check if this is a wait/selector step
    if (step.action === "wait" && "strategy" in step && step.strategy === "selector") {
      return this.validateSelectorTarget(page, step.selector, base, timeout);
    }

    // Everything else is skip
    return { ...base, status: "skip" };
  }

  private isTargetableStep(
    step: FlowStep,
  ): step is Extract<FlowStep, { action: "click" | "type" | "hover" }> {
    return (
      (step.action === "click" || step.action === "type" || step.action === "hover") &&
      ("selector" in step || "ref" in step || "match" in step)
    );
  }

  private async validateTargetableStep(
    page: { waitForSelector: (selector: string, opts: { timeout: number }) => Promise<unknown> },
    step: FlowStep,
    base: Pick<ValidationStepResult, "index" | "action" | "label">,
    timeout: number,
    cachedSnapshot?: A11ySnapshotNode,
  ): Promise<ValidationStepResult> {
    // Match-based
    if ("match" in step && step.match) {
      return this.validateMatchTarget(step.match, base, cachedSnapshot);
    }

    // Ref-based
    if ("ref" in step && step.ref) {
      return this.validateRefTarget(step.ref, base);
    }

    // Selector-based
    if ("selector" in step && step.selector) {
      return this.validateSelectorTarget(page, step.selector, base, timeout);
    }

    // Should not reach here with validated schema, but just in case
    return { ...base, status: "skip" };
  }

  private async validateSelectorTarget(
    page: { waitForSelector: (selector: string, opts: { timeout: number }) => Promise<unknown> },
    selector: string,
    base: Pick<ValidationStepResult, "index" | "action" | "label">,
    timeout: number,
  ): Promise<ValidationStepResult> {
    try {
      await page.waitForSelector(selector, { timeout });
      return { ...base, status: "ok" };
    } catch (err) {
      return {
        ...base,
        status: "missing",
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private validateRefTarget(
    ref: string,
    base: Pick<ValidationStepResult, "index" | "action" | "label">,
  ): ValidationStepResult {
    const backendNodeId = resolveRef(ref);
    if (backendNodeId !== undefined) {
      return { ...base, status: "ok" };
    }
    return {
      ...base,
      status: "missing",
      detail: `Stale or invalid ref: ${ref}`,
    };
  }

  private async validateMatchTarget(
    match: { role?: string; name?: string; index?: number },
    base: Pick<ValidationStepResult, "index" | "action" | "label">,
    cachedSnapshot?: A11ySnapshotNode,
  ): Promise<ValidationStepResult> {
    try {
      await resolveMatch(match, cachedSnapshot ? { snapshot: cachedSnapshot } : undefined);
      return { ...base, status: "ok" };
    } catch (err) {
      return {
        ...base,
        status: "missing",
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
