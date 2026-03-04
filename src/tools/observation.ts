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
import { resolveConfigDir, confinePath, safeWriteFile } from "../util/path-confinement.js";
import { ensurePage } from "../browser.js";
import { clearRefs, allocateRef } from "../ref-store.js";
import { filterTree, formatA11yTree } from "../util/a11y-formatter.js";
import type { A11ySnapshotNode } from "../util/a11y-formatter.js";
import logger from "../util/logger.js";

/**
 * Read the allowed screenshot save directory.
 * Read lazily so env var changes and test overrides take effect.
 */
function getScreenshotDir(): string {
  return resolveConfigDir("SCREENSHOT_DIR", "/tmp/screen-cap-screenshots");
}

/**
 * Recursively annotate an accessibility tree node with ref IDs.
 *
 * For each node that has a `backendNodeId` (number), allocates a sequential
 * ref ID via `allocateRef` and adds a `ref` field. Strips internal fields
 * (`backendNodeId`, `loaderId`) that are not useful to the LLM consumer.
 * Processes `children` recursively.
 *
 * Mutates the node in-place.
 */
export function annotateTreeWithRefs(node: A11ySnapshotNode): void {
  if (typeof node.backendNodeId === "number") {
    node.ref = allocateRef(node.backendNodeId);
  }
  delete node.backendNodeId;
  delete node.loaderId;

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      annotateTreeWithRefs(child);
    }
  }
}

/** Maximum character length for a11y tree JSON before truncation. */
const MAX_A11Y_CHARS = 512_000;

/** Maximum character length for extracted text before truncation. */
const MAX_TEXT_CHARS = 512_000;

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

        // Validate and confine savePath if provided
        let confinedSavePath: string | undefined;
        if (savePath) {
          const pathResult = await confinePath(savePath, getScreenshotDir());
          if ("error" in pathResult) {
            return {
              content: [{ type: "text" as const, text: `Error: ${pathResult.error}` }],
              isError: true,
            };
          }
          confinedSavePath = pathResult.resolvedPath;
        }

        let base64: string;

        if (selector) {
          const element = await page.$(selector);
          if (!element) {
            return {
              content: [{ type: "text" as const, text: `Error: element not found for selector: ${selector}` }],
              isError: true,
            };
          }

          if (confinedSavePath) {
            const buffer = (await element.screenshot()) as Buffer;
            await safeWriteFile(confinedSavePath, buffer);
            logger.info(`Screenshot saved to ${confinedSavePath}`);
            base64 = buffer.toString("base64");
          } else {
            base64 = (await element.screenshot({ encoding: "base64" })) as string;
          }
        } else {
          const opts = { fullPage: fullPage ?? false };

          if (confinedSavePath) {
            const buffer = (await page.screenshot(opts)) as Buffer;
            await safeWriteFile(confinedSavePath, buffer);
            logger.info(`Screenshot saved to ${confinedSavePath}`);
            base64 = buffer.toString("base64");
          } else {
            base64 = (await page.screenshot({ ...opts, encoding: "base64" })) as string;
          }
        }

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
    'Capture the accessibility tree of the current page. Returns a compact indented text format by default with ref IDs (e.g. [e1]) prominently displayed at the start of each line. Set format: "json" for the full JSON representation. Ref IDs can be used with browser_click, browser_type, browser_scroll_to_element, and browser_hover instead of CSS selectors.',
    {
      interestingOnly: z.boolean().optional(),
      format: z.enum(["tree", "json"]).optional(),
      maxDepth: z.number().optional(),
    },
    async ({ interestingOnly, format, maxDepth }) => {
      try {
        const page = await ensurePage();
        clearRefs();
        const snapshot = await page.accessibility.snapshot({
          interestingOnly: interestingOnly ?? true,
        });

        if (snapshot) {
          annotateTreeWithRefs(snapshot as A11ySnapshotNode);
        }

        const outputFormat = format ?? "tree";

        let text: string;
        if (outputFormat === "json" || !snapshot) {
          const raw = JSON.stringify(snapshot);
          text = raw.length > MAX_A11Y_CHARS
            ? raw.slice(0, MAX_A11Y_CHARS) + `\n... (truncated, total ${raw.length} chars)`
            : raw;
        } else {
          const filtered = filterTree(snapshot as A11ySnapshotNode);
          text = formatA11yTree(filtered, maxDepth !== undefined ? { maxDepth } : undefined);
          if (text.length > MAX_A11Y_CHARS) {
            text = text.slice(0, MAX_A11Y_CHARS) + `\n... (truncated, total ${text.length} chars)`;
          }
        }

        return {
          content: [{ type: "text" as const, text }],
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
        const raw = await page.$eval(selector, (el: Element) => (el as HTMLElement).innerText);

        const text = raw.length > MAX_TEXT_CHARS
          ? raw.slice(0, MAX_TEXT_CHARS) + `\n... (truncated, total ${raw.length} chars)`
          : raw;

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
