/**
 * Unit tests for path confinement utility (src/util/path-confinement.ts)
 *
 * Tests verify:
 * - isWithinDir: prefix check, exact match, prefix attack prevention
 * - resolveConfigDir: env var override, default fallback, root rejection
 * - confinePath: path within dir, path outside dir, symlink escape, path reconstruction
 * - confineDir: directory confinement, symlink escape, directory creation
 * - safeWriteFile: successful write, cleanup on error
 * - _clearRealpathCache: cache invalidation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolve, join } from "node:path";

// ── Mock Setup ──────────────────────────────────────────────────────────

const mockMkdir = vi.fn();
const mockRealpath = vi.fn();
const mockOpen = vi.fn();

vi.mock("node:fs/promises", () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  realpath: (...args: unknown[]) => mockRealpath(...args),
  open: (...args: unknown[]) => mockOpen(...args),
}));

// ── Setup ───────────────────────────────────────────────────────────────

beforeEach(async () => {
  vi.clearAllMocks();
  mockMkdir.mockResolvedValue(undefined);
  // By default, realpath returns the path unchanged (no symlinks)
  mockRealpath.mockImplementation(async (p: string) => p);

  // Clear the internal realpath cache between tests
  const { _clearRealpathCache } = await import("../util/path-confinement.js");
  _clearRealpathCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── isWithinDir ─────────────────────────────────────────────────────────

describe("isWithinDir", () => {
  let isWithinDir: typeof import("../util/path-confinement.js").isWithinDir;

  beforeEach(async () => {
    ({ isWithinDir } = await import("../util/path-confinement.js"));
  });

  it("returns true for a path directly within the allowed directory", () => {
    expect(isWithinDir("/tmp/allowed/file.txt", "/tmp/allowed")).toBe(true);
  });

  it("returns true for a path in a subdirectory of the allowed directory", () => {
    expect(isWithinDir("/tmp/allowed/sub/deep/file.txt", "/tmp/allowed")).toBe(true);
  });

  it("returns true when path equals the allowed directory exactly", () => {
    expect(isWithinDir("/tmp/allowed", "/tmp/allowed")).toBe(true);
  });

  it("returns false for a path outside the allowed directory", () => {
    expect(isWithinDir("/etc/passwd", "/tmp/allowed")).toBe(false);
  });

  it("prevents prefix attack: /tmp/allowed-evil should not match /tmp/allowed", () => {
    expect(isWithinDir("/tmp/allowed-evil/file.txt", "/tmp/allowed")).toBe(false);
  });

  it("prevents prefix attack: /tmp/allowedfoo should not match /tmp/allowed", () => {
    expect(isWithinDir("/tmp/allowedfoo", "/tmp/allowed")).toBe(false);
  });

  it("does not catch unresolved traversal (callers must resolve() first)", () => {
    // isWithinDir is a raw prefix check; callers use resolve() to normalize paths.
    // An unresolved traversal like "/tmp/allowed/../etc/passwd" starts with "/tmp/allowed/"
    // so the prefix check passes — this is expected. confinePath handles resolve() first.
    expect(isWithinDir("/tmp/allowed/../etc/passwd", "/tmp/allowed")).toBe(true);
  });

  it("returns false for empty path", () => {
    expect(isWithinDir("", "/tmp/allowed")).toBe(false);
  });
});

// ── resolveConfigDir ────────────────────────────────────────────────────

describe("resolveConfigDir", () => {
  let resolveConfigDir: typeof import("../util/path-confinement.js").resolveConfigDir;

  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    ({ resolveConfigDir } = await import("../util/path-confinement.js"));
    // Save env vars we'll modify
    originalEnv.TEST_DIR = process.env.TEST_DIR;
    delete process.env.TEST_DIR;
  });

  afterEach(() => {
    // Restore env vars
    if (originalEnv.TEST_DIR === undefined) {
      delete process.env.TEST_DIR;
    } else {
      process.env.TEST_DIR = originalEnv.TEST_DIR;
    }
  });

  it("returns resolved default path when env var is not set", () => {
    const result = resolveConfigDir("TEST_DIR", "/tmp/default-dir");
    expect(result).toBe("/tmp/default-dir");
  });

  it("returns resolved env var value when set", () => {
    process.env.TEST_DIR = "/custom/dir";
    const result = resolveConfigDir("TEST_DIR", "/tmp/default-dir");
    expect(result).toBe("/custom/dir");
  });

  it("resolves relative default paths against CWD", () => {
    const result = resolveConfigDir("TEST_DIR", "relative/path");
    expect(result).toBe(resolve("relative/path"));
  });

  it("resolves relative env var values against CWD", () => {
    process.env.TEST_DIR = "custom/relative";
    const result = resolveConfigDir("TEST_DIR", "/tmp/default");
    expect(result).toBe(resolve("custom/relative"));
  });

  it("throws when resolved path is filesystem root", () => {
    process.env.TEST_DIR = "/";
    expect(() => resolveConfigDir("TEST_DIR", "/tmp/default")).toThrow(
      "TEST_DIR must not resolve to the filesystem root",
    );
  });

  it("throws when default path resolves to filesystem root", () => {
    expect(() => resolveConfigDir("TEST_DIR", "/")).toThrow(
      "TEST_DIR must not resolve to the filesystem root",
    );
  });
});

// ── confinePath ─────────────────────────────────────────────────────────

describe("confinePath", () => {
  let confinePath: typeof import("../util/path-confinement.js").confinePath;

  beforeEach(async () => {
    ({ confinePath } = await import("../util/path-confinement.js"));
  });

  it("succeeds for a path within the allowed directory", async () => {
    const result = await confinePath("/tmp/allowed/file.txt", "/tmp/allowed");

    expect(result).toHaveProperty("resolvedPath");
    expect((result as { resolvedPath: string }).resolvedPath).toBe("/tmp/allowed/file.txt");
  });

  it("creates parent directories via mkdir", async () => {
    await confinePath("/tmp/allowed/sub/deep/file.txt", "/tmp/allowed");

    expect(mockMkdir).toHaveBeenCalledWith("/tmp/allowed/sub/deep", { recursive: true });
  });

  it("returns error for path outside allowed directory", async () => {
    const result = await confinePath("/etc/passwd", "/tmp/allowed");

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("must be within /tmp/allowed");
  });

  it("returns error for path traversal attempt", async () => {
    const result = await confinePath(
      "/tmp/allowed/../../etc/passwd",
      "/tmp/allowed",
    );

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("must be within /tmp/allowed");
  });

  it("detects symlink escape after mkdir", async () => {
    // First realpath call (for dirname) returns an escaped path
    let callCount = 0;
    mockRealpath.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return "/etc/evil"; // dirname realpath
      return "/tmp/allowed"; // allowedDir realpath
    });

    const result = await confinePath("/tmp/allowed/file.txt", "/tmp/allowed");

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("symlink detected");
  });

  it("reconstructs path using real directory after symlink check", async () => {
    // Simulate: dirname resolves to a different but still-within path
    mockRealpath.mockImplementation(async (p: string) => {
      if (p === "/tmp/allowed/sub") return "/tmp/allowed/real-sub";
      return p;
    });

    const result = await confinePath("/tmp/allowed/sub/file.txt", "/tmp/allowed");

    expect(result).toHaveProperty("resolvedPath");
    // Path should be reconstructed with the real dir
    expect((result as { resolvedPath: string }).resolvedPath).toBe(
      "/tmp/allowed/real-sub/file.txt",
    );
  });

  it("uses cached realpath for allowedDir on repeated calls", async () => {
    // Use a subdirectory so dirname calls don't hit the same path as allowedDir
    await confinePath("/tmp/allowed/sub/file1.txt", "/tmp/allowed");
    await confinePath("/tmp/allowed/sub/file2.txt", "/tmp/allowed");

    // realpath("/tmp/allowed/sub") is called each time (dirname of file)
    // realpath("/tmp/allowed") via cachedRealpath is called only once, then cached
    const realpathCalls = mockRealpath.mock.calls;
    const allowedDirCalls = realpathCalls.filter(
      (call: unknown[]) => call[0] === "/tmp/allowed",
    );
    // cachedRealpath calls realpath once then caches; mkdir for allowedDir happens once too
    expect(allowedDirCalls).toHaveLength(1); // cached after first call
  });
});

// ── confineDir ──────────────────────────────────────────────────────────

describe("confineDir", () => {
  let confineDir: typeof import("../util/path-confinement.js").confineDir;

  beforeEach(async () => {
    ({ confineDir } = await import("../util/path-confinement.js"));
  });

  it("succeeds for a directory within the allowed directory", async () => {
    const result = await confineDir("/tmp/allowed/subdir", "/tmp/allowed");

    expect(result).toHaveProperty("resolvedDir");
    expect((result as { resolvedDir: string }).resolvedDir).toBe("/tmp/allowed/subdir");
  });

  it("creates the directory via mkdir", async () => {
    await confineDir("/tmp/allowed/new-dir", "/tmp/allowed");

    expect(mockMkdir).toHaveBeenCalledWith("/tmp/allowed/new-dir", { recursive: true });
  });

  it("returns error for directory outside allowed directory", async () => {
    const result = await confineDir("/etc/evil", "/tmp/allowed");

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("must be within /tmp/allowed");
  });

  it("detects symlink escape after mkdir", async () => {
    let callCount = 0;
    mockRealpath.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return "/etc/evil"; // dir realpath
      return "/tmp/allowed"; // allowedDir realpath
    });

    const result = await confineDir("/tmp/allowed/subdir", "/tmp/allowed");

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("symlink detected");
  });

  it("returns the real path of the directory", async () => {
    mockRealpath.mockImplementation(async (p: string) => {
      if (p === "/tmp/allowed/symlinked") return "/tmp/allowed/real-dir";
      return p;
    });

    const result = await confineDir("/tmp/allowed/symlinked", "/tmp/allowed");

    expect(result).toHaveProperty("resolvedDir");
    expect((result as { resolvedDir: string }).resolvedDir).toBe("/tmp/allowed/real-dir");
  });
});

// ── safeWriteFile ───────────────────────────────────────────────────────

describe("safeWriteFile", () => {
  let safeWriteFile: typeof import("../util/path-confinement.js").safeWriteFile;

  const mockFileHandle = {
    writeFile: vi.fn(),
    close: vi.fn(),
  };

  beforeEach(async () => {
    ({ safeWriteFile } = await import("../util/path-confinement.js"));
    mockFileHandle.writeFile.mockResolvedValue(undefined);
    mockFileHandle.close.mockResolvedValue(undefined);
    mockOpen.mockResolvedValue(mockFileHandle);
  });

  it("opens file with O_CREAT | O_WRONLY | O_TRUNC flags and 0o644 mode", async () => {
    await safeWriteFile("/tmp/file.txt", "data");

    expect(mockOpen).toHaveBeenCalledWith(
      "/tmp/file.txt",
      expect.any(Number), // O_CREAT | O_WRONLY | O_TRUNC
      0o644,
    );

    // Verify the flags include O_CREAT, O_WRONLY, O_TRUNC
    const flags = mockOpen.mock.calls[0][1] as number;
    const { constants } = await import("node:fs");
    expect(flags & constants.O_CREAT).toBeTruthy();
    expect(flags & constants.O_WRONLY).toBeTruthy();
    expect(flags & constants.O_TRUNC).toBeTruthy();
  });

  it("writes string data through the file handle", async () => {
    await safeWriteFile("/tmp/file.txt", "hello world");

    expect(mockFileHandle.writeFile).toHaveBeenCalledWith("hello world");
  });

  it("writes Buffer data through the file handle", async () => {
    const buf = Buffer.from("binary data");
    await safeWriteFile("/tmp/file.bin", buf);

    expect(mockFileHandle.writeFile).toHaveBeenCalledWith(buf);
  });

  it("always closes the file handle after successful write", async () => {
    await safeWriteFile("/tmp/file.txt", "data");

    expect(mockFileHandle.close).toHaveBeenCalled();
    // close should be called after writeFile
    const writeOrder = mockFileHandle.writeFile.mock.invocationCallOrder[0];
    const closeOrder = mockFileHandle.close.mock.invocationCallOrder[0];
    expect(closeOrder).toBeGreaterThan(writeOrder);
  });

  it("closes file handle even if writeFile throws (try/finally)", async () => {
    mockFileHandle.writeFile.mockRejectedValue(new Error("Write failed"));

    await expect(safeWriteFile("/tmp/file.txt", "data")).rejects.toThrow("Write failed");
    expect(mockFileHandle.close).toHaveBeenCalled();
  });

  it("propagates open() errors", async () => {
    mockOpen.mockRejectedValue(new Error("Permission denied"));

    await expect(safeWriteFile("/tmp/file.txt", "data")).rejects.toThrow("Permission denied");
  });
});

// ── _clearRealpathCache ─────────────────────────────────────────────────

describe("_clearRealpathCache", () => {
  it("clears the cache so subsequent confinePath calls re-resolve", async () => {
    const { confinePath, _clearRealpathCache } = await import("../util/path-confinement.js");

    // Use subdirectory so dirname() doesn't collide with allowedDir path
    await confinePath("/tmp/allowed/sub/file1.txt", "/tmp/allowed");
    const firstCallCount = mockRealpath.mock.calls.filter(
      (call: unknown[]) => call[0] === "/tmp/allowed",
    ).length;
    expect(firstCallCount).toBe(1); // cachedRealpath resolved once

    // Clear cache
    _clearRealpathCache();

    // Second call — should re-resolve allowedDir
    await confinePath("/tmp/allowed/sub/file2.txt", "/tmp/allowed");
    const secondCallCount = mockRealpath.mock.calls.filter(
      (call: unknown[]) => call[0] === "/tmp/allowed",
    ).length;
    expect(secondCallCount).toBe(2); // re-resolved after cache clear
  });
});
