# PP-22: Expand ref-store metadata and add bounding box helpers

## Status: COMPLETED

## Requirements

### R1: resolveRefMetadata()
- Returns `{ backendNodeId }` for valid refs
- Returns `undefined` for invalid/stale refs
- Keeps existing `resolveRef()` for backward compatibility

### R2: getAllRefs()
- Returns a snapshot (copy) of all ref mappings as `Map<string, number>`
- Mutations to the returned map do not affect the internal store

### R3: getElementBoundingBox()
- Calls `DOM.getContentQuads({ backendNodeId })` WITHOUT calling `DOM.scrollIntoViewIfNeeded`
- If quads are empty or call fails, returns `null`
- Computes bounding box from quad points: `{ x, y, width, height }`
- Returns `null` if bounding box is entirely outside viewport bounds

### R4: batchGetBoundingBoxes()
- Uses `Promise.allSettled()` to get bounding boxes for multiple elements in parallel
- Returns `Map<number, { x: number; y: number; width: number; height: number } | null>`
- Failed/off-screen elements map to `null`

### R5: getViewportBounds()
- Gets viewport dimensions from page
- Used to filter out off-screen elements

## Edge Cases
- Empty refs map for getAllRefs()
- Single-element batch for batchGetBoundingBoxes()
- Empty array for batchGetBoundingBoxes()
- Element entirely off-screen (negative coords or beyond viewport)
- Element partially off-screen (should still return bounding box)
- CDP call failure (stale node, etc.)

## In Scope / Out of Scope

### In Scope
- RefMetadata type and resolveRefMetadata()
- getAllRefs() snapshot function
- getElementBoundingBox() non-scrolling variant
- batchGetBoundingBoxes() parallel processing
- getViewportBounds() helper
- Tests for all new functions

### Out of Scope
- Annotated screenshot feature (future ticket)
- Modifying existing getElementCenter() behavior
- Any UI changes
