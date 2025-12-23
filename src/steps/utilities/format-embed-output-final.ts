import { createStep } from "../../core/pipeline/steps";
import type { ChunkWithEmbedding } from "../ai/generate-embeddings-for-batch";
import type { ChunkData } from "./split-markdown-for-embed";
import type { FileEntry } from "./extract-files";

/**
 * Schema for embedded document chunks.
 */
interface EmbeddedDocument {
  id: string;
  content: string;
  vector: number[];
  // biome-ignore lint/suspicious/noExplicitAny: Metadata structure is dynamic and unknown
  metadata: Record<string, any>;
  tags: string[];
}

/**
 * Output structure for the embedding workflow.
 */
interface EmbedDocumentsOutput {
  documents: EmbeddedDocument[];
  totalFiles: number;
  totalChunks: number;
}

/**
 * Format Embed Output Final step for pipeline.
 *
 * This step formats the final output of the embedding workflow by:
 * - Converting chunks with embeddings to embedded documents
 * - Extracting total file count from pipeline state
 * - Extracting total chunk count from pipeline state
 *
 * Used specifically in the embed-documents workflow.
 *
 * @example
 * ```typescript
 * const pipeline = Pipeline.start()
 *   .add('output', formatEmbedOutputFinalStep);
 * ```
 */
export const formatEmbedOutputFinalStep = createStep<
  ChunkWithEmbedding[],
  {
    documents: EmbeddedDocument[];
    totalFiles: number;
    totalChunks: number;
  },
  {
    discover: { files: FileEntry[] };
    files: FileEntry[];
    readFiles: { content: string; source: string; path: string }[];
    cleanedFiles: { content: string; source: string; tags: string[]; path: string }[];
    chunks: ChunkData[];
    chunksWithEOT: ChunkData[];
    batches: ChunkData[][];
    embeddedBatches: ChunkWithEmbedding[][];
    embedded: ChunkWithEmbedding[];
  }
>("formatOutput", async ({ input, state }) => {
  // Get total files from the files step
  const files = state.files;

  // Convert chunks with embeddings to embedded documents
  const documents: EmbeddedDocument[] = input.map((chunk) => ({
    id: chunk.id,
    content: chunk.content,
    vector: chunk.embedding,
    metadata: chunk.metadata,
    tags: (chunk.metadata.tags as string[]) || [],
  }));

  // Get total chunks from the chunks step (before EOT)
  const allChunks = state.chunks;

  return {
    documents,
    totalFiles: files.length,
    totalChunks: allChunks.length,
  };
});

export type { EmbeddedDocument, EmbedDocumentsOutput };
