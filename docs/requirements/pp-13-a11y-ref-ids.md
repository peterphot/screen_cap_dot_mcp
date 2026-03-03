# PP-13: Enhance a11y snapshot with ref IDs

Status: IN PROGRESS

## Summary
Modify `browser_a11y_snapshot` in `src/tools/observation.ts` to annotate the accessibility tree with short ref IDs ("e1", "e2", ...) and strip internal fields (`backendNodeId`, `loaderId`).

## Requirements

### R1: Annotate a11y tree nodes with ref IDs
- Add an exported `annotateTreeWithRefs(node)` function
- Recursively walks the a11y tree
- If a node has `backendNodeId` (number), call `allocateRef(backendNodeId)` and add `ref` field
- Delete `backendNodeId` from node (strip internal field)
- Delete `loaderId` from node if present (strip internal field)
- Recursively process `children` array if present
- Return the modified node

**Acceptance Criteria:**
- Nodes with `backendNodeId` get a `ref` field (e.g., "e1", "e2")
- `backendNodeId` is removed from all nodes in output
- `loaderId` is removed from all nodes in output
- Children are recursively processed

### R2: Integrate annotation into browser_a11y_snapshot handler
- Call `clearRefs()` before traversal
- Annotate tree with `annotateTreeWithRefs`
- Serialize annotated version

**Acceptance Criteria:**
- `clearRefs()` called at start of each snapshot
- Output JSON includes `ref` fields
- Internal fields stripped from output

### R3: Update tool description
- New description mentions ref IDs and their usage with other tools

**Acceptance Criteria:**
- Description includes "ref IDs" and example format

## Edge Cases
- Nodes without `backendNodeId` should pass through without a `ref` field
- Nodes without `loaderId` should not error when stripping
- Empty or null children arrays should be handled gracefully
- The root node should also be annotated if it has `backendNodeId`

## In Scope / Out of Scope

### In Scope
- `annotateTreeWithRefs` function
- Integration into `browser_a11y_snapshot` handler
- Updated tool description
- Test updates

### Out of Scope
- Changes to other tools (browser_click, browser_type, etc.)
- Changes to ref-store.ts itself
- Navigation-related ref clearing

## Source
Linear ticket: PP-13
