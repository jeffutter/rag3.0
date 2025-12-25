import { z } from "zod";
import { createLogger } from "../../core/logging/logger";
import { createStep } from "../../core/pipeline/steps";
import {
	type SparseEmbeddingResult,
	generateSparseEmbeddings,
} from "../../lib/sparse-embeddings";

const logger = createLogger("generate-sparse-embeddings-step");

/**
 * Input schema for the Generate Sparse Embeddings step.
 */
const GenerateSparseEmbeddingsInputSchema = z.object({
	contents: z.array(z.string()).min(1),
	endpoint: z.string().url().optional(),
});

/**
 * Schema for individual sparse embedding results.
 */
const SparseEmbeddingSchema = z.object({
	embedding: z.object({
		values: z.array(z.number()),
		indices: z.array(z.number()),
	}),
});

/**
 * Output schema for the Generate Sparse Embeddings step.
 */
const GenerateSparseEmbeddingsOutputSchema = z.object({
	embeddings: z.array(SparseEmbeddingSchema),
});

type GenerateSparseEmbeddingsInput = z.input<
	typeof GenerateSparseEmbeddingsInputSchema
>;
type GenerateSparseEmbeddingsOutput = z.infer<
	typeof GenerateSparseEmbeddingsOutputSchema
>;

/**
 * Generate Sparse Embeddings step for pipeline.
 *
 * This step calls the BM42 sparse embeddings API to generate sparse vector embeddings
 * for an array of text contents. Unlike dense embeddings, sparse embeddings return
 * only non-zero values with their corresponding indices, making them more efficient
 * for certain retrieval tasks.
 *
 * Request: POST { documents: string[] }
 * Response: { embeddings: [{ values: number[], indices: number[] }], model_name: string, num_documents: number }
 *
 * Features:
 * - Batch processing of multiple texts in a single API call
 * - Configurable endpoint (defaults to http://llama.home.jeffutter.com:9080/embed)
 * - Retry logic for transient failures (configured via createStep options)
 * - Response validation
 *
 * @example
 * ```typescript
 * const pipeline = Pipeline.start<GenerateSparseEmbeddingsInput>()
 *   .add('embed', generateSparseEmbeddingsStep);
 *
 * const result = await pipeline.execute({
 *   contents: ['text 1', 'text 2', 'text 3'],
 *   endpoint: 'http://llama.home.jeffutter.com:9080/embed'
 * });
 * ```
 */
export const generateSparseEmbeddingsStep = createStep<
	GenerateSparseEmbeddingsInput,
	GenerateSparseEmbeddingsOutput
>(
	"generateSparseEmbeddings",
	async ({ input }) => {
		logger.debug({
			event: "step_start",
			contentCount: input.contents.length,
			endpoint: input.endpoint,
		});

		// Validate input
		const validated = GenerateSparseEmbeddingsInputSchema.parse(input);

		logger.trace({
			event: "step_input_validated",
			contentCount: validated.contents.length,
			contentLengths: validated.contents.map((c) => c.length),
			endpoint: validated.endpoint,
		});

		// Call the utility function to generate sparse embeddings
		const embeddings = await generateSparseEmbeddings(
			validated.contents,
			validated.endpoint,
		);

		logger.debug({
			event: "step_complete",
			embeddingCount: embeddings.length,
			sparsitySummary: embeddings.map((e) => ({
				nonZeroCount: e.embedding.values.length,
				indicesCount: e.embedding.indices.length,
			})),
		});

		return { embeddings };
	},
	{
		retry: {
			maxAttempts: 3,
			backoffMs: 1000,
			retryableErrors: [
				"ECONNRESET",
				"ETIMEDOUT",
				"ECONNREFUSED",
				"RATE_LIMIT",
			],
		},
	},
);

// Export schemas for testing and validation
export {
	GenerateSparseEmbeddingsInputSchema,
	GenerateSparseEmbeddingsOutputSchema,
};
export type { GenerateSparseEmbeddingsInput, GenerateSparseEmbeddingsOutput };
