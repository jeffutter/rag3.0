import { z } from "zod";
import { createLogger } from "../core/logging/logger";
import { generateEmbeddings } from "../lib/embeddings";
import { processDateRange } from "../lib/gaussian-decay";
import type { ObsidianVaultUtilityClient } from "../lib/obsidian-vault-utility-client";
import { type RerankConfig, rerankDocuments } from "../lib/reranker";
import type { ToolExample } from "../llm/types";
import type { EmbeddingConfig } from "../retrieval/embedding";
import type { SearchBranch, SearchResult, VectorSearchClient } from "../retrieval/qdrant-client";
import { defineTool } from "./registry";

const logger = createLogger("rag-tool");

export interface RAGSearchContext {
  vectorClient: VectorSearchClient;
  embeddingConfig: EmbeddingConfig;
  rerankConfig?: RerankConfig;
  defaultCollection: string;
  vaultClient: ObsidianVaultUtilityClient;
}

const LIMIT = 20;
const EMBED_LIMIT_MULTIPLIER = 4;

/**
 * Creates a search arguments schema with dynamically loaded tags
 */
function createSearchArgsSchema(availableTags: string[]) {
  // Filter out empty tags and format for display
  const tagList = availableTags.filter((tag) => tag.trim().length > 0).join(", ");

  return z.object({
    // query: z.string().describe("Semantic search query optimized for vector similarity matching. Describe the core concepts and topics relevant to finding matching documents. Use natural language with domain-specific terminology when applicable. Avoid question structure - focus on the key ideas that would appear in relevant documents."),
    query: z
      .string()
      .describe(
        "Semantic search query optimized for vector similarity matching. The first search should always provide the user's query verbatim. Followup queries should describe the core concepts and topics relevant to finding matching documents, without question structure.",
      ),
    limit: z
      .number()
      .min(1)
      .max(20)
      .optional()
      .default(10)
      .describe(`Maximum number of results to return. Must be ${LIMIT} or less`),
    tags: z
      .array(z.string())
      .optional()
      .describe(`Boost results by tags. Choose relevant tags from this list if applicable: ${tagList}`),
    start_date_time: z
      .string()
      .optional()
      .describe(
        "Start date/time in RFC3339 format (e.g., '2024-01-01T00:00:00Z'). " +
          "Use this for temporal queries: 'recently' = last 7 days, 'lately' = last 14 days, " +
          "'this week' = start of current week, 'last month' = start of previous month. " +
          "Results are boosted based on proximity to the date range.",
      ),
    end_date_time: z
      .string()
      .optional()
      .describe(
        "End date/time in RFC3339 format (e.g., '2024-12-31T23:59:59Z'). " +
          "For queries like 'recently' or 'lately', set to current time. " +
          "Results are boosted based on proximity to the date range.",
      ),
  });
}

type SearchArgs = z.infer<ReturnType<typeof createSearchArgsSchema>>;

/**
 * Generates temporal query examples with dynamic dates based on current time.
 */
function createTemporalExamples(): ToolExample[] {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  // Calculate start of current week (Monday)
  const currentDayOfWeek = now.getDay();
  const daysFromMonday = currentDayOfWeek === 0 ? 6 : currentDayOfWeek - 1; // Sunday is 0
  const startOfWeek = new Date(now.getTime() - daysFromMonday * 24 * 60 * 60 * 1000);
  startOfWeek.setHours(0, 0, 0, 0);

  // Calculate start of current month
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  return [
    {
      description: "Searching for recent journal entries (last 7 days)",
      input: "What have I journaled about recently?",
      toolCall: {
        arguments: {
          query: "journal entries",
          tags: ["journal"],
          start_date_time: sevenDaysAgo.toISOString(),
          end_date_time: now.toISOString(),
        },
      },
    },
    {
      description: "Searching for notes from the past two weeks",
      input: "What notes have I taken lately?",
      toolCall: {
        arguments: {
          query: "notes",
          start_date_time: fourteenDaysAgo.toISOString(),
          end_date_time: now.toISOString(),
        },
      },
    },
    {
      description: "Searching for work items from this week",
      input: "What work items did I track this week?",
      toolCall: {
        arguments: {
          query: "work items",
          tags: ["work", "thescore"],
          start_date_time: startOfWeek.toISOString(),
          end_date_time: now.toISOString(),
        },
      },
    },
    {
      description: "Searching for meetings this month",
      input: "What meetings have I had this month?",
      toolCall: {
        arguments: {
          query: "meetings",
          start_date_time: startOfMonth.toISOString(),
          end_date_time: now.toISOString(),
        },
      },
    },
  ];
}

