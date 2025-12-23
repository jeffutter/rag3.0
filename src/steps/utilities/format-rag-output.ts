import { createStep } from "../../core/pipeline/steps";
import type { CompletionResponse } from "../../llm/types";
import type { LLMWithRAGContext } from "../ai/llm-with-rag";

/**
 * Output schema for RAG query.
 */
interface RAGQueryOutput {
  answer: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Format RAG Output step for pipeline.
 *
 * This step formats the output of the LLM with RAG completion into
 * a structured response containing the answer and usage statistics.
 *
 * Used specifically in the rag-query workflow.
 *
 * @example
 * ```typescript
 * const pipeline = Pipeline.start<RAGQueryInput, RAGQueryContext>(contextBuilder)
 *   .add('llm_with_rag', llmWithRAGStep)
 *   .add('format_output', formatRAGOutputStep);
 * ```
 */
export const formatRAGOutputStep = createStep<
  CompletionResponse,
  RAGQueryOutput,
  { llm_with_rag: CompletionResponse },
  LLMWithRAGContext
>("format_output", async ({ input }) => {
  return {
    answer: input.message.content,
    usage: input.usage,
  };
});

export type { RAGQueryOutput };
