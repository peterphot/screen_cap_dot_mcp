/**
 * Flow tools for the MCP server.
 *
 * Registers 4 flow management tools on the McpServer instance:
 * - browser_run_flow: Execute a saved or inline flow definition
 * - browser_validate_flow: Dry-run validation of a flow (no actions executed)
 * - browser_list_flows: List saved flow files in flows/ directory
 * - browser_save_flow: Save a flow definition to flows/ directory
 *
 * All handlers wrap their logic in try/catch and return error messages
 * as text content (never throw).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readdir, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { resolveConfigDir, confinePath, safeWriteFile } from "../util/path-confinement.js";
import { FlowDefinitionSchema } from "../flow/schema.js";
import type { FlowDefinition } from "../flow/schema.js";
import { FlowRunner } from "../flow/runner.js";
import { FlowValidator } from "../flow/validator.js";
import logger from "../util/logger.js";

// ── Shared result type ───────────────────────────────────────────────────

type ErrorResult = {
  content: [{ type: "text"; text: string }];
  isError: true;
};

// ── Path confinement ─────────────────────────────────────────────────────

/**
 * Read the allowed flows directory.
 * Read lazily so env var changes and test overrides take effect.
 */
function getFlowsDir(): string {
  return resolveConfigDir("FLOWS_DIR", "./flows");
}

/**
 * Validate and confine a path within the flows directory.
 */
async function confinePathToFlowDir(
  filePath: string,
): Promise<{ resolvedPath: string } | { error: string }> {
  return confinePath(filePath, getFlowsDir());
}

// ── Shared helpers ───────────────────────────────────────────────────────

/**
 * Validate a flow name for path traversal sequences.
 * Returns an ErrorResult if the name is invalid, undefined otherwise.
 */
function validateFlowName(name: string): ErrorResult | undefined {
  if (name.includes("/") || name.includes("\\") || name.includes("..")) {
    return {
      content: [
        {
          type: "text" as const,
          text: "Invalid flow name: must not contain '/', '\\', or '..'",
        },
      ],
      isError: true,
    };
  }
  return undefined;
}

/**
 * Load a flow definition from a named file or inline object.
 * Returns the parsed FlowDefinition on success, or an ErrorResult on failure.
 */
