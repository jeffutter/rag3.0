import { createLogger } from "../core/logging/logger";
import { createStep } from "../core/pipeline/steps";

const logger = createLogger("embedding");

/**
 * Embedding generation step.
 *
 * Supports multiple backends through the OpenAI-compatible interface:
 * - llama.cpp with embedding models
 * - Local sentence-transformers via a wrapper
 * - OpenAI embeddings API
 */

export interface EmbeddingConfig {
	baseURL: string;
	model: string;
	apiKey?: string;
}

export interface EmbeddingInput {
	text: string;
	metadata?: Record<string, unknown>;
}

export interface EmbeddingOutput {
	embedding: number[];
	text: string;
	metadata?: Record<string, unknown>;
}

export function createEmbeddingStep<TAccumulatedState = Record<string, never>>(
	config: EmbeddingConfig,
) {
	return createStep<EmbeddingInput, EmbeddingOutput, TAccumulatedState>(
		"generate_embedding",
		async ({ input }) => {
			const response = await fetch(`${config.baseURL}/embeddings`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...(config.apiKey && { Authorization: `Bearer ${config.apiKey}` }),
				},
				body: JSON.stringify({
					model: config.model,
					input: input.text,
				}),
			});

			if (!response.ok) {
				throw new Error(`Embedding request failed: ${response.statusText}`);
			}

			const data = (await response.json()) as {
				data: Array<{ embedding: number[] }>;
			};

			logger.debug({
				event: "embedding_generated",
				textLength: input.text.length,
				embeddingDim: data.data[0]?.embedding.length,
			});

			if (!data.data[0]) {
				throw new Error("No embedding data returned from API");
			}

			const result: EmbeddingOutput = {
				embedding: data.data[0].embedding,
				text: input.text,
			};

			if (input.metadata) {
				result.metadata = input.metadata;
			}

			return result;
		},
		{
			retry: {
				maxAttempts: 3,
				backoffMs: 1000,
				retryableErrors: ["ECONNRESET", "ETIMEDOUT"],
			},
		},
	);
}
