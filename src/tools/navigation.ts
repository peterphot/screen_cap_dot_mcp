/**
 * Navigation tools for the MCP server.
 *
 * Registers 13 browser automation tools on the McpServer instance:
 * - browser_connect: Connect to Chrome via CDP
 * - browser_navigate: Navigate to URL
 * - browser_click: Click element by CSS selector or ref
 * - browser_click_at: Click at absolute viewport coordinates
 * - browser_type: Type into input field by CSS selector or ref
 * - browser_hover: Hover over element by CSS selector or ref
 * - browser_hover_at: Hover at absolute viewport coordinates
 * - browser_press_key: Dispatch keyboard events (Escape, Tab, Enter, arrows, modifiers)
 * - browser_select: Select dropdown option
 * - browser_evaluate: Run arbitrary JS in page context
 * - browser_scroll_to_text: Scroll page until given text is visible
 * - browser_list_pages: List open tabs
 * - browser_switch_page: Switch to a different tab
 *
 * All handlers wrap their logic in try/catch and return error messages
 * as text content (never throw).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ensureBrowser,
  ensurePage,
  listAllPages,
  switchToPage,
  DEFAULT_TIMEOUT_MS,
} from "../browser.js";
import { isRecordingActive } from "../recording-state.js";
import { clearRefs } from "../ref-store.js";
import { performClick, performType, performHover } from "../util/actions.js";
import { clickAtCoordinates, hoverAtCoordinates } from "../cdp-helpers.js";
import { validateNavigationUrl } from "../util/url-validation.js";
import { KEY_FORMAT_PATTERN, KEY_FORMAT_MESSAGE } from "../flow/schema.js";
import logger from "../util/logger.js";

/**
 * Register all navigation tools on the given MCP server.
 */
