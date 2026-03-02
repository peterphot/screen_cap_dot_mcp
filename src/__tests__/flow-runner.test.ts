/**
 * Unit tests for FlowRunner (src/flow/runner.ts)
 *
 * All browser module interactions are mocked. These tests verify:
 * - FlowRunner executes all step types correctly
 * - Output directory is created with timestamped name
 * - Recording starts/stops when flow config enables it
 * - Labeled steps get screenshot + a11y artifacts
 * - Failing steps don't abort the flow (continue on error)
 * - Error screenshots are captured on step failure
 * - Manifest.json is written with results
 * - recordOverride works
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { FlowRunner } from "../flow/runner.js";
import type { FlowDefinition } from "../flow/schema.js";

// ── Mock Setup ──────────────────────────────────────────────────────────

const mockEnsurePage = vi.fn();

vi.mock("../browser.js", () => ({
  ensurePage: (...args: unknown[]) => mockEnsurePage(...args),
}));

const mockSmartWait = vi.fn();

vi.mock("../util/wait-strategies.js", () => ({
  smartWait: (...args: unknown[]) => mockSmartWait(...args),
}));

const mockWriteFile = vi.fn();
const mockMkdir = vi.fn();

vi.mock("node:fs/promises", () => ({
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
}));

vi.mock("../util/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    setLogLevel: vi.fn(),
  },
}));

// ── Mock page ────────────────────────────────────────────────────────────

interface MockPage {
  goto: ReturnType<typeof vi.fn>;
  click: ReturnType<typeof vi.fn>;
  type: ReturnType<typeof vi.fn>;
  screenshot: ReturnType<typeof vi.fn>;
  evaluate: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  waitForSelector: ReturnType<typeof vi.fn>;
  waitForNetworkIdle: ReturnType<typeof vi.fn>;
  waitForFunction: ReturnType<typeof vi.fn>;
  $: ReturnType<typeof vi.fn>;
  screencast: ReturnType<typeof vi.fn>;
  accessibility: { snapshot: ReturnType<typeof vi.fn> };
}

let mockPage: MockPage;
let mockRecorder: { stop: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();

  mockRecorder = { stop: vi.fn() };

  mockPage = {
    goto: vi.fn(),
    click: vi.fn(),
    type: vi.fn(),
    screenshot: vi.fn().mockResolvedValue(Buffer.from("fake-png")),
    evaluate: vi.fn(),
    select: vi.fn(),
    waitForSelector: vi.fn(),
    waitForNetworkIdle: vi.fn(),
    waitForFunction: vi.fn(),
    $: vi.fn(),
    screencast: vi.fn().mockResolvedValue(mockRecorder),
    accessibility: { snapshot: vi.fn().mockResolvedValue({ role: "WebArea" }) },
  };

  mockEnsurePage.mockResolvedValue(mockPage);
  mockSmartWait.mockResolvedValue({ elapsedMs: 100 });
  mockWriteFile.mockResolvedValue(undefined);
  mockMkdir.mockResolvedValue(undefined);
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
    expect(mockPage.goto).toHaveBeenCalledWith("https://example.com", {
      waitUntil: "load",
      timeout: 60000,
    });
  });

  it("creates timestamped output directory", async () => {
    const flow: FlowDefinition = {
      name: "test flow",
      steps: [{ action: "navigate", url: "https://example.com" }],
    };

    const result = await runner.run(flow);

    expect(result.outputDir).toMatch(/^output\/test_flow-\d{4}-\d{2}-\d{2}T/);
    expect(mockMkdir).toHaveBeenCalledWith(result.outputDir, { recursive: true });
  });

  it("writes manifest.json at end of flow", async () => {
    const flow: FlowDefinition = {
      name: "manifest-test",
      steps: [{ action: "navigate", url: "https://example.com" }],
    };

    const result = await runner.run(flow);

    expect(result.manifestPath).toContain("manifest.json");
    const manifestCall = mockWriteFile.mock.calls.find(
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
  });

  it("does not record when recording is disabled", async () => {
    const flow: FlowDefinition = {
      name: "no-record",
      recording: { enabled: false },
      steps: [{ action: "navigate", url: "https://example.com" }],
    };

    await runner.run(flow);

    expect(mockPage.screencast).not.toHaveBeenCalled();
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

  it("executes wait/function step", async () => {
    const flow: FlowDefinition = {
      name: "wait-fn",
      steps: [{ action: "wait", strategy: "function", function: "() => true" }],
    };

    await runner.run(flow);

    expect(mockPage.waitForFunction).toHaveBeenCalledWith("() => true", { timeout: 30000 });
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
    const writeCall = mockWriteFile.mock.calls.find(
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
    const writeCall = mockWriteFile.mock.calls.find(
      (call: unknown[]) => (call[0] as string).includes("page-structure.json"),
    );
    expect(writeCall).toBeDefined();
  });

  it("executes evaluate step", async () => {
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

  it("wait/selector throws when selector field is missing", async () => {
    const flow: FlowDefinition = {
      name: "wait-no-selector",
      steps: [{ action: "wait", strategy: "selector" }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(false);
    expect(result.steps[0].error).toContain("requires a selector");
  });

  it("wait/function throws when function field is missing", async () => {
    const flow: FlowDefinition = {
      name: "wait-no-fn",
      steps: [{ action: "wait", strategy: "function" }],
    };

    const result = await runner.run(flow);

    expect(result.steps[0].success).toBe(false);
    expect(result.steps[0].error).toContain("requires a function");
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
});
