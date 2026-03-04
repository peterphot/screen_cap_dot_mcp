/**
 * Shared smart wait logic for multi-strategy page readiness detection.
 *
 * smartWait() checks for common loading indicators (progress bars, skeletons,
 * spinners) and waits for them to disappear, then waits for network idle.
 *
 * Uses ARIA-based and generic CSS selectors that work across any web
 * application, with a short-circuit fast path when no indicators are present.
 */

import type { Page } from "puppeteer-core";
import { TimeoutError } from "puppeteer-core";
import logger from "./logger.js";

/** Combined ARIA + generic loading indicator selector. */
const LOADING_SELECTOR = [
  '[role="progressbar"]',
  '[aria-busy="true"]',
  '[aria-label*="loading" i]',
  '[aria-label*="spinner" i]',
  '[class*="skeleton" i]',
  '[class*="loading" i]',
  '[class*="spinner" i]',
].join(", ");

/** Default wait timeout in milliseconds. */
const DEFAULT_TIMEOUT = 30000;

/** Per-selector probe timeout in milliseconds (short, since indicators may not exist). */
const SELECTOR_PROBE_TIMEOUT = 500;

/** Network idle time in milliseconds. */
const NETWORK_IDLE_TIME = 500;

export interface SmartWaitResult {
  elapsedMs: number;
}

/**
 * Multi-strategy intelligent wait that checks loading indicators and network idle.
 *
 * 1. Quick probe: checks if any loading indicator is present on the page
 * 2. If found, waits for indicators to disappear (short timeout)
 * 3. Waits for network idle (no requests for 500ms)
 *
 * When no loading indicator is detected, the function short-circuits directly
 * to network idle, avoiding unnecessary selector waits.
 *
 * Timeout errors on selector waits are swallowed (indicator may have
 * disappeared during the wait). Non-timeout errors are propagated.
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

  // Phase 1: Quick probe — check if any loading indicator exists
  const hasLoading = await page.$(LOADING_SELECTOR);

  if (hasLoading) {
    // Loading indicator found — wait for it to disappear
    logger.info("Loading indicator detected, waiting for disappearance...");
    const selectorTimeout = Math.min(SELECTOR_PROBE_TIMEOUT, effectiveTimeout);
    try {
      await page.waitForSelector(LOADING_SELECTOR, {
        hidden: true,
        timeout: selectorTimeout,
      });
    } catch (err) {
      if (err instanceof TimeoutError) {
        // Swallow timeout errors — indicator may still be present but we move on
        logger.debug(`Loading indicator wait timed out: ${(err as Error).message}`);
      } else {
        throw err;
      }
    }
  } else {
    logger.debug("No loading indicators found, skipping to network idle");
  }

  // Phase 2: Wait for network idle
  const elapsed = Date.now() - startTime;
  const remainingTimeout = Math.max(0, effectiveTimeout - elapsed);
  logger.info("Waiting for network idle...");
  await page.waitForNetworkIdle({
    idleTime: NETWORK_IDLE_TIME,
    timeout: remainingTimeout,
  });

  const elapsedMs = Date.now() - startTime;
  logger.info(`Smart wait completed in ${elapsedMs}ms`);

  return { elapsedMs };
}
