/**
 * Waiting tools for the MCP server.
 *
 * Registers 3 browser waiting tools on the McpServer instance:
 * - browser_wait_for_selector: Wait for element visible/hidden
 * - browser_wait_for_network_idle: Wait for network to settle
 * - browser_smart_wait: Multi-strategy intelligent wait
 *
 * All handlers wrap their logic in try/catch and return error messages
 * as text content (never throw).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ensurePage } from "../browser.js";
import { smartWait } from "../util/wait-strategies.js";
import logger from "../util/logger.js";

/**
 * Register all waiting tools on the given MCP server.
 */
export function registerWaitingTools(server: McpServer): void {
  // ── browser_wait_for_selector ───────────────────────────────────────

  server.tool(
    "browser_wait_for_selector",
    "Wait for an element to appear (visible) or disappear (hidden) on the page by CSS selector.",
    {
      selector: z.string(),
      visible: z.boolean().optional(),
      hidden: z.boolean().optional(),
      timeout: z.number().optional(),
    },
    async ({ selector, visible, hidden, timeout }) => {
      try {
        const page = await ensurePage();
        const effectiveTimeout = timeout ?? 30000;

        const options: { visible?: boolean; hidden?: boolean; timeout: number } = {
          timeout: effectiveTimeout,
        };

        if (visible !== undefined) {
          options.visible = visible;
        }
        if (hidden !== undefined) {
          options.hidden = hidden;
        }

        await page.waitForSelector(selector, options);

        const state = hidden ? "hidden" : visible ? "visible" : "present";
        return {
          content: [
            {
              type: "text" as const,
              text: `Selector "${selector}" is now ${state} (waited with timeout ${effectiveTimeout}ms)`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error waiting for selector "${selector}": ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── browser_wait_for_network_idle ───────────────────────────────────

  server.tool(
    "browser_wait_for_network_idle",
    "Wait for network activity to settle (no in-flight requests for the specified idle time).",
    {
      timeout: z.number().optional(),
      idleTime: z.number().optional(),
    },
    async ({ timeout, idleTime }) => {
      try {
        const page = await ensurePage();
        const effectiveTimeout = timeout ?? 30000;
        const effectiveIdleTime = idleTime || 500;

        await page.waitForNetworkIdle({
          idleTime: effectiveIdleTime,
          timeout: effectiveTimeout,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `Network is idle (no requests for ${effectiveIdleTime}ms, timeout ${effectiveTimeout}ms)`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error waiting for network idle: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── browser_smart_wait ──────────────────────────────────────────────

  server.tool(
    "browser_smart_wait",
    "Multi-strategy intelligent wait: checks for loading indicators (progress bars, skeletons, spinners) and waits for network idle.",
    {
      timeout: z.number().optional(),
    },
    async ({ timeout }) => {
      try {
        const page = await ensurePage();
        const result = await smartWait(page, timeout);

        logger.info(`Smart wait tool completed in ${result.elapsedMs}ms`);

        return {
          content: [
            {
              type: "text" as const,
              text: `Smart wait completed in ${result.elapsedMs}ms. Checked loading indicators and waited for network idle.`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error during smart wait: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
