/**
 * Unit tests for recording tools (src/tools/recording.ts)
 *
 * All browser module interactions are mocked. These tests verify:
 * - All 3 tools are registered on the McpServer with correct names/descriptions/schemas
 * - browser_start_recording starts screencast and stores recorder state
 * - browser_stop_recording stops recording and returns path/duration/key moments
 * - browser_screenshot_key_moment captures labeled screenshot during recording
 * - Recording state management (can't double-start, can't stop when not recording)
 * - Path confinement: outputPath must be within RECORDING_DIR
 * - Error paths catch exceptions and return error text with isError: true (never throw)
 * - Retry after failed start, graceful a11y degradation, label length validation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// ── Mock Setup ──────────────────────────────────────────────────────────

// Mock the browser module
const mockEnsurePage = vi.fn();

vi.mock("../browser.js", () => ({
  ensurePage: (...args: unknown[]) => mockEnsurePage(...args),
}));

// Mock node:fs/promises
const mockWriteFile = vi.fn();
const mockMkdir = vi.fn();
const mockRealpath = vi.fn();

vi.mock("node:fs/promises", () => ({
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  realpath: (...args: unknown[]) => mockRealpath(...args),
}));

// Mock the path-confinement module
const mockConfinePath = vi.fn();
const mockSafeWriteFile = vi.fn();

vi.mock("../util/path-confinement.js", () => ({
  resolveConfigDir: (_envVar: string, defaultPath: string) => {
    const raw = process.env.RECORDING_DIR ?? defaultPath;
    return raw.startsWith("/") ? raw : `/cwd/${raw}`;
  },
  confinePath: (...args: unknown[]) => mockConfinePath(...args),
  safeWriteFile: (...args: unknown[]) => mockSafeWriteFile(...args),
}));

// Mock transcode
const mockTranscode = vi.fn().mockResolvedValue(undefined);

vi.mock("../util/transcode.js", () => ({
  transcodeMp4ToH264: (...args: unknown[]) => mockTranscode(...args),
}));

// Mock logger
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  setLogLevel: vi.fn(),
};

vi.mock("../util/logger.js", () => ({
  default: mockLogger,
}));

// Mock ScreenRecorder
interface MockScreenRecorder {
  stop: ReturnType<typeof vi.fn>;
}

// Mock page object
interface MockPage {
  screencast: ReturnType<typeof vi.fn>;
  screenshot: ReturnType<typeof vi.fn>;
  accessibility: {
    snapshot: ReturnType<typeof vi.fn>;
  };
}

let mockPage: MockPage;
let mockRecorder: MockScreenRecorder;

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

// ── Constants ───────────────────────────────────────────────────────────

/** Default RECORDING_DIR used in tests. */
const TEST_RECORDING_DIR = "/tmp/screen-cap-recordings";

// Base64 PNG stub (1x1 transparent pixel)
const FAKE_SCREENSHOT_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGP6/x8AAwAB/auKfQAAAABJRU5ErkJggg==",
  "base64",
);

// ── Setup ───────────────────────────────────────────────────────────────

let server: McpServer;

