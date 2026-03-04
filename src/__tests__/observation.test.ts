/**
 * Unit tests for observation tools (src/tools/observation.ts)
 *
 * All browser module interactions are mocked. These tests verify:
 * - All 4 tools are registered on the McpServer with correct names/descriptions/schemas
 * - browser_screenshot returns image content block (viewport, fullPage, selector, savePath)
 * - browser_a11y_snapshot returns compact tree text (default) or JSON (format: "json")
 * - browser_get_page_info returns URL, title, viewport, and scroll dimensions
 * - browser_get_text returns element innerText
 * - Error paths catch exceptions and return error text with isError: true (never throw)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// ── Mock Setup ──────────────────────────────────────────────────────────

// Mock the browser module
const mockEnsurePage = vi.fn();
const mockEnsureCDPSession = vi.fn();

vi.mock("../browser.js", () => ({
  ensurePage: (...args: unknown[]) => mockEnsurePage(...args),
  ensureCDPSession: (...args: unknown[]) => mockEnsureCDPSession(...args),
}));

// Mock the ref-store module
const mockClearRefs = vi.fn();
const mockAllocateRef = vi.fn();
const mockGetAllRefs = vi.fn();
const mockHasRefs = vi.fn();

vi.mock("../ref-store.js", () => ({
  clearRefs: (...args: unknown[]) => mockClearRefs(...args),
  allocateRef: (...args: unknown[]) => mockAllocateRef(...args),
  getAllRefs: (...args: unknown[]) => mockGetAllRefs(...args),
  hasRefs: (...args: unknown[]) => mockHasRefs(...args),
}));

// Mock the cdp-helpers module (used by annotated screenshot)
const mockBatchGetBoundingBoxes = vi.fn();

vi.mock("../cdp-helpers.js", () => ({
  batchGetBoundingBoxes: (...args: unknown[]) => mockBatchGetBoundingBoxes(...args),
}));

// Mock node:fs/promises for non-savePath tests (e.g. writeFile used by a11y, etc.)
const mockWriteFile = vi.fn();
const mockMkdir = vi.fn();
const mockRealpath = vi.fn();

vi.mock("node:fs/promises", () => ({
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  realpath: (...args: unknown[]) => mockRealpath(...args),
}));

// Mock the path-confinement module (used by screenshot savePath logic)
const mockConfinePath = vi.fn();
const mockSafeWriteFile = vi.fn();

vi.mock("../util/path-confinement.js", () => ({
  resolveConfigDir: (_envVar: string, defaultPath: string) => {
    // Use env var if set, else default — mirrors real implementation
    const raw = process.env.SCREENSHOT_DIR ?? defaultPath;
    // Simple resolve for testing
    return raw.startsWith("/") ? raw : `/cwd/${raw}`;
  },
  confinePath: (...args: unknown[]) => mockConfinePath(...args),
  safeWriteFile: (...args: unknown[]) => mockSafeWriteFile(...args),
}));

// Mock page object used by tools
interface MockElement {
  screenshot: ReturnType<typeof vi.fn>;
}

interface MockPage {
  url: ReturnType<typeof vi.fn>;
  title: ReturnType<typeof vi.fn>;
  screenshot: ReturnType<typeof vi.fn>;
  viewport: ReturnType<typeof vi.fn>;
  evaluate: ReturnType<typeof vi.fn>;
  $: ReturnType<typeof vi.fn>;
  $eval: ReturnType<typeof vi.fn>;
  accessibility: {
    snapshot: ReturnType<typeof vi.fn>;
  };
}

let mockPage: MockPage;
let mockElement: MockElement;

// ── Helpers ─────────────────────────────────────────────────────────────

// Internal type for accessing McpServer's private _registeredTools (plain object, not Map)
type RegisteredToolsMap = Record<string, { handler: Function; description?: string }>;

/**
 * Extract the registered tool handler from a McpServer instance.
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

// Base64 PNG stub (1x1 transparent pixel)
const FAKE_SCREENSHOT_BUFFER = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGP6/x8AAwAB/auKfQAAAABJRU5ErkJggg==", "base64");
const FAKE_SCREENSHOT_BASE64 = FAKE_SCREENSHOT_BUFFER.toString("base64");

const originalScreenshotDir = process.env.SCREENSHOT_DIR;

afterEach(() => {
  if (originalScreenshotDir === undefined) {
    delete process.env.SCREENSHOT_DIR;
  } else {
    process.env.SCREENSHOT_DIR = originalScreenshotDir;
  }
});

beforeEach(async () => {
  vi.clearAllMocks();

  mockElement = {
    screenshot: vi.fn().mockImplementation((opts?: { encoding?: string }) => {
      if (opts?.encoding === "base64") {
        return Promise.resolve(FAKE_SCREENSHOT_BASE64);
      }
      return Promise.resolve(FAKE_SCREENSHOT_BUFFER);
    }),
  };

  mockPage = {
    url: vi.fn().mockReturnValue("https://example.com/page"),
    title: vi.fn().mockResolvedValue("Example Page"),
    screenshot: vi.fn().mockImplementation((opts?: { encoding?: string }) => {
      if (opts?.encoding === "base64") {
        return Promise.resolve(FAKE_SCREENSHOT_BASE64);
      }
      return Promise.resolve(FAKE_SCREENSHOT_BUFFER);
    }),
    viewport: vi.fn().mockReturnValue({ width: 1280, height: 720 }),
    evaluate: vi.fn().mockResolvedValue({ scrollWidth: 1280, scrollHeight: 3000 }),
    $: vi.fn().mockResolvedValue(mockElement),
    $eval: vi.fn().mockResolvedValue("Hello World"),
    accessibility: {
      snapshot: vi.fn().mockResolvedValue({
        role: "WebArea",
        name: "Example Page",
        backendNodeId: 1,
        loaderId: "loader-abc",
        children: [
          { role: "heading", name: "Welcome", level: 1, backendNodeId: 2 },
          { role: "link", name: "Click me", backendNodeId: 3, loaderId: "loader-abc" },
        ],
      }),
    },
  };

  mockEnsurePage.mockResolvedValue(mockPage);
  // Mock CDP session for annotated screenshot overlay injection/removal
  const mockCDPSend = vi.fn().mockResolvedValue(undefined);
  mockEnsureCDPSession.mockResolvedValue({ send: mockCDPSend });
  mockWriteFile.mockResolvedValue(undefined);
  mockMkdir.mockResolvedValue(undefined);
  mockSafeWriteFile.mockResolvedValue(undefined);
  // By default, realpath returns the path unchanged (no symlinks)
  mockRealpath.mockImplementation((p: string) => Promise.resolve(p));
  // By default, confinePath succeeds — returns the resolved path as-is
  mockConfinePath.mockImplementation((filePath: string) =>
    Promise.resolve({ resolvedPath: filePath.startsWith("/") ? filePath : `/cwd/${filePath}` }),
  );

  // allocateRef returns sequential ref IDs ("e1", "e2", ...)
  let refCounter = 0;
  mockAllocateRef.mockImplementation(() => {
    refCounter += 1;
    return `e${refCounter}`;
  });

  // Default: no refs available (for annotated screenshot tests)
  mockHasRefs.mockReturnValue(false);
  mockGetAllRefs.mockReturnValue(new Map());
  mockBatchGetBoundingBoxes.mockResolvedValue(new Map());

  // Create a fresh server and register tools for each test
  server = new McpServer({ name: "test-server", version: "1.0.0" });
  const { registerObservationTools } = await import("../tools/observation.js");
  registerObservationTools(server);
});

// ── Tool Registration ───────────────────────────────────────────────────

describe("registerObservationTools", () => {
  it("registers all 4 tools on the server", () => {
    const tools = getRegisteredTools(server);
    const toolNames = Object.keys(tools);

    expect(toolNames).toContain("browser_screenshot");
    expect(toolNames).toContain("browser_a11y_snapshot");
    expect(toolNames).toContain("browser_get_page_info");
    expect(toolNames).toContain("browser_get_text");
  });

  it("each tool has a description", () => {
    const tools = getRegisteredTools(server);
    const observationTools = ["browser_screenshot", "browser_a11y_snapshot", "browser_get_page_info", "browser_get_text"];

    for (const name of observationTools) {
      expect(tools[name].description, `Tool "${name}" should have a description`).toBeTruthy();
    }
  });
});

// ── browser_screenshot ──────────────────────────────────────────────────

describe("browser_screenshot", () => {
  it("takes a viewport screenshot by default and returns image content block", async () => {
    const handler = getToolHandler(server, "browser_screenshot");
    const result = await handler({}, { signal: new AbortController().signal });

    expect(mockEnsurePage).toHaveBeenCalled();
    expect(mockPage.screenshot).toHaveBeenCalledWith(
      expect.objectContaining({ encoding: "base64" }),
    );
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("image");
    expect(result.content[0].mimeType).toBe("image/png");
    expect(typeof result.content[0].data).toBe("string");
    // data should be valid base64
    expect(result.content[0].data.length).toBeGreaterThan(0);
  });

  it("passes fullPage option to page.screenshot", async () => {
    const handler = getToolHandler(server, "browser_screenshot");
    await handler({ fullPage: true }, { signal: new AbortController().signal });

    expect(mockPage.screenshot).toHaveBeenCalledWith(
      expect.objectContaining({ fullPage: true, encoding: "base64" }),
    );
  });

  it("screenshots a specific element when selector is provided", async () => {
    const handler = getToolHandler(server, "browser_screenshot");
    const result = await handler(
      { selector: "#main-content" },
      { signal: new AbortController().signal },
    );

    expect(mockPage.$).toHaveBeenCalledWith("#main-content");
    expect(mockElement.screenshot).toHaveBeenCalledWith({ encoding: "base64" });
    expect(result.content[0].type).toBe("image");
    expect(result.content[0].mimeType).toBe("image/png");
  });

  it("returns error when selector element is not found", async () => {
    mockPage.$.mockResolvedValue(null);
    const handler = getToolHandler(server, "browser_screenshot");
    const result = await handler(
      { selector: "#nonexistent" },
      { signal: new AbortController().signal },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("#nonexistent");
  });

  it("saves screenshot to disk when savePath is within allowed directory", async () => {
    const handler = getToolHandler(server, "browser_screenshot");
    const result = await handler(
      { savePath: "/tmp/screen-cap-screenshots/test.png" },
      { signal: new AbortController().signal },
    );

    expect(mockConfinePath).toHaveBeenCalledWith(
      "/tmp/screen-cap-screenshots/test.png",
      expect.stringContaining("screen-cap-screenshots"),
    );
    expect(mockSafeWriteFile).toHaveBeenCalledWith(
      "/tmp/screen-cap-screenshots/test.png",
      expect.any(Buffer),
    );
    // Should still return the image content block
    expect(result.content[0].type).toBe("image");
  });

  it("rejects savePath outside allowed directory", async () => {
    mockConfinePath.mockResolvedValue({ error: "Path must be within /tmp/screen-cap-screenshots" });
    const handler = getToolHandler(server, "browser_screenshot");
    const result = await handler(
      { savePath: "/etc/evil.png" },
      { signal: new AbortController().signal },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Path must be within");
    expect(mockSafeWriteFile).not.toHaveBeenCalled();
  });

  it("rejects savePath with directory traversal", async () => {
    mockConfinePath.mockResolvedValue({ error: "Path must be within /tmp/screen-cap-screenshots" });
    const handler = getToolHandler(server, "browser_screenshot");
    const result = await handler(
      { savePath: "/tmp/screen-cap-screenshots/../../etc/evil.png" },
      { signal: new AbortController().signal },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Path must be within");
    expect(mockSafeWriteFile).not.toHaveBeenCalled();
  });

  it("rejects savePath when realpath reveals symlink escape", async () => {
    mockConfinePath.mockResolvedValue({ error: "Path must be within /tmp/screen-cap-screenshots (symlink detected)" });

    const handler = getToolHandler(server, "browser_screenshot");
    const result = await handler(
      { savePath: "/tmp/screen-cap-screenshots/escape/evil.png" },
      { signal: new AbortController().signal },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("symlink detected");
    expect(mockSafeWriteFile).not.toHaveBeenCalled();
  });

  it("respects SCREENSHOT_DIR env var", async () => {
    process.env.SCREENSHOT_DIR = "/custom/screenshots";
    const handler = getToolHandler(server, "browser_screenshot");

    // Path within custom dir should work
    const result = await handler(
      { savePath: "/custom/screenshots/shot.png" },
      { signal: new AbortController().signal },
    );
    expect(result.content[0].type).toBe("image");
    expect(mockConfinePath).toHaveBeenCalledWith(
      "/custom/screenshots/shot.png",
      "/custom/screenshots",
    );
    expect(mockSafeWriteFile).toHaveBeenCalled();
  });

  it("returns error text when screenshot fails (does not throw)", async () => {
    mockPage.screenshot.mockRejectedValue(new Error("Page crashed"));
    const handler = getToolHandler(server, "browser_screenshot");
    const result = await handler({}, { signal: new AbortController().signal });

    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("Page crashed");
  });

  it("returns error text when savePath write fails", async () => {
    mockSafeWriteFile.mockRejectedValue(new Error("Permission denied"));
    const handler = getToolHandler(server, "browser_screenshot");
    const result = await handler(
      { savePath: "/tmp/screen-cap-screenshots/readonly.png" },
      { signal: new AbortController().signal },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("Permission denied");
  });

  // ── annotate mode ───────────────────────────────────────────────────

  describe("annotate: true", () => {
    it("returns error text when no refs exist (no a11y snapshot taken)", async () => {
      mockHasRefs.mockReturnValue(false);
      const handler = getToolHandler(server, "browser_screenshot");
      const result = await handler(
        { annotate: true },
        { signal: new AbortController().signal },
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].type).toBe("text");
      expect(result.content[0].text).toContain("No refs available");
      expect(result.content[0].text).toContain("browser_a11y_snapshot");
      // Should NOT take a screenshot at all
      expect(mockPage.screenshot).not.toHaveBeenCalled();
    });

    it("injects overlay, takes screenshot, and removes overlay when refs exist", async () => {
      // Set up refs: e1 -> backendNodeId 10, e5 -> backendNodeId 50
      mockHasRefs.mockReturnValue(true);
      mockGetAllRefs.mockReturnValue(new Map([
        ["e1", 10],
        ["e5", 50],
      ]));
      // Both elements are visible (have bounding boxes)
      mockBatchGetBoundingBoxes.mockResolvedValue(new Map([
        [10, { x: 100, y: 200, width: 80, height: 30 }],
        [50, { x: 400, y: 300, width: 120, height: 40 }],
      ]));

      const mockCDPSend = vi.fn().mockResolvedValue(undefined);
      mockEnsureCDPSession.mockResolvedValue({ send: mockCDPSend });

      const handler = getToolHandler(server, "browser_screenshot");
      const result = await handler(
        { annotate: true },
        { signal: new AbortController().signal },
      );

      // Should have called getAllRefs to get ref->backendNodeId mapping
      expect(mockGetAllRefs).toHaveBeenCalled();
      // Should have called batchGetBoundingBoxes with all backendNodeIds
      expect(mockBatchGetBoundingBoxes).toHaveBeenCalledWith([10, 50]);
      // Should have called CDP Runtime.evaluate twice (inject then remove)
      expect(mockCDPSend).toHaveBeenCalledWith("Runtime.evaluate", expect.objectContaining({
        expression: expect.stringContaining("__scm_annotation_overlay"),
      }));
      // Screenshot should have been taken
      expect(mockPage.screenshot).toHaveBeenCalled();
      // Should return image content block
      expect(result.content[0].type).toBe("image");
      expect(result.content[0].mimeType).toBe("image/png");
      // Verify overlay removal was called (second Runtime.evaluate call)
      const cdpCalls = mockCDPSend.mock.calls.filter(
        (call: unknown[]) => call[0] === "Runtime.evaluate",
      );
      expect(cdpCalls.length).toBe(2);
      // Second call should remove the overlay
      expect(cdpCalls[1][1].expression).toContain("remove");
    });

    it("excludes off-screen elements (null bounding box) from overlay", async () => {
      mockHasRefs.mockReturnValue(true);
      mockGetAllRefs.mockReturnValue(new Map([
        ["e1", 10],
        ["e2", 20],
        ["e3", 30],
      ]));
      // Only e1 is visible; e2 is off-screen (null), e3 is also off-screen
      mockBatchGetBoundingBoxes.mockResolvedValue(new Map([
        [10, { x: 100, y: 200, width: 80, height: 30 }],
        [20, null],
        [30, null],
      ]));

      const mockCDPSend = vi.fn().mockResolvedValue(undefined);
      mockEnsureCDPSession.mockResolvedValue({ send: mockCDPSend });

      const handler = getToolHandler(server, "browser_screenshot");
      const result = await handler(
        { annotate: true },
        { signal: new AbortController().signal },
      );

      // Should still produce a screenshot
      expect(result.content[0].type).toBe("image");
      // The inject call's expression should contain only the visible ref "e1"
      const injectCall = mockCDPSend.mock.calls.find(
        (call: unknown[]) =>
          call[0] === "Runtime.evaluate" &&
          (call[1] as { expression: string }).expression.includes("__scm_annotation_overlay"),
      );
      expect(injectCall).toBeTruthy();
      const expr = (injectCall![1] as { expression: string }).expression;
      expect(expr).toContain("e1");
      // e2 and e3 should not appear in the label data
      expect(expr).not.toContain('"e2"');
      expect(expr).not.toContain('"e3"');
    });

    it("takes normal screenshot with text note when all elements are off-screen", async () => {
      mockHasRefs.mockReturnValue(true);
      mockGetAllRefs.mockReturnValue(new Map([
        ["e1", 10],
        ["e2", 20],
      ]));
      // All elements are off-screen
      mockBatchGetBoundingBoxes.mockResolvedValue(new Map([
        [10, null],
        [20, null],
      ]));

      const handler = getToolHandler(server, "browser_screenshot");
      const result = await handler(
        { annotate: true },
        { signal: new AbortController().signal },
      );

      // Should return image (normal screenshot) plus a text note
      const imageContent = result.content.find((c: { type: string }) => c.type === "image");
      const textContent = result.content.find((c: { type: string }) => c.type === "text");
      expect(imageContent).toBeTruthy();
      expect(textContent).toBeTruthy();
      expect(textContent.text).toContain("off-screen");
    });

    it("cleans up overlay even if screenshot fails", async () => {
      mockHasRefs.mockReturnValue(true);
      mockGetAllRefs.mockReturnValue(new Map([
        ["e1", 10],
      ]));
      mockBatchGetBoundingBoxes.mockResolvedValue(new Map([
        [10, { x: 100, y: 200, width: 80, height: 30 }],
      ]));

      const mockCDPSend = vi.fn().mockResolvedValue(undefined);
      mockEnsureCDPSession.mockResolvedValue({ send: mockCDPSend });
      // Screenshot throws an error
      mockPage.screenshot.mockRejectedValue(new Error("Screenshot failed"));

      const handler = getToolHandler(server, "browser_screenshot");
      const result = await handler(
        { annotate: true },
        { signal: new AbortController().signal },
      );

      // Should return error
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Screenshot failed");
      // Overlay removal should still have been called (cleanup in finally block)
      const removeCalls = mockCDPSend.mock.calls.filter(
        (call: unknown[]) =>
          call[0] === "Runtime.evaluate" &&
          (call[1] as { expression: string }).expression.includes("remove"),
      );
      expect(removeCalls.length).toBeGreaterThanOrEqual(1);
    });

    it("does not use ALLOW_EVALUATE gating for overlay injection", async () => {
      // The overlay injection is an internal operation and should work
      // regardless of any ALLOW_EVALUATE setting
      mockHasRefs.mockReturnValue(true);
      mockGetAllRefs.mockReturnValue(new Map([["e1", 10]]));
      mockBatchGetBoundingBoxes.mockResolvedValue(new Map([
        [10, { x: 50, y: 50, width: 60, height: 20 }],
      ]));

      const mockCDPSend = vi.fn().mockResolvedValue(undefined);
      mockEnsureCDPSession.mockResolvedValue({ send: mockCDPSend });

      const handler = getToolHandler(server, "browser_screenshot");
      const result = await handler(
        { annotate: true },
        { signal: new AbortController().signal },
      );

      // Should succeed and use CDP Runtime.evaluate directly (not page.evaluate)
      expect(result.content[0].type).toBe("image");
      expect(mockCDPSend).toHaveBeenCalledWith(
        "Runtime.evaluate",
        expect.anything(),
      );
      // page.evaluate should NOT have been called for overlay operations
      // (page.evaluate might be gated by ALLOW_EVALUATE, but CDP Runtime.evaluate is not)
      expect(mockPage.evaluate).not.toHaveBeenCalled();
    });
  });

  describe("annotate: false / omitted (no regression)", () => {
    it("annotate: false produces normal screenshot (same as omitted)", async () => {
      const handler = getToolHandler(server, "browser_screenshot");
      const result = await handler(
        { annotate: false },
        { signal: new AbortController().signal },
      );

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("image");
      // Should not call any ref-store or CDP session methods
      expect(mockGetAllRefs).not.toHaveBeenCalled();
      expect(mockBatchGetBoundingBoxes).not.toHaveBeenCalled();
      expect(mockEnsureCDPSession).not.toHaveBeenCalled();
    });

    it("omitting annotate produces normal screenshot (no annotation)", async () => {
      const handler = getToolHandler(server, "browser_screenshot");
      const result = await handler(
        {},
        { signal: new AbortController().signal },
      );

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("image");
      // Should not call any annotation-related methods
      expect(mockGetAllRefs).not.toHaveBeenCalled();
      expect(mockBatchGetBoundingBoxes).not.toHaveBeenCalled();
    });
  });
});

// ── browser_a11y_snapshot ───────────────────────────────────────────────

describe("browser_a11y_snapshot", () => {
  it("returns compact tree text by default with interestingOnly true", async () => {
    const handler = getToolHandler(server, "browser_a11y_snapshot");
    const result = await handler({}, { signal: new AbortController().signal });

    expect(mockEnsurePage).toHaveBeenCalled();
    expect(mockPage.accessibility.snapshot).toHaveBeenCalledWith(
      expect.objectContaining({ interestingOnly: true }),
    );
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");

    const text = result.content[0].text;
    // Default format is compact tree text, not JSON
    expect(() => JSON.parse(text)).toThrow(); // Not valid JSON
    // Should contain ref IDs prominently at start of lines
    expect(text).toContain("[e1]");
    expect(text).toContain("[e2]");
    expect(text).toContain("[e3]");
    // Should contain roles and names
    expect(text).toContain("WebArea");
    expect(text).toContain("Welcome");
    expect(text).toContain("Click me");
  });

  it("annotates nodes with ref IDs from allocateRef", async () => {
    const handler = getToolHandler(server, "browser_a11y_snapshot");
    await handler({}, { signal: new AbortController().signal });

    // Root and two children each have backendNodeId, so 3 refs allocated
    expect(mockAllocateRef).toHaveBeenCalledTimes(3);
    expect(mockAllocateRef).toHaveBeenCalledWith(1); // root backendNodeId
    expect(mockAllocateRef).toHaveBeenCalledWith(2); // heading backendNodeId
    expect(mockAllocateRef).toHaveBeenCalledWith(3); // link backendNodeId
  });

  it("strips backendNodeId and loaderId from tree output", async () => {
    const handler = getToolHandler(server, "browser_a11y_snapshot");
    const result = await handler({}, { signal: new AbortController().signal });

    const text = result.content[0].text;
    // Internal fields should not appear in compact tree output
    expect(text).not.toContain("backendNodeId");
    expect(text).not.toContain("loaderId");
  });

  it("calls clearRefs at the start of each snapshot", async () => {
    const handler = getToolHandler(server, "browser_a11y_snapshot");
    await handler({}, { signal: new AbortController().signal });

    expect(mockClearRefs).toHaveBeenCalledTimes(1);
    // clearRefs should be called before allocateRef
    const clearRefsOrder = mockClearRefs.mock.invocationCallOrder[0];
    const firstAllocateOrder = mockAllocateRef.mock.invocationCallOrder[0];
    expect(clearRefsOrder).toBeLessThan(firstAllocateOrder);
  });

  it("handles nodes without backendNodeId (no ref assigned)", async () => {
    mockPage.accessibility.snapshot.mockResolvedValue({
      role: "WebArea",
      name: "Simple Page",
      children: [
        { role: "text", name: "Plain text" }, // no backendNodeId
      ],
    });

    const handler = getToolHandler(server, "browser_a11y_snapshot");
    const result = await handler({}, { signal: new AbortController().signal });

    const text = result.content[0].text;
    // No refs should be in the output
    expect(text).not.toContain("[e");
    // But roles and names should still appear
    expect(text).toContain("WebArea");
    expect(text).toContain("Plain text");
    // allocateRef should not have been called
    expect(mockAllocateRef).not.toHaveBeenCalled();
  });

  it("truncates very large a11y trees (tree format)", async () => {
    // Create a large fake a11y tree with unique role names to avoid sibling truncation
    const largeTree = {
      role: "WebArea",
      name: "Large Page",
      children: Array.from({ length: 50000 }, (_, i) => ({
        role: `paragraph-${i}`,
        name: `Paragraph ${i} with some content to make it larger and fill up the output buffer`,
      })),
    };
    mockPage.accessibility.snapshot.mockResolvedValue(largeTree);

    const handler = getToolHandler(server, "browser_a11y_snapshot");
    const result = await handler({}, { signal: new AbortController().signal });

    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("... (truncated, total");
    expect(result.content[0].text.length).toBeLessThanOrEqual(512_000 + 100); // MAX + truncation message
  });

  it("passes interestingOnly false when explicitly set", async () => {
    const handler = getToolHandler(server, "browser_a11y_snapshot");
    await handler(
      { interestingOnly: false },
      { signal: new AbortController().signal },
    );

    expect(mockPage.accessibility.snapshot).toHaveBeenCalledWith(
      expect.objectContaining({ interestingOnly: false }),
    );
  });

  it("handles null snapshot gracefully", async () => {
    mockPage.accessibility.snapshot.mockResolvedValue(null);
    const handler = getToolHandler(server, "browser_a11y_snapshot");
    const result = await handler({}, { signal: new AbortController().signal });
    expect(result.content[0].text).toBe("null");
    expect(result.isError).toBeFalsy();
  });

  it("returns error text when a11y snapshot fails (does not throw)", async () => {
    mockPage.accessibility.snapshot.mockRejectedValue(new Error("Accessibility not available"));
    const handler = getToolHandler(server, "browser_a11y_snapshot");
    const result = await handler({}, { signal: new AbortController().signal });

    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("Accessibility not available");
  });

  it("tool description mentions ref IDs and compact format", () => {
    const tools = getRegisteredTools(server);
    const description = tools["browser_a11y_snapshot"].description ?? "";
    expect(description).toContain("ref");
    expect(description).toContain("compact");
  });

  // ── format: "json" backward compatibility ───────────────────────────

  it('format: "json" returns parseable JSON (backward compatibility)', async () => {
    const handler = getToolHandler(server, "browser_a11y_snapshot");
    const result = await handler(
      { format: "json" },
      { signal: new AbortController().signal },
    );

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");

    // Result should be parseable JSON
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.role).toBe("WebArea");
    expect(parsed.children).toHaveLength(2);
    // Verify ref IDs are present on annotated nodes
    expect(parsed.ref).toBe("e1");
    expect(parsed.children[0].ref).toBe("e2");
    expect(parsed.children[1].ref).toBe("e3");
    // Verify it's compact JSON (no indentation newlines)
    expect(result.content[0].text).not.toContain("\n");
  });

  it('format: "json" strips backendNodeId and loaderId', async () => {
    const handler = getToolHandler(server, "browser_a11y_snapshot");
    const result = await handler(
      { format: "json" },
      { signal: new AbortController().signal },
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).not.toHaveProperty("backendNodeId");
    expect(parsed.children[0]).not.toHaveProperty("backendNodeId");
    expect(parsed.children[1]).not.toHaveProperty("backendNodeId");
    expect(parsed).not.toHaveProperty("loaderId");
    expect(parsed.children[1]).not.toHaveProperty("loaderId");
  });

  it('format: "json" truncates very large trees', async () => {
    const largeTree = {
      role: "WebArea",
      name: "Large Page",
      children: Array.from({ length: 50000 }, (_, i) => ({
        role: "paragraph",
        name: `Paragraph ${i} with some content to make it larger`,
      })),
    };
    mockPage.accessibility.snapshot.mockResolvedValue(largeTree);

    const handler = getToolHandler(server, "browser_a11y_snapshot");
    const result = await handler(
      { format: "json" },
      { signal: new AbortController().signal },
    );

    expect(result.content[0].text).toContain("... (truncated, total");
    expect(result.content[0].text.length).toBeLessThanOrEqual(512_000 + 100);
  });

  // ── format: "tree" (explicit) ───────────────────────────────────────

  it('format: "tree" returns compact tree text (same as default)', async () => {
    const handler = getToolHandler(server, "browser_a11y_snapshot");
    const resultDefault = await handler({}, { signal: new AbortController().signal });

    // Reset mocks and get a fresh snapshot for the explicit tree format
    vi.clearAllMocks();
    let refCounter = 0;
    mockAllocateRef.mockImplementation(() => {
      refCounter += 1;
      return `e${refCounter}`;
    });
    mockEnsurePage.mockResolvedValue(mockPage);

    const resultTree = await handler(
      { format: "tree" },
      { signal: new AbortController().signal },
    );

    // Both should produce tree text (not JSON)
    expect(() => JSON.parse(resultDefault.content[0].text)).toThrow();
    expect(() => JSON.parse(resultTree.content[0].text)).toThrow();
  });

  // ── maxDepth parameter ──────────────────────────────────────────────

  it("maxDepth limits tree depth in output", async () => {
    mockPage.accessibility.snapshot.mockResolvedValue({
      role: "WebArea",
      name: "Page",
      backendNodeId: 1,
      children: [
        {
          role: "navigation",
          name: "Nav",
          backendNodeId: 2,
          children: [
            { role: "link", name: "Home", backendNodeId: 3 },
            { role: "link", name: "About", backendNodeId: 4 },
          ],
        },
      ],
    });

    const handler = getToolHandler(server, "browser_a11y_snapshot");
    const result = await handler(
      { maxDepth: 1 },
      { signal: new AbortController().signal },
    );

    const text = result.content[0].text;
    // Root and its direct children should be visible
    expect(text).toContain("WebArea");
    expect(text).toContain("Nav");
    // Grandchildren should be replaced with child count
    expect(text).toContain("... 2 children");
    // The actual grandchildren should NOT appear as their own lines
    expect(text).not.toContain('link "Home"');
    expect(text).not.toContain('link "About"');
  });

  it("maxDepth is ignored for format: json", async () => {
    const handler = getToolHandler(server, "browser_a11y_snapshot");
    const result = await handler(
      { format: "json", maxDepth: 0 },
      { signal: new AbortController().signal },
    );

    // JSON format ignores maxDepth — full tree is returned
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.role).toBe("WebArea");
    expect(parsed.children).toHaveLength(2);
  });
});

// ── annotateTreeWithRefs (exported helper) ─────────────────────────────

describe("annotateTreeWithRefs", () => {
  it("assigns ref IDs to nodes with backendNodeId and strips internal fields", async () => {
    const { annotateTreeWithRefs } = await import("../tools/observation.js");

    const tree = {
      role: "RootWebArea",
      name: "My App",
      backendNodeId: 10,
      loaderId: "loader-xyz",
      children: [
        { role: "link", name: "Dashboard", backendNodeId: 20 },
        { role: "combobox", name: "Filter", value: "All", backendNodeId: 30, loaderId: "loader-xyz" },
      ],
    };

    annotateTreeWithRefs(tree);

    // Ref IDs assigned (mutated in-place)
    expect((tree as Record<string, unknown>).ref).toBe("e1");
    expect((tree.children[0] as Record<string, unknown>).ref).toBe("e2");
    expect((tree.children[1] as Record<string, unknown>).ref).toBe("e3");

    // Internal fields stripped
    expect(tree).not.toHaveProperty("backendNodeId");
    expect(tree).not.toHaveProperty("loaderId");
    expect(tree.children[0]).not.toHaveProperty("backendNodeId");
    expect(tree.children[1]).not.toHaveProperty("backendNodeId");
    expect(tree.children[1]).not.toHaveProperty("loaderId");

    // Original fields preserved
    expect(tree.role).toBe("RootWebArea");
    expect(tree.name).toBe("My App");
    expect((tree.children[1] as Record<string, unknown>).value).toBe("All");
  });

  it("skips ref assignment for nodes without backendNodeId", async () => {
    const { annotateTreeWithRefs } = await import("../tools/observation.js");

    const tree = {
      role: "text",
      name: "Just text",
    };

    annotateTreeWithRefs(tree);

    expect(tree).not.toHaveProperty("ref");
    expect(mockAllocateRef).not.toHaveBeenCalled();
  });
});

// ── browser_get_page_info ───────────────────────────────────────────────

describe("browser_get_page_info", () => {
  it("returns URL, title, viewport dimensions, and scroll dimensions", async () => {
    const handler = getToolHandler(server, "browser_get_page_info");
    const result = await handler({}, { signal: new AbortController().signal });

    expect(mockEnsurePage).toHaveBeenCalled();
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");

    const text = result.content[0].text;
    expect(text).toContain("https://example.com/page");
    expect(text).toContain("Example Page");
    expect(text).toContain("1280");
    expect(text).toContain("720");
    expect(text).toContain("3000");
  });

  it("handles null viewport gracefully", async () => {
    mockPage.viewport.mockReturnValue(null);
    const handler = getToolHandler(server, "browser_get_page_info");
    const result = await handler({}, { signal: new AbortController().signal });

    expect(result.content[0].type).toBe("text");
    expect(result.isError).toBeFalsy();
    // Should still contain URL and title even without viewport
    expect(result.content[0].text).toContain("https://example.com/page");
    expect(result.content[0].text).toContain("Example Page");
  });

  it("returns error text when page info fails (does not throw)", async () => {
    mockEnsurePage.mockRejectedValue(new Error("Not connected"));
    const handler = getToolHandler(server, "browser_get_page_info");
    const result = await handler({}, { signal: new AbortController().signal });

    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("Not connected");
  });
});

// ── browser_get_text ────────────────────────────────────────────────────

describe("browser_get_text", () => {
  it("returns innerText of the specified element", async () => {
    const handler = getToolHandler(server, "browser_get_text");
    const result = await handler(
      { selector: "#content" },
      { signal: new AbortController().signal },
    );

    expect(mockEnsurePage).toHaveBeenCalled();
    expect(mockPage.$eval).toHaveBeenCalledWith(
      "#content",
      expect.any(Function),
    );
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toBe("Hello World");
  });

  it("truncates very large text content", async () => {
    const largeText = "x".repeat(600_000);
    mockPage.$eval.mockResolvedValue(largeText);

    const handler = getToolHandler(server, "browser_get_text");
    const result = await handler(
      { selector: "body" },
      { signal: new AbortController().signal },
    );

    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("... (truncated, total 600000 chars)");
    expect(result.content[0].text.length).toBeLessThanOrEqual(512_000 + 100);
  });

  it("returns error text when selector is not found (does not throw)", async () => {
    mockPage.$eval.mockRejectedValue(new Error("Element not found for selector: #missing"));
    const handler = getToolHandler(server, "browser_get_text");
    const result = await handler(
      { selector: "#missing" },
      { signal: new AbortController().signal },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("#missing");
  });
});
