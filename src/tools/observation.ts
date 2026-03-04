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
import type { Page } from "puppeteer-core";
import { resolveConfigDir, confinePath, safeWriteFile } from "../util/path-confinement.js";
import { ensurePage } from "../browser.js";
import { clearRefs, allocateRef, getAllRefs, hasRefs } from "../ref-store.js";
import { batchGetBoundingBoxes } from "../cdp-helpers.js";
import { filterTree, formatA11yTree } from "../util/a11y-formatter.js";
import type { A11ySnapshotNode } from "../util/a11y-formatter.js";
import logger from "../util/logger.js";

/** Result shape returned by MCP tool handlers. */
type ToolResult = {
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: "image/png" }>;
  isError?: boolean;
};

/**
 * Read the allowed screenshot save directory.
 * Read lazily so env var changes and test overrides take effect.
 */
function getScreenshotDir(): string {
  return resolveConfigDir("SCREENSHOT_DIR", "/tmp/screen-cap-screenshots");
}

/** Hard recursion cap to prevent stack overflow on deeply nested or malformed trees. */
const MAX_ANNOTATE_DEPTH = 512;

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
export function annotateTreeWithRefs(node: A11ySnapshotNode, depth = 0): void {
  if (depth > MAX_ANNOTATE_DEPTH) return;

  if (typeof node.backendNodeId === "number") {
    node.ref = allocateRef(node.backendNodeId);
  }
  delete node.backendNodeId;
  delete node.loaderId;

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      annotateTreeWithRefs(child, depth + 1);
    }
  }
}

/**
 * Take an annotated screenshot with ref label overlays on interactive elements.
 *
 * Requires refs from a prior a11y snapshot. Injects a DOM overlay with labels,
 * takes a screenshot, then removes the overlay (with cleanup in finally).
 */
async function takeAnnotatedScreenshot(
  page: Page,
): Promise<ToolResult> {
  // Get all refs and their bounding boxes
  const refMap = getAllRefs(); // Map<string, number> (ref -> backendNodeId)
  const backendNodeIds = [...refMap.values()];
  const bboxMap = await batchGetBoundingBoxes(backendNodeIds);

  // Build list of visible labels (filter out null bounding boxes)
  const labels: Array<{ ref: string; x: number; y: number }> = [];
  for (const [ref, backendNodeId] of refMap) {
    const bbox = bboxMap.get(backendNodeId);
    if (bbox) {
      labels.push({ ref, x: bbox.x, y: bbox.y });
    }
  }

  // If all elements are off-screen, take a normal screenshot with a note
  if (labels.length === 0) {
    const base64 = (await page.screenshot({ encoding: "base64" })) as string;
    return {
      content: [
        { type: "image" as const, data: base64, mimeType: "image/png" as const },
        { type: "text" as const, text: "Note: All ref'd elements are off-screen. Showing normal screenshot without annotations." },
      ],
    };
  }

  logger.debug(`Annotated screenshot: injecting overlay with ${labels.length} labels`);

  // Inject overlay, take screenshot, remove overlay (with cleanup in finally)
  try {
    await page.evaluate((lbls: Array<{ ref: string; x: number; y: number }>) => {
      const overlay = document.createElement("div");
      overlay.id = "__scm_annotation_overlay";
      overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;";
      lbls.forEach(({ ref, x, y }) => {
        const el = document.createElement("span");
        el.textContent = "[" + ref + "]";
        el.style.cssText = "position:absolute;font-size:11px;font-weight:bold;color:#fff;background:rgba(0,0,0,0.7);padding:1px 4px;border-radius:3px;left:" + x + "px;top:" + y + "px;line-height:1.2;white-space:nowrap;";
        overlay.appendChild(el);
      });
      document.documentElement.appendChild(overlay);
    }, labels);

    const base64 = (await page.screenshot({ encoding: "base64" })) as string;
    return {
      content: [{ type: "image" as const, data: base64, mimeType: "image/png" as const }],
    };
  } finally {
    try {
      await page.evaluate(() => {
        const el = document.getElementById("__scm_annotation_overlay");
        if (el) el.remove();
      });
    } catch (cleanupErr) {
      logger.warn(`Failed to remove annotation overlay: ${(cleanupErr as Error).message}`);
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
    "Capture a screenshot of the viewport, full page, or a specific element. Set annotate: true to overlay [eN] ref labels on interactive elements (requires a prior browser_a11y_snapshot call). Returns an image content block that Claude can see.",
    {
      selector: z.string().optional(),
      fullPage: z.boolean().optional(),
      savePath: z.string().optional(),
      annotate: z.boolean().optional(),
    },
    async ({ selector, fullPage, savePath, annotate }) => {
      try {
        const page = await ensurePage();

        // ── Annotated screenshot mode ──────────────────────────────────
        if (annotate) {
          if (selector || fullPage || savePath) {
            return {
              content: [{ type: "text" as const, text: "The 'annotate' option cannot be combined with 'selector', 'fullPage', or 'savePath'." }],
              isError: true,
            };
          }

          // Require refs from a prior a11y snapshot
          if (!hasRefs()) {
            return {
              content: [{ type: "text" as const, text: "No refs available. Call browser_a11y_snapshot first." }],
              isError: true,
            };
          }

          return await takeAnnotatedScreenshot(page);
        }

        // ── Normal screenshot mode ─────────────────────────────────────

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
      maxDepth: z.number().int().min(0).max(100).optional(),
    },
    async ({ interestingOnly, format, maxDepth }) => {
      try {
        const page = await ensurePage();
        clearRefs();
        const snapshot = await page.accessibility.snapshot({
          interestingOnly: interestingOnly ?? true,
        });

        if (!snapshot) {
          return {
            content: [{ type: "text" as const, text: "null" }],
          };
        }

        const tree = snapshot as A11ySnapshotNode;
        annotateTreeWithRefs(tree);

        const outputFormat = format ?? "tree";

        let text: string;
        if (outputFormat === "json") {
          const raw = JSON.stringify(tree);
          text = raw.length > MAX_A11Y_CHARS
            ? raw.slice(0, MAX_A11Y_CHARS) + `\n... (truncated, total ${raw.length} chars)`
            : raw;
        } else {
          const filtered = filterTree(tree);
          text = formatA11yTree(filtered, { maxDepth });
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
