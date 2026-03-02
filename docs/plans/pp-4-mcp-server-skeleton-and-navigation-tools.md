# Plan: PP-4 - MCP Server Skeleton and Navigation Tools

## Architecture Overview

The MCP server follows a standard pattern from `@modelcontextprotocol/sdk`:
- `src/index.ts` creates the server, registers tools, and connects transport
- `src/tools/navigation.ts` exports a registration function that adds 8 tools to the server
- Tools delegate to the existing `src/browser.ts` BrowserManager singleton

```
src/index.ts          -- McpServer + StdioServerTransport
  |
  +-> src/tools/navigation.ts  -- registerNavigationTools(server)
        |
        +-> src/browser.ts     -- ensureBrowser(), ensurePage(), listAllPages(), etc.
```

## File Impacts

| File | Action | Description |
|------|--------|-------------|
| src/tools/navigation.ts | CREATE | 8 navigation tools registered via server.tool() |
| src/index.ts | MODIFY | Replace placeholder with McpServer setup |
| src/__tests__/navigation.test.ts | CREATE | Unit tests for all 8 navigation tools |

## Task Breakdown

### [T001] Test: Write tests for navigation tools
- **Type**: Test
- **Description**: Write comprehensive unit tests for all 8 navigation tools. Mock the browser module and McpServer. Test both success paths and error handling (try/catch returning error text).
- **Files**: src/__tests__/navigation.test.ts
- **Dependencies**: None

### [T002] Implement: Create navigation tools module
- **Type**: Implement
- **Description**: Implement `registerNavigationTools(server)` with all 8 tools: browser_connect, browser_navigate, browser_click, browser_type, browser_select, browser_evaluate, browser_list_pages, browser_switch_page. Each tool uses server.tool() with Zod schema shapes and try/catch error handling.
- **Files**: src/tools/navigation.ts
- **Dependencies**: T001

### [T003] Implement: Update src/index.ts with MCP server setup
- **Type**: Implement
- **Description**: Replace placeholder with McpServer creation (name: "screen-cap", version: "0.1.0"), import and call registerNavigationTools(server), connect StdioServerTransport.
- **Files**: src/index.ts
- **Dependencies**: T002

### [T004] Test: Verify TypeScript compilation and all tests pass
- **Type**: Test
- **Description**: Run `npx tsc --noEmit` and `npm test` to verify everything compiles and passes.
- **Files**: None (validation only)
- **Dependencies**: T003
