import { z } from "zod";
import { createStep } from "../../core/pipeline/steps";

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
 * API request schema for OpenAI-compatible embeddings endpoint.
 */
const EmbeddingRequestSchema = z.object({
  input: z.array(z.string()),
  model: z.string(),
});

/**
 * API response schema for OpenAI-compatible embeddings endpoint.
 */
const EmbeddingResponseSchema = z.object({
  data: z.array(
    z.object({
      embedding: z.array(z.number()),
      index: z.number().optional(),
    }),
  ),
});

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

    // Prepare request body
    const requestBody = EmbeddingRequestSchema.parse({
      input: validated.contents,
      model: validated.model,
    });

    // Make API request
    const response = await fetch(validated.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    // Check response status
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Embedding API error (${response.status}): ${errorText}`);
    }

    // Parse and validate response
    const responseData = await response.json();
    const validatedResponse = EmbeddingResponseSchema.parse(responseData);

    // Extract embeddings (API may return in any order, so we need to sort by index if present)
    const embeddings = validatedResponse.data
      .sort((a, b) => {
        const aIndex = a.index ?? 0;
        const bIndex = b.index ?? 0;
        return aIndex - bIndex;
      })
      .map((item) => ({
        embedding: item.embedding,
      }));

    // Verify we got the expected number of embeddings
    if (embeddings.length !== validated.contents.length) {
      throw new Error(`Expected ${validated.contents.length} embeddings but received ${embeddings.length}`);
    }

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
