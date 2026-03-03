# Screen Cap MCP

An MCP server that gives Claude Code persistent browser automation with video recording, screenshots, and accessibility capture — all through a single Chrome connection that stays alive across tool calls.

## Why This Exists

Existing browser automation MCP servers (like Playwright MCP) create a new browser context for each interaction. This means:

- You lose login state between tool calls
- Page context resets after full-page reloads
- Multi-step workflows require re-navigating and re-authenticating

Screen Cap MCP solves this by connecting to an **already-running Chrome instance** via the Chrome DevTools Protocol (CDP). The connection persists as a module-level singleton, so the browser stays logged in, URLs stay correct, and page state is preserved across every tool call.

## Features

- **Persistent browser session** — single CDP connection across all tool calls
- **21 MCP tools** — navigation, observation, scrolling, waiting, recording, and flows
- **Video recording** — capture MP4/WebM recordings of browser sessions via `page.screencast()`
- **Screenshots** — full-page or element-specific PNGs returned as base64 (Claude can see them directly)
- **Accessibility snapshots** — semantic page structure as JSON
- **Flow automation** — define reusable multi-step sequences as JSON
- **Smart waiting** — detects loading indicators from MUI, Ant Design, Chakra, and other frameworks
- **Security hardened** — SSRF protection, path confinement, symlink checks, JS evaluation gated behind env var

## Prerequisites

- **Node.js** 18+
- **Chrome or Chromium** (any version with CDP support)
- **FFmpeg** (required only for video recording)

```bash
# macOS
brew install ffmpeg

# Linux
sudo apt-get install ffmpeg

# Windows
choco install ffmpeg
```

## Installation

```bash
git clone https://github.com/peterphot/screen-cap-mcp.git
cd screen-cap-mcp
npm install
npm run build
```

## Setup

### 1. Launch Chrome with Remote Debugging

```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 &

# Linux
google-chrome --remote-debugging-port=9222 &

# Windows
"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --remote-debugging-port=9222
```

### 2. Configure Claude Code

Add to your Claude Code MCP settings (`.claude/settings.json` or `.claude/settings.local.json`):

```json
{
  "mcpServers": {
    "screen-cap": {
      "command": "npx",
      "args": ["tsx", "src/index.ts"],
      "cwd": "/absolute/path/to/screen-cap-mcp"
    }
  }
}
```

Or run standalone for development:

```bash
npm run dev    # TypeScript directly via tsx
npm start      # After building with npm run build
```

### 3. Verify Connection

In Claude Code, call the `browser_connect` tool. It will return the title and URL of the active Chrome tab.

## Tools

### Navigation (8 tools)

| Tool | Description | Key Inputs |
|------|-------------|------------|
| `browser_connect` | Connect to Chrome via CDP | — |
| `browser_navigate` | Go to a URL | `url`, `waitUntil?` |
| `browser_click` | Click an element | `selector` |
| `browser_type` | Type into an input | `selector`, `text`, `clear?` |
| `browser_select` | Select a dropdown option | `selector`, `value` |
| `browser_evaluate` | Run JavaScript in page context | `script` |
| `browser_list_pages` | List all open tabs | — |
| `browser_switch_page` | Switch to a different tab | `index` |

> `browser_evaluate` requires `ALLOW_EVALUATE=true` to be set as an environment variable. This is disabled by default to prevent arbitrary JS execution.

### Observation (4 tools)

| Tool | Description | Key Inputs |
|------|-------------|------------|
| `browser_screenshot` | Capture a PNG screenshot | `selector?`, `fullPage?`, `savePath?` |
| `browser_a11y_snapshot` | Get the accessibility tree | `interestingOnly?` |
| `browser_get_page_info` | Get page URL, title, viewport size | — |
| `browser_get_text` | Extract text from an element | `selector` |

Screenshots are returned as base64-encoded images in the MCP response — Claude can see them directly without any external viewer.

### Scrolling (2 tools)

