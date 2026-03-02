/**
 * Observation tools for the MCP server.
 *
 * Registers 4 browser observation tools on the McpServer instance:
 * - browser_screenshot: Capture viewport, full-page, or element screenshot
 * - browser_a11y_snapshot: Capture the accessibility tree
 * - browser_get_page_info: Get current page metadata (URL, title, dimensions)
 * - browser_get_text: Get innerText of an element by CSS selector
 *
 * All handlers wrap their logic in try/catch and return error messages
 * as text content (never throw).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { ensurePage } from "../browser.js";
import logger from "../util/logger.js";

/**
 * Register all observation tools on the given MCP server.
 */
export function registerObservationTools(server: McpServer): void {
  // ── browser_screenshot ───────────────────────────────────────────────

  server.tool(
    "browser_screenshot",
    "Capture a screenshot of the viewport, full page, or a specific element. Returns an image content block that Claude can see.",
    {
      selector: z.string().optional(),
      fullPage: z.boolean().optional(),
      savePath: z.string().optional(),
    },
    async ({ selector, fullPage, savePath }) => {
      try {
        const page = await ensurePage();
        let buffer: Buffer;

        if (selector) {
          const element = await page.$(selector);
          if (!element) {
            return {
              content: [{ type: "text" as const, text: `Error: element not found for selector: ${selector}` }],
              isError: true,
            };
          }
          buffer = (await element.screenshot()) as Buffer;
        } else {
          buffer = (await page.screenshot({ fullPage: fullPage ?? false })) as Buffer;
        }

        if (savePath) {
          await mkdir(dirname(savePath), { recursive: true });
          await writeFile(savePath, buffer);
          logger.info(`Screenshot saved to ${savePath}`);
        }

        const base64 = buffer.toString("base64");

        return {
          content: [{ type: "image" as const, data: base64, mimeType: "image/png" as const }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error taking screenshot: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  // ── browser_a11y_snapshot ────────────────────────────────────────────

  server.tool(
    "browser_a11y_snapshot",
    "Capture the accessibility tree of the current page. Returns a JSON representation of the a11y tree.",
    {
      interestingOnly: z.boolean().optional(),
    },
    async ({ interestingOnly }) => {
      try {
        const page = await ensurePage();
        const snapshot = await page.accessibility.snapshot({
          interestingOnly: interestingOnly ?? true,
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify(snapshot, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error capturing a11y snapshot: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  // ── browser_get_page_info ────────────────────────────────────────────

  server.tool(
    "browser_get_page_info",
    "Get metadata about the current page: URL, title, viewport dimensions, and document scroll dimensions.",
    {},
    async () => {
      try {
        const page = await ensurePage();
        const url = page.url();
        const title = await page.title();
        const viewport = page.viewport();
        const scrollDimensions = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          scrollHeight: document.documentElement.scrollHeight,
        }));

        const viewportInfo = viewport
          ? `Viewport: ${viewport.width}x${viewport.height}`
          : "Viewport: unknown (defaultViewport: null)";

        const text = [
          `URL: ${url}`,
          `Title: ${title}`,
          viewportInfo,
          `Document scroll size: ${scrollDimensions.scrollWidth}x${scrollDimensions.scrollHeight}`,
        ].join("\n");

        return {
          content: [{ type: "text" as const, text }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error getting page info: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  // ── browser_get_text ─────────────────────────────────────────────────

  server.tool(
    "browser_get_text",
    "Get the innerText of an element identified by CSS selector.",
    {
      selector: z.string(),
    },
    async ({ selector }) => {
      try {
        const page = await ensurePage();
        const text = await page.$eval(selector, (el: Element) => (el as HTMLElement).innerText);

        return {
          content: [{ type: "text" as const, text }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error getting text from ${selector}: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );
}
