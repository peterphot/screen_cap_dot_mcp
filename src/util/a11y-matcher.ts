/**
 * Accessibility-based element matcher for flow DSL.
 *
 * Resolves elements at runtime using accessibility properties (role + name)
 * instead of brittle CSS selectors or ephemeral ref IDs. This makes saved
 * flows resilient to DOM changes.
 *
 * Exports:
 * - MatchSelector: interface for match criteria
 * - matchA11yNode: find a node in an a11y tree by role/name
 * - resolveMatch: take a fresh a11y snapshot, match, allocate a ref
 */

import type { A11ySnapshotNode } from "./a11y-formatter.js";
import { ensurePage } from "../browser.js";
import { allocateRef } from "../ref-store.js";

// ── Types ───────────────────────────────────────────────────────────────

/** Criteria for matching an accessibility tree node. */
export interface MatchSelector {
  /** ARIA role to match (case-insensitive). */
  role?: string;
  /** Name substring to match (case-insensitive). */
  name?: string;
  /** Zero-based index when multiple nodes match (default: 0 = first). */
  index?: number;
}

/** Result of a successful match. */
export interface MatchResult {
  /** The matched accessibility tree node. */
  node: A11ySnapshotNode;
  /** Total number of nodes that matched the criteria. */
  matchCount: number;
}

/** Result of resolving a match to a ref. */
export interface ResolvedMatch {
  /** The allocated ref ID (e.g. "e1"). */
  ref: string;
  /** The backendNodeId of the matched element. */
  backendNodeId: number;
  /** Total number of nodes that matched the criteria. */
  matchCount: number;
}

/** Options for resolveMatch. */
export interface ResolveMatchOptions {
  /** Pre-fetched a11y snapshot to use (avoids a redundant snapshot call). */
  snapshot?: A11ySnapshotNode;
}

// ── matchA11yNode ───────────────────────────────────────────────────────

/**
 * Walk an accessibility tree and find nodes matching the given criteria.
 *
 * Matching rules:
 * - role: case-insensitive exact match
 * - name: case-insensitive substring match
 * - Both role and name must match if both are provided
 * - At least one of role or name must be specified
 *
 * @returns The matched node and total match count, or null if no match
 * @throws Error if neither role nor name is provided
 */
export function matchA11yNode(
  tree: A11ySnapshotNode,
  criteria: MatchSelector,
): MatchResult | null {
  if (!criteria.role && !criteria.name) {
    throw new Error("match requires at least one of role or name");
  }

  const matches: A11ySnapshotNode[] = [];
  collectMatches(tree, criteria, matches);

  if (matches.length === 0) {
    return null;
  }

  const index = criteria.index ?? 0;
  if (index < 0 || index >= matches.length) {
    return null;
  }

  return { node: matches[index], matchCount: matches.length };
}

// ── resolveMatch ────────────────────────────────────────────────────────

/**
 * Take a fresh a11y snapshot, find a matching node, and allocate a ref.
 *
 * This is the high-level API used by FlowRunner to resolve `match` selectors
 * at runtime.
 *
 * @param criteria - Match criteria (role, name, index)
 * @param options - Optional pre-fetched snapshot
 * @returns Resolved match with ref and backendNodeId
 * @throws Error with descriptive message if no match found or node has no backendNodeId
 */
export async function resolveMatch(
  criteria: MatchSelector,
  options?: ResolveMatchOptions,
): Promise<ResolvedMatch> {
  // Get a11y snapshot (use provided one or take fresh)
  let snapshot: A11ySnapshotNode;
  if (options?.snapshot) {
    snapshot = options.snapshot;
  } else {
    const page = await ensurePage();
    const raw = await page.accessibility.snapshot({
      interestingOnly: false,
    });
    if (!raw) {
      throw new Error("page.accessibility.snapshot() returned null — the page may not be ready.");
    }
    snapshot = raw as A11ySnapshotNode;
  }

  // Find the match — use early-exit limit when we don't need the full count.
  if (!criteria.role && !criteria.name) {
    throw new Error("match requires at least one of role or name");
  }

  const index = criteria.index ?? 0;
  const limit = index + 1;
  const matches: A11ySnapshotNode[] = [];
  collectMatches(snapshot, criteria, matches, 0, limit);

  if (matches.length === 0 || index < 0 || index >= matches.length) {
    const parts: string[] = [];
    if (criteria.role) parts.push(`role="${criteria.role}"`);
    if (criteria.name) parts.push(`name="${criteria.name}"`);
    if (criteria.index !== undefined) parts.push(`index=${criteria.index}`);
    throw new Error(
      `No a11y node found matching { ${parts.join(", ")} }. ` +
        "The page content may have changed. Try a different match criteria.",
    );
  }

  const matched = matches[index];

  // Validate the matched node has a backendNodeId
  if (typeof matched.backendNodeId !== "number") {
    throw new Error(
      `Matched node (role="${matched.role}", name="${matched.name}") ` +
        "has no backendNodeId. The node may not be interactable.",
    );
  }

  // Allocate a ref for the matched node
  const ref = allocateRef(matched.backendNodeId);

  return {
    ref,
    backendNodeId: matched.backendNodeId,
    matchCount: matches.length,
  };
}

// ── Internal helpers ────────────────────────────────────────────────────

/** Hard recursion cap to prevent stack overflow. */
const MAX_DEPTH = 512;

/**
 * Recursively collect nodes matching the criteria.
 *
 * @param limit - Stop collecting once this many matches are found (0 = unlimited).
 */
function collectMatches(
  node: A11ySnapshotNode,
  criteria: MatchSelector,
  matches: A11ySnapshotNode[],
  depth = 0,
  limit = 0,
): void {
  if (depth > MAX_DEPTH) return;
  if (limit > 0 && matches.length >= limit) return;

  if (nodeMatches(node, criteria)) {
    matches.push(node);
    if (limit > 0 && matches.length >= limit) return;
  }

  if (node.children) {
    for (const child of node.children) {
      if (limit > 0 && matches.length >= limit) return;
      collectMatches(child, criteria, matches, depth + 1, limit);
    }
  }
}

/**
 * Check if a single node matches the criteria.
 */
function nodeMatches(node: A11ySnapshotNode, criteria: MatchSelector): boolean {
  // Role: case-insensitive exact match
  if (criteria.role) {
    if (!node.role || node.role.toLowerCase() !== criteria.role.toLowerCase()) {
      return false;
    }
  }

  // Name: case-insensitive substring match
  if (criteria.name) {
    if (
      node.name === undefined ||
      !node.name.toLowerCase().includes(criteria.name.toLowerCase())
    ) {
      return false;
    }
  }

  return true;
}
