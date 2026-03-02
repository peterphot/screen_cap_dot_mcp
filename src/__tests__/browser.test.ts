/**
 * Unit tests for BrowserManager (src/browser.ts)
 *
 * All puppeteer-core interactions are mocked. These tests verify:
 * - Singleton connection management (connect once, reuse)
 * - Page lifecycle (get current, list all, switch tabs)
 * - CDP session management
 * - Disconnect/reconnect behavior
 * - Error handling for edge cases
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Setup ──────────────────────────────────────────────────────────
//
// We mock puppeteer-core at the module level. Each test gets fresh mock
// instances via beforeEach. The mock structure mirrors puppeteer-core's
// actual API surface.

interface MockCDPSession {
  detach: ReturnType<typeof vi.fn>;
}

interface MockPage {
  url: ReturnType<typeof vi.fn>;
  title: ReturnType<typeof vi.fn>;
  setDefaultNavigationTimeout: ReturnType<typeof vi.fn>;
  bringToFront: ReturnType<typeof vi.fn>;
  createCDPSession: ReturnType<typeof vi.fn>;
}

interface MockBrowser {
  pages: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

let mockBrowser: MockBrowser;
let mockPage: MockPage;
let mockPage2: MockPage;
let mockCDPSession: MockCDPSession;
let disconnectHandler: (() => void) | null = null;

function createMockPage(url: string, title: string): MockPage {
  return {
    url: vi.fn().mockReturnValue(url),
    title: vi.fn().mockResolvedValue(title),
    setDefaultNavigationTimeout: vi.fn(),
    bringToFront: vi.fn().mockResolvedValue(undefined),
    createCDPSession: vi.fn(),
  };
}

vi.mock("puppeteer-core", () => {
  return {
    default: {
      connect: vi.fn(),
    },
  };
});

import puppeteer from "puppeteer-core";

// We need to dynamically import the module under test so the mock is in place.
// Using a helper to reset module state between tests.
async function importBrowserModule() {
  // Reset modules to get fresh singleton state
  vi.resetModules();
  // Re-apply the mock after module reset
  vi.doMock("puppeteer-core", () => ({
    default: {
      connect: vi.fn().mockResolvedValue(mockBrowser),
    },
  }));
  const mod = await import("../browser.js");
  return mod;
}

beforeEach(() => {
  vi.restoreAllMocks();
  disconnectHandler = null;

  mockCDPSession = {
    detach: vi.fn().mockResolvedValue(undefined),
  };

  mockPage = createMockPage("https://example.com", "Example");
  mockPage.createCDPSession.mockResolvedValue(mockCDPSession);

  mockPage2 = createMockPage("https://google.com", "Google");
  mockPage2.createCDPSession.mockResolvedValue(mockCDPSession);

  mockBrowser = {
    pages: vi.fn().mockResolvedValue([mockPage, mockPage2]),
    on: vi.fn().mockImplementation((event: string, handler: () => void) => {
      if (event === "disconnected") {
        disconnectHandler = handler;
      }
    }),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
});

// ── ensureBrowser() ─────────────────────────────────────────────────────

describe("ensureBrowser", () => {
  it("connects to Chrome at http://127.0.0.1:9222 with correct options", async () => {
    const browser = await importBrowserModule();
    const result = await browser.ensureBrowser();

    const { connect } = (await import("puppeteer-core")).default;
    expect(connect).toHaveBeenCalledWith({
      browserURL: "http://127.0.0.1:9222",
      defaultViewport: null,
    });
    expect(result).toBe(mockBrowser);
  });

  it("returns cached browser on subsequent calls (singleton)", async () => {
    const browser = await importBrowserModule();
    const first = await browser.ensureBrowser();
    const second = await browser.ensureBrowser();

    const { connect } = (await import("puppeteer-core")).default;
    expect(connect).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it("registers a disconnect handler", async () => {
    const browser = await importBrowserModule();
    await browser.ensureBrowser();

    expect(mockBrowser.on).toHaveBeenCalledWith(
      "disconnected",
      expect.any(Function),
    );
  });

  it("reconnects after disconnect event fires", async () => {
    const browser = await importBrowserModule();
    await browser.ensureBrowser();

    // Simulate disconnect
    expect(disconnectHandler).not.toBeNull();
    disconnectHandler!();

    // Next call should reconnect
    const result = await browser.ensureBrowser();
    const { connect } = (await import("puppeteer-core")).default;
    expect(connect).toHaveBeenCalledTimes(2);
    expect(result).toBe(mockBrowser);
  });
});

// ── ensurePage() ────────────────────────────────────────────────────────

describe("ensurePage", () => {
  it("returns first page from browser.pages() on initial call", async () => {
    const browser = await importBrowserModule();
    const page = await browser.ensurePage();

    expect(mockBrowser.pages).toHaveBeenCalled();
    expect(page).toBe(mockPage);
  });

  it("sets default navigation timeout to 60 seconds", async () => {
    const browser = await importBrowserModule();
    await browser.ensurePage();

    expect(mockPage.setDefaultNavigationTimeout).toHaveBeenCalledWith(60_000);
  });

  it("returns cached page on subsequent calls", async () => {
    const browser = await importBrowserModule();
    const first = await browser.ensurePage();
    const second = await browser.ensurePage();

    expect(first).toBe(second);
    // pages() called once for first call, not again for second
    expect(mockBrowser.pages).toHaveBeenCalledTimes(1);
  });

  it("calls ensureBrowser() if browser is not connected", async () => {
    const browser = await importBrowserModule();
    // Call ensurePage directly without calling ensureBrowser first
    const page = await browser.ensurePage();

    const { connect } = (await import("puppeteer-core")).default;
    expect(connect).toHaveBeenCalledTimes(1);
    expect(page).toBe(mockPage);
  });

  it("throws if no pages are open", async () => {
    mockBrowser.pages.mockResolvedValue([]);
    const browser = await importBrowserModule();

    await expect(browser.ensurePage()).rejects.toThrow();
  });
});

// ── ensureCDPSession() ──────────────────────────────────────────────────

describe("ensureCDPSession", () => {
  it("creates a CDP session from the current page", async () => {
    const browser = await importBrowserModule();
    const session = await browser.ensureCDPSession();

    expect(mockPage.createCDPSession).toHaveBeenCalled();
    expect(session).toBe(mockCDPSession);
  });

  it("returns cached session on subsequent calls", async () => {
    const browser = await importBrowserModule();
    const first = await browser.ensureCDPSession();
    const second = await browser.ensureCDPSession();

    expect(first).toBe(second);
    expect(mockPage.createCDPSession).toHaveBeenCalledTimes(1);
  });

  it("calls ensurePage() if no page is available", async () => {
    const browser = await importBrowserModule();
    // Call ensureCDPSession directly
    const session = await browser.ensureCDPSession();

    // Should have connected browser and gotten page
    const { connect } = (await import("puppeteer-core")).default;
    expect(connect).toHaveBeenCalledTimes(1);
    expect(mockBrowser.pages).toHaveBeenCalled();
    expect(session).toBe(mockCDPSession);
  });
});

// ── listAllPages() ──────────────────────────────────────────────────────

describe("listAllPages", () => {
  it("returns all open tabs with index, url, and title", async () => {
    const browser = await importBrowserModule();
    await browser.ensureBrowser();
    const pages = await browser.listAllPages();

    expect(pages).toEqual([
      { index: 0, url: "https://example.com", title: "Example" },
      { index: 1, url: "https://google.com", title: "Google" },
    ]);
  });

  it("calls ensureBrowser() if not connected", async () => {
    const browser = await importBrowserModule();
    const pages = await browser.listAllPages();

    const { connect } = (await import("puppeteer-core")).default;
    expect(connect).toHaveBeenCalledTimes(1);
    expect(pages).toHaveLength(2);
  });
});

// ── switchToPage() ──────────────────────────────────────────────────────

describe("switchToPage", () => {
  it("switches to the correct tab by index", async () => {
    const browser = await importBrowserModule();
    await browser.ensureBrowser();
    const page = await browser.switchToPage(1);

    expect(page).toBe(mockPage2);
  });

  it("brings the switched page to front", async () => {
    const browser = await importBrowserModule();
    await browser.ensureBrowser();
    await browser.switchToPage(1);

    expect(mockPage2.bringToFront).toHaveBeenCalled();
  });

  it("updates the module-level page reference", async () => {
    const browser = await importBrowserModule();
    await browser.ensurePage(); // sets to mockPage (index 0)
    await browser.switchToPage(1); // switch to mockPage2

    // getPage should now return the switched page
    const current = browser.getPage();
    expect(current).toBe(mockPage2);
  });

  it("resets cdpSession when switching pages", async () => {
    const browser = await importBrowserModule();
    await browser.ensureCDPSession(); // creates session on mockPage

    await browser.switchToPage(1); // switch pages

    // Next CDP session call should create a new session
    const session = await browser.ensureCDPSession();
    expect(mockPage2.createCDPSession).toHaveBeenCalled();
  });

  it("throws on invalid index (negative)", async () => {
    const browser = await importBrowserModule();
    await browser.ensureBrowser();

    await expect(browser.switchToPage(-1)).rejects.toThrow();
  });

  it("throws on invalid index (out of range)", async () => {
    const browser = await importBrowserModule();
    await browser.ensureBrowser();

    await expect(browser.switchToPage(99)).rejects.toThrow();
  });
});

// ── getPage() ───────────────────────────────────────────────────────────

describe("getPage", () => {
  it("returns the current page when connected", async () => {
    const browser = await importBrowserModule();
    await browser.ensurePage();

    const page = browser.getPage();
    expect(page).toBe(mockPage);
  });

  it("throws when not connected", async () => {
    const browser = await importBrowserModule();

    expect(() => browser.getPage()).toThrow();
  });
});

// ── getBrowser() ────────────────────────────────────────────────────────

describe("getBrowser", () => {
  it("returns the current browser when connected", async () => {
    const browser = await importBrowserModule();
    await browser.ensureBrowser();

    const result = browser.getBrowser();
    expect(result).toBe(mockBrowser);
  });

  it("throws when not connected", async () => {
    const browser = await importBrowserModule();

    expect(() => browser.getBrowser()).toThrow();
  });
});

// ── Disconnect handling ─────────────────────────────────────────────────

describe("disconnect handling", () => {
  it("nulls out all refs when disconnect fires", async () => {
    const browser = await importBrowserModule();
    await browser.ensureCDPSession(); // ensures browser + page + cdpSession are set

    // Fire disconnect
    expect(disconnectHandler).not.toBeNull();
    disconnectHandler!();

    // getPage and getBrowser should throw (refs are null)
    expect(() => browser.getPage()).toThrow();
    expect(() => browser.getBrowser()).toThrow();
  });

  it("allows reconnection after disconnect", async () => {
    const browser = await importBrowserModule();
    await browser.ensureBrowser();

    // Fire disconnect
    disconnectHandler!();

    // Should be able to reconnect
    const result = await browser.ensureBrowser();
    expect(result).toBe(mockBrowser);
  });
});
