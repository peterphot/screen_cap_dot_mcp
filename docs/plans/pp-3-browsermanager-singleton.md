# Plan: PP-3 - Implement BrowserManager Singleton

## Architecture Overview

The BrowserManager is a module-level singleton in `src/browser.ts` that manages a persistent
puppeteer-core connection to Chrome via CDP. It uses module-scoped variables (not a class) to
maintain browser, page, and CDP session references across all tool calls.

### File Impact
- **Create**: `src/browser.ts` -- Main module (all browser management functions)
- **Create**: `src/__tests__/browser.test.ts` -- Unit tests with mocked puppeteer-core
- **Create**: `vitest.config.ts` -- Test configuration (if using vitest) or jest config
- **Modify**: `package.json` -- Add test framework dev dependency

### Dependencies
- puppeteer-core (already installed)
- vitest (to be added as dev dependency for testing)

## Task Breakdown

### [T001] Setup: Install test framework and configure
- Install vitest as dev dependency
- Create vitest.config.ts with TypeScript and ESM support
- Add `"test"` script to package.json
- Verify vitest runs (empty test suite)
- **Dependencies**: None

### [T002] Test: Write failing tests for BrowserManager
- Create `src/__tests__/browser.test.ts`
- Mock puppeteer-core's `connect`, `Browser`, `Page`, `CDPSession` types
- Test cases:
  - `ensureBrowser()` connects to `http://127.0.0.1:9222` with correct options
  - `ensureBrowser()` returns cached browser on subsequent calls (singleton)
  - `ensureBrowser()` reconnects after disconnect event
  - `ensurePage()` returns existing page if available
  - `ensurePage()` gets first page from browser.pages() if no current page
  - `ensurePage()` sets default navigation timeout to 60s
  - `ensurePage()` calls ensureBrowser() if no browser
  - `ensureCDPSession()` creates CDP session from current page
  - `ensureCDPSession()` returns cached session
  - `listAllPages()` returns array with index, url, title for each tab
  - `switchToPage(index)` switches to correct tab and brings to front
  - `switchToPage(index)` throws on invalid index
  - `switchToPage(index)` resets cdpSession ref
  - `getPage()` returns page when connected
  - `getPage()` throws when not connected
  - `getBrowser()` returns browser when connected
  - `getBrowser()` throws when not connected
  - Disconnect handler nulls all refs
- All tests should FAIL (no implementation yet)
- **Dependencies**: T001

### [T003] Implement: Build src/browser.ts to pass all tests
- Create `src/browser.ts` with:
  - Module-level state: browser, page, cdpSession (null)
  - `ensureBrowser()` -- connect via CDP, setup disconnect handler
  - `ensurePage()` -- get/find page, set timeout
  - `ensureCDPSession()` -- create CDP session
  - `listAllPages()` -- enumerate tabs
  - `switchToPage(index)` -- switch active tab
  - `getPage()` -- get or throw
  - `getBrowser()` -- get or throw
  - Type exports for PageInfo
- All tests should PASS
- TypeScript compiles with `npx tsc --noEmit`
- **Dependencies**: T002

## Estimated Size: SMALL (3 tasks)
