import { createStep } from "../../core/pipeline/steps";
import { readFile } from "../../lib/file-io";
import type { FileEntry } from "../utilities/extract-files";

/**
 * Read File For Embed step for pipeline.
 *
 * This step reads a file and preserves the path field for downstream processing.
 * Returns an empty array on error to gracefully handle file read failures.
 * Used specifically in the embed-documents workflow.
 *
 * @example
 * ```typescript
 * const pipeline = Pipeline.start()
 *   .flatMap('readFiles', readFileForEmbedStep, { parallel: true });
 * ```
 */
export const readFileForEmbedStep = createStep<
  FileEntry,
  { content: string; source: string; path: string }[],
  { discover: { files: FileEntry[] }; files: FileEntry[] }
>("readFile", async ({ input }) => {
  try {
    const result = await readFile(input.path);
    return [{ ...result, path: input.path }];
  } catch (error) {
    console.warn(`Error reading file ${input.path}:`, error);
    return [];
  }
});
