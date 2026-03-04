/**
 * Ref-store module — maps sequential ref IDs ("e1", "e2", ...) to
 * Chrome DevTools backendNodeId values.
 *
 * This is a leaf module with zero dependencies. Module-level state
 * persists in ESM scope. Called by snapshot and navigation code to
 * let the LLM refer to page elements by short, stable handles.
 */

// ── Module-level state ─────────────────────────────────────────────────

/** Maps ref string (e.g. "e1") to backendNodeId. */
const refs = new Map<string, number>();

/** Counter for the next ref ID. Starts at 0; first ref is "e1". */
let nextId = 0;

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Reset the ref map and counter.
 * Called on each snapshot and on navigation.
 */
export function clearRefs(): void {
  refs.clear();
  nextId = 0;
}

/**
 * Allocate the next sequential ref for a given backendNodeId.
 * Returns the ref string (e.g. "e1", "e2", "e3").
 */
export function allocateRef(backendNodeId: number): string {
  if (!Number.isInteger(backendNodeId) || backendNodeId < 0) {
    throw new RangeError(`Invalid backendNodeId: ${backendNodeId}`);
  }
  nextId += 1;
  const ref = `e${nextId}`;
  refs.set(ref, backendNodeId);
  return ref;
}

/**
 * Resolve a ref string to its backendNodeId.
 * Returns `undefined` if the ref is stale or was never allocated.
 */
export function resolveRef(ref: string): number | undefined {
  return refs.get(ref);
}

/**
 * Whether any refs have been allocated.
 */
export function hasRefs(): boolean {
  return refs.size > 0;
}

// ── Metadata types ──────────────────────────────────────────────────

/** Rich metadata for a ref. Currently contains backendNodeId;
 *  will be extended with bounding box data for annotated screenshots. */
export interface RefMetadata {
  backendNodeId: number;
}

// ── Metadata API ────────────────────────────────────────────────────

/**
 * Resolve a ref string to its metadata.
 * Returns `undefined` if the ref is stale or was never allocated.
 */
export function resolveRefMetadata(ref: string): RefMetadata | undefined {
  const backendNodeId = refs.get(ref);
  if (backendNodeId === undefined) return undefined;
  return { backendNodeId };
}

/**
 * Return a snapshot (shallow copy) of all ref mappings.
 * Mutations to the returned map do not affect the internal store.
 */
export function getAllRefs(): Map<string, number> {
  return new Map(refs);
}
