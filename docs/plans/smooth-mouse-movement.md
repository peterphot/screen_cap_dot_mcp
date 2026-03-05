# Plan: Smooth Mouse Movement for Demo Recordings (PP-33)

## Overview

Add smooth, animated cursor movement between interaction targets during flow execution and recording. The mouse follows a natural bezier curve path instead of teleporting between elements.

## Architecture

### New Module
- `src/util/mouse-animator.ts` — Pure bezier interpolation math + CDP mouse dispatch

### Modified Modules
- `src/flow/schema.ts` — Add optional `animate` field to click/hover/click_at/hover_at steps
- `src/cdp-helpers.ts` — Add optional `animate` parameter to click/hover functions
- `src/flow/runner.ts` — Enable animation when recording is active

## Task Breakdown

### [T001] Test: mouse-animator bezier math and CDP dispatch
- **Type**: Test
- **File**: `src/__tests__/mouse-animator.test.ts`
- **Description**: Write tests for the mouse-animator utility covering:
  - Bezier interpolation produces correct number of points
  - Points start at origin and end at target
  - Duration scales with distance (short moves = fast, long moves = slower)
  - Ease-in-out timing function (slow start, fast middle, slow end)
  - Control points create a curved (not straight) path
  - CDP `Input.dispatchMouseEvent` called with `mouseMoved` for each step
  - Last known position tracking (module-level state)
  - Default options (duration 300-500ms, 20-30 steps)
- **Dependencies**: None

### [T002] Implement: mouse-animator utility
- **Type**: Implement
- **File**: `src/util/mouse-animator.ts`
- **Description**: Implement the mouse-animator module:
  - `animateMouseTo(x, y, options?)` — main entry point
  - Cubic bezier interpolation with control points for gentle arc
  - Ease-in-out easing function
  - Distance-based duration calculation (300-500ms range)
  - Module-level last position tracking
  - CDP `Input.dispatchMouseEvent` dispatch loop
  - `resetMousePosition()` for testing
- **Dependencies**: T001

### [T003] Test + Implement: schema `animate` field
- **Type**: Test + Implement
- **File**: `src/flow/schema.ts`, `src/__tests__/flow-schema.test.ts`
- **Description**: Add optional `animate: boolean` to ClickStep, HoverStep, ClickAtStep, HoverAtStep schemas. Add tests verifying the field is accepted and optional.
- **Dependencies**: None (can run parallel to T001/T002 but keeping sequential for simplicity)

### [T004] Test + Implement: cdp-helpers `animate` integration
- **Type**: Test + Implement
- **Files**: `src/cdp-helpers.ts`, `src/__tests__/cdp-helpers.test.ts`
- **Description**: Add optional `animate` parameter to `clickByBackendNodeId`, `hoverByBackendNodeId`, `clickAtCoordinates`, `hoverAtCoordinates`. When `animate` is true, call `animateMouseTo` before dispatching the click/hover events.
- **Dependencies**: T002

### [T005] Implement: runner animation when recording
- **Type**: Implement
- **File**: `src/flow/runner.ts`
- **Description**: When `shouldRecord` is true in FlowRunner, pass `animate: true` to click/hover calls by default. Respect per-step `animate` override (step.animate === false disables).
- **Dependencies**: T003, T004

## Success Criteria
- All existing tests continue to pass
- New tests cover bezier math, CDP dispatch, schema validation, and integration
- `npx vitest run` passes cleanly
- Animation defaults to off for non-recorded runs
- Animation defaults to on for recorded runs
- Per-step override works
