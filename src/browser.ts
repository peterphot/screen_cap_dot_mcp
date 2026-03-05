/**
 * BrowserManager - Module-level singleton for persistent Chrome CDP connection.
 *
 * Maintains browser, page, and CDP session references across all tool calls.
 * Uses puppeteer-core to connect to an already-running Chrome instance via
 * the Chrome DevTools Protocol (CDP).
 *
 * Key design decisions:
 * - Module-level singleton (not a class) -- state persists naturally in ESM
 * - `defaultViewport: null` preserves real Chrome window size
 * - `browserURL` (HTTP) connection is simpler than websocket for CDP
 * - 60-second default navigation timeout for data-heavy SPAs
 * - Lazy reconnection: disconnect nulls refs, next ensure* call reconnects
 * - Promise guards on ensure* functions prevent duplicate connections under concurrency
 */

import puppeteer, { type Browser, type Page, type CDPSession } from "puppeteer-core";
import logger from "./util/logger.js";
import { cleanupRecordingState } from "./recording-state.js";
import { clearRefs } from "./ref-store.js";

// ── Types ───────────────────────────────────────────────────────────────

/** Information about an open browser tab. */
export interface PageInfo {
  index: number;
  url: string;
  title: string;
}

// ── Module-level singleton state ────────────────────────────────────────

let browser: Browser | null = null;
let page: Page | null = null;
let cdpSession: CDPSession | null = null;

// Promise guards to prevent duplicate connections under concurrent calls
let browserPromise: Promise<Browser> | null = null;
let pagePromise: Promise<Page> | null = null;
let cdpSessionPromise: Promise<CDPSession> | null = null;

/** Default navigation timeout in milliseconds (60 seconds). */
export const DEFAULT_TIMEOUT_MS = 60_000;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

/**
 * Read and validate the CDP endpoint URL.
 * Read lazily so env var changes and test overrides take effect.
 * Restricts to loopback addresses by default to prevent SSRF.
 */
