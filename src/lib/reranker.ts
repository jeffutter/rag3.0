import { z } from "zod";

/**
 * API request schema for reranking endpoint.
 */
const RerankRequestSchema = z.object({
  query: z.string(),
  documents: z.array(z.string()),
  model: z.string().optional(),
  top_n: z.number().optional(),
});

/**
 * API response schema for reranking endpoint.
 */
const RerankResponseSchema = z.object({
  results: z.array(
    z.object({
      index: z.number(),
      relevance_score: z.number(),
      document: z
        .object({
          text: z.string().optional(),
        })
        .optional(),
    }),
  ),
});

/**
 * Result type for a single reranked document.
 */
export interface RerankResult {
  index: number;
  relevance_score: number;
}

/**
 * Configuration for the reranker API.
 */
export interface RerankConfig {
  baseURL: string;
  model?: string;
  apiKey?: string;
  useInstructions?: boolean;
  instructions?: string;
}

const DEFAULT_RERANK_INSTRUCTIONS =
  "Given a query and a document, determine how relevant the document is to answering the query. Pay special attention to date and time ranges mentioned in the query.";

/**
 * Format a document with instructions for instruction-based reranking models.
 *
 * @param query - The search query
 * @param document - The document text to rerank
 * @param instructions - The instruction text (defaults to DEFAULT_RERANK_INSTRUCTIONS)
 * @returns Formatted document in the format: "<Instruct>: {instructions}\n<Query>: {query}\n<Document>: {document}"
 */
function formatDocumentWithInstructions(query: string, document: string, instructions?: string): string {
  const currentDate = new Date().toISOString();
  const instructionText = instructions || DEFAULT_RERANK_INSTRUCTIONS;
  return `<Instruct>: ${instructionText}. The current date is: ${currentDate}\n<Query>: ${query}\n<Document>: ${document}`;
}

/**
 * Rerank documents based on their relevance to a query using a reranking API.
 *
 * This function calls a reranking API endpoint to score documents based on their
 * relevance to the provided query. It follows a standard reranking API format:
 *
 * Request: POST { query: string, documents: string[], model?: string, top_n?: number }
 * Response: { results: [{ index: number, relevance_score: number }] }
 *
 * The function handles:
 * - Batch processing of multiple documents in a single API call
 * - Response validation using Zod schemas
 * - Proper ordering of results by relevance score (highest first)
 * - Optional API key authentication
 * - Optional model specification
 *
 * @param query - The search query to compare documents against
 * @param documents - Array of document text strings to rerank
 * @param config - Reranker configuration (baseURL, optional model, optional apiKey)
 * @param topN - Optional limit on the number of results to return (returns all by default)
 * @returns Promise that resolves to an array of rerank results sorted by relevance score (highest first)
 * @throws {Error} When the API returns a non-OK status
 * @throws {Error} When the API response doesn't match the expected schema
 *
 * @example
 * ```typescript
 * const results = await rerankDocuments(
 *   'what is machine learning',
 *   ['ML is a subset of AI', 'The weather is nice', 'Deep learning uses neural networks'],
 *   { baseURL: 'https://llama.home.jeffutter.com/v1' }
 * );
 * console.log(results[0]); // { index: 0, relevance_score: 0.95 }
 * ```
 */
export async function rerankDocuments(
  query: string,
  documents: string[],
  config: RerankConfig,
  topN?: number,
): Promise<RerankResult[]> {
  // Format documents with instructions if enabled
  const documentsForReranking = config.useInstructions
    ? documents.map((doc) => formatDocumentWithInstructions(query, doc, config.instructions))
    : documents;

  // Prepare request body
  const requestBody = RerankRequestSchema.parse({
    query,
    documents: documentsForReranking,
    ...(config.model && { model: config.model }),
    ...(topN && { top_n: topN }),
  });

  // Make API request
  const endpoint = `${config.baseURL}/rerank`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.apiKey && { Authorization: `Bearer ${config.apiKey}` }),
    },
    body: JSON.stringify(requestBody),
  });

  // Check response status
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Rerank API error (${response.status}): ${errorText}`);
  }

  // Parse and validate response
  const responseData = await response.json();
  const validatedResponse = RerankResponseSchema.parse(responseData);

  // Extract results and sort by relevance score (highest first)
  const results = validatedResponse.results
    .map((item) => ({
      index: item.index,
      relevance_score: item.relevance_score,
    }))
    .sort((a, b) => b.relevance_score - a.relevance_score);

  return results;
}
