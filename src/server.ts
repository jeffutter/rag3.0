import { loadConfig } from "./config/schema";
import { createLogger } from "./core/logging/logger";
import { PipelineRegistry } from "./core/pipeline/registry";
import { runMCPServer } from "./io/mcp-server";
import { runWebhookServer } from "./io/webhook-server";
import { createObsidianVaultUtilityClient } from "./lib/obsidian-vault-utility-client";
import { OpenAICompatibleClient } from "./llm/openai-client";
import { VectorSearchClient } from "./retrieval/qdrant-client";
import { createRAGQueryRegistration } from "./workflows/rag-query";

const logger = createLogger("server");

/**
 * Server entry point - supports both MCP and Webhook modes.
 *
 * Usage:
 *   # MCP mode (for Claude Desktop)
 *   bun run src/server.ts --mode mcp
 *
 *   # Webhook mode (HTTP server)
 *   bun run src/server.ts --mode webhook
 *
 * Environment variables:
 *   SERVER_MODE=mcp|webhook
 *   WEBHOOK_PORT=3000
 *   WEBHOOK_HOST=0.0.0.0
 *   WEBHOOK_API_KEY=your-secret-key
 */

async function main() {
  // Determine server mode
  const args = process.argv.slice(2);
  const modeArg = args.find((arg) => arg.startsWith("--mode="))?.split("=")[1];
  const mode = modeArg || process.env.SERVER_MODE || "webhook";

  if (mode !== "mcp" && mode !== "webhook") {
    console.error(`Invalid mode: ${mode}. Must be 'mcp' or 'webhook'`);
    process.exit(1);
  }

  logger.info({
    event: "server_starting",
    mode,
    version: "0.1.0",
  });

  try {
    // Load configuration
    const config = await loadConfig();

    // Initialize LLM client
    const llmClientOptions: {
      baseURL: string;
      apiKey?: string;
      timeout?: number;
    } = {
      baseURL: config.llm.baseURL,
      timeout: config.llm.timeout,
    };

    if (config.llm.apiKey) {
      llmClientOptions.apiKey = config.llm.apiKey;
    }

    const llmClient = new OpenAICompatibleClient(llmClientOptions);

    // Initialize Qdrant vector client
    const qdrantClientConfig: {
      url: string;
      apiKey?: string;
    } = {
      url: config.qdrant.url,
    };

    if (config.qdrant.apiKey) {
      qdrantClientConfig.apiKey = config.qdrant.apiKey;
    }

    const vectorClient = new VectorSearchClient(qdrantClientConfig);

    // Initialize embedding config
    const embeddingConfig: {
      baseURL: string;
      model: string;
      apiKey?: string;
    } = {
      baseURL: config.embedding.baseURL,
      model: config.embedding.model,
    };

    if (config.embedding.apiKey) {
      embeddingConfig.apiKey = config.embedding.apiKey;
    }

    // Initialize Obsidian Vault Utility client
    const vaultClient = createObsidianVaultUtilityClient({
      baseURL: config.vault.baseURL,
    });

    // Create pipeline registry
    const pipelineRegistry = new PipelineRegistry();

    // Register pipelines
    const ragQueryPipeline = createRAGQueryRegistration({
      llmClient,
      vectorClient,
      vaultClient,
      model: config.llm.model,
      embeddingConfig,
      defaultCollection: config.qdrant.defaultCollection,
    });

    pipelineRegistry.register(ragQueryPipeline);

    logger.info({
      event: "pipelines_registered",
      count: pipelineRegistry.getAll().length,
      pipelines: pipelineRegistry.getAll().map((p) => p.name),
    });

    // Run appropriate server based on mode
    if (mode === "mcp") {
      logger.info({ event: "starting_mcp_server" });
      await runMCPServer({
        pipelineRegistry,
        serverName: "llm-orchestrator-mcp",
        serverVersion: "0.1.0",
      });
    } else {
      logger.info({ event: "starting_webhook_server" });
      const webhookOptions: {
        pipelineRegistry: PipelineRegistry;
        port: number;
        host: string;
        apiKey?: string;
      } = {
        pipelineRegistry,
        port: parseInt(process.env.WEBHOOK_PORT || "3000", 10),
        host: process.env.WEBHOOK_HOST || "0.0.0.0",
      };

      if (process.env.WEBHOOK_API_KEY) {
        webhookOptions.apiKey = process.env.WEBHOOK_API_KEY;
      }

      await runWebhookServer(webhookOptions);
    }
  } catch (error) {
    logger.fatal({
      event: "fatal_error",
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    console.error("Fatal error:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
