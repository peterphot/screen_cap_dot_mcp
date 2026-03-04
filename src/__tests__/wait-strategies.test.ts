/**
 * Unit tests for wait-strategies utility (src/util/wait-strategies.ts)
 *
 * Tests the smartWait() function which:
 * - Uses ARIA-based selectors for loading indicator detection
 * - Short-circuits when no loading indicator is present (fast path)
 * - Waits for loading indicators to disappear when found
 * - Waits for network idle
 * - Measures and reports elapsed time
 * - Uses a 500ms probe timeout (not 2000ms)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TimeoutError } from "puppeteer-core";

// ── Mock Setup ──────────────────────────────────────────────────────────

const mockDollar = vi.fn();
const mockWaitForSelector = vi.fn();
const mockWaitForNetworkIdle = vi.fn();

const mockPage = {
  $: mockDollar,
  waitForSelector: mockWaitForSelector,
  waitForNetworkIdle: mockWaitForNetworkIdle,
};

// Mock the logger module
const mockLoggerInfo = vi.fn();
const mockLoggerWarn = vi.fn();
const mockLoggerDebug = vi.fn();

vi.mock("../util/logger.js", () => ({
  default: {
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    debug: (...args: unknown[]) => mockLoggerDebug(...args),
    error: vi.fn(),
    setLogLevel: vi.fn(),
  },
}));

// ── Expected selector ────────────────────────────────────────────────────

/**
 * The combined ARIA + generic selector that smartWait() should use.
 * This must match the implementation exactly.
 */
const EXPECTED_LOADING_SELECTOR = [
  '[role="progressbar"]',
  '[aria-busy="true"]',
  '[aria-label*="loading" i]',
  '[aria-label*="spinner" i]',
  '[class*="skeleton" i]',
  '[class*="loading" i]',
  '[class*="spinner" i]',
].join(", ");

// ── Setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockDollar.mockResolvedValue(null); // default: no loading indicator
  mockWaitForSelector.mockResolvedValue(undefined);
  mockWaitForNetworkIdle.mockResolvedValue(undefined);
});

// ── Tests ───────────────────────────────────────────────────────────────

