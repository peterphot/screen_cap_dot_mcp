# Requirements: Integrate Click/Hover Indicators into CDP Helpers (PP-45)

## Status: COMPLETED

## Source
Linear ticket PP-45. Depends on PP-44 (click-indicator utility -- complete).

## Summary
Wire the `showClickIndicator` and `showHoverIndicator` functions from PP-44 into the 4 animate-capable functions in `cdp-helpers.ts` so indicators fire automatically during animated recordings.

## Requirements

### REQ-1: Click indicators in click functions
When `animate: true`, `clickByBackendNodeId()` and `clickAtCoordinates()` must call `showClickIndicator(x, y)` after `animateMouseTo()` and before mouse event dispatch.

**Acceptance Criteria:**
- `showClickIndicator(center.x, center.y)` is called in `clickByBackendNodeId` when animate=true
- `showClickIndicator(x, y)` is called in `clickAtCoordinates` when animate=true
- Call order: `animateMouseTo` -> `showClickIndicator` -> `Input.dispatchMouseEvent`
- `showClickIndicator` is `await`ed

### REQ-2: Hover indicators in hover functions
When `animate: true`, `hoverByBackendNodeId()` and `hoverAtCoordinates()` must call `showHoverIndicator(x, y)` after `animateMouseTo()` and before mouse event dispatch.

**Acceptance Criteria:**
- `showHoverIndicator(center.x, center.y)` is called in `hoverByBackendNodeId` when animate=true
- `showHoverIndicator(x, y)` is called in `hoverAtCoordinates` when animate=true
- Call order: `animateMouseTo` -> `showHoverIndicator` -> `Input.dispatchMouseEvent`
- `showHoverIndicator` is `await`ed

### REQ-3: No indicators when animate is false/undefined
When `animate` is false or not provided, no indicator functions should be called.

**Acceptance Criteria:**
- `showClickIndicator` is NOT called when animate is false or undefined
- `showHoverIndicator` is NOT called when animate is false or undefined
- Existing behavior is completely unchanged when animate is not set

### REQ-4: Import from click-indicator module
The indicator functions must be imported from `./util/click-indicator.js`.

**Acceptance Criteria:**
- Import statement: `import { showClickIndicator, showHoverIndicator } from "./util/click-indicator.js";`
- No schema changes to `InteractionOptions` or any other interface

## Edge Cases
- Indicator functions are async and swallow errors internally, so failures should not break the click/hover flow
- The indicators piggyback on the existing `animate` flag -- no new flags or parameters needed
- The indicator call is placed inside the `if (options?.animate)` block, so it only fires when animate is truthy

## In Scope / Out of Scope

### In Scope
- Adding indicator calls to the 4 animate-capable functions in cdp-helpers.ts
- Adding the import statement for click-indicator module
- Adding tests for indicator integration in cdp-helpers.test.ts
- Mocking click-indicator module in tests

### Out of Scope
- Modifying the click-indicator utility itself (PP-44, already complete)
- Changing the InteractionOptions interface or adding new parameters
- Modifying any other modules besides cdp-helpers.ts and its test file
- Flow file changes (PP-46, separate ticket)
