# Requirements: PP-5 Observation Tools

## Overview
Implement 4 observation tools for the Screen Cap MCP Server that allow Claude to see and inspect web pages: screenshots, accessibility tree, page metadata, and element text extraction.

## Requirements

### R1: browser_screenshot - Capture viewport or full-page screenshot
- **Input**: `{ selector?: string, fullPage?: boolean, savePath?: string }`
- **Behavior**:
  - If `selector` provided: capture that element only via `element.screenshot()`
  - If `fullPage: true`: `page.screenshot({ fullPage: true })`
  - Default: viewport screenshot `page.screenshot()`
  - Return as MCP image content block: `{ type: "image", data: base64string, mimeType: "image/png" }`
  - If `savePath` provided, also save the buffer to disk (creating parent directories)
- **Acceptance Criteria**:
  - Returns image content block with type "image", base64 data, and mimeType "image/png"
  - fullPage option passes through to Puppeteer
  - selector option screenshots specific element
  - savePath writes file to disk
  - Errors return text content with isError: true

### R2: browser_a11y_snapshot - Capture accessibility tree
- **Input**: `{ interestingOnly?: boolean }` (default true)
- **Behavior**: Uses `page.accessibility.snapshot({ interestingOnly })`
- **Returns**: JSON text of the a11y tree
- **Acceptance Criteria**:
  - Returns parseable JSON accessibility tree as text content
  - interestingOnly defaults to true
  - Errors return text content with isError: true

### R3: browser_get_page_info - Get current page metadata
- **Input**: No required input
- **Behavior**: Returns URL, title, viewport dimensions (via `page.viewport()`), document scroll dimensions (via `page.evaluate()`)
- **Returns**: Formatted readable text
- **Acceptance Criteria**:
  - Returns URL, title, viewport width/height, scroll width/height
  - Errors return text content with isError: true

### R4: browser_get_text - Get innerText of element
- **Input**: `{ selector: string }` (required)
- **Behavior**: Uses `page.$eval(selector, el => el.innerText)`
- **Returns**: The text content as text content block
- **Acceptance Criteria**:
  - Returns element's innerText
  - Errors return text content with isError: true

## Edge Cases
- browser_screenshot with non-existent selector: returns error
- browser_screenshot with invalid savePath (e.g., read-only directory): returns error
- browser_a11y_snapshot when page has no accessible content: returns empty/minimal tree
- browser_get_text with non-existent selector: returns error
- browser_get_page_info when viewport is null (defaultViewport: null): handles gracefully

## In Scope / Out of Scope
### In Scope
- 4 observation tools in src/tools/observation.ts
- registerObservationTools(server) export function
- Registration in src/index.ts
- Error handling with try/catch returning isError: true
- Unit tests with mocked browser module

### Out of Scope
- Video recording (separate ticket)
- DOM mutation tools (separate ticket)
- Integration tests with real Chrome

## Implementation Pattern
Follow the exact same pattern as src/tools/navigation.ts:
- Import McpServer from "@modelcontextprotocol/sdk/server/mcp.js"
- Import z from "zod"
- Import ensurePage from "../browser.js" (note .js extension for ESM)
- Import logger from "../util/logger.js"
- Export registerObservationTools(server: McpServer): void
- All handlers wrap logic in try/catch, return error as text content with isError: true

Status: COMPLETED
