import { loadConfig } from "./config/schema";
import { createLogger } from "./core/logging/logger";
import { runCLI } from "./io/cli";
import { createObsidianVaultUtilityClient } from "./lib/obsidian-vault-utility-client";
import { OpenAICompatibleClient } from "./llm/openai-client";
import { VectorSearchClient } from "./retrieval/qdrant-client";
import { createRAGSearchTool } from "./tools/rag-search";
import { ToolRegistry } from "./tools/registry";

const logger = createLogger("main");

async function main() {
  logger.info({ event: "startup", version: "0.1.0" });

  try {
    // Load configuration from file or environment variables
    const config = await loadConfig();

    logger.debug({
      event: "config_loaded",
      llmBaseURL: config.llm.baseURL,
      llmModel: config.llm.model,
      embeddingModel: config.embedding.model,
      qdrantURL: config.qdrant.url,
      qdrantCollection: config.qdrant.defaultCollection,
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

    // Initialize reranker config
    const rerankConfig: {
      baseURL: string;
      model?: string;
      apiKey?: string;
      useInstructions?: boolean;
      instructions?: string;
    } = {
      baseURL: config.reranker.baseURL,
    };

    if (config.reranker.model) {
      rerankConfig.model = config.reranker.model;
    }

    if (config.reranker.apiKey) {
      rerankConfig.apiKey = config.reranker.apiKey;
    }

    if (config.reranker.useInstructions !== undefined) {
      rerankConfig.useInstructions = config.reranker.useInstructions;
    }

    if (config.reranker.instructions) {
      rerankConfig.instructions = config.reranker.instructions;
    }

    // Initialize Obsidian Vault Utility client
    const vaultClient = createObsidianVaultUtilityClient({
      baseURL: config.vault.baseURL,
    });

    // Register tools
    const toolRegistry = new ToolRegistry();

    const ragSearchTool = await createRAGSearchTool({
      vectorClient,
      embeddingConfig,
      rerankConfig,
      defaultCollection: config.qdrant.defaultCollection,
      vaultClient,
    });

    toolRegistry.register(ragSearchTool);

    logger.info({
      event: "tools_registered",
      toolCount: toolRegistry.getAll().length,
      tools: toolRegistry.getAll().map((t) => t.name),
    });

    // Run CLI
    const currentDateTime = new Date().toISOString(); // RFC3339 format
    await runCLI({
      llmClient,
      tools: toolRegistry.getAll(),
      model: config.llm.model,
      systemPrompt: `You are an expert in calling tool functions. You will receive a problem and a set of possible tool functions. Based on the problem, you need to make one or more function/tool calls to achieve the goal. Please try to explore solving the problem using the available tools.

When interpreting temporal language in queries:
- "recently" or "lately" = last 7-14 days (use start_date_time)
- "this week" = start of current week to now
- "last week" = previous week's Monday to Sunday
- "this month" = start of current month to now
- "last month" = previous month's full range
Always set end_date_time to the current time for ongoing periods ("recently", "this month", etc.).

If no function can be used, please respond to the user directly using natural language.
If the given problem lacks the parameters required by the function, please ask the user for the necessary information using natural language.
If the call results are sufficient to answer the user's question, please summarize the historical results and respond to the user using natural language.
Cite sources when relevant
Be concise but thorough in your responses.

Current date and time: ${currentDateTime}
`,
      //       systemPrompt: `You are a helpful assistant with access to a personal knowledge base.
      //
      // When asked a question:
      // 1. Use the search_knowledge_base tool to find relevant information
      // 2. Synthesize the information into a clear, helpful response
      // 3. Cite sources when relevant
      //
      // Be concise but thorough in your responses.`,
    });

    logger.info({ event: "shutdown_complete" });
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
