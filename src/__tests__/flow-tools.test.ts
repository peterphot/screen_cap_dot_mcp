/**
 * Unit tests for flow tools (src/tools/flow.ts)
 *
 * All file system and FlowRunner/FlowValidator interactions are mocked. These tests verify:
 * - All 4 tools are registered on the McpServer with correct names/descriptions
 * - browser_run_flow executes named flows from disk
 * - browser_run_flow executes inline flow definitions
 * - browser_run_flow validates flow definitions
 * - browser_validate_flow dry-runs named or inline flows without executing actions
 * - browser_validate_flow returns structured pass/fail reports
 * - browser_list_flows lists JSON files with metadata
 * - browser_save_flow validates and persists flow definitions
 * - Error paths return error text with isError: true
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// ── Mock Setup ──────────────────────────────────────────────────────────

const mockReaddir = vi.fn();
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockMkdir = vi.fn();
const mockRealpath = vi.fn();

vi.mock("node:fs/promises", () => ({
  readdir: (...args: unknown[]) => mockReaddir(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  realpath: (...args: unknown[]) => mockRealpath(...args),
}));

const RESOLVED_FLOWS_DIR = resolve("flows");

// Mock path-confinement module
const mockConfinePath = vi.fn();
const mockSafeWriteFile = vi.fn();

vi.mock("../util/path-confinement.js", () => ({
  resolveConfigDir: (_envVar: string, defaultPath: string) => {
    const raw = process.env.FLOWS_DIR ?? defaultPath;
    return raw.startsWith("/") ? raw : resolve(raw);
  },
  confinePath: (...args: unknown[]) => mockConfinePath(...args),
  safeWriteFile: (...args: unknown[]) => mockSafeWriteFile(...args),
}));

const mockFlowRunnerRun = vi.fn();

vi.mock("../flow/runner.js", () => ({
  FlowRunner: class {
    run = mockFlowRunnerRun;
  },
}));

const mockFlowValidatorValidate = vi.fn();

vi.mock("../flow/validator.js", () => ({
  FlowValidator: class {
    validate = mockFlowValidatorValidate;
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

// ── Helpers ──────────────────────────────────────────────────────────────

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

// ── Setup ────────────────────────────────────────────────────────────────

let server: McpServer;

beforeEach(async () => {
  vi.clearAllMocks();

  // Ensure FLOWS_DIR is the default
  delete process.env.FLOWS_DIR;

  mockMkdir.mockResolvedValue(undefined);
  mockWriteFile.mockResolvedValue(undefined);
  mockSafeWriteFile.mockResolvedValue(undefined);
  // Default realpath mock: return the path unchanged (no symlinks)
  mockRealpath.mockImplementation(async (p: string) => p);
  // Default confinePath mock: succeed and return the path as-is
  mockConfinePath.mockImplementation((filePath: string) =>
    Promise.resolve({ resolvedPath: filePath.startsWith("/") ? filePath : resolve(filePath) }),
  );

  // Create a fresh server and register tools for each test
  server = new McpServer({ name: "test-server", version: "1.0.0" });

  // Reset module state by re-importing (vi.resetModules ensures fresh module)
  vi.resetModules();
  const { registerFlowTools } = await import("../tools/flow.js");
  registerFlowTools(server);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────────

describe("Flow tools registration", () => {

  it("registers all 4 flow tools", () => {
    const tools = getRegisteredTools(server);
    const toolNames = Object.keys(tools);

    expect(toolNames).toContain("browser_run_flow");
    expect(toolNames).toContain("browser_list_flows");
    expect(toolNames).toContain("browser_save_flow");
    expect(toolNames).toContain("browser_validate_flow");
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
      const handler = getToolHandler(server, "browser_run_flow");

      const result = await handler({ flow: validFlow });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("test-flow");
      expect(result.content[0].text).toContain("1 passed, 0 failed");
      expect(mockFlowRunnerRun).toHaveBeenCalled();
    });

    it("loads and executes a named flow from disk", async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(validFlow));
      mockFlowRunnerRun.mockResolvedValue(mockRunResult);
      const handler = getToolHandler(server, "browser_run_flow");

      const result = await handler({ name: "test-flow" });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("test-flow");
      expect(mockReadFile).toHaveBeenCalledWith(
        expect.stringContaining("test-flow.json"),
        "utf-8",
      );
    });

    it("passes record override to runner", async () => {
      mockFlowRunnerRun.mockResolvedValue(mockRunResult);
      const handler = getToolHandler(server, "browser_run_flow");

      await handler({ flow: validFlow, record: true });

      expect(mockFlowRunnerRun).toHaveBeenCalledWith(
        expect.objectContaining({ name: "test-flow" }),
        true,
      );
    });

    it("returns error for invalid inline flow", async () => {
      const handler = getToolHandler(server, "browser_run_flow");

      const result = await handler({ flow: { steps: [] } });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Invalid flow definition");
    });

    it("returns error when named flow not found", async () => {
      mockReadFile.mockRejectedValue(new Error("ENOENT"));
      const handler = getToolHandler(server, "browser_run_flow");

      const result = await handler({ name: "nonexistent" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Flow not found");
    });

    it("returns error when neither name nor flow provided", async () => {
      const handler = getToolHandler(server, "browser_run_flow");

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
      const handler = getToolHandler(server, "browser_run_flow");

      const result = await handler({ flow: validFlow });

      expect(result.content[0].text).toContain("1 passed, 1 failed");
      expect(result.content[0].text).toContain("Element not found");
    });

    it("includes recording path when present", async () => {
      mockFlowRunnerRun.mockResolvedValue({
        ...mockRunResult,
        recordingPath: "output/test/recording.mp4",
      });
      const handler = getToolHandler(server, "browser_run_flow");

      const result = await handler({ flow: validFlow });

      expect(result.content[0].text).toContain("recording.mp4");
    });

    it("catches runner exceptions", async () => {
      mockFlowRunnerRun.mockRejectedValue(new Error("Browser crashed"));
      const handler = getToolHandler(server, "browser_run_flow");

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

      const handler = getToolHandler(server, "browser_list_flows");
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
      const handler = getToolHandler(server, "browser_list_flows");

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

      const handler = getToolHandler(server, "browser_list_flows");
      const result = await handler({});

      const flows = JSON.parse(result.content[0].text);
      expect(flows).toHaveLength(1);
    });

    it("handles unreadable flow files gracefully", async () => {
      mockReaddir.mockResolvedValue(["bad.json"]);
      mockReadFile.mockRejectedValue(new Error("Permission denied"));

      const handler = getToolHandler(server, "browser_list_flows");
      const result = await handler({});

      const flows = JSON.parse(result.content[0].text);
      expect(flows).toHaveLength(1);
      expect(flows[0].name).toBe("(unreadable)");
    });

    it("handles invalid JSON in flow files", async () => {
      mockReaddir.mockResolvedValue(["invalid.json"]);
      mockReadFile.mockResolvedValue("{ bad json");

      const handler = getToolHandler(server, "browser_list_flows");
      const result = await handler({});

      const flows = JSON.parse(result.content[0].text);
      expect(flows).toHaveLength(1);
      expect(flows[0].name).toBe("(unreadable)");
    });

    it("handles valid JSON that fails schema validation", async () => {
      mockReaddir.mockResolvedValue(["bad-schema.json"]);
      // Valid JSON, but missing required 'steps' array
      mockReadFile.mockResolvedValue(JSON.stringify({ name: "No Steps" }));

      const handler = getToolHandler(server, "browser_list_flows");
      const result = await handler({});

      const flows = JSON.parse(result.content[0].text);
      expect(flows).toHaveLength(1);
      expect(flows[0].name).toBe("(invalid)");
      expect(flows[0].steps).toBe(0);
    });
  });

  // ── browser_save_flow ──────────────────────────────────────────────

  describe("browser_save_flow", () => {
    it("saves a valid flow definition", async () => {
      const handler = getToolHandler(server, "browser_save_flow");
      const flow = {
        name: "My Test Flow",
        description: "Test",
        steps: [{ action: "navigate", url: "https://example.com" }],
      };

      const result = await handler({ flow });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("My Test Flow");
      expect(result.content[0].text).toContain("my_test_flow.json");
      expect(mockConfinePath).toHaveBeenCalledWith(
        expect.stringContaining("my_test_flow.json"),
        RESOLVED_FLOWS_DIR,
      );
      expect(mockSafeWriteFile).toHaveBeenCalledWith(
        expect.stringContaining("my_test_flow.json"),
        expect.any(String),
      );
    });

    it("rejects invalid flow definition", async () => {
      const handler = getToolHandler(server, "browser_save_flow");

      const result = await handler({ flow: { name: "bad", steps: [] } });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Invalid flow definition");
    });

    it("sanitizes flow name for filename", async () => {
      const handler = getToolHandler(server, "browser_save_flow");
      const flow = {
        name: "My Flow (v2) [test]",
        steps: [{ action: "navigate", url: "https://example.com" }],
      };

      const result = await handler({ flow });

      expect(result.content[0].text).toContain("my_flow__v2___test_");
    });

    it("catches file system errors", async () => {
      mockSafeWriteFile.mockRejectedValue(new Error("Disk full"));
      const handler = getToolHandler(server, "browser_save_flow");

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

  // ── browser_validate_flow ────────────────────────────────────────

  describe("browser_validate_flow", () => {
    const validFlow = {
      name: "test-flow",
      steps: [{ action: "navigate", url: "https://example.com" }],
    };

    const mockValidateResult = {
      valid: true,
      steps: [
        { index: 0, action: "navigate", status: "skip" },
      ],
    };

    it("validates an inline flow definition", async () => {
      mockFlowValidatorValidate.mockResolvedValue(mockValidateResult);
      const handler = getToolHandler(server, "browser_validate_flow");

      const result = await handler({ flow: validFlow });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("PASS");
      expect(mockFlowValidatorValidate).toHaveBeenCalled();
    });

    it("loads and validates a named flow from disk", async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(validFlow));
      mockFlowValidatorValidate.mockResolvedValue(mockValidateResult);
      const handler = getToolHandler(server, "browser_validate_flow");

      const result = await handler({ name: "test-flow" });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("PASS");
      expect(mockReadFile).toHaveBeenCalledWith(
        expect.stringContaining("test-flow.json"),
        "utf-8",
      );
    });

    it("passes custom timeout to validator", async () => {
      mockFlowValidatorValidate.mockResolvedValue(mockValidateResult);
      const handler = getToolHandler(server, "browser_validate_flow");

      await handler({ flow: validFlow, timeout: 10000 });

      expect(mockFlowValidatorValidate).toHaveBeenCalledWith(
        expect.objectContaining({ name: "test-flow" }),
        { timeout: 10000 },
      );
    });

    it("uses default timeout when not provided", async () => {
      mockFlowValidatorValidate.mockResolvedValue(mockValidateResult);
      const handler = getToolHandler(server, "browser_validate_flow");

      await handler({ flow: validFlow });

      expect(mockFlowValidatorValidate).toHaveBeenCalledWith(
        expect.objectContaining({ name: "test-flow" }),
        { timeout: 5000 },
      );
    });

    it("returns error for invalid inline flow", async () => {
      const handler = getToolHandler(server, "browser_validate_flow");

      const result = await handler({ flow: { steps: [] } });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Invalid flow definition");
    });

    it("returns error when named flow not found", async () => {
      mockReadFile.mockRejectedValue(new Error("ENOENT"));
      const handler = getToolHandler(server, "browser_validate_flow");

      const result = await handler({ name: "nonexistent" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Flow not found");
    });

    it("returns error when neither name nor flow provided", async () => {
      const handler = getToolHandler(server, "browser_validate_flow");

      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("provide either");
    });

    it("reports FAIL when validation finds missing elements", async () => {
      mockFlowValidatorValidate.mockResolvedValue({
        valid: false,
        steps: [
          { index: 0, action: "click", status: "ok" },
          { index: 1, action: "type", status: "missing", detail: "Timeout waiting for selector" },
          { index: 2, action: "navigate", status: "skip" },
        ],
      });
      const handler = getToolHandler(server, "browser_validate_flow");

      const result = await handler({ flow: validFlow });

      expect(result.content[0].text).toContain("FAIL");
      expect(result.content[0].text).toContain("1 ok");
      expect(result.content[0].text).toContain("1 missing");
      expect(result.content[0].text).toContain("1 skip");
      expect(result.content[0].text).toContain("Timeout waiting for selector");
    });

    it("reports PASS with step counts", async () => {
      mockFlowValidatorValidate.mockResolvedValue({
        valid: true,
        steps: [
          { index: 0, action: "click", status: "ok" },
          { index: 1, action: "navigate", status: "skip" },
          { index: 2, action: "hover", status: "ok" },
        ],
      });
      const handler = getToolHandler(server, "browser_validate_flow");

      const result = await handler({ flow: validFlow });

      expect(result.content[0].text).toContain("PASS");
      expect(result.content[0].text).toContain("2 ok");
      expect(result.content[0].text).toContain("0 missing");
      expect(result.content[0].text).toContain("1 skip");
    });

    it("includes JSON report in output", async () => {
      const report = {
        valid: true,
        steps: [{ index: 0, action: "click", status: "ok" }],
      };
      mockFlowValidatorValidate.mockResolvedValue(report);
      const handler = getToolHandler(server, "browser_validate_flow");

      const result = await handler({ flow: validFlow });

      // The output should include the JSON report
      const text = result.content[0].text;
      expect(text).toContain('"valid"');
      expect(text).toContain('"steps"');
    });

    it("catches validator exceptions", async () => {
      mockFlowValidatorValidate.mockRejectedValue(new Error("Browser not connected"));
      const handler = getToolHandler(server, "browser_validate_flow");

      const result = await handler({ flow: validFlow });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Browser not connected");
    });

    it("rejects flow name with path traversal", async () => {
      const handler = getToolHandler(server, "browser_validate_flow");

      const result = await handler({ name: "../../../etc/passwd" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Invalid flow name");
      expect(mockReadFile).not.toHaveBeenCalled();
    });

    it("detects symlink escape", async () => {
      mockConfinePath.mockResolvedValueOnce({
        error: `Path must be within ${RESOLVED_FLOWS_DIR} (symlink detected)`,
      });

      const handler = getToolHandler(server, "browser_validate_flow");
      const result = await handler({ name: "legit" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("symlink detected");
    });
  });

  // ── Path traversal & confinement ──────────────────────────────────

  describe("path traversal protection", () => {
    it("rejects flow name with forward slash", async () => {
      const handler = getToolHandler(server, "browser_run_flow");

      const result = await handler({ name: "../../../etc/passwd" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Invalid flow name");
      expect(mockReadFile).not.toHaveBeenCalled();
    });

    it("rejects flow name with backslash", async () => {
      const handler = getToolHandler(server, "browser_run_flow");

      const result = await handler({ name: "..\\..\\etc\\passwd" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Invalid flow name");
      expect(mockReadFile).not.toHaveBeenCalled();
    });

    it("rejects flow name with dot-dot", async () => {
      const handler = getToolHandler(server, "browser_run_flow");

      const result = await handler({ name: "..secret" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Invalid flow name");
    });

    it("detects symlink escape on save", async () => {
      mockConfinePath.mockResolvedValueOnce({
        error: `Path must be within ${RESOLVED_FLOWS_DIR} (symlink detected)`,
      });

      const handler = getToolHandler(server, "browser_save_flow");
      const result = await handler({
        flow: {
          name: "legit",
          steps: [{ action: "navigate", url: "https://example.com" }],
        },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("symlink detected");
    });

    it("detects symlink escape on run", async () => {
      mockConfinePath.mockResolvedValueOnce({
        error: `Path must be within ${RESOLVED_FLOWS_DIR} (symlink detected)`,
      });

      const handler = getToolHandler(server, "browser_run_flow");
      const result = await handler({ name: "legit" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("symlink detected");
    });
  });
});
