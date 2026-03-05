/**
 * Click/Hover Visual Indicator — Temporary DOM overlay at interaction points.
 *
 * Injects CSS-animated overlays at viewport coordinates during animated
 * recordings, providing visual feedback of where clicks and hovers happen.
 *
 * Key design decisions:
 * - `page.evaluate()` injection — runs in the browser context
 * - `position: fixed` — CDP coordinates are viewport-relative
 * - `pointer-events: none` + `z-index: 2147483647` — never blocks clicks
 * - CSS `@keyframes` on compositor thread for smooth rendering
 * - Style tag injected once with idempotent `id` check
 * - Auto-cleanup via `animationend` listener + fallback `setTimeout`
 * - Calls `ensurePage()` internally (matches mouse-animator pattern)
 * - try/catch swallows errors — indicators are non-critical
 */

import { ensurePage } from "../browser.js";

/**
 * Show a click indicator: blue dot with expanding ring pulse.
 *
 * Injects a temporary DOM overlay at (x, y) that auto-removes after 400ms.
 *
 * @param x - Viewport x coordinate
 * @param y - Viewport y coordinate
 */
export async function showClickIndicator(
  x: number,
  y: number,
): Promise<void> {
  try {
    const page = await ensurePage();
    await page.evaluate(injectIndicator, x, y, "click", 400);
  } catch {
    // Non-critical — silently swallow errors
  }
}

/**
 * Show a hover indicator: amber dot with subtler ring pulse.
 *
 * Injects a temporary DOM overlay at (x, y) that auto-removes after 300ms.
 *
 * @param x - Viewport x coordinate
 * @param y - Viewport y coordinate
 */
export async function showHoverIndicator(
  x: number,
  y: number,
): Promise<void> {
  try {
    const page = await ensurePage();
    await page.evaluate(injectIndicator, x, y, "hover", 300);
  } catch {
    // Non-critical — silently swallow errors
  }
}

// ── Browser-context injection function ──────────────────────────────────

/**
 * Injected into the page via page.evaluate().
 * Creates the indicator DOM elements and CSS animations.
 *
 * This function runs in the BROWSER context, not Node.js.
 */
function injectIndicator(
  x: unknown,
  y: unknown,
  type: unknown,
  durationMs: unknown,
): void {
  const cx = x as number;
  const cy = y as number;
  if (typeof cx !== 'number' || !isFinite(cx)) return;
  if (typeof cy !== 'number' || !isFinite(cy)) return;
  const indicatorType = type as string;
  const duration = durationMs as number;

  // ── Idempotent style injection ──────────────────────────────────────
  const styleId = "__screencap_indicator_styles__";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      @keyframes screencap-dot-fade {
        0%   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        100% { opacity: 0; transform: translate(-50%, -50%) scale(0.5); }
      }
      @keyframes screencap-ring-expand {
        0%   { opacity: 0.6; transform: translate(-50%, -50%) scale(0.5); }
        100% { opacity: 0;   transform: translate(-50%, -50%) scale(2.5); }
      }
    `;
    document.head.appendChild(style);
  }

  // ── Color configuration ─────────────────────────────────────────────
  const isClick = indicatorType === "click";
  const dotColor = isClick ? "rgba(59, 130, 246, 0.9)" : "rgba(251, 191, 36, 0.8)";
  const ringColor = isClick ? "rgba(59, 130, 246, 0.4)" : "rgba(251, 191, 36, 0.3)";
  const dotSize = isClick ? 12 : 8;
  const ringSize = isClick ? 24 : 18;
  const durationSec = duration / 1000;

  // ── Shared overlay styles ───────────────────────────────────────────
  const sharedStyles = `
    position: fixed;
    left: ${cx}px;
    top: ${cy}px;
    pointer-events: none;
    z-index: 2147483647;
    border-radius: 50%;
  `;

  // ── Dot element ─────────────────────────────────────────────────────
  const dot = document.createElement("div");
  dot.style.cssText = `
    ${sharedStyles}
    width: ${dotSize}px;
    height: ${dotSize}px;
    background: ${dotColor};
    animation: screencap-dot-fade ${durationSec}s ease-out forwards;
  `;

  // ── Ring element ────────────────────────────────────────────────────
  const ring = document.createElement("div");
  ring.style.cssText = `
    ${sharedStyles}
    width: ${ringSize}px;
    height: ${ringSize}px;
    border: 2px solid ${ringColor};
    background: transparent;
    animation: screencap-ring-expand ${durationSec}s ease-out forwards;
  `;

  document.body.appendChild(dot);
  document.body.appendChild(ring);

  // ── Auto-cleanup ────────────────────────────────────────────────────
  const cleanup = (el: HTMLElement) => {
    const timerId = setTimeout(() => {
      if (el.parentNode) el.remove();
    }, duration + 100);
    el.addEventListener("animationend", () => { clearTimeout(timerId); el.remove(); }, { once: true });
  };

  cleanup(dot);
  cleanup(ring);
}
