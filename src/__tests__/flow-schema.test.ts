/**
 * Unit tests for flow schema (src/flow/schema.ts)
 *
 * Tests verify:
 * - FlowDefinitionSchema validates correct flow definitions
 * - All step types are accepted with valid fields
 * - Missing required fields are rejected
 * - Invalid action types are rejected
 * - Optional fields work correctly
 * - Recording config validates correctly
 */

import { describe, it, expect } from "vitest";
import { FlowDefinitionSchema, FlowStepSchema, RecordingConfigSchema } from "../flow/schema.js";

describe("FlowStepSchema", () => {
  it("validates a navigate step", () => {
    const result = FlowStepSchema.safeParse({
      action: "navigate",
      url: "https://example.com",
    });
    expect(result.success).toBe(true);
  });

  it("validates a navigate step with optional fields", () => {
    const result = FlowStepSchema.safeParse({
      action: "navigate",
      url: "https://example.com",
      waitUntil: "networkidle0",
      label: "go-home",
    });
    expect(result.success).toBe(true);
  });

  it("validates a click step", () => {
    const result = FlowStepSchema.safeParse({
      action: "click",
      selector: ".btn-submit",
    });
    expect(result.success).toBe(true);
  });

  it("validates a click step with ref", () => {
    const result = FlowStepSchema.safeParse({
      action: "click",
      ref: "e1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a click step with both selector and ref", () => {
    const result = FlowStepSchema.safeParse({
      action: "click",
      selector: ".btn",
      ref: "e1",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a click step with neither selector nor ref", () => {
    const result = FlowStepSchema.safeParse({
      action: "click",
    });
    expect(result.success).toBe(false);
  });

  it("validates a type step", () => {
    const result = FlowStepSchema.safeParse({
      action: "type",
      selector: "#search",
      text: "hello world",
      clear: true,
    });
    expect(result.success).toBe(true);
  });

  it("validates a type step with ref", () => {
    const result = FlowStepSchema.safeParse({
      action: "type",
      ref: "e3",
      text: "hello world",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a type step with both selector and ref", () => {
    const result = FlowStepSchema.safeParse({
      action: "type",
      selector: "#search",
      ref: "e3",
      text: "hello",
    });
    expect(result.success).toBe(false);
  });

  it("validates a hover step with selector", () => {
    const result = FlowStepSchema.safeParse({
      action: "hover",
      selector: ".menu-item",
    });
    expect(result.success).toBe(true);
  });

  it("validates a hover step with ref", () => {
    const result = FlowStepSchema.safeParse({
      action: "hover",
      ref: "e5",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a hover step with both selector and ref", () => {
    const result = FlowStepSchema.safeParse({
      action: "hover",
      selector: ".menu-item",
      ref: "e5",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a hover step with neither selector nor ref", () => {
    const result = FlowStepSchema.safeParse({
      action: "hover",
    });
    expect(result.success).toBe(false);
  });

  it("validates a wait step with all strategies", () => {
    const strategies = [
      { strategy: "selector", selector: ".loaded" },
      { strategy: "network_idle" },
      { strategy: "smart" },
      { strategy: "delay", delay: 2000 },
      { strategy: "function", function: "() => document.readyState === 'complete'" },
    ];

    for (const extra of strategies) {
      const result = FlowStepSchema.safeParse({ action: "wait", ...extra });
      expect(result.success).toBe(true);
    }
  });

  it("validates a scroll step", () => {
    const result = FlowStepSchema.safeParse({
      action: "scroll",
      direction: "down",
      amount: 800,
    });
    expect(result.success).toBe(true);
  });

  it("validates a screenshot step", () => {
    const result = FlowStepSchema.safeParse({
      action: "screenshot",
      label: "hero-section",
      fullPage: true,
    });
    expect(result.success).toBe(true);
  });

  it("validates an a11y_snapshot step", () => {
    const result = FlowStepSchema.safeParse({
      action: "a11y_snapshot",
      interestingOnly: false,
      label: "page-structure",
    });
    expect(result.success).toBe(true);
  });

  it("validates an evaluate step", () => {
    const result = FlowStepSchema.safeParse({
      action: "evaluate",
      script: "document.querySelector('.btn').click()",
    });
    expect(result.success).toBe(true);
  });

  it("validates a sleep step", () => {
    const result = FlowStepSchema.safeParse({
      action: "sleep",
      duration: 3000,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown action", () => {
    const result = FlowStepSchema.safeParse({
      action: "unknown_action",
    });
    expect(result.success).toBe(false);
  });

  it("rejects navigate without url", () => {
    const result = FlowStepSchema.safeParse({
      action: "navigate",
    });
    expect(result.success).toBe(false);
  });

  it("rejects click without selector or ref", () => {
    const result = FlowStepSchema.safeParse({
      action: "click",
    });
    expect(result.success).toBe(false);
  });

  it("rejects sleep without duration", () => {
    const result = FlowStepSchema.safeParse({
      action: "sleep",
    });
    expect(result.success).toBe(false);
  });

  it("rejects wait/selector without selector field", () => {
    const result = FlowStepSchema.safeParse({
      action: "wait",
      strategy: "selector",
    });
    expect(result.success).toBe(false);
  });

  it("rejects wait/function without function field", () => {
    const result = FlowStepSchema.safeParse({
      action: "wait",
      strategy: "function",
    });
    expect(result.success).toBe(false);
  });

  it("rejects wait/delay without delay field", () => {
    const result = FlowStepSchema.safeParse({
      action: "wait",
      strategy: "delay",
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative timeout", () => {
    const result = FlowStepSchema.safeParse({
      action: "wait",
      strategy: "smart",
      timeout: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects Infinity timeout", () => {
    const result = FlowStepSchema.safeParse({
      action: "wait",
      strategy: "smart",
      timeout: Infinity,
    });
    expect(result.success).toBe(false);
  });

  it("rejects timeout exceeding max (300000)", () => {
    const result = FlowStepSchema.safeParse({
      action: "wait",
      strategy: "smart",
      timeout: 300_001,
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative sleep duration", () => {
    const result = FlowStepSchema.safeParse({
      action: "sleep",
      duration: -100,
    });
    expect(result.success).toBe(false);
  });

  it("rejects Infinity sleep duration", () => {
    const result = FlowStepSchema.safeParse({
      action: "sleep",
      duration: Infinity,
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative scroll amount", () => {
    const result = FlowStepSchema.safeParse({
      action: "scroll",
      amount: -500,
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty evaluate script", () => {
    const result = FlowStepSchema.safeParse({
      action: "evaluate",
      script: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty wait/function function", () => {
    const result = FlowStepSchema.safeParse({
      action: "wait",
      strategy: "function",
      function: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("RecordingConfigSchema", () => {
  it("validates enabled recording", () => {
    const result = RecordingConfigSchema.safeParse({ enabled: true });
    expect(result.success).toBe(true);
  });

  it("validates recording with format", () => {
    const result = RecordingConfigSchema.safeParse({ enabled: true, format: "webm" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid format", () => {
    const result = RecordingConfigSchema.safeParse({ enabled: true, format: "avi" });
    expect(result.success).toBe(false);
  });

  it("rejects missing enabled", () => {
    const result = RecordingConfigSchema.safeParse({ format: "mp4" });
    expect(result.success).toBe(false);
  });
});

describe("FlowDefinitionSchema", () => {
  it("validates a minimal flow", () => {
    const result = FlowDefinitionSchema.safeParse({
      name: "test-flow",
      steps: [{ action: "navigate", url: "https://example.com" }],
    });
    expect(result.success).toBe(true);
  });

  it("validates a full flow with recording", () => {
    const result = FlowDefinitionSchema.safeParse({
      name: "Channel ROI Walkthrough",
      description: "Navigate to Channel ROI and capture visualizations",
      recording: { enabled: true, format: "mp4" },
      steps: [
        { action: "navigate", url: "https://app.example.com/channel-roi", label: "nav-channel-roi" },
        { action: "wait", strategy: "smart", timeout: 45000 },
        { action: "screenshot", label: "channel-roi-loaded" },
        { action: "scroll", direction: "down", amount: 800 },
        { action: "screenshot", label: "channel-roi-charts" },
        { action: "a11y_snapshot", label: "channel-roi-structure" },
        { action: "evaluate", script: "document.querySelector('.filter-btn').click()" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a flow with no steps", () => {
    const result = FlowDefinitionSchema.safeParse({
      name: "empty-flow",
      steps: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a flow with no name", () => {
    const result = FlowDefinitionSchema.safeParse({
      steps: [{ action: "navigate", url: "https://example.com" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a flow with invalid step", () => {
    const result = FlowDefinitionSchema.safeParse({
      name: "bad-flow",
      steps: [{ action: "invalid" }],
    });
    expect(result.success).toBe(false);
  });
});
