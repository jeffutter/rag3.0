import { QdrantClient } from "@qdrant/js-client-rest";
import { createLogger } from "../core/logging/logger";

const logger = createLogger("qdrant");

// Type for Qdrant filters
// biome-ignore lint/suspicious/noExplicitAny: Qdrant client doesn't export filter types
type QdrantFilter = any; // We'll use any for now since the types aren't exported

export interface SearchOptions {
	query: string;
	collection: string;
	limit?: number;
	scoreThreshold?: number;
	filter?: QdrantFilter;
	withPayload?: boolean | string[];
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

	async search(
		vector: number[],
		options: Omit<SearchOptions, "query">,
	): Promise<SearchResult[]> {
		const startTime = performance.now();

		logger.debug({
			event: "vector_search_start",
			collection: options.collection,
			limit: options.limit,
			vectorDim: vector.length,
			hasFilter: !!options.filter,
		});

		try {
			// biome-ignore lint/suspicious/noExplicitAny: Qdrant client doesn't export search params type
			const searchParams: any = {
				vector,
				limit: options.limit || 10,
				with_payload: options.withPayload ?? true,
			};

			if (options.scoreThreshold != null) {
				searchParams.score_threshold = options.scoreThreshold;
			}

			if (options.filter != null) {
				searchParams.filter = options.filter;
			}

			logger.debug({
				event: "qdrant_search_request",
				collection: options.collection,
				params: {
					vectorDim: vector.length,
					vectorPreview: vector.slice(0, 5),
					limit: searchParams.limit,
					scoreThreshold: searchParams.score_threshold,
					filter: searchParams.filter,
					withPayload: searchParams.with_payload,
				},
			});

			const results = await this.client.search(
				options.collection,
				searchParams,
			);

			const durationMs = performance.now() - startTime;

			logger.debug({
				event: "qdrant_search_response",
				collection: options.collection,
				resultCount: results.length,
				results: results.map((r) => ({
					id: r.id,
					score: r.score,
					hasPayload: !!r.payload,
					payloadKeys: r.payload ? Object.keys(r.payload) : [],
				})),
			});

			logger.info({
				event: "vector_search_complete",
				collection: options.collection,
				resultCount: results.length,
				durationMs,
				topScore: results[0]?.score,
			});

			return results.map((r) => ({
				id: r.id,
				score: r.score,
				payload: r.payload as Record<string, unknown>,
			}));
		} catch (error) {
			logger.error({
				event: "vector_search_error",
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
		filters: {
			must?: Array<{
				key: string;
				match: { value: string | number | boolean };
			}>;
			should?: Array<{
				key: string;
				match: { value: string | number | boolean };
			}>;
			mustNot?: Array<{
				key: string;
				match: { value: string | number | boolean };
			}>;
		},
		options?: {
			limit?: number;
			scoreThreshold?: number;
		},
	): Promise<SearchResult[]> {
		const filter: QdrantFilter = {};

		if (filters.must?.length) {
			filter.must = filters.must.map((f) => ({
				key: f.key,
				match: f.match,
			}));
		}

		if (filters.should?.length) {
			filter.should = filters.should.map((f) => ({
				key: f.key,
				match: f.match,
			}));
		}

		if (filters.mustNot?.length) {
			filter.must_not = filters.mustNot.map((f) => ({
				key: f.key,
				match: f.match,
			}));
		}

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

		return this.search(vector, searchOptions);
	}

	async getCollectionInfo(collection: string) {
		return this.client.getCollection(collection);
	}
}
