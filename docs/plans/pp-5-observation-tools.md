# Plan: PP-5 Observation Tools

## Overview
Implement 4 observation tools (browser_screenshot, browser_a11y_snapshot, browser_get_page_info, browser_get_text) in src/tools/observation.ts following the established navigation.ts pattern.

## Architecture
- Single new file: `src/tools/observation.ts`
- Exports `registerObservationTools(server: McpServer): void`
- Registered in `src/index.ts` alongside existing `registerNavigationTools`
- Tests in `src/__tests__/observation.test.ts` following navigation.test.ts pattern

## Task Breakdown

### [T001] Test: Write failing tests for 4 observation tools
- Create `src/__tests__/observation.test.ts`
- Mock `../browser.js` (ensurePage)
- Mock `node:fs/promises` (writeFile, mkdir) for savePath tests
- Test registration: 4 tools registered with descriptions
- Test browser_screenshot: default viewport, fullPage, selector, savePath, error handling
- Test browser_a11y_snapshot: default interestingOnly, explicit false, error handling
- Test browser_get_page_info: returns URL/title/viewport/scroll dims, error handling
- Test browser_get_text: returns innerText, error handling
- Dependencies: none

### [T002] Implement: Make all tests pass - implement registerObservationTools
- Create `src/tools/observation.ts`
- Implement all 4 tools following navigation.ts pattern
- Dependencies: T001

### [T003] Implement: Register observation tools in src/index.ts
- Import registerObservationTools from "./tools/observation.js"
- Call registerObservationTools(server) after registerNavigationTools(server)
- Verify TypeScript compiles cleanly
- Dependencies: T002
