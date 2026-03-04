/**
 * CDP Helpers - Chrome DevTools Protocol interaction primitives.
 *
 * Uses ensureCDPSession() from browser.ts to make direct CDP calls for
 * element interaction by backendNodeId. These are low-level building blocks
 * for click, type, and hover operations.
 *
 * Key design decisions:
 * - All functions take a backendNodeId (number) as their element reference
 * - scrollIntoViewIfNeeded is called before any coordinate-dependent operation
 * - Center is calculated by averaging the 4 corners of the first content quad
 * - Stale node errors are caught and re-thrown with actionable guidance
 * - Bounding box helpers do NOT scroll — used for annotated screenshot overlays
 */

import { ensureCDPSession, ensurePage } from "./browser.js";

/** CDP modifier flag for the Control key. */
export const CTRL_MODIFIER = 2;
/** Windows virtual key code for the "A" key. */
export const VK_KEY_A = 65;

// ── Input validation ────────────────────────────────────────────────────

function assertValidNodeId(id: number): void {
  if (!Number.isInteger(id) || id < 0) {
    throw new RangeError(`Invalid backendNodeId: ${id}`);
  }
}

// ── Error wrapping ──────────────────────────────────────────────────────

/**
 * Wraps a CDP operation, catching stale-node errors and re-throwing with
 * actionable guidance for the caller.
 */
async function wrapStaleNodeError<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("Could not find node")) {
      throw new Error(
        "Element not found in DOM — it may have been removed by a page update. " +
          "Take a new a11y snapshot to get fresh refs.",
      );
    }
    throw err;
  }
}

// ── Quad center calculation ─────────────────────────────────────────────

/**
 * Calculate the center point from a content quad (8 numbers: 4 corners x,y).
 * Indices: [x1,y1, x2,y2, x3,y3, x4,y4]
 */
function quadCenter(quad: number[]): { x: number; y: number } {
  if (quad.length < 8) {
    throw new Error(`Expected quad with 8 values, got ${quad.length}`);
  }
  const x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4;
  const y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;
  return { x, y };
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Scroll an element into view and return its center coordinates.
 *
 * Uses DOM.scrollIntoViewIfNeeded then DOM.getContentQuads to find the
 * element's bounding quad, then averages the 4 corners to get the center.
 *
 * @throws Error if the element has no visible content quads (hidden/zero-size)
 * @throws Error if the node is stale (removed from DOM)
 */
export async function getElementCenter(
  backendNodeId: number,
): Promise<{ x: number; y: number }> {
  assertValidNodeId(backendNodeId);
  return wrapStaleNodeError(async () => {
    const cdp = await ensureCDPSession();

    await cdp.send("DOM.scrollIntoViewIfNeeded", { backendNodeId });

    const { quads } = (await cdp.send("DOM.getContentQuads", {
      backendNodeId,
    })) as { quads: number[][] };

    if (!quads || quads.length === 0) {
      throw new Error(
        "Element has no visible content quads — it may be hidden or have zero dimensions. " +
          "Take a new a11y snapshot and try a different element.",
      );
    }

    return quadCenter(quads[0]);
  });
}

/**
 * Click an element by backendNodeId.
 *
 * Scrolls into view, calculates center, then dispatches mousePressed and
 * mouseReleased events at the center coordinates.
 *
 * @returns The coordinates where the click was dispatched
 */
export async function clickByBackendNodeId(
  backendNodeId: number,
): Promise<{ x: number; y: number }> {
  assertValidNodeId(backendNodeId);
  return wrapStaleNodeError(async () => {
    const center = await getElementCenter(backendNodeId);
    const cdp = await ensureCDPSession();

    await cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: center.x,
      y: center.y,
      button: "left",
      clickCount: 1,
    });

    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: center.x,
      y: center.y,
      button: "left",
      clickCount: 1,
    });

    return center;
  });
}

/**
 * Type text into an element by backendNodeId.
 *
 * Focuses the element via DOM.focus, optionally selects all existing content
 * with Ctrl+A (when clear=true), then inserts the text via Input.insertText.
 *
 * @param clear - If true, select all existing content before typing (Ctrl+A)
 */
