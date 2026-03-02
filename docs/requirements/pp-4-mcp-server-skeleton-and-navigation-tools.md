# Requirements: PP-4 - Implement MCP Server Skeleton and Navigation Tools

_Source: Linear ticket PP-4_
_Status: IN PROGRESS_

## Summary

Implement the MCP server entry point (`src/index.ts`) and navigation tool module (`src/tools/navigation.ts`) with 8 browser automation tools registered on the MCP server.

## Requirements

### REQ-1: MCP Server Setup (src/index.ts)
- Create `McpServer` instance with name "screen-cap" and version "0.1.0" (from package.json)
- Connect via `StdioServerTransport`
- Import and call `registerNavigationTools(server)` from src/tools/navigation.ts
- Server starts when file is executed

**Acceptance Criteria:**
- Server creates McpServer instance with correct name/version
- Server connects via StdioServerTransport
- Navigation tools are registered before transport connection
- TypeScript compiles cleanly

### REQ-2: Navigation Tools (src/tools/navigation.ts)
- Export a `registerNavigationTools(server: McpServer)` function
- Register 8 tools on the server using `server.tool()` pattern

**Tools:**

1. `browser_connect` - Connect to Chrome via CDP
   - Input: `{ port?: number }` (default 9222)
   - Calls `ensureBrowser()` then `ensurePage()`
   - Returns text with connection confirmation + page URL/title

2. `browser_navigate` - Navigate to URL
   - Input: `{ url: string, waitUntil?: "load"|"domcontentloaded"|"networkidle0"|"networkidle2" }`
   - Uses `page.goto(url, { waitUntil, timeout: 60000 })`
   - Returns text with final URL + title

3. `browser_click` - Click element by CSS selector
   - Input: `{ selector: string }`
   - Wait for selector visible, then click
   - Returns text confirmation

4. `browser_type` - Type into input field
   - Input: `{ selector: string, text: string, clear?: boolean }`
   - If clear: triple-click to select all then type (replaces content)
   - Returns text confirmation

5. `browser_select` - Select dropdown option
   - Input: `{ selector: string, value: string }`
   - Uses `page.select(selector, value)`
   - Returns text confirmation

6. `browser_evaluate` - Run arbitrary JS in page context
   - Input: `{ script: string }`
   - Uses `page.evaluate()` with the script
   - Returns JSON-stringified result

7. `browser_list_pages` - List open tabs
   - No input required
   - Calls `listAllPages()` from browser.ts
   - Returns JSON array of `{ index, url, title }`

8. `browser_switch_page` - Switch to a different tab
   - Input: `{ index: number }`
   - Calls `switchToPage(index)` from browser.ts
   - Returns text with new page URL/title

**Acceptance Criteria:**
- All 8 tools registered with correct names, descriptions, schemas, and handlers
- All handlers wrap logic in try/catch, returning error as text content (never throw)
- Zod schemas use shape objects (not z.object wrappers)
- TypeScript compiles cleanly with `npx tsc --noEmit`

## Edge Cases
- `browser_connect`: Chrome not running / port unreachable -> return error text
- `browser_navigate`: Invalid URL, timeout -> return error text
- `browser_click`: Selector not found, element not visible -> return error text
- `browser_type`: Selector not found -> return error text
- `browser_select`: Selector not found, invalid value -> return error text
- `browser_evaluate`: Script throws error -> return error text
- `browser_list_pages`: No browser connected -> return error text
- `browser_switch_page`: Invalid index (negative, out of range) -> return error text

## In Scope / Out of Scope

### In Scope
- MCP server creation and stdio transport connection
- 8 navigation tools with full error handling
- Tool registration pattern using server.tool()
- Integration with existing BrowserManager singleton

### Out of Scope
- Screenshot/capture tools (future ticket)
- Video recording tools (future ticket)
- Server configuration options beyond name/version
- Authentication or authorization
- Tool-level logging (beyond what BrowserManager already does)
