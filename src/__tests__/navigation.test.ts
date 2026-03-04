/**
 * Unit tests for navigation tools (src/tools/navigation.ts)
 *
 * All browser module interactions are mocked. These tests verify:
 * - All 12 tools are registered on the McpServer with correct names/descriptions/schemas
 *   (browser_scroll_to_text moved to scrolling.test.ts)
 * - Success paths return correct text content
 * - Error paths catch exceptions and return error text (never throw)
 * - Input validation via Zod schemas
 * - Ref-based interaction via CDP helpers (browser_click, browser_type, browser_hover)
 * - Coordinate-based interaction (browser_click_at, browser_hover_at)
 * - Keyboard interaction (browser_press_key)
 * - Refs cleared on navigation
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

// Mock the ref-store module
const mockResolveRef = vi.fn();
const mockClearRefs = vi.fn();
vi.mock("../ref-store.js", () => ({
  resolveRef: (...args: unknown[]) => mockResolveRef(...args),
  clearRefs: (...args: unknown[]) => mockClearRefs(...args),
}));

// Mock the cdp-helpers module
const mockClickByBackendNodeId = vi.fn();
const mockTypeByBackendNodeId = vi.fn();
const mockHoverByBackendNodeId = vi.fn();
const mockClickAtCoordinates = vi.fn();
const mockHoverAtCoordinates = vi.fn();
vi.mock("../cdp-helpers.js", () => ({
  clickByBackendNodeId: (...args: unknown[]) => mockClickByBackendNodeId(...args),
  typeByBackendNodeId: (...args: unknown[]) => mockTypeByBackendNodeId(...args),
  hoverByBackendNodeId: (...args: unknown[]) => mockHoverByBackendNodeId(...args),
  clickAtCoordinates: (...args: unknown[]) => mockClickAtCoordinates(...args),
  hoverAtCoordinates: (...args: unknown[]) => mockHoverAtCoordinates(...args),
}));

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
  hover: ReturnType<typeof vi.fn>;
  keyboard: { press: ReturnType<typeof vi.fn> };
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
    hover: vi.fn().mockResolvedValue(undefined),
    keyboard: { press: vi.fn().mockResolvedValue(undefined) },
  };

  mockClickByBackendNodeId.mockResolvedValue({ x: 100, y: 200 });
  mockTypeByBackendNodeId.mockResolvedValue(undefined);
  mockHoverByBackendNodeId.mockResolvedValue({ x: 100, y: 200 });
  mockClickAtCoordinates.mockResolvedValue({ x: 0, y: 0 });
  mockHoverAtCoordinates.mockResolvedValue({ x: 0, y: 0 });

  mockEnsureBrowser.mockResolvedValue({});
  mockEnsurePage.mockResolvedValue(mockPage);
  mockListAllPages.mockResolvedValue([
    { index: 0, url: "https://example.com", title: "Example" },
    { index: 1, url: "https://google.com", title: "Google" },
  ]);
  mockSwitchToPage.mockResolvedValue(mockPage);

  // Create a fresh server and register tools for each test
  // Set ALLOW_EVALUATE so browser_evaluate is registered (conditional registration)
  process.env.ALLOW_EVALUATE = "true";
  server = new McpServer({ name: "test-server", version: "1.0.0" });
  const { registerNavigationTools } = await import("../tools/navigation.js");
  registerNavigationTools(server);
});

// ── Tool Registration ───────────────────────────────────────────────────

describe("registerNavigationTools", () => {
  it("registers all 12 tools on the server", () => {
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
    expect(toolNames).toContain("browser_hover");
    expect(toolNames).toContain("browser_click_at");
    expect(toolNames).toContain("browser_hover_at");
    expect(toolNames).toContain("browser_press_key");
    expect(toolNames).toHaveLength(12);
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

  it("calls clearRefs() after successful navigation to invalidate stale refs", async () => {
    const handler = getToolHandler(server, "browser_navigate");
    await handler(
      { url: "https://example.com/new-page" },
      { signal: new AbortController().signal },
    );

    expect(mockClearRefs).toHaveBeenCalled();
    // clearRefs should be called after page.goto succeeds
    const clearRefsOrder = mockClearRefs.mock.invocationCallOrder[0];
    const gotoOrder = mockPage.goto.mock.invocationCallOrder[0];
    expect(clearRefsOrder).toBeGreaterThan(gotoOrder);
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

  it("clicks via CDP when ref is provided", async () => {
    mockResolveRef.mockReturnValue(42);
    const handler = getToolHandler(server, "browser_click");
    const result = await handler(
      { ref: "e1" },
      { signal: new AbortController().signal },
    );

    expect(mockResolveRef).toHaveBeenCalledWith("e1");
    expect(mockClickByBackendNodeId).toHaveBeenCalledWith(42, undefined);
    expect(result.content[0].text).toContain("e1");
    expect(result.isError).toBeFalsy();
  });

  it("returns error when both selector and ref are provided", async () => {
    const handler = getToolHandler(server, "browser_click");
    const result = await handler(
      { selector: "#btn", ref: "e1" },
      { signal: new AbortController().signal },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not both");
  });

  it("returns error when neither selector nor ref is provided", async () => {
    const handler = getToolHandler(server, "browser_click");
    const result = await handler(
      {},
      { signal: new AbortController().signal },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("selector");
    expect(result.content[0].text).toContain("ref");
  });

  it("returns descriptive error for stale ref", async () => {
    mockResolveRef.mockReturnValue(undefined);
    const handler = getToolHandler(server, "browser_click");
    const result = await handler(
      { ref: "e99" },
      { signal: new AbortController().signal },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("e99");
    expect(result.content[0].text).toContain("snapshot");
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

  it("types via CDP when ref is provided", async () => {
    mockResolveRef.mockReturnValue(55);
    const handler = getToolHandler(server, "browser_type");
    const result = await handler(
      { ref: "e3", text: "hello ref" },
      { signal: new AbortController().signal },
    );

    expect(mockResolveRef).toHaveBeenCalledWith("e3");
    expect(mockTypeByBackendNodeId).toHaveBeenCalledWith(55, "hello ref", undefined);
    expect(result.content[0].text).toContain("e3");
    expect(result.isError).toBeFalsy();
  });

  it("types via CDP with clear=true when ref is provided", async () => {
    mockResolveRef.mockReturnValue(55);
    const handler = getToolHandler(server, "browser_type");
    await handler(
      { ref: "e3", text: "replaced", clear: true },
      { signal: new AbortController().signal },
    );

    expect(mockTypeByBackendNodeId).toHaveBeenCalledWith(55, "replaced", true);
  });

  it("returns error when both selector and ref are provided for type", async () => {
    const handler = getToolHandler(server, "browser_type");
    const result = await handler(
      { selector: "#input", ref: "e1", text: "test" },
      { signal: new AbortController().signal },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not both");
  });

  it("returns error when neither selector nor ref is provided for type", async () => {
    const handler = getToolHandler(server, "browser_type");
    const result = await handler(
      { text: "test" },
      { signal: new AbortController().signal },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("selector");
    expect(result.content[0].text).toContain("ref");
  });

  it("returns descriptive error for stale ref in type", async () => {
    mockResolveRef.mockReturnValue(undefined);
    const handler = getToolHandler(server, "browser_type");
    const result = await handler(
      { ref: "e99", text: "test" },
      { signal: new AbortController().signal },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("e99");
    expect(result.content[0].text).toContain("snapshot");
  });
});

// ── browser_hover ───────────────────────────────────────────────────────

describe("browser_hover", () => {
  it("hovers over an element by CSS selector", async () => {
    const handler = getToolHandler(server, "browser_hover");
    const result = await handler(
      { selector: "#menu-item" },
      { signal: new AbortController().signal },
    );

    expect(mockEnsurePage).toHaveBeenCalled();
    expect(mockPage.hover).toHaveBeenCalledWith("#menu-item");
    expect(result.content[0].text).toContain("#menu-item");
    expect(result.isError).toBeFalsy();
  });

  it("hovers via CDP when ref is provided", async () => {
    mockResolveRef.mockReturnValue(77);
    const handler = getToolHandler(server, "browser_hover");
    const result = await handler(
      { ref: "e5" },
      { signal: new AbortController().signal },
    );

    expect(mockResolveRef).toHaveBeenCalledWith("e5");
    expect(mockHoverByBackendNodeId).toHaveBeenCalledWith(77, undefined);
    expect(result.content[0].text).toContain("e5");
    expect(result.isError).toBeFalsy();
  });

  it("returns error when both selector and ref are provided for hover", async () => {
    const handler = getToolHandler(server, "browser_hover");
    const result = await handler(
      { selector: "#item", ref: "e1" },
      { signal: new AbortController().signal },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not both");
  });

  it("returns error when neither selector nor ref is provided for hover", async () => {
    const handler = getToolHandler(server, "browser_hover");
    const result = await handler(
      {},
      { signal: new AbortController().signal },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("selector");
    expect(result.content[0].text).toContain("ref");
  });

  it("returns error text when hover fails", async () => {
    mockPage.hover.mockRejectedValue(new Error("Element detached"));
    const handler = getToolHandler(server, "browser_hover");
    const result = await handler(
      { selector: "#gone" },
      { signal: new AbortController().signal },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Element detached");
  });

  it("returns descriptive error for stale ref", async () => {
    mockResolveRef.mockReturnValue(undefined);
    const handler = getToolHandler(server, "browser_hover");
    const result = await handler(
      { ref: "e999" },
      { signal: new AbortController().signal },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Stale or invalid ref");
    expect(result.content[0].text).toContain("e999");
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

  it("is not registered when ALLOW_EVALUATE is not set (default-deny)", async () => {
    const original = process.env.ALLOW_EVALUATE;
    delete process.env.ALLOW_EVALUATE;
    try {
      const noEvalServer = new McpServer({ name: "test-no-eval", version: "1.0.0" });
      const { registerNavigationTools } = await import("../tools/navigation.js");
      registerNavigationTools(noEvalServer);

      const tools = getRegisteredTools(noEvalServer);
      expect(Object.keys(tools)).not.toContain("browser_evaluate");
    } finally {
      if (original === undefined) {
        delete process.env.ALLOW_EVALUATE;
      } else {
        process.env.ALLOW_EVALUATE = original;
      }
    }
  });

  it("is not registered when ALLOW_EVALUATE=false", async () => {
    const original = process.env.ALLOW_EVALUATE;
    process.env.ALLOW_EVALUATE = "false";
    try {
      const noEvalServer = new McpServer({ name: "test-no-eval", version: "1.0.0" });
      const { registerNavigationTools } = await import("../tools/navigation.js");
      registerNavigationTools(noEvalServer);

      const tools = getRegisteredTools(noEvalServer);
      expect(Object.keys(tools)).not.toContain("browser_evaluate");
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

// ── browser_click_at ─────────────────────────────────────────────────

describe("browser_click_at", () => {
  it("calls clickAtCoordinates and returns success text", async () => {
    const handler = getToolHandler(server, "browser_click_at");
    const result = await handler(
      { x: 150, y: 250 },
      { signal: new AbortController().signal },
    );

    expect(mockClickAtCoordinates).toHaveBeenCalledWith(150, 250);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("150");
    expect(result.content[0].text).toContain("250");
    expect(result.isError).toBeFalsy();
  });

  it("includes label in response when provided", async () => {
    const handler = getToolHandler(server, "browser_click_at");
    const result = await handler(
      { x: 100, y: 200, label: "chart-bar" },
      { signal: new AbortController().signal },
    );

    expect(mockClickAtCoordinates).toHaveBeenCalledWith(100, 200);
    expect(result.content[0].text).toContain("chart-bar");
    expect(result.isError).toBeFalsy();
  });

  it("returns error text when clickAtCoordinates fails (does not throw)", async () => {
    mockClickAtCoordinates.mockRejectedValue(new RangeError("Invalid coordinates: (-1, 100)"));
    const handler = getToolHandler(server, "browser_click_at");
    const result = await handler(
      { x: -1, y: 100 },
      { signal: new AbortController().signal },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid coordinates");
  });

  it("has LLM-guiding description mentioning Canvas and coordinates", () => {
    const tools = getRegisteredTools(server);
    const tool = tools["browser_click_at"];
    expect(tool.description).toContain("coordinate");
  });
});

// ── browser_hover_at ─────────────────────────────────────────────────

describe("browser_hover_at", () => {
  it("calls hoverAtCoordinates and returns success text", async () => {
    const handler = getToolHandler(server, "browser_hover_at");
    const result = await handler(
      { x: 300, y: 400 },
      { signal: new AbortController().signal },
    );

    expect(mockHoverAtCoordinates).toHaveBeenCalledWith(300, 400);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("300");
    expect(result.content[0].text).toContain("400");
    expect(result.isError).toBeFalsy();
  });

  it("includes label in response when provided", async () => {
    const handler = getToolHandler(server, "browser_hover_at");
    const result = await handler(
      { x: 500, y: 600, label: "tooltip-trigger" },
      { signal: new AbortController().signal },
    );

    expect(mockHoverAtCoordinates).toHaveBeenCalledWith(500, 600);
    expect(result.content[0].text).toContain("tooltip-trigger");
    expect(result.isError).toBeFalsy();
  });

  it("returns error text when hoverAtCoordinates fails (does not throw)", async () => {
    mockHoverAtCoordinates.mockRejectedValue(new RangeError("Invalid coordinates: (100, -1)"));
    const handler = getToolHandler(server, "browser_hover_at");
    const result = await handler(
      { x: 100, y: -1 },
      { signal: new AbortController().signal },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid coordinates");
  });

  it("has LLM-guiding description mentioning Canvas and coordinates", () => {
    const tools = getRegisteredTools(server);
    const tool = tools["browser_hover_at"];
    expect(tool.description).toContain("coordinate");
  });
});

// ── browser_press_key ──────────────────────────────────────────────────

describe("browser_press_key", () => {
  it("calls page.keyboard.press with the given key and returns success text", async () => {
    const handler = getToolHandler(server, "browser_press_key");
    const result = await handler(
      { key: "Escape" },
      { signal: new AbortController().signal },
    );

    expect(mockEnsurePage).toHaveBeenCalled();
    expect(mockPage.keyboard.press).toHaveBeenCalledWith("Escape");
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("Escape");
    expect(result.isError).toBeFalsy();
  });

  it("supports Tab key", async () => {
    const handler = getToolHandler(server, "browser_press_key");
    const result = await handler(
      { key: "Tab" },
      { signal: new AbortController().signal },
    );

    expect(mockPage.keyboard.press).toHaveBeenCalledWith("Tab");
    expect(result.content[0].text).toContain("Tab");
    expect(result.isError).toBeFalsy();
  });

  it("supports Enter key", async () => {
    const handler = getToolHandler(server, "browser_press_key");
    const result = await handler(
      { key: "Enter" },
      { signal: new AbortController().signal },
    );

    expect(mockPage.keyboard.press).toHaveBeenCalledWith("Enter");
    expect(result.content[0].text).toContain("Enter");
    expect(result.isError).toBeFalsy();
  });

  it("supports arrow keys", async () => {
    const handler = getToolHandler(server, "browser_press_key");
    const result = await handler(
      { key: "ArrowDown" },
      { signal: new AbortController().signal },
    );

    expect(mockPage.keyboard.press).toHaveBeenCalledWith("ArrowDown");
    expect(result.content[0].text).toContain("ArrowDown");
    expect(result.isError).toBeFalsy();
  });

  it("supports modifier combinations like Control+a", async () => {
    const handler = getToolHandler(server, "browser_press_key");
    const result = await handler(
      { key: "Control+a" },
      { signal: new AbortController().signal },
    );

    expect(mockPage.keyboard.press).toHaveBeenCalledWith("Control+a");
    expect(result.content[0].text).toContain("Control+a");
    expect(result.isError).toBeFalsy();
  });

  it("returns error text when keyboard.press fails (does not throw)", async () => {
    mockPage.keyboard.press.mockRejectedValue(new Error("Key press failed"));
    const handler = getToolHandler(server, "browser_press_key");
    const result = await handler(
      { key: "Escape" },
      { signal: new AbortController().signal },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Key press failed");
  });

  it("truncates long key values in error messages to 50 characters", async () => {
    const longKey = "A".repeat(80);
    mockPage.keyboard.press.mockRejectedValue(new Error("Key press failed"));
    const handler = getToolHandler(server, "browser_press_key");
    const result = await handler(
      { key: longKey },
      { signal: new AbortController().signal },
    );

    expect(result.isError).toBe(true);
    // Should contain the truncated key (50 chars + ellipsis), not the full 80-char key
    expect(result.content[0].text).toContain("A".repeat(50));
    expect(result.content[0].text).not.toContain("A".repeat(80));
  });
});

