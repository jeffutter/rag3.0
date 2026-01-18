import { createLogger } from "../../core/logging/logger";
import { createStep } from "../../core/pipeline/steps";
import { generateEmbeddings } from "../../lib/embeddings";
import type { FileEntry } from "../utilities/extract-files";
import type { ChunkData } from "../utilities/split-markdown-for-embed";

const logger = createLogger("generate-embeddings");

/**
 * Interface for chunk with embedding attached.
 */
interface ChunkWithEmbedding {
  id: string;
  content: string;
  // biome-ignore lint/suspicious/noExplicitAny: Metadata structure is dynamic and unknown
  metadata: Record<string, any>;
  embedding: number[];
}

/**
 * Embedding configuration.
 */
interface EmbeddingConfig {
  endpoint: string;
  model: string;
}

/**
 * Create a Generate Embeddings For Batch step for pipeline.
 *
 * This step generates embeddings for a batch of chunks and merges them back.
 * Returns an empty array on error to gracefully handle embedding failures.
 * Used specifically in the embed-documents workflow.
 *
 * @param config - Embedding endpoint and model configuration
 *
 * @example
 * ```typescript
 * const embedStep = createGenerateEmbeddingsForBatchStep({
 *   endpoint: 'https://llama.home.jeffutter.com/v1/embeddings',
 *   model: 'qwen3-embedding'
 * });
 * const pipeline = Pipeline.start()
 *   .map('embeddedBatches', embedStep, { parallel: false });
 * ```
 */
export function createGenerateEmbeddingsForBatchStep(config: EmbeddingConfig) {
  return createStep<
    ChunkData[],
    ChunkWithEmbedding[],
    {
      discover: { files: FileEntry[] };
      files: FileEntry[];
      readFiles: { content: string; source: string; path: string }[];
      cleanedFiles: { content: string; source: string; tags: string[]; path: string }[];
      chunks: ChunkData[];
      chunksWithEOT: ChunkData[];
      batches: ChunkData[][];
    }
  >("generateEmbeddings", async ({ input }) => {
    try {
      const contents = input.map((chunk) => chunk.content);

      const embeddings = await generateEmbeddings(contents, config.endpoint, config.model);

      // Merge chunks with their embeddings
      const chunksWithEmbeddings: ChunkWithEmbedding[] = [];

      for (let i = 0; i < input.length; i++) {
        const chunk = input[i];
        const embedding = embeddings[i];

        if (!embedding || !chunk) {
          logger.warn({ event: "missing_data", index: i }, "Missing embedding or chunk");
          continue;
        }

        chunksWithEmbeddings.push({
          id: chunk.id,
          content: chunk.content,
          metadata: {
            ...chunk.metadata,
            chunk_idx: chunk.index,
          },
          embedding: embedding.embedding,
        });
      }

      return chunksWithEmbeddings;
    } catch (error) {
      logger.error({ event: "embedding_error", error }, "Error generating embeddings for batch");
      return [];
    }
  });
}

export type { ChunkWithEmbedding, EmbeddingConfig };
