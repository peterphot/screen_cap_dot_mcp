# Plan: Reduce Channel ROI Demo Sleep Durations (PP-46)

## Overview
Reduce all sleep durations in `flows/channel-roi-demo.json` by ~30% using the mappings specified in the ticket.

## Architecture Impact
None. This is a JSON-only change to a single flow file.

## Task Breakdown

### [T001] Test: Validate sleep duration reductions
- Write a test that parses `flows/channel-roi-demo.json` and validates all sleep durations match the expected reduced values
- Ensures 500ms values remain unchanged
- Ensures JSON is valid

### [T002] Implement: Apply sleep duration reductions
- Apply the mapping to all sleep actions in the flow file
- Mapping: 10000->7000, 8000->5500, 3000->2000, 2500->1750, 2000->1400, 1500->1000, 1000->700, 500->500

### Dependencies
- T002 depends on T001 (TDD: tests first)

## Files Modified
- `flows/channel-roi-demo.json` - All sleep durations reduced
- Test file (new or existing) - Validation test

## Risk
Minimal. JSON value changes only, no logic changes.
