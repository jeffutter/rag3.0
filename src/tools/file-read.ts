import { z } from "zod";
import { createLogger } from "../core/logging/logger";
import type { ObsidianVaultUtilityClient } from "../lib/obsidian-vault-utility-client";
import { defineTool } from "./registry";

const logger = createLogger("file-read-tool");

export interface FileReadToolContext {
  vaultClient: ObsidianVaultUtilityClient;
}

/**
 * Schema for file read arguments
 */
const fileReadArgsSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe(
      "Path to the file relative to the vault root (e.g., 'Projects/plan.md', 'daily/2024-01-15.md'). " +
        "Do not include a leading slash.",
    ),
});

type FileReadArgs = z.infer<typeof fileReadArgsSchema>;

/**
 * Result type for file read operations
 */
export interface FileReadResult {
  status: "success" | "not_found" | "invalid_path" | "error";
  content?: string;
  path?: string;
  modified?: string | undefined;
  message?: string;
}

/**
 * Creates a file read tool that retrieves the contents of a file from the vault.
 *
 * This tool allows the LLM to read the full content of a specific file when the
 * user wants to see or work with a particular document.
 */
export function createFileReadTool(context: FileReadToolContext) {
  return defineTool({
    name: "read_file",
    description:
      "Read the contents of a specific file from the knowledge base. " +
      "Use this when you need to see the full content of a particular document, " +
      "such as when the user asks to read, review, or work with a specific file. " +
      "The path should be relative to the vault root (e.g., 'Projects/plan.md').",
    parameters: fileReadArgsSchema,
    execute: async (args: FileReadArgs): Promise<FileReadResult> => {
      logger.info({
        event: "file_read_start",
        path: args.path,
      });

      // Validate path doesn't have leading slash
      if (args.path.startsWith("/")) {
        logger.warn({
          event: "file_read_invalid_path",
          path: args.path,
          reason: "leading_slash",
        });
        return {
          status: "invalid_path",
          message: "Path should not start with a leading slash. Use a relative path like 'folder/file.md'.",
        };
      }

      try {
        const result = await context.vaultClient.getFileContent(args.path);

        logger.info({
          event: "file_read_complete",
          path: result.path,
          contentLength: result.content.length,
        });

        return {
          status: "success",
          content: result.content,
          path: result.path,
          modified: result.modified,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Check if it's a not found error
        if (errorMessage.includes("not found") || errorMessage.includes("404")) {
          logger.warn({
            event: "file_read_not_found",
            path: args.path,
          });
          return {
            status: "not_found",
            message: `File not found: ${args.path}. Please verify the path is correct.`,
          };
        }

        logger.error({
          event: "file_read_error",
          path: args.path,
          error: errorMessage,
        });

        return {
          status: "error",
          message: `Error reading file: ${errorMessage}`,
        };
      }
    },
  });
}