| Tool | Description | Key Inputs |
|------|-------------|------------|
| `browser_scroll` | Scroll page or container | `direction`, `amount?`, `selector?` |
| `browser_scroll_to_element` | Scroll element into view | `selector` |

### Waiting (3 tools)

| Tool | Description | Key Inputs |
|------|-------------|------------|
| `browser_wait_for_selector` | Wait for an element to appear/disappear | `selector`, `visible?`, `hidden?`, `timeout?` |
| `browser_wait_for_network_idle` | Wait for network activity to settle | `timeout?`, `idleTime?` |
| `browser_smart_wait` | Wait for loading indicators + network idle | `timeout?` |

`browser_smart_wait` checks for common loading patterns (MUI progress bars, Ant Design skeletons, Chakra spinners, generic `[aria-busy]` elements) and waits for them to disappear before also waiting for network idle.

### Recording (3 tools)

| Tool | Description | Key Inputs |
|------|-------------|------------|
| `browser_start_recording` | Start video capture | `outputPath?`, `format?` (mp4/webm) |
| `browser_stop_recording` | Stop recording and save | — |
| `browser_screenshot_key_moment` | Tag a labeled moment during recording | `label` |

Recording uses Puppeteer's native `page.screencast()` which streams frames via CDP and encodes with FFmpeg. Key moments capture both a screenshot and an accessibility snapshot with a timestamp offset.

### Flow Automation (3 tools)

| Tool | Description | Key Inputs |
|------|-------------|------------|
| `browser_run_flow` | Execute a flow definition | `name?` or `flow?`, `record?` |
| `browser_list_flows` | List saved flow files | — |
| `browser_save_flow` | Save a flow definition to disk | `flow` |

## Flows

Flows are JSON files that define reusable browser automation sequences. They can optionally record video and capture screenshots/accessibility data at each step.

### Example Flow

```json
{
  "name": "Example Walkthrough",
  "description": "Navigate to a page, wait for load, capture screenshots and a11y data",
  "recording": { "enabled": true, "format": "mp4" },
  "steps": [
    { "action": "navigate", "url": "https://example.com", "label": "nav-home" },
    { "action": "wait", "strategy": "smart", "timeout": 30000 },
    { "action": "screenshot", "label": "homepage-loaded" },
    { "action": "scroll", "direction": "down", "amount": 500 },
    { "action": "screenshot", "label": "below-fold" },
    { "action": "a11y_snapshot", "label": "page-structure" }
  ]
}
```

### Supported Step Actions

| Action | Fields | Description |
|--------|--------|-------------|
| `navigate` | `url`, `waitUntil?`, `label?` | Navigate to a URL |
| `click` | `selector`, `label?` | Click an element |
| `type` | `selector`, `text`, `clear?`, `label?` | Type into an input |
| `wait` | `strategy`, strategy-specific fields, `label?` | Wait for a condition |
| `scroll` | `direction?`, `amount?`, `selector?`, `label?` | Scroll the page or a container |
| `screenshot` | `selector?`, `fullPage?`, `label?` | Capture a screenshot |
| `a11y_snapshot` | `interestingOnly?`, `label?` | Capture the accessibility tree |
| `evaluate` | `script`, `label?` | Run JavaScript (requires `ALLOW_EVALUATE=true`) |
| `sleep` | `duration`, `label?` | Pause for a given number of milliseconds |

### Wait Strategies

```json
{ "action": "wait", "strategy": "selector", "selector": ".loaded", "timeout": 10000 }
{ "action": "wait", "strategy": "network_idle", "timeout": 30000 }
{ "action": "wait", "strategy": "smart", "timeout": 45000 }
{ "action": "wait", "strategy": "delay", "delay": 2000 }
{ "action": "wait", "strategy": "function", "function": "() => window.dataReady", "timeout": 30000 }
```

### Flow Output

When a flow runs, it creates a timestamped output directory:

