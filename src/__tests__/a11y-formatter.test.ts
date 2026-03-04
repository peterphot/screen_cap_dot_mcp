/**
 * Unit tests for src/util/a11y-formatter.ts
 *
 * Tests the two exported functions:
 * - filterTree(): pre-processing pass (generic unwrap, StaticText collapse, sibling truncation)
 * - formatA11yTree(): render tree to compact indented text
 */

import { describe, it, expect } from "vitest";
import { filterTree, formatA11yTree } from "../util/a11y-formatter.js";
import type { A11ySnapshotNode } from "../util/a11y-formatter.js";

// ── filterTree ──────────────────────────────────────────────────────────

describe("filterTree", () => {
  describe("generic/none node unwrapping", () => {
    it("unwraps a generic node with exactly one child", () => {
      const tree: A11ySnapshotNode = {
        role: "WebArea",
        name: "Page",
        children: [
          {
            role: "generic",
            children: [
              { role: "button", name: "Click me", ref: "e1" },
            ],
          },
        ],
      };

      const result = filterTree(tree);
      // The generic wrapper should be gone; button is now a direct child of WebArea
      expect(result.children).toHaveLength(1);
      expect(result.children![0].role).toBe("button");
      expect(result.children![0].name).toBe("Click me");
    });

    it("unwraps a none node with exactly one child", () => {
      const tree: A11ySnapshotNode = {
        role: "WebArea",
        name: "Page",
        children: [
          {
            role: "none",
            children: [
              { role: "link", name: "Home", ref: "e2" },
            ],
          },
        ],
      };

      const result = filterTree(tree);
      expect(result.children).toHaveLength(1);
      expect(result.children![0].role).toBe("link");
      expect(result.children![0].name).toBe("Home");
    });

    it("does NOT unwrap a generic node with zero children", () => {
      const tree: A11ySnapshotNode = {
        role: "WebArea",
        name: "Page",
        children: [
          { role: "generic", children: [] },
          { role: "button", name: "OK" },
        ],
      };

      const result = filterTree(tree);
      // generic with 0 children stays (or is removed as empty, but not unwrapped)
      // The button should still be present
      expect(result.children!.some((c) => c.role === "button")).toBe(true);
    });

    it("does NOT unwrap a generic node with 2+ children", () => {
      const tree: A11ySnapshotNode = {
        role: "WebArea",
        name: "Page",
        children: [
          {
            role: "generic",
            children: [
              { role: "link", name: "A" },
              { role: "link", name: "B" },
            ],
          },
        ],
      };

      const result = filterTree(tree);
      expect(result.children).toHaveLength(1);
      expect(result.children![0].role).toBe("generic");
      expect(result.children![0].children).toHaveLength(2);
    });

    it("unwraps nested generic wrappers recursively", () => {
      const tree: A11ySnapshotNode = {
        role: "WebArea",
        name: "Page",
        children: [
          {
            role: "generic",
            children: [
              {
                role: "none",
                children: [
                  { role: "heading", name: "Title", level: 1 },
                ],
              },
            ],
          },
        ],
      };

      const result = filterTree(tree);
      expect(result.children).toHaveLength(1);
      expect(result.children![0].role).toBe("heading");
      expect(result.children![0].name).toBe("Title");
    });
  });

  describe("StaticText collapsing", () => {
    it("collapses a leaf StaticText into parent name when parent has no name", () => {
      const tree: A11ySnapshotNode = {
        role: "WebArea",
        name: "Page",
        children: [
          {
            role: "link",
            ref: "e1",
            children: [
              { role: "StaticText", name: "Click here" },
            ],
          },
        ],
      };

      const result = filterTree(tree);
      expect(result.children).toHaveLength(1);
      expect(result.children![0].role).toBe("link");
      expect(result.children![0].name).toBe("Click here");
      // StaticText child should be removed
      expect(result.children![0].children).toBeUndefined();
    });

    it("removes StaticText child when parent already has a name", () => {
      const tree: A11ySnapshotNode = {
        role: "WebArea",
        name: "Page",
        children: [
          {
            role: "link",
            name: "Dashboard",
            ref: "e1",
            children: [
              { role: "StaticText", name: "Dashboard" },
            ],
          },
        ],
      };

      const result = filterTree(tree);
      expect(result.children).toHaveLength(1);
      expect(result.children![0].role).toBe("link");
      expect(result.children![0].name).toBe("Dashboard");
      // StaticText child should be removed (redundant)
      expect(result.children![0].children).toBeUndefined();
    });

    it("does NOT collapse StaticText nodes that are not leaves", () => {
      const tree: A11ySnapshotNode = {
        role: "WebArea",
        name: "Page",
        children: [
          {
            role: "StaticText",
            name: "Has children",
            children: [
              { role: "link", name: "Child" },
            ],
          },
        ],
      };

      const result = filterTree(tree);
      // StaticText with children is not a leaf, should remain
      expect(result.children).toHaveLength(1);
      expect(result.children![0].role).toBe("StaticText");
      expect(result.children![0].children).toHaveLength(1);
    });

    it("only collapses when parent has exactly one StaticText child", () => {
      const tree: A11ySnapshotNode = {
        role: "WebArea",
        name: "Page",
        children: [
          {
            role: "link",
            ref: "e1",
            children: [
              { role: "StaticText", name: "Link text" },
              { role: "image", name: "icon" },
            ],
          },
        ],
      };

      const result = filterTree(tree);
      // Parent has 2 children, so StaticText should NOT be collapsed
      expect(result.children![0].children!.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("sibling truncation", () => {
    it("truncates repeated same-role siblings after 3", () => {
      const tree: A11ySnapshotNode = {
        role: "table",
        name: "Results",
        children: Array.from({ length: 25 }, (_, i) => ({
          role: "row" as const,
          name: `Row ${i + 1}`,
        })),
      };

      const result = filterTree(tree);
      // Should have 3 rows + 1 truncation placeholder
      expect(result.children).toHaveLength(4);
      expect(result.children![0].role).toBe("row");
      expect(result.children![1].role).toBe("row");
      expect(result.children![2].role).toBe("row");
      // Last item should be a truncation marker
      expect(result.children![3].name).toContain("22 more rows");
    });

    it("does not truncate when fewer than 4 siblings of same role", () => {
      const tree: A11ySnapshotNode = {
        role: "list",
        name: "Menu",
        children: [
          { role: "listitem", name: "Item 1" },
          { role: "listitem", name: "Item 2" },
          { role: "listitem", name: "Item 3" },
        ],
      };

      const result = filterTree(tree);
      expect(result.children).toHaveLength(3);
    });

    it("does not truncate mixed-role siblings", () => {
      const tree: A11ySnapshotNode = {
        role: "navigation",
        name: "Nav",
        children: [
          { role: "link", name: "Home" },
          { role: "button", name: "Menu" },
          { role: "link", name: "About" },
          { role: "button", name: "Settings" },
          { role: "link", name: "Contact" },
        ],
      };

      const result = filterTree(tree);
      expect(result.children).toHaveLength(5);
    });

    it("truncates runs of same-role within mixed siblings", () => {
      const tree: A11ySnapshotNode = {
        role: "main",
        name: "Content",
        children: [
          { role: "heading", name: "Title" },
          ...Array.from({ length: 10 }, (_, i) => ({
            role: "row" as const,
            name: `Row ${i + 1}`,
          })),
          { role: "button", name: "Load more" },
        ],
      };

      const result = filterTree(tree);
      // heading + 3 rows + truncation marker + button = 6
      expect(result.children).toHaveLength(6);
      expect(result.children![0].role).toBe("heading");
      expect(result.children![1].role).toBe("row");
      expect(result.children![2].role).toBe("row");
      expect(result.children![3].role).toBe("row");
      expect(result.children![4].name).toContain("7 more rows");
      expect(result.children![5].role).toBe("button");
    });
  });

  describe("does not mutate the original tree", () => {
    it("returns a new tree, leaving the original intact", () => {
      const original: A11ySnapshotNode = {
        role: "WebArea",
        name: "Page",
        children: [
          {
            role: "generic",
            children: [
              { role: "button", name: "OK" },
            ],
          },
        ],
      };

      const originalJson = JSON.stringify(original);
      filterTree(original);
      expect(JSON.stringify(original)).toBe(originalJson);
    });
  });
});

// ── formatA11yTree ──────────────────────────────────────────────────────

describe("formatA11yTree", () => {
  describe("basic formatting", () => {
    it("formats a simple tree with ref, role, and name", () => {
      const tree: A11ySnapshotNode = {
        role: "WebArea",
        name: "Page",
        ref: "e1",
        children: [
          { role: "heading", name: "Welcome", ref: "e2", level: 1 },
          { role: "button", name: "Submit", ref: "e3" },
        ],
      };

      const output = formatA11yTree(tree);
      const lines = output.split("\n");

      expect(lines[0]).toBe('[e1] WebArea "Page"');
      expect(lines[1]).toBe('  [e2] heading "Welcome" level=1');
      expect(lines[2]).toBe('  [e3] button "Submit"');
    });

    it("uses 2-space indent per depth level", () => {
      const tree: A11ySnapshotNode = {
        role: "main",
        ref: "e1",
        children: [
          {
            role: "section",
            ref: "e2",
            children: [
              {
                role: "heading",
                name: "Deep",
                ref: "e3",
                level: 2,
              },
            ],
          },
        ],
      };

      const output = formatA11yTree(tree);
      const lines = output.split("\n");

      expect(lines[0]).toBe("[e1] main");
      expect(lines[1]).toBe("  [e2] section");
      expect(lines[2]).toBe('    [e3] heading "Deep" level=2');
    });

    it("renders nodes without ref (no bracket prefix)", () => {
      const tree: A11ySnapshotNode = {
        role: "text",
        name: "Plain text",
      };

      const output = formatA11yTree(tree);
      expect(output).toBe('text "Plain text"');
    });

    it("renders nodes without name (role only)", () => {
      const tree: A11ySnapshotNode = {
        role: "main",
        ref: "e1",
      };

      const output = formatA11yTree(tree);
      expect(output).toBe("[e1] main");
    });
  });

  describe("property formatting", () => {
    it("includes value property", () => {
      const tree: A11ySnapshotNode = {
        role: "textbox",
        name: "Search",
        ref: "e1",
        value: "hello",
      };

      const output = formatA11yTree(tree);
      expect(output).toBe('[e1] textbox "Search" value="hello"');
    });

    it("includes checked=true but skips checked=false", () => {
      const checkedTrue: A11ySnapshotNode = {
        role: "checkbox",
        name: "Accept",
        ref: "e1",
        checked: true,
      };
      const checkedFalse: A11ySnapshotNode = {
        role: "checkbox",
        name: "Accept",
        ref: "e2",
        checked: false,
      };

      expect(formatA11yTree(checkedTrue)).toContain("checked");
      expect(formatA11yTree(checkedFalse)).not.toContain("checked");
    });

    it("includes disabled=true but skips disabled=false", () => {
      const tree: A11ySnapshotNode = {
        role: "button",
        name: "Go",
        ref: "e1",
        disabled: true,
      };

      expect(formatA11yTree(tree)).toContain("disabled");
    });

    it("includes expanded property when true", () => {
      const tree: A11ySnapshotNode = {
        role: "combobox",
        name: "Menu",
        ref: "e1",
        expanded: true,
      };

      expect(formatA11yTree(tree)).toContain("expanded");
    });

    it("includes selected=true but skips selected=false", () => {
      const tree: A11ySnapshotNode = {
        role: "option",
        name: "First",
        ref: "e1",
        selected: true,
      };

      expect(formatA11yTree(tree)).toContain("selected");
    });

    it("includes required=true but skips required=false", () => {
      const tree: A11ySnapshotNode = {
        role: "textbox",
        name: "Email",
        ref: "e1",
        required: true,
      };

      expect(formatA11yTree(tree)).toContain("required");
    });

    it("includes readonly=true but skips readonly=false", () => {
      const tree: A11ySnapshotNode = {
        role: "textbox",
        name: "ID",
        ref: "e1",
        readonly: true,
      };

      expect(formatA11yTree(tree)).toContain("readonly");
    });

    it("includes level property", () => {
      const tree: A11ySnapshotNode = {
        role: "heading",
        name: "Title",
        ref: "e1",
        level: 2,
      };

      const output = formatA11yTree(tree);
      expect(output).toBe('[e1] heading "Title" level=2');
    });

    it("includes value even when empty string", () => {
      const tree: A11ySnapshotNode = {
        role: "textbox",
        name: "Search",
        ref: "e1",
        value: "",
      };

      const output = formatA11yTree(tree);
      expect(output).toContain('value=""');
    });

    it("formats multiple properties on same line", () => {
      const tree: A11ySnapshotNode = {
        role: "textbox",
        name: "Email",
        ref: "e1",
        value: "test@example.com",
        required: true,
        disabled: true,
      };

      const output = formatA11yTree(tree);
      expect(output).toContain('value="test@example.com"');
      expect(output).toContain("required");
      expect(output).toContain("disabled");
    });
  });

  describe("maxDepth option", () => {
    it("limits tree depth and shows child count", () => {
      const tree: A11ySnapshotNode = {
        role: "WebArea",
        name: "Page",
        ref: "e1",
        children: [
          {
            role: "navigation",
            name: "Nav",
            ref: "e2",
            children: [
              { role: "link", name: "Home", ref: "e3" },
              { role: "link", name: "About", ref: "e4" },
            ],
          },
          {
            role: "main",
            ref: "e5",
            children: [
              { role: "heading", name: "Welcome", ref: "e6" },
            ],
          },
        ],
      };

      const output = formatA11yTree(tree, { maxDepth: 1 });
      const lines = output.split("\n");

      // Root at depth 0, children at depth 1 are shown
      expect(lines[0]).toBe('[e1] WebArea "Page"');
      expect(lines[1]).toContain("Nav");
      // Children of Nav should be cut off
      expect(lines[2]).toContain("... 2 children");
      expect(lines[3]).toContain("main");
      expect(lines[4]).toContain("... 1 children");
    });

    it("maxDepth 0 shows only root with child count", () => {
      const tree: A11ySnapshotNode = {
        role: "WebArea",
        name: "Page",
        ref: "e1",
        children: [
          { role: "heading", name: "H", ref: "e2" },
          { role: "button", name: "B", ref: "e3" },
        ],
      };

      const output = formatA11yTree(tree, { maxDepth: 0 });
      const lines = output.split("\n");

      expect(lines[0]).toBe('[e1] WebArea "Page"');
      expect(lines[1]).toContain("... 2 children");
      expect(lines).toHaveLength(2);
    });

    it("maxDepth greater than tree depth has no effect", () => {
      const tree: A11ySnapshotNode = {
        role: "WebArea",
        name: "Page",
        ref: "e1",
        children: [
          { role: "button", name: "OK", ref: "e2" },
        ],
      };

      const withDepth = formatA11yTree(tree, { maxDepth: 100 });
      const withoutDepth = formatA11yTree(tree);
      expect(withDepth).toBe(withoutDepth);
    });
  });

  describe("example output from ticket", () => {
    it("produces the expected compact format for a realistic tree", () => {
      const tree: A11ySnapshotNode = {
        role: "navigation",
        name: "Main Menu",
        ref: "e1",
        children: [
          { role: "link", name: "Dashboard", ref: "e2" },
          { role: "link", name: "Settings", ref: "e3" },
        ],
      };

      const output = formatA11yTree(tree);
      const lines = output.split("\n");

      expect(lines[0]).toBe('[e1] navigation "Main Menu"');
      expect(lines[1]).toBe('  [e2] link "Dashboard"');
      expect(lines[2]).toBe('  [e3] link "Settings"');
    });
  });

  describe("edge cases", () => {
    it("handles a single leaf node", () => {
      const tree: A11ySnapshotNode = {
        role: "button",
        name: "OK",
        ref: "e1",
      };

      const output = formatA11yTree(tree);
      expect(output).toBe('[e1] button "OK"');
    });

    it("handles node with empty children array", () => {
      const tree: A11ySnapshotNode = {
        role: "main",
        ref: "e1",
        children: [],
      };

      const output = formatA11yTree(tree);
      expect(output).toBe("[e1] main");
    });

    it("handles truncation markers from filterTree", () => {
      // filterTree produces marker nodes with role "truncation"
      // formatA11yTree should render them naturally
      const tree: A11ySnapshotNode = {
        role: "table",
        name: "Results",
        ref: "e1",
        children: [
          { role: "row", name: "Row 1", ref: "e2" },
          { role: "row", name: "Row 2", ref: "e3" },
          { role: "row", name: "Row 3", ref: "e4" },
          { role: "truncation", name: "... 22 more rows" },
        ],
      };

      const output = formatA11yTree(tree);
      const lines = output.split("\n");
      expect(lines).toHaveLength(5);
      expect(lines[4]).toBe("  ... 22 more rows");
    });
  });
});

// ── Integration: filterTree + formatA11yTree ────────────────────────────

describe("filterTree + formatA11yTree integration", () => {
  it("produces compact output from a realistic mock tree", () => {
    const tree: A11ySnapshotNode = {
      role: "WebArea",
      name: "GrowthOS Dashboard",
      ref: "e1",
      children: [
        {
          role: "generic",
          children: [
            {
              role: "navigation",
              name: "Main Menu",
              ref: "e2",
              children: [
                {
                  role: "link",
                  ref: "e3",
                  children: [
                    { role: "StaticText", name: "Dashboard" },
                  ],
                },
                {
                  role: "link",
                  ref: "e4",
                  children: [
                    { role: "StaticText", name: "Settings" },
                  ],
                },
              ],
            },
          ],
        },
        {
          role: "main",
          ref: "e5",
          children: [
            { role: "heading", name: "Welcome", ref: "e6", level: 1 },
            { role: "textbox", name: "Search", ref: "e7", value: "" },
            { role: "button", name: "Submit", ref: "e8" },
            {
              role: "table",
              name: "Results",
              ref: "e9",
              children: Array.from({ length: 25 }, (_, i) => ({
                role: "row" as const,
                name: `Row ${i + 1}`,
                ref: `e${10 + i}`,
              })),
            },
          ],
        },
      ],
    };

    const filtered = filterTree(tree);
    const output = formatA11yTree(filtered);
    const lines = output.split("\n");

    // generic wrapper should be unwrapped
    // StaticText should be collapsed into link names
    // rows should be truncated after 3
    expect(output).toContain("navigation");
    expect(output).toContain('link "Dashboard"');
    expect(output).toContain('link "Settings"');
    expect(output).toContain('heading "Welcome" level=1');
    expect(output).toContain('textbox "Search" value=""');
    expect(output).toContain('button "Submit"');
    expect(output).toContain("22 more rows");
    // Should NOT contain StaticText as a visible role
    expect(output).not.toContain("StaticText");
    // Should NOT contain "generic" as a role line
    expect(lines.some((l) => l.trim().includes("] generic") || l.trim().startsWith("generic"))).toBe(false);

    // Compact: should be much smaller than JSON
    const jsonSize = JSON.stringify(tree).length;
    expect(output.length).toBeLessThan(jsonSize);
  });
});
