/**
 * Unit tests for scrolling tools (src/tools/scrolling.ts)
 *
 * All browser module interactions are mocked. These tests verify:
 * - All 2 tools are registered on the McpServer with correct names/descriptions/schemas
 * - browser_scroll scrolls page or container in the specified direction
 * - browser_scroll_to_element scrolls an element into view
 * - Error paths catch exceptions and return error text with isError: true (never throw)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// ── Mock Setup ──────────────────────────────────────────────────────────

// Mock the browser module
const mockEnsurePage = vi.fn();

vi.mock("../browser.js", () => ({
  ensurePage: (...args: unknown[]) => mockEnsurePage(...args),
}));

// Mock logger
vi.mock("../util/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    setLogLevel: vi.fn(),
  },
}));

// Mock page object
interface MockPage {
  evaluate: ReturnType<typeof vi.fn>;
}

let mockPage: MockPage;

// ── Helpers ─────────────────────────────────────────────────────────────

type RegisteredToolsMap = Record<string, { handler: Function; description?: string }>;

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

const defaultScrollResult = {
  scrollTop: 500,
  scrollLeft: 0,
  scrollHeight: 5000,
  scrollWidth: 1280,
  clientHeight: 720,
  clientWidth: 1280,
};

beforeEach(async () => {
  vi.clearAllMocks();

  mockPage = {
    evaluate: vi.fn().mockResolvedValue(defaultScrollResult),
  };

  mockEnsurePage.mockResolvedValue(mockPage);

  // Create a fresh server and register tools for each test
  server = new McpServer({ name: "test-server", version: "1.0.0" });
  const { registerScrollingTools } = await import("../tools/scrolling.js");
  registerScrollingTools(server);
});

// ── Tool Registration ───────────────────────────────────────────────────

describe("registerScrollingTools", () => {
  it("registers all 2 tools on the server", () => {
    const tools = getRegisteredTools(server);
    const toolNames = Object.keys(tools);

    expect(toolNames).toContain("browser_scroll");
    expect(toolNames).toContain("browser_scroll_to_element");
  });

  it("each tool has a description", () => {
    const tools = getRegisteredTools(server);
    const scrollingTools = ["browser_scroll", "browser_scroll_to_element"];

    for (const name of scrollingTools) {
      expect(tools[name].description, `Tool "${name}" should have a description`).toBeTruthy();
    }
  });
});

// ── browser_scroll ──────────────────────────────────────────────────────

describe("browser_scroll", () => {
  it("scrolls the page down by default amount (500px)", async () => {
    const handler = getToolHandler(server, "browser_scroll");
    const result = await handler(
      { direction: "down" },
      { signal: new AbortController().signal },
    );

    expect(mockEnsurePage).toHaveBeenCalled();
    expect(mockPage.evaluate).toHaveBeenCalled();

    // The evaluate function should have been called with arguments for direction, amount, and no selector
    const callArgs = mockPage.evaluate.mock.calls[0];
    // Second argument onwards are the parameters passed to the evaluate function
    expect(callArgs[1]).toBe("down");    // direction
    expect(callArgs[2]).toBe(500);       // default amount
    expect(callArgs[3]).toBeUndefined(); // no selector

    expect(result.content[0].type).toBe("text");
    expect(result.isError).toBeFalsy();
  });

  it("scrolls up with custom amount", async () => {
    const handler = getToolHandler(server, "browser_scroll");
    await handler(
      { direction: "up", amount: 200 },
      { signal: new AbortController().signal },
    );

    const callArgs = mockPage.evaluate.mock.calls[0];
    expect(callArgs[1]).toBe("up");
    expect(callArgs[2]).toBe(200);
  });

  it("scrolls left", async () => {
    const handler = getToolHandler(server, "browser_scroll");
    await handler(
      { direction: "left", amount: 300 },
      { signal: new AbortController().signal },
    );

    const callArgs = mockPage.evaluate.mock.calls[0];
    expect(callArgs[1]).toBe("left");
    expect(callArgs[2]).toBe(300);
  });

  it("scrolls right", async () => {
    const handler = getToolHandler(server, "browser_scroll");
    await handler(
      { direction: "right", amount: 300 },
      { signal: new AbortController().signal },
    );

    const callArgs = mockPage.evaluate.mock.calls[0];
    expect(callArgs[1]).toBe("right");
    expect(callArgs[2]).toBe(300);
  });

  it("scrolls a specific container when selector is provided", async () => {
    const handler = getToolHandler(server, "browser_scroll");
    await handler(
      { direction: "down", selector: "#scroll-container" },
      { signal: new AbortController().signal },
    );

    const callArgs = mockPage.evaluate.mock.calls[0];
    expect(callArgs[1]).toBe("down");
    expect(callArgs[3]).toBe("#scroll-container");
  });

  it("returns scroll position info in the response", async () => {
    mockPage.evaluate.mockResolvedValue({
      scrollTop: 500,
      scrollLeft: 0,
      scrollHeight: 5000,
      scrollWidth: 1280,
      clientHeight: 720,
      clientWidth: 1280,
    });

    const handler = getToolHandler(server, "browser_scroll");
    const result = await handler(
      { direction: "down" },
      { signal: new AbortController().signal },
    );

    const text = result.content[0].text;
    expect(text).toContain("scrollTop");
    expect(text).toContain("500");
    expect(text).toContain("scrollHeight");
    expect(text).toContain("5000");
  });

  it("returns error text when scroll fails (does not throw)", async () => {
    mockPage.evaluate.mockRejectedValue(new Error("Page context destroyed"));
    const handler = getToolHandler(server, "browser_scroll");
    const result = await handler(
      { direction: "down" },
      { signal: new AbortController().signal },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("Page context destroyed");
  });
});

// ── browser_scroll_to_element ───────────────────────────────────────────

describe("browser_scroll_to_element", () => {
  it("scrolls the element into view using scrollIntoView", async () => {
    mockPage.evaluate.mockResolvedValue(true);

    const handler = getToolHandler(server, "browser_scroll_to_element");
    const result = await handler(
      { selector: "#target-element" },
      { signal: new AbortController().signal },
    );

    expect(mockEnsurePage).toHaveBeenCalled();
    expect(mockPage.evaluate).toHaveBeenCalled();

    // Should pass selector as argument to evaluate
    const callArgs = mockPage.evaluate.mock.calls[0];
    expect(callArgs[1]).toBe("#target-element");

    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("#target-element");
    expect(result.isError).toBeFalsy();
  });

  it("returns error when element is not found", async () => {
    mockPage.evaluate.mockResolvedValue(false);

    const handler = getToolHandler(server, "browser_scroll_to_element");
    const result = await handler(
      { selector: "#nonexistent" },
      { signal: new AbortController().signal },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("#nonexistent");
  });

  it("returns error text when evaluate fails (does not throw)", async () => {
    mockPage.evaluate.mockRejectedValue(new Error("Execution context was destroyed"));
    const handler = getToolHandler(server, "browser_scroll_to_element");
    const result = await handler(
      { selector: "#target" },
      { signal: new AbortController().signal },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("Execution context was destroyed");
  });
});
