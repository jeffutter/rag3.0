import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv-provider.js";
import { createLogger } from "../core/logging/logger";
import { NormalizingJsonSchemaValidator } from "./mcp-schema-validator";

const logger = createLogger("mcp-http-client");

/**
 * Normalizes JSON Schema to use standard formats.
 * Replaces non-standard formats like "uint" with standard JSON Schema types.
 * Handles nested schemas including $defs.
 */
function normalizeSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") {
    return schema;
  }

  // Handle arrays
  if (Array.isArray(schema)) {
    return schema.map(normalizeSchema);
  }

  // Clone the object to avoid mutation
  const normalized = { ...schema } as Record<string, unknown>;

  // Replace non-standard "uint" format with standard integer + minimum constraint
  if (normalized.format === "uint") {
    delete normalized.format;
    normalized.type = "integer";
    normalized.minimum = 0;
    logger.debug({
      event: "normalized_uint_format",
      field: normalized.description || "unknown",
    });
  }

  // Recursively normalize all nested objects (including $defs, properties, items, etc.)
  for (const key in normalized) {
    if (typeof normalized[key] === "object" && normalized[key] !== null) {
      normalized[key] = normalizeSchema(normalized[key]);
    }
  }

  return normalized;
}

export interface MCPServerConfig {
  url: string;
  name?: string | undefined;
}

/**
 * MCP HTTP client for connecting to remote MCP servers using HTTP streaming.
 *
 * This client uses the StreamableHTTPClientTransport to connect to MCP servers
 * that implement the HTTP streaming protocol (SSE).
 */
export class MCPHTTPClient {
  private client: Client;
  private transport: StreamableHTTPClientTransport;
  private connected = false;
  private config: MCPServerConfig;

  constructor(config: MCPServerConfig) {
    this.config = config;
    const url = new URL(config.url);

    logger.debug({
      event: "mcp_client_init",
      url: config.url,
      name: config.name,
    });

    this.transport = new StreamableHTTPClientTransport(url, {
      // Use default fetch implementation (Bun's fetch)
      fetch: globalThis.fetch,
    });

    // Create a normalizing validator to handle non-standard formats like "uint"
    const baseValidator = new AjvJsonSchemaValidator();
    const normalizingValidator = new NormalizingJsonSchemaValidator(baseValidator);

    this.client = new Client(
      {
        name: config.name || "rag-query-client",
        version: "1.0.0",
      },
      {
        capabilities: {
          // Specify client capabilities
          experimental: {},
          sampling: {},
        },
        // Use our custom validator that normalizes schemas
        jsonSchemaValidator: normalizingValidator,
      },
    );
  }

  /**
   * Connect to the MCP server.
   */
  async connect(): Promise<void> {
    if (this.connected) {
      logger.warn({
        event: "mcp_already_connected",
        url: this.config.url,
      });
      return;
    }

    try {
      logger.debug({
        event: "mcp_connecting",
        url: this.config.url,
      });

      // Cast transport to satisfy exactOptionalPropertyTypes
      await this.client.connect(this.transport as unknown as Parameters<typeof this.client.connect>[0]);
      this.connected = true;

      const serverInfo = this.client.getServerVersion();
      const capabilities = this.client.getServerCapabilities();

      logger.debug({
        event: "mcp_connected",
        url: this.config.url,
        serverInfo,
        capabilities,
      });
    } catch (error) {
      logger.error({
        event: "mcp_connection_failed",
        url: this.config.url,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(`Failed to connect to MCP server at ${this.config.url}: ${error}`);
    }
  }

  /**
   * List all available tools from the MCP server.
   */
  async listTools() {
    if (!this.connected) {
      throw new Error("MCP client not connected. Call connect() first.");
    }

    try {
      logger.debug({
        event: "mcp_listing_tools",
        url: this.config.url,
      });

      const response = await this.client.listTools();

      // Normalize tool schemas to use standard JSON Schema formats
      const normalizedTools = response.tools.map((tool) => ({
        ...tool,
        inputSchema: normalizeSchema(tool.inputSchema) as {
          type: string;
          properties?: Record<string, unknown> | undefined;
          required?: string[] | undefined;
          [key: string]: unknown;
        },
      }));

      logger.debug({
        event: "mcp_tools_listed",
        url: this.config.url,
        toolCount: normalizedTools.length,
        tools: normalizedTools.map((t) => t.name),
      });

      return normalizedTools;
    } catch (error) {
      logger.error({
        event: "mcp_list_tools_failed",
        url: this.config.url,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(`Failed to list tools from MCP server: ${error}`);
    }
  }

  /**
   * Call a tool on the MCP server.
   */
  async callTool(name: string, args: Record<string, unknown>) {
    if (!this.connected) {
      throw new Error("MCP client not connected. Call connect() first.");
    }

    try {
      logger.debug({
        event: "mcp_calling_tool",
        url: this.config.url,
        toolName: name,
        args,
      });

      const response = await this.client.callTool({
        name,
        arguments: args,
      });

      logger.debug({
        event: "mcp_tool_called",
        url: this.config.url,
        toolName: name,
        contentCount: Array.isArray(response.content) ? response.content.length : 0,
      });

      return response;
    } catch (error) {
      logger.error({
        event: "mcp_call_tool_failed",
        url: this.config.url,
        toolName: name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(`Failed to call tool ${name} on MCP server: ${error}`);
    }
  }

  /**
   * Disconnect from the MCP server.
   */
  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }

    try {
      logger.debug({
        event: "mcp_disconnecting",
        url: this.config.url,
      });

      await this.transport.close();
      this.connected = false;

      logger.debug({
        event: "mcp_disconnected",
        url: this.config.url,
      });
    } catch (error) {
      logger.error({
        event: "mcp_disconnect_failed",
        url: this.config.url,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(`Failed to disconnect from MCP server: ${error}`);
    }
  }

  /**
   * Get the MCP client instance for advanced usage.
   */
  getClient(): Client {
    return this.client;
  }

  /**
   * Check if the client is connected.
   */
  isConnected(): boolean {
    return this.connected;
  }
}
