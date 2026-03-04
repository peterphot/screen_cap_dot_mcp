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
import { batchGetBoundingBoxes, getBatchLimit } from "../cdp-helpers.js";
import { filterTree, formatA11yTree } from "../util/a11y-formatter.js";
import type { A11ySnapshotNode } from "../util/a11y-formatter.js";
import logger from "../util/logger.js";

// ── Ref role tracking (for priority filtering) ───────────────────────────

/** Maps ref string (e.g. "e1") to a11y role (e.g. "button"). */
const refRoles = new Map<string, string>();

/** Clear the refRoles map. Called alongside clearRefs during snapshot. */
export function clearRefRoles(): void {
  refRoles.clear();
}

/** Set the role for a ref. Called by annotateTreeWithRefs. */
export function setRefRole(ref: string, role: string): void {
  refRoles.set(ref, role);
}

/** Return a snapshot (shallow copy) of all ref role mappings. */
export function getRefRoles(): Map<string, string> {
  return new Map(refRoles);
}

// ── Priority-based ref filtering ─────────────────────────────────────────

/**
 * Role priority tiers for annotation filtering.
 * Lower number = higher priority (kept first when filtering).
 */
const ROLE_PRIORITY: Record<string, number> = {
  // Tier 1: Primary interactive elements
  button: 1,
  link: 1,
  textbox: 1,
  combobox: 1,
  searchbox: 1,
  spinbutton: 1,
  slider: 1,
  switch: 1,
  // Tier 2: Secondary interactive elements
  checkbox: 2,
  radio: 2,
  menuitem: 2,
  tab: 2,
  option: 2,
  listbox: 2,
  menu: 2,
  menubar: 2,
  tablist: 2,
  treeitem: 2,
  // Tier 3: Containers and landmarks
  navigation: 3,
  dialog: 3,
  alertdialog: 3,
  toolbar: 3,
  form: 3,
  // Tier 4: Informational
  heading: 4,
  img: 4,
  alert: 4,
  status: 4,
  tooltip: 4,
  // Tier 5: Structural (low priority)
  list: 5,
  listitem: 5,
  table: 5,
  row: 5,
  group: 5,
  region: 5,
  // Tier 6: Low-value for annotation (filtered first)
  cell: 6,
  gridcell: 6,
  columnheader: 6,
  rowheader: 6,
  StaticText: 6,
  generic: 6,
  none: 6,
  paragraph: 6,
};

/** Default priority for roles not in the lookup table. */
const DEFAULT_PRIORITY = 5;

/**
 * Filter refs by a11y role priority, keeping the most interactive elements.
 *
 * Pure function: takes the ref map, role map, and limit as parameters.
 * Returns the filtered ref map and metadata about the filtering.
 *
 * @param refMap - Map of ref -> backendNodeId (from getAllRefs)
 * @param roles - Map of ref -> role (from getRefRoles)
 * @param limit - Maximum number of refs to keep
 */
export function filterRefsByPriority(
  refMap: Map<string, number>,
  roles: Map<string, string>,
  limit: number,
): { filtered: Map<string, number>; totalCount: number; wasFiltered: boolean } {
  const totalCount = refMap.size;

  if (totalCount <= limit) {
    return { filtered: new Map(refMap), totalCount, wasFiltered: false };
  }

  // Bucket entries by priority tier (O(n) instead of O(n log n) sort)
  const buckets = new Map<number, Array<[string, number]>>();
  for (const [ref, nodeId] of refMap) {
    const role = roles.get(ref);
    const priority = role ? (ROLE_PRIORITY[role] ?? DEFAULT_PRIORITY) : DEFAULT_PRIORITY + 1;
    let bucket = buckets.get(priority);
    if (!bucket) {
      bucket = [];
      buckets.set(priority, bucket);
    }
    bucket.push([ref, nodeId]);
  }

  // Flatten buckets in priority order until we hit the limit
  const priorityKeys = [...buckets.keys()].sort((a, b) => a - b);
  const filtered = new Map<string, number>();
  for (const key of priorityKeys) {
    for (const [ref, nodeId] of buckets.get(key)!) {
      if (filtered.size >= limit) break;
      filtered.set(ref, nodeId);
    }
    if (filtered.size >= limit) break;
  }

  return { filtered, totalCount, wasFiltered: true };
}

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
    const ref = allocateRef(node.backendNodeId);
    node.ref = ref;
    // Track role for priority filtering in annotated screenshots
    if (node.role) {
      setRefRole(ref, node.role);
    }
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
  const allRefMap = getAllRefs(); // Map<string, number> (ref -> backendNodeId)
  const limit = getBatchLimit();

  // Apply priority filtering if ref count exceeds batch limit
  const { filtered: refMap, totalCount, wasFiltered } = filterRefsByPriority(
    allRefMap,
    getRefRoles(),
    limit,
  );

  if (wasFiltered) {
    logger.debug(`Annotated screenshot: filtered ${refMap.size} of ${totalCount} refs (batch limit ${limit})`);
  }

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

    const content: ToolResult["content"] = [
      { type: "image" as const, data: base64, mimeType: "image/png" as const },
    ];

    // Include filtering note when elements were filtered
    if (wasFiltered) {
      content.push({
        type: "text" as const,
        text: `Note: Annotated ${refMap.size} of ${totalCount} interactive elements (filtered by role priority to stay within batch limit).`,
      });
    }

    return { content };
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
    "Capture a screenshot. Set annotate=true to overlay ref labels from browser_a11y_snapshot on interactive elements.",
    {
      selector: z.string().optional().describe("CSS selector to screenshot a specific element"),
      fullPage: z.boolean().optional().describe("Capture the full scrollable page (default: false)"),
      savePath: z.string().optional().describe("File path to save the screenshot (must be within SCREENSHOT_DIR)"),
      annotate: z.boolean().optional().describe("Overlay ref labels from browser_a11y_snapshot on interactive elements"),
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
    "Capture the accessibility tree as a compact text tree with ref IDs (e.g. [e1], [e2]). Use these refs with browser_click, browser_type, browser_hover, and browser_scroll_to_element. Set format='json' for full JSON output.",
    {
      interestingOnly: z.boolean().optional().describe("Only include interactive/informative nodes (default: true)"),
      format: z.enum(["tree", "json"]).optional().describe("Output format: compact 'tree' (default) or full 'json'"),
      maxDepth: z.number().int().min(0).max(100).optional().describe("Maximum tree depth to render (omit for unlimited)"),
    },
    async ({ interestingOnly, format, maxDepth }) => {
      try {
        const page = await ensurePage();
        clearRefs();
        clearRefRoles();
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
      selector: z.string().describe("CSS selector of the element to extract text from"),
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
