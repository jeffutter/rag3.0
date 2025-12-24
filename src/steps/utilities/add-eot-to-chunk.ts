import { createStep } from "../../core/pipeline/steps";
import { addEOT } from "../../lib/text-processing";
import type { FileEntry } from "./extract-files";
import type { ChunkData } from "./split-markdown-for-embed";

/**
 * Create an Add EOT To Chunk step for pipeline.
 *
 * This step adds an end-of-text token to chunk content if provided.
 * Returns the chunk unchanged on error or if no EOT token is configured.
 * Used specifically in the embed-documents workflow.
 *
 * @param eotToken - Optional end-of-text token to append
 *
 * @example
 * ```typescript
 * const addEOTStep = createAddEOTToChunkStep('<|endoftext|>');
 * const pipeline = Pipeline.start()
 *   .map('chunksWithEOT', addEOTStep, { parallel: false });
 * ```
 */
export function createAddEOTToChunkStep(eotToken?: string) {
  return createStep<
    ChunkData,
    ChunkData,
    {
      discover: { files: FileEntry[] };
      files: FileEntry[];
      readFiles: { content: string; source: string; path: string }[];
      cleanedFiles: { content: string; source: string; tags: string[]; path: string }[];
      chunks: ChunkData[];
    }
  >("addEOT", async ({ input }) => {
    // If no EOT token configured, return chunk as-is
    if (!eotToken) {
      return input;
    }

    try {
      const content = addEOT(input.content, eotToken);

      return {
        ...input,
        content,
      };
    } catch (error) {
      console.warn(`Error adding EOT to chunk ${input.id}:`, error);
      return input;
    }
  });
}
