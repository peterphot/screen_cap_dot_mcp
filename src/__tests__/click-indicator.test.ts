/**
 * Unit tests for click-indicator utility (src/util/click-indicator.ts)
 *
 * Tests the visual overlay injection module that creates temporary
 * CSS-animated indicators at click/hover coordinates during recordings.
 *
 * Covers:
 * - showClickIndicator calls page.evaluate with type="click" and duration=400
 * - showHoverIndicator calls page.evaluate with type="hover" and duration=300
 * - Both functions call ensurePage() internally
 * - Coordinates are passed through to the evaluate function
 * - Errors from page.evaluate are silently swallowed
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Setup ──────────────────────────────────────────────────────────

const { mockEvaluate } = vi.hoisted(() => ({
  mockEvaluate: vi.fn(),
}));

vi.mock("../browser.js", () => ({
  ensurePage: vi.fn().mockResolvedValue({ evaluate: mockEvaluate }),
}));

vi.mock("../util/logger.js", () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { showClickIndicator, showHoverIndicator } from "../util/click-indicator.js";
import { ensurePage } from "../browser.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockEvaluate.mockResolvedValue(undefined);
});

// ── showClickIndicator ──────────────────────────────────────────────────

describe("showClickIndicator", () => {
  it("calls page.evaluate with fn, x, y, type='click', duration=400", async () => {
    await showClickIndicator(150, 300);

    expect(ensurePage).toHaveBeenCalledTimes(1);
    expect(mockEvaluate).toHaveBeenCalledTimes(1);
    const [fn, argX, argY, argType, argDuration] = mockEvaluate.mock.calls[0];
    expect(typeof fn).toBe("function");
    expect(argX).toBe(150);
    expect(argY).toBe(300);
    expect(argType).toBe("click");
    expect(argDuration).toBe(400);
  });

  it("returns a resolved promise", async () => {
    const result = showClickIndicator(100, 200);
    await expect(result).resolves.toBeUndefined();
  });

  it("swallows errors from page.evaluate", async () => {
    mockEvaluate.mockRejectedValue(new Error("page crashed"));
    await expect(showClickIndicator(100, 200)).resolves.toBeUndefined();
  });

  it("swallows errors from ensurePage", async () => {
    (ensurePage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("no browser"));
    await expect(showClickIndicator(100, 200)).resolves.toBeUndefined();
  });
});

// ── showHoverIndicator ──────────────────────────────────────────────────

describe("showHoverIndicator", () => {
  it("calls page.evaluate with fn, x, y, type='hover', duration=300", async () => {
    await showHoverIndicator(250, 400);

    expect(ensurePage).toHaveBeenCalledTimes(1);
    expect(mockEvaluate).toHaveBeenCalledTimes(1);
    const [fn, argX, argY, argType, argDuration] = mockEvaluate.mock.calls[0];
    expect(typeof fn).toBe("function");
    expect(argX).toBe(250);
    expect(argY).toBe(400);
    expect(argType).toBe("hover");
    expect(argDuration).toBe(300);
  });

  it("returns a resolved promise", async () => {
    const result = showHoverIndicator(100, 200);
    await expect(result).resolves.toBeUndefined();
  });

  it("swallows errors from page.evaluate", async () => {
    mockEvaluate.mockRejectedValue(new Error("page crashed"));
    await expect(showHoverIndicator(100, 200)).resolves.toBeUndefined();
  });

  it("swallows errors from ensurePage", async () => {
    (ensurePage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("no browser"));
    await expect(showHoverIndicator(100, 200)).resolves.toBeUndefined();
  });
});
