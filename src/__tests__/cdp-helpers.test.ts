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
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Setup ──────────────────────────────────────────────────────────

const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
}));

vi.mock("../browser.js", () => ({
  ensureCDPSession: vi.fn().mockResolvedValue({ send: mockSend }),
}));

import {
  getElementCenter,
  clickByBackendNodeId,
  typeByBackendNodeId,
  hoverByBackendNodeId,
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
    mockSend.mockResolvedValue(undefined); // All calls succeed

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
    expect(
      calls[1][1].modifiers === 2 ||
      calls[1][1].windowsVirtualKeyCode === 65,
    ).toBe(true);

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
      { type: "mouseMoved", x: 50, y: 50, button: "left", clickCount: 1 },
    ]);
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
