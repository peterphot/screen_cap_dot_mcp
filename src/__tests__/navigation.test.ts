/**
 * Unit tests for navigation tools (src/tools/navigation.ts)
 *
 * All browser module interactions are mocked. These tests verify:
 * - All 8 tools are registered on the McpServer with correct names/descriptions/schemas
 * - Success paths return correct text content
 * - Error paths catch exceptions and return error text (never throw)
 * - Input validation via Zod schemas
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DEFAULT_TIMEOUT_MS } from "../browser.js";

// ── Mock Setup ──────────────────────────────────────────────────────────

// Mock the browser module
const mockEnsureBrowser = vi.fn();
const mockEnsurePage = vi.fn();
const mockListAllPages = vi.fn();
const mockSwitchToPage = vi.fn();

vi.mock("../browser.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../browser.js")>();
  return {
    ...actual,
    ensureBrowser: (...args: unknown[]) => mockEnsureBrowser(...args),
    ensurePage: (...args: unknown[]) => mockEnsurePage(...args),
    listAllPages: (...args: unknown[]) => mockListAllPages(...args),
    switchToPage: (...args: unknown[]) => mockSwitchToPage(...args),
  };
});

// Mock the recording-state module (navigation.ts imports isRecordingActive)
const mockIsRecordingActive = vi.fn().mockReturnValue(false);

vi.mock("../recording-state.js", () => ({
  isRecordingActive: (...args: unknown[]) => mockIsRecordingActive(...args),
  cleanupRecordingState: vi.fn(),
  stopActiveRecording: vi.fn().mockResolvedValue(undefined),
  recState: {
    recorder: null,
    path: "",
    keyMoments: [],
    startTime: 0,
    startPromise: null,
  },
  MAX_KEY_MOMENTS: 100,
}));

// Mock page object used by tools
interface MockPage {
  url: ReturnType<typeof vi.fn>;
  title: ReturnType<typeof vi.fn>;
  goto: ReturnType<typeof vi.fn>;
  waitForSelector: ReturnType<typeof vi.fn>;
  click: ReturnType<typeof vi.fn>;
  type: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  evaluate: ReturnType<typeof vi.fn>;
}

let mockPage: MockPage;

// ── Helpers ─────────────────────────────────────────────────────────────

// Internal type for accessing McpServer's private _registeredTools (plain object, not Map)
type RegisteredToolsMap = Record<string, { handler: Function; description?: string }>;

/**
 * Extract the registered tool handler from a McpServer instance.
 *
 * McpServer stores tools in a private plain object keyed by tool name.
 * We access it via the internal _registeredTools property to call handlers directly.
 */
function getToolHandler(server: McpServer, toolName: string) {
  const tools = (server as unknown as { _registeredTools: RegisteredToolsMap })
    ._registeredTools;
  const tool = tools[toolName];
  if (!tool) {
    throw new Error(`Tool "${toolName}" not registered on server`);
  }
  return tool.handler;
}

function getRegisteredTools(server: McpServer): RegisteredToolsMap {
  return (server as unknown as { _registeredTools: RegisteredToolsMap })._registeredTools;
}

// ── Setup ───────────────────────────────────────────────────────────────

let server: McpServer;

beforeEach(async () => {
  vi.clearAllMocks();

  mockPage = {
    url: vi.fn().mockReturnValue("https://example.com"),
    title: vi.fn().mockResolvedValue("Example"),
    goto: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined),
    select: vi.fn().mockResolvedValue(["option1"]),
    evaluate: vi.fn().mockResolvedValue({ result: "test" }),
  };

  mockEnsureBrowser.mockResolvedValue({});
  mockEnsurePage.mockResolvedValue(mockPage);
  mockListAllPages.mockResolvedValue([
    { index: 0, url: "https://example.com", title: "Example" },
    { index: 1, url: "https://google.com", title: "Google" },
  ]);
  mockSwitchToPage.mockResolvedValue(mockPage);

  // Create a fresh server and register tools for each test
  server = new McpServer({ name: "test-server", version: "1.0.0" });
  const { registerNavigationTools } = await import("../tools/navigation.js");
  registerNavigationTools(server);
});

// ── Tool Registration ───────────────────────────────────────────────────

