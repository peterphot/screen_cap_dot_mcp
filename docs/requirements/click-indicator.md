# Requirements: Click/Hover Visual Indicator Utility (PP-44)

## Status: COMPLETED

## Overview
Create a utility module that injects temporary DOM overlays at click/hover coordinates during animated recordings, providing visual feedback of where user actions happen.

## Requirements

### R1: showClickIndicator function
- Export `showClickIndicator(page, x, y)` from `src/util/click-indicator.ts`
- Injects a blue dot (`rgba(59, 130, 246, ...)`) with expanding ring pulse at viewport (x, y)
- Animation duration: 400ms with CSS `@keyframes` and `ease-out`
- Uses `page.evaluate()` to inject a `<div>` with CSS animation
- Returns a resolved Promise when injection is complete

**Acceptance Criteria:**
- Calls `page.evaluate()` with correct x, y coordinates
- Overlay uses `position: fixed` (CDP coordinates are viewport-relative)
- Overlay uses `pointer-events: none` (never blocks clicks)
- Overlay uses `z-index: 2147483647` (maximum z-index)
- CSS animation runs on compositor thread
- Overlay auto-removes via `animationend` listener + fallback `setTimeout`
- Returns a resolved Promise

### R2: showHoverIndicator function
- Export `showHoverIndicator(page, x, y)` from `src/util/click-indicator.ts`
- Injects an amber dot (`rgba(251, 191, 36, ...)`) with subtler ring pulse at viewport (x, y)
- Animation duration: 300ms
- Same injection mechanism as click indicator

**Acceptance Criteria:**
- Calls `page.evaluate()` with correct x, y coordinates
- Same overlay properties as click indicator (fixed, pointer-events: none, max z-index)
- Returns a resolved Promise

### R3: Idempotent style injection
- Style tag injected once with idempotent `id` check
- Subsequent calls reuse existing style tag

### R4: Auto-cleanup
- Overlays auto-remove after animation completes via `animationend` listener
- Fallback `setTimeout` ensures cleanup even if `animationend` does not fire

## Edge Cases
- Multiple rapid calls should not leak DOM elements (each cleans up independently)
- Style tag injection is idempotent (check by element ID before injecting)
- Page with existing high z-index elements should not obscure indicator

## In Scope / Out of Scope

### In Scope
- `src/util/click-indicator.ts` — new utility module
- `src/__tests__/click-indicator.test.ts` — unit tests
- Blue click indicator (dot + ring pulse, 400ms)
- Amber hover indicator (dot + subtler ring, 300ms)

### Out of Scope
- Integration into `cdp-helpers.ts` (that is PP-45)
- Flow pacing changes (that is PP-46)
- End-to-end browser tests (unit tests with mocked page only)
