/**
 * VP9-to-H.264 post-processing for Puppeteer screencast recordings.
 *
 * Puppeteer's page.screencast() produces VP9 inside an MP4 container,
 * which macOS QuickTime cannot play. This utility re-encodes .mp4 files
 * to H.264 via a spawned ffmpeg process. Non-.mp4 files are left untouched.
 *
 * Uses atomic replace: writes to a temp file, then rename() over the
 * original. On ffmpeg failure the temp file is cleaned up and the
 * original VP9 file is preserved.
 */
import { execFile } from "node:child_process";
import { rename, unlink } from "node:fs/promises";

/** Transcode an MP4 file from VP9 to H.264. No-op for non-.mp4 paths. */
export async function transcodeMp4ToH264(filePath: string): Promise<string> {
  if (!filePath.endsWith(".mp4")) {
    return filePath;
  }

  const tmpPath = `${filePath}.h264.tmp.mp4`;

  await new Promise<void>((resolve, reject) => {
    execFile(
      "ffmpeg",
      [
        "-loglevel", "error",
        "-i", filePath,
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-movflags", "+faststart",
        "-y",
        tmpPath,
      ],
      { timeout: 300_000, maxBuffer: 10 * 1024 * 1024 },
      (err: Error | null, _stdout: string, stderr: string) => {
        if (err) {
          unlink(tmpPath).catch(() => {}).then(() => {
            reject(new Error(`ffmpeg transcode failed: ${stderr}`, { cause: err }));
          });
          return;
        }
        resolve();
      },
    );
  });

  await rename(tmpPath, filePath);
  return filePath;
}
