import { createLogger } from "../../core/logging/logger";
import { createStep } from "../../core/pipeline/steps";
import type { ObsidianVaultUtilityClient } from "../../lib/obsidian-vault-utility-client";
import type { OpenAICompatibleClient } from "../../llm/openai-client";
import type { CompletionResponse, ToolDefinition } from "../../llm/types";
import type { VectorSearchClient } from "../../retrieval/qdrant-client";
import { MCPHTTPClient, type MCPServerConfig } from "../../lib/mcp-http-client";
import { loadMCPTools } from "../../lib/mcp-tool-adapter";
import { createRAGSearchTool } from "../../tools/rag-search";

const logger = createLogger("llm-with-rag-step");

/**
 * Input schema for LLM with RAG step.
 */
interface LLMWithRAGInput {
  query: string;
  systemPrompt?: string;
}

/**
 * Context for LLM with RAG step.
 */
interface LLMWithRAGContext {
  llmClient: OpenAICompatibleClient;
  vectorClient: VectorSearchClient;
  vaultClient: ObsidianVaultUtilityClient;
  model: string;
  embeddingConfig: {
    baseURL: string;
    model: string;
    apiKey?: string;
  };
  defaultCollection: string;
  mcpServers?: MCPServerConfig[];
}

/**
 * LLM With RAG step for pipeline.
 *
 * This step executes an LLM completion with RAG (Retrieval Augmented Generation) support.
 * It creates a RAG search tool that the LLM can use to query the knowledge base,
 * and runs a tool loop to handle multiple tool calls if needed.
 *
 * Used specifically in the rag-query workflow.
 *
 * @example
 * ```typescript
 * const pipeline = Pipeline.start<LLMWithRAGInput, LLMWithRAGContext>(contextBuilder)
 *   .add('llm_with_rag', llmWithRAGStep);
 * ```
 */
export const llmWithRAGStep = createStep<
  LLMWithRAGInput,
  CompletionResponse,
  // biome-ignore lint/complexity/noBannedTypes: Empty state for first step in pipeline
  {},
  LLMWithRAGContext
>("llm_with_rag", async ({ input, context }) => {
  const ragTool = await createRAGSearchTool({
    vectorClient: context.vectorClient,
    embeddingConfig: context.embeddingConfig,
    defaultCollection: context.defaultCollection,
    vaultClient: context.vaultClient,
  });

  // Collect all tools (RAG + MCP)
  const tools: ToolDefinition[] = [ragTool as any];

  // Load MCP tools if configured
  if (context.mcpServers && context.mcpServers.length > 0) {
    for (const serverConfig of context.mcpServers) {
      try {
        const mcpClient = new MCPHTTPClient(serverConfig);
        await mcpClient.connect();
        const mcpTools = await loadMCPTools(mcpClient);
        tools.push(...mcpTools);
      } catch (error) {
        logger.warn({
          event: "mcp_tools_load_failed",
          url: serverConfig.url,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue with other servers even if one fails
      }
    }
  }

  const systemPrompt =
    input.systemPrompt ||
    `You are a helpful assistant with access to a knowledge base. Use the search_knowledge_base tool to find relevant information when needed.`;

  return await context.llmClient.completeWithToolLoop(
    {
      model: context.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: input.query },
      ],
      // biome-ignore lint/suspicious/noExplicitAny: Tool type inference issue between defineTool and ToolDefinition
      tools: tools as any,
      toolChoice: "auto",
      temperature: 0.7,
    },
    5,
  );
});

export type { LLMWithRAGInput, LLMWithRAGContext };