beforeEach(async () => {
  vi.clearAllMocks();

  // Ensure RECORDING_DIR is the default
  delete process.env.RECORDING_DIR;

  mockRecorder = {
    stop: vi.fn().mockResolvedValue(undefined),
  };

  mockPage = {
    screencast: vi.fn().mockResolvedValue(mockRecorder),
    screenshot: vi.fn().mockResolvedValue(FAKE_SCREENSHOT_BUFFER),
    accessibility: {
      snapshot: vi.fn().mockResolvedValue({
        role: "WebArea",
        name: "Test Page",
        children: [],
      }),
    },
  };

  mockEnsurePage.mockResolvedValue(mockPage);
  mockWriteFile.mockResolvedValue(undefined);
  mockMkdir.mockResolvedValue(undefined);
  mockSafeWriteFile.mockResolvedValue(undefined);
  // By default, realpath returns the path as-is (no symlinks)
  mockRealpath.mockImplementation(async (p: string) => p);
  // By default, confinePath succeeds — returns the resolved path as-is
  mockConfinePath.mockImplementation((filePath: string) =>
    Promise.resolve({ resolvedPath: filePath.startsWith("/") ? filePath : `/cwd/${filePath}` }),
  );

  // Create a fresh server and register tools for each test
  server = new McpServer({ name: "test-server", version: "1.0.0" });

  // Reset module state by re-importing (vi.resetModules ensures fresh module)
  vi.resetModules();
  const { registerRecordingTools } = await import("../tools/recording.js");
  registerRecordingTools(server);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tool Registration ───────────────────────────────────────────────────

describe("registerRecordingTools", () => {
  it("registers all 3 tools on the server", () => {
    const tools = getRegisteredTools(server);
    const toolNames = Object.keys(tools);

    expect(toolNames).toContain("browser_start_recording");
    expect(toolNames).toContain("browser_stop_recording");
    expect(toolNames).toContain("browser_screenshot_key_moment");
  });

  it("each tool has a description", () => {
    const tools = getRegisteredTools(server);
    const recordingTools = [
      "browser_start_recording",
      "browser_stop_recording",
      "browser_screenshot_key_moment",
    ];

    for (const name of recordingTools) {
      expect(tools[name].description, `Tool "${name}" should have a description`).toBeTruthy();
    }
  });
});

// ── browser_start_recording ─────────────────────────────────────────────

describe("browser_start_recording", () => {
  it("starts recording with default path and format", async () => {
    const handler = getToolHandler(server, "browser_start_recording");
    const result = await handler({}, { signal: new AbortController().signal });

    expect(mockEnsurePage).toHaveBeenCalled();
    expect(mockPage.screencast).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringContaining(TEST_RECORDING_DIR),
        format: "mp4",
      }),
    );
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("Recording started");
    expect(result.isError).toBeFalsy();
  });

  it("uses custom outputPath within RECORDING_DIR", async () => {
    const handler = getToolHandler(server, "browser_start_recording");
    const result = await handler(
      { outputPath: `${TEST_RECORDING_DIR}/custom/video.mp4` },
      { signal: new AbortController().signal },
    );

    expect(mockPage.screencast).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringContaining(`${TEST_RECORDING_DIR}/custom/video.mp4`),
      }),
    );
    expect(result.isError).toBeFalsy();
  });

  it("rejects outputPath outside RECORDING_DIR (path traversal)", async () => {
    mockConfinePath.mockResolvedValue({ error: `Path must be within ${TEST_RECORDING_DIR}` });
    const handler = getToolHandler(server, "browser_start_recording");
    const result = await handler(
      { outputPath: "/etc/evil.mp4" },
      { signal: new AbortController().signal },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("must be within");
    expect(mockPage.screencast).not.toHaveBeenCalled();
  });

  it("rejects outputPath with path traversal sequences", async () => {
    mockConfinePath.mockResolvedValue({ error: `Path must be within ${TEST_RECORDING_DIR}` });
    const handler = getToolHandler(server, "browser_start_recording");
    const result = await handler(
      { outputPath: `${TEST_RECORDING_DIR}/../../etc/evil.mp4` },
      { signal: new AbortController().signal },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("must be within");
  });

  it("rejects outputPath that resolves outside RECORDING_DIR via symlink", async () => {
    mockConfinePath.mockResolvedValue({ error: `Path must be within ${TEST_RECORDING_DIR} (symlink detected)` });

    const handler = getToolHandler(server, "browser_start_recording");
    const result = await handler(
      { outputPath: `${TEST_RECORDING_DIR}/video.mp4` },
      { signal: new AbortController().signal },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("symlink detected");
  });

  it("uses webm format when specified", async () => {
    const handler = getToolHandler(server, "browser_start_recording");
    await handler(
      { outputPath: `${TEST_RECORDING_DIR}/video.webm`, format: "webm" },
      { signal: new AbortController().signal },
    );

    expect(mockPage.screencast).toHaveBeenCalledWith(
      expect.objectContaining({
        format: "webm",
      }),
    );
  });

  it("default output path ends with .mp4 for mp4 format", async () => {
    const handler = getToolHandler(server, "browser_start_recording");
    await handler({}, { signal: new AbortController().signal });

    const callArgs = mockPage.screencast.mock.calls[0][0];
    expect(callArgs.path).toMatch(/\.mp4$/);
  });

  it("default output path ends with .webm for webm format", async () => {
    const handler = getToolHandler(server, "browser_start_recording");
    await handler(
      { format: "webm" },
      { signal: new AbortController().signal },
    );

    const callArgs = mockPage.screencast.mock.calls[0][0];
    expect(callArgs.path).toMatch(/\.webm$/);
  });

  it("creates output directories before starting", async () => {
    const handler = getToolHandler(server, "browser_start_recording");
    await handler({}, { signal: new AbortController().signal });

    expect(mockConfinePath).toHaveBeenCalledWith(
      expect.stringContaining(TEST_RECORDING_DIR),
      TEST_RECORDING_DIR,
    );
  });

  it("prevents double-start (returns error if already recording)", async () => {
    const handler = getToolHandler(server, "browser_start_recording");

    // First start succeeds
    const result1 = await handler({}, { signal: new AbortController().signal });
    expect(result1.isError).toBeFalsy();

    // Second start returns error
    const result2 = await handler({}, { signal: new AbortController().signal });
    expect(result2.isError).toBe(true);
    expect(result2.content[0].type).toBe("text");
    expect(result2.content[0].text).toContain("already");
  });

  it("returns error text when screencast fails (does not throw)", async () => {
    mockPage.screencast.mockRejectedValue(new Error("ffmpeg not found"));
    const handler = getToolHandler(server, "browser_start_recording");
    const result = await handler({}, { signal: new AbortController().signal });

    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("ffmpeg not found");
  });

  it("allows retry after failed start", async () => {
    mockPage.screencast.mockRejectedValueOnce(new Error("ffmpeg not found"));
    const handler = getToolHandler(server, "browser_start_recording");

    const fail = await handler({}, { signal: new AbortController().signal });
    expect(fail.isError).toBe(true);

    // Should be able to try again
    mockPage.screencast.mockResolvedValueOnce(mockRecorder);
    const success = await handler({}, { signal: new AbortController().signal });
    expect(success.isError).toBeFalsy();
    expect(success.content[0].text).toContain("Recording started");
  });

  it("rejects outputPath extension mismatch with format", async () => {
    const handler = getToolHandler(server, "browser_start_recording");
    const result = await handler(
      { outputPath: `${TEST_RECORDING_DIR}/video.webm`, format: "mp4" },
      { signal: new AbortController().signal },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("extension must match");
  });
});

// ── browser_stop_recording ──────────────────────────────────────────────

describe("browser_stop_recording", () => {
  it("stops an active recording and returns results", async () => {
    const startHandler = getToolHandler(server, "browser_start_recording");
    await startHandler({}, { signal: new AbortController().signal });

    const stopHandler = getToolHandler(server, "browser_stop_recording");
    const result = await stopHandler({}, { signal: new AbortController().signal });

    expect(mockRecorder.stop).toHaveBeenCalled();
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("Recording stopped");
    expect(result.isError).toBeFalsy();
    // Transcode should be called with the recording path
    expect(mockTranscode).toHaveBeenCalledWith(
      expect.stringContaining(TEST_RECORDING_DIR),
    );
  });

  it("returns recording path in results", async () => {
    const startHandler = getToolHandler(server, "browser_start_recording");
    await startHandler(
      { outputPath: `${TEST_RECORDING_DIR}/test.mp4` },
      { signal: new AbortController().signal },
    );

    const stopHandler = getToolHandler(server, "browser_stop_recording");
    const result = await stopHandler({}, { signal: new AbortController().signal });

    expect(result.content[0].text).toContain(`${TEST_RECORDING_DIR}/test.mp4`);
  });

  it("returns duration in results", async () => {
    const startHandler = getToolHandler(server, "browser_start_recording");
    await startHandler({}, { signal: new AbortController().signal });

    const stopHandler = getToolHandler(server, "browser_stop_recording");
    const result = await stopHandler({}, { signal: new AbortController().signal });

    expect(result.content[0].text).toContain("duration");
  });

  it("returns key moments in results when moments were captured", async () => {
    const startHandler = getToolHandler(server, "browser_start_recording");
    await startHandler({}, { signal: new AbortController().signal });

    const momentHandler = getToolHandler(server, "browser_screenshot_key_moment");
    await momentHandler(
      { label: "test-moment" },
      { signal: new AbortController().signal },
    );

    const stopHandler = getToolHandler(server, "browser_stop_recording");
    const result = await stopHandler({}, { signal: new AbortController().signal });

    expect(result.content[0].text).toContain("test-moment");
  });

  it("returns error when not recording", async () => {
    const stopHandler = getToolHandler(server, "browser_stop_recording");
    const result = await stopHandler({}, { signal: new AbortController().signal });

    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("No recording");
    expect(mockTranscode).not.toHaveBeenCalled();
  });

  it("clears recording state after stopping (allows new recording)", async () => {
    const startHandler = getToolHandler(server, "browser_start_recording");
    const stopHandler = getToolHandler(server, "browser_stop_recording");

    await startHandler({}, { signal: new AbortController().signal });
    await stopHandler({}, { signal: new AbortController().signal });

    // Should be able to start a new recording
    const result = await startHandler({}, { signal: new AbortController().signal });
    expect(result.isError).toBeFalsy();
  });

  it("warns but does not fail when transcode errors", async () => {
    mockTranscode.mockRejectedValueOnce(new Error("ffmpeg not installed"));

    const startHandler = getToolHandler(server, "browser_start_recording");
    await startHandler({}, { signal: new AbortController().signal });

    const stopHandler = getToolHandler(server, "browser_stop_recording");
    const result = await stopHandler({}, { signal: new AbortController().signal });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Recording stopped");
    expect(mockTranscode).toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("ffmpeg not installed"),
    );
  });

  it("returns error text when recorder.stop() fails (does not throw)", async () => {
    mockRecorder.stop.mockRejectedValue(new Error("Stop failed"));
    const startHandler = getToolHandler(server, "browser_start_recording");
    await startHandler({}, { signal: new AbortController().signal });

    const stopHandler = getToolHandler(server, "browser_stop_recording");
    const result = await stopHandler({}, { signal: new AbortController().signal });

    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("Stop failed");
  });
});

// ── browser_screenshot_key_moment ───────────────────────────────────────

describe("browser_screenshot_key_moment", () => {
  it("captures a labeled screenshot during recording", async () => {
    const startHandler = getToolHandler(server, "browser_start_recording");
    await startHandler({}, { signal: new AbortController().signal });

    const handler = getToolHandler(server, "browser_screenshot_key_moment");
    const result = await handler(
      { label: "login-page" },
      { signal: new AbortController().signal },
    );

    expect(mockPage.screenshot).toHaveBeenCalled();
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("login-page");
    expect(result.isError).toBeFalsy();
  });

  it("saves screenshot within RECORDING_DIR/screenshots/", async () => {
    const startHandler = getToolHandler(server, "browser_start_recording");
    await startHandler({}, { signal: new AbortController().signal });

    const handler = getToolHandler(server, "browser_screenshot_key_moment");
    await handler(
      { label: "test-label" },
      { signal: new AbortController().signal },
    );

    // confinePath should have been called for the screenshot path
    expect(mockConfinePath).toHaveBeenCalledWith(
      expect.stringContaining(`${TEST_RECORDING_DIR}/screenshots/`),
      TEST_RECORDING_DIR,
    );

    // Should write the screenshot file via safeWriteFile
    expect(mockSafeWriteFile).toHaveBeenCalledWith(
      expect.stringContaining(`${TEST_RECORDING_DIR}/screenshots/`),
      expect.any(Buffer),
    );

    // Screenshot filename should contain the label
    const writePath = mockSafeWriteFile.mock.calls.find((call: unknown[]) =>
      (call[0] as string).includes("screenshots/"),
    );
    expect(writePath).toBeTruthy();
    expect(writePath![0]).toContain("test-label");
    expect(writePath![0]).toMatch(/\.png$/);
  });

  it("captures a11y snapshot and saves within RECORDING_DIR/a11y/", async () => {
    const startHandler = getToolHandler(server, "browser_start_recording");
    await startHandler({}, { signal: new AbortController().signal });

    const handler = getToolHandler(server, "browser_screenshot_key_moment");
    await handler(
      { label: "a11y-test" },
      { signal: new AbortController().signal },
    );

    expect(mockPage.accessibility.snapshot).toHaveBeenCalled();

    // confinePath should have been called for the a11y path
    expect(mockConfinePath).toHaveBeenCalledWith(
      expect.stringContaining(`${TEST_RECORDING_DIR}/a11y`),
      TEST_RECORDING_DIR,
    );

    // Should write the a11y JSON file via safeWriteFile
    const a11yWrite = mockSafeWriteFile.mock.calls.find((call: unknown[]) =>
      (call[0] as string).includes("a11y/"),
    );
    expect(a11yWrite).toBeTruthy();
    expect(a11yWrite![0]).toContain("a11y-test");
    expect(a11yWrite![0]).toMatch(/\.json$/);
  });

  it("continues gracefully when a11y snapshot fails", async () => {
    const startHandler = getToolHandler(server, "browser_start_recording");
    await startHandler({}, { signal: new AbortController().signal });

    mockPage.accessibility.snapshot.mockRejectedValueOnce(new Error("a11y unavailable"));

    const handler = getToolHandler(server, "browser_screenshot_key_moment");
    const result = await handler(
      { label: "a11y-fail" },
      { signal: new AbortController().signal },
    );

    // Should succeed — a11y is optional
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("a11y-fail");
    // Screenshot should still have been captured
    expect(mockPage.screenshot).toHaveBeenCalled();
  });

  it("returns error when not currently recording", async () => {
    const handler = getToolHandler(server, "browser_screenshot_key_moment");
    const result = await handler(
      { label: "no-recording" },
      { signal: new AbortController().signal },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("No recording");
  });

  it("includes timestamp offset in key moment", async () => {
    const startHandler = getToolHandler(server, "browser_start_recording");
    await startHandler({}, { signal: new AbortController().signal });

    const handler = getToolHandler(server, "browser_screenshot_key_moment");
    const result = await handler(
      { label: "timed-moment" },
      { signal: new AbortController().signal },
    );

    expect(result.content[0].text).toContain("timed-moment");
    expect(result.isError).toBeFalsy();
  });

  it("returns error text when screenshot fails (does not throw)", async () => {
    const startHandler = getToolHandler(server, "browser_start_recording");
    await startHandler({}, { signal: new AbortController().signal });

    mockPage.screenshot.mockRejectedValue(new Error("Screenshot capture failed"));

    const handler = getToolHandler(server, "browser_screenshot_key_moment");
    const result = await handler(
      { label: "fail-moment" },
      { signal: new AbortController().signal },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("Screenshot capture failed");
  });

  it("accumulates multiple key moments", async () => {
    const startHandler = getToolHandler(server, "browser_start_recording");
    await startHandler({}, { signal: new AbortController().signal });

    const handler = getToolHandler(server, "browser_screenshot_key_moment");
    await handler({ label: "moment-1" }, { signal: new AbortController().signal });
    await handler({ label: "moment-2" }, { signal: new AbortController().signal });
    await handler({ label: "moment-3" }, { signal: new AbortController().signal });

    const stopHandler = getToolHandler(server, "browser_stop_recording");
    const result = await stopHandler({}, { signal: new AbortController().signal });

    expect(result.content[0].text).toContain("moment-1");
    expect(result.content[0].text).toContain("moment-2");
    expect(result.content[0].text).toContain("moment-3");
  });
});

// ── cleanupRecordingState ───────────────────────────────────────────────

describe("cleanupRecordingState", () => {
  it("clears state so a new recording can start", async () => {
    const startHandler = getToolHandler(server, "browser_start_recording");
    await startHandler({}, { signal: new AbortController().signal });

    // Import and call cleanup
    const { cleanupRecordingState } = await import("../recording-state.js");
    cleanupRecordingState();

    // Should be able to start again (not blocked by "already in progress")
    const result = await startHandler({}, { signal: new AbortController().signal });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Recording started");
  });
});

// ── isRecordingActive ───────────────────────────────────────────────────

describe("isRecordingActive", () => {
  it("returns false when no recording is active", async () => {
    const { isRecordingActive } = await import("../recording-state.js");
    expect(isRecordingActive()).toBe(false);
  });

  it("returns true when recording is active", async () => {
    const startHandler = getToolHandler(server, "browser_start_recording");
    await startHandler({}, { signal: new AbortController().signal });

    const { isRecordingActive } = await import("../recording-state.js");
    expect(isRecordingActive()).toBe(true);
  });
});
