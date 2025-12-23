import { z } from "zod";
import { Pipeline } from "../core/pipeline/builder";
import type { RegisteredPipeline } from "../core/pipeline/registry";
import { type LLMWithRAGContext, type LLMWithRAGInput, llmWithRAGStep } from "../steps/ai/llm-with-rag";
import { formatRAGOutputStep } from "../steps/utilities/format-rag-output";

/**
 * RAG Query Pipeline
 *
 * A complete pipeline that:
 * 1. Takes a user query
 * 2. Uses RAG search tool to find relevant documents
 * 3. Generates a response with the LLM
 * 4. Returns the final answer
 */

// Re-export types from step modules
export type RAGQueryPipelineContext = LLMWithRAGContext;
export type RAGQueryInput = LLMWithRAGInput;

// Input schema (must match step's interface exactly)
const ragQueryInputSchema = z.object({
  query: z.string().describe("The user query to answer"),
  systemPrompt: z.string().optional().describe("Optional system prompt override"),
}) as z.ZodType<RAGQueryInput>;

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

export type RAGQueryOutput = z.infer<typeof ragQueryOutputSchema>;

/**
 * Create the RAG query pipeline.
 */
export function createRAGQueryPipeline(contextBuilder: () => RAGQueryPipelineContext) {
  return Pipeline.start<RAGQueryInput, RAGQueryPipelineContext>(contextBuilder)
    .add("llm_with_rag", llmWithRAGStep)
    .add("format_output", formatRAGOutputStep);
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
        },
        description: "Search a specific collection",
      },
    ],
  };
}
