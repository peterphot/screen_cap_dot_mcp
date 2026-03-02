/**
 * Scrolling tools for the MCP server.
 *
 * Registers 2 browser scrolling tools on the McpServer instance:
 * - browser_scroll: Scroll page or container in a direction
 * - browser_scroll_to_element: Scroll element into view
 *
 * All handlers wrap their logic in try/catch and return error messages
 * as text content (never throw).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ensurePage } from "../browser.js";
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
      direction: z.enum(["up", "down", "left", "right"]),
      amount: z.number().optional(),
      selector: z.string().optional(),
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
    "Scroll a specific element into view using smooth scrolling, centering it in the viewport.",
    {
      selector: z.string(),
    },
    async ({ selector }) => {
      try {
        const page = await ensurePage();

        const found = await page.evaluate((sel: string) => {
          return new Promise<boolean>((resolve) => {
            const element = document.querySelector(sel);
            if (!element) {
              resolve(false);
              return;
            }
            element.scrollIntoView({ behavior: "smooth", block: "center" });
            // Wait for smooth scroll to settle before resolving
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                resolve(true);
              });
            });
          });
        }, selector);

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
        return {
          content: [
            {
              type: "text" as const,
              text: `Error scrolling to element "${selector}": ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
