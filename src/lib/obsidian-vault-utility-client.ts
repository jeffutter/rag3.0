import { z } from "zod";
import { createLogger } from "../core/logging/logger";

const logger = createLogger("obsidian-vault-utility-client");

/**
 * Configuration for the Obsidian Vault Utility API client
 */
export interface ObsidianVaultUtilityConfig {
  baseURL: string;
}

/**
 * Response schema for the tags endpoint
 */
const tagsResponseSchema = z.object({
  tags: z.array(z.string()),
});

/**
 * Response schema for the file read endpoint
 */
const fileReadResponseSchema = z.object({
  content: z.string(),
  path: z.string(),
  modified: z.string().optional(), // ISO timestamp
});

/**
 * Tag entry with document count
 */
export interface TagWithCount {
  tag: string;
  documentCount: number;
}

/**
 * Response schema for the tags with counts endpoint
 */
const tagsWithCountsResponseSchema = z.object({
  tags: z.array(
    z.object({
      tag: z.string(),
      documentCount: z.number(),
    }),
  ),
});

/**
 * File tree node structure matching the obsidian-copilot format
 */
export interface FileTreeNode {
  files?: string[];
  subFolders?: Record<string, FileTreeNode>;
  extensionCounts?: Record<string, number>;
}

/**
 * Response schema for the file tree endpoint
 */
const _fileTreeResponseSchema = z.object({
  vault: z.record(z.string(), z.any()), // Recursive structure validated at runtime
});

/**
 * File match with tags
 */
export interface FileWithTags {
  path: string;
  tags: string[];
  modified?: string | undefined;
}

/**
 * Response schema for the files-by-tags endpoint
 */
const filesByTagsResponseSchema = z.object({
  files: z.array(
    z.object({
      path: z.string(),
      tags: z.array(z.string()),
      modified: z.string().optional(),
    }),
  ),
});

/**
 * Client for interacting with the Obsidian Vault Utility API
 */
export class ObsidianVaultUtilityClient {
  private baseURL: string;

  constructor(config: ObsidianVaultUtilityConfig) {
    this.baseURL = config.baseURL;
  }

  /**
   * Fetches the list of available tags from the vault
   * @returns Array of tag strings
   */
  async getTags(): Promise<string[]> {
    const url = `${this.baseURL}/api/tags`;

    logger.debug({
      event: "fetching_tags",
      url,
    });

    try {
      const response = await fetch(url);

      if (!response.ok) {
        logger.error({
          event: "tags_fetch_failed",
          status: response.status,
          statusText: response.statusText,
        });
        throw new Error(`Failed to fetch tags: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const parsed = tagsResponseSchema.parse(data);

      logger.info({
        event: "tags_fetched",
        count: parsed.tags.length,
      });

      return parsed.tags;
    } catch (error) {
      logger.error({
        event: "tags_fetch_error",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Fetches all tags from the vault with their document counts
   * @returns Array of tags with the number of documents referencing each
   */
  async getTagsWithCounts(): Promise<TagWithCount[]> {
    const url = `${this.baseURL}/api/tags-with-counts`;

    logger.debug({
      event: "fetching_tags_with_counts",
      url,
    });

    try {
      const response = await fetch(url);

      if (!response.ok) {
        logger.error({
          event: "tags_with_counts_fetch_failed",
          status: response.status,
          statusText: response.statusText,
        });
        throw new Error(`Failed to fetch tags with counts: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const parsed = tagsWithCountsResponseSchema.parse(data);

      logger.info({
        event: "tags_with_counts_fetched",
        count: parsed.tags.length,
      });

      return parsed.tags;
    } catch (error) {
      logger.error({
        event: "tags_with_counts_fetch_error",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Reads the content of a file from the vault
   * @param path - Path to the file relative to vault root
   * @returns File content and metadata
   */
  async getFileContent(path: string): Promise<{
    content: string;
    path: string;
    modified?: string | undefined;
  }> {
    const url = `${this.baseURL}/api/file?path=${encodeURIComponent(path)}`;

    logger.debug({
      event: "fetching_file",
      url,
      path,
    });

    try {
      const response = await fetch(url);

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`File not found: ${path}`);
        }
        logger.error({
          event: "file_fetch_failed",
          status: response.status,
          statusText: response.statusText,
        });
        throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const parsed = fileReadResponseSchema.parse(data);

      logger.info({
        event: "file_fetched",
        path: parsed.path,
        contentLength: parsed.content.length,
      });

      return parsed;
    } catch (error) {
      logger.error({
        event: "file_fetch_error",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Searches for files that match the specified tags
   * @param tags - Array of tags to search for
   * @param operator - "and" for files with ALL tags, "or" for files with ANY tag
   * @returns Array of files with their tags
   */
  async searchByTags(tags: string[], operator: "and" | "or" = "or"): Promise<FileWithTags[]> {
    const url = new URL(`${this.baseURL}/api/files-by-tags`);
    url.searchParams.set("tags", tags.join(","));
    url.searchParams.set("operator", operator);

    logger.debug({
      event: "searching_files_by_tags",
      url: url.toString(),
      tags,
      operator,
    });

    try {
      const response = await fetch(url.toString());

      if (!response.ok) {
        logger.error({
          event: "files_by_tags_fetch_failed",
          status: response.status,
          statusText: response.statusText,
        });
        throw new Error(`Failed to search files by tags: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const parsed = filesByTagsResponseSchema.parse(data);

      logger.info({
        event: "files_by_tags_fetched",
        count: parsed.files.length,
        tags,
        operator,
      });

      return parsed.files;
    } catch (error) {
      logger.error({
        event: "files_by_tags_fetch_error",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Fetches the file tree structure of the vault
   * @param includeFiles - Whether to include individual filenames (default: true)
   * @returns File tree structure with folders, files, and extension counts
   */
  async getFileTree(includeFiles = true): Promise<{ vault: FileTreeNode }> {
    const url = `${this.baseURL}/api/file-tree?includeFiles=${includeFiles}`;

    logger.debug({
      event: "fetching_file_tree",
      url,
      includeFiles,
    });

    try {
      const response = await fetch(url);

      if (!response.ok) {
        logger.error({
          event: "file_tree_fetch_failed",
          status: response.status,
          statusText: response.statusText,
        });
        throw new Error(`Failed to fetch file tree: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      logger.info({
        event: "file_tree_fetched",
        responseSize: JSON.stringify(data).length,
      });

      return data as { vault: FileTreeNode };
    } catch (error) {
      logger.error({
        event: "file_tree_fetch_error",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

/**
 * Creates a new Obsidian Vault Utility client
 */
export function createObsidianVaultUtilityClient(config: ObsidianVaultUtilityConfig): ObsidianVaultUtilityClient {
  return new ObsidianVaultUtilityClient(config);
}
