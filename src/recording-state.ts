/**
 * Recording state module - shared state for video recording lifecycle.
 *
 * Extracted into a standalone leaf module to avoid circular imports
 * between browser.ts and tools/recording.ts. Only depends on
 * puppeteer-core types and the logger utility.
 */

import type { ScreenRecorder } from "puppeteer-core";
import logger from "./util/logger.js";

// ── Types ───────────────────────────────────────────────────────────────

/** A labeled moment captured during a recording. */
export interface KeyMoment {
  label: string;
  timestamp: number;
  screenshotPath: string;
  a11yPath?: string;
}

// ── Constants ───────────────────────────────────────────────────────────

/** Maximum number of key moments per recording. */
export const MAX_KEY_MOMENTS = 100;

// ── Module-level recording state ────────────────────────────────────────

/**
 * Mutable recording state object. Exported so tool handlers can read and
 * write fields directly. All lifecycle functions below also operate on it.
 */
export const recState = {
  recorder: null as ScreenRecorder | null,
  path: "",
  keyMoments: [] as KeyMoment[],
  startTime: 0,
  startPromise: null as Promise<unknown> | null,
};

// ── State management ────────────────────────────────────────────────────

/**
 * Clear all recording state.
 * Called on stop, error recovery, and browser disconnect.
 */
export function cleanupRecordingState(): void {
  recState.recorder = null;
  recState.path = "";
  recState.keyMoments = [];
  recState.startTime = 0;
  recState.startPromise = null;
}

/**
 * Check whether a recording is currently active.
 */
export function isRecordingActive(): boolean {
  return recState.recorder !== null;
}

/**
 * Stop the active recording (best-effort) and clean up state.
 * Safe to call when no recording is active.
 */
export async function stopActiveRecording(): Promise<void> {
  if (recState.recorder) {
    try {
      await recState.recorder.stop();
    } catch (err) {
      logger.warn(`Best-effort recorder stop failed: ${(err as Error).message}`);
    }
  }
  cleanupRecordingState();
}
