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

    const iCv = args.indexOf("-c:v");
    expect(iCv).toBeGreaterThanOrEqual(0);
    expect(args[iCv + 1]).toBe("libx264");

    const iPixFmt = args.indexOf("-pix_fmt");
    expect(iPixFmt).toBeGreaterThanOrEqual(0);
    expect(args[iPixFmt + 1]).toBe("yuv420p");

    const iMovflags = args.indexOf("-movflags");
    expect(iMovflags).toBeGreaterThanOrEqual(0);
    expect(args[iMovflags + 1]).toBe("+faststart");
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

    const iPreset = args.indexOf("-preset");
    expect(iPreset).toBeGreaterThanOrEqual(0);
    expect(args[iPreset + 1]).toBe("fast");

    const iCrf = args.indexOf("-crf");
    expect(iCrf).toBeGreaterThanOrEqual(0);
    expect(args[iCrf + 1]).toBe("23");

    const iCa = args.indexOf("-c:a");
    expect(iCa).toBeGreaterThanOrEqual(0);
    expect(args[iCa + 1]).toBe("aac");

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

  it("still throws ffmpeg error when unlink also fails", async () => {
    execFileFails("codec not found");
    mockUnlink.mockRejectedValue(new Error("ENOENT: no such file"));

    await expect(transcodeMp4ToH264("/tmp/recording.mp4")).rejects.toThrow(
      /codec not found/,
    );
  });

  it("returns input path unchanged for non-.mp4 extensions", async () => {
    const result = await transcodeMp4ToH264("/tmp/recording.avi");
    expect(result).toBe("/tmp/recording.avi");
    expect(mockExecFile).not.toHaveBeenCalled();
  });
});
