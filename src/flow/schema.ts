/**
 * Flow DSL schema — Zod validation for JSON flow definitions.
 *
 * A flow is a sequence of steps that automate browser interactions.
 * Each step has an `action` field (discriminated union) and action-specific params.
 * Steps can have optional `label` for naming screenshots/moments.
 *
 * Supported actions: navigate, click, type, wait, scroll, screenshot,
 * a11y_snapshot, evaluate, sleep.
 */

import { z } from "zod";

// ── Step schemas ─────────────────────────────────────────────────────────

const NavigateStep = z.object({
  action: z.literal("navigate"),
  url: z.string(),
  waitUntil: z.enum(["load", "domcontentloaded", "networkidle0", "networkidle2"]).optional(),
  label: z.string().optional(),
});

const ClickStep = z.object({
  action: z.literal("click"),
  selector: z.string(),
  label: z.string().optional(),
});

const TypeStep = z.object({
  action: z.literal("type"),
  selector: z.string(),
  text: z.string(),
  clear: z.boolean().optional(),
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
  function: z.string().min(1),
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
  script: z.string().min(1),
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
  TypeStep,
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
  name: z.string(),
  description: z.string().optional(),
  recording: RecordingConfigSchema.optional(),
  steps: z.array(FlowStepSchema).min(1),
});

export type FlowDefinition = z.infer<typeof FlowDefinitionSchema>;
