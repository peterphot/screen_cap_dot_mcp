/**
 * Screen Cap MCP Server - Entry Point
 *
 * MCP server that maintains a persistent browser connection via CDP
 * for browser automation, screenshot capture, and video recording.
 *
 * Creates the McpServer, registers tool groups, and connects
 * via StdioServerTransport for communication with MCP clients.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import logger from "./util/logger.js";
import { registerNavigationTools } from "./tools/navigation.js";
import { registerObservationTools } from "./tools/observation.js";
import { registerWaitingTools } from "./tools/waiting.js";
import { registerScrollingTools } from "./tools/scrolling.js";
import { registerRecordingTools, cleanupRecordingState } from "./tools/recording.js";

// ── Server Setup ────────────────────────────────────────────────────────

const server = new McpServer({
  name: "screen-cap",
  version: "0.1.0",
});

// ── Register Tool Groups ────────────────────────────────────────────────

registerNavigationTools(server);
registerObservationTools(server);
registerWaitingTools(server);
registerScrollingTools(server);
registerRecordingTools(server);

// ── Start Server ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("Screen Cap MCP Server running on stdio");
}

main().catch((err) => {
  logger.error(`Fatal error: ${(err as Error).message}`);
  process.exit(1);
});

// ── Graceful Shutdown ────────────────────────────────────────────────────

function gracefulShutdown(): void {
  cleanupRecordingState();
  process.exit(0);
}

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);
