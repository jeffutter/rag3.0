import { z } from "zod";
import { createStep } from "../../core/pipeline/steps";

/**
 * Input schema for the Add EOT step.
 */
const AddEOTInputSchema = z.object({
  content: z.string(),
  eotToken: z.string().optional(),
});

/**
 * Output schema for the Add EOT step.
 */
const AddEOTOutputSchema = z.object({
  content: z.string(),
});

type AddEOTInput = z.input<typeof AddEOTInputSchema>;
type AddEOTOutput = z.infer<typeof AddEOTOutputSchema>;

/**
 * Add EOT (End-of-Text) Token step for pipeline.
 *
 * This step appends an end-of-text token to content if provided.
 * This is useful for certain embedding models like qwen3 that require
 * end-of-text markers.
 *
 * @example
 * ```typescript
 * const pipeline = Pipeline.start<AddEOTInput>()
 *   .add('addEOT', addEOTStep);
 *
 * const result = await pipeline.execute({
 *   content: 'Some text',
 *   eotToken: '<|endoftext|>'
 * });
 * // Returns: { content: 'Some text<|endoftext|>' }
 * ```
 */
export const addEOTStep = createStep<AddEOTInput, AddEOTOutput>("addEOT", async ({ input }) => {
  // Validate input
  const validated = AddEOTInputSchema.parse(input);

  // Add EOT token if provided
  const content = validated.eotToken ? validated.content + validated.eotToken : validated.content;

  return { content };
});

// Export schemas for testing and validation
export { AddEOTInputSchema, AddEOTOutputSchema };
export type { AddEOTInput, AddEOTOutput };
