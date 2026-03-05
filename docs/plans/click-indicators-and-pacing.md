# Plan: Visual Click/Hover Indicators + Reduced Sleep Durations

## Overview

Add visual feedback (dot + ring pulse) at click/hover points during animated recordings, and reduce sleep durations in the channel-roi-demo flow by ~30% for tighter pacing.

## Background

The channel-roi-demo flow recording feels disjointed due to long sleep pauses, and it's hard to track where clicks/hovers happen. The smooth mouse animation (`mouse-animator.ts`) already moves the cursor along bezier curves, but there's no visual feedback at the destination.

## Architecture

### New Module
- `src/util/click-indicator.ts` — Injects temporary DOM overlay at click/hover coordinates during animated recording

### Modified Modules
- `src/cdp-helpers.ts` — Add indicator calls in the 4 animate-capable functions
- `flows/channel-roi-demo.json` — Reduce sleep durations by ~30%

## Visual Design

### Click Indicator (dot + ring pulse)
- Small solid blue dot appears at click point
- A ring pulses outward from the dot and fades
- Duration: ~400ms, CSS `@keyframes` with `ease-out`
- Color: blue (`rgba(59, 130, 246, ...)`)

### Hover Indicator
- Smaller amber dot + subtler ring pulse
- Duration: ~300ms
- Color: amber (`rgba(251, 191, 36, ...)`)

### Key Design Decisions
- `position: fixed` — CDP coordinates are viewport-relative
- `pointer-events: none` + `z-index: 2147483647` — never blocks clicks
- CSS `@keyframes` — runs on compositor thread for smooth rendering
- Style tag injected once with idempotent `id` check
- Auto-cleanup via `animationend` listener + fallback `setTimeout`
- Piggybacks on existing `animate` flag — no schema changes needed

## Task Breakdown

### PP-44: Add click/hover visual indicator utility

**Type**: New file + Tests
**Files**: `src/util/click-indicator.ts`, `src/__tests__/click-indicator.test.ts`

Create `showClickIndicator(x, y)` and `showHoverIndicator(x, y)` functions that inject a temporary DOM overlay with CSS animation at the given viewport coordinates.

Implementation:
- `page.evaluate()` injects a `<div>` with CSS animation
- Style block injected idempotently (checked by element id)
- Click: blue dot + expanding ring, 400ms
- Hover: amber dot + subtler ring, 300ms
- Cleanup via `animationend` + fallback `setTimeout`

Tests:
- `showClickIndicator` calls `page.evaluate()` with correct coordinates
- `showHoverIndicator` calls `page.evaluate()` with correct coordinates
- Both return resolved promises

### PP-45: Integrate click/hover indicators into CDP helpers

**Type**: Modify + Test update
**Files**: `src/cdp-helpers.ts`, `src/__tests__/cdp-helpers.test.ts`
**Depends on**: PP-44

Add indicator calls in the 4 animate-capable functions (after `animateMouseTo`, before mouse event dispatch):

- `clickByBackendNodeId()` (line ~138) → add `showClickIndicator()`
- `clickAtCoordinates()` (line ~260) → add `showClickIndicator()`
- `hoverByBackendNodeId()` (line ~222) → add `showHoverIndicator()`
- `hoverAtCoordinates()` (line ~305) → add `showHoverIndicator()`

Tests:
- Click with `animate: true` calls `showClickIndicator` after `animateMouseTo`
- Hover with `animate: true` calls `showHoverIndicator`
- Without animate, indicators are NOT called
- Verify call order: animateMouseTo → indicator → mouse event

### PP-46: Reduce channel-roi-demo sleep durations by ~30%

**Type**: JSON modification
**File**: `flows/channel-roi-demo.json`
**Independent of PP-44/PP-45**

Reduce all sleep durations by ~30%:
- Page loads: 8000→5500ms, 10000→7000ms
- Visual pauses: 3000→2000ms, 2500→1750ms
- Transitions: 2000→1400ms, 1500→1000ms
- Brief pauses: 1000→700ms
- Keep 500ms minimums as-is

## Verification

1. `npm test` passes (all existing + new tests)
2. Run channel-roi-demo flow with recording enabled
3. Blue dot+ring appears at each click point
4. Amber dot+ring appears at each hover point
5. Indicators don't interfere with click targets
6. Pacing feels tighter with reduced sleeps
