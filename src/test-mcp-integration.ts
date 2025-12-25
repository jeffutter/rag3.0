/**
 * Test script for MCP integration with rag-query workflow.
 *
 * Usage:
 *   bun run src/test-mcp-integration.ts
 */

import { loadConfig } from "./config/schema";
import { createLogger } from "./core/logging/logger";
import { createObsidianVaultUtilityClient } from "./lib/obsidian-vault-utility-client";
import { OpenAICompatibleClient } from "./llm/openai-client";
import { VectorSearchClient } from "./retrieval/qdrant-client";
import { createRAGQueryPipeline } from "./workflows/rag-query";

const logger = createLogger("test-mcp");

async function main() {
  logger.info({ event: "test_starting" });

  try {
    // Load configuration
    const config = await loadConfig();

    logger.info({
      event: "config_loaded",
      mcpServers: config.mcp.servers,
    });

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

    // Create RAG query pipeline with MCP servers
    logger.info({
      event: "creating_pipeline",
      mcpServerCount: config.mcp.servers.length,
    });

    const pipeline = createRAGQueryPipeline(() => ({
      llmClient,
      vectorClient,
      vaultClient,
      model: config.llm.model,
      embeddingConfig,
      defaultCollection: config.qdrant.defaultCollection,
      mcpServers: config.mcp.servers,
    }));

    // Test query
    const testQuery = "What tasks are available?";
    logger.info({
      event: "executing_pipeline",
      query: testQuery,
    });

    const result = await pipeline.execute({
      query: testQuery,
    });

    logger.info({
      event: "pipeline_complete",
      resultKeys: Object.keys(result),
    });

    console.log("\n=== Test Query ===");
    console.log(testQuery);
    console.log("\n=== Response ===");
    console.log(JSON.stringify(result, null, 2));

    logger.info({ event: "test_complete" });
  } catch (error) {
    logger.error({
      event: "test_failed",
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    console.error("Test failed:", error);
    process.exit(1);
  }
}

main();