async function loadFlowDefinition(
  name?: string,
  flow?: unknown,
): Promise<FlowDefinition | ErrorResult> {
  if (flow) {
    // Inline flow definition
    const parsed = FlowDefinitionSchema.safeParse(flow);
    if (!parsed.success) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Invalid flow definition: ${parsed.error.message}`,
          },
        ],
        isError: true,
      };
    }
    return parsed.data;
  }

  if (name) {
    // Reject path traversal sequences
    const nameError = validateFlowName(name);
    if (nameError) return nameError;

    // Load from flows/ directory with path confinement
    const flowsDir = getFlowsDir();
    const flowPath = join(flowsDir, `${name}.json`);
    const pathResult = await confinePathToFlowDir(flowPath);
    if ("error" in pathResult) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${pathResult.error}`,
          },
        ],
        isError: true,
      };
    }

    let rawJson: string;
    try {
      rawJson = await readFile(pathResult.resolvedPath, "utf-8");
    } catch {
      return {
        content: [
          {
            type: "text" as const,
            text: `Flow not found: ${name}.json. Use browser_list_flows to see available flows.`,
          },
        ],
        isError: true,
      };
    }

    const parsed = FlowDefinitionSchema.safeParse(JSON.parse(rawJson));
    if (!parsed.success) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Invalid flow file ${flowPath}: ${parsed.error.message}`,
          },
        ],
        isError: true,
      };
    }
    return parsed.data;
  }

  return {
    content: [
      {
        type: "text" as const,
        text: "Error: provide either 'name' (to load from flows/) or 'flow' (inline definition).",
      },
    ],
    isError: true,
  };
}

/**
 * Check if a loadFlowDefinition result is an error.
 */
function isErrorResult(result: FlowDefinition | ErrorResult): result is ErrorResult {
  return "isError" in result;
}

/**
 * Register all flow tools on the given MCP server.
 */
export function registerFlowTools(server: McpServer): void {
  // ── browser_run_flow ──────────────────────────────────────────────────

  server.tool(
    "browser_run_flow",
    "Execute a saved flow by name (from flows/ directory) or an inline flow definition. Optionally override recording config. Use 'section' to run only a specific top-level named group.",
    {
      name: z.string().optional().describe("Name of a saved flow to load from flows/ directory"),
      flow: z.unknown().optional().describe("Inline flow definition object (alternative to name)"),
      record: z.boolean().optional().describe("Override recording config (true to record, false to skip)"),
      section: z.string().optional().describe("Run only the top-level group step whose 'name' matches this value. Must be an exact match against a top-level group name; throws if not found."),
    },
    async ({ name, flow, record, section }) => {
      try {
        const loaded = await loadFlowDefinition(name, flow);
        if (isErrorResult(loaded)) return loaded;
        const definition = loaded;

        const runner = new FlowRunner();
        const result = await runner.run(definition, record, section);

        const successCount = result.steps.filter((s) => s.success).length;
        const failCount = result.steps.length - successCount;

        const lines = [
          `Flow "${result.flowName}" completed in ${result.totalDurationMs}ms`,
          `Steps: ${successCount} passed, ${failCount} failed (${result.steps.length} total)`,
          `Output: ${result.outputDir}`,
          `Manifest: ${result.manifestPath}`,
        ];

        if (result.recordingPath) {
          lines.push(`Recording: ${result.recordingPath}`);
        }

        if (failCount > 0) {
          lines.push("");
          lines.push("Failed steps:");
          for (const step of result.steps.filter((s) => !s.success)) {
            lines.push(`  - Step ${step.stepIndex} (${step.action}): ${step.error}`);
          }
        }

        logger.info(`Flow "${result.flowName}" executed: ${successCount}/${result.steps.length} passed`);

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error running flow: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── browser_list_flows ────────────────────────────────────────────────

  server.tool(
    "browser_list_flows",
    "List all saved flow definitions in the flows/ directory with their names and descriptions.",
    {},
    async () => {
      try {
        const flowsDir = getFlowsDir();
        await mkdir(flowsDir, { recursive: true });
        const files = await readdir(flowsDir);
        const jsonFiles = files.filter((f) => f.endsWith(".json"));

        if (jsonFiles.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No flows found in flows/ directory. Use browser_save_flow to create one.",
              },
            ],
          };
        }

        const flows = await Promise.all(
          jsonFiles.map(async (file) => {
            try {
              const raw = await readFile(join(flowsDir, file), "utf-8");
              const parsed = FlowDefinitionSchema.safeParse(JSON.parse(raw));
              if (parsed.success) {
                return {
                  file,
                  name: parsed.data.name,
                  description: parsed.data.description,
                  steps: parsed.data.steps.length,
                };
              }
              return { file, name: "(invalid)" as const, steps: 0 };
            } catch {
              return { file, name: "(unreadable)" as const, steps: 0 };
            }
          }),
        );

        return {
          content: [{ type: "text" as const, text: JSON.stringify(flows, null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error listing flows: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── browser_save_flow ─────────────────────────────────────────────────

  server.tool(
    "browser_save_flow",
    "Save a flow definition to the flows/ directory as a JSON file.",
    {
      flow: z.unknown().describe("Flow definition object to save (must match FlowDefinitionSchema)"),
    },
    async ({ flow }) => {
      try {
        const parsed = FlowDefinitionSchema.safeParse(flow);
        if (!parsed.success) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Invalid flow definition: ${parsed.error.message}`,
              },
            ],
            isError: true,
          };
        }

        const definition = parsed.data;
        const safeName = definition.name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
        const flowsDir = getFlowsDir();
        const filePath = join(flowsDir, `${safeName}.json`);

        const pathResult = await confinePathToFlowDir(filePath);
        if ("error" in pathResult) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${pathResult.error}`,
              },
            ],
            isError: true,
          };
        }

        await safeWriteFile(pathResult.resolvedPath, JSON.stringify(definition, null, 2));

        logger.info(`Flow saved: ${pathResult.resolvedPath}`);

        return {
          content: [
            {
              type: "text" as const,
              text: `Flow "${definition.name}" saved to ${pathResult.resolvedPath}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error saving flow: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── browser_validate_flow ───────────────────────────────────────────

  server.tool(
    "browser_validate_flow",
    "Dry-run a saved or inline flow: checks whether all selectors, refs, and match targets resolve to existing elements without executing any actions. Returns a per-step pass/fail report.",
    {
      name: z.string().optional().describe("Name of a saved flow to load from flows/ directory"),
      flow: z.unknown().optional().describe("Inline flow definition object (alternative to name)"),
      timeout: z.number().nonnegative().finite().max(300_000).optional().describe("Timeout in ms for each selector check (default: 5000)"),
    },
    async ({ name, flow, timeout }) => {
      try {
        const loaded = await loadFlowDefinition(name, flow);
        if (isErrorResult(loaded)) return loaded;
        const definition = loaded;

        const validator = new FlowValidator();
        const report = await validator.validate(definition, { timeout: timeout ?? 5000 });

        const okCount = report.steps.filter((s) => s.status === "ok").length;
        const missingCount = report.steps.filter((s) => s.status === "missing").length;
        const skipCount = report.steps.filter((s) => s.status === "skip").length;

        const lines = [
          `Validation ${report.valid ? "PASS" : "FAIL"}: "${definition.name}"`,
          `Steps: ${okCount} ok, ${missingCount} missing, ${skipCount} skip (${report.steps.length} total)`,
        ];

        if (missingCount > 0) {
          lines.push("");
          lines.push("Missing elements:");
          for (const step of report.steps.filter((s) => s.status === "missing")) {
            lines.push(`  - Step ${step.index} (${step.action}): ${step.detail}`);
          }
        }

        lines.push("");
        lines.push(JSON.stringify(report, null, 2));

        logger.info(
          `Flow "${definition.name}" validated: ${report.valid ? "PASS" : "FAIL"} ` +
            `(${okCount} ok, ${missingCount} missing, ${skipCount} skip)`,
        );

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error validating flow: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
