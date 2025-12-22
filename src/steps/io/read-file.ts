import { z } from "zod";
import { createStep } from "../../core/pipeline/steps";

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

  // Use Bun.file() to read the file
  const file = Bun.file(validated.path);

  // Check if file exists
  if (!(await file.exists())) {
    throw new Error(`File not found: ${validated.path}`);
  }

  // Read file content as text
  const content = await file.text();

  return {
    content,
    source: validated.path,
  };
});

// Export schemas for testing and validation
export { ReadFileInputSchema, ReadFileOutputSchema };
export type { ReadFileInput, ReadFileOutput };
