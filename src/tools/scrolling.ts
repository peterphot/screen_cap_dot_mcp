/**
 * Scrolling tools for the MCP server.
 *
 * Registers 2 browser scrolling tools on the McpServer instance:
 * - browser_scroll: Scroll page or container in a direction
 * - browser_scroll_to_element: Scroll element into view (by CSS selector or ref)
 *
 * All handlers wrap their logic in try/catch and return error messages
 * as text content (never throw).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ensurePage, ensureCDPSession } from "../browser.js";
import { validateSelectorOrRef } from "../util/validate-selector-or-ref.js";
import logger from "../util/logger.js";

/**
 * Register all scrolling tools on the given MCP server.
 */
export function registerScrollingTools(server: McpServer): void {
  // ── browser_scroll ──────────────────────────────────────────────────

  server.tool(
    "browser_scroll",
    "Scroll the page or a specific container element in a given direction by a pixel amount.",
    {
      direction: z.enum(["up", "down", "left", "right"]).describe("Scroll direction"),
      amount: z.number().optional().describe("Pixels to scroll (default: 500)"),
      selector: z.string().optional().describe("CSS selector of a scrollable container (omit to scroll the page)"),
    },
    async ({ direction, amount, selector }) => {
      try {
        const page = await ensurePage();
        const scrollAmount = amount ?? 500;

        const result = await page.evaluate(
          (dir: string, amt: number, sel?: string) => {
            let target: Element | Window = window;

            if (sel) {
              const el = document.querySelector(sel);
              if (!el) {
                throw new Error(`Element not found: ${sel}`);
              }
              target = el;
            }

            // Determine scroll deltas
            let deltaX = 0;
            let deltaY = 0;

            switch (dir) {
              case "down":
                deltaY = amt;
                break;
              case "up":
                deltaY = -amt;
                break;
              case "right":
                deltaX = amt;
                break;
              case "left":
                deltaX = -amt;
                break;
            }

            // Perform scroll
            if (target instanceof Window) {
              target.scrollBy(deltaX, deltaY);
              return {
                scrollTop: document.documentElement.scrollTop || document.body.scrollTop,
                scrollLeft: document.documentElement.scrollLeft || document.body.scrollLeft,
                scrollHeight: document.documentElement.scrollHeight,
                scrollWidth: document.documentElement.scrollWidth,
                clientHeight: document.documentElement.clientHeight,
                clientWidth: document.documentElement.clientWidth,
              };
            } else {
              target.scrollBy(deltaX, deltaY);
              return {
                scrollTop: target.scrollTop,
                scrollLeft: target.scrollLeft,
                scrollHeight: target.scrollHeight,
                scrollWidth: target.scrollWidth,
                clientHeight: target.clientHeight,
                clientWidth: target.clientWidth,
              };
            }
          },
          direction,
          scrollAmount,
          selector,
        );

        logger.info(
          `Scrolled ${direction} by ${scrollAmount}px${selector ? ` in ${selector}` : ""}`,
        );

        return {
          content: [
            {
              type: "text" as const,
              text: `Scrolled ${direction} by ${scrollAmount}px. Position: ${JSON.stringify(result)}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error scrolling: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── browser_scroll_to_element ───────────────────────────────────────

  server.tool(
    "browser_scroll_to_element",
    "Scroll a specific element into view. Accepts either a CSS selector or a ref from browser_a11y_snapshot.",
    {
      selector: z.string().optional().describe("CSS selector of the element to scroll into view"),
      ref: z.string().optional().describe("Ref from browser_a11y_snapshot (e.g. 'e1')"),
    },
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
          try {
            const cdp = await ensureCDPSession();
            await cdp.send("DOM.scrollIntoViewIfNeeded", { backendNodeId: resolved.backendNodeId });
          } catch (cdpErr) {
            const msg = (cdpErr as Error).message;
            if (msg.includes("Could not find node")) {
              return {
                content: [{ type: "text" as const, text: `Error: Stale ref "${ref}". Take a new browser_a11y_snapshot to get fresh refs.` }],
                isError: true,
              };
            }
            return {
              content: [{ type: "text" as const, text: `Error scrolling to ref "${ref}": ${msg}` }],
              isError: true,
            };
          }

          logger.info(`Scrolled element into view via ref: ${ref}`);

          return {
            content: [
              {
                type: "text" as const,
                text: `Scrolled ref "${ref}" into view`,
              },
            ],
          };
        }

        // Selector path: existing behavior
        const page = await ensurePage();

        const found = await page.evaluate((sel: string) => {
          return new Promise<boolean>((resolve) => {
            const element = document.querySelector(sel);
            if (!element) {
              resolve(false);
              return;
            }
            element.scrollIntoView({ behavior: "smooth", block: "center" });
            // Wait 350ms for smooth scroll to settle (typically 300-500ms)
            setTimeout(() => resolve(true), 350);
          });
        }, selector!);

        if (!found) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: element not found for selector "${selector}"`,
              },
            ],
            isError: true,
          };
        }

        logger.info(`Scrolled element into view: ${selector}`);

        return {
          content: [
            {
              type: "text" as const,
              text: `Scrolled element "${selector}" into view (smooth, centered)`,
            },
          ],
        };
      } catch (err) {
        const target = ref ? `ref ${ref}` : selector;
        return {
          content: [
            {
              type: "text" as const,
              text: `Error scrolling to element "${target}": ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
