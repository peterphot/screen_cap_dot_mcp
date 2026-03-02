/**
 * Flow tools for the MCP server.
 *
 * Registers 3 flow management tools on the McpServer instance:
 * - browser_run_flow: Execute a saved or inline flow definition
 * - browser_list_flows: List saved flow files in flows/ directory
 * - browser_save_flow: Save a flow definition to flows/ directory
 *
 * All handlers wrap their logic in try/catch and return error messages
 * as text content (never throw).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readdir, readFile, writeFile, mkdir, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { FlowDefinitionSchema } from "../flow/schema.js";
import { FlowRunner } from "../flow/runner.js";
import logger from "../util/logger.js";

// ── Path confinement ─────────────────────────────────────────────────────

/**
 * Read the allowed flows directory.
 * Read lazily so env var changes and test overrides take effect.
 * Defaults to flows/ relative to cwd.
 * Rejects filesystem root to prevent vacuous confinement.
 */
function getFlowsDir(): string {
  const raw = process.env.FLOWS_DIR ?? "flows";
  const resolved = resolve(raw);
  if (resolved === "/") {
    throw new Error("FLOWS_DIR must not resolve to the filesystem root.");
  }
  return resolved;
}

/**
 * Validate that a resolved path is within the allowed directory.
 * Performs a prefix check to prevent path traversal.
 */
function isWithinDir(resolvedPath: string, allowedDir: string): boolean {
  return resolvedPath.startsWith(allowedDir + "/") || resolvedPath === allowedDir;
}

/**
 * Validate and confine a path within the flows directory.
 * Returns the resolved path or an error message.
 */
async function confinePathToFlowDir(
  filePath: string,
): Promise<{ resolvedPath: string } | { error: string }> {
  const flowsDir = getFlowsDir();
  const resolvedPath = resolve(filePath);

  if (!isWithinDir(resolvedPath, flowsDir)) {
    return { error: `Path must be within ${flowsDir}` };
  }

  await mkdir(dirname(resolvedPath), { recursive: true });

  // Post-mkdir symlink check
  const realDir = await realpath(dirname(resolvedPath));
  const realFlowsDir = await realpath(flowsDir);
  if (!isWithinDir(realDir, realFlowsDir)) {
    return { error: `Path must be within ${flowsDir} (symlink detected)` };
  }

  return { resolvedPath: resolve(realDir, basename(resolvedPath)) };
}

/**
 * Register all flow tools on the given MCP server.
 */
export function registerFlowTools(server: McpServer): void {
  // ── browser_run_flow ──────────────────────────────────────────────────

  server.tool(
    "browser_run_flow",
    "Execute a saved flow by name (from flows/ directory) or an inline flow definition. Optionally override recording config.",
    {
      name: z.string().optional(),
      flow: z.any().optional(),
      record: z.boolean().optional(),
    },
    async ({ name, flow, record }) => {
      try {
        let definition;

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
          definition = parsed.data;
        } else if (name) {
          // Reject path traversal sequences
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
          definition = parsed.data;
        } else {
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

        const runner = new FlowRunner();
        const result = await runner.run(definition, record);

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

        const flows: Array<{ file: string; name: string; description?: string; steps: number }> = [];

        for (const file of jsonFiles) {
          try {
            const raw = await readFile(join(flowsDir, file), "utf-8");
            const parsed = FlowDefinitionSchema.safeParse(JSON.parse(raw));
            if (parsed.success) {
              flows.push({
                file,
                name: parsed.data.name,
                description: parsed.data.description,
                steps: parsed.data.steps.length,
              });
            } else {
              flows.push({ file, name: "(invalid)", steps: 0 });
            }
          } catch {
            flows.push({ file, name: "(unreadable)", steps: 0 });
          }
        }

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
      flow: z.any(),
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

        await writeFile(pathResult.resolvedPath, JSON.stringify(definition, null, 2));

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
}
