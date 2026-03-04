/**
 * Unit tests for a11y-matcher (src/util/a11y-matcher.ts)
 *
 * Tests verify:
 * - matchA11yNode finds nodes by role and name
 * - Name matching is case-insensitive substring
 * - index parameter selects nth match
 * - Returns null when no match found
 * - Returns first match by default for multiple matches
 * - Handles empty/missing trees gracefully
 * - resolveMatch integrates with page a11y snapshot and ref allocation
 * - Clear error messages for no-match and ambiguous-match scenarios
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { A11ySnapshotNode } from "../util/a11y-formatter.js";

// ── Mock Setup ──────────────────────────────────────────────────────────

const mockEnsurePage = vi.fn();

vi.mock("../browser.js", () => ({
  ensurePage: (...args: unknown[]) => mockEnsurePage(...args),
}));

const mockAllocateRef = vi.fn();
const mockClearRefs = vi.fn();

vi.mock("../ref-store.js", () => ({
  allocateRef: (...args: unknown[]) => mockAllocateRef(...args),
  clearRefs: (...args: unknown[]) => mockClearRefs(...args),
}));

// ── Import after mocks ─────────────────────────────────────────────────

import { matchA11yNode, resolveMatch } from "../util/a11y-matcher.js";

// ── Test tree ───────────────────────────────────────────────────────────

const sampleTree: A11ySnapshotNode = {
  role: "WebArea",
  name: "Test Page",
  children: [
    {
      role: "navigation",
      name: "Main Nav",
      children: [
        { role: "link", name: "Home", backendNodeId: 10 },
        { role: "link", name: "Channel ROI", backendNodeId: 20 },
        { role: "link", name: "Settings", backendNodeId: 30 },
      ],
    },
    {
      role: "main",
      name: "",
      children: [
        { role: "heading", name: "Dashboard", backendNodeId: 40 },
        {
          role: "button",
          name: "Add Column",
          backendNodeId: 50,
        },
        {
          role: "button",
          name: "Remove Column",
          backendNodeId: 60,
        },
        {
          role: "button",
          name: "Add Row",
          backendNodeId: 70,
        },
        {
          role: "textbox",
          name: "Search",
          backendNodeId: 80,
        },
      ],
    },
  ],
};

// ── matchA11yNode tests ─────────────────────────────────────────────────

describe("matchA11yNode", () => {
  it("finds a node by exact role and name", () => {
    const result = matchA11yNode(sampleTree, { role: "link", name: "Home" });
    expect(result).not.toBeNull();
    expect(result!.node.backendNodeId).toBe(10);
  });

  it("finds a node by role only", () => {
    const result = matchA11yNode(sampleTree, { role: "heading" });
    expect(result).not.toBeNull();
    expect(result!.node.backendNodeId).toBe(40);
  });

  it("finds a node by name only", () => {
    const result = matchA11yNode(sampleTree, { name: "Search" });
    expect(result).not.toBeNull();
    expect(result!.node.backendNodeId).toBe(80);
  });

  it("performs case-insensitive substring match on name", () => {
    const result = matchA11yNode(sampleTree, { role: "link", name: "channel" });
    expect(result).not.toBeNull();
    expect(result!.node.backendNodeId).toBe(20);
  });

  it("performs case-insensitive substring match with uppercase query", () => {
    const result = matchA11yNode(sampleTree, { role: "link", name: "CHANNEL ROI" });
    expect(result).not.toBeNull();
    expect(result!.node.backendNodeId).toBe(20);
  });

  it("returns first match when multiple nodes match", () => {
    // "Column" matches "Add Column" and "Remove Column"
    const result = matchA11yNode(sampleTree, { role: "button", name: "Column" });
    expect(result).not.toBeNull();
    expect(result!.node.backendNodeId).toBe(50);
    expect(result!.matchCount).toBeGreaterThan(1);
  });

  it("selects nth match via index parameter", () => {
    // index 1 should get "Remove Column" (second match)
    const result = matchA11yNode(sampleTree, { role: "button", name: "Column", index: 1 });
    expect(result).not.toBeNull();
    expect(result!.node.backendNodeId).toBe(60);
  });

  it("returns null when no nodes match role", () => {
    const result = matchA11yNode(sampleTree, { role: "slider" });
    expect(result).toBeNull();
  });

  it("returns null when no nodes match name", () => {
    const result = matchA11yNode(sampleTree, { role: "button", name: "Nonexistent" });
    expect(result).toBeNull();
  });

  it("returns null when index is out of range", () => {
    const result = matchA11yNode(sampleTree, { role: "button", name: "Column", index: 99 });
    expect(result).toBeNull();
  });

  it("requires at least role or name", () => {
    expect(() => matchA11yNode(sampleTree, {})).toThrow(
      "match requires at least one of role or name",
    );
  });

  it("handles a tree with no children", () => {
    const emptyTree: A11ySnapshotNode = { role: "WebArea", name: "Empty" };
    const result = matchA11yNode(emptyTree, { role: "button" });
    expect(result).toBeNull();
  });

  it("matches the root node itself", () => {
    const result = matchA11yNode(sampleTree, { role: "WebArea" });
    expect(result).not.toBeNull();
    expect(result!.node.name).toBe("Test Page");
  });

  it("reports matchCount accurately", () => {
    // Three links in the tree
    const result = matchA11yNode(sampleTree, { role: "link" });
    expect(result).not.toBeNull();
    expect(result!.matchCount).toBe(3);
  });

  it("performs case-insensitive role match", () => {
    const result = matchA11yNode(sampleTree, { role: "LINK", name: "Home" });
    expect(result).not.toBeNull();
    expect(result!.node.backendNodeId).toBe(10);
  });
});

// ── resolveMatch tests ──────────────────────────────────────────────────

describe("resolveMatch", () => {
  let mockPage: {
    accessibility: { snapshot: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPage = {
      accessibility: {
        snapshot: vi.fn().mockResolvedValue(sampleTree),
      },
    };
    mockEnsurePage.mockResolvedValue(mockPage);
    mockAllocateRef.mockReturnValue("e1");
  });

  it("resolves a match and allocates a ref", async () => {
    const result = await resolveMatch({ role: "link", name: "Channel ROI" });
    expect(result.ref).toBe("e1");
    expect(result.backendNodeId).toBe(20);
    expect(mockAllocateRef).toHaveBeenCalledWith(20);
  });

  it("throws descriptive error when no match found", async () => {
    await expect(resolveMatch({ role: "button", name: "Nonexistent" })).rejects.toThrow(
      /No a11y node found matching/,
    );
  });

  it("includes match criteria in error message", async () => {
    await expect(resolveMatch({ role: "slider", name: "Volume" })).rejects.toThrow(
      /role="slider".*name="Volume"/,
    );
  });

  it("logs warning when multiple matches found (uses first)", async () => {
    const result = await resolveMatch({ role: "button", name: "Column" });
    expect(result.backendNodeId).toBe(50);
    // First match (Add Column) should be used
    expect(mockAllocateRef).toHaveBeenCalledWith(50);
  });

  it("uses index to select specific match", async () => {
    const result = await resolveMatch({ role: "button", name: "Column", index: 1 });
    expect(result.backendNodeId).toBe(60);
    expect(mockAllocateRef).toHaveBeenCalledWith(60);
  });

  it("throws when matched node has no backendNodeId", async () => {
    const treeWithoutIds: A11ySnapshotNode = {
      role: "WebArea",
      name: "No IDs",
      children: [{ role: "button", name: "Ghost" }],
    };
    mockPage.accessibility.snapshot.mockResolvedValue(treeWithoutIds);

    await expect(resolveMatch({ role: "button", name: "Ghost" })).rejects.toThrow(
      /no backendNodeId/,
    );
  });

  it("accepts a pre-fetched snapshot via options", async () => {
    const result = await resolveMatch(
      { role: "link", name: "Home" },
      { snapshot: sampleTree },
    );
    expect(result.backendNodeId).toBe(10);
    // Should NOT have called page.accessibility.snapshot since we passed one in
    expect(mockPage.accessibility.snapshot).not.toHaveBeenCalled();
  });
});
