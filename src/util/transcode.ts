/**
 * Transcode MP4 recordings to H.264 with yuv420p for maximum compatibility.
 * Implementation pending (PP-41).
 */
export async function transcodeMp4ToH264(filePath: string): Promise<string> {
  if (!filePath.endsWith(".mp4")) {
    return filePath;
  }
  throw new Error("Not implemented");
}
