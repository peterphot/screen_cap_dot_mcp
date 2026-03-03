/**
 * Shared browser action executors.
 *
 * Provides unified click, type, and hover implementations that work
 * with both CSS selectors and ref-based backendNodeIds. Used by both
 * the MCP tool handlers and the FlowRunner to avoid logic duplication.
 */

import type { Page } from "puppeteer-core";
import { ensurePage } from "../browser.js";
import { validateSelectorOrRef } from "./validate-selector-or-ref.js";
import { clickByBackendNodeId, typeByBackendNodeId, hoverByBackendNodeId } from "../cdp-helpers.js";

/**
 * Click an element by selector or ref.
 * For refs, uses CDP clickByBackendNodeId.
 * For selectors, waits for visibility then clicks via Puppeteer.
 *
 * @param page - Optional page instance (will call ensurePage() if not provided)
 */
export async function performClick(
  selector?: string,
  ref?: string,
  page?: Page,
): Promise<void> {
  const resolved = validateSelectorOrRef(selector, ref);
  if ("error" in resolved) throw new Error(resolved.error);

  if (resolved.type === "ref") {
    await clickByBackendNodeId(resolved.backendNodeId);
  } else {
    const p = page ?? await ensurePage();
    await p.waitForSelector(resolved.value, { visible: true });
    await p.click(resolved.value);
  }
}

/**
 * Type text into an element by selector or ref.
 * For refs, uses CDP typeByBackendNodeId with Ctrl+A for clear.
 * For selectors, uses triple-click to select all (clear) then Puppeteer type.
 *
 * @param page - Optional page instance (will call ensurePage() if not provided)
 */
export async function performType(
  text: string,
  selector?: string,
  ref?: string,
  clear?: boolean,
  page?: Page,
): Promise<void> {
  const resolved = validateSelectorOrRef(selector, ref);
  if ("error" in resolved) throw new Error(resolved.error);

  if (resolved.type === "ref") {
    await typeByBackendNodeId(resolved.backendNodeId, text, clear);
  } else {
    const p = page ?? await ensurePage();
    await p.waitForSelector(resolved.value, { visible: true });
    if (clear) {
      await p.click(resolved.value, { clickCount: 3 });
    } else {
      await p.click(resolved.value);
    }
    await p.type(resolved.value, text);
  }
}

/**
 * Hover over an element by selector or ref.
 * For refs, uses CDP hoverByBackendNodeId.
 * For selectors, waits for visibility then hovers via Puppeteer.
 *
 * @param page - Optional page instance (will call ensurePage() if not provided)
 */
export async function performHover(
  selector?: string,
  ref?: string,
  page?: Page,
): Promise<void> {
  const resolved = validateSelectorOrRef(selector, ref);
  if ("error" in resolved) throw new Error(resolved.error);

  if (resolved.type === "ref") {
    await hoverByBackendNodeId(resolved.backendNodeId);
  } else {
    const p = page ?? await ensurePage();
    await p.waitForSelector(resolved.value, { visible: true });
    await p.hover(resolved.value);
  }
}
