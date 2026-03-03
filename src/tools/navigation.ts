/**
 * Navigation tools for the MCP server.
 *
 * Registers 9 browser automation tools on the McpServer instance:
 * - browser_connect: Connect to Chrome via CDP
 * - browser_navigate: Navigate to URL
 * - browser_click: Click element by CSS selector or ref
 * - browser_type: Type into input field by CSS selector or ref
 * - browser_hover: Hover over element by CSS selector or ref
 * - browser_select: Select dropdown option
 * - browser_evaluate: Run arbitrary JS in page context
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
import { resolveRef, clearRefs } from "../ref-store.js";
import { clickByBackendNodeId, typeByBackendNodeId, hoverByBackendNodeId } from "../cdp-helpers.js";

// ── Validation Helper ─────────────────────────────────────────────────

/**
 * Validate that exactly one of selector or ref is provided.
 * Returns a discriminated union indicating which path to take,
 * or an error string if validation fails.
 */
function validateSelectorOrRef(
  selector?: string,
  ref?: string,
): { type: "selector"; value: string } | { type: "ref"; backendNodeId: number } | { error: string } {
  if (selector && ref) {
    return { error: "Provide either selector or ref, not both." };
  }
  if (!selector && !ref) {
    return { error: "Provide either a CSS selector or a ref from browser_a11y_snapshot." };
  }
  if (ref) {
    const nodeId = resolveRef(ref);
    if (nodeId === undefined) {
      return { error: `Stale or invalid ref "${ref}". Take a new browser_a11y_snapshot to get fresh refs.` };
    }
    return { type: "ref", backendNodeId: nodeId };
  }
  return { type: "selector", value: selector! };
}

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
      url: z.string(),
      waitUntil: z.enum(["load", "domcontentloaded", "networkidle0", "networkidle2"]).optional(),
    },
    async ({ url, waitUntil }) => {
      try {
        // Validate URL scheme to prevent file:// and javascript: navigation
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          return {
            content: [{ type: "text" as const, text: `Error navigating: Invalid URL "${url}"` }],
            isError: true,
          };
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return {
            content: [{ type: "text" as const, text: `Error navigating: Only http: and https: URLs are allowed, got "${parsed.protocol}"` }],
            isError: true,
          };
        }

        const page = await ensurePage();
        await page.goto(parsed.href, {
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
    "Click an element on the page. Accepts either a CSS selector or a ref from browser_a11y_snapshot.",
    { selector: z.string().optional(), ref: z.string().optional() },
    async ({ selector, ref }) => {
      try {
        const resolved = validateSelectorOrRef(selector, ref);
        if ("error" in resolved) {
          return {
            content: [{ type: "text" as const, text: `Error: ${resolved.error}` }],
            isError: true,
          };
        }

        if (resolved.type === "ref") {
          await clickByBackendNodeId(resolved.backendNodeId);
          return {
            content: [{ type: "text" as const, text: `Clicked ref: ${ref}` }],
          };
        }

        const page = await ensurePage();
        await page.waitForSelector(resolved.value, { visible: true });
        await page.click(resolved.value);
        return {
          content: [{ type: "text" as const, text: `Clicked: ${resolved.value}` }],
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
    "Type text into an input field. Accepts either a CSS selector or a ref from browser_a11y_snapshot.",
    {
      selector: z.string().optional(),
      ref: z.string().optional(),
      text: z.string(),
      clear: z.boolean().optional(),
    },
    async ({ selector, ref, text, clear }) => {
      try {
        const resolved = validateSelectorOrRef(selector, ref);
        if ("error" in resolved) {
          return {
            content: [{ type: "text" as const, text: `Error: ${resolved.error}` }],
            isError: true,
          };
        }

        if (resolved.type === "ref") {
          await typeByBackendNodeId(resolved.backendNodeId, text, clear);
          return {
            content: [{ type: "text" as const, text: `Typed into ref: ${ref}` }],
          };
        }

        const page = await ensurePage();
        if (clear) {
          // Triple-click to select all existing content, then type to replace
          await page.click(resolved.value, { clickCount: 3 });
        } else {
          await page.click(resolved.value);
        }
        await page.type(resolved.value, text);
        return {
          content: [{ type: "text" as const, text: `Typed into ${resolved.value}` }],
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
    "Hover over an element on the page. Accepts either a CSS selector or a ref from browser_a11y_snapshot.",
    { selector: z.string().optional(), ref: z.string().optional() },
    async ({ selector, ref }) => {
      try {
        const resolved = validateSelectorOrRef(selector, ref);
        if ("error" in resolved) {
          return {
            content: [{ type: "text" as const, text: `Error: ${resolved.error}` }],
            isError: true,
          };
        }

        if (resolved.type === "ref") {
          await hoverByBackendNodeId(resolved.backendNodeId);
          return {
            content: [{ type: "text" as const, text: `Hovered ref: ${ref}` }],
          };
        }

        const page = await ensurePage();
        await page.hover(resolved.value);
        return {
          content: [{ type: "text" as const, text: `Hovered: ${resolved.value}` }],
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

  // ── browser_select ───────────────────────────────────────────────────

  server.tool(
    "browser_select",
    "Select a dropdown option by value.",
    {
      selector: z.string(),
      value: z.string(),
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

  server.tool(
    "browser_evaluate",
    "Run arbitrary JavaScript in the page context and return the result. WARNING: This executes code with full access to the page (cookies, localStorage, DOM, network). Only use in trusted environments.",
    { script: z.string() },
    async ({ script }) => {
      try {
        if (process.env.ALLOW_EVALUATE !== "true") {
          return {
            content: [{ type: "text" as const, text: "Error: browser_evaluate is disabled. Set ALLOW_EVALUATE=true to enable arbitrary JS execution." }],
            isError: true,
          };
        }

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
    { index: z.number() },
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
