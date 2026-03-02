/**
 * Unit tests for wait-strategies utility (src/util/wait-strategies.ts)
 *
 * Tests the smartWait() function which:
 * - Checks for common loading indicators and waits for them to disappear
 * - Waits for network idle
 * - Measures and reports elapsed time
 * - Swallows timeout errors on individual selectors
 * - Logs progress via the logger
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Setup ──────────────────────────────────────────────────────────

const mockWaitForSelector = vi.fn();
const mockWaitForNetworkIdle = vi.fn();

const mockPage = {
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

// ── Setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockWaitForSelector.mockResolvedValue(undefined);
  mockWaitForNetworkIdle.mockResolvedValue(undefined);
});

// ── Tests ───────────────────────────────────────────────────────────────

describe("smartWait", () => {
  it("checks all common loading indicator selectors", async () => {
    const { smartWait } = await import("../util/wait-strategies.js");
    await smartWait(mockPage as any);

    // Should check all loading indicator selectors with hidden: true
    const expectedSelectors = [
      '[role="progressbar"]',
      ".MuiLinearProgress-root, .MuiCircularProgress-root",
      '[class*="skeleton"], [class*="Skeleton"]',
      '[class*="loading"], [class*="Loading"]',
      '[class*="spinner"], [class*="Spinner"]',
      ".ant-spin, .ant-skeleton",
    ];

    for (const selector of expectedSelectors) {
      expect(mockWaitForSelector).toHaveBeenCalledWith(
        selector,
        expect.objectContaining({ hidden: true }),
      );
    }
  });

  it("waits for network idle after checking indicators", async () => {
    const { smartWait } = await import("../util/wait-strategies.js");
    await smartWait(mockPage as any);

    expect(mockWaitForNetworkIdle).toHaveBeenCalledWith(
      expect.objectContaining({ idleTime: 500 }),
    );
  });

  it("uses default timeout of 30000ms", async () => {
    const { smartWait } = await import("../util/wait-strategies.js");
    await smartWait(mockPage as any);

    // Each waitForSelector call should receive the default timeout
    expect(mockWaitForSelector).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeout: 30000 }),
    );
    expect(mockWaitForNetworkIdle).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 30000 }),
    );
  });

  it("accepts a custom timeout", async () => {
    const { smartWait } = await import("../util/wait-strategies.js");
    await smartWait(mockPage as any, 5000);

    expect(mockWaitForSelector).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeout: 5000 }),
    );
    expect(mockWaitForNetworkIdle).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 5000 }),
    );
  });

  it("swallows timeout errors on individual selectors", async () => {
    // Some selectors timeout (element doesn't exist on page), which is fine
    mockWaitForSelector
      .mockRejectedValueOnce(new Error("Timeout exceeded"))
      .mockResolvedValue(undefined);

    const { smartWait } = await import("../util/wait-strategies.js");

    // Should not throw
    await expect(smartWait(mockPage as any)).resolves.not.toThrow();
  });

  it("swallows all selector timeout errors (none of the indicators exist)", async () => {
    mockWaitForSelector.mockRejectedValue(new Error("Timeout exceeded"));

    const { smartWait } = await import("../util/wait-strategies.js");

    // Should not throw even if all selectors timeout
    await expect(smartWait(mockPage as any)).resolves.not.toThrow();
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

  it("propagates non-timeout errors from network idle", async () => {
    mockWaitForNetworkIdle.mockRejectedValue(new Error("Page crashed"));

    const { smartWait } = await import("../util/wait-strategies.js");

    await expect(smartWait(mockPage as any)).rejects.toThrow("Page crashed");
  });
});
