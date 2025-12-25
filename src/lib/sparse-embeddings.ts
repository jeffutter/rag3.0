import { z } from "zod";
import { createLogger } from "../core/logging/logger";

const logger = createLogger("sparse-embeddings");

/**
 * Schema for a single sparse embedding with indices and values
 */
export const SparseEmbeddingSchema = z.object({
  values: z.array(z.number()),
  indices: z.array(z.number()),
});

export type SparseEmbedding = z.infer<typeof SparseEmbeddingSchema>;

/**
 * Schema for the sparse embedding API request
 */
export const SparseEmbeddingRequestSchema = z.object({
  documents: z.array(z.string()),
});

/**
 * Schema for the sparse embedding API response
 */
export const SparseEmbeddingResponseSchema = z.object({
  embeddings: z.array(SparseEmbeddingSchema),
  model_name: z.string(),
  num_documents: z.number(),
});

export type SparseEmbeddingResponse = z.infer<typeof SparseEmbeddingResponseSchema>;

/**
 * Result for a single sparse embedding
 */
export interface SparseEmbeddingResult {
  embedding: SparseEmbedding;
}

/**
 * Generate sparse embeddings using the BM42 API
 *
 * @param contents - Array of text strings to embed
 * @param endpoint - API endpoint URL (default: http://llama.home.jeffutter.com:9080/embed)
 * @returns Array of sparse embedding results
 */
export async function generateSparseEmbeddings(
  contents: string[],
  endpoint = "http://llama.home.jeffutter.com:9080/embed",
): Promise<SparseEmbeddingResult[]> {
  const startTime = performance.now();

  logger.debug({
    event: "sparse_embedding_start",
    endpoint,
    documentCount: contents.length,
    contentLengths: contents.map((c) => c.length),
  });

  if (contents.length === 0) {
    logger.error({
      event: "sparse_embedding_empty_input",
      error: "Contents array cannot be empty",
    });
    throw new Error("Contents array cannot be empty");
  }

  const requestBody = SparseEmbeddingRequestSchema.parse({
    documents: contents,
  });

  logger.trace({
    event: "sparse_embedding_http_request",
    method: "POST",
    endpoint,
    documentCount: contents.length,
    requestBody,
  });

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error({
      event: "sparse_embedding_api_error",
      endpoint,
      status: response.status,
      statusText: response.statusText,
      error: errorText,
    });
    throw new Error(`Sparse embedding API request failed: ${response.status} ${response.statusText}\n${errorText}`);
  }

  const data = await response.json();

  logger.trace({
    event: "sparse_embedding_response_raw",
    endpoint,
    responseData: data,
  });

  const parsedResponse = SparseEmbeddingResponseSchema.parse(data);

  logger.debug({
    event: "sparse_embedding_response_parsed",
    endpoint,
    modelName: parsedResponse.model_name,
    numDocuments: parsedResponse.num_documents,
    embeddingCount: parsedResponse.embeddings.length,
    sparsityInfo: parsedResponse.embeddings.map((e, idx) => ({
      index: idx,
      nonZeroCount: e.values.length,
      indicesCount: e.indices.length,
    })),
  });

  // Validate that we got the expected number of embeddings
  if (parsedResponse.embeddings.length !== contents.length) {
    logger.error({
      event: "sparse_embedding_count_mismatch",
      expected: contents.length,
      received: parsedResponse.embeddings.length,
    });
    throw new Error(`Expected ${contents.length} embeddings but received ${parsedResponse.embeddings.length}`);
  }

  // Validate that num_documents matches
  if (parsedResponse.num_documents !== contents.length) {
    logger.error({
      event: "sparse_embedding_num_documents_mismatch",
      numDocuments: parsedResponse.num_documents,
      inputLength: contents.length,
    });
    throw new Error(`num_documents (${parsedResponse.num_documents}) does not match input length (${contents.length})`);
  }

  const durationMs = performance.now() - startTime;

  logger.info({
    event: "sparse_embedding_complete",
    endpoint,
    documentCount: contents.length,
    modelName: parsedResponse.model_name,
    durationMs,
    avgNonZeroElements:
      parsedResponse.embeddings.reduce((sum, e) => sum + e.values.length, 0) / parsedResponse.embeddings.length,
  });

  return parsedResponse.embeddings.map((embedding) => ({ embedding }));
}
