# Requirements: PP-3 - Implement BrowserManager Singleton

## Source
Linear ticket PP-3

## Overview
Build the core `BrowserManager` module that maintains a persistent puppeteer-core connection to Chrome via CDP. This solves the page context loss problem by keeping browser, page, and CDP session references alive across all tool calls.

## Requirements

### R1: Module-level singleton state
- Module-scoped variables: `browser`, `page`, `cdpSession` (all initially null)
- State persists across function calls (module-level, not class instance)

### R2: ensureBrowser()
- Connect to Chrome via CDP at `http://127.0.0.1:9222`
- Uses `puppeteer.connect({ browserURL, defaultViewport: null })`
- Auto-reconnect on disconnect (reconnects lazily on next call)
- Set up disconnect handler to null out refs
- Returns the Browser instance

### R3: ensurePage()
- Get current page or find first tab
- Set default navigation timeout to 60 seconds
- Returns the persistent Page reference
- Calls ensureBrowser() if not connected

### R4: ensureCDPSession()
- Create CDP session for low-level protocol access
- Returns CDPSession instance
- Calls ensurePage() if no page available

### R5: listAllPages()
- Return all open tabs with URL, title, index
- Returns array of objects with { index, url, title }

### R6: switchToPage(index)
- Switch active page to a different tab by index
- Bring the page to front
- Update the module-level page reference
- Reset cdpSession (since page changed)

### R7: getPage()
- Get current page reference
- Throws if not connected (no lazy connect)

### R8: getBrowser()
- Get current browser reference
- Throws if not connected (no lazy connect)

### R9: Disconnect handling
- Listen for browser disconnect events
- Null out browser, page, and cdpSession refs on disconnect
- Next call to ensureBrowser() reconnects automatically

## Edge Cases
- Chrome not running at port 9222 -- ensureBrowser() should throw a descriptive error
- Chrome restarts between calls -- disconnect handler nulls refs, next ensure* reconnects
- No open tabs -- ensurePage() should throw if pages().length === 0
- Tab index out of range in switchToPage() -- throw with descriptive error
- Multiple rapid calls -- singleton pattern means only one connection attempt

## In Scope / Out of Scope

### In Scope
- Browser connection management
- Page lifecycle (get, switch, list)
- CDP session creation
- Disconnect/reconnect handling
- TypeScript types and clean compilation

### Out of Scope
- MCP server integration (separate ticket)
- Screenshot capture (separate ticket)
- Navigation tools (separate ticket)
- Video recording (separate ticket)
- Testing against a real Chrome instance (unit tests mock puppeteer-core)

## Key Design Decisions (from ticket)
- `defaultViewport: null` preserves real Chrome window size
- `browserURL` (HTTP) not websocket for CDP connection
- 60-second default timeouts for data-heavy SPAs
- Module-level singleton pattern (not a class)
- Uses puppeteer-core (not puppeteer) -- connects to existing Chrome
- Import as: `import puppeteer from 'puppeteer-core';`
- Logger logs to stderr (stdout reserved for MCP protocol)
- ES module project ("type": "module" in package.json)

## Acceptance Criteria
- AC1: Can connect to Chrome running with `--remote-debugging-port=9222`
- AC2: Page reference persists across multiple function calls
- AC3: Reconnects automatically if Chrome restarts
- AC4: Can list and switch between open tabs
- AC5: TypeScript compiles cleanly with `npx tsc --noEmit`

## Status: COMPLETED
