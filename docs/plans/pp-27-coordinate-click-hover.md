# Plan: PP-27 Coordinate-Based Click and Hover Tools

## Tasks

### [T001] Test + Implement: CDP helpers (clickAtCoordinates, hoverAtCoordinates)
- **Files**: `src/cdp-helpers.ts`, `src/__tests__/cdp-helpers.test.ts`
- **TDD**: Write tests first, then implement
- **Tests**:
  - clickAtCoordinates dispatches mousePressed + mouseReleased at exact (x, y)
  - hoverAtCoordinates dispatches mouseMoved at exact (x, y)
  - Both reject negative coordinates with RangeError
  - Zero coordinates are valid
- **Implementation**:
  - Add coordinate validation helper
  - Add clickAtCoordinates function
  - Add hoverAtCoordinates function
  - Export both from cdp-helpers.ts

### [T002] Test + Implement: Navigation tools (browser_click_at, browser_hover_at)
- **Files**: `src/tools/navigation.ts`, `src/__tests__/navigation.test.ts`
- **Depends on**: T001
- **TDD**: Write tests first, then implement
- **Tests**:
  - browser_click_at registered on server with correct schema
  - browser_hover_at registered on server with correct schema
  - Both call CDP helpers and return success text
  - Both handle errors gracefully (return error text, never throw)
  - Tool count increases from 9 to 11
- **Implementation**:
  - Import clickAtCoordinates, hoverAtCoordinates from cdp-helpers
  - Register browser_click_at tool with z.number() x, y params + optional label
  - Register browser_hover_at tool with z.number() x, y params + optional label
  - LLM-guiding descriptions mentioning Canvas, visualizations, coordinate-based interaction

### [T003] Test + Implement: Flow schemas (ClickAtStep, HoverAtStep)
- **Files**: `src/flow/schema.ts`, `src/__tests__/flow-schema.test.ts`
- **Depends on**: None (parallel-safe but sequential for simplicity)
- **TDD**: Write tests first, then implement
- **Tests**:
  - click_at step validates with x, y, optional label
  - hover_at step validates with x, y, optional label
  - Both reject negative coordinates
  - Both reject missing x or y
- **Implementation**:
  - Add ClickAtStep schema with action: "click_at", x: nonneg number, y: nonneg number, label?: string
  - Add HoverAtStep schema with action: "hover_at", x: nonneg number, y: nonneg number, label?: string
  - Add both to FlowStepSchema union

### [T004] Test + Implement: Flow runner (click_at, hover_at step handling)
- **Files**: `src/flow/runner.ts`, `src/__tests__/flow-runner.test.ts`
- **Depends on**: T001, T003
- **TDD**: Write tests first, then implement
- **Tests**:
  - Flow runner executes click_at step (calls clickAtCoordinates)
  - Flow runner executes hover_at step (calls hoverAtCoordinates)
- **Implementation**:
  - Import clickAtCoordinates, hoverAtCoordinates in runner
  - Add case "click_at" and case "hover_at" in executeStep switch
