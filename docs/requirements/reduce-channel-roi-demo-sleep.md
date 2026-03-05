# Requirements: Reduce Channel ROI Demo Sleep Durations (PP-46)

## Status: COMPLETED

## Summary
Reduce all sleep durations in the channel-roi-demo flow by ~30% for tighter pacing.

## Requirements

### REQ-1: Reduce sleep durations by ~30%
Apply the following duration mappings to all matching sleep values in `flows/channel-roi-demo.json`:

| Current (ms) | Target (ms) | Category |
|--------------|-------------|----------|
| 10000 | 7000 | Page load |
| 8000 | 5500 | Page load |
| 3000 | 2000 | Visual pause |
| 2500 | 1750 | Visual pause |
| 2000 | 1400 | Transition |
| 1500 | 1000 | Transition |
| 1000 | 700 | Brief pause |
| 500 | 500 | Keep as-is |

**Acceptance Criteria:**
- All sleep durations in the flow file match the target values
- 500ms minimums remain unchanged
- Flow JSON remains valid (parseable)
- `npm test` passes

## Edge Cases
- 500ms values must not be changed
- Only sleep action durations are affected (not timeouts on other actions like scroll_to_text)

## In Scope / Out of Scope

### In Scope
- Modifying sleep duration values in `flows/channel-roi-demo.json`

### Out of Scope
- Changes to any TypeScript source files
- Changes to other flow files
- Changes to non-sleep timeouts (e.g., scroll_to_text timeout)