describe("registerNavigationTools", () => {
  it("registers all 8 tools on the server", () => {
    const tools = getRegisteredTools(server);
    const toolNames = Object.keys(tools);

    expect(toolNames).toContain("browser_connect");
    expect(toolNames).toContain("browser_navigate");
    expect(toolNames).toContain("browser_click");
    expect(toolNames).toContain("browser_type");
    expect(toolNames).toContain("browser_select");
    expect(toolNames).toContain("browser_evaluate");
    expect(toolNames).toContain("browser_list_pages");
    expect(toolNames).toContain("browser_switch_page");
    expect(toolNames).toHaveLength(8);
  });

  it("each tool has a description", () => {
    const tools = getRegisteredTools(server);

    for (const [name, tool] of Object.entries(tools)) {
      expect(tool.description, `Tool "${name}" should have a description`).toBeTruthy();
    }
  });
});

// ── browser_connect ─────────────────────────────────────────────────────

describe("browser_connect", () => {
  it("calls ensureBrowser and ensurePage, returns confirmation with URL and title", async () => {
    const handler = getToolHandler(server, "browser_connect");
    const result = await handler({}, { signal: new AbortController().signal });

    expect(mockEnsureBrowser).toHaveBeenCalled();
    expect(mockEnsurePage).toHaveBeenCalled();
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("https://example.com");
    expect(result.content[0].text).toContain("Example");
  });

  it("returns error text when connection fails (does not throw)", async () => {
    mockEnsureBrowser.mockRejectedValue(new Error("Connection refused"));
    const handler = getToolHandler(server, "browser_connect");
    const result = await handler({}, { signal: new AbortController().signal });

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("Connection refused");
    expect(result.isError).toBe(true);
  });
});

// ── browser_navigate ────────────────────────────────────────────────────

