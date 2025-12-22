import { z } from "zod";
import { Pipeline } from "../core/pipeline/builder";
import type { RegisteredPipeline } from "../core/pipeline/registry";
import { createStep } from "../core/pipeline/steps";
import type { OpenAICompatibleClient } from "../llm/openai-client";
import type { CompletionResponse } from "../llm/types";
import type { VectorSearchClient } from "../retrieval/qdrant-client";
import { createRAGSearchTool } from "../tools/rag-search";

/**
 * RAG Query Pipeline
 *
 * A complete pipeline that:
 * 1. Takes a user query
 * 2. Uses RAG search tool to find relevant documents
 * 3. Generates a response with the LLM
 * 4. Returns the final answer
 */

export interface RAGQueryPipelineContext {
  llmClient: OpenAICompatibleClient;
  vectorClient: VectorSearchClient;
  model: string;
  embeddingConfig: {
    baseURL: string;
    model: string;
    apiKey?: string;
  };
  defaultCollection: string;
}

// Input/Output schemas
const ragQueryInputSchema = z.object({
  query: z.string().describe("The user query to answer"),
  collection: z.string().optional().describe("Optional collection name override"),
  systemPrompt: z.string().optional().describe("Optional system prompt override"),
});

const ragQueryOutputSchema = z.object({
  answer: z.string().describe("The generated answer"),
  usage: z
    .object({
      promptTokens: z.number(),
      completionTokens: z.number(),
      totalTokens: z.number(),
    })
    .describe("Token usage statistics"),
  sources: z
    .array(
      z.object({
        id: z.union([z.string(), z.number()]),
        score: z.number(),
        content: z.string().optional(),
      }),
    )
    .optional()
    .describe("Source documents used"),
});

export type RAGQueryInput = z.infer<typeof ragQueryInputSchema>;
export type RAGQueryOutput = z.infer<typeof ragQueryOutputSchema>;

/**
 * Create the RAG query pipeline.
 */
export function createRAGQueryPipeline(contextBuilder: () => RAGQueryPipelineContext) {
  // Step 1: Execute LLM with RAG tool
  const llmStep = createStep<
    RAGQueryInput,
    CompletionResponse,
    // biome-ignore lint/complexity/noBannedTypes: Empty state for first step in pipeline
    {},
    RAGQueryPipelineContext
  >("llm_with_rag", async ({ input, context }) => {
    const ragTool = createRAGSearchTool({
      vectorClient: context.vectorClient,
      embeddingConfig: context.embeddingConfig,
      defaultCollection: input.collection || context.defaultCollection,
    });

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
        tools: [ragTool as any],
        toolChoice: "auto",
        temperature: 0.7,
      },
      5,
    );
  });

  // Step 2: Format the output
  const formatStep = createStep<
    CompletionResponse,
    RAGQueryOutput,
    { llm_with_rag: CompletionResponse },
    RAGQueryPipelineContext
  >("format_output", async ({ input }) => {
    return {
      answer: input.message.content,
      usage: input.usage,
    };
  });

  return Pipeline.start<RAGQueryInput, RAGQueryPipelineContext>(contextBuilder)
    .add("llm_with_rag", llmStep)
    .add("format_output", formatStep);
}

/**
 * Create a registered pipeline for the RAG query workflow.
 */
export function createRAGQueryRegistration(
  context: RAGQueryPipelineContext,
): RegisteredPipeline<RAGQueryInput, RAGQueryOutput, RAGQueryPipelineContext> {
  return {
    name: "rag_query",
    description:
      "Answer questions using RAG (Retrieval Augmented Generation). Searches the knowledge base for relevant information and generates a comprehensive answer.",
    inputSchema: ragQueryInputSchema,
    outputSchema: ragQueryOutputSchema,
    pipeline: createRAGQueryPipeline(() => context),
    contextBuilder: () => context,
    tags: ["rag", "query", "search"],
    examples: [
      {
        input: {
          query: "What is the BFF project?",
        },
        description: "Ask about a specific project",
      },
      {
        input: {
          query: "Search my notes for information about TypeScript",
          collection: "dev-notes",
        },
        description: "Search a specific collection",
      },
    ],
  };
}
