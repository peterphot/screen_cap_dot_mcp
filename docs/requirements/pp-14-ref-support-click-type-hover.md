# Requirements: PP-14 - Add ref support to click/type and add browser_hover tool

## Source
Linear ticket PP-14

## Requirements

### R1: browser_click ref support
- Modify browser_click to accept optional `ref` parameter as alternative to `selector`
- Exactly one of selector/ref must be provided (error if both or neither)
- Ref path: resolveRef(ref) -> clickByBackendNodeId(backendNodeId)
- Stale ref returns descriptive error suggesting new a11y snapshot
- Selector path: unchanged (existing page.waitForSelector + page.click)
- **Acceptance criteria**: browser_click works with ref, returns error for both/neither/stale

### R2: browser_type ref support
- Same pattern as browser_click: optional ref, exactly-one-of validation
- Ref path: resolveRef(ref) -> typeByBackendNodeId(backendNodeId, text, clear)
- Selector path: unchanged
- **Acceptance criteria**: browser_type works with ref, returns error for both/neither/stale

### R3: browser_hover new tool
- New tool: browser_hover
- Schema: { selector: z.string().optional(), ref: z.string().optional() }
- Validation: exactly one of selector/ref
- Selector path: page.hover(selector)
- Ref path: resolveRef(ref) -> hoverByBackendNodeId(backendNodeId)
- **Acceptance criteria**: browser_hover works with both selector and ref paths

### R4: clearRefs on navigation
- browser_navigate must call clearRefs() before page.goto()
- Navigation invalidates all refs
- **Acceptance criteria**: clearRefs() is called when browser_navigate is invoked

### R5: Validation helper
- Create a validateSelectorOrRef() helper function for the exactly-one-of pattern
- Used by browser_click, browser_type, and browser_hover
- **Acceptance criteria**: Helper correctly validates and returns typed discriminated union

### R6: Tool count update
- Module docblock updated: 8 -> 9 tools, add browser_hover
- Tool registration count in tests updated to 9
- **Acceptance criteria**: Tests verify 9 tools registered

## Edge Cases
- Both selector and ref provided -> error
- Neither selector nor ref provided -> error
- Stale/invalid ref -> descriptive error with guidance to take new snapshot
- Ref resolves to valid backendNodeId -> CDP operation succeeds

## In Scope / Out of Scope

### In Scope
- Modifying browser_click and browser_type schemas and handlers
- Adding browser_hover tool
- Calling clearRefs() in browser_navigate
- Validation helper function
- Unit tests for all new behavior

### Out of Scope
- Modifying ref-store.ts or cdp-helpers.ts (already implemented)
- Integration tests with real browser
- Changes to other tools (browser_select, browser_evaluate, etc.)

## Status: COMPLETED
