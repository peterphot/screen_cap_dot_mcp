/**
 * Mouse Animator — Smooth cursor movement along bezier curves.
 *
 * Dispatches a series of CDP Input.dispatchMouseEvent (mouseMoved) calls
 * along a cubic bezier curve path, creating natural-looking mouse movement
 * for demo recordings. The curve uses control points offset perpendicular
 * to the movement direction for a gentle arc.
 *
 * Key design decisions:
 * - Module-level state tracks last known mouse position
 * - Duration scales linearly with distance (clamped 300-500ms)
 * - Ease-in-out timing gives acceleration/deceleration feel
 * - Control points create a slight arc perpendicular to the path
 * - Default 25 steps balances smoothness and performance
 */

import { ensureCDPSession } from "../browser.js";

/** Maximum perpendicular arc offset in pixels, prevents excessive curvature on long moves. */
const MAX_ARC_OFFSET_PX = 60;

// ── Module-level state ──────────────────────────────────────────────────

// Single-cursor assumption: tied to the single-browser-session architecture.
// Not safe for concurrent use across multiple callers.
let lastX = 0;
let lastY = 0;

// ── Public helpers (exported for testing) ───────────────────────────────

/**
 * Reset the tracked mouse position to (0, 0).
 * Used for test isolation.
 */
export function resetMousePosition(): void {
  lastX = 0;
  lastY = 0;
}

/**
 * Update the tracked mouse position to (x, y).
 * Called from non-animated interaction functions so the next animated
 * move arcs from the correct origin.
 */
export function setMousePosition(x: number, y: number): void {
  lastX = x;
  lastY = y;
}

/**
 * Ease-in-out timing function (cubic).
 * Returns 0 at t=0, 0.5 at t=0.5, 1 at t=1.
 * Slow start, fast middle, slow end.
 */
export function easeInOut(t: number): number {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Compute animation duration based on pixel distance.
 * Scales linearly from 300ms (short moves) to 500ms (long moves).
 * Distances below ~50px get 300ms; above ~1500px get 500ms.
 */
export function computeDuration(distance: number): number {
  const MIN_DURATION = 300;
  const MAX_DURATION = 500;
  const MIN_DISTANCE = 50;
  const MAX_DISTANCE = 1500;

  if (distance <= MIN_DISTANCE) return MIN_DURATION;
  if (distance >= MAX_DISTANCE) return MAX_DURATION;

  const ratio = (distance - MIN_DISTANCE) / (MAX_DISTANCE - MIN_DISTANCE);
  return MIN_DURATION + ratio * (MAX_DURATION - MIN_DURATION);
}

/**
 * Compute intermediate points along a cubic bezier curve.
 *
 * The curve goes from (startX, startY) to (endX, endY) with two control
 * points offset perpendicular to the line between start and end, creating
 * a gentle arc rather than a straight line.
 *
 * @param startX - Starting x coordinate
 * @param startY - Starting y coordinate
 * @param endX - Target x coordinate
 * @param endY - Target y coordinate
 * @param steps - Number of intermediate points to generate
 * @returns Array of {x, y} points along the curve (length = steps)
 */
export function computeBezierPath(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  steps: number,
): { x: number; y: number }[] {
  // Direction vector from start to end
  const dx = endX - startX;
  const dy = endY - startY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  // Perpendicular offset for arc (proportional to distance, capped)
  // Perpendicular to (dx, dy) is (-dy, dx)
  const arcAmount = Math.min(distance * 0.15, MAX_ARC_OFFSET_PX);

  // Normalized perpendicular vector
  let perpX = 0;
  let perpY = 0;
  if (distance > 0) {
    perpX = -dy / distance;
    perpY = dx / distance;
  }

  // Control points: offset from the 1/3 and 2/3 points along the line
  const cp1x = startX + dx * 0.33 + perpX * arcAmount;
  const cp1y = startY + dy * 0.33 + perpY * arcAmount;
  const cp2x = startX + dx * 0.67 + perpX * arcAmount * 0.5;
  const cp2y = startY + dy * 0.67 + perpY * arcAmount * 0.5;

  const points: { x: number; y: number }[] = [];

  for (let i = 1; i <= steps; i++) {
    const rawT = i / steps;
    const t = easeInOut(rawT);

    // Cubic bezier formula: B(t) = (1-t)^3*P0 + 3*(1-t)^2*t*P1 + 3*(1-t)*t^2*P2 + t^3*P3
    const mt = 1 - t;
    const mt2 = mt * mt;
    const mt3 = mt2 * mt;
    const t2 = t * t;
    const t3 = t2 * t;

    const x = mt3 * startX + 3 * mt2 * t * cp1x + 3 * mt * t2 * cp2x + t3 * endX;
    const y = mt3 * startY + 3 * mt2 * t * cp1y + 3 * mt * t2 * cp2y + t3 * endY;

    points.push({ x, y });
  }

  return points;
}

// ── Main API ────────────────────────────────────────────────────────────

/** Options for animateMouseTo. */
export interface AnimateMouseOptions {
  /** Total animation duration in ms. Default: computed from distance (300-500ms). */
  duration?: number;
  /** Number of intermediate mouseMoved events. Default: 25. */
  steps?: number;
}

/**
 * Animate the mouse cursor from its last known position to (x, y).
 *
 * Dispatches a series of CDP Input.dispatchMouseEvent calls with type
 * "mouseMoved" along a cubic bezier curve. The curve creates a natural,
 * slightly arced path with ease-in-out timing.
 *
 * @param x - Target x coordinate
 * @param y - Target y coordinate
 * @param options - Animation options (duration, steps)
 */
export async function animateMouseTo(
  x: number,
  y: number,
  options?: AnimateMouseOptions,
): Promise<void> {
  const dx = x - lastX;
  const dy = y - lastY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  const steps = Math.max(1, Math.round(options?.steps ?? 25));
  const duration = Math.max(0, options?.duration ?? computeDuration(distance));
  const delay = duration / steps;

  const points = computeBezierPath(lastX, lastY, x, y, steps);
  const cdp = await ensureCDPSession();

  for (const point of points) {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
      button: "none",
      clickCount: 0,
    });

    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Update last known position
  lastX = x;
  lastY = y;
}
