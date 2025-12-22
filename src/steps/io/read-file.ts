import { z } from "zod";
import { createStep } from "../../core/pipeline/steps";
import { readFile } from "../../lib/file-io";

/**
 * Input schema for the Read File step.
 */
const ReadFileInputSchema = z.object({
  path: z.string(),
});

/**
 * Output schema for the Read File step.
 */
const ReadFileOutputSchema = z.object({
  content: z.string(),
  source: z.string(),
});

type ReadFileInput = z.input<typeof ReadFileInputSchema>;
type ReadFileOutput = z.infer<typeof ReadFileOutputSchema>;

/**
 * Read File step for pipeline.
 *
 * This step reads the content of a file from the filesystem using Bun's file API.
 * Returns both the content and the source path for use in downstream processing.
 *
 * @example
 * ```typescript
 * const pipeline = Pipeline.start<ReadFileInput>()
 *   .add('read', readFileStep);
 *
 * const result = await pipeline.execute({
 *   path: './docs/example.md'
 * });
 * ```
 */
export const readFileStep = createStep<ReadFileInput, ReadFileOutput>("readFile", async ({ input }) => {
  // Validate input
  const validated = ReadFileInputSchema.parse(input);

  // Use the file-io utility function to read the file
  const result = await readFile(validated.path);

  return result;
});

// Export schemas for testing and validation
export { ReadFileInputSchema, ReadFileOutputSchema };
export type { ReadFileInput, ReadFileOutput };
