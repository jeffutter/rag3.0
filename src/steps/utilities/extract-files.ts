import { createStep } from "../../core/pipeline/steps";

/**
 * Interface for file entries from discovery.
 */
interface FileEntry {
  path: string;
  name: string;
}

/**
 * Extract Files step for pipeline.
 *
 * This step extracts the files array from a discover result object.
 * It's a simple transformation step used in the embed-documents workflow.
 *
 * @example
 * ```typescript
 * const pipeline = Pipeline.start()
 *   .add('discover', discoverFilesStep)
 *   .add('files', extractFilesStep);
 * ```
 */
export const extractFilesStep = createStep<{ files: FileEntry[] }, FileEntry[], { discover: { files: FileEntry[] } }>(
  "extractFiles",
  async ({ input }) => {
    return input.files;
  },
);

export type { FileEntry };
