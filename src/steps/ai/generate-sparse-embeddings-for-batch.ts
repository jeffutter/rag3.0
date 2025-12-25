import { createLogger } from "../../core/logging/logger";
import { createStep } from "../../core/pipeline/steps";
import {
	type SparseEmbedding,
	generateSparseEmbeddings,
} from "../../lib/sparse-embeddings";
import type { FileEntry } from "../utilities/extract-files";
import type { ChunkData } from "../utilities/split-markdown-for-embed";

const logger = createLogger("generate-sparse-embeddings-batch-step");

/**
 * Interface for chunk with sparse embedding attached.
 */
interface ChunkWithSparseEmbedding {
	id: string;
	content: string;
	// biome-ignore lint/suspicious/noExplicitAny: Metadata structure is dynamic and unknown
	metadata: Record<string, any>;
	sparseEmbedding: SparseEmbedding;
}

/**
 * Sparse embedding configuration.
 */
interface SparseEmbeddingConfig {
	endpoint?: string;
}

/**
 * Create a Generate Sparse Embeddings For Batch step for pipeline.
 *
 * This step generates sparse embeddings for a batch of chunks and merges them back.
 * Returns an empty array on error to gracefully handle embedding failures.
 * Used specifically in workflows that need sparse embeddings (BM42).
 *
 * @param config - Optional sparse embedding endpoint configuration
 *
 * @example
 * ```typescript
 * const embedStep = createGenerateSparseEmbeddingsForBatchStep({
 *   endpoint: 'http://llama.home.jeffutter.com:9080/embed'
 * });
 * const pipeline = Pipeline.start()
 *   .map('embeddedBatches', embedStep, { parallel: false });
 * ```
 */
export function createGenerateSparseEmbeddingsForBatchStep(
	config: SparseEmbeddingConfig = {},
) {
	return createStep<
		ChunkData[],
		ChunkWithSparseEmbedding[],
		{
			discover: { files: FileEntry[] };
			files: FileEntry[];
			readFiles: { content: string; source: string; path: string }[];
			cleanedFiles: {
				content: string;
				source: string;
				tags: string[];
				path: string;
			}[];
			chunks: ChunkData[];
			chunksWithEOT: ChunkData[];
			batches: ChunkData[][];
		}
	>("generateSparseEmbeddings", async ({ input }) => {
		logger.debug({
			event: "batch_step_start",
			chunkCount: input.length,
			endpoint: config.endpoint,
		});

		try {
			const contents = input.map((chunk) => chunk.content);

			logger.trace({
				event: "batch_step_contents_extracted",
				chunkCount: contents.length,
				contentLengths: contents.map((c) => c.length),
			});

			const embeddings = await generateSparseEmbeddings(
				contents,
				config.endpoint,
			);

			logger.debug({
				event: "batch_step_embeddings_received",
				embeddingCount: embeddings.length,
			});

			// Merge chunks with their sparse embeddings
			const chunksWithEmbeddings: ChunkWithSparseEmbedding[] = [];

			for (let i = 0; i < input.length; i++) {
				const chunk = input[i];
				const embedding = embeddings[i];

				if (!embedding || !chunk) {
					logger.error({
						event: "batch_step_missing_data",
						index: i,
						hasEmbedding: !!embedding,
						hasChunk: !!chunk,
					});
					continue;
				}

				chunksWithEmbeddings.push({
					id: chunk.id,
					content: chunk.content,
					metadata: {
						...chunk.metadata,
						chunk_idx: chunk.index,
					},
					sparseEmbedding: embedding.embedding,
				});
			}

			logger.info({
				event: "batch_step_complete",
				inputChunks: input.length,
				outputChunks: chunksWithEmbeddings.length,
				avgNonZeroElements:
					chunksWithEmbeddings.reduce((sum, c) => sum + c.sparseEmbedding.values.length, 0) /
					chunksWithEmbeddings.length,
			});

			return chunksWithEmbeddings;
		} catch (error) {
			logger.error({
				event: "batch_step_error",
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				chunkCount: input.length,
				endpoint: config.endpoint,
			});
			return [];
		}
	});
}

export type { ChunkWithSparseEmbedding, SparseEmbeddingConfig };