```
/tmp/screen-cap-flows/
  example_walkthrough-2026-03-03T15-42-30-123Z/
    manifest.json          # Metadata + per-step results
    recording.mp4          # Video (if recording enabled)
    nav-home.png           # Labeled screenshots
    homepage-loaded.png
    below-fold.png
    page-structure.json    # A11y snapshot data
    error-step-3.png       # Auto-captured on step failure
```

The manifest includes timing, success/failure status, file paths, and error messages for each step. Flows continue executing after errors — failed steps are recorded but don't abort the sequence.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CHROME_CDP_URL` | `http://127.0.0.1:9222` | Chrome DevTools Protocol endpoint |
| `SCREENSHOT_DIR` | `/tmp/screen-cap-screenshots` | Screenshot output directory |
| `RECORDING_DIR` | `/tmp/screen-cap-recordings` | Video recording output directory |
| `FLOW_OUTPUT_DIR` | `/tmp/screen-cap-flows` | Flow execution output directory |
| `FLOWS_DIR` | `flows/` | Directory for saved flow definitions |
| `ALLOW_EVALUATE` | *(disabled)* | Set to `"true"` to enable `browser_evaluate` and flow `evaluate` steps |

## Security

- **SSRF protection** — `CHROME_CDP_URL` is restricted to loopback addresses (`127.0.0.1`, `localhost`, `::1`)
- **Path confinement** — all file writes are confined to their configured directories with traversal checks
- **Symlink detection** — resolved paths are verified post-`realpath` to prevent symlink escapes
- **JS evaluation gated** — `browser_evaluate` is disabled by default; must opt-in via `ALLOW_EVALUATE=true`
- **URL scheme validation** — only `http:` and `https:` URLs are allowed for navigation
- **Input validation** — all tool inputs and flow definitions are validated with Zod schemas

## Testing

```bash
npm test            # Run all tests once
npm run test:watch  # Watch mode
```

The test suite covers all 21 tools, the flow schema/runner, browser connection management, wait strategies, and logging. All external dependencies (puppeteer-core, filesystem) are mocked.

## Project Structure

```
src/
  index.ts                 # MCP server entry point
  browser.ts               # Persistent Chrome CDP connection (singleton)
  recording-state.ts       # Module-level recording state
  tools/
    navigation.ts          # 8 tools: connect, navigate, click, type, select, evaluate, list/switch pages
    observation.ts         # 4 tools: screenshot, a11y_snapshot, get_page_info, get_text
    scrolling.ts           # 2 tools: scroll, scroll_to_element
    waiting.ts             # 3 tools: wait_for_selector, wait_for_network_idle, smart_wait
    recording.ts           # 3 tools: start_recording, stop_recording, screenshot_key_moment
    flow.ts                # 3 tools: run_flow, list_flows, save_flow
  flow/
    schema.ts              # Zod schemas for flow definitions
    runner.ts              # FlowRunner — executes validated flows
  util/
    logger.ts              # stderr logging (stdout reserved for MCP protocol)
    wait-strategies.ts     # Smart wait selectors for common UI frameworks
  __tests__/               # 11 test files covering all modules
flows/                     # Saved flow definitions (JSON)
output/                    # Generated artifacts (screenshots, recordings)
```

## Architecture

**Persistent singleton connection** — The browser, page, and CDP session are held as module-level variables in `browser.ts`. All tool calls share the same connection. When Chrome disconnects, refs are nulled and the next tool call reconnects automatically.

**Promise guards** — `ensureBrowser()`, `ensurePage()`, and `ensureCDPSession()` use promise guards so concurrent tool calls share a single connection attempt instead of racing.

**Stdio transport** — The MCP server communicates over stdin/stdout using the MCP SDK's `StdioServerTransport`. All logging goes to stderr to keep stdout clean for the JSON protocol.

**Graceful shutdown** — SIGINT/SIGTERM handlers stop any active recording before exiting.

## License

MIT
