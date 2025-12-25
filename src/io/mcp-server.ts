import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { createLogger } from "../core/logging/logger";
import type { PipelineRegistry } from "../core/pipeline/registry";

const logger = createLogger("mcp-server");

/**
 * MCP Server that exposes pipelines as tools for Claude Desktop and other MCP clients.
 *
 * Usage:
 * 1. Register pipelines in the PipelineRegistry
 * 2. Start the MCP server with runMCPServer()
 * 3. Configure Claude Desktop to use this server (stdio transport)
 */

export interface MCPServerOptions {
  pipelineRegistry: PipelineRegistry;
  serverName?: string;
  serverVersion?: string;
}

export function createMCPServer(options: MCPServerOptions) {
  const { pipelineRegistry, serverName = "llm-orchestrator-mcp", serverVersion = "0.1.0" } = options;

  // Create MCP server
  const server = new Server(
    {
      name: serverName,
      version: serverVersion,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // Handle list_tools request
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    logger.debug({ event: "list_tools_request" });

    const pipelines = pipelineRegistry.getAll();

    const tools: Tool[] = pipelines.map((pipeline) => {
      const schema = z.toJSONSchema(pipeline.inputSchema, {
        target: "openapi-3.0",
        unrepresentable: "any",
        // biome-ignore lint/suspicious/noExplicitAny: Zod's toJSONSchema returns unknown type
      }) as any;

      return {
        name: pipeline.name,
        description: pipeline.description,
        inputSchema: {
          type: "object" as const,
          ...schema,
        },
      };
    });

    logger.info({
      event: "list_tools_response",
      toolCount: tools.length,
      tools: tools.map((t) => t.name),
    });

    return { tools };
  });

  // Handle call_tool request
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    logger.info({
      event: "call_tool_request",
      toolName: name,
      arguments: args,
    });

    try {
      const result = await pipelineRegistry.execute(name, args);

      if (result.success) {
        logger.info({
          event: "call_tool_success",
          toolName: name,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result.data, null, 2),
            },
          ],
        };
      } else {
        logger.error({
          event: "call_tool_error",
          toolName: name,
          error: result.error,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `Error executing pipeline: ${result.error}`,
            },
          ],
          isError: true,
        };
      }
    } catch (error) {
      logger.error({
        event: "call_tool_exception",
        toolName: name,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

/**
 * Run the MCP server with stdio transport (for Claude Desktop).
 */
export async function runMCPServer(options: MCPServerOptions) {
  logger.info({
    event: "mcp_server_starting",
    serverName: options.serverName || "llm-orchestrator-mcp",
    serverVersion: options.serverVersion || "0.1.0",
    pipelineCount: options.pipelineRegistry.getAll().length,
  });

  const server = createMCPServer(options);

  // Create stdio transport for Claude Desktop
  const transport = new StdioServerTransport();

  // Connect server to transport
  await server.connect(transport);

  logger.debug({ event: "mcp_server_started" });

  // Handle shutdown
  process.on("SIGINT", async () => {
    logger.debug({ event: "mcp_server_shutting_down" });
    await server.close();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    logger.debug({ event: "mcp_server_shutting_down" });
    await server.close();
    process.exit(0);
  });
}
