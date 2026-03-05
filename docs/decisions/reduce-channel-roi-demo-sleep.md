# Decisions: Reduce Channel ROI Demo Sleep Durations (PP-46)

## Summary
Reduced all sleep durations in `flows/channel-roi-demo.json` by ~30% for tighter recording pacing.

## Decisions

### D-CLARIFY-001: Sleep duration reduction mapping
- **Who decided**: user (via ticket PP-46)
- **What**: Use specific mappings rather than a blanket percentage reduction
- **Why**: Exact values ensure predictable behavior across different pause categories
- **Alternatives**: Blanket 30% reduction (would produce non-round numbers), remove pauses entirely

### D-CLARIFY-002: Keep 500ms minimums
- **Who decided**: user (via ticket PP-46)
- **What**: 500ms sleep durations are not reduced
- **Why**: 500ms is the minimum needed for smooth visual transitions
- **Alternatives**: Reduce to 350ms

### D-ORCH-001: Scale assessment -- SMALL
- **Who decided**: claude
- **What**: Classified as SMALL (2 tasks: test + implement)
- **Why**: Single JSON file change with well-defined value mappings, no code logic changes

### D-ORCH-002: Orchestration pattern -- STANDARD
- **Who decided**: claude
- **What**: STANDARD sequential pattern (test -> implement)
- **Why**: Single file, single task, no parallelism needed

## Mapping Applied

| Original (ms) | Reduced (ms) | Count | Category |
|---------------|-------------|-------|----------|
| 10000 | 7000 | 3 | Page load |
| 8000 | 5500 | 2 | Page load |
| 3000 | 2000 | 4 | Visual pause |
| 2500 | 1750 | 5 | Visual pause |
| 2000 | 1400 | 8 | Transition |
| 1500 | 1000 | 2 | Transition |
| 1000 | 700 | 3 | Brief pause |
| 500 | 500 | 1 | Keep as-is |
| **Total** | | **28** | |
