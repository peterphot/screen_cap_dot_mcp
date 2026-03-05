/**
 * Recording tools for the MCP server.
 *
 * Registers 3 browser recording tools on the McpServer instance:
 * - browser_start_recording: Start video capture via Puppeteer screencast
 * - browser_stop_recording: Stop recording and return results
 * - browser_screenshot_key_moment: Capture labeled moment during recording
 *
 * Uses Puppeteer v24's page.screencast() API which requires ffmpeg.
 * Recording state is managed in ../recording-state.ts to avoid circular
 * imports between this module and browser.ts.
 *
 * All handlers wrap their logic in try/catch and return error messages
 * as text content (never throw).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { join } from "node:path";
import { resolveConfigDir, confinePath, safeWriteFile } from "../util/path-confinement.js";
import { ensurePage } from "../browser.js";
import logger from "../util/logger.js";
import { transcodeMp4ToH264 } from "../util/transcode.js";
import {
  recState,
  cleanupRecordingState,
  MAX_KEY_MOMENTS,
} from "../recording-state.js";

// ── Path confinement ─────────────────────────────────────────────────────

/**
 * Read the allowed recording output directory.
 * Read lazily so env var changes and test overrides take effect.
 */
function getRecordingDir(): string {
  return resolveConfigDir("RECORDING_DIR", "./recordings");
}

/**
 * Validate and confine a path within the recording directory.
 */
async function confinePathToRecordingDir(
  filePath: string,
): Promise<{ resolvedPath: string } | { error: string }> {
  return confinePath(filePath, getRecordingDir());
}

// ── Tool registration ───────────────────────────────────────────────────

/**
 * Register all recording tools on the given MCP server.
 */