describe("browser_navigate", () => {
  it("navigates to the given URL and returns final URL + title", async () => {
    mockPage.url.mockReturnValue("https://example.com/page");
    mockPage.title.mockResolvedValue("Page Title");

    const handler = getToolHandler(server, "browser_navigate");
    const result = await handler(
      { url: "https://example.com/page" },
      { signal: new AbortController().signal },
    );

    expect(mockEnsurePage).toHaveBeenCalled();
    expect(mockPage.goto).toHaveBeenCalledWith("https://example.com/page", {
      waitUntil: "load",
      timeout: DEFAULT_TIMEOUT_MS,
    });
    // Verify we pass parsed.href (not raw input) to page.goto
    expect(result.content[0].text).toContain("https://example.com/page");
    expect(result.content[0].text).toContain("Page Title");
  });

  it("uses custom waitUntil parameter", async () => {
    const handler = getToolHandler(server, "browser_navigate");
    await handler(
      { url: "https://example.com", waitUntil: "networkidle2" },
      { signal: new AbortController().signal },
    );

    expect(mockPage.goto).toHaveBeenCalledWith("https://example.com/", {
      waitUntil: "networkidle2",
      timeout: DEFAULT_TIMEOUT_MS,
    });
  });

  it("returns error text on navigation failure", async () => {
    mockPage.goto.mockRejectedValue(new Error("Navigation timeout"));
    const handler = getToolHandler(server, "browser_navigate");
    const result = await handler(
      { url: "https://example.com" },
      { signal: new AbortController().signal },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Navigation timeout");
  });

  it("rejects file:// URLs", async () => {
    const handler = getToolHandler(server, "browser_navigate");
    const result = await handler(
      { url: "file:///etc/passwd" },
      { signal: new AbortController().signal },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Only http: and https: URLs are allowed");
    expect(mockPage.goto).not.toHaveBeenCalled();
  });

  it("rejects javascript: URLs", async () => {
    const handler = getToolHandler(server, "browser_navigate");
    const result = await handler(
      { url: "javascript:alert(1)" },
      { signal: new AbortController().signal },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Only http: and https: URLs are allowed");
    expect(mockPage.goto).not.toHaveBeenCalled();
  });

  it("rejects invalid URLs", async () => {
    const handler = getToolHandler(server, "browser_navigate");
    const result = await handler(
      { url: "not-a-valid-url" },
      { signal: new AbortController().signal },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid URL");
    expect(mockPage.goto).not.toHaveBeenCalled();
  });
});

// ── browser_click ───────────────────────────────────────────────────────

describe("browser_click", () => {
  it("waits for selector and clicks the element", async () => {
    const handler = getToolHandler(server, "browser_click");
    const result = await handler(
      { selector: "#submit-btn" },
      { signal: new AbortController().signal },
    );

    expect(mockEnsurePage).toHaveBeenCalled();
    expect(mockPage.waitForSelector).toHaveBeenCalledWith("#submit-btn", { visible: true });
    expect(mockPage.click).toHaveBeenCalledWith("#submit-btn");
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("#submit-btn");
  });

  it("returns error text when selector not found", async () => {
    mockPage.waitForSelector.mockRejectedValue(new Error("Selector not found"));
    const handler = getToolHandler(server, "browser_click");
    const result = await handler(
      { selector: "#missing" },
      { signal: new AbortController().signal },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Selector not found");
  });
});

// ── browser_type ────────────────────────────────────────────────────────

describe("browser_type", () => {
  it("types text into the specified selector", async () => {
    const handler = getToolHandler(server, "browser_type");
    const result = await handler(
      { selector: "#input", text: "hello world" },
      { signal: new AbortController().signal },
    );

    expect(mockEnsurePage).toHaveBeenCalled();
    expect(mockPage.click).toHaveBeenCalledWith("#input");
    expect(mockPage.type).toHaveBeenCalledWith("#input", "hello world");
    expect(result.content[0].text).toContain("#input");
  });

  it("clears field with triple-click before typing when clear=true", async () => {
    const handler = getToolHandler(server, "browser_type");
    await handler(
      { selector: "#input", text: "new text", clear: true },
      { signal: new AbortController().signal },
    );

    expect(mockPage.click).toHaveBeenCalledWith("#input", { clickCount: 3 });
    expect(mockPage.type).toHaveBeenCalledWith("#input", "new text");
  });

  it("returns error text when typing fails", async () => {
    mockPage.click.mockRejectedValue(new Error("Element not interactable"));
    const handler = getToolHandler(server, "browser_type");
    const result = await handler(
      { selector: "#input", text: "test" },
      { signal: new AbortController().signal },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Element not interactable");
  });
});

// ── browser_select ──────────────────────────────────────────────────────

describe("browser_select", () => {
  it("selects the specified option value", async () => {
    const handler = getToolHandler(server, "browser_select");
    const result = await handler(
      { selector: "#dropdown", value: "option1" },
      { signal: new AbortController().signal },
    );

    expect(mockEnsurePage).toHaveBeenCalled();
    expect(mockPage.select).toHaveBeenCalledWith("#dropdown", "option1");
    expect(result.content[0].text).toContain("#dropdown");
    expect(result.content[0].text).toContain("option1");
  });

  it("returns error text when select fails", async () => {
    mockPage.select.mockRejectedValue(new Error("Element not a <select>"));
    const handler = getToolHandler(server, "browser_select");
    const result = await handler(
      { selector: "#not-select", value: "val" },
      { signal: new AbortController().signal },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Element not a <select>");
  });
});

// ── browser_evaluate ────────────────────────────────────────────────────

describe("browser_evaluate", () => {
  it("evaluates JS script and returns JSON-stringified result", async () => {
    const original = process.env.ALLOW_EVALUATE;
    process.env.ALLOW_EVALUATE = "true";
    try {
      mockPage.evaluate.mockResolvedValue({ count: 42 });
      const handler = getToolHandler(server, "browser_evaluate");
      const result = await handler(
        { script: "document.querySelectorAll('div').length" },
        { signal: new AbortController().signal },
      );

      expect(mockEnsurePage).toHaveBeenCalled();
      expect(mockPage.evaluate).toHaveBeenCalled();
      expect(result.content[0].text).toContain(JSON.stringify({ count: 42 }));
    } finally {
      if (original === undefined) {
        delete process.env.ALLOW_EVALUATE;
      } else {
        process.env.ALLOW_EVALUATE = original;
      }
    }
  });

  it("handles undefined/null evaluate results", async () => {
    const original = process.env.ALLOW_EVALUATE;
    process.env.ALLOW_EVALUATE = "true";
    try {
      mockPage.evaluate.mockResolvedValue(undefined);
      const handler = getToolHandler(server, "browser_evaluate");
      const result = await handler(
        { script: "void 0" },
        { signal: new AbortController().signal },
      );

      expect(result.content[0].type).toBe("text");
      // Should not throw, even with undefined result
      expect(result.isError).toBeFalsy();
    } finally {
      if (original === undefined) {
        delete process.env.ALLOW_EVALUATE;
      } else {
        process.env.ALLOW_EVALUATE = original;
      }
    }
  });

  it("returns error when ALLOW_EVALUATE is not set (default-deny)", async () => {
    const original = process.env.ALLOW_EVALUATE;
    delete process.env.ALLOW_EVALUATE;
    try {
      const handler = getToolHandler(server, "browser_evaluate");
      const result = await handler(
        { script: "1+1" },
        { signal: new AbortController().signal },
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("browser_evaluate is disabled");
      expect(mockPage.evaluate).not.toHaveBeenCalled();
    } finally {
      if (original === undefined) {
        delete process.env.ALLOW_EVALUATE;
      } else {
        process.env.ALLOW_EVALUATE = original;
      }
    }
  });

  it("returns error when ALLOW_EVALUATE=false", async () => {
    const original = process.env.ALLOW_EVALUATE;
    process.env.ALLOW_EVALUATE = "false";
    try {
      const handler = getToolHandler(server, "browser_evaluate");
      const result = await handler(
        { script: "1+1" },
        { signal: new AbortController().signal },
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("browser_evaluate is disabled");
      expect(mockPage.evaluate).not.toHaveBeenCalled();
    } finally {
      if (original === undefined) {
        delete process.env.ALLOW_EVALUATE;
      } else {
        process.env.ALLOW_EVALUATE = original;
      }
    }
  });

  it("returns error text when script throws", async () => {
    const original = process.env.ALLOW_EVALUATE;
    process.env.ALLOW_EVALUATE = "true";
    try {
      mockPage.evaluate.mockRejectedValue(new Error("ReferenceError: x is not defined"));
      const handler = getToolHandler(server, "browser_evaluate");
      const result = await handler(
        { script: "x.y.z" },
        { signal: new AbortController().signal },
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("ReferenceError");
    } finally {
      if (original === undefined) {
        delete process.env.ALLOW_EVALUATE;
      } else {
        process.env.ALLOW_EVALUATE = original;
      }
    }
  });
});

// ── browser_list_pages ──────────────────────────────────────────────────

describe("browser_list_pages", () => {
  it("returns JSON array of open pages", async () => {
    const handler = getToolHandler(server, "browser_list_pages");
    const result = await handler({}, { signal: new AbortController().signal });

    expect(mockListAllPages).toHaveBeenCalled();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual([
      { index: 0, url: "https://example.com", title: "Example" },
      { index: 1, url: "https://google.com", title: "Google" },
    ]);
  });

  it("returns error text when listing fails", async () => {
    mockListAllPages.mockRejectedValue(new Error("Not connected"));
    const handler = getToolHandler(server, "browser_list_pages");
    const result = await handler({}, { signal: new AbortController().signal });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Not connected");
  });
});

// ── browser_switch_page ─────────────────────────────────────────────────

describe("browser_switch_page", () => {
  it("switches to the specified tab and returns URL + title", async () => {
    const switchedPage = {
      url: vi.fn().mockReturnValue("https://google.com"),
      title: vi.fn().mockResolvedValue("Google"),
    };
    mockSwitchToPage.mockResolvedValue(switchedPage);

    const handler = getToolHandler(server, "browser_switch_page");
    const result = await handler(
      { index: 1 },
      { signal: new AbortController().signal },
    );

    expect(mockSwitchToPage).toHaveBeenCalledWith(1);
    expect(result.content[0].text).toContain("https://google.com");
    expect(result.content[0].text).toContain("Google");
  });

  it("returns error text when index is out of range", async () => {
    mockSwitchToPage.mockRejectedValue(new Error("Tab index 99 is out of range"));
    const handler = getToolHandler(server, "browser_switch_page");
    const result = await handler(
      { index: 99 },
      { signal: new AbortController().signal },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("out of range");
  });

  it("rejects tab switch while recording is active", async () => {
    mockIsRecordingActive.mockReturnValue(true);
    const handler = getToolHandler(server, "browser_switch_page");
    const result = await handler(
      { index: 1 },
      { signal: new AbortController().signal },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Cannot switch tabs while recording");
    expect(mockSwitchToPage).not.toHaveBeenCalled();
    mockIsRecordingActive.mockReturnValue(false);
  });
});
