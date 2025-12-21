import { z } from "zod";
import { createLogger } from "../core/logging/logger";
import type { EmbeddingConfig } from "../retrieval/embedding";
import type {
	SearchResult,
	VectorSearchClient,
} from "../retrieval/qdrant-client";
import { defineTool } from "./registry";

const logger = createLogger("rag-tool");

export interface RAGSearchContext {
	vectorClient: VectorSearchClient;
	embeddingConfig: EmbeddingConfig;
	defaultCollection: string;
}

const searchArgsSchema = z.object({
	query: z.string().describe("The search query to find relevant documents"),
	collection: z
		.string()
		.optional()
		.describe("Collection to search (optional, uses default if not specified)"),
	limit: z
		.number()
		.optional()
		.default(5)
		.describe("Maximum number of results to return"),
	tags: z.array(z.string()).optional().describe("Filter results by tags"),
});

type SearchArgs = z.infer<typeof searchArgsSchema>;

export function createRAGSearchTool(context: RAGSearchContext) {
	return defineTool({
		name: "search_knowledge_base",
		description:
			"Search the knowledge base for relevant documents and notes. Use this to find information related to a user query.",
		parameters: searchArgsSchema,
		execute: async (args: SearchArgs): Promise<SearchResult[]> => {
			logger.info({
				event: "rag_search_start",
				query: args.query,
				collection: args.collection || context.defaultCollection,
				limit: args.limit,
				tags: args.tags,
			});

			// Generate embedding for query
			const embeddingUrl = `${context.embeddingConfig.baseURL}/embeddings`;
			const embeddingRequestBody = {
				model: context.embeddingConfig.model,
				input: args.query,
			};

			logger.debug({
				event: "embedding_http_request",
				method: "POST",
				url: embeddingUrl,
				model: context.embeddingConfig.model,
				inputText: args.query,
				inputLength: args.query.length,
				hasApiKey: !!context.embeddingConfig.apiKey,
			});

			const embeddingResponse = await fetch(embeddingUrl, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...(context.embeddingConfig.apiKey && {
						Authorization: `Bearer ${context.embeddingConfig.apiKey}`,
					}),
				},
				body: JSON.stringify(embeddingRequestBody),
			});

			logger.debug({
				event: "embedding_http_response",
				status: embeddingResponse.status,
				statusText: embeddingResponse.statusText,
				contentType: embeddingResponse.headers.get("content-type"),
			});

			if (!embeddingResponse.ok) {
				const errorText = await embeddingResponse.text();
				logger.error({
					event: "embedding_error",
					status: embeddingResponse.status,
					statusText: embeddingResponse.statusText,
					errorBody: errorText,
				});
				throw new Error(
					`Embedding generation failed: ${embeddingResponse.statusText} - ${errorText}`,
				);
			}

			const embeddingData = (await embeddingResponse.json()) as {
				data: Array<{ embedding: number[] }>;
			};

			logger.debug({
				event: "embedding_parsed",
				hasData: !!embeddingData.data,
				dataCount: embeddingData.data?.length,
				embeddingDimension: embeddingData.data[0]?.embedding?.length,
				firstFewValues: embeddingData.data[0]?.embedding?.slice(0, 5),
			});

			if (!embeddingData.data[0]) {
				logger.error({
					event: "embedding_missing_data",
					response: embeddingData,
				});
				throw new Error("No embedding data returned from API");
			}

			const embedding = embeddingData.data[0].embedding;

			// Search with optional tag filter
			const filters = args.tags?.length
				? {
						should: args.tags.map((tag) => ({
							key: "tags",
							match: { value: tag },
						})),
					}
				: undefined;

			const searchCollection = args.collection || context.defaultCollection;

			logger.debug({
				event: "vector_search_params",
				collection: searchCollection,
				embeddingDimension: embedding.length,
				limit: args.limit,
				hasFilters: !!filters,
				filters: filters,
			});

			const results = await context.vectorClient.searchWithMetadataFilter(
				embedding,
				searchCollection,
				filters || {},
				{ limit: args.limit },
			);

			logger.info({
				event: "rag_search_complete",
				resultCount: results.length,
				topScore: results[0]?.score,
				results: results.map((r) => ({
					id: r.id,
					score: r.score,
					payloadKeys: Object.keys(r.payload),
				})),
			});

			logger.debug({
				event: "rag_search_full_results",
				results: results,
			});

			return results;
		},
	});
}