export async function createRAGSearchTool(context: RAGSearchContext) {
  // Fetch available tags dynamically
  logger.info({ event: "fetching_available_tags" });
  const availableTags = await context.vaultClient.getTags();
  logger.info({ event: "tags_loaded", count: availableTags.length });

  const searchArgsSchema = createSearchArgsSchema(availableTags);
  return defineTool({
    name: "search_knowledge_base",
    description:
      "Search the knowledge base for relevant documents and notes. Use this to find information related to a user query. " +
      "For time-sensitive queries (e.g., 'recently', 'last week', 'this month'), use start_date_time and/or end_date_time to boost results by temporal relevance." +
      "Include relevant tags to retrieve additional context.",
    parameters: searchArgsSchema,
    examples: createTemporalExamples(),
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
        originalQuery: args.query,
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

      const recencyBoost = [
        {
          mult: [
            0.3, // Weight for recency decay
            {
              exp_decay: {
                x: { datetime_key: "metadata.modified_timestamp" },
                target: { datetime: new Date().toISOString() },
                scale: 7776000, // ~90 days in seconds
                midpoint: 0.5,
              },
            },
          ],
        },
      ];

      // Helper to build gaussian decay component (for date ranges)
      const gaussianDecay = gaussianParams
        ? [
            {
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
            },
          ]
        : [];

      const tagBoosts =
        args.tags?.map((tag) => ({
          mult: [
            0.25, // Weight boost per matching tag
            {
              key: "metadata.tags",
              match: { value: tag },
            },
          ],
        })) || [];

      // Always build hybrid search with nested prefetch structure
      const hybridBranches: SearchBranch[] = [
        // Branch 1: Vector similarity with recency, tag boosts, and temporal decay
        {
          prefetch: {
            query: embedding,
            limit: 100,
          },
          query: {
            formula: {
              mult: [
                "$score",
                {
                  sum: [1.0, ...recencyBoost, ...tagBoosts, ...gaussianDecay],
                },
              ],
            },
          },
          limit: args.limit * EMBED_LIMIT_MULTIPLIER,
        },
      ];

      // Branch 2: Tag-focused search (only if tags provided)
      if (args.tags?.length) {
        hybridBranches.push({
          prefetch: {
            filter: {
              should: args.tags.map((tag) => ({
                key: "metadata.tags",
                match: { value: tag },
              })),
            },
            limit: 1000,
          },
          query: {
            formula: {
              mult: [
                "$score",
                {
                  sum: [1.0, ...recencyBoost, ...tagBoosts, ...gaussianDecay],
                },
              ],
            },
          },
          limit: args.limit * EMBED_LIMIT_MULTIPLIER,
        });
      }

      logger.debug({
        event: "vector_search_params",
        collection: context.defaultCollection,
        embeddingDimension: embedding.length,
        limit: args.limit * EMBED_LIMIT_MULTIPLIER,
        hasHybridBranches: true,
        branchCount: hybridBranches.length,
        gaussianParams: gaussianParams,
        tags: args.tags,
        hybridBranches: hybridBranches,
      });

      const results = await context.vectorClient.searchWithMetadataFilter(
        embedding,
        context.defaultCollection,
        undefined, // No filter - using hybrid branches instead
        {
          limit: args.limit * EMBED_LIMIT_MULTIPLIER,
          hybridBranches,
          fusion: "rrf",
        },
      );

      logger.info({
        event: "vector_search_complete",
        resultCount: results.length,
        topScore: results[0]?.score,
        results: results.map((r) => ({
          id: r.id,
          score: r.score,
          payloadKeys: Object.keys(r.payload),
        })),
      });

      // Apply reranking if configured
      let finalResults = results;
      if (context.rerankConfig && results.length > 0) {
        logger.debug({
          event: "reranking_start",
          resultCount: results.length,
        });

        // Format documents for reranking with metadata
        const documents = results.map((r) => {
          const content = r.payload.content;
          const metadata = r.payload.metadata as { modified_timestamp?: string; tags?: string[] } | undefined;

          // Extract title from ID (filename without .md, converted to titlecase)
          const filename = typeof r.id === "string" ? r.id.split("/").pop() || r.id : String(r.id);
          const titleWithoutExt = filename.replace(/\.md$/, "");
          const title = titleWithoutExt
            .split(/[-_\s]+/)
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(" ");

          // Format date in RFC3339
          const date = metadata?.modified_timestamp || "Unknown";

          // Format tags as comma-separated list
          const tags = metadata?.tags?.join(", ") || "None";

          // Build formatted document
          const contentStr = typeof content === "string" ? content : JSON.stringify(r.payload);

          return `Title: ${title}
Date: ${date}
Tags: ${tags}

Body:
${contentStr}`;
        });

        try {
          const rerankResults = await rerankDocuments(args.query, documents, context.rerankConfig, args.limit);

          logger.debug({
            event: "reranking_complete",
            rerankResultCount: rerankResults.length,
            topRerankScore: rerankResults[0]?.relevance_score,
          });

          // Reorder the original results based on reranker output
          const rerankedResults: SearchResult[] = [];
          for (const rerankResult of rerankResults) {
            const originalResult = results[rerankResult.index];
            if (!originalResult) {
              logger.warn({
                event: "reranking_invalid_index",
                index: rerankResult.index,
                totalResults: results.length,
              });
              continue;
            }
            rerankedResults.push({
              id: originalResult.id,
              score: rerankResult.relevance_score,
              payload: {
                ...originalResult.payload,
                vector_score: originalResult.score,
              },
            });
          }
          finalResults = rerankedResults;

          logger.info({
            event: "reranking_applied",
            originalTopScore: results[0]?.score,
            rerankedTopScore: finalResults[0]?.score,
          });
        } catch (error) {
          logger.error({
            event: "reranking_failed",
            error: error instanceof Error ? error.message : String(error),
          });
          // Fall back to original results if reranking fails
          logger.info({
            event: "reranking_fallback",
            message: "Using original vector search results due to reranking failure",
          });
        }
      }

      logger.info({
        event: "rag_search_complete",
        resultCount: finalResults.length,
        topScore: finalResults[0]?.score,
        reranked: !!context.rerankConfig,
      });

      logger.debug({
        event: "rag_search_full_results",
        results: finalResults,
      });

      return finalResults;
    },
  });
}
