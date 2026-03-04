/**
 * Unit tests for transcode utility (src/util/transcode.ts)
 *
 * Tests verify:
 * - No-op for .webm files (returns input path unchanged)
 * - Correct ffmpeg args: libx264, yuv420p, -movflags +faststart
 * - rename() called on success (atomic replace)
 * - unlink() temp file on ffmpeg failure
 * - Error message includes ffmpeg stderr
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Setup ──────────────────────────────────────────────────────────

const mockExecFile = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

const mockRename = vi.fn();
const mockUnlink = vi.fn();

vi.mock("node:fs/promises", () => ({
  rename: (...args: unknown[]) => mockRename(...args),
  unlink: (...args: unknown[]) => mockUnlink(...args),
}));

import { transcodeMp4ToH264 } from "../util/transcode.js";

// ── Setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockRename.mockResolvedValue(undefined);
  mockUnlink.mockResolvedValue(undefined);
});

// ── Helper ──────────────────────────────────────────────────────────────

/**
 * Make mockExecFile call the callback with success (no error).
 */
function execFileSucceeds() {
  mockExecFile.mockImplementation(
    (
      _cmd: string,
      _args: string[],
      callback: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      callback(null, "", "");
    },
  );
}

/**
 * Make mockExecFile call the callback with an error and stderr.
 */
function execFileFails(stderr: string) {
  mockExecFile.mockImplementation(
    (
      _cmd: string,
      _args: string[],
      callback: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      callback(new Error("ffmpeg exited with code 1"), "", stderr);
    },
  );
}

// ── No-op for .webm ─────────────────────────────────────────────────────

describe("transcodeMp4ToH264", () => {
  it("returns input path unchanged for .webm files", async () => {
    const result = await transcodeMp4ToH264("/tmp/recording.webm");

    expect(result).toBe("/tmp/recording.webm");
    expect(mockExecFile).not.toHaveBeenCalled();
    expect(mockRename).not.toHaveBeenCalled();
  });

  // ── Correct ffmpeg args ─────────────────────────────────────────────

  it("spawns ffmpeg with correct codec and pixel format args", async () => {
    execFileSucceeds();

    await transcodeMp4ToH264("/tmp/recording.mp4");

    expect(mockExecFile).toHaveBeenCalledTimes(1);
    const args = mockExecFile.mock.calls[0][1] as string[];

    expect(args).toContain("-c:v");
    expect(args).toContain("libx264");
    expect(args).toContain("-pix_fmt");
    expect(args).toContain("yuv420p");
    expect(args).toContain("-movflags");
    expect(args).toContain("+faststart");
  });

  it("passes input file as -i argument and temp file as output", async () => {
    execFileSucceeds();

    await transcodeMp4ToH264("/tmp/recording.mp4");

    const callArgs = mockExecFile.mock.calls[0];
    const cmd = callArgs[0] as string;
    const args = callArgs[1] as string[];

    expect(cmd).toBe("ffmpeg");

    // -i <input>
    const iIdx = args.indexOf("-i");
    expect(iIdx).toBeGreaterThanOrEqual(0);
    expect(args[iIdx + 1]).toBe("/tmp/recording.mp4");

    // output is the temp file
    const lastArg = args[args.length - 1];
    expect(lastArg).toBe("/tmp/recording.mp4.h264.tmp.mp4");
  });

  it("includes -preset fast, -crf 23, -c:a aac, and -y flags", async () => {
    execFileSucceeds();

    await transcodeMp4ToH264("/tmp/recording.mp4");

    const args = mockExecFile.mock.calls[0][1] as string[];

    expect(args).toContain("-preset");
    expect(args).toContain("fast");
    expect(args).toContain("-crf");
    expect(args).toContain("23");
    expect(args).toContain("-c:a");
    expect(args).toContain("aac");
    expect(args).toContain("-y");
  });

  // ── rename() on success ─────────────────────────────────────────────

  it("renames temp file to original path on success", async () => {
    execFileSucceeds();

    await transcodeMp4ToH264("/tmp/recording.mp4");

    expect(mockRename).toHaveBeenCalledWith(
      "/tmp/recording.mp4.h264.tmp.mp4",
      "/tmp/recording.mp4",
    );
  });

  it("returns original path on success", async () => {
    execFileSucceeds();

    const result = await transcodeMp4ToH264("/tmp/recording.mp4");

    expect(result).toBe("/tmp/recording.mp4");
  });

  // ── unlink() temp file on ffmpeg failure ────────────────────────────

  it("unlinks temp file when ffmpeg fails", async () => {
    execFileFails("Encoding error: invalid codec");

    await expect(transcodeMp4ToH264("/tmp/recording.mp4")).rejects.toThrow();

    expect(mockUnlink).toHaveBeenCalledWith("/tmp/recording.mp4.h264.tmp.mp4");
  });

  it("does not rename when ffmpeg fails", async () => {
    execFileFails("Encoding error");

    await expect(transcodeMp4ToH264("/tmp/recording.mp4")).rejects.toThrow();

    expect(mockRename).not.toHaveBeenCalled();
  });

  // ── Error message includes stderr ───────────────────────────────────

  it("includes ffmpeg stderr in thrown error message", async () => {
    execFileFails("Unknown encoder 'libx265'");

    await expect(transcodeMp4ToH264("/tmp/recording.mp4")).rejects.toThrow(
      /Unknown encoder 'libx265'/,
    );
  });
});
