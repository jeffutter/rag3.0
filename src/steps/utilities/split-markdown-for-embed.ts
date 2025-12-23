import { createStep } from "../../core/pipeline/steps";
import { splitMarkdown } from "../../lib/markdown";
import type { FileEntry } from "./extract-files";

/**
 * Interface for chunk data from split markdown step.
 */
interface ChunkData {
  id: string;
  content: string;
  // biome-ignore lint/suspicious/noExplicitAny: Metadata structure is dynamic and unknown
  metadata: Record<string, any>;
  index: number;
  length: number;
}

/**
 * Split configuration options.
 */
interface SplitConfig {
  minChunkSize: number;
  maxChunkSize: number;
  chunkOverlap: number;
}

/**
 * Create a Split Markdown For Embed step for pipeline.
 *
 * This step splits markdown content into chunks while preserving metadata.
 * Returns an empty array on error to gracefully handle splitting failures.
 * Used specifically in the embed-documents workflow.
 *
 * @param config - Chunk size and overlap configuration
 *
 * @example
 * ```typescript
 * const splitStep = createSplitMarkdownForEmbedStep({
 *   minChunkSize: 300,
 *   maxChunkSize: 1000,
 *   chunkOverlap: 100
 * });
 * const pipeline = Pipeline.start()
 *   .flatMap('chunks', splitStep, { parallel: true });
 * ```
 */
export function createSplitMarkdownForEmbedStep(config: SplitConfig) {
  return createStep<
    { content: string; source: string; tags: string[]; path: string },
    ChunkData[],
    {
      discover: { files: FileEntry[] };
      files: FileEntry[];
      readFiles: { content: string; source: string; path: string }[];
      cleanedFiles: { content: string; source: string; tags: string[]; path: string }[];
    }
  >("splitMarkdown", async ({ input }) => {
    try {
      const chunks = await splitMarkdown(
        input.content,
        input.source,
        { source: input.source, tags: input.tags },
        {
          minChunkSize: config.minChunkSize,
          maxChunkSize: config.maxChunkSize,
          chunkOverlap: config.chunkOverlap,
        },
      );

      return chunks;
    } catch (error) {
      console.warn(`Error splitting file ${input.path}:`, error);
      return [];
    }
  });
}

export type { ChunkData, SplitConfig };
