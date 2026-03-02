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
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { FlowDefinitionSchema } from "../flow/schema.js";
import { FlowRunner } from "../flow/runner.js";
import logger from "../util/logger.js";

const FLOWS_DIR = "flows";

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
          // Load from flows/ directory
          const flowPath = join(FLOWS_DIR, `${name}.json`);
          let rawJson: string;
          try {
            rawJson = await readFile(flowPath, "utf-8");
          } catch {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Flow not found: ${flowPath}. Use browser_list_flows to see available flows.`,
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
        await mkdir(FLOWS_DIR, { recursive: true });
        const files = await readdir(FLOWS_DIR);
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
            const raw = await readFile(join(FLOWS_DIR, file), "utf-8");
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
        const filePath = join(FLOWS_DIR, `${safeName}.json`);

        await mkdir(FLOWS_DIR, { recursive: true });
        await writeFile(filePath, JSON.stringify(definition, null, 2));

        logger.info(`Flow saved: ${filePath}`);

        return {
          content: [
            {
              type: "text" as const,
              text: `Flow "${definition.name}" saved to ${filePath}`,
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
