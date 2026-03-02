/**
 * Shared smart wait logic for multi-strategy page readiness detection.
 *
 * smartWait() checks for common loading indicators (progress bars, skeletons,
 * spinners) and waits for them to disappear, then waits for network idle.
 *
 * Designed to work across popular UI frameworks (MUI, Ant Design, Chakra, etc.)
 * by targeting common CSS patterns for loading states.
 */

import type { Page } from "puppeteer-core";
import logger from "./logger.js";

/** Loading indicator selectors for common UI frameworks. */
const LOADING_SELECTORS = [
  '[role="progressbar"]',
  ".MuiLinearProgress-root, .MuiCircularProgress-root",
  '[class*="skeleton"], [class*="Skeleton"]',
  '[class*="loading"], [class*="Loading"]',
  '[class*="spinner"], [class*="Spinner"]',
  ".ant-spin, .ant-skeleton",
];

/** Default wait timeout in milliseconds. */
const DEFAULT_TIMEOUT = 30000;

/** Network idle time in milliseconds. */
const NETWORK_IDLE_TIME = 500;

export interface SmartWaitResult {
  elapsedMs: number;
}

/**
 * Multi-strategy intelligent wait that checks loading indicators and network idle.
 *
 * 1. Checks for common loading indicators and waits for them to disappear
 * 2. Waits for network idle (no requests for 500ms)
 *
 * Timeout errors on individual selectors are swallowed (indicators may not
 * exist on the page). Non-timeout errors are propagated.
 *
 * @param page - Puppeteer Page instance
 * @param timeout - Overall timeout in ms (default: 30000)
 * @returns Object with elapsed time in milliseconds
 */
export async function smartWait(
  page: Page,
  timeout?: number,
): Promise<SmartWaitResult> {
  const effectiveTimeout = timeout ?? DEFAULT_TIMEOUT;
  const startTime = Date.now();

  logger.info(`Smart wait started (timeout: ${effectiveTimeout}ms)`);

  // Phase 1: Wait for loading indicators to disappear
  for (const selector of LOADING_SELECTORS) {
    try {
      await page.waitForSelector(selector, {
        hidden: true,
        timeout: effectiveTimeout,
      });
    } catch (err) {
      // Swallow timeout errors — the selector may not exist on the page
      logger.debug(`Loading indicator check skipped for "${selector}": ${(err as Error).message}`);
    }
  }

  // Phase 2: Wait for network idle
  logger.info("Waiting for network idle...");
  await page.waitForNetworkIdle({
    idleTime: NETWORK_IDLE_TIME,
    timeout: effectiveTimeout,
  });

  const elapsedMs = Date.now() - startTime;
  logger.info(`Smart wait completed in ${elapsedMs}ms`);

  return { elapsedMs };
}
