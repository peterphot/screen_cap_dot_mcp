/**
 * Shared validation for tools that accept either a CSS selector or a ref ID.
 */
import { resolveRef } from "../ref-store.js";

/** Result of validating selector-or-ref input. */
export type SelectorOrRefResult =
  | { type: "selector"; value: string }
  | { type: "ref"; backendNodeId: number }
  | { error: string };

/**
 * Validate that exactly one of selector or ref is provided.
 * If ref is provided, resolves it to a backendNodeId.
 */
export function validateSelectorOrRef(selector?: string, ref?: string): SelectorOrRefResult {
  if (selector && ref) return { error: "Provide either selector or ref, not both." };
  if (!selector && !ref) return { error: "Provide either a CSS selector or a ref from browser_a11y_snapshot." };
  if (ref) {
    const nodeId = resolveRef(ref);
    if (nodeId === undefined) return { error: `Stale or invalid ref "${ref}". Take a new browser_a11y_snapshot to get fresh refs.` };
    return { type: "ref", backendNodeId: nodeId };
  }
  return { type: "selector", value: selector! };
}
