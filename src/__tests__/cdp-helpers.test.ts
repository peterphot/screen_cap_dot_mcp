/**
 * Unit tests for CDP helpers module (src/cdp-helpers.ts)
 *
 * Tests the CDP interaction primitives that use ensureCDPSession() from
 * browser.ts to make direct Chrome DevTools Protocol calls for element
 * interaction by backendNodeId.
 *
 * Covers:
 * - getElementCenter calculates center from quad coordinates
 * - clickByBackendNodeId dispatches correct mouse events in order
 * - typeByBackendNodeId focuses element and inserts text
 * - typeByBackendNodeId with clear=true sends Ctrl+A first
 * - hoverByBackendNodeId dispatches mouseMoved
 * - Error handling for empty quads (display:none / zero-size elements)
 * - Error handling for stale nodes ("Could not find node")
 * - getElementBoundingBox returns bounding box without scrolling
 * - getElementBoundingBox returns null for off-screen/hidden elements
 * - batchGetBoundingBoxes processes multiple elements in parallel
 * - getViewportBounds returns viewport dimensions
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Setup ──────────────────────────────────────────────────────────

const { mockSend, mockEvaluate } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockEvaluate: vi.fn(),
}));

vi.mock("../browser.js", () => ({
  ensureCDPSession: vi.fn().mockResolvedValue({ send: mockSend }),
  ensurePage: vi.fn().mockResolvedValue({ evaluate: mockEvaluate }),
}));

import {
  getElementCenter,
  clickByBackendNodeId,
  typeByBackendNodeId,
  hoverByBackendNodeId,
  getElementBoundingBox,
  batchGetBoundingBoxes,
  getViewportBounds,
  CTRL_MODIFIER,
  VK_KEY_A,
} from "../cdp-helpers.js";

beforeEach(() => {
  vi.clearAllMocks();
});

// ── getElementCenter() ──────────────────────────────────────────────────

describe("getElementCenter", () => {
  it("calculates center from quad coordinates", async () => {
    // Quad: a 100x100 square at (0,0)
    // corners: top-left(0,0), top-right(100,0), bottom-right(100,100), bottom-left(0,100)
    mockSend.mockResolvedValueOnce(undefined); // DOM.scrollIntoViewIfNeeded
    mockSend.mockResolvedValueOnce({
      quads: [[0, 0, 100, 0, 100, 100, 0, 100]],
    }); // DOM.getContentQuads

    const center = await getElementCenter(42);

    expect(mockSend).toHaveBeenCalledWith("DOM.scrollIntoViewIfNeeded", {
      backendNodeId: 42,
    });
    expect(mockSend).toHaveBeenCalledWith("DOM.getContentQuads", {
      backendNodeId: 42,
    });
    expect(center).toEqual({ x: 50, y: 50 });
  });

  it("calculates center for non-origin quads", async () => {
    // Quad: element at position (200,300) with 80x40 dimensions
    // corners: (200,300), (280,300), (280,340), (200,340)
    mockSend.mockResolvedValueOnce(undefined); // DOM.scrollIntoViewIfNeeded
    mockSend.mockResolvedValueOnce({
      quads: [[200, 300, 280, 300, 280, 340, 200, 340]],
    }); // DOM.getContentQuads

    const center = await getElementCenter(99);

    expect(center).toEqual({ x: 240, y: 320 });
  });

  it("throws when quads array is empty (hidden element)", async () => {
    mockSend.mockResolvedValueOnce(undefined); // DOM.scrollIntoViewIfNeeded
    mockSend.mockResolvedValueOnce({ quads: [] }); // DOM.getContentQuads

    await expect(getElementCenter(42)).rejects.toThrow(
      "Element has no visible content quads",
    );
  });

  it("throws descriptive error for stale nodes", async () => {
    mockSend.mockRejectedValueOnce(new Error("Could not find node"));

    await expect(getElementCenter(42)).rejects.toThrow(
      "Element not found in DOM",
    );
  });
});

// ── clickByBackendNodeId() ──────────────────────────────────────────────

describe("clickByBackendNodeId", () => {
  it("dispatches correct mouse events in order", async () => {
    mockSend.mockResolvedValueOnce(undefined); // DOM.scrollIntoViewIfNeeded
    mockSend.mockResolvedValueOnce({
      quads: [[0, 0, 100, 0, 100, 100, 0, 100]],
    }); // DOM.getContentQuads
    mockSend.mockResolvedValueOnce(undefined); // mousePressed
    mockSend.mockResolvedValueOnce(undefined); // mouseReleased

    const result = await clickByBackendNodeId(42);

    expect(result).toEqual({ x: 50, y: 50 });

    // Verify all CDP calls in order
    const calls = mockSend.mock.calls;
    expect(calls[0]).toEqual([
      "DOM.scrollIntoViewIfNeeded",
      { backendNodeId: 42 },
    ]);
    expect(calls[1]).toEqual([
      "DOM.getContentQuads",
      { backendNodeId: 42 },
    ]);
    expect(calls[2]).toEqual([
      "Input.dispatchMouseEvent",
      { type: "mousePressed", x: 50, y: 50, button: "left", clickCount: 1 },
    ]);
    expect(calls[3]).toEqual([
      "Input.dispatchMouseEvent",
      { type: "mouseReleased", x: 50, y: 50, button: "left", clickCount: 1 },
    ]);
  });
});

// ── typeByBackendNodeId() ───────────────────────────────────────────────

describe("typeByBackendNodeId", () => {
  it("focuses element and inserts text", async () => {
    mockSend.mockResolvedValueOnce(undefined); // DOM.focus
    mockSend.mockResolvedValueOnce(undefined); // Input.insertText

    await typeByBackendNodeId(42, "hello world");

    const calls = mockSend.mock.calls;
    expect(calls[0]).toEqual(["DOM.focus", { backendNodeId: 42 }]);
    expect(calls[1]).toEqual(["Input.insertText", { text: "hello world" }]);
    expect(calls).toHaveLength(2);
  });

  it("with clear=true sends Ctrl+A before inserting text", async () => {
    mockSend.mockResolvedValueOnce(undefined); // DOM.focus
    mockSend.mockResolvedValueOnce(undefined); // keyDown (Ctrl+A)
    mockSend.mockResolvedValueOnce(undefined); // keyUp (Ctrl+A)
    mockSend.mockResolvedValueOnce(undefined); // Input.insertText

    await typeByBackendNodeId(42, "new text", true);

    const calls = mockSend.mock.calls;

    // First call: DOM.focus
    expect(calls[0]).toEqual(["DOM.focus", { backendNodeId: 42 }]);

    // Ctrl+A sequence: keyDown then keyUp
    expect(calls[1][0]).toBe("Input.dispatchKeyEvent");
    expect(calls[1][1]).toMatchObject({
      type: "keyDown",
      key: "a",
      code: "KeyA",
    });
    // Verify modifier flags for Ctrl
    expect(calls[1][1].modifiers).toBe(CTRL_MODIFIER);
    expect(calls[1][1].windowsVirtualKeyCode).toBe(VK_KEY_A);

    expect(calls[2][0]).toBe("Input.dispatchKeyEvent");
    expect(calls[2][1]).toMatchObject({
      type: "keyUp",
      key: "a",
      code: "KeyA",
    });

    // Last call: Input.insertText (replaces selected text)
    expect(calls[calls.length - 1]).toEqual([
      "Input.insertText",
      { text: "new text" },
    ]);
  });

  it("propagates stale node error with descriptive message", async () => {
    mockSend.mockRejectedValueOnce(new Error("Could not find node"));

    await expect(typeByBackendNodeId(42, "text")).rejects.toThrow(
      "Element not found in DOM",
    );
  });
});

// ── hoverByBackendNodeId() ──────────────────────────────────────────────

describe("hoverByBackendNodeId", () => {
  it("dispatches mouseMoved event at element center", async () => {
    mockSend.mockResolvedValueOnce(undefined); // DOM.scrollIntoViewIfNeeded
    mockSend.mockResolvedValueOnce({
      quads: [[0, 0, 100, 0, 100, 100, 0, 100]],
    }); // DOM.getContentQuads
    mockSend.mockResolvedValueOnce(undefined); // mouseMoved

    const result = await hoverByBackendNodeId(42);

    expect(result).toEqual({ x: 50, y: 50 });

    const calls = mockSend.mock.calls;
    expect(calls[0]).toEqual([
      "DOM.scrollIntoViewIfNeeded",
      { backendNodeId: 42 },
    ]);
    expect(calls[1]).toEqual([
      "DOM.getContentQuads",
      { backendNodeId: 42 },
    ]);
    expect(calls[2]).toEqual([
      "Input.dispatchMouseEvent",
      { type: "mouseMoved", x: 50, y: 50, button: "none", clickCount: 0 },
    ]);
  });
});

// ── Input validation ──────────────────────────────────────────────────────

describe("input validation", () => {
  it("getElementCenter rejects negative backendNodeId", async () => {
    await expect(getElementCenter(-1)).rejects.toThrow(RangeError);
    await expect(getElementCenter(-1)).rejects.toThrow("Invalid backendNodeId");
  });

  it("getElementCenter rejects non-integer backendNodeId", async () => {
    await expect(getElementCenter(1.5)).rejects.toThrow(RangeError);
  });

  it("clickByBackendNodeId rejects negative backendNodeId", async () => {
    await expect(clickByBackendNodeId(-1)).rejects.toThrow(RangeError);
  });

  it("typeByBackendNodeId rejects negative backendNodeId", async () => {
    await expect(typeByBackendNodeId(-1, "text")).rejects.toThrow(RangeError);
  });

  it("hoverByBackendNodeId rejects negative backendNodeId", async () => {
    await expect(hoverByBackendNodeId(-1)).rejects.toThrow(RangeError);
  });

  it("getElementCenter rejects NaN backendNodeId", async () => {
    await expect(getElementCenter(NaN)).rejects.toThrow(RangeError);
  });

  it("getElementCenter throws for short quad", async () => {
    mockSend.mockResolvedValueOnce(undefined); // DOM.scrollIntoViewIfNeeded
    mockSend.mockResolvedValueOnce({
      quads: [[0, 0, 100, 0]],
    }); // DOM.getContentQuads — only 4 values instead of 8

    await expect(getElementCenter(42)).rejects.toThrow(
      "Expected quad with 8 values, got 4",
    );
  });
});

// ── Error handling ──────────────────────────────────────────────────────

describe("error handling", () => {
  it("wraps stale node errors across all functions", async () => {
    const staleError = new Error("Could not find node with given id");

    // getElementCenter
    mockSend.mockRejectedValueOnce(staleError);
    await expect(getElementCenter(1)).rejects.toThrow(
      "Element not found in DOM",
    );

    // clickByBackendNodeId
    mockSend.mockRejectedValueOnce(staleError);
    await expect(clickByBackendNodeId(2)).rejects.toThrow(
      "Element not found in DOM",
    );

    // hoverByBackendNodeId
    mockSend.mockRejectedValueOnce(staleError);
    await expect(hoverByBackendNodeId(3)).rejects.toThrow(
      "Element not found in DOM",
    );
  });

  it("rethrows non-stale errors unchanged", async () => {
    const otherError = new Error("Protocol error: target closed");

    mockSend.mockRejectedValueOnce(otherError);
    await expect(getElementCenter(1)).rejects.toThrow(
      "Protocol error: target closed",
    );
  });
});

// ── getViewportBounds() ─────────────────────────────────────────────────

describe("getViewportBounds", () => {
  it("returns viewport dimensions from page.evaluate", async () => {
    mockEvaluate.mockResolvedValueOnce({ width: 1280, height: 720 });

    const bounds = await getViewportBounds();

    expect(bounds).toEqual({ width: 1280, height: 720 });
  });
});

// ── getElementBoundingBox() ─────────────────────────────────────────────

describe("getElementBoundingBox", () => {
  it("returns bounding box from quad coordinates without scrolling", async () => {
    // Viewport: 1280x720
    mockEvaluate.mockResolvedValueOnce({ width: 1280, height: 720 });
    // Quad: 100x50 element at (200,300)
    mockSend.mockResolvedValueOnce({
      quads: [[200, 300, 300, 300, 300, 350, 200, 350]],
    });

    const box = await getElementBoundingBox(42);

    expect(box).toEqual({ x: 200, y: 300, width: 100, height: 50 });

    // Verify NO scrollIntoViewIfNeeded call was made
    expect(mockSend).not.toHaveBeenCalledWith(
      "DOM.scrollIntoViewIfNeeded",
      expect.anything(),
    );
    // Verify getContentQuads was called
    expect(mockSend).toHaveBeenCalledWith("DOM.getContentQuads", {
      backendNodeId: 42,
    });
  });

  it("returns null when quads array is empty (hidden element)", async () => {
    mockEvaluate.mockResolvedValueOnce({ width: 1280, height: 720 });
    mockSend.mockResolvedValueOnce({ quads: [] });

    const box = await getElementBoundingBox(42);

    expect(box).toBeNull();
  });

  it("returns null when quads is undefined", async () => {
    mockEvaluate.mockResolvedValueOnce({ width: 1280, height: 720 });
    mockSend.mockResolvedValueOnce({});

    const box = await getElementBoundingBox(42);

    expect(box).toBeNull();
  });

  it("returns null when CDP call fails (stale node)", async () => {
    mockEvaluate.mockResolvedValueOnce({ width: 1280, height: 720 });
    mockSend.mockRejectedValueOnce(new Error("Could not find node"));

    const box = await getElementBoundingBox(42);

    expect(box).toBeNull();
  });

  it("returns null when element is entirely off-screen (right of viewport)", async () => {
    mockEvaluate.mockResolvedValueOnce({ width: 1280, height: 720 });
    // Element at x=1300, fully off-screen to the right
    mockSend.mockResolvedValueOnce({
      quads: [[1300, 100, 1400, 100, 1400, 200, 1300, 200]],
    });

    const box = await getElementBoundingBox(42);

    expect(box).toBeNull();
  });

  it("returns null when element is entirely off-screen (below viewport)", async () => {
    mockEvaluate.mockResolvedValueOnce({ width: 1280, height: 720 });
    // Element at y=800, fully off-screen below
    mockSend.mockResolvedValueOnce({
      quads: [[100, 800, 200, 800, 200, 900, 100, 900]],
    });

    const box = await getElementBoundingBox(42);

    expect(box).toBeNull();
  });

  it("returns null when element is entirely off-screen (above viewport)", async () => {
    mockEvaluate.mockResolvedValueOnce({ width: 1280, height: 720 });
    // Element entirely above viewport (negative y)
    mockSend.mockResolvedValueOnce({
      quads: [[100, -200, 200, -200, 200, -100, 100, -100]],
    });

    const box = await getElementBoundingBox(42);

    expect(box).toBeNull();
  });

  it("returns null when element is entirely off-screen (left of viewport)", async () => {
    mockEvaluate.mockResolvedValueOnce({ width: 1280, height: 720 });
    // Element entirely to the left (negative x)
    mockSend.mockResolvedValueOnce({
      quads: [[-200, 100, -100, 100, -100, 200, -200, 200]],
    });

    const box = await getElementBoundingBox(42);

    expect(box).toBeNull();
  });

  it("returns bounding box for element partially off-screen", async () => {
    mockEvaluate.mockResolvedValueOnce({ width: 1280, height: 720 });
    // Element at (1200,100) with 200x100 — extends 120px beyond viewport right edge
    mockSend.mockResolvedValueOnce({
      quads: [[1200, 100, 1400, 100, 1400, 200, 1200, 200]],
    });

    const box = await getElementBoundingBox(42);

    // Partially visible elements should still return a bounding box
    expect(box).toEqual({ x: 1200, y: 100, width: 200, height: 100 });
  });

  it("rejects negative backendNodeId", async () => {
    await expect(getElementBoundingBox(-1)).rejects.toThrow(RangeError);
  });
});

// ── batchGetBoundingBoxes() ─────────────────────────────────────────────

describe("batchGetBoundingBoxes", () => {
  it("returns bounding boxes for multiple elements in parallel", async () => {
    // Each call to getElementBoundingBox calls getViewportBounds + getContentQuads
    // Node 10: visible element
    mockEvaluate.mockResolvedValueOnce({ width: 1280, height: 720 });
    mockSend.mockResolvedValueOnce({
      quads: [[0, 0, 100, 0, 100, 50, 0, 50]],
    });
    // Node 20: visible element
    mockEvaluate.mockResolvedValueOnce({ width: 1280, height: 720 });
    mockSend.mockResolvedValueOnce({
      quads: [[200, 200, 400, 200, 400, 300, 200, 300]],
    });

    const result = await batchGetBoundingBoxes([10, 20]);

    expect(result).toBeInstanceOf(Map);
    expect(result.get(10)).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    expect(result.get(20)).toEqual({ x: 200, y: 200, width: 200, height: 100 });
  });

  it("maps failed/off-screen elements to null", async () => {
    // Node 10: visible
    mockEvaluate.mockResolvedValueOnce({ width: 1280, height: 720 });
    mockSend.mockResolvedValueOnce({
      quads: [[0, 0, 100, 0, 100, 50, 0, 50]],
    });
    // Node 20: stale node (CDP error)
    mockEvaluate.mockResolvedValueOnce({ width: 1280, height: 720 });
    mockSend.mockRejectedValueOnce(new Error("Could not find node"));
    // Node 30: off-screen
    mockEvaluate.mockResolvedValueOnce({ width: 1280, height: 720 });
    mockSend.mockResolvedValueOnce({
      quads: [[2000, 2000, 2100, 2000, 2100, 2100, 2000, 2100]],
    });

    const result = await batchGetBoundingBoxes([10, 20, 30]);

    expect(result.get(10)).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    expect(result.get(20)).toBeNull();
    expect(result.get(30)).toBeNull();
  });

  it("returns empty map for empty input array", async () => {
    const result = await batchGetBoundingBoxes([]);

    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  it("handles single-element array", async () => {
    mockEvaluate.mockResolvedValueOnce({ width: 1280, height: 720 });
    mockSend.mockResolvedValueOnce({
      quads: [[50, 50, 150, 50, 150, 100, 50, 100]],
    });

    const result = await batchGetBoundingBoxes([42]);

    expect(result.size).toBe(1);
    expect(result.get(42)).toEqual({ x: 50, y: 50, width: 100, height: 50 });
  });
});
