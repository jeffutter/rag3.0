import { QdrantClient } from "@qdrant/js-client-rest";
import { createLogger } from "../core/logging/logger";

const logger = createLogger("qdrant");

// Type for Qdrant filters
// biome-ignore lint/suspicious/noExplicitAny: Qdrant client doesn't export filter types
type QdrantFilter = any; // We'll use any for now since the types aren't exported

export interface SearchBranch {
  prefetch: {
    query: number[];
    filter?: QdrantFilter;
    limit: number;
  };
  query: {
    formula: QdrantFilter;
  };
  limit: number;
}

export interface SearchOptions {
  query: string;
  collection: string;
  limit?: number;
  scoreThreshold?: number;
  filter?: QdrantFilter;
  withPayload?: boolean | string[];
  hybridBranches?: SearchBranch[];
  fusion?: "rrf" | "dbsf";
}

export interface SearchResult {
  id: string | number;
  score: number;
  payload: Record<string, unknown>;
}

export interface QdrantConfig {
  url: string;
  apiKey?: string;
}

/**
 * Qdrant vector search client wrapper.
 *
 * Note: This client assumes embeddings are generated externally
 * and passed in. For embedding generation, see the embedding step.
 */
export class VectorSearchClient {
  private client: QdrantClient;

  constructor(config: QdrantConfig) {
    const clientConfig: { url: string; apiKey?: string } = { url: config.url };
    if (config.apiKey) {
      clientConfig.apiKey = config.apiKey;
    }
    this.client = new QdrantClient(clientConfig);
  }

  async search(vector: number[], options: Omit<SearchOptions, "query">): Promise<SearchResult[]> {
    const startTime = performance.now();

    logger.debug({
      event: "vector_search_start",
      collection: options.collection,
      limit: options.limit,
      vectorDim: vector.length,
      hasFilter: !!options.filter,
      hasHybridBranches: !!options.hybridBranches,
    });

    try {
      // biome-ignore lint/suspicious/noExplicitAny: Qdrant client doesn't export query params type
      const queryParams: any = {
        limit: options.limit || 10,
        with_payload: options.withPayload ?? true,
      };

      // Handle hybrid search with multiple branches
      if (options.hybridBranches && options.hybridBranches.length > 0) {
        queryParams.prefetch = options.hybridBranches;
        queryParams.query = {
          fusion: options.fusion || "rrf",
        };
      } else {
        // Check if filter has score modifier structure (mult with $score)
        const hasScoreModifier =
          options.filter &&
          typeof options.filter === "object" &&
          "mult" in options.filter &&
          Array.isArray(options.filter.mult) &&
          options.filter.mult[0] === "$score";

        if (hasScoreModifier) {
          // Use prefetch for vector search, then rescore with formula
          queryParams.prefetch = {
            query: vector,
            limit: (options.limit || 10) * 2, // Prefetch more for better rescoring
          };
          queryParams.query = {
            formula: options.filter,
          };
        } else {
          // Use vector directly as query
          queryParams.query = vector;
          if (options.filter != null) {
            queryParams.filter = options.filter;
          }
        }
      }

      if (options.scoreThreshold != null) {
        queryParams.score_threshold = options.scoreThreshold;
      }

      logger.debug({
        event: "qdrant_query_request",
        collection: options.collection,
        params: {
          vectorDim: vector.length,
          vectorPreview: vector.slice(0, 5),
          limit: queryParams.limit,
          scoreThreshold: queryParams.score_threshold,
          filter: queryParams.filter,
          withPayload: queryParams.with_payload,
        },
      });

      logger.debug({
        event: "qdrant_query_full_request",
        collection: options.collection,
        fullParams: JSON.stringify(queryParams, null, 2),
      });

      let results: Awaited<ReturnType<typeof this.client.query>>;
      try {
        results = await this.client.query(options.collection, queryParams);

        logger.debug({
          event: "qdrant_query_raw_response",
          collection: options.collection,
          rawResponse: JSON.stringify(results, null, 2),
        });
      } catch (error) {
        logger.error({
          event: "qdrant_query_api_error",
          collection: options.collection,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          queryParams: JSON.stringify(queryParams, null, 2),
        });
        throw error;
      }

      const durationMs = performance.now() - startTime;

      logger.debug({
        event: "qdrant_query_response",
        collection: options.collection,
        resultCount: results.points.length,
        results: results.points.map((r) => ({
          id: r.id,
          score: r.score,
          hasPayload: !!r.payload,
          payloadKeys: r.payload ? Object.keys(r.payload) : [],
        })),
      });

      logger.info({
        event: "vector_query_complete",
        collection: options.collection,
        resultCount: results.points.length,
        durationMs,
        topScore: results.points[0]?.score,
      });

      return results.points.map((r) => ({
        id: r.id,
        score: r.score,
        payload: r.payload as Record<string, unknown>,
      }));
    } catch (error) {
      logger.error({
        event: "vector_query_error",
        collection: options.collection,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  async searchWithMetadataFilter(
    vector: number[],
    collection: string,
    filter?: QdrantFilter,
    options?: {
      limit?: number;
      scoreThreshold?: number;
      hybridBranches?: SearchBranch[];
      fusion?: "rrf" | "dbsf";
    },
  ): Promise<SearchResult[]> {
    const searchOptions: Omit<SearchOptions, "query"> = {
      collection,
      filter,
    };

    if (options?.limit != null) {
      searchOptions.limit = options.limit;
    }

    if (options?.scoreThreshold != null) {
      searchOptions.scoreThreshold = options.scoreThreshold;
    }

    if (options?.hybridBranches != null) {
      searchOptions.hybridBranches = options.hybridBranches;
    }

    if (options?.fusion != null) {
      searchOptions.fusion = options.fusion;
    }

    return this.search(vector, searchOptions);
  }

  async getCollectionInfo(collection: string) {
    return this.client.getCollection(collection);
  }
}
