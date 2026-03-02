/**
 * Unit tests for flow tools (src/tools/flow.ts)
 *
 * All file system and FlowRunner interactions are mocked. These tests verify:
 * - All 3 tools are registered on the McpServer with correct names/descriptions
 * - browser_run_flow executes named flows from disk
 * - browser_run_flow executes inline flow definitions
 * - browser_run_flow validates flow definitions
 * - browser_list_flows lists JSON files with metadata
 * - browser_save_flow validates and persists flow definitions
 * - Error paths return error text with isError: true
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// ── Mock Setup ──────────────────────────────────────────────────────────

const mockReaddir = vi.fn();
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockMkdir = vi.fn();

vi.mock("node:fs/promises", () => ({
  readdir: (...args: unknown[]) => mockReaddir(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
}));

const mockFlowRunnerRun = vi.fn();

vi.mock("../flow/runner.js", () => ({
  FlowRunner: class {
    run = mockFlowRunnerRun;
  },
}));

vi.mock("../util/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    setLogLevel: vi.fn(),
  },
}));

// ── Test helpers ─────────────────────────────────────────────────────────

import { registerFlowTools } from "../tools/flow.js";

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}>;

function getRegisteredTools(server: McpServer): Map<string, ToolHandler> {
  const tools = new Map<string, ToolHandler>();
  const originalTool = server.tool.bind(server);

  // Replace server.tool to capture registrations
  server.tool = ((
    name: string,
    _description: string,
    _schema: Record<string, unknown>,
    handler: ToolHandler,
  ) => {
    tools.set(name, handler);
    return originalTool(name, _description, _schema, handler);
  }) as typeof server.tool;

  registerFlowTools(server);
  return tools;
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("Flow tools registration", () => {
  let server: McpServer;
  let tools: Map<string, ToolHandler>;

  beforeEach(() => {
    vi.clearAllMocks();
    server = new McpServer({ name: "test", version: "0.0.1" });
    tools = getRegisteredTools(server);
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  it("registers all 3 flow tools", () => {
    expect(tools.has("browser_run_flow")).toBe(true);
    expect(tools.has("browser_list_flows")).toBe(true);
    expect(tools.has("browser_save_flow")).toBe(true);
  });

  // ── browser_run_flow ───────────────────────────────────────────────

  describe("browser_run_flow", () => {
    const validFlow = {
      name: "test-flow",
      steps: [{ action: "navigate", url: "https://example.com" }],
    };

    const mockRunResult = {
      flowName: "test-flow",
      outputDir: "output/test-flow-2026-01-01",
      steps: [{ stepIndex: 0, action: "navigate", success: true, durationMs: 100 }],
      totalDurationMs: 150,
      manifestPath: "output/test-flow-2026-01-01/manifest.json",
    };

    it("executes an inline flow definition", async () => {
      mockFlowRunnerRun.mockResolvedValue(mockRunResult);
      const handler = tools.get("browser_run_flow")!;

      const result = await handler({ flow: validFlow });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("test-flow");
      expect(result.content[0].text).toContain("1 passed, 0 failed");
      expect(mockFlowRunnerRun).toHaveBeenCalled();
    });

    it("loads and executes a named flow from disk", async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(validFlow));
      mockFlowRunnerRun.mockResolvedValue(mockRunResult);
      const handler = tools.get("browser_run_flow")!;

      const result = await handler({ name: "test-flow" });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("test-flow");
      expect(mockReadFile).toHaveBeenCalledWith("flows/test-flow.json", "utf-8");
    });

    it("passes record override to runner", async () => {
      mockFlowRunnerRun.mockResolvedValue(mockRunResult);
      const handler = tools.get("browser_run_flow")!;

      await handler({ flow: validFlow, record: true });

      expect(mockFlowRunnerRun).toHaveBeenCalledWith(
        expect.objectContaining({ name: "test-flow" }),
        true,
      );
    });

    it("returns error for invalid inline flow", async () => {
      const handler = tools.get("browser_run_flow")!;

      const result = await handler({ flow: { steps: [] } });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Invalid flow definition");
    });

    it("returns error when named flow not found", async () => {
      mockReadFile.mockRejectedValue(new Error("ENOENT"));
      const handler = tools.get("browser_run_flow")!;

      const result = await handler({ name: "nonexistent" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Flow not found");
    });

    it("returns error when neither name nor flow provided", async () => {
      const handler = tools.get("browser_run_flow")!;

      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("provide either");
    });

    it("reports failed steps in output", async () => {
      mockFlowRunnerRun.mockResolvedValue({
        ...mockRunResult,
        steps: [
          { stepIndex: 0, action: "navigate", success: true, durationMs: 50 },
          { stepIndex: 1, action: "click", success: false, error: "Element not found", durationMs: 30 },
        ],
      });
      const handler = tools.get("browser_run_flow")!;

      const result = await handler({ flow: validFlow });

      expect(result.content[0].text).toContain("1 passed, 1 failed");
      expect(result.content[0].text).toContain("Element not found");
    });

    it("includes recording path when present", async () => {
      mockFlowRunnerRun.mockResolvedValue({
        ...mockRunResult,
        recordingPath: "output/test/recording.mp4",
      });
      const handler = tools.get("browser_run_flow")!;

      const result = await handler({ flow: validFlow });

      expect(result.content[0].text).toContain("recording.mp4");
    });

    it("catches runner exceptions", async () => {
      mockFlowRunnerRun.mockRejectedValue(new Error("Browser crashed"));
      const handler = tools.get("browser_run_flow")!;

      const result = await handler({ flow: validFlow });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Browser crashed");
    });
  });

  // ── browser_list_flows ─────────────────────────────────────────────

  describe("browser_list_flows", () => {
    it("lists flows with metadata", async () => {
      mockReaddir.mockResolvedValue(["my-flow.json", "other.json"]);
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes("my-flow")) {
          return JSON.stringify({
            name: "My Flow",
            description: "A test flow",
            steps: [{ action: "navigate", url: "https://example.com" }],
          });
        }
        return JSON.stringify({
          name: "Other Flow",
          steps: [
            { action: "navigate", url: "https://example.com" },
            { action: "screenshot", label: "test" },
          ],
        });
      });

      const handler = tools.get("browser_list_flows")!;
      const result = await handler({});

      const flows = JSON.parse(result.content[0].text);
      expect(flows).toHaveLength(2);
      expect(flows[0].name).toBe("My Flow");
      expect(flows[0].description).toBe("A test flow");
      expect(flows[0].steps).toBe(1);
      expect(flows[1].name).toBe("Other Flow");
      expect(flows[1].steps).toBe(2);
    });

    it("returns message when no flows exist", async () => {
      mockReaddir.mockResolvedValue([]);
      const handler = tools.get("browser_list_flows")!;

      const result = await handler({});

      expect(result.content[0].text).toContain("No flows found");
    });

    it("filters non-JSON files", async () => {
      mockReaddir.mockResolvedValue(["README.md", ".gitkeep", "flow.json"]);
      mockReadFile.mockResolvedValue(
        JSON.stringify({
          name: "Test",
          steps: [{ action: "navigate", url: "https://example.com" }],
        }),
      );

      const handler = tools.get("browser_list_flows")!;
      const result = await handler({});

      const flows = JSON.parse(result.content[0].text);
      expect(flows).toHaveLength(1);
    });

    it("handles unreadable flow files gracefully", async () => {
      mockReaddir.mockResolvedValue(["bad.json"]);
      mockReadFile.mockRejectedValue(new Error("Permission denied"));

      const handler = tools.get("browser_list_flows")!;
      const result = await handler({});

      const flows = JSON.parse(result.content[0].text);
      expect(flows).toHaveLength(1);
      expect(flows[0].name).toBe("(unreadable)");
    });

    it("handles invalid JSON in flow files", async () => {
      mockReaddir.mockResolvedValue(["invalid.json"]);
      mockReadFile.mockResolvedValue("{ bad json");

      const handler = tools.get("browser_list_flows")!;
      const result = await handler({});

      const flows = JSON.parse(result.content[0].text);
      expect(flows).toHaveLength(1);
      expect(flows[0].name).toBe("(unreadable)");
    });
  });

  // ── browser_save_flow ──────────────────────────────────────────────

  describe("browser_save_flow", () => {
    it("saves a valid flow definition", async () => {
      const handler = tools.get("browser_save_flow")!;
      const flow = {
        name: "My Test Flow",
        description: "Test",
        steps: [{ action: "navigate", url: "https://example.com" }],
      };

      const result = await handler({ flow });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("My Test Flow");
      expect(result.content[0].text).toContain("my_test_flow.json");
      expect(mockWriteFile).toHaveBeenCalled();
      expect(mockMkdir).toHaveBeenCalledWith("flows", { recursive: true });
    });

    it("rejects invalid flow definition", async () => {
      const handler = tools.get("browser_save_flow")!;

      const result = await handler({ flow: { name: "bad", steps: [] } });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Invalid flow definition");
    });

    it("sanitizes flow name for filename", async () => {
      const handler = tools.get("browser_save_flow")!;
      const flow = {
        name: "My Flow (v2) [test]",
        steps: [{ action: "navigate", url: "https://example.com" }],
      };

      const result = await handler({ flow });

      expect(result.content[0].text).toContain("my_flow__v2___test_");
    });

    it("catches file system errors", async () => {
      mockWriteFile.mockRejectedValue(new Error("Disk full"));
      const handler = tools.get("browser_save_flow")!;

      const result = await handler({
        flow: {
          name: "test",
          steps: [{ action: "navigate", url: "https://example.com" }],
        },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Disk full");
    });
  });
});
