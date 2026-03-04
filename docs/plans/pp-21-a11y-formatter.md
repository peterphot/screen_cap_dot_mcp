# Plan: PP-21 Compact A11y Tree Formatter

## Overview
Create a new `src/util/a11y-formatter.ts` module with `filterTree()` and `formatA11yTree()` functions, then integrate into `browser_a11y_snapshot` in `src/tools/observation.ts` with `format` and `maxDepth` parameters.

## Task Breakdown

| ID | Type | Description | Dependencies |
|----|------|-------------|--------------|
| T001 | Test | Write a11y-formatter.test.ts - filterTree tests | None |
| T002 | Test | Write a11y-formatter.test.ts - formatA11yTree tests | None |
| T003 | Implement | Create src/util/a11y-formatter.ts (filterTree + formatA11yTree) | T001, T002 |
| T004 | Test | Update observation.test.ts - format/maxDepth param tests | T003 |
| T005 | Implement | Modify observation.ts - integrate formatter, add params | T003, T004 |
| T006 | Implement | Update existing observation tests for new default format | T005 |

## Architecture

### New Module: src/util/a11y-formatter.ts
- Exports: `filterTree(node)`, `formatA11yTree(node, options?)`
- Uses the expanded `A11ySnapshotNode` interface from observation.ts
- Pure functions, no side effects, no dependencies beyond the interface

### Modified: src/tools/observation.ts
- Move `A11ySnapshotNode` interface to be shared (or re-export from formatter)
- Add `format` and `maxDepth` params to browser_a11y_snapshot schema
- Call filterTree + formatA11yTree when format === "tree" (default)
- Keep JSON.stringify path for format === "json"

## Files Affected
- `src/util/a11y-formatter.ts` - CREATE
- `src/__tests__/a11y-formatter.test.ts` - CREATE
- `src/tools/observation.ts` - MODIFY
- `src/__tests__/observation.test.ts` - MODIFY
