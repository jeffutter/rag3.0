import { z } from "zod";
import { createStep } from "../../core/pipeline/steps";

/**
 * Schema for embedded document chunks.
 */
const EmbeddedDocumentSchema = z.object({
  id: z.string().uuid(),
  content: z.string(),
  vector: z.array(z.number()),
  metadata: z.record(z.string(), z.any()),
  tags: z.array(z.string()),
});

/**
 * Input schema for the Format Embed Output step.
 */
const FormatEmbedOutputInputSchema = z.object({
  documents: z.array(EmbeddedDocumentSchema),
  totalFiles: z.number().int().nonnegative(),
  totalChunks: z.number().int().nonnegative(),
});

/**
 * Output schema for the Format Embed Output step.
 */
const FormatEmbedOutputOutputSchema = z.object({
  documents: z.array(EmbeddedDocumentSchema),
  totalFiles: z.number().int().nonnegative(),
  totalChunks: z.number().int().nonnegative(),
});

type FormatEmbedOutputInput = z.input<typeof FormatEmbedOutputInputSchema>;
type FormatEmbedOutputOutput = z.infer<typeof FormatEmbedOutputOutputSchema>;
type EmbeddedDocument = z.infer<typeof EmbeddedDocumentSchema>;

/**
 * Format Embed Output step for pipeline.
 *
 * This step formats the final output of the embedding workflow,
 * ensuring the structure matches the expected output schema.
 * It's primarily a pass-through step that validates the final output.
 *
 * @example
 * ```typescript
 * const pipeline = Pipeline.start<FormatEmbedOutputInput>()
 *   .add('format', formatEmbedOutputStep);
 *
 * const result = await pipeline.execute({
 *   documents: [...],
 *   totalFiles: 10,
 *   totalChunks: 50
 * });
 * ```
 */
export const formatEmbedOutputStep = createStep<FormatEmbedOutputInput, FormatEmbedOutputOutput>(
  "formatEmbedOutput",
  async ({ input }) => {
    // Validate and pass through
    const validated = FormatEmbedOutputInputSchema.parse(input);
    return validated;
  },
);

// Export schemas for testing and validation
export { FormatEmbedOutputInputSchema, FormatEmbedOutputOutputSchema, EmbeddedDocumentSchema };
export type { FormatEmbedOutputInput, FormatEmbedOutputOutput, EmbeddedDocument };
