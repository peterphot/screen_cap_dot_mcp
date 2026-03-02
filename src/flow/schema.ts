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

const WaitStep = z.object({
  action: z.literal("wait"),
  strategy: z.enum(["selector", "network_idle", "smart", "delay", "function"]),
  selector: z.string().optional(),
  timeout: z.number().optional(),
  delay: z.number().optional(),
  function: z.string().optional(),
  label: z.string().optional(),
});

const ScrollStep = z.object({
  action: z.literal("scroll"),
  direction: z.enum(["up", "down", "left", "right"]).optional(),
  amount: z.number().optional(),
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
  script: z.string(),
  label: z.string().optional(),
});

const SleepStep = z.object({
  action: z.literal("sleep"),
  duration: z.number(),
  label: z.string().optional(),
});

// ── Discriminated union of all steps ─────────────────────────────────────

export const FlowStepSchema = z.discriminatedUnion("action", [
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
