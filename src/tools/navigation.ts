/**
 * Navigation tools for the MCP server.
 *
 * Registers 8 browser automation tools on the McpServer instance:
 * - browser_connect: Connect to Chrome via CDP
 * - browser_navigate: Navigate to URL
 * - browser_click: Click element by CSS selector
 * - browser_type: Type into input field
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
} from "../browser.js";

/**
 * Register all navigation tools on the given MCP server.
 */
export function registerNavigationTools(server: McpServer): void {
  // ── browser_connect ──────────────────────────────────────────────────

  server.tool(
    "browser_connect",
    "Connect to Chrome via CDP. Uses an already-running Chrome instance with remote debugging enabled.",
    { port: z.number().optional() },
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
        const page = await ensurePage();
        await page.goto(url, {
          waitUntil: waitUntil ?? "load",
          timeout: 60000,
        });
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
    "Click an element on the page by CSS selector.",
    { selector: z.string() },
    async ({ selector }) => {
      try {
        const page = await ensurePage();
        await page.waitForSelector(selector, { visible: true });
        await page.click(selector);
        return {
          content: [{ type: "text" as const, text: `Clicked: ${selector}` }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error clicking ${selector}: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  // ── browser_type ─────────────────────────────────────────────────────

  server.tool(
    "browser_type",
    "Type text into an input field identified by CSS selector.",
    {
      selector: z.string(),
      text: z.string(),
      clear: z.boolean().optional(),
    },
    async ({ selector, text, clear }) => {
      try {
        const page = await ensurePage();
        if (clear) {
          // Triple-click to select all existing content, then type to replace
          await page.click(selector, { clickCount: 3 });
        } else {
          await page.click(selector);
        }
        await page.type(selector, text);
        return {
          content: [{ type: "text" as const, text: `Typed into ${selector}` }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error typing into ${selector}: ${(err as Error).message}` }],
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
    "Run arbitrary JavaScript in the page context and return the result.",
    { script: z.string() },
    async ({ script }) => {
      try {
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
