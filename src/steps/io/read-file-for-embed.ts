import { createLogger } from "../../core/logging/logger";
import { createStep } from "../../core/pipeline/steps";
import { readFile } from "../../lib/file-io";
import type { FileEntry } from "../utilities/extract-files";

const logger = createLogger("read-file-step");

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
    logger.warn({
      event: "file_read_error",
      path: input.path,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
});
