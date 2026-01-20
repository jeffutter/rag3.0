import { z } from "zod";
import { createLogger } from "../core/logging/logger";
import type { ObsidianVaultUtilityClient, TagWithCount } from "../lib/obsidian-vault-utility-client";
import { defineTool } from "./registry";

const logger = createLogger("tag-list-tool");

export interface TagListToolContext {
  vaultClient: ObsidianVaultUtilityClient;
}

/**
 * Maximum size (in bytes) before truncating the tag list
 */
const MAX_RESPONSE_SIZE_BYTES = 500 * 1024; // 500KB

/**
 * Minimum number of tags to return even when truncating
 */
const MIN_TAGS_AFTER_TRUNCATION = 50;

/**
 * Default maximum number of tags to return
 */
const DEFAULT_MAX_TAGS = 500;

/**
 * Absolute maximum for maxTags parameter
 */
const ABSOLUTE_MAX_TAGS = 5000;

/**
 * Schema for tag list arguments
 */
const tagListArgsSchema = z.object({
  maxTags: z
    .number()
    .int()
    .min(1)
    .max(ABSOLUTE_MAX_TAGS)
    .optional()
    .default(DEFAULT_MAX_TAGS)
    .describe(
      `Maximum number of tags to return (default: ${DEFAULT_MAX_TAGS}, max: ${ABSOLUTE_MAX_TAGS}). ` +
        "Tags are sorted by document count (most used first).",
    ),
  minDocumentCount: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "Optional minimum document count filter. " + "Only return tags that appear in at least this many documents.",
    ),
});

type TagListArgs = z.infer<typeof tagListArgsSchema>;

/**
 * Tag entry in the result
 */
export interface TagEntry {
  tag: string;
  documentCount: number;
}

/**
 * Result type for tag list operations
 */
export interface TagListResult {
  status: "success" | "error";
  totalUniqueTags?: number;
  returnedCount?: number;
  truncated?: boolean;
  tags?: TagEntry[];
  message?: string;
}

/**
 * Sorts tags by document count (descending) with alphabetical tiebreaking
 */
function sortTags(tags: TagWithCount[]): TagWithCount[] {
  return [...tags].sort((a, b) => {
    if (b.documentCount !== a.documentCount) {
      return b.documentCount - a.documentCount;
    }
    return a.tag.localeCompare(b.tag);
  });
}

/**
 * Enforces size limit on the tag list by progressively reducing entries
 * Following the obsidian-copilot pattern
 */
function enforceSizeLimit(
  tags: TagEntry[],
  maxSizeBytes: number,
  minEntries: number,
): { tags: TagEntry[]; truncated: boolean } {
  let result = tags;
  let truncated = false;

  while (JSON.stringify(result).length > maxSizeBytes && result.length > minEntries) {
    // Halve the number of entries
    const newLength = Math.max(Math.floor(result.length / 2), minEntries);
    result = result.slice(0, newLength);
    truncated = true;
  }

  return { tags: result, truncated };
}

/**
 * Creates a tag list tool that retrieves all tags with their document counts.
 *
 * This tool allows the LLM to explore the tag taxonomy of the vault,
 * understand what topics are most documented, and make informed decisions
 * about tag-based filtering in searches.
 */
export function createTagListTool(context: TagListToolContext) {
  return defineTool({
    name: "list_tags",
    description:
      "List all tags in the knowledge base with the number of documents that reference each tag. " +
      "Tags are extracted from YAML frontmatter. " +
      "Use this to explore the tag taxonomy, find popular topics, or discover available tags for filtering searches. " +
      "Results are sorted by document count (most used tags first).",
    parameters: tagListArgsSchema,
    execute: async (args: TagListArgs): Promise<TagListResult> => {
      logger.info({
        event: "tag_list_start",
        maxTags: args.maxTags,
        minDocumentCount: args.minDocumentCount,
      });

      try {
        // Fetch all tags with counts from the vault
        const allTags = await context.vaultClient.getTagsWithCounts();

        // Sort by document count (descending) with alphabetical tiebreaking
        let sortedTags = sortTags(allTags);

        // Apply minimum document count filter if specified
        if (args.minDocumentCount !== undefined) {
          const minCount = args.minDocumentCount;
          sortedTags = sortedTags.filter((t) => t.documentCount >= minCount);
        }

        // Apply maxTags limit
        const limitedTags = sortedTags.slice(0, args.maxTags);

        // Convert to result format
        const resultTags: TagEntry[] = limitedTags.map((t) => ({
          tag: t.tag,
          documentCount: t.documentCount,
        }));

        // Enforce size limit
        const { tags: finalTags, truncated } = enforceSizeLimit(
          resultTags,
          MAX_RESPONSE_SIZE_BYTES,
          MIN_TAGS_AFTER_TRUNCATION,
        );

        logger.info({
          event: "tag_list_complete",
          totalUniqueTags: allTags.length,
          returnedCount: finalTags.length,
          truncated,
        });

        const wasTruncated = truncated || limitedTags.length < sortedTags.length;

        return {
          status: "success",
          totalUniqueTags: allTags.length,
          returnedCount: finalTags.length,
          truncated: wasTruncated,
          tags: finalTags,
          ...(wasTruncated && {
            message: `Tag list truncated due to size. Showing top ${finalTags.length} tags by document count.`,
          }),
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.error({
          event: "tag_list_error",
          error: errorMessage,
        });

        return {
          status: "error",
          message: `Error listing tags: ${errorMessage}`,
        };
      }
    },
  });
}
