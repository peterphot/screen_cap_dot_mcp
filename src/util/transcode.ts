import { execFile } from "node:child_process";
import { rename, unlink } from "node:fs/promises";

export async function transcodeMp4ToH264(filePath: string): Promise<string> {
  if (!filePath.endsWith(".mp4")) {
    return filePath;
  }

  const tmpPath = `${filePath}.h264.tmp.mp4`;

  await new Promise<void>((resolve, reject) => {
    execFile(
      "ffmpeg",
      [
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
      (err: Error | null, _stdout: string, stderr: string) => {
        if (err) {
          unlink(tmpPath).catch(() => {}).then(() => {
            reject(new Error(stderr));
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
