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
}

/**
 * Creates a new Obsidian Vault Utility client
 */
export function createObsidianVaultUtilityClient(config: ObsidianVaultUtilityConfig): ObsidianVaultUtilityClient {
  return new ObsidianVaultUtilityClient(config);
}
