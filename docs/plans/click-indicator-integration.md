# Plan: Integrate Click/Hover Indicators into CDP Helpers (PP-45)

## Overview
Add `showClickIndicator` / `showHoverIndicator` calls to the 4 animate-capable functions in `cdp-helpers.ts`, guarded by the existing `animate` flag. This is the integration step that wires PP-44's utility into the CDP interaction layer.

## Architecture Impact
- **Modified**: `src/cdp-helpers.ts` (add 1 import + 4 single-line await calls)
- **Modified**: `src/__tests__/cdp-helpers.test.ts` (add mock + 8-10 new test cases)
- **No new files, no schema changes, no new dependencies**

## Task Breakdown

### [T001] Test: Write failing tests for click/hover indicator integration
**Type**: Test
**Files**: `src/__tests__/cdp-helpers.test.ts`

Add a mock for `../util/click-indicator.js` in the test setup (vi.hoisted + vi.mock).
Write tests covering:
1. `clickByBackendNodeId` with animate=true calls `showClickIndicator(50, 50)` after `animateMouseTo`
2. `clickAtCoordinates` with animate=true calls `showClickIndicator(150, 250)` after `animateMouseTo`
3. `hoverByBackendNodeId` with animate=true calls `showHoverIndicator(50, 50)` after `animateMouseTo`
4. `hoverAtCoordinates` with animate=true calls `showHoverIndicator(300, 400)` after `animateMouseTo`
5. `clickByBackendNodeId` without animate does NOT call `showClickIndicator`
6. `hoverByBackendNodeId` without animate does NOT call `showHoverIndicator`
7. `clickAtCoordinates` without animate does NOT call `showClickIndicator`
8. `hoverAtCoordinates` without animate does NOT call `showHoverIndicator`
9. Call order verification: animateMouseTo -> indicator -> mouse event dispatch

### [T002] Implement: Add indicator calls to 4 CDP helper functions
**Type**: Implement
**Files**: `src/cdp-helpers.ts`
**Depends on**: T001

Changes:
1. Add import: `import { showClickIndicator, showHoverIndicator } from "./util/click-indicator.js";`
2. In `clickByBackendNodeId()`: add `await showClickIndicator(center.x, center.y);` inside the `if (options?.animate)` block, after `animateMouseTo`
3. In `clickAtCoordinates()`: add `await showClickIndicator(x, y);` inside the `if (options?.animate)` block, after `animateMouseTo`
4. In `hoverByBackendNodeId()`: add `await showHoverIndicator(center.x, center.y);` inside the `if (options?.animate)` block, after `animateMouseTo`
5. In `hoverAtCoordinates()`: add `await showHoverIndicator(x, y);` inside the `if (options?.animate)` block, after `animateMouseTo`

## Verification
- `npm test` passes with all existing + new tests
- All 4 animate-capable functions call the correct indicator when animate=true
- No indicator calls when animate=false/undefined
- Call order is: animateMouseTo -> indicator -> mouse event
