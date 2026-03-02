/**
 * Unit tests for BrowserManager (src/browser.ts)
 *
 * All puppeteer-core interactions are mocked. These tests verify:
 * - Singleton connection management (connect once, reuse)
 * - Page lifecycle (get current, list all, switch tabs)
 * - CDP session management
 * - Disconnect/reconnect behavior
 * - Promise-guard concurrency safety
 * - Error handling for edge cases
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock Setup ──────────────────────────────────────────────────────────

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

const mockConnect = vi.fn();

vi.mock("puppeteer-core", () => ({
  default: {
    connect: (...args: unknown[]) => mockConnect(...args),
  },
}));

import {
  ensureBrowser,
  ensurePage,
  ensureCDPSession,
  listAllPages,
  switchToPage,
  getPage,
  getBrowser,
  _resetForTesting,
} from "../browser.js";

const originalChromeUrl = process.env.CHROME_CDP_URL;

afterEach(() => {
  // Restore env var to avoid test pollution
  if (originalChromeUrl === undefined) {
    delete process.env.CHROME_CDP_URL;
  } else {
    process.env.CHROME_CDP_URL = originalChromeUrl;
  }
});

beforeEach(() => {
  vi.restoreAllMocks();
  _resetForTesting();
  delete process.env.CHROME_CDP_URL;
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

  mockConnect.mockResolvedValue(mockBrowser);
});

// ── ensureBrowser() ─────────────────────────────────────────────────────

describe("ensureBrowser", () => {
  it("connects to Chrome with correct options", async () => {
    const result = await ensureBrowser();

    expect(mockConnect).toHaveBeenCalledWith({
      browserURL: "http://127.0.0.1:9222",
      defaultViewport: null,
    });
    expect(result).toBe(mockBrowser);
  });

  it("returns cached browser on subsequent calls (singleton)", async () => {
    const first = await ensureBrowser();
    const second = await ensureBrowser();

    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it("registers a disconnect handler", async () => {
    await ensureBrowser();

    expect(mockBrowser.on).toHaveBeenCalledWith(
      "disconnected",
      expect.any(Function),
    );
  });

  it("reconnects after disconnect event fires", async () => {
    await ensureBrowser();

    expect(disconnectHandler).not.toBeNull();
    disconnectHandler!();

    const result = await ensureBrowser();
    expect(mockConnect).toHaveBeenCalledTimes(2);
    expect(result).toBe(mockBrowser);
  });

  it("deduplicates concurrent connection attempts (promise guard)", async () => {
    const [first, second] = await Promise.all([
      ensureBrowser(),
      ensureBrowser(),
    ]);

    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it("wraps connect failure with actionable error message", async () => {
    mockConnect.mockRejectedValue(new Error("net::ERR_CONNECTION_REFUSED"));

    await expect(ensureBrowser()).rejects.toThrow(
      "Failed to connect to Chrome",
    );
  });

  it("allows retry after connect failure", async () => {
    mockConnect.mockRejectedValueOnce(new Error("net::ERR_CONNECTION_REFUSED"));

    await expect(ensureBrowser()).rejects.toThrow();

    // Second attempt should work
    mockConnect.mockResolvedValueOnce(mockBrowser);
    const result = await ensureBrowser();
    expect(result).toBe(mockBrowser);
  });
});

// ── ensurePage() ────────────────────────────────────────────────────────

describe("ensurePage", () => {
  it("returns first page from browser.pages() on initial call", async () => {
    const page = await ensurePage();

    expect(mockBrowser.pages).toHaveBeenCalled();
    expect(page).toBe(mockPage);
  });

  it("sets default navigation timeout to 60 seconds", async () => {
    await ensurePage();

    expect(mockPage.setDefaultNavigationTimeout).toHaveBeenCalledWith(60_000);
  });

  it("returns cached page on subsequent calls", async () => {
    const first = await ensurePage();
    const second = await ensurePage();

    expect(first).toBe(second);
    expect(mockBrowser.pages).toHaveBeenCalledTimes(1);
  });

  it("calls ensureBrowser() if browser is not connected", async () => {
    const page = await ensurePage();

    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(page).toBe(mockPage);
  });

  it("throws if no pages are open", async () => {
    mockBrowser.pages.mockResolvedValue([]);

    await expect(ensurePage()).rejects.toThrow(
      "No open tabs found in Chrome",
    );
  });

  it("deduplicates concurrent page initialization (promise guard)", async () => {
    const [first, second] = await Promise.all([
      ensurePage(),
      ensurePage(),
    ]);

    expect(first).toBe(second);
    expect(mockBrowser.pages).toHaveBeenCalledTimes(1);
  });
});

// ── ensureCDPSession() ──────────────────────────────────────────────────

describe("ensureCDPSession", () => {
  it("creates a CDP session from the current page", async () => {
    const session = await ensureCDPSession();

    expect(mockPage.createCDPSession).toHaveBeenCalled();
    expect(session).toBe(mockCDPSession);
  });

  it("returns cached session on subsequent calls", async () => {
    const first = await ensureCDPSession();
    const second = await ensureCDPSession();

    expect(first).toBe(second);
    expect(mockPage.createCDPSession).toHaveBeenCalledTimes(1);
  });

  it("calls ensurePage() if no page is available", async () => {
    const session = await ensureCDPSession();

    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockBrowser.pages).toHaveBeenCalled();
    expect(session).toBe(mockCDPSession);
  });
});

// ── listAllPages() ──────────────────────────────────────────────────────

describe("listAllPages", () => {
  it("returns all open tabs with index, url, and title", async () => {
    await ensureBrowser();
    const pages = await listAllPages();

    expect(pages).toEqual([
      { index: 0, url: "https://example.com", title: "Example" },
      { index: 1, url: "https://google.com", title: "Google" },
    ]);
  });

  it("calls ensureBrowser() if not connected", async () => {
    const pages = await listAllPages();

    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(pages).toHaveLength(2);
  });
});

// ── switchToPage() ──────────────────────────────────────────────────────

describe("switchToPage", () => {
  it("switches to the correct tab by index", async () => {
    await ensureBrowser();
    const page = await switchToPage(1);

    expect(page).toBe(mockPage2);
  });

  it("brings the switched page to front", async () => {
    await ensureBrowser();
    await switchToPage(1);

    expect(mockPage2.bringToFront).toHaveBeenCalled();
  });

  it("updates the module-level page reference", async () => {
    await ensurePage();
    await switchToPage(1);

    const current = getPage();
    expect(current).toBe(mockPage2);
  });

  it("sets navigation timeout on the switched page", async () => {
    await ensureBrowser();
    await switchToPage(1);

    expect(mockPage2.setDefaultNavigationTimeout).toHaveBeenCalledWith(60_000);
  });

  it("resets cdpSession when switching pages", async () => {
    await ensureCDPSession();

    await switchToPage(1);

    const session = await ensureCDPSession();
    expect(mockPage2.createCDPSession).toHaveBeenCalled();
  });

  it("throws on invalid index (negative)", async () => {
    await ensureBrowser();

    await expect(switchToPage(-1)).rejects.toThrow("out of range");
  });

  it("throws on invalid index (out of range)", async () => {
    await ensureBrowser();

    await expect(switchToPage(99)).rejects.toThrow("out of range");
  });
});

// ── getPage() ───────────────────────────────────────────────────────────

describe("getPage", () => {
  it("returns the current page when connected", async () => {
    await ensurePage();

    const page = getPage();
    expect(page).toBe(mockPage);
  });

  it("throws when not connected", () => {
    expect(() => getPage()).toThrow("Not connected to a page");
  });
});

// ── getBrowser() ────────────────────────────────────────────────────────

describe("getBrowser", () => {
  it("returns the current browser when connected", async () => {
    await ensureBrowser();

    const result = getBrowser();
    expect(result).toBe(mockBrowser);
  });

  it("throws when not connected", () => {
    expect(() => getBrowser()).toThrow("Not connected to Chrome");
  });
});

// ── Disconnect handling ─────────────────────────────────────────────────

describe("disconnect handling", () => {
  it("nulls out all refs when disconnect fires", async () => {
    await ensureCDPSession();

    expect(disconnectHandler).not.toBeNull();
    disconnectHandler!();

    expect(() => getPage()).toThrow();
    expect(() => getBrowser()).toThrow();
  });

  it("allows reconnection after disconnect", async () => {
    await ensureBrowser();

    disconnectHandler!();

    const result = await ensureBrowser();
    expect(result).toBe(mockBrowser);
  });
});

// ── CHROME_CDP_URL validation ────────────────────────────────────────────

describe("CHROME_CDP_URL validation", () => {
  it("rejects non-loopback hosts", async () => {
    process.env.CHROME_CDP_URL = "http://evil.example.com:9222";

    await expect(ensureBrowser()).rejects.toThrow(
      'not a loopback address',
    );
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("rejects non-http schemes", async () => {
    process.env.CHROME_CDP_URL = "ftp://127.0.0.1:9222";

    await expect(ensureBrowser()).rejects.toThrow(
      'Only http: and https: are allowed',
    );
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("rejects malformed URLs", async () => {
    process.env.CHROME_CDP_URL = "not-a-url";

    await expect(ensureBrowser()).rejects.toThrow(
      'not a valid URL',
    );
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("accepts localhost", async () => {
    process.env.CHROME_CDP_URL = "http://localhost:9222";

    const result = await ensureBrowser();
    expect(mockConnect).toHaveBeenCalledWith({
      browserURL: "http://localhost:9222",
      defaultViewport: null,
    });
    expect(result).toBe(mockBrowser);
  });

  it("reads env var lazily (can change between calls)", async () => {
    // First call with default
    await ensureBrowser();
    expect(mockConnect).toHaveBeenCalledWith(
      expect.objectContaining({ browserURL: "http://127.0.0.1:9222" }),
    );

    // Simulate disconnect
    disconnectHandler!();

    // Change env var and reconnect
    process.env.CHROME_CDP_URL = "http://localhost:3000";
    await ensureBrowser();
    expect(mockConnect).toHaveBeenLastCalledWith(
      expect.objectContaining({ browserURL: "http://localhost:3000" }),
    );
  });
});

// ── Disconnect race guards ───────────────────────────────────────────────

describe("disconnect race guards", () => {
  it("ensurePage throws if browser disconnects during page init", async () => {
    // Make b.pages() trigger a disconnect before resolving
    mockBrowser.pages.mockImplementation(async () => {
      disconnectHandler!(); // Simulate disconnect mid-operation
      return [mockPage, mockPage2];
    });

    await expect(ensurePage()).rejects.toThrow(
      "Browser disconnected during page initialization",
    );
  });

  it("ensureCDPSession throws if browser disconnects during session creation", async () => {
    // Make createCDPSession trigger a disconnect before returning
    mockPage.createCDPSession.mockImplementation(async () => {
      disconnectHandler!();
      return mockCDPSession;
    });

    await expect(ensureCDPSession()).rejects.toThrow(
      "Browser disconnected during CDP session creation",
    );
  });
});
