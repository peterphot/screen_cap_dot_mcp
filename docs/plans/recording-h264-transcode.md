# Plan: Fix Recording QuickTime Compatibility — VP9 → H.264 Transcode (PP-39)

## Overview

Puppeteer's `page.screencast()` outputs VP9 codec inside an MP4 container. QuickTime on macOS cannot play VP9 in MP4 — it only supports H.264/H.265. Since macOS is the primary dev platform, MP4 recordings are currently unusable without manual conversion.

ffprobe confirms: `Video: vp9 (Profile 1), gbrp, 1920x992` + a duplicated MOOV atom.

## Approach

**Post-process MP4 recordings with ffmpeg after Puppeteer finishes writing.** Transcode VP9 → H.264 automatically. WebM recordings are left untouched (VP9 is standard for WebM). ffmpeg is already a system prerequisite for Puppeteer screencast.

## Architecture

### New Module
- `src/util/transcode.ts` — `transcodeMp4ToH264()` utility wrapping ffmpeg via `child_process.execFile`

### Modified Modules
- `src/flow/runner.ts` — Call transcode after `recorder.stop()` in flow execution
- `src/tools/recording.ts` — Call transcode after `recState.recorder.stop()` in MCP tool

## Key Decisions

- **Always transcode MP4, never WebM** — not configurable (VP9 in MP4 is unplayable on macOS)
- **Best-effort**: transcode failure warns but doesn't fail the recording/flow (VP9 file still exists)
- **No new npm deps** — uses system ffmpeg via `child_process.execFile`
- **Atomic replace**: write to temp file, then `rename()` over original

## Task Breakdown

### [T001] Test: transcode utility (PP-40)
- **Type**: Test
- **File**: `src/__tests__/transcode.test.ts`
- **Description**: Write tests mocking `execFile`, `rename`, `unlink`:
  - No-op for `.webm` files
  - Correct ffmpeg args (`libx264`, `yuv420p`, `faststart`)
  - Rename on success, unlink temp on failure
  - Error includes ffmpeg stderr
- **Dependencies**: None

### [T002] Implement: transcode utility (PP-41)
- **Type**: Implement
- **File**: `src/util/transcode.ts`
- **Description**: Implement `transcodeMp4ToH264(filePath: string): Promise<string>`
  - Guard: No-op if file doesn't end in `.mp4`
  - Spawn ffmpeg: `ffmpeg -i <input> -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p -c:a aac -movflags +faststart -y <tmp>`
  - `-pix_fmt yuv420p` fixes the `gbrp` colorspace issue
  - `-movflags +faststart` fixes the duplicated MOOV atom
  - Atomic replace: write to `${path}.h264.tmp.mp4`, then `rename()` over original
  - Cleanup on failure: `unlink` temp file, throw with ffmpeg stderr
- **Dependencies**: T001

### [T003] Integrate: flow runner transcode (PP-42)
- **Type**: Implement
- **Files**: `src/flow/runner.ts`, `src/__tests__/flow-runner.test.ts`
- **Description**: After `recorder.stop()` (~line 212), call `transcodeMp4ToH264(recordingPath)` with try/catch that logs a warning on failure. Mock the transcode module in flow-runner tests.
- **Dependencies**: T002

### [T004] Integrate: recording tool transcode (PP-43)
- **Type**: Implement
- **Files**: `src/tools/recording.ts`, `src/__tests__/recording.test.ts`
- **Description**: After `recState.recorder.stop()` (~line 206), call `transcodeMp4ToH264(recState.path)` with try/catch that logs a warning on failure. Mock the transcode module in recording tests.
- **Dependencies**: T002

## Files to Modify

| File | Action |
|------|--------|
| `src/util/transcode.ts` | Create |
| `src/__tests__/transcode.test.ts` | Create |
| `src/flow/runner.ts` | Add transcode call after recorder.stop() |
| `src/__tests__/flow-runner.test.ts` | Add mock for transcode module |
| `src/tools/recording.ts` | Add transcode call after recorder.stop() |
| `src/__tests__/recording.test.ts` | Add mock for transcode module |

## Success Criteria

- `npm run build` — passes
- `npm test` — all tests pass
- Run flow with recording: `browser_run_flow` with `record: true`
- Open output `recording.mp4` in QuickTime — plays correctly
- Verify with ffprobe: codec is `h264` not `vp9`, colorspace is `yuv420p` not `gbrp`