describe("smartWait", () => {
  // ── ARIA selector tests ─────────────────────────────────────────────

  it("uses ARIA-based combined selector for the quick probe", async () => {
    const { smartWait } = await import("../util/wait-strategies.js");
    await smartWait(mockPage as any);

    expect(mockDollar).toHaveBeenCalledWith(EXPECTED_LOADING_SELECTOR);
  });

  it("does NOT use framework-specific selectors (MUI, Ant Design)", async () => {
    mockDollar.mockResolvedValue({ some: "element" }); // loading indicator found
    const { smartWait } = await import("../util/wait-strategies.js");
    await smartWait(mockPage as any);

    // Check that no MUI or Ant Design selectors are used anywhere
    const allCalls = [
      ...mockDollar.mock.calls.map((c) => c[0]),
      ...mockWaitForSelector.mock.calls.map((c) => c[0]),
    ];
    for (const sel of allCalls) {
      expect(sel).not.toContain(".MuiLinearProgress-root");
      expect(sel).not.toContain(".MuiCircularProgress-root");
      expect(sel).not.toContain(".ant-spin");
      expect(sel).not.toContain(".ant-skeleton");
    }
  });

  it("includes aria-busy and aria-label selectors", async () => {
    const { smartWait } = await import("../util/wait-strategies.js");
    await smartWait(mockPage as any);

    const probeSelector = mockDollar.mock.calls[0][0];
    expect(probeSelector).toContain('[aria-busy="true"]');
    expect(probeSelector).toContain('[aria-label*="loading" i]');
    expect(probeSelector).toContain('[aria-label*="spinner" i]');
  });

  // ── Short-circuit tests ─────────────────────────────────────────────

  it("short-circuits when no loading indicator is present (fast path)", async () => {
    mockDollar.mockResolvedValue(null); // no loading indicator

    const { smartWait } = await import("../util/wait-strategies.js");
    await smartWait(mockPage as any);

    // Should NOT call waitForSelector (skips waiting for disappearance)
    expect(mockWaitForSelector).not.toHaveBeenCalled();

    // Should still wait for network idle
    expect(mockWaitForNetworkIdle).toHaveBeenCalled();
  });

  it("waits for loading indicator to disappear when one is found", async () => {
    mockDollar.mockResolvedValue({ some: "element" }); // loading indicator found

    const { smartWait } = await import("../util/wait-strategies.js");
    await smartWait(mockPage as any);

    // Should call waitForSelector with hidden: true to wait for disappearance
    expect(mockWaitForSelector).toHaveBeenCalledWith(
      EXPECTED_LOADING_SELECTOR,
      expect.objectContaining({ hidden: true }),
    );

    // Should also wait for network idle
    expect(mockWaitForNetworkIdle).toHaveBeenCalled();
  });

  // ── Timeout tests ───────────────────────────────────────────────────

  it("uses 500ms probe timeout (not 2000ms) when loading indicator found", async () => {
    mockDollar.mockResolvedValue({ some: "element" }); // loading indicator found

    const { smartWait } = await import("../util/wait-strategies.js");
    await smartWait(mockPage as any);

    // waitForSelector should use the 500ms probe timeout
    expect(mockWaitForSelector).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeout: 500 }),
    );
  });

  it("uses overall timeout for network idle", async () => {
    const { smartWait } = await import("../util/wait-strategies.js");
    await smartWait(mockPage as any);

    expect(mockWaitForNetworkIdle).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 30000 }),
    );
  });

  it("accepts a custom timeout", async () => {
    mockDollar.mockResolvedValue({ some: "element" }); // loading indicator found

    const { smartWait } = await import("../util/wait-strategies.js");
    await smartWait(mockPage as any, 5000);

    // Selector probe timeout is min(500, 5000) = 500
    expect(mockWaitForSelector).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeout: 500 }),
    );
    expect(mockWaitForNetworkIdle).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 5000 }),
    );
  });

  it("caps selector probe timeout to overall timeout when it is smaller", async () => {
    mockDollar.mockResolvedValue({ some: "element" }); // loading indicator found

    const { smartWait } = await import("../util/wait-strategies.js");
    await smartWait(mockPage as any, 200);

    // Selector probe timeout is min(500, 200) = 200
    expect(mockWaitForSelector).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeout: 200 }),
    );
  });

  // ── Network idle tests ──────────────────────────────────────────────

  it("waits for network idle after checking indicators", async () => {
    const { smartWait } = await import("../util/wait-strategies.js");
    await smartWait(mockPage as any);

    expect(mockWaitForNetworkIdle).toHaveBeenCalledWith(
      expect.objectContaining({ idleTime: 500 }),
    );
  });

  // ── Error handling tests ────────────────────────────────────────────

  it("swallows TimeoutError when waiting for indicator to disappear", async () => {
    mockDollar.mockResolvedValue({ some: "element" }); // loading indicator found
    mockWaitForSelector.mockRejectedValue(new TimeoutError("Timeout exceeded"));

    const { smartWait } = await import("../util/wait-strategies.js");

    // Should not throw — TimeoutError instances are swallowed
    await expect(smartWait(mockPage as any)).resolves.not.toThrow();
  });

  it("does NOT swallow a regular Error with 'Timeout' in the message", async () => {
    mockDollar.mockResolvedValue({ some: "element" }); // loading indicator found
    mockWaitForSelector.mockRejectedValue(new Error("Timeout exceeded"));

    const { smartWait } = await import("../util/wait-strategies.js");

    // A plain Error is not a TimeoutError, so it should be thrown
    await expect(smartWait(mockPage as any)).rejects.toThrow("Timeout exceeded");
  });

  it("returns elapsed time in milliseconds", async () => {
    const { smartWait } = await import("../util/wait-strategies.js");
    const result = await smartWait(mockPage as any);

    expect(result).toHaveProperty("elapsedMs");
    expect(typeof result.elapsedMs).toBe("number");
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("logs progress via logger", async () => {
    const { smartWait } = await import("../util/wait-strategies.js");
    await smartWait(mockPage as any);

    // Should log at least start and completion
    expect(mockLoggerInfo).toHaveBeenCalled();
  });

  it("propagates non-timeout errors from waitForSelector", async () => {
    mockDollar.mockResolvedValue({ some: "element" }); // loading indicator found
    mockWaitForSelector.mockRejectedValue(
      new Error("Execution context was destroyed"),
    );

    const { smartWait } = await import("../util/wait-strategies.js");

    await expect(smartWait(mockPage as any)).rejects.toThrow(
      "Execution context was destroyed",
    );
  });

  it("propagates non-timeout errors from network idle", async () => {
    mockWaitForNetworkIdle.mockRejectedValue(new Error("Page crashed"));

    const { smartWait } = await import("../util/wait-strategies.js");

    await expect(smartWait(mockPage as any)).rejects.toThrow("Page crashed");
  });

  it("propagates errors from the quick probe (page.$)", async () => {
    mockDollar.mockRejectedValue(
      new Error("Execution context was destroyed"),
    );

    const { smartWait } = await import("../util/wait-strategies.js");

    await expect(smartWait(mockPage as any)).rejects.toThrow(
      "Execution context was destroyed",
    );
  });
});