export async function typeByBackendNodeId(
  backendNodeId: number,
  text: string,
  clear?: boolean,
): Promise<void> {
  assertValidNodeId(backendNodeId);
  return wrapStaleNodeError(async () => {
    const cdp = await ensureCDPSession();

    await cdp.send("DOM.focus", { backendNodeId });

    if (clear) {
      // Ctrl+A to select all existing content
      await cdp.send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "a",
        code: "KeyA",
        modifiers: CTRL_MODIFIER,
        windowsVirtualKeyCode: VK_KEY_A,
      });
      await cdp.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "a",
        code: "KeyA",
        modifiers: CTRL_MODIFIER,
        windowsVirtualKeyCode: VK_KEY_A,
      });
    }

    await cdp.send("Input.insertText", { text });
  });
}

/**
 * Hover over an element by backendNodeId.
 *
 * Scrolls into view, calculates center, then dispatches a mouseMoved event
 * at the center coordinates.
 *
 * @returns The coordinates where the hover was dispatched
 */
export async function hoverByBackendNodeId(
  backendNodeId: number,
): Promise<{ x: number; y: number }> {
  assertValidNodeId(backendNodeId);
  return wrapStaleNodeError(async () => {
    const center = await getElementCenter(backendNodeId);
    const cdp = await ensureCDPSession();

    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: center.x,
      y: center.y,
      button: "none",
      clickCount: 0,
    });

    return center;
  });
}

// ── Bounding box types ──────────────────────────────────────────────────

/** Axis-aligned bounding box in viewport coordinates. */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ── Bounding box helpers (non-scrolling) ────────────────────────────────

/**
 * Compute a bounding box from a content quad (8 numbers: 4 corners x,y).
 * Returns the axis-aligned bounding rectangle enclosing all 4 corners.
 */
function quadToBoundingBox(quad: number[]): BoundingBox {
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Get the current viewport dimensions.
 *
 * Evaluates `window.innerWidth` and `window.innerHeight` in the page context.
 * Used to filter out elements that are entirely off-screen.
 */
export async function getViewportBounds(): Promise<{ width: number; height: number }> {
  const page = await ensurePage();
  return page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
}

/**
 * Get the bounding box of an element by backendNodeId WITHOUT scrolling.
 *
 * Calls DOM.getContentQuads directly (no DOM.scrollIntoViewIfNeeded).
 * Returns `null` if the element is hidden, has no quads, the CDP call fails,
 * or the element is entirely outside the viewport.
 *
 * Elements that are partially off-screen still return their full bounding box.
 */
export async function getElementBoundingBox(
  backendNodeId: number,
): Promise<BoundingBox | null> {
  assertValidNodeId(backendNodeId);

  const viewport = await getViewportBounds();

  let quads: number[][];
  try {
    const cdp = await ensureCDPSession();
    const result = (await cdp.send("DOM.getContentQuads", {
      backendNodeId,
    })) as { quads?: number[][] };
    quads = result.quads ?? [];
  } catch {
    return null;
  }

  if (quads.length === 0) {
    return null;
  }

  const box = quadToBoundingBox(quads[0]);

  // Filter out elements entirely outside the viewport
  if (
    box.x + box.width <= 0 ||
    box.y + box.height <= 0 ||
    box.x >= viewport.width ||
    box.y >= viewport.height
  ) {
    return null;
  }

  return box;
}

/**
 * Get bounding boxes for multiple elements in parallel.
 *
 * Uses Promise.allSettled() so that failures for individual elements
 * don't prevent results for others. Failed or off-screen elements map to `null`.
 *
 * @returns Map from backendNodeId to bounding box (or null)
 */
export async function batchGetBoundingBoxes(
  backendNodeIds: number[],
): Promise<Map<number, BoundingBox | null>> {
  const results = await Promise.allSettled(
    backendNodeIds.map((id) => getElementBoundingBox(id)),
  );

  const map = new Map<number, BoundingBox | null>();
  for (let i = 0; i < backendNodeIds.length; i++) {
    const result = results[i];
    map.set(
      backendNodeIds[i],
      result.status === "fulfilled" ? result.value : null,
    );
  }

  return map;
}
