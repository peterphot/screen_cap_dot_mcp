/**
 * Compact accessibility tree formatter.
 *
 * Transforms a raw Puppeteer accessibility snapshot into a compact,
 * Playwright-MCP-style indented text format. Reduces output by ~90%
 * compared to JSON.stringify, making it far more LLM-context-friendly.
 *
 * Exports:
 * - A11ySnapshotNode: interface for accessibility tree nodes
 * - filterTree(node): pre-processing pass (generic unwrap, StaticText collapse, sibling truncation)
 * - formatA11yTree(node, options?): render tree to compact indented text
 */

// ── Types ───────────────────────────────────────────────────────────────

/** Shape of a node from the browser accessibility snapshot. */
export interface A11ySnapshotNode {
  role?: string;
  name?: string;
  ref?: string;
  backendNodeId?: number;
  loaderId?: string;
  children?: A11ySnapshotNode[];
  // Accessibility properties
  value?: string;
  checked?: boolean;
  selected?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  level?: number;
  required?: boolean;
  readonly?: boolean;
}

/** Options for formatA11yTree. */
export interface FormatOptions {
  /** Maximum depth to render. Children below this depth are summarised. */
  maxDepth?: number;
}

// ── Constants ────────────────────────────────────────────────────────────

/** Hard recursion cap to prevent stack overflow on deeply nested or malformed trees. */
const MAX_RECURSION_DEPTH = 512;

/** Maximum consecutive same-role siblings before truncation. */
const MAX_SAME_ROLE_SIBLINGS = 3;

/** Maximum iterations for unwrapping generic/none single-child wrappers. */
const MAX_UNWRAP_ITERATIONS = 100;

// ── filterTree ──────────────────────────────────────────────────────────

/**
 * Pre-processing pass over the accessibility tree.
 *
 * 1. Unwrap generic/none nodes with exactly one child.
 * 2. Collapse leaf StaticText nodes into their parent's name.
 * 3. Truncate repeated same-role sibling runs after MAX_SAME_ROLE_SIBLINGS.
 *
 * Returns a **new** tree -- the original is not mutated.
 */
export function filterTree(node: A11ySnapshotNode): A11ySnapshotNode {
  return filterNode(node, 0);
}

/**
 * Single-pass clone-and-filter: builds a new filtered node tree without
 * mutating the original. Combines deep clone + filter into one traversal.
 */
function filterNode(node: A11ySnapshotNode, depth: number): A11ySnapshotNode {
  if (depth > MAX_RECURSION_DEPTH) {
    return { ...node };
  }

  const clone: A11ySnapshotNode = { ...node };

  if (!node.children || node.children.length === 0) {
    // Preserve empty children array if present (clone already has it via spread)
    return clone;
  }

  // Recursively clone-and-filter children
  clone.children = node.children.map((child) => filterNode(child, depth + 1));

  // 1. Unwrap generic/none with single child
  clone.children = unwrapGenericNodes(clone.children);

  // 2. Collapse leaf StaticText into parent
  collapseStaticText(clone);

  // collapseStaticText may have deleted clone.children -- bail early if so
  if (!clone.children) {
    return clone;
  }

  // 3. Truncate same-role sibling runs
  clone.children = truncateSiblingRuns(clone.children);

  // Clean up empty children array
  if (clone.children.length === 0) {
    delete clone.children;
  }

  return clone;
}

/**
 * Replace generic/none single-child wrappers with their child.
 * Applies iteratively in case unwrapping reveals another wrapper.
 */
function unwrapGenericNodes(children: A11ySnapshotNode[]): A11ySnapshotNode[] {
  return children.map((child) => {
    let current = child;
    let iterations = 0;
    while (
      iterations < MAX_UNWRAP_ITERATIONS &&
      (current.role === "generic" || current.role === "none") &&
      current.children?.length === 1
    ) {
      current = current.children[0];
      iterations++;
    }
    return current;
  });
}

/**
 * If a node has exactly one child that is a leaf StaticText,
 * absorb the child's name into the parent (if parent has no name)
 * and remove the child.
 */
