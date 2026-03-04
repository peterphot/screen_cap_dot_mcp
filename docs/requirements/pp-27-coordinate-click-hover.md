# Requirements: PP-27 Coordinate-Based Click and Hover Tools

## Status: COMPLETED

## Summary
Add `browser_click_at(x, y)` and `browser_hover_at(x, y)` tools that dispatch mouse events at absolute viewport coordinates. This enables interaction with Canvas-rendered charts, custom visualizations, and elements that lack stable CSS selectors or a11y refs.

## Requirements

### REQ-1: clickAtCoordinates CDP helper
- Add `clickAtCoordinates(x: number, y: number): Promise<void>` to `src/cdp-helpers.ts`
- Dispatches `Input.dispatchMouseEvent` with `mousePressed` then `mouseReleased` at (x, y)
- Uses button: "left", clickCount: 1
- **Acceptance**: Mock CDP session receives correct `mousePressed` + `mouseReleased` calls at exact coordinates

### REQ-2: hoverAtCoordinates CDP helper
- Add `hoverAtCoordinates(x: number, y: number): Promise<void>` to `src/cdp-helpers.ts`
- Dispatches `Input.dispatchMouseEvent` with `mouseMoved` at (x, y)
- Uses button: "none", clickCount: 0
- **Acceptance**: Mock CDP session receives correct `mouseMoved` call at exact coordinates

### REQ-3: Coordinate validation
- Both helpers validate coordinates are non-negative numbers
- Throw RangeError for negative x or y
- No upper bound validation needed
- **Acceptance**: Negative coordinates throw RangeError

### REQ-4: browser_click_at tool
- Register `browser_click_at` tool in `src/tools/navigation.ts`
- Params: `x` (number), `y` (number), optional `label` (string)
- Calls `clickAtCoordinates(x, y)` from cdp-helpers
- Tool description guides LLMs to use for Canvas charts and elements without selectors
- **Acceptance**: Tool registered, calls helper, returns confirmation text

### REQ-5: browser_hover_at tool
- Register `browser_hover_at` tool in `src/tools/navigation.ts`
- Params: `x` (number), `y` (number), optional `label` (string)
- Calls `hoverAtCoordinates(x, y)` from cdp-helpers
- Tool description guides LLMs to use for Canvas charts and elements without selectors
- **Acceptance**: Tool registered, calls helper, returns confirmation text

### REQ-6: ClickAtStep flow schema
- Add `ClickAtStep` to `src/flow/schema.ts`
- Schema: `{ action: "click_at", x: number, y: number, label?: string }`
- x and y must be non-negative
- **Acceptance**: Valid schemas parse; invalid (negative coords) rejected

### REQ-7: HoverAtStep flow schema
- Add `HoverAtStep` to `src/flow/schema.ts`
- Schema: `{ action: "hover_at", x: number, y: number, label?: string }`
- x and y must be non-negative
- **Acceptance**: Valid schemas parse; invalid (negative coords) rejected

### REQ-8: Flow runner handles click_at and hover_at
- Update `src/flow/runner.ts` to handle `click_at` and `hover_at` step types
- `click_at` calls `clickAtCoordinates(step.x, step.y)`
- `hover_at` calls `hoverAtCoordinates(step.x, step.y)`
- **Acceptance**: Flow runner executes both step types correctly

## Edge Cases
- Negative coordinates: throw RangeError
- Zero coordinates (0, 0): valid, top-left corner
- Fractional coordinates (e.g., 100.5, 200.7): valid, CDP accepts floats
- Very large coordinates: valid (no upper bound per user decision)

## In Scope / Out of Scope

### In Scope
- CDP helper functions for coordinate-based click and hover
- MCP tool registration with Zod schemas
- Flow schema definitions
- Flow runner step execution
- Unit tests for all of the above

### Out of Scope
- Integration tests with real browser
- Double-click or right-click at coordinates
- Drag operations between coordinates
- Screenshot capture at coordinates
