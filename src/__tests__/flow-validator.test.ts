/**
 * Unit tests for FlowValidator (src/flow/validator.ts)
 *
 * All browser module interactions are mocked. These tests verify:
 * - Selector steps: validates via page.waitForSelector
 * - Ref steps: validates via resolveRef returning a valid backendNodeId
 * - Match steps: validates via resolveMatch from a11y-matcher
 * - Non-targetable steps (navigate, scroll, sleep, etc.) are marked "skip"
 * - Returns structured report: { valid, steps: [...] }
 * - Configurable timeout per selector check (default 5000ms)
 * - Works with FlowDefinition objects directly
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FlowDefinition } from "../flow/schema.js";

// ── Mock Setup ──────────────────────────────────────────────────────────

const mockEnsurePage = vi.fn();

vi.mock("../browser.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../browser.js")>();
  return {
    ...actual,
    ensurePage: (...args: unknown[]) => mockEnsurePage(...args),
  };
});

vi.mock("../util/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    setLogLevel: vi.fn(),
  },
}));

const mockResolveRef = vi.fn();

vi.mock("../ref-store.js", () => ({
  resolveRef: (...args: unknown[]) => mockResolveRef(...args),
  clearRefs: vi.fn(),
  allocateRef: vi.fn(),
  hasRefs: vi.fn(),
}));

const mockResolveMatch = vi.fn();

vi.mock("../util/a11y-matcher.js", () => ({
  resolveMatch: (...args: unknown[]) => mockResolveMatch(...args),
}));

// ── Mock page ────────────────────────────────────────────────────────────

interface MockPage {
  waitForSelector: ReturnType<typeof vi.fn>;
  accessibility: { snapshot: ReturnType<typeof vi.fn> };
}

let mockPage: MockPage;

beforeEach(() => {
  vi.clearAllMocks();

  mockPage = {
    waitForSelector: vi.fn().mockResolvedValue({}),
    accessibility: { snapshot: vi.fn().mockResolvedValue({ role: "WebArea" }) },
  };

  mockEnsurePage.mockResolvedValue(mockPage);
  mockResolveRef.mockReturnValue(42);
  mockResolveMatch.mockResolvedValue({ ref: "e1", backendNodeId: 100, matchCount: 1 });
});

// ── Tests ────────────────────────────────────────────────────────────────

describe("FlowValidator", () => {
  let FlowValidator: typeof import("../flow/validator.js").FlowValidator;

  beforeEach(async () => {
    const mod = await import("../flow/validator.js");
    FlowValidator = mod.FlowValidator;
  });

  // ── Selector-based steps ────────────────────────────────────────────

  describe("selector-based steps", () => {
    it("marks selector step as 'ok' when element is found", async () => {
      const flow: FlowDefinition = {
        name: "selector-ok",
        steps: [{ action: "click", selector: ".btn" }],
      };

      const validator = new FlowValidator();
      const report = await validator.validate(flow);

      expect(report.valid).toBe(true);
      expect(report.steps).toHaveLength(1);
      expect(report.steps[0]).toMatchObject({
        index: 0,
        action: "click",
        status: "ok",
      });
      expect(mockPage.waitForSelector).toHaveBeenCalledWith(".btn", { timeout: 5000 });
    });

    it("marks selector step as 'missing' when element is not found", async () => {
      mockPage.waitForSelector.mockRejectedValue(new Error("Timeout waiting for selector"));

      const flow: FlowDefinition = {
        name: "selector-missing",
        steps: [{ action: "click", selector: ".nonexistent" }],
      };

      const validator = new FlowValidator();
      const report = await validator.validate(flow);

      expect(report.valid).toBe(false);
      expect(report.steps[0].status).toBe("missing");
      expect(report.steps[0].detail).toContain("Timeout");
    });

    it("validates type step with selector", async () => {
      const flow: FlowDefinition = {
        name: "type-selector",
        steps: [{ action: "type", selector: "#input", text: "hello" }],
      };

      const validator = new FlowValidator();
      const report = await validator.validate(flow);

      expect(report.valid).toBe(true);
      expect(report.steps[0].status).toBe("ok");
      expect(mockPage.waitForSelector).toHaveBeenCalledWith("#input", { timeout: 5000 });
    });

    it("validates hover step with selector", async () => {
      const flow: FlowDefinition = {
        name: "hover-selector",
        steps: [{ action: "hover", selector: ".menu" }],
      };

      const validator = new FlowValidator();
      const report = await validator.validate(flow);

      expect(report.valid).toBe(true);
      expect(report.steps[0].status).toBe("ok");
      expect(mockPage.waitForSelector).toHaveBeenCalledWith(".menu", { timeout: 5000 });
    });

    it("validates wait/selector step", async () => {
      const flow: FlowDefinition = {
        name: "wait-selector",
        steps: [{ action: "wait", strategy: "selector", selector: ".loaded" }],
      };

      const validator = new FlowValidator();
      const report = await validator.validate(flow);

      expect(report.valid).toBe(true);
      expect(report.steps[0].status).toBe("ok");
      expect(mockPage.waitForSelector).toHaveBeenCalledWith(".loaded", { timeout: 5000 });
    });
  });

  // ── Ref-based steps ─────────────────────────────────────────────────

  describe("ref-based steps", () => {
    it("marks ref step as 'ok' when ref resolves to a valid backendNodeId", async () => {
      mockResolveRef.mockReturnValue(42);

      const flow: FlowDefinition = {
        name: "ref-ok",
        steps: [{ action: "click", ref: "e1" }],
      };

      const validator = new FlowValidator();
      const report = await validator.validate(flow);

      expect(report.valid).toBe(true);
      expect(report.steps[0].status).toBe("ok");
      expect(mockResolveRef).toHaveBeenCalledWith("e1");
    });

    it("marks ref step as 'missing' when ref is stale", async () => {
      mockResolveRef.mockReturnValue(undefined);

      const flow: FlowDefinition = {
        name: "ref-stale",
        steps: [{ action: "click", ref: "e99" }],
      };

      const validator = new FlowValidator();
      const report = await validator.validate(flow);

      expect(report.valid).toBe(false);
      expect(report.steps[0].status).toBe("missing");
      expect(report.steps[0].detail).toContain("e99");
    });

    it("validates type step with ref", async () => {
      mockResolveRef.mockReturnValue(55);

      const flow: FlowDefinition = {
        name: "type-ref",
        steps: [{ action: "type", ref: "e3", text: "hello" }],
      };

      const validator = new FlowValidator();
      const report = await validator.validate(flow);

      expect(report.valid).toBe(true);
      expect(report.steps[0].status).toBe("ok");
    });

    it("validates hover step with ref", async () => {
      mockResolveRef.mockReturnValue(77);

      const flow: FlowDefinition = {
        name: "hover-ref",
        steps: [{ action: "hover", ref: "e5" }],
      };

      const validator = new FlowValidator();
      const report = await validator.validate(flow);

      expect(report.valid).toBe(true);
      expect(report.steps[0].status).toBe("ok");
    });
  });

  // ── Match-based steps ───────────────────────────────────────────────

  describe("match-based steps", () => {
    it("marks match step as 'ok' when match resolves", async () => {
      mockResolveMatch.mockResolvedValue({ ref: "e1", backendNodeId: 100, matchCount: 1 });

      const flow: FlowDefinition = {
        name: "match-ok",
        steps: [{ action: "click", match: { role: "button", name: "Submit" } }],
      };

      const validator = new FlowValidator();
      const report = await validator.validate(flow);

      expect(report.valid).toBe(true);
      expect(report.steps[0].status).toBe("ok");
      expect(mockResolveMatch).toHaveBeenCalledWith(
        { role: "button", name: "Submit" },
        { snapshot: { role: "WebArea" } },
      );
    });

    it("marks match step as 'missing' when no match found", async () => {
      mockResolveMatch.mockRejectedValue(
        new Error('No a11y node found matching { role="slider", name="Volume" }.'),
      );

      const flow: FlowDefinition = {
        name: "match-missing",
        steps: [{ action: "click", match: { role: "slider", name: "Volume" } }],
      };

      const validator = new FlowValidator();
      const report = await validator.validate(flow);

      expect(report.valid).toBe(false);
      expect(report.steps[0].status).toBe("missing");
      expect(report.steps[0].detail).toContain("No a11y node found");
    });

    it("validates type step with match", async () => {
      const flow: FlowDefinition = {
        name: "type-match",
        steps: [{ action: "type", match: { role: "textbox", name: "Search" }, text: "query" }],
      };

      const validator = new FlowValidator();
      const report = await validator.validate(flow);

      expect(report.valid).toBe(true);
      expect(report.steps[0].status).toBe("ok");
    });

    it("validates hover step with match", async () => {
      const flow: FlowDefinition = {
        name: "hover-match",
        steps: [{ action: "hover", match: { role: "menuitem", name: "File" } }],
      };

      const validator = new FlowValidator();
      const report = await validator.validate(flow);

      expect(report.valid).toBe(true);
      expect(report.steps[0].status).toBe("ok");
    });

    it("caches a11y snapshot across multiple match steps (PP-30)", async () => {
      const flow: FlowDefinition = {
        name: "multi-match-cached",
        steps: [
          { action: "click", match: { role: "button", name: "Save" } },
          { action: "type", match: { role: "textbox", name: "Search" }, text: "query" },
          { action: "hover", match: { role: "menuitem", name: "File" } },
        ],
      };

      const validator = new FlowValidator();
      await validator.validate(flow);

      // Snapshot should be taken exactly once, not once per match step
      expect(mockPage.accessibility.snapshot).toHaveBeenCalledTimes(1);

      // resolveMatch should be called once per match step
      expect(mockResolveMatch).toHaveBeenCalledTimes(3);

      // Each resolveMatch call should receive the cached snapshot
      const cachedSnapshot = { role: "WebArea" };
      expect(mockResolveMatch).toHaveBeenNthCalledWith(
        1,
        { role: "button", name: "Save" },
        { snapshot: cachedSnapshot },
      );
      expect(mockResolveMatch).toHaveBeenNthCalledWith(
        2,
        { role: "textbox", name: "Search" },
        { snapshot: cachedSnapshot },
      );
      expect(mockResolveMatch).toHaveBeenNthCalledWith(
        3,
        { role: "menuitem", name: "File" },
        { snapshot: cachedSnapshot },
      );
    });
  });

  // ── Non-targetable steps (skip) ─────────────────────────────────────

  describe("non-targetable steps", () => {
    it("marks navigate step as 'skip'", async () => {
      const flow: FlowDefinition = {
        name: "nav-skip",
        steps: [{ action: "navigate", url: "https://example.com" }],
      };

      const validator = new FlowValidator();
      const report = await validator.validate(flow);

      expect(report.valid).toBe(true);
      expect(report.steps[0].status).toBe("skip");
    });

    it("marks scroll step as 'skip'", async () => {
      const flow: FlowDefinition = {
        name: "scroll-skip",
        steps: [{ action: "scroll", direction: "down" }],
      };

      const validator = new FlowValidator();
      const report = await validator.validate(flow);

      expect(report.valid).toBe(true);
      expect(report.steps[0].status).toBe("skip");
    });

    it("marks sleep step as 'skip'", async () => {
      const flow: FlowDefinition = {
        name: "sleep-skip",
        steps: [{ action: "sleep", duration: 1000 }],
      };

      const validator = new FlowValidator();
      const report = await validator.validate(flow);

      expect(report.valid).toBe(true);
      expect(report.steps[0].status).toBe("skip");
    });

    it("marks screenshot step as 'skip'", async () => {
      const flow: FlowDefinition = {
        name: "screenshot-skip",
        steps: [{ action: "screenshot", label: "test" }],
      };

      const validator = new FlowValidator();
      const report = await validator.validate(flow);

      expect(report.valid).toBe(true);
      expect(report.steps[0].status).toBe("skip");
    });

    it("marks a11y_snapshot step as 'skip'", async () => {
      const flow: FlowDefinition = {
        name: "a11y-skip",
        steps: [{ action: "a11y_snapshot", label: "test" }],
      };

      const validator = new FlowValidator();
      const report = await validator.validate(flow);

      expect(report.valid).toBe(true);
      expect(report.steps[0].status).toBe("skip");
    });

    it("marks evaluate step as 'skip'", async () => {
      const flow: FlowDefinition = {
        name: "evaluate-skip",
        steps: [{ action: "evaluate", script: "document.title" }],
      };

      const validator = new FlowValidator();
      const report = await validator.validate(flow);

      expect(report.valid).toBe(true);
      expect(report.steps[0].status).toBe("skip");
    });

    it("marks click_at step as 'skip'", async () => {
      const flow: FlowDefinition = {
        name: "click-at-skip",
        steps: [{ action: "click_at", x: 100, y: 200 }],
      };

      const validator = new FlowValidator();
      const report = await validator.validate(flow);

      expect(report.valid).toBe(true);
      expect(report.steps[0].status).toBe("skip");
    });

    it("marks hover_at step as 'skip'", async () => {
      const flow: FlowDefinition = {
        name: "hover-at-skip",
        steps: [{ action: "hover_at", x: 100, y: 200 }],
      };

      const validator = new FlowValidator();
      const report = await validator.validate(flow);

      expect(report.valid).toBe(true);
      expect(report.steps[0].status).toBe("skip");
    });

    it("marks wait/smart step as 'skip'", async () => {
      const flow: FlowDefinition = {
        name: "wait-smart-skip",
        steps: [{ action: "wait", strategy: "smart" }],
      };

      const validator = new FlowValidator();
      const report = await validator.validate(flow);

      expect(report.valid).toBe(true);
      expect(report.steps[0].status).toBe("skip");
    });

    it("marks wait/network_idle step as 'skip'", async () => {
      const flow: FlowDefinition = {
        name: "wait-network-skip",
        steps: [{ action: "wait", strategy: "network_idle" }],
      };

      const validator = new FlowValidator();
      const report = await validator.validate(flow);

      expect(report.valid).toBe(true);
      expect(report.steps[0].status).toBe("skip");
    });

    it("marks wait/delay step as 'skip'", async () => {
      const flow: FlowDefinition = {
        name: "wait-delay-skip",
        steps: [{ action: "wait", strategy: "delay", delay: 1000 }],
      };

      const validator = new FlowValidator();
      const report = await validator.validate(flow);

      expect(report.valid).toBe(true);
      expect(report.steps[0].status).toBe("skip");
    });

    it("marks wait/function step as 'skip'", async () => {
      const flow: FlowDefinition = {
        name: "wait-fn-skip",
        steps: [{ action: "wait", strategy: "function", function: "() => true" }],
      };

      const validator = new FlowValidator();
      const report = await validator.validate(flow);

      expect(report.valid).toBe(true);
      expect(report.steps[0].status).toBe("skip");
    });
  });

  // ── Report structure ────────────────────────────────────────────────

  describe("report structure", () => {
    it("returns valid=true when all targetable steps resolve", async () => {
      const flow: FlowDefinition = {
        name: "all-ok",
        steps: [
          { action: "click", selector: ".btn" },
          { action: "navigate", url: "https://example.com" },
          { action: "type", selector: "#input", text: "hello" },
        ],
      };

      const validator = new FlowValidator();
      const report = await validator.validate(flow);

      expect(report.valid).toBe(true);
      expect(report.steps).toHaveLength(3);
    });

    it("returns valid=false when any targetable step fails", async () => {
      mockPage.waitForSelector
        .mockResolvedValueOnce({})  // first selector ok
        .mockRejectedValueOnce(new Error("Timeout"));  // second fails

      const flow: FlowDefinition = {
        name: "one-fails",
        steps: [
          { action: "click", selector: ".btn" },
          { action: "type", selector: ".missing", text: "hello" },
        ],
      };

      const validator = new FlowValidator();
      const report = await validator.validate(flow);

      expect(report.valid).toBe(false);
      expect(report.steps[0].status).toBe("ok");
      expect(report.steps[1].status).toBe("missing");
    });

    it("includes label in report steps when present", async () => {
      const flow: FlowDefinition = {
        name: "labeled",
        steps: [{ action: "click", selector: ".btn", label: "submit-button" }],
      };

      const validator = new FlowValidator();
      const report = await validator.validate(flow);

      expect(report.steps[0].label).toBe("submit-button");
    });

    it("includes index in report steps", async () => {
      const flow: FlowDefinition = {
        name: "indexed",
        steps: [
          { action: "navigate", url: "https://example.com" },
          { action: "click", selector: ".btn" },
          { action: "sleep", duration: 100 },
        ],
      };

      const validator = new FlowValidator();
      const report = await validator.validate(flow);

      expect(report.steps[0].index).toBe(0);
      expect(report.steps[1].index).toBe(1);
      expect(report.steps[2].index).toBe(2);
    });

    it("includes action in report steps", async () => {
      const flow: FlowDefinition = {
        name: "actions",
        steps: [
          { action: "click", selector: ".btn" },
          { action: "navigate", url: "https://example.com" },
        ],
      };

      const validator = new FlowValidator();
      const report = await validator.validate(flow);

      expect(report.steps[0].action).toBe("click");
      expect(report.steps[1].action).toBe("navigate");
    });

    it("valid=true when all steps are skip-type", async () => {
      const flow: FlowDefinition = {
        name: "all-skip",
        steps: [
          { action: "navigate", url: "https://example.com" },
          { action: "sleep", duration: 100 },
          { action: "screenshot", label: "test" },
        ],
      };

      const validator = new FlowValidator();
      const report = await validator.validate(flow);

      expect(report.valid).toBe(true);
    });
  });

  // ── Timeout configuration ──────────────────────────────────────────

  describe("timeout configuration", () => {
    it("uses default timeout of 5000ms", async () => {
      const flow: FlowDefinition = {
        name: "default-timeout",
        steps: [{ action: "click", selector: ".btn" }],
      };

      const validator = new FlowValidator();
      await validator.validate(flow);

      expect(mockPage.waitForSelector).toHaveBeenCalledWith(".btn", { timeout: 5000 });
    });

    it("uses custom timeout when provided", async () => {
      const flow: FlowDefinition = {
        name: "custom-timeout",
        steps: [{ action: "click", selector: ".btn" }],
      };

      const validator = new FlowValidator();
      await validator.validate(flow, { timeout: 10000 });

      expect(mockPage.waitForSelector).toHaveBeenCalledWith(".btn", { timeout: 10000 });
    });
  });

  // ── Multi-step mixed flow ──────────────────────────────────────────

  describe("multi-step mixed flow", () => {
    it("validates a complex flow with mixed step types", async () => {
      mockPage.waitForSelector
        .mockResolvedValueOnce({})  // .btn
        .mockResolvedValueOnce({})  // #input
        .mockRejectedValueOnce(new Error("Timeout"));  // .missing

      mockResolveRef.mockReturnValue(42);
      mockResolveMatch.mockResolvedValue({ ref: "e1", backendNodeId: 100, matchCount: 1 });

      const flow: FlowDefinition = {
        name: "complex-flow",
        steps: [
          { action: "navigate", url: "https://example.com" },
          { action: "click", selector: ".btn" },
          { action: "type", selector: "#input", text: "hello" },
          { action: "click", ref: "e1" },
          { action: "click", match: { role: "button", name: "Submit" } },
          { action: "sleep", duration: 500 },
          { action: "hover", selector: ".missing" },
          { action: "screenshot", label: "final" },
        ],
      };

      const validator = new FlowValidator();
      const report = await validator.validate(flow);

      expect(report.valid).toBe(false);
      expect(report.steps).toHaveLength(8);
      expect(report.steps[0]).toMatchObject({ index: 0, action: "navigate", status: "skip" });
      expect(report.steps[1]).toMatchObject({ index: 1, action: "click", status: "ok" });
      expect(report.steps[2]).toMatchObject({ index: 2, action: "type", status: "ok" });
      expect(report.steps[3]).toMatchObject({ index: 3, action: "click", status: "ok" });
      expect(report.steps[4]).toMatchObject({ index: 4, action: "click", status: "ok" });
      expect(report.steps[5]).toMatchObject({ index: 5, action: "sleep", status: "skip" });
      expect(report.steps[6]).toMatchObject({ index: 6, action: "hover", status: "missing" });
      expect(report.steps[7]).toMatchObject({ index: 7, action: "screenshot", status: "skip" });
    });
  });

  // ── No actions executed ─────────────────────────────────────────────

  describe("no actions executed", () => {
    it("does not call page.click, page.type, or page.hover", async () => {
      const mockPageWithActions = {
        ...mockPage,
        click: vi.fn(),
        type: vi.fn(),
        hover: vi.fn(),
        goto: vi.fn(),
        evaluate: vi.fn(),
      };
      mockEnsurePage.mockResolvedValue(mockPageWithActions);

      const flow: FlowDefinition = {
        name: "no-actions",
        steps: [
          { action: "click", selector: ".btn" },
          { action: "type", selector: "#input", text: "hello" },
          { action: "hover", selector: ".menu" },
        ],
      };

      const validator = new FlowValidator();
      await validator.validate(flow);

      // Only waitForSelector should be called, not actual actions
      expect(mockPageWithActions.click).not.toHaveBeenCalled();
      expect(mockPageWithActions.type).not.toHaveBeenCalled();
      expect(mockPageWithActions.hover).not.toHaveBeenCalled();
      expect(mockPageWithActions.goto).not.toHaveBeenCalled();
      expect(mockPageWithActions.evaluate).not.toHaveBeenCalled();
    });
  });
});
