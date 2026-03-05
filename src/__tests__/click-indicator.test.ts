/**
 * Unit tests for click-indicator utility (src/util/click-indicator.ts)
 *
 * Tests the visual overlay injection module that creates temporary
 * CSS-animated indicators at click/hover coordinates during recordings.
 *
 * Covers:
 * - showClickIndicator calls page.evaluate() with correct coordinates
 * - showHoverIndicator calls page.evaluate() with correct coordinates
 * - Both return resolved promises
 * - Coordinates are passed through to the evaluate function
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { showClickIndicator, showHoverIndicator } from "../util/click-indicator.js";

// ── Mock Setup ──────────────────────────────────────────────────────────

let mockPage: { evaluate: ReturnType<typeof vi.fn> };

beforeEach(() => {
  mockPage = {
    evaluate: vi.fn().mockResolvedValue(undefined),
  };
});

// ── showClickIndicator ──────────────────────────────────────────────────

describe("showClickIndicator", () => {
  it("calls page.evaluate()", async () => {
    await showClickIndicator(mockPage, 100, 200);

    expect(mockPage.evaluate).toHaveBeenCalledTimes(1);
  });

  it("passes coordinates to page.evaluate()", async () => {
    await showClickIndicator(mockPage, 150, 300);

    const call = mockPage.evaluate.mock.calls[0];
    // page.evaluate(fn, arg1, arg2) — coordinates should be passed as arguments
    expect(call.length).toBeGreaterThanOrEqual(2);
    // The coordinates should appear in the arguments after the function
    // Depending on implementation, they may be passed as separate args or an object
    const args = call.slice(1);
    // Flatten to check both coordinates are present somewhere in the args
    const argStr = JSON.stringify(args);
    expect(argStr).toContain("150");
    expect(argStr).toContain("300");
  });

  it("returns a resolved promise", async () => {
    const result = showClickIndicator(mockPage, 100, 200);
    await expect(result).resolves.toBeUndefined();
  });

  it("passes different coordinates correctly", async () => {
    await showClickIndicator(mockPage, 500, 750);

    const call = mockPage.evaluate.mock.calls[0];
    const args = call.slice(1);
    const argStr = JSON.stringify(args);
    expect(argStr).toContain("500");
    expect(argStr).toContain("750");
  });
});

// ── showHoverIndicator ──────────────────────────────────────────────────

describe("showHoverIndicator", () => {
  it("calls page.evaluate()", async () => {
    await showHoverIndicator(mockPage, 100, 200);

    expect(mockPage.evaluate).toHaveBeenCalledTimes(1);
  });

  it("passes coordinates to page.evaluate()", async () => {
    await showHoverIndicator(mockPage, 250, 400);

    const call = mockPage.evaluate.mock.calls[0];
    const args = call.slice(1);
    const argStr = JSON.stringify(args);
    expect(argStr).toContain("250");
    expect(argStr).toContain("400");
  });

  it("returns a resolved promise", async () => {
    const result = showHoverIndicator(mockPage, 100, 200);
    await expect(result).resolves.toBeUndefined();
  });

  it("passes different coordinates correctly", async () => {
    await showHoverIndicator(mockPage, 800, 600);

    const call = mockPage.evaluate.mock.calls[0];
    const args = call.slice(1);
    const argStr = JSON.stringify(args);
    expect(argStr).toContain("800");
    expect(argStr).toContain("600");
  });
});
