/**
 * Recording tools for the MCP server.
 *
 * Registers 3 browser recording tools on the McpServer instance:
 * - browser_start_recording: Start video capture via Puppeteer screencast
 * - browser_stop_recording: Stop recording and return results
 * - browser_screenshot_key_moment: Capture labeled moment during recording
 *
 * Uses Puppeteer v24's page.screencast() API which requires ffmpeg.
 * Recording state (active recorder, path, key moments) is tracked at
 * module level so it persists across tool calls.
 *
 * All handlers wrap their logic in try/catch and return error messages
 * as text content (never throw).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ScreenRecorder } from "puppeteer-core";
import { ensurePage } from "../browser.js";
import logger from "../util/logger.js";

// ── Module-level recording state ────────────────────────────────────────

let activeRecorder: ScreenRecorder | null = null;
let recordingPath: string = "";
let keyMoments: Array<{
  label: string;
  timestamp: number;
  screenshotPath: string;
  a11yPath?: string;
}> = [];
let recordingStartTime: number = 0;

/**
 * Register all recording tools on the given MCP server.
 */
export function registerRecordingTools(server: McpServer): void {
  // ── browser_start_recording ─────────────────────────────────────────

  server.tool(
    "browser_start_recording",
    "Start video capture of the browser page using Puppeteer screencast. Requires ffmpeg installed on the system.",
    {
      outputPath: z.string().optional(),
      format: z.enum(["mp4", "webm"]).optional(),
    },
    async ({ outputPath, format }) => {
      try {
        // Prevent double-start
        if (activeRecorder) {
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

        const page = await ensurePage();
        const effectiveFormat = format ?? "mp4";

        // Build output path
        const effectivePath =
          outputPath ??
          join(
            "output/recordings",
            `${new Date().toISOString().replace(/[:.]/g, "-")}.${effectiveFormat}`,
          );

        // Ensure output directory exists
        await mkdir(dirname(effectivePath), { recursive: true });

        // Start screencast
        const recorder = await page.screencast({
          path: effectivePath as `${string}.${typeof effectiveFormat}`,
          format: effectiveFormat,
        });

        // Store state
        activeRecorder = recorder;
        recordingPath = effectivePath;
        keyMoments = [];
        recordingStartTime = Date.now();

        logger.info(`Recording started: ${effectivePath}`);

        return {
          content: [
            {
              type: "text" as const,
              text: `Recording started. Output: ${effectivePath} (format: ${effectiveFormat})`,
            },
          ],
        };
      } catch (err) {
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
        if (!activeRecorder) {
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
        await activeRecorder.stop();

        // Calculate duration
        const durationMs = Date.now() - recordingStartTime;
        const durationSec = (durationMs / 1000).toFixed(1);

        // Build result
        const momentsText =
          keyMoments.length > 0
            ? `\nKey moments (${keyMoments.length}):\n` +
              keyMoments
                .map(
                  (m) =>
                    `  - "${m.label}" at ${(m.timestamp / 1000).toFixed(1)}s → ${m.screenshotPath}${m.a11yPath ? ` (a11y: ${m.a11yPath})` : ""}`,
                )
                .join("\n")
            : "\nNo key moments captured.";

        const path = recordingPath;

        // Clear state
        activeRecorder = null;
        recordingPath = "";
        keyMoments = [];
        recordingStartTime = 0;

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
        activeRecorder = null;
        recordingPath = "";
        keyMoments = [];
        recordingStartTime = 0;

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
      label: z.string(),
    },
    async ({ label }) => {
      try {
        if (!activeRecorder) {
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

        const page = await ensurePage();
        const timestamp = Date.now() - recordingStartTime;
        const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, "_");
        const filePrefix = `${Date.now()}-${safeLabel}`;

        // Take screenshot
        const screenshotPath = join("output/screenshots", `${filePrefix}.png`);
        await mkdir(dirname(screenshotPath), { recursive: true });
        const buffer = (await page.screenshot()) as Buffer;
        await writeFile(screenshotPath, buffer);

        // Capture a11y snapshot
        let a11yPath: string | undefined;
        try {
          const a11yFilePath = join("output/a11y", `${filePrefix}.json`);
          await mkdir(dirname(a11yFilePath), { recursive: true });
          const snapshot = await page.accessibility.snapshot({ interestingOnly: true });
          await writeFile(a11yFilePath, JSON.stringify(snapshot, null, 2));
          a11yPath = a11yFilePath;
        } catch {
          // a11y capture is optional — log and continue
          logger.warn(`Failed to capture a11y snapshot for key moment "${label}"`);
        }

        // Add to key moments
        keyMoments.push({
          label,
          timestamp,
          screenshotPath,
          a11yPath,
        });

        logger.info(
          `Key moment captured: "${label}" at ${(timestamp / 1000).toFixed(1)}s`,
        );

        return {
          content: [
            {
              type: "text" as const,
              text: `Key moment "${label}" captured at ${(timestamp / 1000).toFixed(1)}s. Screenshot: ${screenshotPath}${a11yPath ? `, A11y: ${a11yPath}` : ""}`,
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
