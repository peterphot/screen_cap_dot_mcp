# Plan: PP-14 - Add ref support to click/type and add browser_hover tool

## Overview
Modify browser_click and browser_type in src/tools/navigation.ts to accept an optional ref parameter as an alternative to selector. Add a new browser_hover tool. Clear refs on navigation.

## Tasks

### T001 [Test] Write failing tests
- Add mocks for ref-store.js and cdp-helpers.js
- Test browser_click with ref (resolves and clicks via CDP)
- Test browser_type with ref (resolves and types via CDP)
- Test validation: error when both selector and ref provided
- Test validation: error when neither selector nor ref provided
- Test stale ref returns descriptive error suggesting new snapshot
- Test browser_hover tool with selector
- Test browser_hover tool with ref
- Test clearRefs() called on browser_navigate
- Update tool count test from 8 to 9

### T002 [Implement] Implement all changes
- Add imports for resolveRef, clearRefs, clickByBackendNodeId, typeByBackendNodeId, hoverByBackendNodeId
- Create validateSelectorOrRef helper function
- Modify browser_click schema and handler for ref support
- Modify browser_type schema and handler for ref support
- Add browser_hover tool
- Add clearRefs() call in browser_navigate handler
- Update descriptions to mention ref support

### T003 [Document] Update docblock
- Update module docblock: 8 -> 9 tools, add browser_hover to list

## Dependencies
- T002 depends on T001 (TDD: tests first)
- T003 is part of T002 implementation (docblock update)
