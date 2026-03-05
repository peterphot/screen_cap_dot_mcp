# Plan: Click/Hover Visual Indicator Utility (PP-44)

## Architecture

### New Files
- `src/util/click-indicator.ts` — Utility module exporting `showClickIndicator` and `showHoverIndicator`
- `src/__tests__/click-indicator.test.ts` — Unit tests

### Design
The module accepts a Page-like object (with an `evaluate` method) and viewport coordinates. It calls `page.evaluate()` to inject:
1. A `<style>` tag (idempotent, checked by ID) containing `@keyframes` for dot + ring animations
2. A `<div>` overlay at the given (x, y) with `position: fixed`, `pointer-events: none`, `z-index: 2147483647`
3. Auto-cleanup via `animationend` event listener + fallback `setTimeout`

This follows the same pattern as `cdp-helpers.ts` which uses `ensurePage()` to get a Page object with `evaluate`.

### Dependencies
- None (new standalone utility)
- Uses Puppeteer Page type for the `page` parameter

## Task Breakdown

### T001: Write failing tests for click-indicator
**Type**: Test
**File**: `src/__tests__/click-indicator.test.ts`
**Tests**:
- `showClickIndicator` calls `page.evaluate()` with a function and correct coordinates
- `showHoverIndicator` calls `page.evaluate()` with a function and correct coordinates
- Both return resolved promises
- Coordinates are passed through to the evaluate function

### T002: Implement click-indicator utility
**Type**: Implement
**File**: `src/util/click-indicator.ts`
**Depends on**: T001
**Implementation**:
- Export `showClickIndicator(page, x, y)` — blue dot + ring, 400ms
- Export `showHoverIndicator(page, x, y)` — amber dot + ring, 300ms
- Both use `page.evaluate()` to inject DOM elements with CSS animations
- Style tag injected idempotently
- Auto-cleanup via animationend + setTimeout fallback
