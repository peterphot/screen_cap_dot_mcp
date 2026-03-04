# Decision Log: pp-21-a11y-formatter
_Initialized: 2026-03-04T00:00:00Z_

## Clarify Phase
_Captured: 2026-03-04T00:00:00Z_

### D-CLARIFY-001: Expand A11ySnapshotNode interface with typed fields
- **Who decided**: user
- **What**: Expand A11ySnapshotNode to include value, checked, selected, disabled, expanded, level, required, readonly as optional typed fields
- **Why**: Typed interface is safer and more maintainable than Record<string, unknown>
- **Alternatives**: Record<string, unknown> with runtime checks
- **Context**: Asked user whether formatter should use typed interface or generic record

### D-CLARIFY-002: StaticText collapsing uses child name only when parent has no name
- **Who decided**: user
- **What**: When collapsing StaticText leaf into parent, use child's name only if parent has no name; otherwise remove the redundant child
- **Why**: Avoids losing parent's existing name while still removing noise
- **Alternatives**: Always prefer child name, always prefer parent name
- **Context**: Asked about StaticText collapsing behavior when parent already has a name

### D-CLARIFY-003: Update existing tests for new default format
- **Who decided**: user
- **What**: Update existing observation tests that parse JSON from default output to work with new tree format; add format:"json" tests for backward compat
- **Why**: Default format is changing from JSON to tree text, so existing tests must be updated accordingly
- **Alternatives**: Keep JSON as default (rejected - ticket requires tree as default)
- **Context**: Asked about approach for handling existing test breakage from format change

## Orchestrate Phase
_Captured: 2026-03-04T00:00:00Z_

### D-ORCH-001: Scale assessment - MEDIUM
- **Who decided**: claude
- **What**: Assessed ticket as MEDIUM complexity (4 files, ~6 tasks)
- **Why**: Well-scoped feature with clear acceptance criteria, 2 new files + 2 modified files, straightforward TDD
- **Alternatives**: SMALL (too few tasks to justify), LARGE (not complex enough)
- **Context**: Scale assessment for PP-21

### D-ORCH-002: Orchestration pattern - STANDARD
- **Who decided**: claude
- **What**: Using STANDARD sequential pattern
- **Why**: Tasks have clear dependencies (formatter must exist before observation.ts can use it), no parallelizable work
- **Alternatives**: PARALLEL (tasks are sequential), COUNCIL (not complex enough)
- **Context**: Pattern selection for PP-21
