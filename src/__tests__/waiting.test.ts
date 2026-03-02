/**
 * Unit tests for waiting tools (src/tools/waiting.ts)
 *
 * All browser module interactions are mocked. These tests verify:
 * - All 3 tools are registered on the McpServer with correct names/descriptions/schemas
 * - browser_wait_for_selector waits for element visible/hidden state
 * - browser_wait_for_network_idle waits for network to settle
 * - browser_smart_wait calls smartWait and reports elapsed time
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

// Mock the wait-strategies module
const mockSmartWait = vi.fn();

vi.mock("../util/wait-strategies.js", () => ({
  smartWait: (...args: unknown[]) => mockSmartWait(...args),
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
  waitForSelector: ReturnType<typeof vi.fn>;
  waitForNetworkIdle: ReturnType<typeof vi.fn>;
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

beforeEach(async () => {
  vi.clearAllMocks();

  mockPage = {
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    waitForNetworkIdle: vi.fn().mockResolvedValue(undefined),
  };

  mockEnsurePage.mockResolvedValue(mockPage);
  mockSmartWait.mockResolvedValue({ elapsedMs: 1234 });

  // Create a fresh server and register tools for each test
  server = new McpServer({ name: "test-server", version: "1.0.0" });
  const { registerWaitingTools } = await import("../tools/waiting.js");
  registerWaitingTools(server);
});

// ── Tool Registration ───────────────────────────────────────────────────

describe("registerWaitingTools", () => {
  it("registers all 3 tools on the server", () => {
    const tools = getRegisteredTools(server);
    const toolNames = Object.keys(tools);

    expect(toolNames).toContain("browser_wait_for_selector");
    expect(toolNames).toContain("browser_wait_for_network_idle");
    expect(toolNames).toContain("browser_smart_wait");
  });

  it("each tool has a description", () => {
    const tools = getRegisteredTools(server);
    const waitingTools = [
      "browser_wait_for_selector",
      "browser_wait_for_network_idle",
      "browser_smart_wait",
    ];

    for (const name of waitingTools) {
      expect(tools[name].description, `Tool "${name}" should have a description`).toBeTruthy();
    }
  });
});

// ── browser_wait_for_selector ───────────────────────────────────────────

describe("browser_wait_for_selector", () => {
  it("waits for a selector to be visible by default", async () => {
    const handler = getToolHandler(server, "browser_wait_for_selector");
    const result = await handler(
      { selector: "#content" },
      { signal: new AbortController().signal },
    );

    expect(mockEnsurePage).toHaveBeenCalled();
    expect(mockPage.waitForSelector).toHaveBeenCalledWith(
      "#content",
      expect.objectContaining({ timeout: 30000 }),
    );
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("#content");
    expect(result.isError).toBeFalsy();
  });

  it("waits for selector to be visible when visible=true", async () => {
    const handler = getToolHandler(server, "browser_wait_for_selector");
    await handler(
      { selector: ".loader", visible: true },
      { signal: new AbortController().signal },
    );

    expect(mockPage.waitForSelector).toHaveBeenCalledWith(
      ".loader",
      expect.objectContaining({ visible: true }),
    );
  });

  it("waits for selector to be hidden when hidden=true", async () => {
    const handler = getToolHandler(server, "browser_wait_for_selector");
    await handler(
      { selector: ".loader", hidden: true },
      { signal: new AbortController().signal },
    );

    expect(mockPage.waitForSelector).toHaveBeenCalledWith(
      ".loader",
      expect.objectContaining({ hidden: true }),
    );
  });

  it("uses custom timeout", async () => {
    const handler = getToolHandler(server, "browser_wait_for_selector");
    await handler(
      { selector: "#content", timeout: 5000 },
      { signal: new AbortController().signal },
    );

    expect(mockPage.waitForSelector).toHaveBeenCalledWith(
      "#content",
      expect.objectContaining({ timeout: 5000 }),
    );
  });

  it("uses default timeout of 30000ms", async () => {
    const handler = getToolHandler(server, "browser_wait_for_selector");
    await handler(
      { selector: "#content" },
      { signal: new AbortController().signal },
    );

    expect(mockPage.waitForSelector).toHaveBeenCalledWith(
      "#content",
      expect.objectContaining({ timeout: 30000 }),
    );
  });

  it("returns error text when selector wait times out (does not throw)", async () => {
    mockPage.waitForSelector.mockRejectedValue(new Error("Timeout waiting for selector"));
    const handler = getToolHandler(server, "browser_wait_for_selector");
    const result = await handler(
      { selector: "#never-appears" },
      { signal: new AbortController().signal },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("Timeout waiting for selector");
  });
});

// ── browser_wait_for_network_idle ───────────────────────────────────────

describe("browser_wait_for_network_idle", () => {
  it("waits for network idle with default settings", async () => {
    const handler = getToolHandler(server, "browser_wait_for_network_idle");
    const result = await handler({}, { signal: new AbortController().signal });

    expect(mockEnsurePage).toHaveBeenCalled();
    expect(mockPage.waitForNetworkIdle).toHaveBeenCalledWith(
      expect.objectContaining({ idleTime: 500 }),
    );
    expect(result.content[0].type).toBe("text");
    expect(result.isError).toBeFalsy();
  });

  it("uses custom timeout", async () => {
    const handler = getToolHandler(server, "browser_wait_for_network_idle");
    await handler(
      { timeout: 10000 },
      { signal: new AbortController().signal },
    );

    expect(mockPage.waitForNetworkIdle).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 10000 }),
    );
  });

  it("uses custom idleTime", async () => {
    const handler = getToolHandler(server, "browser_wait_for_network_idle");
    await handler(
      { idleTime: 1000 },
      { signal: new AbortController().signal },
    );

    expect(mockPage.waitForNetworkIdle).toHaveBeenCalledWith(
      expect.objectContaining({ idleTime: 1000 }),
    );
  });

  it("defaults idleTime to 500ms when not specified", async () => {
    const handler = getToolHandler(server, "browser_wait_for_network_idle");
    await handler({}, { signal: new AbortController().signal });

    expect(mockPage.waitForNetworkIdle).toHaveBeenCalledWith(
      expect.objectContaining({ idleTime: 500 }),
    );
  });

  it("returns error text when network idle times out (does not throw)", async () => {
    mockPage.waitForNetworkIdle.mockRejectedValue(new Error("Network idle timeout"));
    const handler = getToolHandler(server, "browser_wait_for_network_idle");
    const result = await handler({}, { signal: new AbortController().signal });

    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("Network idle timeout");
  });
});

// ── browser_smart_wait ──────────────────────────────────────────────────

describe("browser_smart_wait", () => {
  it("calls smartWait with the page and default timeout", async () => {
    const handler = getToolHandler(server, "browser_smart_wait");
    const result = await handler({}, { signal: new AbortController().signal });

    expect(mockEnsurePage).toHaveBeenCalled();
    expect(mockSmartWait).toHaveBeenCalledWith(mockPage, undefined);
    expect(result.content[0].type).toBe("text");
    expect(result.isError).toBeFalsy();
  });

  it("passes custom timeout to smartWait", async () => {
    const handler = getToolHandler(server, "browser_smart_wait");
    await handler(
      { timeout: 5000 },
      { signal: new AbortController().signal },
    );

    expect(mockSmartWait).toHaveBeenCalledWith(mockPage, 5000);
  });

  it("reports elapsed time in the response", async () => {
    mockSmartWait.mockResolvedValue({ elapsedMs: 2500 });
    const handler = getToolHandler(server, "browser_smart_wait");
    const result = await handler({}, { signal: new AbortController().signal });

    expect(result.content[0].text).toContain("2500");
  });

  it("returns error text when smartWait fails (does not throw)", async () => {
    mockSmartWait.mockRejectedValue(new Error("Smart wait failed"));
    const handler = getToolHandler(server, "browser_smart_wait");
    const result = await handler({}, { signal: new AbortController().signal });

    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("Smart wait failed");
  });
});
