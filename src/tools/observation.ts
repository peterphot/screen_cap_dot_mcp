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
import { writeFile, mkdir, realpath } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { ensurePage } from "../browser.js";
import logger from "../util/logger.js";

/**
 * Read the allowed screenshot save directory.
 * Read lazily so env var changes and test overrides take effect.
 * Defaults to /tmp/screen-cap-screenshots.
 */
function getScreenshotDir(): string {
  return resolve(process.env.SCREENSHOT_DIR ?? "/tmp/screen-cap-screenshots");
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

        // Validate savePath is within the allowed directory (prefix check + symlink resolution)
        let resolvedSavePath: string | undefined;
        if (savePath) {
          const screenshotDir = getScreenshotDir();
          resolvedSavePath = resolve(savePath);
          if (!resolvedSavePath.startsWith(screenshotDir + "/")) {
            return {
              content: [{ type: "text" as const, text: `Error: savePath must be within ${screenshotDir}` }],
              isError: true,
            };
          }
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

          if (resolvedSavePath) {
            const buffer = (await element.screenshot()) as Buffer;
            await mkdir(dirname(resolvedSavePath), { recursive: true });
            // Re-check after mkdir in case of symlinks in the created path
            const realDir = await realpath(dirname(resolvedSavePath));
            const realScreenshotDir = await realpath(getScreenshotDir());
            if (!realDir.startsWith(realScreenshotDir + "/") && realDir !== realScreenshotDir) {
              return {
                content: [{ type: "text" as const, text: `Error: savePath must be within ${getScreenshotDir()} (symlink detected)` }],
                isError: true,
              };
            }
            await writeFile(resolve(realDir, basename(resolvedSavePath)), buffer);
            logger.info(`Screenshot saved to ${resolvedSavePath}`);
            base64 = buffer.toString("base64");
          } else {
            base64 = (await element.screenshot({ encoding: "base64" })) as string;
          }
        } else {
          const opts = { fullPage: fullPage ?? false };

          if (resolvedSavePath) {
            const buffer = (await page.screenshot(opts)) as Buffer;
            await mkdir(dirname(resolvedSavePath), { recursive: true });
            // Re-check after mkdir in case of symlinks in the created path
            const realDir = await realpath(dirname(resolvedSavePath));
            const realScreenshotDir = await realpath(getScreenshotDir());
            if (!realDir.startsWith(realScreenshotDir + "/") && realDir !== realScreenshotDir) {
              return {
                content: [{ type: "text" as const, text: `Error: savePath must be within ${getScreenshotDir()} (symlink detected)` }],
                isError: true,
              };
            }
            await writeFile(resolve(realDir, basename(resolvedSavePath)), buffer);
            logger.info(`Screenshot saved to ${resolvedSavePath}`);
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

        const raw = JSON.stringify(snapshot);
        const text = raw.length > MAX_A11Y_CHARS
          ? raw.slice(0, MAX_A11Y_CHARS) + `\n... (truncated, total ${raw.length} chars)`
          : raw;

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
