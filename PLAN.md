# Plan: Screen Cap MCP Server - Browser Automation for Product Demos

## Context

The existing Playwright and Chrome DevTools MCP servers cannot reliably navigate data-heavy SPAs because they lose page context between tool calls when apps do full-page reloads. We need a **general-purpose** MCP server that maintains a **persistent browser connection** so Claude can explore any authenticated web app, capture screenshots/video, and define reusable user flows for recording product demos.

The immediate use case is GrowthOS (Mutinex's MMM platform), but the server is designed to work with **any web application** - dashboards, admin panels, SaaS products, etc. Nothing in the implementation is GrowthOS-specific; the smart wait strategies target common UI patterns (MUI progress bars, skeleton screens, loading spinners) found across modern web apps.

## Architecture

**MCP Server** built with `@modelcontextprotocol/sdk` + `puppeteer-core`, communicating via stdio. The server process holds a **singleton browser/page reference** that persists across all tool calls - solving the core problem.

**Prerequisite**: User launches Chrome with `--remote-debugging-port=9222`. The MCP server connects to this existing authenticated session via CDP.

```
Claude Code  ──stdio──>  MCP Server (Node.js process)
                              │
                              ├── BrowserManager (singleton)
                              │     └── puppeteer-core ──CDP──> Chrome (port 9222)
                              │
                              ├── Interactive Tools (navigate, click, scroll, screenshot, a11y)
                              ├── Recording Tools (start/stop video, key moments)
                              └── Flow Tools (run saved JSON flow definitions)
```

## Technology Choices

| Choice | Technology | Why |
|--------|-----------|-----|
| Browser automation | `puppeteer-core` v24 | Already installed, mature CDP support, native `page.screencast()` for video |
| MCP framework | `@modelcontextprotocol/sdk` | Standard MCP server SDK, Zod schemas for tool inputs |
| Video recording | Puppeteer's built-in `page.screencast()` | Supports MP4/WebM directly, no extra deps (needs FFmpeg on system) |
| Flow definitions | JSON with Zod validation | Editable by non-devs, with `"action": "evaluate"` escape hatch for JS |
| Language | TypeScript with `tsx` for dev | Type safety, no build step during development |

## File Structure

```
src/
  index.ts              # MCP server entry point, tool registration
  browser.ts            # BrowserManager singleton (connect, ensurePage, switchPage)
  tools/
    navigation.ts       # navigate, click, type, select, evaluate, list_pages, switch_page
    observation.ts      # screenshot, a11y_snapshot, get_page_info, get_text
    scrolling.ts        # scroll, scroll_to_element
    waiting.ts          # wait_for_selector, wait_for_network_idle, smart_wait
    recording.ts        # start_recording, stop_recording, screenshot_key_moment
    flow.ts             # run_flow, list_flows
  flow/
    schema.ts           # Zod schemas for flow DSL
    runner.ts           # FlowRunner class - executes flow definitions
  util/
    wait-strategies.ts  # Smart waiting (progressbar, network idle, spinners - works with any app)
    logger.ts           # stderr logging (stdout reserved for MCP protocol)
flows/                  # Saved flow JSON files (created during exploration)
output/                 # Generated artifacts (screenshots/, recordings/, a11y/)
```

## MCP Tools (22 tools across 6 groups)

### Navigation (7 tools)
- `browser_connect` - Connect to Chrome via CDP (default port 9222)
- `browser_navigate` - Go to URL with configurable wait strategy
- `browser_click` - Click element by CSS selector
- `browser_type` - Type into input field
- `browser_select` - Select dropdown option
- `browser_evaluate` - Run arbitrary JS in page context
- `browser_list_pages` / `browser_switch_page` - Tab management

### Observation (4 tools)
- `browser_screenshot` - Viewport or full-page screenshot (returns base64 image to Claude)
- `browser_a11y_snapshot` - Accessibility tree as JSON
- `browser_get_page_info` - URL, title, viewport, scroll dimensions
- `browser_get_text` - Get innerText of element

### Scrolling (2 tools)
- `browser_scroll` - Scroll page or specific container by pixels
- `browser_scroll_to_element` - Scroll element into view

### Waiting (3 tools)
- `browser_wait_for_selector` - Wait for element visible/hidden
- `browser_wait_for_network_idle` - Wait for network to settle
- `browser_smart_wait` - Waits for common loading indicators (progressbars, spinners, skeletons) then network idle

### Recording (3 tools)
- `browser_start_recording` - Start MP4/WebM video capture via `page.screencast()`
- `browser_stop_recording` - Stop and save video, return path + key moments
- `browser_screenshot_key_moment` - During recording, capture labeled screenshot + a11y snapshot

### Flow (3 tools)
- `browser_run_flow` - Execute a saved JSON flow definition (with optional recording)
- `browser_list_flows` - List saved flow files in `flows/` directory
- `browser_save_flow` - Save a flow definition to disk

## Flow DSL Format

JSON files with step arrays. Each step has an `action` and action-specific fields:

```json
{
  "name": "Channel ROI Walkthrough",
  "description": "Navigate to Channel ROI and capture visualizations",
  "recording": { "enabled": true, "format": "mp4" },
  "steps": [
    { "action": "navigate", "url": "/channel-roi", "label": "nav-channel-roi" },
    { "action": "wait", "strategy": "smart", "timeout": 45000 },
    { "action": "screenshot", "label": "channel-roi-loaded" },
    { "action": "scroll", "direction": "down", "amount": 800 },
    { "action": "screenshot", "label": "channel-roi-charts" },
    { "action": "a11y_snapshot", "label": "channel-roi-structure" },
    { "action": "evaluate", "script": "document.querySelector('.filter-btn').click()" }
  ]
}
```

Step types: `navigate`, `click`, `type`, `wait` (selector/network_idle/smart/delay/function), `scroll`, `screenshot`, `a11y_snapshot`, `evaluate`, `sleep`

## Key Design Decisions

1. **Singleton page reference** - The `BrowserManager` holds a module-level `page` variable. Every tool call uses the same page. This is what the Playwright MCP failed at.
2. **`defaultViewport: null`** - Preserves real Chrome window size for accurate screenshots.
3. **Generous timeouts** - Configurable, defaults to 60s for data-heavy apps.
4. **Smart wait** - Checks for common loading patterns (MUI/Ant/Chakra progressbars, skeletons, spinners) + network idle. Works across frameworks.
5. **Screenshots as MCP image content** - Claude can actually see what's on the page.
6. **Continue on step failure** - Flow runner captures error screenshots but keeps going.
7. **App-agnostic** - No hardcoded URLs or app-specific selectors. All app knowledge lives in flow definitions, not the server.

## Dependencies

```json
{
  "dependencies": {
    "puppeteer-core": "^24.37.5",
    "@modelcontextprotocol/sdk": "^1.27.1",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "tsx": "^4.19.0",
    "@types/node": "^22.0.0"
  }
}
```

System requirement: `brew install ffmpeg` (for video recording)

## Claude Code Configuration

Add to `~/.claude/settings.json` or project `.claude/settings.local.json`:

```json
{
  "mcpServers": {
    "screen-cap": {
      "command": "npx",
      "args": ["tsx", "src/index.ts"],
      "cwd": "/Users/peterphotinos/Documents/screen_cap_dot_mcp"
    }
  }
}
```

## Implementation Order

1. **BrowserManager** (`src/browser.ts`) - singleton connection, ensurePage, reconnect logic
2. **MCP server skeleton** (`src/index.ts`) - server setup, tool registration framework
3. **Navigation tools** - navigate, click, type (core interaction)
4. **Observation tools** - screenshot + a11y_snapshot (Claude needs to see the page)
5. **Waiting tools** - smart_wait handles slow-loading SPAs
6. **Scrolling tools** - scroll page and containers
7. **Recording tools** - video capture via screencast
8. **Flow DSL** - schema + runner for saved flows
9. **Flow tools** - run_flow, list_flows, save_flow

## Verification

1. Launch Chrome: `/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222`
2. Navigate to any authenticated web app in Chrome (e.g. GrowthOS, admin panel, etc.)
3. Start the MCP server: `npx tsx src/index.ts` (or via Claude Code MCP config)
4. From Claude Code, test: `browser_connect` -> `browser_screenshot` -> verify Claude can see the page
5. Test navigation: `browser_navigate` to a sub-page -> `browser_smart_wait` -> `browser_screenshot`
6. Test scrolling: `browser_scroll` down -> `browser_screenshot` (verify below-fold content)
7. Test recording: `browser_start_recording` -> navigate through pages -> `browser_stop_recording` -> verify MP4 file
8. Test flow: Save a flow JSON, run `browser_run_flow`, verify output directory has video + screenshots + a11y

---

# Phase 2: Ref-Based Element Interaction

## Context

The AI agent can only interact with elements via CSS selectors (`browser_click`, `browser_type`, `browser_select`). But the information it gets from `browser_a11y_snapshot` is accessibility data — role, name, backendNodeId — not CSS selectors. This creates a gap between what the agent can **see** and what it can **act on**.

In practice this means:
- **URL navigation instead of SPA clicks** — the agent navigates by changing the URL (causing full page reloads) instead of clicking sidebar links, because it can't construct a CSS selector from the a11y data
- **No custom dropdown interaction** — `browser_select` only works on native `<select>` elements; modern UI frameworks (MUI, Ant Design, Chakra) render custom listboxes that require clicking to open then clicking an option
- **No hover support** — many UIs require hover to reveal menus, tooltips, or interactive elements

The fix: assign short ref IDs to each element in the a11y snapshot, then let existing tools accept those refs as an alternative to CSS selectors. The `ensureCDPSession()` infrastructure already exists but is unused — we'll use it with `DOM.getContentQuads` and `Input.dispatchMouseEvent` to interact with elements by backendNodeId.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Modify existing tools vs new tools | Modify existing + add `browser_hover` | Fewer tools = less confusion for the AI agent. Adding `ref` as optional param keeps the API surface small. |
| Ref format | Sequential "e1", "e2", "e3"... | Short, human-readable, avoids collision with numeric IDs. Reset on each snapshot. |
| Ref placement in output | Inline on each a11y node | Agent sees ref next to role/name — no cross-referencing a separate map. |
| Ref lifecycle | Ephemeral — valid only until next snapshot or navigation | Simplest model. Stale refs return a clear error suggesting a new snapshot. |
| Click coordinates | Center of first content quad from `DOM.getContentQuads` | More reliable than `DOM.getBoxModel` for transformed elements or scroll containers. |
| Scroll before click | `DOM.scrollIntoViewIfNeeded` | CDP command handles all scroll containers automatically. |
| Internal fields in a11y output | Strip `backendNodeId`, `loaderId` | These are internal Puppeteer noise; replaced by the cleaner `ref` field. |

## Files to Create

### `src/ref-store.ts` — Ref ID storage (leaf module, no deps)
Module-level `Map<string, number>` mapping ref IDs → backendNodeId.
- `clearRefs()` — resets map + counter. Called on each snapshot and on navigation.
- `allocateRef(backendNodeId: number): string` — assigns next sequential ref "eN", stores mapping.
- `resolveRef(ref: string): number | undefined` — looks up backendNodeId, returns `undefined` if stale/invalid.
- `hasRefs(): boolean` — whether any refs have been allocated.

### `src/cdp-helpers.ts` — CDP interaction primitives
Uses `ensureCDPSession()` from `browser.ts` to make direct CDP protocol calls.
- `getElementCenter(backendNodeId): Promise<{x, y}>` — `DOM.scrollIntoViewIfNeeded` then `DOM.getContentQuads`, returns center of first quad.
- `clickByBackendNodeId(backendNodeId): Promise<{x, y}>` — scrolls into view, gets center, dispatches `mousePressed` + `mouseReleased` via `Input.dispatchMouseEvent`.
- `typeByBackendNodeId(backendNodeId, text, clear?): Promise<void>` — `DOM.focus`, optionally Ctrl+A to select all, then `Input.insertText`.
- `hoverByBackendNodeId(backendNodeId): Promise<{x, y}>` — scrolls into view, dispatches `mouseMoved`.

### `src/__tests__/ref-store.test.ts` — Unit tests for ref store
### `src/__tests__/cdp-helpers.test.ts` — Unit tests for CDP helpers (mock `ensureCDPSession`)

## Files to Modify

### `src/tools/observation.ts` — Enhance a11y snapshot with refs
- Import `clearRefs`, `allocateRef` from `ref-store.ts`
- Add `annotateTreeWithRefs(node)` function: recursively walks the a11y tree, assigns ref IDs to nodes with `backendNodeId`, strips internal fields (`backendNodeId`, `loaderId`)
- In `browser_a11y_snapshot` handler: call `clearRefs()` before traversal, annotate tree, serialize annotated version
- Update tool description to mention ref IDs

Example output after change:
```json
{"role": "RootWebArea", "name": "My App", "ref": "e1", "children": [
  {"role": "link", "name": "Dashboard", "ref": "e2"},
  {"role": "combobox", "name": "Filter", "value": "All", "ref": "e3"}
]}
```

### `src/tools/navigation.ts` — Add ref to click/type, add hover, clear refs on navigate
- **`browser_click`**: add optional `ref` param alongside `selector`. Validate exactly one provided. Ref path: `resolveRef()` → `clickByBackendNodeId()`. Selector path: unchanged.
- **`browser_type`**: same pattern — optional `ref`, validate, use `typeByBackendNodeId()` for ref path.
- **`browser_hover`** (new tool): accepts `selector` or `ref`. Selector path: `page.hover()`. Ref path: `hoverByBackendNodeId()`.
- **`browser_navigate`**: call `clearRefs()` before `page.goto()` — navigation invalidates all refs.
- Tool count: 8 → 9

### `src/tools/scrolling.ts` — Add ref to scroll_to_element
- **`browser_scroll_to_element`**: add optional `ref` param. Ref path: `DOM.scrollIntoViewIfNeeded` via CDP. Selector path: unchanged.

### `src/browser.ts` — Clear refs on tab switch
- In `switchToPage()`: import and call `clearRefs()` alongside the existing `cdpSession = null`.

### `src/flow/schema.ts` — Update flow DSL
- `ClickStep`, `TypeStep`: add optional `ref` field, use `.refine()` to enforce exactly one of `selector`/`ref`.
- Add `HoverStep` (action: "hover", selector or ref, label).
- Add `HoverStep` to `FlowStepSchema` union.

### `src/flow/runner.ts` — Handle ref-based steps + hover action
- Click/type cases: check for `step.ref`, resolve via `resolveRef()`, use CDP helpers.
- Add `case "hover"` with same selector/ref pattern.

### Test files to update
- `src/__tests__/observation.test.ts` — verify refs in output, verify internal fields stripped
- `src/__tests__/navigation.test.ts` — test ref paths for click/type, hover tool tests, refs cleared on navigate, tool count 8→9
- `src/__tests__/scrolling.test.ts` — test ref path for scroll_to_element
- `src/__tests__/flow-schema.test.ts` — test ref variants for click/type, hover step validation
- `src/__tests__/flow-runner.test.ts` — test ref-based step execution, hover action

## Implementation Order

1. `src/ref-store.ts` + `src/__tests__/ref-store.test.ts` — zero dependencies, pure logic
2. `src/cdp-helpers.ts` + `src/__tests__/cdp-helpers.test.ts` — depends on browser.ts
3. `src/tools/observation.ts` + test updates — depends on ref-store
4. `src/tools/navigation.ts` + test updates — depends on ref-store + cdp-helpers
5. `src/tools/scrolling.ts` + test updates — depends on ref-store + cdp-helpers
6. `src/browser.ts` — add `clearRefs()` to `switchToPage()`
7. `src/flow/schema.ts` + test updates — schema only
8. `src/flow/runner.ts` + test updates — depends on ref-store + cdp-helpers
9. Full test suite: `npm test`
10. Build verification: `npm run build`

## Edge Cases

| Scenario | Handling |
|----------|----------|
| Element is `display:none` or zero-size | `DOM.getContentQuads` returns empty quads → throw descriptive error |
| DOM changed since snapshot (SPA re-render) | CDP call fails with "Could not find node" → catch and suggest new snapshot |
| Tab switch | `switchToPage()` calls `clearRefs()` alongside CDP session reset |
| Both selector and ref provided | Validation error: "provide exactly one" |
| Neither selector nor ref provided | Validation error: "provide exactly one" |
| iframes | Out of scope — a11y snapshot with `interestingOnly: true` doesn't traverse iframes |
| Zod `.refine()` on steps | Already using `z.union()` (not discriminated), so `ZodEffects` from refine is compatible |

## Updated Tool Count

After implementation: **24 tools** across 6 groups (was 23).

| Group | Before | After | Change |
|-------|--------|-------|--------|
| Navigation | 8 | 9 | +`browser_hover` |
| Observation | 4 | 4 | a11y snapshot enhanced (same tool count) |
| Scrolling | 2 | 2 | scroll_to_element enhanced (same tool count) |
| Waiting | 3 | 3 | unchanged |
| Recording | 3 | 3 | unchanged |
| Flow | 3 | 3 | unchanged |

## Verification

1. `npm test` — all existing + new tests pass
2. `npm run build` — TypeScript compiles cleanly
3. Manual E2E test:
   - Connect to Chrome → `browser_a11y_snapshot` → verify ref IDs in output (e.g., `"ref": "e3"`)
   - `browser_click` with `ref: "e3"` → verify SPA navigation (no full page reload)
   - `browser_hover` with `ref: "e5"` → verify hover state triggers
   - `browser_type` with `ref: "e7"` → verify text input into custom component
   - Navigate to new page → attempt old ref → verify clear error message
