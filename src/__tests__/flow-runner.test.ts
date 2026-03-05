/**
 * Unit tests for FlowRunner (src/flow/runner.ts)
 *
 * All browser module interactions are mocked. These tests verify:
 * - FlowRunner executes all step types correctly
 * - Output directory is created with timestamped name within FLOW_OUTPUT_DIR
 * - Recording starts/stops when flow config enables it
 * - Labeled steps get screenshot + a11y artifacts
 * - Failing steps don't abort the flow (continue on error)
 * - Error screenshots are captured on step failure
 * - Manifest.json is written with results
 * - recordOverride works
 * - URL validation rejects file:// and javascript: URLs
 * - ALLOW_EVALUATE guard blocks evaluate when disabled
 * - Path confinement restricts output to FLOW_OUTPUT_DIR
 * - Default screenshot/a11y labels include step index (no collision)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FlowRunner } from "../flow/runner.js";
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

const mockSmartWait = vi.fn();

vi.mock("../util/wait-strategies.js", () => ({
  smartWait: (...args: unknown[]) => mockSmartWait(...args),
}));

const mockMkdir = vi.fn();
const mockRealpath = vi.fn();
const mockOpen = vi.fn();

vi.mock("node:fs/promises", () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  realpath: (...args: unknown[]) => mockRealpath(...args),
  open: (...args: unknown[]) => mockOpen(...args),
}));

// Mock safeWriteFile via the path-confinement module (used by runner for all writes)
const mockSafeWriteFile = vi.fn();
const mockConfineDir = vi.fn();

vi.mock("../util/path-confinement.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../util/path-confinement.js")>();
  return {
    ...actual,
    resolveConfigDir: actual.resolveConfigDir,
    confineDir: (...args: unknown[]) => mockConfineDir(...args),
    safeWriteFile: (...args: unknown[]) => mockSafeWriteFile(...args),
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

const mockClickByBackendNodeId = vi.fn();
const mockTypeByBackendNodeId = vi.fn();
const mockHoverByBackendNodeId = vi.fn();
const mockClickAtCoordinates = vi.fn();
const mockHoverAtCoordinates = vi.fn();

vi.mock("../cdp-helpers.js", () => ({
  clickByBackendNodeId: (...args: unknown[]) => mockClickByBackendNodeId(...args),
  typeByBackendNodeId: (...args: unknown[]) => mockTypeByBackendNodeId(...args),
  hoverByBackendNodeId: (...args: unknown[]) => mockHoverByBackendNodeId(...args),
  clickAtCoordinates: (...args: unknown[]) => mockClickAtCoordinates(...args),
  hoverAtCoordinates: (...args: unknown[]) => mockHoverAtCoordinates(...args),
}));

const mockResolveRef = vi.fn();

// Mock ref-store — used transitively by validate-selector-or-ref.ts (which the runner imports)
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

const mockTranscode = vi.fn().mockResolvedValue(undefined);
vi.mock("../util/transcode.js", () => ({
  transcodeMp4ToH264: (...args: unknown[]) => mockTranscode(...args),
}));

// ── Mock page ────────────────────────────────────────────────────────────

interface MockPage {
  goto: ReturnType<typeof vi.fn>;
  click: ReturnType<typeof vi.fn>;
  type: ReturnType<typeof vi.fn>;
  hover: ReturnType<typeof vi.fn>;
  screenshot: ReturnType<typeof vi.fn>;
  evaluate: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  waitForSelector: ReturnType<typeof vi.fn>;
  waitForNetworkIdle: ReturnType<typeof vi.fn>;
  waitForFunction: ReturnType<typeof vi.fn>;
  $: ReturnType<typeof vi.fn>;
  screencast: ReturnType<typeof vi.fn>;
  accessibility: { snapshot: ReturnType<typeof vi.fn> };
  keyboard: { press: ReturnType<typeof vi.fn> };
}

let mockPage: MockPage;
let mockRecorder: { stop: ReturnType<typeof vi.fn> };

const FLOW_DIR = "/tmp/screen-cap-flows";

const originalFlowOutputDir = process.env.FLOW_OUTPUT_DIR;
const originalAllowEvaluate = process.env.ALLOW_EVALUATE;

afterEach(() => {
  if (originalFlowOutputDir === undefined) {
    delete process.env.FLOW_OUTPUT_DIR;
  } else {
    process.env.FLOW_OUTPUT_DIR = originalFlowOutputDir;
  }
  if (originalAllowEvaluate === undefined) {
    delete process.env.ALLOW_EVALUATE;
  } else {
    process.env.ALLOW_EVALUATE = originalAllowEvaluate;
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.FLOW_OUTPUT_DIR;
  delete process.env.ALLOW_EVALUATE;

  mockRecorder = { stop: vi.fn() };

  mockPage = {
    goto: vi.fn(),
    click: vi.fn(),
    type: vi.fn(),
    hover: vi.fn(),
    screenshot: vi.fn().mockResolvedValue(Buffer.from("fake-png")),
    evaluate: vi.fn(),
    select: vi.fn(),
    waitForSelector: vi.fn(),
    waitForNetworkIdle: vi.fn(),
    waitForFunction: vi.fn(),
    $: vi.fn(),
    screencast: vi.fn().mockResolvedValue(mockRecorder),
    accessibility: { snapshot: vi.fn().mockResolvedValue({ role: "WebArea" }) },
    keyboard: { press: vi.fn().mockResolvedValue(undefined) },
  };

  mockEnsurePage.mockResolvedValue(mockPage);
  mockSmartWait.mockResolvedValue({ elapsedMs: 100 });
  mockClickAtCoordinates.mockResolvedValue({ x: 0, y: 0 });
  mockHoverAtCoordinates.mockResolvedValue({ x: 0, y: 0 });
  mockResolveMatch.mockResolvedValue({ ref: "e1", backendNodeId: 100, matchCount: 1 });
  mockSafeWriteFile.mockResolvedValue(undefined);
  mockMkdir.mockResolvedValue(undefined);
  mockRealpath.mockImplementation((p: string) => Promise.resolve(p));
  // confineDir succeeds by default — returns the dir path as-is
  mockConfineDir.mockImplementation((dirPath: string) =>
    Promise.resolve({ resolvedDir: dirPath }),
  );
});

// ── Tests ────────────────────────────────────────────────────────────────

describe("FlowRunner", () => {
  const runner = new FlowRunner();

  it("executes a simple navigate flow", async () => {
    const flow: FlowDefinition = {
      name: "simple-nav",
      steps: [{ action: "navigate", url: "https://example.com" }],
    };

    const result = await runner.run(flow);

    expect(result.flowName).toBe("simple-nav");
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].success).toBe(true);
    expect(result.steps[0].action).toBe("navigate");
    expect(mockPage.goto).toHaveBeenCalledWith("https://example.com/", {
      waitUntil: "load",
      timeout: 60_000,
    });
  });

  it("logs a warning when navigate step uses networkidle2", async () => {
    const flow: FlowDefinition = {
      name: "idle2-warn",
      steps: [{ action: "navigate", url: "https://example.com", waitUntil: "networkidle2" }],
    };

    await runner.run(flow);

    const { default: logger } = await import("../util/logger.js");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('waitUntil="networkidle2" may hang on SPAs'),
    );
  });

  it("logs a warning when navigate step uses networkidle0", async () => {
    const flow: FlowDefinition = {
      name: "idle0-warn",
      steps: [{ action: "navigate", url: "https://example.com", waitUntil: "networkidle0" }],
    };

    await runner.run(flow);

    const { default: logger } = await import("../util/logger.js");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('waitUntil="networkidle0" may hang on SPAs'),
    );
  });

  it("does not log a warning for safe waitUntil strategies", async () => {
    const flow: FlowDefinition = {
      name: "safe-wait",
      steps: [
        { action: "navigate", url: "https://example.com", waitUntil: "domcontentloaded" },
      ],
    };

    await runner.run(flow);

    const { default: logger } = await import("../util/logger.js");
    // logger.warn should not have been called with a networkidle warning
    // (it may be called for other reasons, so check specific content)
    const warnCalls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls;
    const networkIdleWarnings = warnCalls.filter(
      (call: unknown[]) => typeof call[0] === "string" && (call[0] as string).includes("may hang on SPAs"),
    );
    expect(networkIdleWarnings).toHaveLength(0);
  });

  it("creates timestamped output directory within FLOW_OUTPUT_DIR", async () => {
    const flow: FlowDefinition = {
      name: "test flow",
      steps: [{ action: "navigate", url: "https://example.com" }],
    };

    const result = await runner.run(flow);

    expect(result.outputDir).toContain(FLOW_DIR);
    expect(result.outputDir).toMatch(/test_flow-\d{4}-\d{2}-\d{2}T/);
    expect(mockConfineDir).toHaveBeenCalledWith(result.outputDir, FLOW_DIR);
  });

  it("writes manifest.json at end of flow", async () => {
    const flow: FlowDefinition = {
      name: "manifest-test",
      steps: [{ action: "navigate", url: "https://example.com" }],
    };

    const result = await runner.run(flow);

    expect(result.manifestPath).toContain("manifest.json");
    const manifestCall = mockSafeWriteFile.mock.calls.find(
      (call: unknown[]) => (call[0] as string).includes("manifest.json"),
    );
    expect(manifestCall).toBeDefined();
    const manifest = JSON.parse(manifestCall![1] as string);
    expect(manifest.flowName).toBe("manifest-test");
    expect(manifest.steps).toHaveLength(1);
  });

  it("starts and stops recording when flow config enables it", async () => {
    const flow: FlowDefinition = {
      name: "record-test",
      recording: { enabled: true, format: "mp4" },
      steps: [{ action: "navigate", url: "https://example.com" }],
    };

    const result = await runner.run(flow);

    expect(mockPage.screencast).toHaveBeenCalled();
    expect(mockRecorder.stop).toHaveBeenCalled();
    expect(result.recordingPath).toContain("recording.mp4");
    expect(mockTranscode).toHaveBeenCalledWith(expect.stringContaining("recording.mp4"));
  });

  it("does not record when recording is disabled", async () => {
    const flow: FlowDefinition = {
      name: "no-record",
      recording: { enabled: false },
      steps: [{ action: "navigate", url: "https://example.com" }],
    };

    await runner.run(flow);

    expect(mockPage.screencast).not.toHaveBeenCalled();
    expect(mockTranscode).not.toHaveBeenCalled();
  });

  it("recordOverride=true overrides flow config", async () => {
    const flow: FlowDefinition = {
      name: "override-test",
      recording: { enabled: false },
      steps: [{ action: "navigate", url: "https://example.com" }],
    };

    const result = await runner.run(flow, true);

    expect(mockPage.screencast).toHaveBeenCalled();
    expect(result.recordingPath).toBeDefined();
  });

  it("recordOverride=false overrides flow config", async () => {
    const flow: FlowDefinition = {
      name: "override-false",
      recording: { enabled: true },
      steps: [{ action: "navigate", url: "https://example.com" }],
    };

    await runner.run(flow, false);

    expect(mockPage.screencast).not.toHaveBeenCalled();
  });

  it("warns but does not fail when transcode errors", async () => {
    mockTranscode.mockRejectedValueOnce(new Error("ffmpeg not found"));

    const flow: FlowDefinition = {
      name: "transcode-fail",
      recording: { enabled: true, format: "mp4" },
      steps: [{ action: "navigate", url: "https://example.com" }],
    };

    const result = await runner.run(flow);

    expect(result.recordingPath).toContain("recording.mp4");
    const { default: logger } = await import("../util/logger.js");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("ffmpeg not found"),
    );
  });

  it("executes click step", async () => {
    const flow: FlowDefinition = {
      name: "click-test",
      steps: [{ action: "click", selector: ".btn" }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(true);
    expect(mockPage.waitForSelector).toHaveBeenCalledWith(".btn", { visible: true });
    expect(mockPage.click).toHaveBeenCalledWith(".btn");
  });

  it("executes type step", async () => {
    const flow: FlowDefinition = {
      name: "type-test",
      steps: [{ action: "type", selector: "#input", text: "hello" }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(true);
    expect(mockPage.waitForSelector).toHaveBeenCalledWith("#input", { visible: true });
    expect(mockPage.click).toHaveBeenCalledWith("#input");
    expect(mockPage.type).toHaveBeenCalledWith("#input", "hello");
  });

  it("executes type step with clear", async () => {
    const flow: FlowDefinition = {
      name: "type-clear",
      steps: [{ action: "type", selector: "#input", text: "hello", clear: true }],
    };

    await runner.run(flow);

    expect(mockPage.click).toHaveBeenCalledWith("#input", { clickCount: 3 });
  });

  it("executes wait/smart step", async () => {
    const flow: FlowDefinition = {
      name: "wait-smart",
      steps: [{ action: "wait", strategy: "smart", timeout: 5000 }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(true);
    expect(mockSmartWait).toHaveBeenCalledWith(mockPage, 5000);
  });

  it("executes wait/selector step", async () => {
    const flow: FlowDefinition = {
      name: "wait-selector",
      steps: [{ action: "wait", strategy: "selector", selector: ".loaded" }],
    };

    await runner.run(flow);

    expect(mockPage.waitForSelector).toHaveBeenCalledWith(".loaded", { visible: true, timeout: 30000 });
  });

  it("executes wait/network_idle step", async () => {
    const flow: FlowDefinition = {
      name: "wait-network",
      steps: [{ action: "wait", strategy: "network_idle" }],
    };

    await runner.run(flow);

    expect(mockPage.waitForNetworkIdle).toHaveBeenCalledWith({ timeout: 30000 });
  });

  it("executes wait/function step when ALLOW_EVALUATE=true", async () => {
    process.env.ALLOW_EVALUATE = "true";

    const flow: FlowDefinition = {
      name: "wait-fn",
      steps: [{ action: "wait", strategy: "function", function: "() => true" }],
    };

    await runner.run(flow);

    expect(mockPage.waitForFunction).toHaveBeenCalledWith("() => true", { timeout: 30000 });
  });

  it("blocks wait/function step when ALLOW_EVALUATE is not set", async () => {
    delete process.env.ALLOW_EVALUATE;

    const flow: FlowDefinition = {
      name: "wait-fn-blocked",
      steps: [{ action: "wait", strategy: "function", function: "() => true" }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(false);
    expect(result.steps[0].error).toContain("wait/function is disabled");
    expect(mockPage.waitForFunction).not.toHaveBeenCalled();
  });

  it("executes scroll step", async () => {
    const flow: FlowDefinition = {
      name: "scroll-test",
      steps: [{ action: "scroll", direction: "down", amount: 800 }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(true);
    expect(mockPage.evaluate).toHaveBeenCalled();
  });

  it("executes screenshot step", async () => {
    const flow: FlowDefinition = {
      name: "screenshot-test",
      steps: [{ action: "screenshot", label: "hero", fullPage: false }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(true);
    expect(mockPage.screenshot).toHaveBeenCalledWith({ fullPage: false });
    const writeCall = mockSafeWriteFile.mock.calls.find(
      (call: unknown[]) => (call[0] as string).includes("hero.png"),
    );
    expect(writeCall).toBeDefined();
  });

  it("executes screenshot step with selector", async () => {
    const mockElement = { screenshot: vi.fn().mockResolvedValue(Buffer.from("element-png")) };
    mockPage.$.mockResolvedValue(mockElement);

    const flow: FlowDefinition = {
      name: "el-screenshot",
      steps: [{ action: "screenshot", selector: ".card", label: "card-shot" }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(true);
    expect(mockPage.$).toHaveBeenCalledWith(".card");
    expect(mockElement.screenshot).toHaveBeenCalled();
  });

  it("executes a11y_snapshot step", async () => {
    const flow: FlowDefinition = {
      name: "a11y-test",
      steps: [{ action: "a11y_snapshot", label: "page-structure" }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(true);
    expect(mockPage.accessibility.snapshot).toHaveBeenCalledWith({ interestingOnly: true });
    const writeCall = mockSafeWriteFile.mock.calls.find(
      (call: unknown[]) => (call[0] as string).includes("page-structure.json"),
    );
    expect(writeCall).toBeDefined();
  });

  it("executes evaluate step", async () => {
    process.env.ALLOW_EVALUATE = "true";

    const flow: FlowDefinition = {
      name: "eval-test",
      steps: [{ action: "evaluate", script: "document.title" }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(true);
    expect(mockPage.evaluate).toHaveBeenCalledWith("document.title");
  });

  it("executes sleep step", async () => {
    vi.useFakeTimers();

    const flow: FlowDefinition = {
      name: "sleep-test",
      steps: [{ action: "sleep", duration: 100 }],
    };

    const promise = runner.run(flow);
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result.steps[0].success).toBe(true);

    vi.useRealTimers();
  });

  it("continues on step failure", async () => {
    mockPage.goto.mockRejectedValueOnce(new Error("Navigation failed"));

    const flow: FlowDefinition = {
      name: "fail-continue",
      steps: [
        { action: "navigate", url: "https://bad.example.com" },
        { action: "navigate", url: "https://good.example.com" },
      ],
    };

    const result = await runner.run(flow);

    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].success).toBe(false);
    expect(result.steps[0].error).toBe("Navigation failed");
    expect(result.steps[1].success).toBe(true);
  });

  it("captures error screenshot on step failure", async () => {
    mockPage.goto.mockRejectedValueOnce(new Error("Navigation failed"));

    const flow: FlowDefinition = {
      name: "error-screenshot",
      steps: [{ action: "navigate", url: "https://bad.example.com" }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].screenshotPath).toContain("error-step-0.png");
    expect(mockPage.screenshot).toHaveBeenCalled();
  });

  it("captures artifacts for labeled steps", async () => {
    const flow: FlowDefinition = {
      name: "labeled-test",
      steps: [{ action: "navigate", url: "https://example.com", label: "homepage" }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(true);
    expect(result.steps[0].screenshotPath).toContain("homepage");
    expect(result.steps[0].a11yPath).toContain("homepage");
  });

  it("wait/selector requires selector at schema level", async () => {
    // This is now enforced by the schema — FlowDefinitionSchema rejects it.
    // The runner won't encounter this case with validated input.
    const result = (await import("../flow/schema.js")).FlowStepSchema.safeParse({
      action: "wait",
      strategy: "selector",
    });
    expect(result.success).toBe(false);
  });

  it("wait/function requires function at schema level", async () => {
    const result = (await import("../flow/schema.js")).FlowStepSchema.safeParse({
      action: "wait",
      strategy: "function",
    });
    expect(result.success).toBe(false);
  });

  it("reports total duration", async () => {
    const flow: FlowDefinition = {
      name: "duration-test",
      steps: [{ action: "navigate", url: "https://example.com" }],
    };

    const result = await runner.run(flow);

    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("executes multi-step flow in order", async () => {
    const callOrder: string[] = [];
    mockPage.goto.mockImplementation(async () => {
      callOrder.push("navigate");
    });
    mockPage.click.mockImplementation(async () => {
      callOrder.push("click");
    });

    const flow: FlowDefinition = {
      name: "multi-step",
      steps: [
        { action: "navigate", url: "https://example.com" },
        { action: "click", selector: ".btn" },
        { action: "navigate", url: "https://example.com/page2" },
      ],
    };

    const result = await runner.run(flow);

    expect(result.steps).toHaveLength(3);
    expect(result.steps.every((s) => s.success)).toBe(true);
    expect(callOrder).toEqual(["navigate", "click", "navigate"]);
  });

  it("executes click step with ref", async () => {
    mockResolveRef.mockReturnValue(42);

    const flow: FlowDefinition = {
      name: "click-ref",
      steps: [{ action: "click", ref: "e1" }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(true);
    expect(mockClickByBackendNodeId).toHaveBeenCalledWith(42, undefined);
    expect(mockPage.click).not.toHaveBeenCalled();
  });

  it("executes type step with ref", async () => {
    mockResolveRef.mockReturnValue(55);

    const flow: FlowDefinition = {
      name: "type-ref",
      steps: [{ action: "type", ref: "e3", text: "hello" }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(true);
    expect(mockTypeByBackendNodeId).toHaveBeenCalledWith(55, "hello", undefined);
    expect(mockPage.type).not.toHaveBeenCalled();
  });

  it("executes type step with ref and clear", async () => {
    mockResolveRef.mockReturnValue(55);

    const flow: FlowDefinition = {
      name: "type-ref-clear",
      steps: [{ action: "type", ref: "e3", text: "hello", clear: true }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(true);
    expect(mockTypeByBackendNodeId).toHaveBeenCalledWith(55, "hello", true);
  });

  it("executes hover step with selector", async () => {
    const flow: FlowDefinition = {
      name: "hover-selector",
      steps: [{ action: "hover", selector: ".menu-item" }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(true);
    expect(mockPage.hover).toHaveBeenCalledWith(".menu-item");
  });

  it("executes hover step with ref", async () => {
    mockResolveRef.mockReturnValue(77);

    const flow: FlowDefinition = {
      name: "hover-ref",
      steps: [{ action: "hover", ref: "e5" }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(true);
    expect(mockHoverByBackendNodeId).toHaveBeenCalledWith(77, undefined);
    expect(mockPage.hover).not.toHaveBeenCalled();
  });

  it("captures error for stale ref in flow step", async () => {
    mockResolveRef.mockReturnValue(undefined);

    const flow: FlowDefinition = {
      name: "stale-ref",
      steps: [{ action: "click", ref: "e99" }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(false);
    expect(result.steps[0].error).toContain("Stale or invalid ref");
    expect(mockClickByBackendNodeId).not.toHaveBeenCalled();
  });

  it("clears refs after successful navigation", async () => {
    const { clearRefs } = await import("../ref-store.js");
    const callOrder: string[] = [];
    mockPage.goto.mockImplementation(async () => { callOrder.push("goto"); });
    (clearRefs as ReturnType<typeof vi.fn>).mockImplementation(() => { callOrder.push("clearRefs"); });

    const flow: FlowDefinition = {
      name: "nav-clears-refs",
      steps: [{ action: "navigate", url: "https://example.com" }],
    };

    await runner.run(flow);

    expect(callOrder).toEqual(["goto", "clearRefs"]);
  });

  it("waits for selector visibility before hover", async () => {
    const callOrder: string[] = [];
    mockPage.waitForSelector.mockImplementation(async () => { callOrder.push("waitForSelector"); });
    mockPage.hover.mockImplementation(async () => { callOrder.push("hover"); });

    const flow: FlowDefinition = {
      name: "hover-wait",
      steps: [{ action: "hover", selector: ".menu" }],
    };

    await runner.run(flow);

    expect(callOrder).toEqual(["waitForSelector", "hover"]);
  });
});

// ── URL validation ──────────────────────────────────────────────────────

describe("URL validation", () => {
  const runner = new FlowRunner();

  it("rejects file:// URLs", async () => {
    const flow: FlowDefinition = {
      name: "file-url",
      steps: [{ action: "navigate", url: "file:///etc/passwd" }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(false);
    expect(result.steps[0].error).toContain("Only http: and https: URLs are allowed");
    expect(mockPage.goto).not.toHaveBeenCalled();
  });

  it("rejects javascript: URLs", async () => {
    const flow: FlowDefinition = {
      name: "js-url",
      steps: [{ action: "navigate", url: "javascript:alert(1)" }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(false);
    expect(result.steps[0].error).toContain("Only http: and https: URLs are allowed");
    expect(mockPage.goto).not.toHaveBeenCalled();
  });

  it("rejects invalid URLs", async () => {
    const flow: FlowDefinition = {
      name: "invalid-url",
      steps: [{ action: "navigate", url: "not-a-url" }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(false);
    expect(result.steps[0].error).toContain("Invalid URL");
    expect(mockPage.goto).not.toHaveBeenCalled();
  });

  it("normalizes URLs via URL parser", async () => {
    const flow: FlowDefinition = {
      name: "normalize-url",
      steps: [{ action: "navigate", url: "https://example.com" }],
    };

    await runner.run(flow);

    // URL parser appends trailing slash
    expect(mockPage.goto).toHaveBeenCalledWith(
      "https://example.com/",
      expect.any(Object),
    );
  });
});

// ── ALLOW_EVALUATE guard ────────────────────────────────────────────────

describe("ALLOW_EVALUATE guard", () => {
  const runner = new FlowRunner();

  it("blocks evaluate when ALLOW_EVALUATE is not set", async () => {
    delete process.env.ALLOW_EVALUATE;

    const flow: FlowDefinition = {
      name: "eval-blocked",
      steps: [{ action: "evaluate", script: "document.title" }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(false);
    expect(result.steps[0].error).toContain("evaluate is disabled");
    expect(mockPage.evaluate).not.toHaveBeenCalled();
  });

  it("blocks evaluate when ALLOW_EVALUATE=false", async () => {
    process.env.ALLOW_EVALUATE = "false";

    const flow: FlowDefinition = {
      name: "eval-blocked-false",
      steps: [{ action: "evaluate", script: "document.title" }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(false);
    expect(result.steps[0].error).toContain("evaluate is disabled");
    expect(mockPage.evaluate).not.toHaveBeenCalled();
  });

  it("allows evaluate when ALLOW_EVALUATE=true", async () => {
    process.env.ALLOW_EVALUATE = "true";

    const flow: FlowDefinition = {
      name: "eval-allowed",
      steps: [{ action: "evaluate", script: "document.title" }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(true);
    expect(mockPage.evaluate).toHaveBeenCalledWith("document.title");
  });
});

// ── Path confinement ────────────────────────────────────────────────────

describe("path confinement", () => {
  const runner = new FlowRunner();

  it("confines output to FLOW_OUTPUT_DIR", async () => {
    const flow: FlowDefinition = {
      name: "confined",
      steps: [{ action: "navigate", url: "https://example.com" }],
    };

    const result = await runner.run(flow);

    expect(result.outputDir).toContain("/tmp/screen-cap-flows/");
  });

  it("respects custom FLOW_OUTPUT_DIR", async () => {
    process.env.FLOW_OUTPUT_DIR = "/custom/flow-output";

    const flow: FlowDefinition = {
      name: "custom-dir",
      steps: [{ action: "navigate", url: "https://example.com" }],
    };

    const result = await runner.run(flow);

    expect(result.outputDir).toContain("/custom/flow-output/");
  });

  it("rejects symlink escape from FLOW_OUTPUT_DIR", async () => {
    mockConfineDir.mockResolvedValueOnce({
      error: "Path must be within /tmp/screen-cap-flows (symlink detected)",
    });

    const flow: FlowDefinition = {
      name: "symlink-escape",
      steps: [{ action: "navigate", url: "https://example.com" }],
    };

    await expect(runner.run(flow)).rejects.toThrow("symlink detected");
  });
});

// ── Default label uniqueness ────────────────────────────────────────────

describe("default label uniqueness", () => {
  const runner = new FlowRunner();

  it("uses unique default labels for unlabeled screenshot steps", async () => {
    const flow: FlowDefinition = {
      name: "multi-screenshot",
      steps: [
        { action: "screenshot" },
        { action: "screenshot" },
      ],
    };

    await runner.run(flow);

    const screenshotWrites = mockSafeWriteFile.mock.calls.filter(
      (call: unknown[]) => (call[0] as string).endsWith(".png") && !(call[0] as string).includes("manifest"),
    );

    // Should have 2 different paths
    expect(screenshotWrites).toHaveLength(2);
    const paths = screenshotWrites.map((c: unknown[]) => c[0]);
    expect(paths[0]).not.toBe(paths[1]);
    expect(paths[0]).toContain("step-0-screenshot");
    expect(paths[1]).toContain("step-1-screenshot");
  });

  it("uses unique default labels for unlabeled a11y steps", async () => {
    const flow: FlowDefinition = {
      name: "multi-a11y",
      steps: [
        { action: "a11y_snapshot" },
        { action: "a11y_snapshot" },
      ],
    };

    await runner.run(flow);

    const a11yWrites = mockSafeWriteFile.mock.calls.filter(
      (call: unknown[]) => (call[0] as string).endsWith(".json") && !(call[0] as string).includes("manifest"),
    );

    expect(a11yWrites).toHaveLength(2);
    const paths = a11yWrites.map((c: unknown[]) => c[0]);
    expect(paths[0]).not.toBe(paths[1]);
    expect(paths[0]).toContain("step-0-a11y");
    expect(paths[1]).toContain("step-1-a11y");
  });
});

// ── Coordinate-based steps ──────────────────────────────────────────────

describe("coordinate-based steps", () => {
  const runner = new FlowRunner();

  it("executes click_at step by calling clickAtCoordinates", async () => {
    const flow: FlowDefinition = {
      name: "click-at-test",
      steps: [{ action: "click_at", x: 150, y: 250 }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(true);
    expect(result.steps[0].action).toBe("click_at");
    expect(mockClickAtCoordinates).toHaveBeenCalledWith(150, 250, undefined);
  });

  it("executes hover_at step by calling hoverAtCoordinates", async () => {
    const flow: FlowDefinition = {
      name: "hover-at-test",
      steps: [{ action: "hover_at", x: 300, y: 400 }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(true);
    expect(result.steps[0].action).toBe("hover_at");
    expect(mockHoverAtCoordinates).toHaveBeenCalledWith(300, 400, undefined);
  });

  it("captures error when click_at fails", async () => {
    mockClickAtCoordinates.mockRejectedValueOnce(new RangeError("Invalid coordinates: (-1, 100)"));

    const flow: FlowDefinition = {
      name: "click-at-fail",
      steps: [{ action: "click_at", x: -1, y: 100 }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(false);
    expect(result.steps[0].error).toContain("Invalid coordinates");
  });

  it("captures error when hover_at fails", async () => {
    mockHoverAtCoordinates.mockRejectedValueOnce(new RangeError("Invalid coordinates: (100, -1)"));

    const flow: FlowDefinition = {
      name: "hover-at-fail",
      steps: [{ action: "hover_at", x: 100, y: -1 }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(false);
    expect(result.steps[0].error).toContain("Invalid coordinates");
  });

  it("executes click_at with label and captures artifacts", async () => {
    const flow: FlowDefinition = {
      name: "click-at-labeled",
      steps: [{ action: "click_at", x: 100, y: 200, label: "chart-bar" }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(true);
    expect(result.steps[0].label).toBe("chart-bar");
    expect(mockClickAtCoordinates).toHaveBeenCalledWith(100, 200, undefined);
    // Labeled steps get artifacts captured
    expect(result.steps[0].screenshotPath).toContain("chart-bar");
  });

  it("executes hover_at with label and captures artifacts", async () => {
    const flow: FlowDefinition = {
      name: "hover-at-labeled",
      steps: [{ action: "hover_at", x: 500, y: 600, label: "tooltip-area" }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(true);
    expect(result.steps[0].label).toBe("tooltip-area");
    expect(mockHoverAtCoordinates).toHaveBeenCalledWith(500, 600, undefined);
    expect(result.steps[0].screenshotPath).toContain("tooltip-area");
  });
});

// ── Press key steps ──────────────────────────────────────────────────────

describe("press_key steps", () => {
  const runner = new FlowRunner();

  it("executes press_key step by calling page.keyboard.press", async () => {
    const flow: FlowDefinition = {
      name: "press-key-test",
      steps: [{ action: "press_key", key: "Escape" }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(true);
    expect(result.steps[0].action).toBe("press_key");
    expect(mockPage.keyboard.press).toHaveBeenCalledWith("Escape");
  });

  it("executes press_key step with Enter key", async () => {
    const flow: FlowDefinition = {
      name: "press-enter",
      steps: [{ action: "press_key", key: "Enter" }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(true);
    expect(mockPage.keyboard.press).toHaveBeenCalledWith("Enter");
  });

  it("executes press_key step with modifier combination", async () => {
    const flow: FlowDefinition = {
      name: "press-ctrl-a",
      steps: [{ action: "press_key", key: "Control+a" }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(true);
    expect(mockPage.keyboard.press).toHaveBeenCalledWith("Control+a");
  });

  it("captures error when press_key fails", async () => {
    mockPage.keyboard.press.mockRejectedValueOnce(new Error("Key not recognized"));

    const flow: FlowDefinition = {
      name: "press-key-fail",
      steps: [{ action: "press_key", key: "BadKey" }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(false);
    expect(result.steps[0].error).toContain("Key not recognized");
  });

  it("captures artifacts for labeled press_key step", async () => {
    const flow: FlowDefinition = {
      name: "press-key-labeled",
      steps: [{ action: "press_key", key: "Escape", label: "close-modal" }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(true);
    expect(result.steps[0].label).toBe("close-modal");
    expect(result.steps[0].screenshotPath).toContain("close-modal");
  });

  it("continues executing after press_key failure", async () => {
    mockPage.keyboard.press.mockRejectedValueOnce(new Error("Key failed"));

    const flow: FlowDefinition = {
      name: "press-key-continue",
      steps: [
        { action: "press_key", key: "BadKey" },
        { action: "navigate", url: "https://example.com" },
      ],
    };

    const result = await runner.run(flow);

    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].success).toBe(false);
    expect(result.steps[1].success).toBe(true);
  });
});

// ── Match-based steps ────────────────────────────────────────────────────

describe("match-based steps", () => {
  const runner = new FlowRunner();

  it("executes click step with match by resolving via a11y matcher", async () => {
    mockResolveMatch.mockResolvedValue({ ref: "e1", backendNodeId: 100, matchCount: 1 });

    const flow: FlowDefinition = {
      name: "click-match",
      steps: [{ action: "click", match: { role: "button", name: "Submit" } }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(true);
    expect(mockResolveMatch).toHaveBeenCalledWith(
      { role: "button", name: "Submit" },
      undefined,
    );
    expect(mockClickByBackendNodeId).toHaveBeenCalledWith(100, undefined);
  });

  it("executes type step with match", async () => {
    mockResolveMatch.mockResolvedValue({ ref: "e2", backendNodeId: 200, matchCount: 1 });

    const flow: FlowDefinition = {
      name: "type-match",
      steps: [{ action: "type", match: { role: "textbox", name: "Search" }, text: "query" }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(true);
    expect(mockResolveMatch).toHaveBeenCalledWith(
      { role: "textbox", name: "Search" },
      undefined,
    );
    expect(mockTypeByBackendNodeId).toHaveBeenCalledWith(200, "query", undefined);
  });

  it("executes type step with match and clear", async () => {
    mockResolveMatch.mockResolvedValue({ ref: "e3", backendNodeId: 300, matchCount: 1 });

    const flow: FlowDefinition = {
      name: "type-match-clear",
      steps: [{ action: "type", match: { role: "textbox" }, text: "new value", clear: true }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(true);
    expect(mockTypeByBackendNodeId).toHaveBeenCalledWith(300, "new value", true);
  });

  it("executes hover step with match", async () => {
    mockResolveMatch.mockResolvedValue({ ref: "e4", backendNodeId: 400, matchCount: 1 });

    const flow: FlowDefinition = {
      name: "hover-match",
      steps: [{ action: "hover", match: { role: "menuitem", name: "File" } }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(true);
    expect(mockResolveMatch).toHaveBeenCalledWith(
      { role: "menuitem", name: "File" },
      undefined,
    );
    expect(mockHoverByBackendNodeId).toHaveBeenCalledWith(400, undefined);
  });

  it("passes index to resolveMatch when specified", async () => {
    mockResolveMatch.mockResolvedValue({ ref: "e5", backendNodeId: 500, matchCount: 3 });

    const flow: FlowDefinition = {
      name: "click-match-index",
      steps: [{ action: "click", match: { role: "button", name: "Column", index: 2 } }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(true);
    expect(mockResolveMatch).toHaveBeenCalledWith(
      { role: "button", name: "Column", index: 2 },
      undefined,
    );
  });

  it("captures error when match resolution fails", async () => {
    mockResolveMatch.mockRejectedValue(
      new Error('No a11y node found matching { role="slider", name="Volume" }.'),
    );

    const flow: FlowDefinition = {
      name: "match-fail",
      steps: [{ action: "click", match: { role: "slider", name: "Volume" } }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(false);
    expect(result.steps[0].error).toContain("No a11y node found matching");
  });

  it("does not call selector or ref actions when match is used", async () => {
    mockResolveMatch.mockResolvedValue({ ref: "e6", backendNodeId: 600, matchCount: 1 });

    const flow: FlowDefinition = {
      name: "match-no-selector",
      steps: [{ action: "click", match: { role: "link", name: "Home" } }],
    };

    await runner.run(flow);

    // Should use backendNodeId-based click, not selector-based
    expect(mockPage.waitForSelector).not.toHaveBeenCalled();
    expect(mockPage.click).not.toHaveBeenCalled();
  });

  it("continues executing after match step failure", async () => {
    mockResolveMatch.mockRejectedValueOnce(new Error("No match found"));

    const flow: FlowDefinition = {
      name: "match-continue",
      steps: [
        { action: "click", match: { role: "slider" } },
        { action: "navigate", url: "https://example.com" },
      ],
    };

    const result = await runner.run(flow);

    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].success).toBe(false);
    expect(result.steps[1].success).toBe(true);
  });

  it("executes if_visible then branch when selector is visible", async () => {
    mockPage.waitForSelector.mockResolvedValue({});

    const flow: FlowDefinition = {
      name: "if-visible-then",
      steps: [
        {
          action: "if_visible",
          selector: ".cookie-banner",
          then: [{ action: "click", selector: ".cookie-banner .dismiss" }],
          else: [],
        },
      ],
    };

    const result = await runner.run(flow);

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].success).toBe(true);
    expect(result.steps[0].action).toBe("if_visible");
    // The click inside `then` should have been called
    expect(mockPage.click).toHaveBeenCalledWith(".cookie-banner .dismiss");
  });

  it("executes if_visible else branch when selector is NOT visible", async () => {
    // First call: visibility check fails (not visible)
    mockPage.waitForSelector.mockRejectedValueOnce(new Error("Timeout"));
    // Second call: the navigate step doesn't use waitForSelector

    const flow: FlowDefinition = {
      name: "if-visible-else",
      steps: [
        {
          action: "if_visible",
          selector: ".cookie-banner",
          then: [{ action: "click", selector: ".cookie-banner .dismiss" }],
          else: [{ action: "navigate", url: "https://example.com" }],
        },
      ],
    };

    const result = await runner.run(flow);

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].success).toBe(true);
    expect(result.steps[0].action).toBe("if_visible");
    // The click in `then` should NOT have been called
    expect(mockPage.click).not.toHaveBeenCalled();
    // The navigate in `else` should have been called
    expect(mockPage.goto).toHaveBeenCalled();
  });

  it("executes if_not_visible then branch when selector is NOT visible", async () => {
    // Visibility check fails => not visible => if_not_visible condition is true
    mockPage.waitForSelector.mockRejectedValueOnce(new Error("Timeout"));

    const flow: FlowDefinition = {
      name: "if-not-visible-then",
      steps: [
        {
          action: "if_not_visible",
          selector: ".content-loaded",
          then: [{ action: "navigate", url: "https://example.com/wait" }],
          else: [],
        },
      ],
    };

    const result = await runner.run(flow);

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].success).toBe(true);
    expect(mockPage.goto).toHaveBeenCalled();
  });

  it("executes if_not_visible else branch when selector IS visible", async () => {
    mockPage.waitForSelector.mockResolvedValue({});

    const flow: FlowDefinition = {
      name: "if-not-visible-else",
      steps: [
        {
          action: "if_not_visible",
          selector: ".content-loaded",
          then: [{ action: "navigate", url: "https://example.com/wait" }],
          else: [{ action: "screenshot", label: "content-loaded" }],
        },
      ],
    };

    const result = await runner.run(flow);

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].success).toBe(true);
    // navigate in then should NOT be called
    expect(mockPage.goto).not.toHaveBeenCalled();
    // screenshot in else should be called
    const screenshotWrite = mockSafeWriteFile.mock.calls.find(
      (call: unknown[]) => (call[0] as string).includes("content-loaded.png"),
    );
    expect(screenshotWrite).toBeDefined();
  });

  it("uses default 2s timeout for if_visible visibility check", async () => {
    mockPage.waitForSelector.mockResolvedValue({});

    const flow: FlowDefinition = {
      name: "if-visible-default-timeout",
      steps: [
        {
          action: "if_visible",
          selector: ".banner",
          then: [],
          else: [],
        },
      ],
    };

    await runner.run(flow);

    expect(mockPage.waitForSelector).toHaveBeenCalledWith(".banner", {
      visible: true,
      timeout: 2000,
    });
  });

  it("uses custom timeout for if_visible visibility check", async () => {
    mockPage.waitForSelector.mockResolvedValue({});

    const flow: FlowDefinition = {
      name: "if-visible-custom-timeout",
      steps: [
        {
          action: "if_visible",
          selector: ".banner",
          timeout: 5000,
          then: [],
          else: [],
        },
      ],
    };

    await runner.run(flow);

    expect(mockPage.waitForSelector).toHaveBeenCalledWith(".banner", {
      visible: true,
      timeout: 5000,
    });
  });

  it("handles if_visible with ref condition", async () => {
    mockResolveRef.mockReturnValue(42);

    const flow: FlowDefinition = {
      name: "if-visible-ref",
      steps: [
        {
          action: "if_visible",
          ref: "e1",
          then: [{ action: "click", ref: "e1" }],
          else: [],
        },
      ],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(true);
    expect(mockClickByBackendNodeId).toHaveBeenCalledWith(42, undefined);
  });

  it("handles if_visible with ref condition when ref is stale", async () => {
    mockResolveRef.mockReturnValue(undefined);

    const flow: FlowDefinition = {
      name: "if-visible-ref-stale",
      steps: [
        {
          action: "if_visible",
          ref: "e99",
          then: [{ action: "click", selector: ".fallback" }],
          else: [{ action: "navigate", url: "https://example.com" }],
        },
      ],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(true);
    // Stale ref means not visible => else branch
    expect(mockPage.click).not.toHaveBeenCalled();
    expect(mockPage.goto).toHaveBeenCalled();
  });

  it("handles if_visible with match condition", async () => {
    mockResolveMatch.mockResolvedValue({ ref: "e1", backendNodeId: 100, matchCount: 1 });

    const flow: FlowDefinition = {
      name: "if-visible-match",
      steps: [
        {
          action: "if_visible",
          match: { role: "dialog", name: "Cookie Consent" },
          then: [{ action: "click", match: { role: "button", name: "Accept" } }],
          else: [],
        },
      ],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(true);
    expect(mockClickByBackendNodeId).toHaveBeenCalledWith(100, undefined);
  });

  it("handles if_visible with match condition when no match found", async () => {
    // First resolveMatch call (condition check) fails
    mockResolveMatch.mockRejectedValueOnce(new Error("No match found"));

    const flow: FlowDefinition = {
      name: "if-visible-match-missing",
      steps: [
        {
          action: "if_visible",
          match: { role: "dialog" },
          then: [],
          else: [{ action: "navigate", url: "https://example.com" }],
        },
      ],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(true);
    expect(mockPage.goto).toHaveBeenCalled();
  });

  it("captures artifacts from nested steps normally", async () => {
    mockPage.waitForSelector.mockResolvedValue({});

    const flow: FlowDefinition = {
      name: "if-visible-artifacts",
      steps: [
        {
          action: "if_visible",
          selector: ".banner",
          then: [
            { action: "navigate", url: "https://example.com", label: "nav-inside-if" },
          ],
          else: [],
        },
      ],
    };

    const result = await runner.run(flow);

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].success).toBe(true);
  });

  it("continues flow after conditional step failure in nested steps", async () => {
    mockPage.waitForSelector.mockResolvedValue({});
    mockPage.goto.mockRejectedValueOnce(new Error("Navigation failed"));

    const flow: FlowDefinition = {
      name: "if-visible-nested-fail",
      steps: [
        {
          action: "if_visible",
          selector: ".banner",
          then: [
            { action: "navigate", url: "https://bad.example.com" },
          ],
          else: [],
        },
        { action: "navigate", url: "https://good.example.com" },
      ],
    };

    const result = await runner.run(flow);

    expect(result.steps).toHaveLength(2);
    // The if_visible step itself should report failure since a nested step failed
    expect(result.steps[0].success).toBe(false);
    // The second step should still execute (continue on error)
    expect(result.steps[1].success).toBe(true);
  });

  it("executes nested conditionals (depth 2)", async () => {
    // First visibility check: outer passes
    mockPage.waitForSelector
      .mockResolvedValueOnce({})   // outer if_visible check
      .mockResolvedValueOnce({})   // inner if_visible check
      .mockResolvedValueOnce({});  // waitForSelector for click

    const flow: FlowDefinition = {
      name: "nested-conditionals",
      steps: [
        {
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
        },
      ],
    };

    const result = await runner.run(flow);

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].success).toBe(true);
    expect(mockPage.click).toHaveBeenCalledWith(".inner .btn");
  });

  it("takes only 1 a11y snapshot when step has both match and label", async () => {
    const fakeSnapshot = { role: "WebArea", name: "Test" };
    mockPage.accessibility.snapshot.mockResolvedValue(fakeSnapshot);
    mockResolveMatch.mockResolvedValue({ ref: "e1", backendNodeId: 100, matchCount: 1 });

    const flow: FlowDefinition = {
      name: "cache-snapshot",
      steps: [{ action: "click", match: { role: "button", name: "Submit" }, label: "submit-click" }],
    };

    await runner.run(flow);

    // Only 1 snapshot call — cached and shared between resolveMatch and captureArtifacts
    expect(mockPage.accessibility.snapshot).toHaveBeenCalledTimes(1);
    // resolveMatch should receive the snapshot via options
    expect(mockResolveMatch).toHaveBeenCalledWith(
      { role: "button", name: "Submit" },
      { snapshot: fakeSnapshot },
    );
  });

  it("invalidates branch snapshot after a mutating step in conditional branch", async () => {
    const snapshot1 = { role: "WebArea", name: "Before" };
    const snapshot2 = { role: "WebArea", name: "After" };
    mockPage.accessibility.snapshot
      .mockResolvedValueOnce(snapshot1)   // initial branch snapshot
      .mockResolvedValueOnce(snapshot2);  // re-fetched after click invalidated cache
    mockResolveMatch.mockResolvedValue({ ref: "e1", backendNodeId: 100, matchCount: 1 });
    mockPage.waitForSelector.mockResolvedValue({});

    const flow: FlowDefinition = {
      name: "invalidate-branch-snapshot",
      steps: [
        {
          action: "if_visible",
          selector: ".banner",
          then: [
            // First match step uses cached snapshot1
            { action: "click", match: { role: "button", name: "Accept" } },
            // Second match step should get a fresh snapshot (snapshot2)
            // because the click above mutated the page
            { action: "click", match: { role: "button", name: "Continue" } },
          ],
          else: [],
        },
      ],
    };

    await runner.run(flow);

    // 2 snapshots: one for initial branch cache, one re-fetched after click
    expect(mockPage.accessibility.snapshot).toHaveBeenCalledTimes(2);
    // First match step gets snapshot1
    expect(mockResolveMatch).toHaveBeenNthCalledWith(1,
      { role: "button", name: "Accept" },
      { snapshot: snapshot1 },
    );
    // Second match step gets snapshot2 (fresh)
    expect(mockResolveMatch).toHaveBeenNthCalledWith(2,
      { role: "button", name: "Continue" },
      { snapshot: snapshot2 },
    );
  });
});

// ── Animation during recording ──────────────────────────────────────────

describe("animation during recording", () => {
  const runner = new FlowRunner();

  it("passes animate:true to click_at when recording is enabled", async () => {
    const flow: FlowDefinition = {
      name: "animate-click-at",
      recording: { enabled: true },
      steps: [{ action: "click_at", x: 100, y: 200 }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(true);
    expect(mockClickAtCoordinates).toHaveBeenCalledWith(100, 200, { animate: true });
  });

  it("passes animate:true to hover_at when recording is enabled", async () => {
    const flow: FlowDefinition = {
      name: "animate-hover-at",
      recording: { enabled: true },
      steps: [{ action: "hover_at", x: 300, y: 400 }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(true);
    expect(mockHoverAtCoordinates).toHaveBeenCalledWith(300, 400, { animate: true });
  });

  it("passes animate:true to clickByBackendNodeId when recording + match", async () => {
    mockResolveMatch.mockResolvedValue({ ref: "e1", backendNodeId: 50, matchCount: 1 });

    const flow: FlowDefinition = {
      name: "animate-click-match",
      recording: { enabled: true },
      steps: [{ action: "click", match: { role: "button", name: "Go" } }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(true);
    expect(mockClickByBackendNodeId).toHaveBeenCalledWith(50, { animate: true });
  });

  it("passes animate:true to hoverByBackendNodeId when recording + match", async () => {
    mockResolveMatch.mockResolvedValue({ ref: "e2", backendNodeId: 60, matchCount: 1 });

    const flow: FlowDefinition = {
      name: "animate-hover-match",
      recording: { enabled: true },
      steps: [{ action: "hover", match: { role: "menuitem", name: "Help" } }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(true);
    expect(mockHoverByBackendNodeId).toHaveBeenCalledWith(60, { animate: true });
  });

  it("per-step animate:false overrides recording default", async () => {
    const flow: FlowDefinition = {
      name: "animate-override-false",
      recording: { enabled: true },
      steps: [{ action: "click_at", x: 100, y: 200, animate: false }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(true);
    expect(mockClickAtCoordinates).toHaveBeenCalledWith(100, 200, undefined);
  });

  it("per-step animate:true enables animation without recording", async () => {
    const flow: FlowDefinition = {
      name: "animate-explicit-true",
      steps: [{ action: "click_at", x: 100, y: 200, animate: true }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(true);
    expect(mockClickAtCoordinates).toHaveBeenCalledWith(100, 200, { animate: true });
  });

  it("no animate option when recording is off and step has no animate field", async () => {
    const flow: FlowDefinition = {
      name: "no-animate-default",
      steps: [{ action: "click_at", x: 100, y: 200 }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(true);
    expect(mockClickAtCoordinates).toHaveBeenCalledWith(100, 200, undefined);
  });
});

// ── scroll_to_text steps ─────────────────────────────────────────────────

describe("scroll_to_text steps", () => {
  const runner = new FlowRunner();

  it("executes scroll_to_text step via page.evaluate", async () => {
    // page.evaluate returns true when text is found
    mockPage.evaluate.mockResolvedValueOnce(true);

    const flow: FlowDefinition = {
      name: "scroll-to-text-test",
      steps: [{ action: "scroll_to_text", text: "Insights Table" }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(true);
    expect(result.steps[0].action).toBe("scroll_to_text");
    expect(mockPage.evaluate).toHaveBeenCalled();
    // The evaluate call should receive the text string as an argument
    const callArgs = mockPage.evaluate.mock.calls[0];
    expect(callArgs[1]).toBe("insights table"); // case-insensitive: lowered
  });

  it("fails when text is not found on the page", async () => {
    // page.evaluate returns false when text is not found
    mockPage.evaluate.mockResolvedValueOnce(false);

    const flow: FlowDefinition = {
      name: "scroll-to-text-not-found",
      steps: [{ action: "scroll_to_text", text: "Nonexistent Section" }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(false);
    expect(result.steps[0].error).toContain("Nonexistent Section");
  });

  it("captures error when page.evaluate throws", async () => {
    mockPage.evaluate.mockRejectedValueOnce(new Error("Page context destroyed"));

    const flow: FlowDefinition = {
      name: "scroll-to-text-error",
      steps: [{ action: "scroll_to_text", text: "Some text" }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(false);
    expect(result.steps[0].error).toContain("Page context destroyed");
  });

  it("captures artifacts for labeled scroll_to_text step", async () => {
    mockPage.evaluate.mockResolvedValueOnce(true);

    const flow: FlowDefinition = {
      name: "scroll-to-text-labeled",
      steps: [{ action: "scroll_to_text", text: "Revenue", label: "find-revenue" }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(true);
    expect(result.steps[0].label).toBe("find-revenue");
    expect(result.steps[0].screenshotPath).toContain("find-revenue");
  });

  it("continues executing after scroll_to_text failure", async () => {
    mockPage.evaluate.mockResolvedValueOnce(false);

    const flow: FlowDefinition = {
      name: "scroll-to-text-continue",
      steps: [
        { action: "scroll_to_text", text: "Missing" },
        { action: "navigate", url: "https://example.com" },
      ],
    };

    const result = await runner.run(flow);

    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].success).toBe(false);
    expect(result.steps[1].success).toBe(true);
  });
});

// ── group steps ────────────────────────────────────────────────────────────

describe("group steps", () => {
  const runner = new FlowRunner();

  it("executes nested steps within a group", async () => {
    const flow: FlowDefinition = {
      name: "group-basic",
      steps: [
        {
          action: "group",
          name: "Filter Interactions",
          steps: [
            { action: "click", selector: "#filter" },
            { action: "sleep", duration: 100 },
          ],
        },
      ],
    };

    const result = await runner.run(flow);

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].success).toBe(true);
    expect(result.steps[0].action).toBe("group");
    expect(mockPage.click).toHaveBeenCalledWith("#filter");
  });

  it("marks group step as failed if any nested step fails", async () => {
    mockPage.click.mockRejectedValueOnce(new Error("Element not found"));

    const flow: FlowDefinition = {
      name: "group-nested-fail",
      steps: [
        {
          action: "group",
          name: "Failing Group",
          steps: [
            { action: "click", selector: ".nonexistent" },
            { action: "sleep", duration: 100 },
          ],
        },
        { action: "navigate", url: "https://example.com" },
      ],
    };

    const result = await runner.run(flow);

    expect(result.steps).toHaveLength(2);
    // Group step itself should report failure since a nested step failed
    expect(result.steps[0].success).toBe(false);
    // The second step should still execute (continue on error)
    expect(result.steps[1].success).toBe(true);
  });

  it("reports group name in step result label", async () => {
    const flow: FlowDefinition = {
      name: "group-with-label",
      steps: [
        {
          action: "group",
          name: "Setup Steps",
          label: "setup-section",
          steps: [{ action: "sleep", duration: 100 }],
        },
      ],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].label).toBe("setup-section");
  });

  it("executes nested groups (depth 2)", async () => {
    const flow: FlowDefinition = {
      name: "nested-groups",
      steps: [
        {
          action: "group",
          name: "Outer Group",
          steps: [
            {
              action: "group",
              name: "Inner Group",
              steps: [{ action: "click", selector: ".btn" }],
            },
          ],
        },
      ],
    };

    const result = await runner.run(flow);

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].success).toBe(true);
    expect(mockPage.click).toHaveBeenCalledWith(".btn");
  });

  it("continues flow after group step failure", async () => {
    mockPage.click.mockRejectedValueOnce(new Error("Click failed"));

    const flow: FlowDefinition = {
      name: "group-continue-after-fail",
      steps: [
        {
          action: "group",
          name: "Failing Group",
          steps: [{ action: "click", selector: ".bad" }],
        },
        { action: "sleep", duration: 100 },
      ],
    };

    const result = await runner.run(flow);

    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].success).toBe(false);
    expect(result.steps[1].success).toBe(true);
  });

  it("includes group name in manifest output", async () => {
    const flow: FlowDefinition = {
      name: "group-manifest",
      steps: [
        {
          action: "group",
          name: "Data Entry",
          steps: [{ action: "sleep", duration: 100 }],
        },
      ],
    };

    const result = await runner.run(flow);

    // Verify the manifest was written containing group info
    const manifestCall = mockSafeWriteFile.mock.calls.find(
      (call: unknown[]) => String(call[0]).includes("manifest.json"),
    );
    expect(manifestCall).toBeDefined();
    const manifest = JSON.parse(manifestCall![1] as string);
    expect(manifest.steps[0].action).toBe("group");
  });

  it("executes a group containing conditional steps", async () => {
    mockPage.waitForSelector.mockResolvedValue({});

    const flow: FlowDefinition = {
      name: "group-with-conditional",
      steps: [
        {
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
        },
      ],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(true);
    expect(mockPage.click).toHaveBeenCalledWith(".banner .dismiss");
  });
});

// ── section parameter ───────────────────────────────────────────────────────

describe("section parameter", () => {
  const runner = new FlowRunner();

  it("executes only the named group when section is provided", async () => {
    const flow: FlowDefinition = {
      name: "section-filter",
      steps: [
        {
          action: "group",
          name: "Setup",
          steps: [{ action: "navigate", url: "https://setup.example.com" }],
        },
        {
          action: "group",
          name: "Teardown",
          steps: [{ action: "navigate", url: "https://teardown.example.com" }],
        },
      ],
    };

    const result = await runner.run(flow, undefined, "Teardown");

    // Only the Teardown group should execute
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].action).toBe("group");
    expect(result.steps[0].success).toBe(true);
    // Navigate to teardown URL should be called, but NOT setup URL
    expect(mockPage.goto).toHaveBeenCalledTimes(1);
    expect(mockPage.goto).toHaveBeenCalledWith("https://teardown.example.com/", expect.anything());
  });

  it("throws when section name is not found", async () => {
    const flow: FlowDefinition = {
      name: "section-not-found",
      steps: [
        {
          action: "group",
          name: "Only Group",
          steps: [{ action: "sleep", duration: 100 }],
        },
      ],
    };

    await expect(runner.run(flow, undefined, "Nonexistent")).rejects.toThrow(
      'Section "Nonexistent" not found in flow "section-not-found".',
    );
  });
});
