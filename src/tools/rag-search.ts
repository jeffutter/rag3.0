import { z } from "zod";
import { createLogger } from "../core/logging/logger";
import { generateEmbeddings } from "../lib/embeddings";
import { processDateRange } from "../lib/gaussian-decay";
import type { ObsidianVaultUtilityClient } from "../lib/obsidian-vault-utility-client";
import type { EmbeddingConfig } from "../retrieval/embedding";
import type { SearchResult, VectorSearchClient } from "../retrieval/qdrant-client";
import { defineTool } from "./registry";

const logger = createLogger("rag-tool");

export interface RAGSearchContext {
  vectorClient: VectorSearchClient;
  embeddingConfig: EmbeddingConfig;
  defaultCollection: string;
  vaultClient: ObsidianVaultUtilityClient;
}

const LIMIT = 20;

/**
 * Creates a search arguments schema with dynamically loaded tags
 */
function createSearchArgsSchema(availableTags: string[]) {
  // Filter out empty tags and format for display
  const tagList = availableTags.filter((tag) => tag.trim().length > 0).join(", ");

  return z.object({
    query: z.string().describe("The search query to find relevant documents"),
    limit: z
      .number()
      .min(1)
      .max(20)
      .optional()
      .default(5)
      .describe(`Maximum number of results to return. Must be ${LIMIT} or less`),
    tags: z
      .array(z.string())
      .optional()
      .describe(
        `Boost results by tags. Choose relevant tags from this list if applicable: ${tagList}. Each matching tag adds a 0.25 score boost. Multiple tags can be provided for higher boosts.`,
      ),
    start_date_time: z
      .string()
      .optional()
      .describe(
        "Optional RFC3339 formatted start date/time. Results will be boosted based on their timestamp proximity to the date range using gaussian decay.",
      ),
    end_date_time: z
      .string()
      .optional()
      .describe(
        "Optional RFC3339 formatted end date/time. Results will be boosted based on their timestamp proximity to the date range using gaussian decay.",
      ),
  });
}

type SearchArgs = z.infer<ReturnType<typeof createSearchArgsSchema>>;

export async function createRAGSearchTool(context: RAGSearchContext) {
  // Fetch available tags dynamically
  logger.info({ event: "fetching_available_tags" });
  const availableTags = await context.vaultClient.getTags();
  logger.info({ event: "tags_loaded", count: availableTags.length });

  const searchArgsSchema = createSearchArgsSchema(availableTags);
  return defineTool({
    name: "search_knowledge_base",
    description:
      "Search the knowledge base for relevant documents and notes. Use this to find information related to a user query.",
    parameters: searchArgsSchema,
    execute: async (args: SearchArgs): Promise<SearchResult[]> => {
      logger.info({
        event: "rag_search_start",
        query: args.query,
        collection: context.defaultCollection,
        limit: args.limit,
        tags: args.tags,
      });

      // Generate embedding for query
      const embeddingUrl = `${context.embeddingConfig.baseURL}/embeddings`;

      logger.debug({
        event: "embedding_http_request",
        method: "POST",
        url: embeddingUrl,
        model: context.embeddingConfig.model,
        inputText: args.query,
        inputLength: args.query.length,
        hasApiKey: !!context.embeddingConfig.apiKey,
      });

      const embeddingResults = await generateEmbeddings(
        [args.query],
        embeddingUrl,
        context.embeddingConfig.model,
        context.embeddingConfig.apiKey,
      );

      logger.debug({
        event: "embedding_parsed",
        dataCount: embeddingResults.length,
        embeddingDimension: embeddingResults[0]?.embedding?.length,
        firstFewValues: embeddingResults[0]?.embedding?.slice(0, 5),
      });

      if (!embeddingResults[0]) {
        logger.error({
          event: "embedding_missing_data",
          resultCount: embeddingResults.length,
        });
        throw new Error("No embedding data returned from API");
      }

      const embedding = embeddingResults[0].embedding;

      // Calculate gaussian decay parameters if date range is provided
      const gaussianParams = processDateRange(args.start_date_time, args.end_date_time);

      // Build filter with score modifier combining date range and tag boosts
      // Structure: multiply base score ($score) with sum of modifiers
      let filter: unknown;

      if (gaussianParams || args.tags?.length) {
        const scoreModifierComponents: unknown[] = [1.0]; // Base multiplier

        // Add gaussian decay boost if dates are provided
        if (gaussianParams) {
          scoreModifierComponents.push({
            mult: [
              1.0, // Weight for gaussian decay
              {
                gauss_decay: {
                  x: { datetime_key: "metadata.modified_timestamp" },
                  target: { datetime: gaussianParams.target },
                  scale: gaussianParams.scale,
                  midpoint: 0.5,
                },
              },
            ],
          });
        }

        // Add tag boosts if tags are provided
        if (args.tags?.length) {
          const tagWeights = args.tags.map((tag) => ({
            mult: [
              0.25, // Weight boost per matching tag
              {
                key: "tags",
                match: { value: tag },
              },
            ],
          }));
          scoreModifierComponents.push(...tagWeights);
        }

        filter = {
          mult: [
            "$score",
            {
              sum: scoreModifierComponents,
            },
          ],
        };
      }

      logger.debug({
        event: "vector_search_params",
        collection: context.defaultCollection,
        embeddingDimension: embedding.length,
        limit: args.limit,
        hasFilter: !!filter,
        gaussianParams: gaussianParams,
        tags: args.tags,
        filter: filter,
      });

      const results = await context.vectorClient.searchWithMetadataFilter(
        embedding,
        context.defaultCollection,
        filter,
        {
          limit: args.limit,
        },
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
