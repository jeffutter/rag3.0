import { z } from "zod";
import { createLogger } from "../core/logging/logger";
import type { ToolDefinition } from "../llm/types";
import type { MCPHTTPClient } from "./mcp-http-client";

const logger = createLogger("mcp-tool-adapter");

/**
 * Converts JSON Schema to Zod schema.
 *
 * Handles both object schemas and primitive types (for array items, etc.)
 */
function jsonSchemaToZod(schema: {
  type: string;
  properties?: Record<string, any> | undefined;
  required?: string[] | undefined;
  items?: any;
  enum?: any[];
  [key: string]: unknown;
}): z.ZodTypeAny {
  const description = schema.description as string | undefined;

  // Handle primitive types (often used in array items)
  switch (schema.type) {
    case "string": {
      if (schema.enum) {
        const enumValues = schema.enum as [string, ...string[]];
        let zodType = z.enum(enumValues);
        if (description) {
          zodType = zodType.describe(description);
        }
        return zodType;
      }
      let stringType = z.string();
      if (description) {
        stringType = stringType.describe(description);
      }
      return stringType;
    }

    case "number":
    case "integer": {
      let numberType = z.number();
      if (description) {
        numberType = numberType.describe(description);
      }
      return numberType;
    }

    case "boolean": {
      let booleanType = z.boolean();
      if (description) {
        booleanType = booleanType.describe(description);
      }
      return booleanType;
    }

    case "array": {
      if (schema.items) {
        const itemSchema = jsonSchemaToZod(schema.items);
        let arrayType = z.array(itemSchema);
        if (description) {
          arrayType = arrayType.describe(description);
        }
        return arrayType;
      }
      let unknownArrayType = z.array(z.unknown());
      if (description) {
        unknownArrayType = unknownArrayType.describe(description);
      }
      return unknownArrayType;
    }

    case "object":
      // Handle object type below
      break;

    default:
      logger.debug({
        event: "unknown_schema_type",
        type: schema.type,
        message: "Falling back to z.unknown()",
      });
      return z.unknown();
  }

  // Handle object type
  const properties = schema.properties || {};
  const required = schema.required || [];

  const zodShape: Record<string, z.ZodTypeAny> = {};

  for (const [key, propSchema] of Object.entries(properties)) {
    const prop = propSchema as any;
    let zodType = jsonSchemaToZod(prop);

    // Make optional if not required
    if (!required.includes(key)) {
      zodType = zodType.optional();
    }

    zodShape[key] = zodType;
  }

  return z.object(zodShape);
}

/**
 * Converts an MCP tool to a ToolDefinition that can be used with the LLM client.
 */
export function createToolFromMCP(
  mcpClient: MCPHTTPClient,
  mcpTool: {
    name: string;
    description?: string | undefined;
    inputSchema: {
      type: string;
      properties?: Record<string, any> | undefined;
      required?: string[] | undefined;
      [key: string]: unknown;
    };
  },
): ToolDefinition {
  logger.debug({
    event: "converting_mcp_tool",
    toolName: mcpTool.name,
    hasDescription: !!mcpTool.description,
  });

  const parameters = jsonSchemaToZod(mcpTool.inputSchema);

  return {
    name: mcpTool.name,
    description: mcpTool.description || `MCP tool: ${mcpTool.name}`,
    parameters,
    execute: async (args: any) => {
      logger.debug({
        event: "executing_mcp_tool",
        toolName: mcpTool.name,
        args,
      });

      try {
        const result = await mcpClient.callTool(mcpTool.name, args);

        // Extract text content from MCP response
        // MCP tools return content as an array of content items
        const textContent: string[] = [];

        if ("content" in result && Array.isArray(result.content)) {
          for (const item of result.content) {
            if (typeof item === "object" && item !== null && "type" in item && item.type === "text" && "text" in item) {
              textContent.push(String(item.text));
            }
          }
        }

        logger.debug({
          event: "mcp_tool_result",
          toolName: mcpTool.name,
          textContentCount: textContent.length,
        });

        logger.trace({
          event: "mcp_tool_full_result",
          toolName: mcpTool.name,
          result,
        });

        // Return combined text content or the full result
        return textContent.length > 0 ? textContent.join("\n\n") : result;
      } catch (error) {
        logger.error({
          event: "mcp_tool_execution_failed",
          toolName: mcpTool.name,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  };
}

/**
 * Loads all tools from an MCP server and converts them to ToolDefinitions.
 */
export async function loadMCPTools(mcpClient: MCPHTTPClient): Promise<ToolDefinition[]> {
  logger.debug({
    event: "loading_mcp_tools",
  });

  const mcpTools = await mcpClient.listTools();

  logger.debug({
    event: "mcp_tools_fetched",
    count: mcpTools.length,
    tools: mcpTools.map((t) => t.name),
  });

  const toolDefinitions = mcpTools.map((tool) => createToolFromMCP(mcpClient, tool));

  logger.debug({
    event: "mcp_tools_converted",
    count: toolDefinitions.length,
  });

  return toolDefinitions;
}
