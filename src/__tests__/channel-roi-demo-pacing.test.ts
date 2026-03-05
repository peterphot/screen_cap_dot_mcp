/**
 * Tests for channel-roi-demo.json sleep duration reductions (PP-46).
 *
 * Validates that all sleep durations have been reduced by ~30%:
 *   10000 -> 7000, 8000 -> 5500, 3000 -> 2000, 2500 -> 1750,
 *   2000 -> 1400, 1500 -> 1000, 1000 -> 700, 500 -> 500 (unchanged)
 *
 * Also validates that the JSON remains valid and parseable.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { FlowDefinition } from "../flow/schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FLOW_PATH = join(__dirname, "../../flows/channel-roi-demo.json");

/** Recursively collect all sleep durations from nested groups */
function collectSleepDurations(steps: FlowDefinition["steps"]): number[] {
  const durations: number[] = [];
  for (const step of steps) {
    if (step.action === "sleep" && "duration" in step) {
      durations.push(step.duration);
    }
    if (step.action === "group" && "steps" in step) {
      durations.push(...collectSleepDurations(step.steps));
    }
  }
  return durations;
}

describe("channel-roi-demo.json pacing (PP-46)", () => {
  let flow: FlowDefinition;
  let durations: number[];

  beforeAll(() => {
    const raw = readFileSync(FLOW_PATH, "utf-8");
    flow = JSON.parse(raw) as FlowDefinition;
    durations = collectSleepDurations(flow.steps);
  });

  it("parses as valid JSON", () => {
    expect(flow).toBeDefined();
    expect(flow.name).toBe("channel-roi-demo");
  });

  it("has steps array", () => {
    expect(Array.isArray(flow.steps)).toBe(true);
    expect(flow.steps.length).toBeGreaterThan(0);
  });

  it("contains no sleep durations with old-only values (10000, 8000, 3000, 2500, 1500)", () => {
    // These values only appear as "old" values and are NOT targets of any reduction.
    // Note: 2000 and 1000 are excluded because they are valid targets (3000->2000, 1500->1000).
    const oldOnlyValues = [10000, 8000, 3000, 2500, 1500];
    for (const oldVal of oldOnlyValues) {
      expect(
        durations.includes(oldVal),
        `Found old sleep duration ${oldVal}ms that should have been reduced`,
      ).toBe(false);
    }
  });

  it("contains only expected reduced durations", () => {
    // Every sleep duration should be one of: 7000, 5500, 2000, 1750, 1400, 1000, 700, 500
    const allowedValues = new Set([7000, 5500, 2000, 1750, 1400, 1000, 700, 500]);
    for (const d of durations) {
      expect(
        allowedValues.has(d),
        `Sleep duration ${d}ms is not in the allowed set: ${[...allowedValues].join(", ")}`,
      ).toBe(true);
    }
  });

  it("has the expected total number of sleep steps", () => {
    // Original flow has 28 sleep steps -- count should remain the same
    expect(durations.length).toBe(28);
  });

  it("has expected duration counts matching the ~30% reduction mapping", () => {
    // Expected counts based on the mapping from original values:
    // 10000 (x3) -> 7000 (x3)
    // 8000 (x2) -> 5500 (x2)
    // 3000 (x4) -> 2000 (x4)
    // 2500 (x5) -> 1750 (x5)
    // 2000 (x8) -> 1400 (x8)
    // 1500 (x2) -> 1000 (x2)
    // 1000 (x3) -> 700 (x3)
    // 500 (x1) -> 500 (x1)
    //
    // After reduction:
    // 7000: 3 instances
    // 5500: 2 instances
    // 2000: 4 instances
    // 1750: 5 instances
    // 1400: 8 instances
    // 1000: 2 instances
    // 700: 3 instances
    // 500: 1 instance

    const countOf = (val: number) => durations.filter((d) => d === val).length;

    expect(countOf(7000)).toBe(3);
    expect(countOf(5500)).toBe(2);
    expect(countOf(2000)).toBe(4);
    expect(countOf(1750)).toBe(5);
    expect(countOf(1400)).toBe(8);
    expect(countOf(1000)).toBe(2);
    expect(countOf(700)).toBe(3);
    expect(countOf(500)).toBe(1);
  });
});