function getBrowserUrl(): string {
  const raw = process.env.CHROME_CDP_URL ?? "http://127.0.0.1:9222";
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Invalid CHROME_CDP_URL: "${raw}" is not a valid URL.`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(
      `Invalid CHROME_CDP_URL scheme "${parsed.protocol}". Only http: and https: are allowed.`,
    );
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `CHROME_CDP_URL host "${parsed.hostname}" is not a loopback address. ` +
      `Only ${[...LOOPBACK_HOSTS].join(", ")} are allowed by default.`,
    );
  }
  return raw;
}

// ── Helpers ─────────────────────────────────────────────────────────────

/** Check whether a cached Page reference is still usable. */
function isPageAlive(p: Page): boolean {
  if (p.isClosed()) return false;
  try {
    p.url();
    return true;
  } catch {
    return false;
  }
}

// ── Connection management ───────────────────────────────────────────────

/**
 * Connect to Chrome via CDP, or return the existing connection.
 *
 * Uses a promise guard so concurrent callers share a single connection attempt.
 * Throws a descriptive error if Chrome is unreachable.
 */
export async function ensureBrowser(): Promise<Browser> {
  if (browser) return browser;
  if (browserPromise) return browserPromise;

  browserPromise = (async () => {
    const browserUrl = getBrowserUrl();
    logger.info(`Connecting to Chrome at ${browserUrl}`);

    let b: Browser;
    try {
      b = await puppeteer.connect({
        browserURL: browserUrl,
        defaultViewport: null,
      });
    } catch (err) {
      throw new Error(
        `Failed to connect to Chrome at ${browserUrl}. ` +
        `Ensure Chrome is running with --remote-debugging-port=9222.`,
        { cause: err },
      );
    }

    b.on("disconnected", () => {
      logger.warn("Browser disconnected — refs nulled, will reconnect on next call");
      cleanupRecordingState();
      clearRefs();
      browser = null;
      page = null;
      cdpSession = null;
      browserPromise = null;
      pagePromise = null;
      cdpSessionPromise = null;
    });

    browser = b;
    logger.info("Connected to Chrome successfully");
    return b;
  })();

  try {
    return await browserPromise;
  } catch (err) {
    browserPromise = null;
    throw err;
  }
}

/**
 * Get the current page, or find the first open tab.
 *
 * Connects to Chrome first if not already connected.
 * Sets a 60-second default navigation timeout on the page.
 * Throws if Chrome has no open tabs.
 */
export async function ensurePage(): Promise<Page> {
  if (page) {
    // Validate the cached page is still alive
    let isStale = false;

    if (!isPageAlive(page)) {
      isStale = true;
      if (page.isClosed()) {
        logger.warn("Cached page was closed — re-acquiring...");
      } else {
        logger.warn("Cached page is detached — re-acquiring...");
      }
    }

    if (isStale) {
      cleanupRecordingState();
      page = null;
      pagePromise = null;
      cdpSession = null;
      cdpSessionPromise = null;
      clearRefs();
    } else {
      return page;
    }
  }
  if (pagePromise) return pagePromise;

  pagePromise = (async () => {
    const b = await ensureBrowser();
    const pages = await b.pages();

    // Guard: browser may have disconnected during the await above
    if (!browser) {
      throw new Error("Browser disconnected during page initialization.");
    }

    if (pages.length === 0) {
      throw new Error("No open tabs found in Chrome. Open at least one tab and try again.");
    }

    page = pages[0];
    page.setDefaultNavigationTimeout(DEFAULT_TIMEOUT_MS);

    logger.info(`Active page: ${page.url()}`);
    return page;
  })();

  try {
    return await pagePromise;
  } catch (err) {
    pagePromise = null;
    throw err;
  }
}

/**
 * Get or create a CDP session for low-level protocol access.
 *
 * Ensures a page is available first, then creates a CDP session on it.
 * Returns the cached session on subsequent calls.
 */
export async function ensureCDPSession(): Promise<CDPSession> {
  if (cdpSession) return cdpSession;
  if (cdpSessionPromise) return cdpSessionPromise;

  cdpSessionPromise = (async () => {
    const p = await ensurePage();

    // Guard: browser may have disconnected during the await above
    if (!browser) {
      throw new Error("Browser disconnected during CDP session creation.");
    }

    const session = await p.createCDPSession();

    // Guard: browser may have disconnected during createCDPSession
    if (!browser) {
      throw new Error("Browser disconnected during CDP session creation.");
    }

    cdpSession = session;
    logger.info("CDP session created");
    return cdpSession;
  })();

  try {
    return await cdpSessionPromise;
  } catch (err) {
    cdpSessionPromise = null;
    throw err;
  }
}

// ── Tab management ──────────────────────────────────────────────────────

/**
 * List all open tabs with their URL, title, and index.
 *
 * Connects to Chrome if not already connected.
 */
export async function listAllPages(): Promise<PageInfo[]> {
  const b = await ensureBrowser();
  const pages = await b.pages();

  return Promise.all(
    pages.map(async (p, i) => ({
      index: i,
      url: p.url(),
      title: await p.title(),
    })),
  );
}

/**
 * Switch the active page to a different tab by index.
 *
 * Brings the target page to front and updates the module-level page reference.
 * Resets the CDP session since the page changed.
 * Throws if the index is out of range.
 */
export async function switchToPage(index: number): Promise<Page> {
  const b = await ensureBrowser();
  const pages = await b.pages();

  if (index < 0 || index >= pages.length) {
    throw new Error(
      `Tab index ${index} is out of range. Open tabs: 0-${pages.length - 1} (${pages.length} total).`,
    );
  }

  const target = pages[index];
  await target.bringToFront();

  // Update singleton refs
  page = target;
  page.setDefaultNavigationTimeout(DEFAULT_TIMEOUT_MS);
  cdpSession = null; // Reset — new page needs a new CDP session
  cdpSessionPromise = null;
  clearRefs(); // Refs are tied to a specific page's DOM and become invalid on tab switch

  logger.info(`Switched to tab ${index}: ${target.url()}`);
  return target;
}

// ── Direct accessors (no lazy connect) ──────────────────────────────────

/**
 * Get the current page reference.
 * Throws if not connected (does NOT lazily connect).
 */
export function getPage(): Page {
  if (!page) {
    throw new Error("Not connected to a page. Call ensurePage() first.");
  }
  return page;
}

/**
 * Get the current browser reference.
 * Throws if not connected (does NOT lazily connect).
 */
export function getBrowser(): Browser {
  if (!browser) {
    throw new Error("Not connected to Chrome. Call ensureBrowser() first.");
  }
  return browser;
}

/**
 * Reset all singleton state. For testing only.
 * @internal
 */
export function _resetForTesting(): void {
  browser = null;
  page = null;
  cdpSession = null;
  browserPromise = null;
  pagePromise = null;
  cdpSessionPromise = null;
  clearRefs();
}
