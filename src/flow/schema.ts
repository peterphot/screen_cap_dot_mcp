/**
 * Flow DSL schema — Zod validation for JSON flow definitions.
 *
 * A flow is a sequence of steps that automate browser interactions.
 * Each step has an `action` field (discriminated union) and action-specific params.
 * Steps can have optional `label` for naming screenshots/moments.
 *
 * Supported actions: navigate, click, click_at, type, hover, hover_at, press_key,
 * wait, scroll, screenshot, a11y_snapshot, evaluate, sleep.
 *
 * Element targeting: click, type, and hover steps accept exactly one of:
 * - `selector` (CSS selector)
 * - `ref` (ref ID from a11y snapshot, e.g. "e3")
 * - `match` (semantic a11y match: { role?, name?, index? })
 */

import { z } from "zod";

// ── Shared key format constants ─────────────────────────────────────────

/** Regex for validating keyboard key strings (e.g. "Enter", "Control+a"). */
export const KEY_FORMAT_PATTERN = /^[A-Za-z0-9]+(\+[A-Za-z0-9]+)*$/;
export const KEY_FORMAT_MESSAGE = "Invalid key format. Use key names like 'Enter', 'Tab', or modifier combos like 'Control+a'.";

// ── Match selector schema ───────────────────────────────────────────────

/**
 * Semantic accessibility-based element selector.
 * At least one of `role` or `name` must be provided.
 */
export const MatchSelectorSchema = z.object({
  role: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  index: z.number().int().nonnegative().optional(),
}).refine(
  (d) => Boolean(d.role) || Boolean(d.name),
  { message: "match requires at least one of role or name." },
);

export type MatchSelector = z.infer<typeof MatchSelectorSchema>;

// ── Shared refinements ───────────────────────────────────────────────────

/**
 * XOR refinement: exactly one of selector, ref, or match must be provided.
 * This ensures steps use exactly one targeting mechanism.
 */
const requireExactlyOneTarget = (d: { selector?: string; ref?: string; match?: MatchSelector }) => {
  const count = [Boolean(d.selector), Boolean(d.ref), Boolean(d.match)].filter(Boolean).length;
  return count === 1;
};
const TARGET_XOR_MESSAGE = "Provide exactly one of selector, ref, or match.";

// ── Step schemas ─────────────────────────────────────────────────────────

const NavigateStep = z.object({
  action: z.literal("navigate"),
  url: z.string(),
  waitUntil: z.enum(["load", "domcontentloaded", "networkidle0", "networkidle2"]).optional(),
  label: z.string().optional(),
});

const ClickStep = z.object({
  action: z.literal("click"),
  selector: z.string().min(1).optional(),
  ref: z.string().min(1).optional(),
  match: MatchSelectorSchema.optional(),
  label: z.string().optional(),
}).refine(requireExactlyOneTarget, { message: TARGET_XOR_MESSAGE });

const TypeStep = z.object({
  action: z.literal("type"),
  selector: z.string().min(1).optional(),
  ref: z.string().min(1).optional(),
  match: MatchSelectorSchema.optional(),
  text: z.string(),
  clear: z.boolean().optional(),
  label: z.string().optional(),
}).refine(requireExactlyOneTarget, { message: TARGET_XOR_MESSAGE });

const HoverStep = z.object({
  action: z.literal("hover"),
  selector: z.string().min(1).optional(),
  ref: z.string().min(1).optional(),
  match: MatchSelectorSchema.optional(),
  label: z.string().optional(),
}).refine(requireExactlyOneTarget, { message: TARGET_XOR_MESSAGE });

const ClickAtStep = z.object({
  action: z.literal("click_at"),
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  label: z.string().optional(),
});

const HoverAtStep = z.object({
  action: z.literal("hover_at"),
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  label: z.string().optional(),
});

const PressKeyStep = z.object({
  action: z.literal("press_key"),
  key: z.string().min(1).max(100).regex(KEY_FORMAT_PATTERN, KEY_FORMAT_MESSAGE),
  label: z.string().optional(),
});

const WaitSelectorStep = z.object({
  action: z.literal("wait"),
  strategy: z.literal("selector"),
  selector: z.string(),
  timeout: z.number().nonnegative().finite().max(300_000).optional(),
  label: z.string().optional(),
});

const WaitNetworkIdleStep = z.object({
  action: z.literal("wait"),
  strategy: z.literal("network_idle"),
  timeout: z.number().nonnegative().finite().max(300_000).optional(),
  label: z.string().optional(),
});

const WaitSmartStep = z.object({
  action: z.literal("wait"),
  strategy: z.literal("smart"),
  timeout: z.number().nonnegative().finite().max(300_000).optional(),
  label: z.string().optional(),
});

const WaitDelayStep = z.object({
  action: z.literal("wait"),
  strategy: z.literal("delay"),
  delay: z.number().nonnegative().finite().max(300_000),
  timeout: z.number().nonnegative().finite().max(300_000).optional(),
  label: z.string().optional(),
});

const WaitFunctionStep = z.object({
  action: z.literal("wait"),
  strategy: z.literal("function"),
  function: z.string().min(1).max(10_000),
  timeout: z.number().nonnegative().finite().max(300_000).optional(),
  label: z.string().optional(),
});

const WaitStep = z.union([
  WaitSelectorStep,
  WaitNetworkIdleStep,
  WaitSmartStep,
  WaitDelayStep,
  WaitFunctionStep,
]);

const ScrollStep = z.object({
  action: z.literal("scroll"),
  direction: z.enum(["up", "down", "left", "right"]).optional(),
  amount: z.number().nonnegative().finite().max(100_000).optional(),
  selector: z.string().optional(),
  label: z.string().optional(),
});

const ScreenshotStep = z.object({
  action: z.literal("screenshot"),
  selector: z.string().optional(),
  fullPage: z.boolean().optional(),
  label: z.string().optional(),
});

const A11ySnapshotStep = z.object({
  action: z.literal("a11y_snapshot"),
  interestingOnly: z.boolean().optional(),
  label: z.string().optional(),
});

const EvaluateStep = z.object({
  action: z.literal("evaluate"),
  script: z.string().min(1).max(10_000),
  label: z.string().optional(),
});

const SleepStep = z.object({
  action: z.literal("sleep"),
  duration: z.number().nonnegative().finite().max(300_000),
  label: z.string().optional(),
});

// ── Discriminated union of all steps ─────────────────────────────────────

export const FlowStepSchema = z.union([
  NavigateStep,
  ClickStep,
  ClickAtStep,
  TypeStep,
  HoverStep,
  HoverAtStep,
  PressKeyStep,
  WaitStep,
  ScrollStep,
  ScreenshotStep,
  A11ySnapshotStep,
  EvaluateStep,
  SleepStep,
]);

export type FlowStep = z.infer<typeof FlowStepSchema>;

// ── Recording config ─────────────────────────────────────────────────────

export const RecordingConfigSchema = z.object({
  enabled: z.boolean(),
  format: z.enum(["mp4", "webm"]).optional(),
});

export type RecordingConfig = z.infer<typeof RecordingConfigSchema>;

// ── Flow definition ──────────────────────────────────────────────────────

export const FlowDefinitionSchema = z.object({
  name: z.string().max(200),
  description: z.string().max(2000).optional(),
  recording: RecordingConfigSchema.optional(),
  steps: z.array(FlowStepSchema).min(1).max(500),
});

export type FlowDefinition = z.infer<typeof FlowDefinitionSchema>;
