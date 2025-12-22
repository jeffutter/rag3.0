import { z } from "zod";

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
 * Result type for a single embedding.
 */
export interface EmbeddingResult {
  embedding: number[];
}

/**
 * Generate vector embeddings for an array of text contents using an OpenAI-compatible API.
 *
 * This function calls an OpenAI-compatible embeddings API endpoint to generate vector embeddings
 * for the provided text contents. It follows the OpenAI embeddings API format:
 *
 * Request: POST { input: string[], model: string }
 * Response: { data: [{ embedding: number[], index?: number }] }
 *
 * The function handles:
 * - Batch processing of multiple texts in a single API call
 * - Response validation using Zod schemas
 * - Proper ordering of results (sorting by index if provided)
 * - Verification that the number of embeddings matches the number of inputs
 *
 * @param contents - Array of text strings to generate embeddings for (must have at least one element)
 * @param endpoint - URL of the OpenAI-compatible embeddings API endpoint
 * @param model - Model identifier to use for generating embeddings
 * @returns Promise that resolves to an array of embedding results in the same order as the input contents
 * @throws {Error} When the API returns a non-OK status
 * @throws {Error} When the API response doesn't match the expected schema
 * @throws {Error} When the number of returned embeddings doesn't match the number of inputs
 *
 * @example
 * ```typescript
 * const embeddings = await generateEmbeddings(
 *   ['hello world', 'goodbye world'],
 *   'https://llama.home.jeffutter.com/v1/embeddings',
 *   'qwen3-embedding'
 * );
 * console.log(embeddings[0].embedding); // [0.123, 0.456, ...]
 * ```
 */
export async function generateEmbeddings(
  contents: string[],
  endpoint: string,
  model: string,
): Promise<EmbeddingResult[]> {
  // Prepare request body
  const requestBody = EmbeddingRequestSchema.parse({
    input: contents,
    model: model,
  });

  // Make API request
  const response = await fetch(endpoint, {
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
  if (embeddings.length !== contents.length) {
    throw new Error(`Expected ${contents.length} embeddings but received ${embeddings.length}`);
  }

  return embeddings;
}