function collapseStaticText(node: A11ySnapshotNode): void {
  if (!node.children || node.children.length !== 1) return;

  const child = node.children[0];
  if (child.role !== "StaticText") return;
  // Must be a leaf (no children or empty children)
  if (child.children && child.children.length > 0) return;

  // Absorb name if parent has none
  if (!node.name && child.name) {
    node.name = child.name;
  }
  // Remove the StaticText child either way (it's redundant)
  delete node.children;
}

/**
 * Truncate consecutive runs of the same role to at most MAX_SAME_ROLE_SIBLINGS,
 * replacing the rest with a truncation marker node.
 */
function truncateSiblingRuns(children: A11ySnapshotNode[]): A11ySnapshotNode[] {
  const result: A11ySnapshotNode[] = [];
  let i = 0;

  while (i < children.length) {
    const role = children[i].role;
    // Find the run of consecutive same-role siblings
    let runEnd = i + 1;
    while (runEnd < children.length && children[runEnd].role === role) {
      runEnd++;
    }

    const runLength = runEnd - i;

    if (runLength > MAX_SAME_ROLE_SIBLINGS) {
      // Keep first MAX_SAME_ROLE_SIBLINGS, add truncation marker
      for (let j = 0; j < MAX_SAME_ROLE_SIBLINGS; j++) {
        result.push(children[i + j]);
      }
      const remaining = runLength - MAX_SAME_ROLE_SIBLINGS;
      result.push({
        role: "truncation",
        name: `... ${remaining} more ${role}`,
      });
    } else {
      // Keep all
      for (let j = i; j < runEnd; j++) {
        result.push(children[j]);
      }
    }

    i = runEnd;
  }

  return result;
}

// ── formatA11yTree ──────────────────────────────────────────────────────

/** Boolean properties that are only displayed when true. */
const BOOL_PROPS = [
  "checked",
  "selected",
  "disabled",
  "expanded",
  "required",
  "readonly",
] as const;

/** Memoized indent strings to avoid repeated string construction. */
const indentCache: string[] = [''];
function getIndent(depth: number): string {
  while (indentCache.length <= depth) {
    indentCache.push(indentCache[indentCache.length - 1] + '  ');
  }
  return indentCache[depth];
}

/** Escape embedded quotes, newlines, and carriage returns to preserve one-line-per-node format. */
function escapeString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

/**
 * Render an accessibility tree node to compact indented text.
 *
 * Format: `[ref] role "name" key=value`
 *   - One node per line, 2-space indent per depth level
 *   - Only non-default properties are shown
 *   - Respects maxDepth (children below cutoff replaced with `... N children`)
 */
export function formatA11yTree(
  node: A11ySnapshotNode,
  options?: FormatOptions,
): string {
  const lines: string[] = [];
  renderNode(node, 0, lines, options?.maxDepth);
  return lines.join("\n");
}

function renderNode(
  node: A11ySnapshotNode,
  depth: number,
  lines: string[],
  maxDepth?: number,
): void {
  if (depth > MAX_RECURSION_DEPTH) return;

  const indent = getIndent(depth);

  // Special handling for truncation markers from filterTree
  if (node.role === "truncation" && node.name) {
    lines.push(`${indent}${node.name}`);
    return;
  }

  // Build the line: [ref] role "name" key=value ...
  const parts: string[] = [];

  if (node.ref) {
    parts.push(`[${node.ref}]`);
  }

  if (node.role) {
    parts.push(node.role);
  }

  if (node.name !== undefined && node.name !== "") {
    parts.push(`"${escapeString(node.name)}"`);
  }

  // Append non-default properties
  // value is a string property -- always show (even empty string)
  if (node.value !== undefined) {
    parts.push(`value="${escapeString(node.value)}"`);
  }

  for (const prop of BOOL_PROPS) {
    if (node[prop] === true) {
      parts.push(prop);
    }
  }

  if (node.level !== undefined) {
    parts.push(`level=${node.level}`);
  }

  lines.push(`${indent}${parts.join(" ")}`);

  // Handle children
  const children = node.children;
  if (!children || children.length === 0) return;

  if (maxDepth !== undefined && depth >= maxDepth) {
    const count = children.length;
    const noun = count === 1 ? "child" : "children";
    lines.push(`${getIndent(depth + 1)}... ${count} ${noun}`);
    return;
  }

  for (const child of children) {
    renderNode(child, depth + 1, lines, maxDepth);
  }
}
