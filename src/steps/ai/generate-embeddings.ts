import { z } from "zod";
import { createStep } from "../../core/pipeline/steps";
import { generateEmbeddings } from "../../lib/embeddings";

/**
 * Input schema for the Generate Embeddings step.
 */
const GenerateEmbeddingsInputSchema = z.object({
  contents: z.array(z.string()).min(1),
  endpoint: z.string().url(),
  model: z.string(),
});

/**
 * Schema for individual embedding results.
 */
const EmbeddingSchema = z.object({
  embedding: z.array(z.number()),
});

/**
 * Output schema for the Generate Embeddings step.
 */
const GenerateEmbeddingsOutputSchema = z.object({
  embeddings: z.array(EmbeddingSchema),
});

type GenerateEmbeddingsInput = z.input<typeof GenerateEmbeddingsInputSchema>;
type GenerateEmbeddingsOutput = z.infer<typeof GenerateEmbeddingsOutputSchema>;

/**
 * Generate Embeddings step for pipeline.
 *
 * This step calls an OpenAI-compatible embeddings API to generate vector embeddings
 * for an array of text contents. It follows the OpenAI embeddings API format:
 *
 * Request: POST { input: string[], model: string }
 * Response: { data: [{ embedding: number[] }] }
 *
 * Features:
 * - Batch processing of multiple texts in a single API call
 * - Configurable endpoint and model
 * - Retry logic for transient failures (configured via createStep options)
 * - Response validation
 *
 * @example
 * ```typescript
 * const pipeline = Pipeline.start<GenerateEmbeddingsInput>()
 *   .add('embed', generateEmbeddingsStep);
 *
 * const result = await pipeline.execute({
 *   contents: ['text 1', 'text 2', 'text 3'],
 *   endpoint: 'https://llama.home.jeffutter.com/v1/embeddings',
 *   model: 'qwen3-embedding'
 * });
 * ```
 */
export const generateEmbeddingsStep = createStep<GenerateEmbeddingsInput, GenerateEmbeddingsOutput>(
  "generateEmbeddings",
  async ({ input }) => {
    // Validate input
    const validated = GenerateEmbeddingsInputSchema.parse(input);

    // Call the utility function to generate embeddings
    const embeddings = await generateEmbeddings(validated.contents, validated.endpoint, validated.model);

    return { embeddings };
  },
  {
    retry: {
      maxAttempts: 3,
      backoffMs: 1000,
      retryableErrors: ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "RATE_LIMIT"],
    },
  },
);

// Export schemas for testing and validation
export { GenerateEmbeddingsInputSchema, GenerateEmbeddingsOutputSchema };
export type { GenerateEmbeddingsInput, GenerateEmbeddingsOutput };