export function registerRecordingTools(server: McpServer): void {
  // ── browser_start_recording ─────────────────────────────────────────

  server.tool(
    "browser_start_recording",
    "Start video capture of the browser page using Puppeteer screencast. Requires ffmpeg installed on the system.",
    {
      outputPath: z.string().optional().describe("File path for the recording output (must be within RECORDING_DIR)"),
      format: z.enum(["mp4", "webm"]).optional().describe("Video format: mp4 (default) or webm. Requires ffmpeg."),
    },
    async ({ outputPath, format }) => {
      try {
        // Prevent double-start
        if (recState.recorder) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: Recording is already in progress. Stop the current recording before starting a new one.",
              },
            ],
            isError: true,
          };
        }

        // Concurrency guard: prevent overlapping start attempts
        if (recState.startPromise) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: A recording start is already in progress.",
              },
            ],
            isError: true,
          };
        }

        const doStart = async () => {
          const page = await ensurePage();
          const effectiveFormat = format ?? "mp4";

          // Build output path within the allowed recording directory
          const recordingDir = getRecordingDir();
          const rawPath =
            outputPath ??
            join(
              recordingDir,
              `${new Date().toISOString().replace(/[:.]/g, "-")}.${effectiveFormat}`,
            );

          // Confine path
          const pathResult = await confinePathToRecordingDir(rawPath);
          if ("error" in pathResult) {
            return {
              content: [{ type: "text" as const, text: `Error: ${pathResult.error}` }],
              isError: true,
            };
          }

          const effectivePath = pathResult.resolvedPath;

          // Ensure the extension matches the format
          if (!effectivePath.endsWith(`.${effectiveFormat}`)) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: outputPath extension must match format ".${effectiveFormat}"`,
                },
              ],
              isError: true,
            };
          }

          // Start screencast
          const recorder = await page.screencast({
            path: effectivePath as `${string}.${typeof effectiveFormat}`,
            format: effectiveFormat,
          });

          // Store state
          recState.recorder = recorder;
          recState.path = effectivePath;
          recState.keyMoments = [];
          recState.startTime = Date.now();

          logger.info(`Recording started: ${effectivePath}`);

          return {
            content: [
              {
                type: "text" as const,
                text: `Recording started. Output: ${effectivePath} (format: ${effectiveFormat})`,
              },
            ],
          };
        };

        recState.startPromise = doStart();
        try {
          return await (recState.startPromise as Promise<{
            content: Array<{ type: "text"; text: string }>;
            isError?: boolean;
          }>);
        } finally {
          recState.startPromise = null;
        }
      } catch (err) {
        // Defensive cleanup: if recorder was started but subsequent logic failed
        if (recState.recorder) {
          try {
            await recState.recorder.stop();
          } catch {
            /* best-effort */
          }
        }
        cleanupRecordingState();

        return {
          content: [
            {
              type: "text" as const,
              text: `Error starting recording: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── browser_stop_recording ──────────────────────────────────────────

  server.tool(
    "browser_stop_recording",
    "Stop the current video recording and return the file path, duration, and any captured key moments.",
    {},
    async () => {
      try {
        if (!recState.recorder) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: No recording is currently in progress. Start a recording first with browser_start_recording.",
              },
            ],
            isError: true,
          };
        }

        // Stop the recorder
        await recState.recorder.stop();

        // Transcode VP9 to H.264 for compatibility
        if (recState.path) {
          try {
            await transcodeMp4ToH264(recState.path);
          } catch (err) {
            logger.warn(`Failed to transcode recording to H.264: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        // Calculate duration
        const durationMs = Date.now() - recState.startTime;
        const durationSec = (durationMs / 1000).toFixed(1);

        // Build result
        const momentsText =
          recState.keyMoments.length > 0
            ? `\nKey moments (${recState.keyMoments.length}):\n` +
              recState.keyMoments
                .map(
                  (m) =>
                    `  - "${m.label}" at ${(m.timestamp / 1000).toFixed(1)}s → ${m.screenshotPath}${m.a11yPath ? ` (a11y: ${m.a11yPath})` : ""}`,
                )
                .join("\n")
            : "\nNo key moments captured.";

        const path = recState.path;

        // Clear state
        cleanupRecordingState();

        logger.info(`Recording stopped: ${path} (${durationSec}s)`);

        return {
          content: [
            {
              type: "text" as const,
              text: `Recording stopped. Path: ${path}, duration: ${durationSec}s${momentsText}`,
            },
          ],
        };
      } catch (err) {
        // Clear state on error to allow recovery
        cleanupRecordingState();

        return {
          content: [
            {
              type: "text" as const,
              text: `Error stopping recording: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── browser_screenshot_key_moment ───────────────────────────────────

  server.tool(
    "browser_screenshot_key_moment",
    "Capture a labeled screenshot and accessibility snapshot during an active recording. The moment is tagged with a timestamp offset from the recording start.",
    {
      label: z.string().max(200).describe("Human-readable label for this key moment (max 200 chars)"),
    },
    async ({ label }) => {
      try {
        if (!recState.recorder) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: No recording is currently in progress. Start a recording first with browser_start_recording.",
              },
            ],
            isError: true,
          };
        }

        if (recState.keyMoments.length >= MAX_KEY_MOMENTS) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: Maximum of ${MAX_KEY_MOMENTS} key moments reached for this recording.`,
              },
            ],
            isError: true,
          };
        }

        const page = await ensurePage();
        const timestamp = Date.now() - recState.startTime;
        const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, "_");
        const filePrefix = `${Date.now()}-${safeLabel}`;

        // Build paths within the recording directory
        const recordingDir = getRecordingDir();
        const screenshotRawPath = join(recordingDir, "screenshots", `${filePrefix}.png`);
        const a11yRawPath = join(recordingDir, "a11y", `${filePrefix}.json`);

        // Capture screenshot and a11y snapshot in parallel (independent operations)
        const [screenshotResult, a11yResult] = await Promise.all([
          (async () => {
            const pathResult = await confinePathToRecordingDir(screenshotRawPath);
            if ("error" in pathResult) {
              throw new Error(pathResult.error);
            }
            const buffer = (await page.screenshot()) as Buffer;
            await safeWriteFile(pathResult.resolvedPath, buffer);
            return pathResult.resolvedPath;
          })(),
          (async (): Promise<string | undefined> => {
            try {
              const pathResult = await confinePathToRecordingDir(a11yRawPath);
              if ("error" in pathResult) {
                logger.warn(`Failed to confine a11y path: ${pathResult.error}`);
                return undefined;
              }
              const snapshot = await page.accessibility.snapshot({ interestingOnly: true });
              await safeWriteFile(pathResult.resolvedPath, JSON.stringify(snapshot, null, 2));
              return pathResult.resolvedPath;
            } catch {
              logger.warn(`Failed to capture a11y snapshot for key moment "${label}"`);
              return undefined;
            }
          })(),
        ]);

        // Add to key moments
        recState.keyMoments.push({
          label,
          timestamp,
          screenshotPath: screenshotResult,
          a11yPath: a11yResult,
        });

        logger.info(
          `Key moment captured: "${label}" at ${(timestamp / 1000).toFixed(1)}s`,
        );

        return {
          content: [
            {
              type: "text" as const,
              text: `Key moment "${label}" captured at ${(timestamp / 1000).toFixed(1)}s. Screenshot: ${screenshotResult}${a11yResult ? `, A11y: ${a11yResult}` : ""}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error capturing key moment "${label}": ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