export function registerNavigationTools(server: McpServer): void {
  // ── browser_connect ──────────────────────────────────────────────────

  server.tool(
    "browser_connect",
    "Connect to Chrome via CDP. Uses an already-running Chrome instance with remote debugging enabled.",
    {},
    async () => {
      try {
        await ensureBrowser();
        const page = await ensurePage();
        const url = page.url();
        const title = await page.title();
        return {
          content: [{ type: "text" as const, text: `Connected to Chrome. Active page: ${title} (${url})` }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error connecting to Chrome: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  // ── browser_navigate ─────────────────────────────────────────────────

  server.tool(
    "browser_navigate",
    "Navigate the browser to a URL.",
    {
      url: z.string().describe("URL to navigate to (http/https only)"),
      waitUntil: z.enum(["load", "domcontentloaded", "networkidle0", "networkidle2"]).optional().describe("Navigation wait strategy (default: 'load')"),
    },
    async ({ url, waitUntil }) => {
      try {
        // Validate URL scheme to prevent file:// and javascript: navigation
        const urlResult = validateNavigationUrl(url);
        if ("error" in urlResult) {
          return {
            content: [{ type: "text" as const, text: `Error navigating: ${urlResult.error}` }],
            isError: true,
          };
        }

        const page = await ensurePage();
        await page.goto(urlResult.href, {
          waitUntil: waitUntil ?? "load",
          timeout: DEFAULT_TIMEOUT_MS,
        });
        clearRefs();
        const finalUrl = page.url();
        const title = await page.title();
        return {
          content: [{ type: "text" as const, text: `Navigated to: ${title} (${finalUrl})` }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error navigating: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  // ── browser_click ────────────────────────────────────────────────────

  server.tool(
    "browser_click",
    "Click an element. PREFERRED: use `ref` from browser_a11y_snapshot (e.g. ref='e3'). Alternative: CSS selector.",
    { selector: z.string().optional().describe("CSS selector of the element to click"), ref: z.string().optional().describe("Ref from browser_a11y_snapshot (e.g. 'e3')") },
    async ({ selector, ref }) => {
      try {
        await performClick(selector, ref);
        const target = ref ? `ref: ${ref}` : selector;
        return {
          content: [{ type: "text" as const, text: `Clicked ${target}` }],
        };
      } catch (err) {
        const target = ref ? `ref ${ref}` : selector;
        return {
          content: [{ type: "text" as const, text: `Error clicking ${target}: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  // ── browser_type ─────────────────────────────────────────────────────

  server.tool(
    "browser_type",
    "Type text into an input. PREFERRED: use `ref` from browser_a11y_snapshot (e.g. ref='e6'). Alternative: CSS selector.",
    {
      selector: z.string().optional().describe("CSS selector of the input element"),
      ref: z.string().optional().describe("Ref from browser_a11y_snapshot (e.g. 'e6')"),
      text: z.string().describe("Text to type into the input"),
      clear: z.boolean().optional().describe("Clear existing content before typing (default: false)"),
    },
    async ({ selector, ref, text, clear }) => {
      try {
        await performType(text, selector, ref, clear);
        const target = ref ? `ref: ${ref}` : selector;
        return {
          content: [{ type: "text" as const, text: `Typed into ${target}` }],
        };
      } catch (err) {
        const target = ref ? `ref ${ref}` : selector;
        return {
          content: [{ type: "text" as const, text: `Error typing into ${target}: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  // ── browser_hover ────────────────────────────────────────────────────

  server.tool(
    "browser_hover",
    "Hover over an element. PREFERRED: use `ref` from browser_a11y_snapshot. Alternative: CSS selector.",
    { selector: z.string().optional().describe("CSS selector of the element to hover over"), ref: z.string().optional().describe("Ref from browser_a11y_snapshot") },
    async ({ selector, ref }) => {
      try {
        await performHover(selector, ref);
        const target = ref ? `ref: ${ref}` : selector;
        return {
          content: [{ type: "text" as const, text: `Hovered ${target}` }],
        };
      } catch (err) {
        const target = ref ? `ref ${ref}` : selector;
        return {
          content: [{ type: "text" as const, text: `Error hovering ${target}: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  // ── browser_click_at ─────────────────────────────────────────────────

  server.tool(
    "browser_click_at",
    "Click at absolute viewport coordinate (x, y). Prefer browser_click with refs when available; use coordinate-based tools as a fallback for Canvas-rendered charts, custom visualizations, or WebGL elements where CSS selectors and a11y refs are unavailable.",
    {
      x: z.number().nonnegative().describe("X coordinate in viewport pixels"),
      y: z.number().nonnegative().describe("Y coordinate in viewport pixels"),
      label: z.string().optional().describe("Human-readable label for the click target (e.g. 'bar-chart-q3')"),
    },
    async ({ x, y, label }) => {
      try {
        await clickAtCoordinates(x, y);
        const desc = label ? ` (${label})` : "";
        return {
          content: [{ type: "text" as const, text: `Clicked at (${x}, ${y})${desc}` }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error clicking at (${x}, ${y}): ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  // ── browser_hover_at ────────────────────────────────────────────────

  server.tool(
    "browser_hover_at",
    "Hover at absolute viewport coordinate (x, y). Prefer browser_hover with refs when available; use coordinate-based tools as a fallback for Canvas-rendered charts, custom visualizations, or triggering tooltips on non-DOM elements where CSS selectors and a11y refs are unavailable.",
    {
      x: z.number().nonnegative().describe("X coordinate in viewport pixels"),
      y: z.number().nonnegative().describe("Y coordinate in viewport pixels"),
      label: z.string().optional().describe("Human-readable label for the hover target (e.g. 'chart-tooltip-area')"),
    },
    async ({ x, y, label }) => {
      try {
        await hoverAtCoordinates(x, y);
        const desc = label ? ` (${label})` : "";
        return {
          content: [{ type: "text" as const, text: `Hovered at (${x}, ${y})${desc}` }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error hovering at (${x}, ${y}): ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  // ── browser_press_key ────────────────────────────────────────────────

  server.tool(
    "browser_press_key",
    "Dispatch a keyboard event. Supports common keys (Escape, Tab, Enter, ArrowDown, ArrowUp, ArrowLeft, ArrowRight) and modifier combinations (e.g. \"Control+a\" for select-all).",
    {
      key: z.string().max(100).regex(KEY_FORMAT_PATTERN, KEY_FORMAT_MESSAGE).describe("Key to press (e.g. 'Escape', 'Tab', 'Enter', 'ArrowDown', 'Control+a')"),
    },
    async ({ key }) => {
      try {
        const page = await ensurePage();
        await page.keyboard.press(key);
        return {
          content: [{ type: "text" as const, text: `Pressed key: ${key}` }],
        };
      } catch (err) {
        const safeKey = key.length > 50 ? key.slice(0, 50) + "\u2026" : key;
        return {
          content: [{ type: "text" as const, text: `Error pressing key ${safeKey}: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  // ── browser_select ───────────────────────────────────────────────────

  server.tool(
    "browser_select",
    "Select a dropdown option by value.",
    {
      selector: z.string().describe("CSS selector of the <select> element"),
      value: z.string().describe("Value attribute of the <option> to select"),
    },
    async ({ selector, value }) => {
      try {
        const page = await ensurePage();
        await page.select(selector, value);
        return {
          content: [{ type: "text" as const, text: `Selected ${value} in ${selector}` }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error selecting in ${selector}: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  // ── browser_evaluate ─────────────────────────────────────────────────
  // Only register when ALLOW_EVALUATE=true to reduce attack surface visibility

  if (process.env.ALLOW_EVALUATE === "true") {
    server.tool(
      "browser_evaluate",
      "Run arbitrary JavaScript in the page context and return the result. WARNING: This executes code with full access to the page (cookies, localStorage, DOM, network). Only use in trusted environments.",
      { script: z.string().describe("JavaScript code to execute in the page context") },
      async ({ script }) => {
        try {
          logger.warn(`[AUDIT] browser_evaluate called. Script length: ${script.length} chars`);

          const page = await ensurePage();
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          const result = await page.evaluate(script);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
          };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error evaluating script: ${(err as Error).message}` }],
            isError: true,
          };
        }
      },
    );
  }

  // ── browser_scroll_to_text ───────────────────────────────────────────

  server.tool(
    "browser_scroll_to_text",
    "Scroll the page until a given text string is visible in the viewport. Uses case-insensitive partial matching against visible text nodes.",
    {
      text: z.string().min(1).describe("Text to search for on the page (case-insensitive partial match)"),
      timeout: z.number().nonnegative().max(300_000).optional().describe("Timeout in ms (default: 10000)"),
    },
    async ({ text, timeout }) => {
      try {
        const page = await ensurePage();
        const searchText = text.toLowerCase();
        const _timeout = timeout ?? 10_000;

        const found = await page.evaluate(
          (txt: string) => {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            let node: Node | null;
            while ((node = walker.nextNode())) {
              const content = node.textContent ?? "";
              if (content.toLowerCase().includes(txt)) {
                const el = node.parentElement;
                if (el) {
                  el.scrollIntoView({ behavior: "smooth", block: "center" });
                  return true;
                }
              }
            }
            return false;
          },
          searchText,
        );

        if (!found) {
          return {
            content: [{ type: "text" as const, text: `Text "${text}" not found on page` }],
            isError: true,
          };
        }

        // Brief settle time for smooth scroll to complete
        await new Promise((resolve) => setTimeout(resolve, 250));

        logger.info(`Scrolled to text: "${text}" (timeout: ${_timeout}ms)`);

        return {
          content: [{ type: "text" as const, text: `Scrolled to text "${text}"` }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error scrolling to text: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  // ── browser_list_pages ───────────────────────────────────────────────

  server.tool(
    "browser_list_pages",
    "List all open browser tabs with their index, URL, and title.",
    {},
    async () => {
      try {
        const pages = await listAllPages();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(pages) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error listing pages: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  // ── browser_switch_page ──────────────────────────────────────────────

  server.tool(
    "browser_switch_page",
    "Switch to a different browser tab by index.",
    { index: z.number().describe("Zero-based tab index (see browser_list_pages)") },
    async ({ index }) => {
      try {
        if (isRecordingActive()) {
          return {
            content: [{ type: "text" as const, text: "Error: Cannot switch tabs while recording is active. Stop the recording first." }],
            isError: true,
          };
        }
        const page = await switchToPage(index);
        const url = page.url();
        const title = await page.title();
        return {
          content: [{ type: "text" as const, text: `Switched to tab ${index}: ${title} (${url})` }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error switching tab: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );
}
