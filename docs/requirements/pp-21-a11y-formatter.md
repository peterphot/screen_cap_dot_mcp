# Requirements: PP-21 Compact A11y Tree Formatter

## Status: IN_PROGRESS

## Summary
Transform the raw Puppeteer accessibility tree output from `browser_a11y_snapshot` into a compact, Playwright-MCP-style indented text format. Reduces output from 73KB+ JSON to <8KB compact text for typical pages.

## Requirements

### REQ-1: filterTree() pre-processing
- Remove nodes with role `generic` or `none` that have exactly one child (unwrap them)
- Collapse leaf `StaticText` nodes into their parent's name (only if parent has no name; otherwise just remove the redundant child)
- Truncate repeated same-role siblings: show first 3, then `... N more {role}s`

### REQ-2: formatA11yTree() rendering
- One node per line, 2-space indent per depth level
- Format: `[ref] role "name" key=value` -- only non-default properties
- Properties to include: value, checked, selected, disabled, expanded, level, required, readonly
- Skip properties at their default/false value
- Respect `maxDepth` option (omit children below cutoff with `... N children`)

### REQ-3: observation.ts integration
- Add `format` param: `z.enum(["tree", "json"]).optional()` (default "tree")
- Add `maxDepth` param: `z.number().optional()`
- When format === "tree" (default): call filterTree() then formatA11yTree()
- When format === "json": existing JSON.stringify path (backward compat)
- Update tool description to mention compact format

### REQ-4: A11ySnapshotNode interface expansion
- Add optional fields: value, checked, selected, disabled, expanded, level, required, readonly
- Use typed interface (not Record<string, unknown>)

## Acceptance Criteria
- [ ] browser_a11y_snapshot() returns compact tree text by default
- [ ] Output is <8KB for a typical data-heavy page (was 73KB+ as JSON)
- [ ] browser_a11y_snapshot(format: "json") returns full JSON (backward compat)
- [ ] maxDepth parameter limits tree depth
- [ ] Generic/none wrapper nodes with single children are removed
- [ ] StaticText leaf nodes are collapsed into parent name
- [ ] Repeated same-role siblings are truncated after 3
- [ ] All existing tests pass + new formatter tests pass
- [ ] Ref IDs are prominently displayed as [eN] at start of each line

## Edge Cases
- Nodes with no ref (no backendNodeId) -- should render without [ref] prefix
- Nodes with no name -- should render role only
- Nodes with no children -- leaf nodes render on single line
- Empty tree (null snapshot) -- should return empty string or appropriate message
- maxDepth = 0 -- should show root only with child count
- Generic/none nodes with 0 or 2+ children -- should NOT be unwrapped (only single-child unwrap)
- StaticText nodes that are not leaves -- should not be collapsed
- All siblings same role but fewer than 4 -- no truncation needed
- Mixed-role siblings -- no truncation (only same-role runs are truncated)

## In Scope / Out of Scope

### In Scope
- New src/util/a11y-formatter.ts module
- New src/__tests__/a11y-formatter.test.ts test file
- Modifications to src/tools/observation.ts
- Modifications to src/__tests__/observation.test.ts
- A11ySnapshotNode interface expansion

### Out of Scope
- Changes to other tools (click, type, hover, scroll)
- Changes to ref-store.ts
- Changes to browser.ts
- Performance optimization beyond the format change itself
- Custom filtering options beyond what's specified
