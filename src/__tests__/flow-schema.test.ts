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
import { FlowDefinitionSchema, FlowStepSchema, RecordingConfigSchema, MAX_CONDITIONAL_DEPTH, MAX_GROUP_DEPTH } from "../flow/schema.js";

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

  it("rejects a click step with empty selector", () => {
    const result = FlowStepSchema.safeParse({
      action: "click",
      selector: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a click step with empty ref", () => {
    const result = FlowStepSchema.safeParse({
      action: "click",
      ref: "",
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

  it("rejects a type step with neither selector nor ref", () => {
    const result = FlowStepSchema.safeParse({
      action: "type",
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

  // ── press_key step ──────────────────────────────────────────────────

  it("validates a press_key step with key", () => {
    const result = FlowStepSchema.safeParse({
      action: "press_key",
      key: "Escape",
    });
    expect(result.success).toBe(true);
  });

  it("validates a press_key step with label", () => {
    const result = FlowStepSchema.safeParse({
      action: "press_key",
      key: "Tab",
      label: "tab-to-next",
    });
    expect(result.success).toBe(true);
  });

  it("validates a press_key step with modifier combination", () => {
    const result = FlowStepSchema.safeParse({
      action: "press_key",
      key: "Control+a",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a press_key step without key", () => {
    const result = FlowStepSchema.safeParse({
      action: "press_key",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a press_key step with empty key", () => {
    const result = FlowStepSchema.safeParse({
      action: "press_key",
      key: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a press_key step with spaces in key", () => {
    const result = FlowStepSchema.safeParse({
      action: "press_key",
      key: "Control a",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a press_key step with injection attempt", () => {
    const result = FlowStepSchema.safeParse({
      action: "press_key",
      key: "Escape; rm -rf /",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a press_key step with special characters", () => {
    const result = FlowStepSchema.safeParse({
      action: "press_key",
      key: "<script>alert(1)</script>",
    });
    expect(result.success).toBe(false);
  });

  it("validates a press_key step with F12 function key", () => {
    const result = FlowStepSchema.safeParse({
      action: "press_key",
      key: "F12",
    });
    expect(result.success).toBe(true);
  });

  it("validates a press_key step with single character key", () => {
    const result = FlowStepSchema.safeParse({
      action: "press_key",
      key: "a",
    });
    expect(result.success).toBe(true);
  });

  it("validates a press_key step with Shift+A modifier combo", () => {
    const result = FlowStepSchema.safeParse({
      action: "press_key",
      key: "Shift+A",
    });
    expect(result.success).toBe(true);
  });

  it("validates a press_key step with Meta+c modifier combo", () => {
    const result = FlowStepSchema.safeParse({
      action: "press_key",
      key: "Meta+c",
    });
    expect(result.success).toBe(true);
  });

  // ── click_at step ───────────────────────────────────────────────────

  it("validates a click_at step with x, y", () => {
    const result = FlowStepSchema.safeParse({
      action: "click_at",
      x: 150,
      y: 250,
    });
    expect(result.success).toBe(true);
  });

  it("validates a click_at step with label", () => {
    const result = FlowStepSchema.safeParse({
      action: "click_at",
      x: 100,
      y: 200,
      label: "chart-bar",
    });
    expect(result.success).toBe(true);
  });

  it("validates a click_at step with zero coordinates", () => {
    const result = FlowStepSchema.safeParse({
      action: "click_at",
      x: 0,
      y: 0,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a click_at step with negative x", () => {
    const result = FlowStepSchema.safeParse({
      action: "click_at",
      x: -1,
      y: 100,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a click_at step with negative y", () => {
    const result = FlowStepSchema.safeParse({
      action: "click_at",
      x: 100,
      y: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a click_at step without x", () => {
    const result = FlowStepSchema.safeParse({
      action: "click_at",
      y: 100,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a click_at step without y", () => {
    const result = FlowStepSchema.safeParse({
      action: "click_at",
      x: 100,
    });
    expect(result.success).toBe(false);
  });

  // ── match selector on click/type/hover ─────────────────────────────

  it("validates a click step with match", () => {
    const result = FlowStepSchema.safeParse({
      action: "click",
      match: { role: "button", name: "Submit" },
    });
    expect(result.success).toBe(true);
  });

  it("validates a click step with match role only", () => {
    const result = FlowStepSchema.safeParse({
      action: "click",
      match: { role: "link" },
    });
    expect(result.success).toBe(true);
  });

  it("validates a click step with match name only", () => {
    const result = FlowStepSchema.safeParse({
      action: "click",
      match: { name: "Channel ROI" },
    });
    expect(result.success).toBe(true);
  });

  it("validates a click step with match and index", () => {
    const result = FlowStepSchema.safeParse({
      action: "click",
      match: { role: "button", name: "Column", index: 1 },
    });
    expect(result.success).toBe(true);
  });

  it("validates a click step with match and label", () => {
    const result = FlowStepSchema.safeParse({
      action: "click",
      match: { role: "link", name: "Channel ROI" },
      label: "Navigate to Channel ROI",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a click step with match and selector", () => {
    const result = FlowStepSchema.safeParse({
      action: "click",
      match: { role: "button" },
      selector: ".btn",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a click step with match and ref", () => {
    const result = FlowStepSchema.safeParse({
      action: "click",
      match: { role: "button" },
      ref: "e1",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a click step with empty match (no role or name)", () => {
    const result = FlowStepSchema.safeParse({
      action: "click",
      match: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects a click step with match having negative index", () => {
    const result = FlowStepSchema.safeParse({
      action: "click",
      match: { role: "button", index: -1 },
    });
    expect(result.success).toBe(false);
  });

  it("validates a type step with match", () => {
    const result = FlowStepSchema.safeParse({
      action: "type",
      match: { role: "textbox", name: "Search" },
      text: "hello",
    });
    expect(result.success).toBe(true);
  });

  it("validates a type step with match and clear", () => {
    const result = FlowStepSchema.safeParse({
      action: "type",
      match: { role: "textbox", name: "Email" },
      text: "user@example.com",
      clear: true,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a type step with match and selector", () => {
    const result = FlowStepSchema.safeParse({
      action: "type",
      match: { role: "textbox" },
      selector: "#search",
      text: "hello",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a type step with match and ref", () => {
    const result = FlowStepSchema.safeParse({
      action: "type",
      match: { role: "textbox" },
      ref: "e3",
      text: "hello",
    });
    expect(result.success).toBe(false);
  });

  it("validates a hover step with match", () => {
    const result = FlowStepSchema.safeParse({
      action: "hover",
      match: { role: "menuitem", name: "File" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a hover step with match and selector", () => {
    const result = FlowStepSchema.safeParse({
      action: "hover",
      match: { role: "menuitem" },
      selector: ".menu-item",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a hover step with match and ref", () => {
    const result = FlowStepSchema.safeParse({
      action: "hover",
      match: { role: "menuitem" },
      ref: "e5",
    });
    expect(result.success).toBe(false);
  });

  // ── if_visible / if_not_visible steps ──────────────────────────────

  it("validates an if_visible step with selector", () => {
    const result = FlowStepSchema.safeParse({
      action: "if_visible",
      selector: ".cookie-banner",
      then: [{ action: "click", selector: ".cookie-banner .dismiss" }],
      else: [],
    });
    expect(result.success).toBe(true);
  });

  it("validates an if_visible step with ref", () => {
    const result = FlowStepSchema.safeParse({
      action: "if_visible",
      ref: "e1",
      then: [{ action: "click", ref: "e1" }],
      else: [],
    });
    expect(result.success).toBe(true);
  });

  it("validates an if_visible step with match", () => {
    const result = FlowStepSchema.safeParse({
      action: "if_visible",
      match: { role: "dialog", name: "Cookie Consent" },
      then: [{ action: "click", match: { role: "button", name: "Accept" } }],
      else: [],
    });
    expect(result.success).toBe(true);
  });

  it("validates an if_not_visible step with selector", () => {
    const result = FlowStepSchema.safeParse({
      action: "if_not_visible",
      selector: ".content-loaded",
      then: [{ action: "wait", strategy: "smart" }],
      else: [],
    });
    expect(result.success).toBe(true);
  });

  it("validates an if_visible step with optional timeout", () => {
    const result = FlowStepSchema.safeParse({
      action: "if_visible",
      selector: ".popup",
      timeout: 5000,
      then: [{ action: "click", selector: ".popup .close" }],
      else: [],
    });
    expect(result.success).toBe(true);
  });

  it("validates an if_visible step with optional label", () => {
    const result = FlowStepSchema.safeParse({
      action: "if_visible",
      selector: ".modal",
      label: "check-modal",
      then: [{ action: "click", selector: ".modal .ok" }],
      else: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects if_visible with both selector and ref", () => {
    const result = FlowStepSchema.safeParse({
      action: "if_visible",
      selector: ".banner",
      ref: "e1",
      then: [],
      else: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects if_visible with no condition target", () => {
    const result = FlowStepSchema.safeParse({
      action: "if_visible",
      then: [],
      else: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects if_visible without then array", () => {
    const result = FlowStepSchema.safeParse({
      action: "if_visible",
      selector: ".banner",
      else: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects if_visible without else array", () => {
    const result = FlowStepSchema.safeParse({
      action: "if_visible",
      selector: ".banner",
      then: [],
    });
    expect(result.success).toBe(false);
  });

  it("validates nested conditional steps (depth 2)", () => {
    const result = FlowStepSchema.safeParse({
      action: "if_visible",
      selector: ".outer",
      then: [
        {
          action: "if_visible",
          selector: ".inner",
          then: [{ action: "click", selector: ".inner .btn" }],
          else: [],
        },
      ],
      else: [],
    });
    expect(result.success).toBe(true);
  });

  it("validates nested conditional steps at max depth (depth 3)", () => {
    const result = FlowStepSchema.safeParse({
      action: "if_visible",
      selector: ".level1",
      then: [
        {
          action: "if_visible",
          selector: ".level2",
          then: [
            {
              action: "if_visible",
              selector: ".level3",
              then: [{ action: "click", selector: ".level3 .btn" }],
              else: [],
            },
          ],
          else: [],
        },
      ],
      else: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects nested conditional steps exceeding max depth (depth 4)", () => {
    const result = FlowStepSchema.safeParse({
      action: "if_visible",
      selector: ".level1",
      then: [
        {
          action: "if_visible",
          selector: ".level2",
          then: [
            {
              action: "if_visible",
              selector: ".level3",
              then: [
                {
                  action: "if_visible",
                  selector: ".level4",
                  then: [{ action: "click", selector: ".level4 .btn" }],
                  else: [],
                },
              ],
              else: [],
            },
          ],
          else: [],
        },
      ],
      else: [],
    });
    expect(result.success).toBe(false);
  });

  it("validates if_visible with non-empty then and else arrays", () => {
    const result = FlowStepSchema.safeParse({
      action: "if_visible",
      selector: ".promo",
      then: [
        { action: "click", selector: ".promo .cta" },
        { action: "screenshot", label: "promo-visible" },
      ],
      else: [
        { action: "screenshot", label: "promo-hidden" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects if_visible with invalid step in then array", () => {
    const result = FlowStepSchema.safeParse({
      action: "if_visible",
      selector: ".banner",
      then: [{ action: "invalid_action" }],
      else: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects if_visible with invalid step in else array", () => {
    const result = FlowStepSchema.safeParse({
      action: "if_visible",
      selector: ".banner",
      then: [],
      else: [{ action: "invalid_action" }],
    });
    expect(result.success).toBe(false);
  });

  it("exports MAX_CONDITIONAL_DEPTH constant equal to 3", () => {
    expect(MAX_CONDITIONAL_DEPTH).toBe(3);
  });

  it("rejects if_visible with negative timeout", () => {
    const result = FlowStepSchema.safeParse({
      action: "if_visible",
      selector: ".banner",
      timeout: -1,
      then: [],
      else: [],
    });
    expect(result.success).toBe(false);
  });

  it("validates if_visible with empty match (no role or name) fails", () => {
    const result = FlowStepSchema.safeParse({
      action: "if_visible",
      match: {},
      then: [],
      else: [],
    });
    expect(result.success).toBe(false);
  });

  // ── hover_at step ──────────────────────────────────────────────────

  it("validates a hover_at step with x, y", () => {
    const result = FlowStepSchema.safeParse({
      action: "hover_at",
      x: 300,
      y: 400,
    });
    expect(result.success).toBe(true);
  });

  it("validates a hover_at step with label", () => {
    const result = FlowStepSchema.safeParse({
      action: "hover_at",
      x: 500,
      y: 600,
      label: "tooltip-area",
    });
    expect(result.success).toBe(true);
  });

  it("validates a hover_at step with zero coordinates", () => {
    const result = FlowStepSchema.safeParse({
      action: "hover_at",
      x: 0,
      y: 0,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a hover_at step with negative x", () => {
    const result = FlowStepSchema.safeParse({
      action: "hover_at",
      x: -1,
      y: 100,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a hover_at step with negative y", () => {
    const result = FlowStepSchema.safeParse({
      action: "hover_at",
      x: 100,
      y: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a hover_at step without x", () => {
    const result = FlowStepSchema.safeParse({
      action: "hover_at",
      y: 100,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a hover_at step without y", () => {
    const result = FlowStepSchema.safeParse({
      action: "hover_at",
      x: 100,
    });
    expect(result.success).toBe(false);
  });

  // ── animate field on click/hover/click_at/hover_at ──────────────────

  it("validates a click step with animate: true", () => {
    const result = FlowStepSchema.safeParse({
      action: "click",
      selector: ".btn",
      animate: true,
    });
    expect(result.success).toBe(true);
  });

  it("validates a click step with animate: false", () => {
    const result = FlowStepSchema.safeParse({
      action: "click",
      selector: ".btn",
      animate: false,
    });
    expect(result.success).toBe(true);
  });

  it("validates a click step without animate (optional)", () => {
    const result = FlowStepSchema.safeParse({
      action: "click",
      selector: ".btn",
    });
    expect(result.success).toBe(true);
  });

  it("validates a hover step with animate: true", () => {
    const result = FlowStepSchema.safeParse({
      action: "hover",
      selector: ".menu-item",
      animate: true,
    });
    expect(result.success).toBe(true);
  });

  it("validates a click_at step with animate: true", () => {
    const result = FlowStepSchema.safeParse({
      action: "click_at",
      x: 100,
      y: 200,
      animate: true,
    });
    expect(result.success).toBe(true);
  });

  it("validates a click_at step with animate: false", () => {
    const result = FlowStepSchema.safeParse({
      action: "click_at",
      x: 100,
      y: 200,
      animate: false,
    });
    expect(result.success).toBe(true);
  });

  it("validates a hover_at step with animate: true", () => {
    const result = FlowStepSchema.safeParse({
      action: "hover_at",
      x: 300,
      y: 400,
      animate: true,
    });
    expect(result.success).toBe(true);
  });

  it("validates a hover_at step with animate: false", () => {
    const result = FlowStepSchema.safeParse({
      action: "hover_at",
      x: 300,
      y: 400,
      animate: false,
    });
    expect(result.success).toBe(true);
  });

  it("validates a click step with match and animate", () => {
    const result = FlowStepSchema.safeParse({
      action: "click",
      match: { role: "button", name: "Submit" },
      animate: true,
    });
    expect(result.success).toBe(true);
  });

  it("validates a hover step with match and animate", () => {
    const result = FlowStepSchema.safeParse({
      action: "hover",
      match: { role: "menuitem", name: "File" },
      animate: false,
    });
    expect(result.success).toBe(true);
  });

  // ── scroll_to_text step ─────────────────────────────────────────────

  it("validates a scroll_to_text step with text only", () => {
    const result = FlowStepSchema.safeParse({
      action: "scroll_to_text",
      text: "Insights Table",
    });
    expect(result.success).toBe(true);
  });

  it("validates a scroll_to_text step with text and label", () => {
    const result = FlowStepSchema.safeParse({
      action: "scroll_to_text",
      text: "Revenue Summary",
      label: "scroll-to-revenue",
    });
    expect(result.success).toBe(true);
  });

  it("validates a scroll_to_text step with timeout", () => {
    const result = FlowStepSchema.safeParse({
      action: "scroll_to_text",
      text: "Footer Section",
      timeout: 5000,
    });
    expect(result.success).toBe(true);
  });

  it("validates a scroll_to_text step with all optional fields", () => {
    const result = FlowStepSchema.safeParse({
      action: "scroll_to_text",
      text: "Contact Us",
      timeout: 15000,
      label: "scroll-to-contact",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a scroll_to_text step without text", () => {
    const result = FlowStepSchema.safeParse({
      action: "scroll_to_text",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a scroll_to_text step with empty text", () => {
    const result = FlowStepSchema.safeParse({
      action: "scroll_to_text",
      text: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a scroll_to_text step with text exceeding 1000 chars", () => {
    const result = FlowStepSchema.safeParse({
      action: "scroll_to_text",
      text: "A".repeat(1001),
    });
    expect(result.success).toBe(false);
  });

  it("validates a scroll_to_text step with text at max length (1000 chars)", () => {
    const result = FlowStepSchema.safeParse({
      action: "scroll_to_text",
      text: "A".repeat(1000),
    });
    expect(result.success).toBe(true);
  });

  it("rejects a scroll_to_text step with negative timeout", () => {
    const result = FlowStepSchema.safeParse({
      action: "scroll_to_text",
      text: "Some text",
      timeout: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a scroll_to_text step with Infinity timeout", () => {
    const result = FlowStepSchema.safeParse({
      action: "scroll_to_text",
      text: "Some text",
      timeout: Infinity,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a scroll_to_text step with timeout exceeding max (300000)", () => {
    const result = FlowStepSchema.safeParse({
      action: "scroll_to_text",
      text: "Some text",
      timeout: 300_001,
    });
    expect(result.success).toBe(false);
  });

  it("validates a scroll_to_text step with timeout at max (300000)", () => {
    const result = FlowStepSchema.safeParse({
      action: "scroll_to_text",
      text: "Some text",
      timeout: 300_000,
    });
    expect(result.success).toBe(true);
  });
  // ── group step ─────────────────────────────────────────────────────

  it("validates a group step with name and steps", () => {
    const result = FlowStepSchema.safeParse({
      action: "group",
      name: "Filter Interactions",
      steps: [
        { action: "click", selector: "#filter" },
        { action: "sleep", duration: 1500 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("validates a group step with optional label", () => {
    const result = FlowStepSchema.safeParse({
      action: "group",
      name: "Setup Steps",
      label: "setup-section",
      steps: [{ action: "navigate", url: "https://example.com" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a group step without name", () => {
    const result = FlowStepSchema.safeParse({
      action: "group",
      steps: [{ action: "sleep", duration: 1000 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a group step without steps array", () => {
    const result = FlowStepSchema.safeParse({
      action: "group",
      name: "Missing Steps",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a group step with empty steps array", () => {
    const result = FlowStepSchema.safeParse({
      action: "group",
      name: "Empty Group",
      steps: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a group step with name exceeding 200 chars", () => {
    const result = FlowStepSchema.safeParse({
      action: "group",
      name: "A".repeat(201),
      steps: [{ action: "sleep", duration: 1000 }],
    });
    expect(result.success).toBe(false);
  });

  it("validates a group step with name at max length (200 chars)", () => {
    const result = FlowStepSchema.safeParse({
      action: "group",
      name: "A".repeat(200),
      steps: [{ action: "sleep", duration: 1000 }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a group step with invalid nested step", () => {
    const result = FlowStepSchema.safeParse({
      action: "group",
      name: "Bad Group",
      steps: [{ action: "invalid_action" }],
    });
    expect(result.success).toBe(false);
  });

  it("validates a group step containing a conditional step", () => {
    const result = FlowStepSchema.safeParse({
      action: "group",
      name: "Conditional Group",
      steps: [
        {
          action: "if_visible",
          selector: ".banner",
          then: [{ action: "click", selector: ".banner .dismiss" }],
          else: [],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("validates nested groups (depth 2)", () => {
    const result = FlowStepSchema.safeParse({
      action: "group",
      name: "Outer Group",
      steps: [
        {
          action: "group",
          name: "Inner Group",
          steps: [{ action: "sleep", duration: 500 }],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects nested groups exceeding max depth (depth 3)", () => {
    const result = FlowStepSchema.safeParse({
      action: "group",
      name: "Level 1",
      steps: [
        {
          action: "group",
          name: "Level 2",
          steps: [
            {
              action: "group",
              name: "Level 3",
              steps: [{ action: "sleep", duration: 500 }],
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("exports MAX_GROUP_DEPTH constant equal to 2", () => {
    expect(MAX_GROUP_DEPTH).toBe(2);
  });

  it("validates a group step with multiple nested steps", () => {
    const result = FlowStepSchema.safeParse({
      action: "group",
      name: "Multi-step Group",
      steps: [
        { action: "navigate", url: "https://example.com" },
        { action: "click", selector: ".btn" },
        { action: "screenshot", label: "after-click" },
        { action: "sleep", duration: 1000 },
      ],
    });
    expect(result.success).toBe(true);
  });

});  // end describe("FlowStepSchema")

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

  it("validates a flow with press_key step", () => {
    const result = FlowDefinitionSchema.safeParse({
      name: "press-key-flow",
      steps: [
        { action: "navigate", url: "https://example.com" },
        { action: "click", selector: ".modal-trigger" },
        { action: "press_key", key: "Escape", label: "close-modal" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("validates a flow with if_visible conditional step", () => {
    const result = FlowDefinitionSchema.safeParse({
      name: "conditional-flow",
      steps: [
        { action: "navigate", url: "https://example.com" },
        {
          action: "if_visible",
          selector: ".cookie-banner",
          then: [
            { action: "click", selector: ".cookie-banner .dismiss" },
          ],
          else: [],
        },
        { action: "screenshot", label: "after-cookie-check" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("validates a flow with if_not_visible conditional step", () => {
    const result = FlowDefinitionSchema.safeParse({
      name: "conditional-not-visible-flow",
      steps: [
        { action: "navigate", url: "https://example.com" },
        {
          action: "if_not_visible",
          selector: ".content-loaded",
          then: [
            { action: "wait", strategy: "smart" },
          ],
          else: [],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("validates a flow with scroll_to_text step", () => {
    const result = FlowDefinitionSchema.safeParse({
      name: "scroll-to-text-flow",
      steps: [
        { action: "navigate", url: "https://example.com" },
        { action: "scroll_to_text", text: "Insights Table", label: "find-insights" },
        { action: "screenshot", label: "after-scroll" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("validates a flow with match-based steps", () => {
    const result = FlowDefinitionSchema.safeParse({
      name: "match-flow",
      description: "Flow using semantic selectors",
      steps: [
        { action: "navigate", url: "https://app.example.com" },
        { action: "click", match: { role: "link", name: "Channel ROI" }, label: "nav-channel-roi" },
        { action: "wait", strategy: "smart" },
        { action: "type", match: { role: "textbox", name: "Search" }, text: "revenue", label: "search" },
        { action: "hover", match: { role: "button", name: "Column", index: 0 }, label: "hover-column" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("validates a flow with group step", () => {
    const result = FlowDefinitionSchema.safeParse({
      name: "grouped-flow",
      steps: [
        { action: "navigate", url: "https://example.com" },
        {
          action: "group",
          name: "Filter Interactions",
          steps: [
            { action: "click", selector: "#filter" },
            { action: "sleep", duration: 1500 },
          ],
        },
        { action: "screenshot", label: "after-filter" },
      ],
    });
    expect(result.success).toBe(true);
  });
});
