import { z } from "zod";
import { createLogger } from "../core/logging/logger";
import type { FileWithTags, ObsidianVaultUtilityClient } from "../lib/obsidian-vault-utility-client";
import { defineTool } from "./registry";

const logger = createLogger("tag-search-tool");

export interface TagSearchToolContext {
  vaultClient: ObsidianVaultUtilityClient;
}

/**
 * Maximum size (in bytes) before truncating results
 */
const MAX_RESPONSE_SIZE_BYTES = 500 * 1024; // 500KB

/**
 * Minimum number of results to return even when truncating
 */
const MIN_RESULTS_AFTER_TRUNCATION = 20;

/**
 * Default maximum number of results to return
 */
const DEFAULT_MAX_RESULTS = 100;

/**
 * Absolute maximum for maxResults parameter
 */
const ABSOLUTE_MAX_RESULTS = 1000;

/**
 * Schema for tag search arguments
 */
const tagSearchArgsSchema = z.object({
  tags: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      "Array of tags to search for. Tags should not include the leading '#' symbol. " +
        "Example: ['work', 'meeting'] to find files tagged with work or meeting.",
    ),
  operator: z
    .enum(["and", "or"])
    .optional()
    .default("or")
    .describe(
      "How to combine multiple tags: " +
        "'and' = files must have ALL specified tags, " +
        "'or' = files must have ANY of the specified tags. " +
        "Default is 'or'.",
    ),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(ABSOLUTE_MAX_RESULTS)
    .optional()
    .default(DEFAULT_MAX_RESULTS)
    .describe(
      `Maximum number of results to return (default: ${DEFAULT_MAX_RESULTS}, max: ${ABSOLUTE_MAX_RESULTS}). ` +
        "Results are sorted by modification date (most recent first).",
    ),
});

type TagSearchArgs = z.infer<typeof tagSearchArgsSchema>;

/**
 * File match in the result
 */
export interface FileMatch {
  path: string;
  tags: string[];
  modified?: string | undefined;
  title?: string | undefined;
}

/**
 * Result type for tag search operations
 */
export interface TagSearchResult {
  status: "success" | "error" | "no_matches";
  matchedFiles?: FileMatch[] | undefined;
  totalMatches?: number | undefined;
  returnedCount?: number | undefined;
  truncated?: boolean | undefined;
  operator?: "and" | "or" | undefined;
  searchedTags?: string[] | undefined;
  message?: string | undefined;
}

/**
 * Extracts a title from a file path
 */
function extractTitle(path: string): string {
  const filename = path.split("/").pop() || path;
  const withoutExt = filename.replace(/\.(md|canvas)$/, "");
  return withoutExt
    .split(/[-_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Sorts files by modification date (most recent first)
 * Files without modification date are placed at the end
 */
function sortByModified(files: FileWithTags[]): FileWithTags[] {
  return [...files].sort((a, b) => {
    if (!a.modified && !b.modified) return 0;
    if (!a.modified) return 1;
    if (!b.modified) return -1;
    return new Date(b.modified).getTime() - new Date(a.modified).getTime();
  });
}

/**
 * Enforces size limit on results by progressively reducing entries
 */
function enforceSizeLimit(
  files: FileMatch[],
  maxSizeBytes: number,
  minEntries: number,
): { files: FileMatch[]; truncated: boolean } {
  let result = files;
  let truncated = false;

  while (JSON.stringify(result).length > maxSizeBytes && result.length > minEntries) {
    const newLength = Math.max(Math.floor(result.length / 2), minEntries);
    result = result.slice(0, newLength);
    truncated = true;
  }

  return { files: result, truncated };
}

/**
 * Creates a tag search tool that finds files matching specified tags.
 *
 * This tool allows the LLM to discover documents by their tag classification,
 * supporting both AND (intersection) and OR (union) operations on multiple tags.
 */
export function createTagSearchTool(context: TagSearchToolContext) {
  return defineTool({
    name: "search_by_tags",
    description:
      "Search for files in the knowledge base that have specific tags in their YAML frontmatter. " +
      "Use 'or' operator to find files with ANY of the specified tags, " +
      "or 'and' operator to find files with ALL specified tags. " +
      "Results are sorted by modification date (most recent first). " +
      "Use list_tags first to discover available tags if needed.",
    parameters: tagSearchArgsSchema,
    execute: async (args: TagSearchArgs): Promise<TagSearchResult> => {
      // Apply defaults
      const operator = args.operator ?? "or";
      const maxResults = args.maxResults ?? DEFAULT_MAX_RESULTS;

      logger.info({
        event: "tag_search_start",
        tags: args.tags,
        operator: operator,
        maxResults: maxResults,
      });

      // Normalize tags (remove # prefix if present, lowercase)
      const normalizedTags = args.tags
        .map((tag) => (tag.startsWith("#") ? tag.slice(1) : tag))
        .map((tag) => tag.toLowerCase());

      if (normalizedTags.length === 0) {
        return {
          status: "error",
          message: "At least one tag must be specified.",
        };
      }

      try {
        // Search for files matching the tags
        const allFiles = await context.vaultClient.searchByTags(normalizedTags, operator);

        if (allFiles.length === 0) {
          logger.info({
            event: "tag_search_no_matches",
            tags: normalizedTags,
            operator: operator,
          });

          return {
            status: "no_matches",
            totalMatches: 0,
            searchedTags: normalizedTags,
            operator: operator,
            message: `No files found with ${operator === "and" ? "all" : "any"} of the tags: ${normalizedTags.join(", ")}`,
          };
        }

        // Sort by modification date
        const sortedFiles = sortByModified(allFiles);

        // Apply maxResults limit
        const limitedFiles = sortedFiles.slice(0, maxResults);

        // Convert to result format with titles
        const resultFiles: FileMatch[] = limitedFiles.map((f) => ({
          path: f.path,
          tags: f.tags,
          modified: f.modified,
          title: extractTitle(f.path),
        }));

        // Enforce size limit
        const { files: finalFiles, truncated } = enforceSizeLimit(
          resultFiles,
          MAX_RESPONSE_SIZE_BYTES,
          MIN_RESULTS_AFTER_TRUNCATION,
        );

        const wasTruncatedByLimit = limitedFiles.length < sortedFiles.length;
        const wasOverallTruncated = truncated || wasTruncatedByLimit;

        logger.info({
          event: "tag_search_complete",
          totalMatches: allFiles.length,
          returnedCount: finalFiles.length,
          truncated: wasOverallTruncated,
          tags: normalizedTags,
          operator: operator,
        });

        return {
          status: "success",
          matchedFiles: finalFiles,
          totalMatches: allFiles.length,
          returnedCount: finalFiles.length,
          truncated: wasOverallTruncated,
          operator: operator,
          searchedTags: normalizedTags,
          message: wasOverallTruncated
            ? `Showing ${finalFiles.length} of ${allFiles.length} matching files.`
            : undefined,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.error({
          event: "tag_search_error",
          tags: normalizedTags,
          operator: operator,
          error: errorMessage,
        });

        return {
          status: "error",
          message: `Error searching by tags: ${errorMessage}`,
        };
      }
    },
  });
}
