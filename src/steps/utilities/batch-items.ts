import { z } from "zod";
import { createStep } from "../../core/pipeline/steps";

/**
 * Input schema for the Batch Items step.
 * Uses any type for items to allow generic batching.
 */
const BatchItemsInputSchema = z.object({
  items: z.array(z.any()),
  batchSize: z.number().int().positive(),
});

/**
 * Output schema for the Batch Items step.
 */
const BatchItemsOutputSchema = z.object({
  batches: z.array(z.array(z.any())),
});

type BatchItemsInput = z.input<typeof BatchItemsInputSchema>;
type BatchItemsOutput = z.infer<typeof BatchItemsOutputSchema>;

/**
 * Batch Items utility step for pipeline.
 *
 * This is a generic utility that splits an array of items into batches of a specified size.
 * The last batch may contain fewer items if the total count is not evenly divisible.
 *
 * This step is useful for:
 * - Batching API requests to avoid rate limits
 * - Processing large datasets in chunks
 * - Parallelizing work across multiple batches
 *
 * @example
 * ```typescript
 * const pipeline = Pipeline.start<BatchItemsInput>()
 *   .add('batch', batchItemsStep);
 *
 * const result = await pipeline.execute({
 *   items: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
 *   batchSize: 3
 * });
 * // result.data.batches = [[1,2,3], [4,5,6], [7,8,9], [10]]
 * ```
 */
export const batchItemsStep = createStep<BatchItemsInput, BatchItemsOutput>("batchItems", async ({ input }) => {
  // Validate input
  const validated = BatchItemsInputSchema.parse(input);

  // Batch the items
  // biome-ignore lint/suspicious/noExplicitAny: Generic batching utility accepts any item type
  const batches: Array<Array<any>> = [];

  for (let i = 0; i < validated.items.length; i += validated.batchSize) {
    batches.push(validated.items.slice(i, i + validated.batchSize));
  }

  return { batches };
});

// Export schemas for testing and validation
export { BatchItemsInputSchema, BatchItemsOutputSchema };
export type { BatchItemsInput, BatchItemsOutput };
