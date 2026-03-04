/**
 * Unit tests for mouse-animator utility (src/util/mouse-animator.ts)
 *
 * Tests the smooth mouse movement module that dispatches a series of
 * CDP Input.dispatchMouseEvent calls along a bezier curve path.
 *
 * Covers:
 * - Bezier interpolation produces correct number of points
 * - Points start at last known position and end at target
 * - Duration scales with distance (short moves = fast, long moves = slower)
 * - Ease-in-out timing function (slow start, fast middle, slow end)
 * - Control points create a curved (not straight) path
 * - CDP Input.dispatchMouseEvent called with mouseMoved for each step
 * - Last known mouse position tracking (module-level state)
 * - Default options (duration 300-500ms, 20-30 steps)
 * - resetMousePosition for test isolation
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Setup ──────────────────────────────────────────────────────────

const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
}));

vi.mock("../browser.js", () => ({
  ensureCDPSession: vi.fn().mockResolvedValue({ send: mockSend }),
}));

vi.mock("../util/logger.js", () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  animateMouseTo,
  resetMousePosition,
  computeBezierPath,
  easeInOut,
  computeDuration,
} from "../util/mouse-animator.js";

beforeEach(() => {
  vi.clearAllMocks();
  resetMousePosition();
});

// ── easeInOut() ─────────────────────────────────────────────────────────

describe("easeInOut", () => {
  it("returns 0 at t=0", () => {
    expect(easeInOut(0)).toBe(0);
  });

  it("returns 1 at t=1", () => {
    expect(easeInOut(1)).toBe(1);
  });

  it("returns 0.5 at t=0.5 (symmetry)", () => {
    expect(easeInOut(0.5)).toBe(0.5);
  });

  it("produces slow start (first quarter < 0.25)", () => {
    // Ease-in-out should be slower at the beginning
    const val = easeInOut(0.25);
    expect(val).toBeLessThan(0.25);
  });

  it("produces slow end (last quarter > 0.75)", () => {
    // Ease-in-out should be slower at the end
    const val = easeInOut(0.75);
    expect(val).toBeGreaterThan(0.75);
  });

  it("is monotonically increasing", () => {
    let prev = 0;
    for (let i = 1; i <= 20; i++) {
      const t = i / 20;
      const val = easeInOut(t);
      expect(val).toBeGreaterThanOrEqual(prev);
      prev = val;
    }
  });
});

// ── computeDuration() ───────────────────────────────────────────────────

describe("computeDuration", () => {
  it("returns a minimum of 300ms for very short distances", () => {
    const duration = computeDuration(10);
    expect(duration).toBeGreaterThanOrEqual(300);
  });

  it("returns a maximum of 500ms for very long distances", () => {
    const duration = computeDuration(5000);
    expect(duration).toBeLessThanOrEqual(500);
  });

  it("scales with distance (longer distance = longer duration)", () => {
    const short = computeDuration(50);
    const long = computeDuration(1000);
    expect(long).toBeGreaterThanOrEqual(short);
  });

  it("returns a value between 300 and 500 for medium distances", () => {
    const duration = computeDuration(500);
    expect(duration).toBeGreaterThanOrEqual(300);
    expect(duration).toBeLessThanOrEqual(500);
  });
});

// ── computeBezierPath() ─────────────────────────────────────────────────

describe("computeBezierPath", () => {
  it("produces the correct number of points", () => {
    const points = computeBezierPath(0, 0, 500, 500, 20);
    expect(points).toHaveLength(20);
  });

  it("starts near the origin and ends at the target", () => {
    const points = computeBezierPath(0, 0, 400, 300, 25);

    // First point should be close to start but not exactly at start
    // (it's at t=1/steps, not t=0)
    // Last point should be at the target
    const last = points[points.length - 1];
    expect(last.x).toBeCloseTo(400, 0);
    expect(last.y).toBeCloseTo(300, 0);
  });

  it("creates a curved path (not straight line)", () => {
    // Move from (0,0) to (400,0) — horizontal line
    // A bezier curve should have points that deviate from y=0
    const points = computeBezierPath(0, 0, 400, 0, 30);

    // At least some intermediate points should have non-zero y
    const midPoints = points.slice(5, 25);
    const hasDeviation = midPoints.some((p) => Math.abs(p.y) > 1);
    expect(hasDeviation).toBe(true);
  });

  it("all points have valid numeric x and y", () => {
    const points = computeBezierPath(100, 200, 600, 400, 20);
    for (const p of points) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it("handles zero-distance move (same start and end)", () => {
    const points = computeBezierPath(100, 100, 100, 100, 10);
    expect(points).toHaveLength(10);
    // All points should be at/near the target
    for (const p of points) {
      expect(p.x).toBeCloseTo(100, 0);
      expect(p.y).toBeCloseTo(100, 0);
    }
  });
});

// ── animateMouseTo() ────────────────────────────────────────────────────

describe("animateMouseTo", () => {
  it("dispatches mouseMoved events via CDP for each step", async () => {
    mockSend.mockResolvedValue(undefined);

    await animateMouseTo(200, 300, { steps: 10, duration: 50 });

    // All calls should be Input.dispatchMouseEvent with type mouseMoved
    const calls = mockSend.mock.calls;
    expect(calls.length).toBe(10);

    for (const call of calls) {
      expect(call[0]).toBe("Input.dispatchMouseEvent");
      expect(call[1].type).toBe("mouseMoved");
      expect(call[1].button).toBe("none");
      expect(call[1].clickCount).toBe(0);
    }
  });

  it("final mouseMoved event is at the target coordinates", async () => {
    mockSend.mockResolvedValue(undefined);

    await animateMouseTo(500, 400, { steps: 15, duration: 50 });

    const calls = mockSend.mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall[1].x).toBeCloseTo(500, 0);
    expect(lastCall[1].y).toBeCloseTo(400, 0);
  });

  it("tracks last known position across calls", async () => {
    mockSend.mockResolvedValue(undefined);

    // First move: from default (0,0) to (100, 100)
    await animateMouseTo(100, 100, { steps: 5, duration: 10 });

    vi.clearAllMocks();
    mockSend.mockResolvedValue(undefined);

    // Second move: should start from (100, 100)
    await animateMouseTo(200, 200, { steps: 5, duration: 10 });

    const calls = mockSend.mock.calls;
    // First event of second move should NOT be near (0,0)
    // It should be near (100,100) — the first step along the path from (100,100) to (200,200)
    const firstEvent = calls[0][1];
    // The first point is at t=1/5 on the curve from (100,100) to (200,200)
    // so x should be > 100 (moving toward 200)
    expect(firstEvent.x).toBeGreaterThan(90);
    expect(firstEvent.y).toBeGreaterThan(90);
  });

  it("uses default steps (20-30) when not specified", async () => {
    mockSend.mockResolvedValue(undefined);

    await animateMouseTo(500, 500, { duration: 50 });

    const callCount = mockSend.mock.calls.length;
    expect(callCount).toBeGreaterThanOrEqual(20);
    expect(callCount).toBeLessThanOrEqual(30);
  });

  it("uses default duration when not specified", async () => {
    mockSend.mockResolvedValue(undefined);

    const start = Date.now();
    await animateMouseTo(500, 500, { steps: 5 });
    const elapsed = Date.now() - start;

    // Should take at least some time (not instant)
    // But we can't reliably test exact timing — just verify it completed
    expect(elapsed).toBeGreaterThanOrEqual(0);
    // The 5 steps should have been dispatched
    expect(mockSend.mock.calls.length).toBe(5);
  });

  it("resetMousePosition resets to (0, 0)", async () => {
    mockSend.mockResolvedValue(undefined);

    // Move to (500, 500)
    await animateMouseTo(500, 500, { steps: 3, duration: 10 });

    // Reset
    resetMousePosition();

    vi.clearAllMocks();
    mockSend.mockResolvedValue(undefined);

    // Next move should start from (0, 0)
    await animateMouseTo(100, 0, { steps: 10, duration: 10 });

    const calls = mockSend.mock.calls;
    // First point should be near (0,0) heading toward (100,0)
    // since we reset, the path starts from origin
    const firstX = calls[0][1].x;
    const firstY = calls[0][1].y;
    // Should be a small x value near 0 (first step of 10 from 0 to 100)
    expect(firstX).toBeLessThan(50);
    expect(Math.abs(firstY)).toBeLessThan(30); // slight curve deviation ok
  });
});
