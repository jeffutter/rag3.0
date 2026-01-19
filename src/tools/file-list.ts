import { z } from "zod";
import { createLogger } from "../core/logging/logger";
import type { FileTreeNode, ObsidianVaultUtilityClient } from "../lib/obsidian-vault-utility-client";
import { defineTool } from "./registry";

const logger = createLogger("file-list-tool");

export interface FileListToolContext {
  vaultClient: ObsidianVaultUtilityClient;
}

/**
 * Maximum size (in bytes) before switching to compact mode (no filenames)
 */
const MAX_TREE_SIZE_BYTES = 500 * 1024; // 500KB

/**
 * Schema for file list arguments
 */
const fileListArgsSchema = z.object({
  folder: z
    .string()
    .optional()
    .describe(
      "Optional folder path to list (e.g., 'Projects', 'daily'). " +
        "If omitted, lists the entire vault structure. " +
        "Do not include a leading slash.",
    ),
  includeFiles: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "Whether to include individual filenames in the output. " +
        "Set to false for large vaults to see only folder structure and extension counts.",
    ),
});

type FileListArgs = z.infer<typeof fileListArgsSchema>;

/**
 * Result type for file list operations
 */
export interface FileListResult {
  status: "success" | "not_found" | "error";
  tree?: { vault: FileTreeNode } | { [folder: string]: FileTreeNode };
  truncated?: boolean;
  message?: string;
}

/**
 * Navigates to a specific folder within the file tree
 */
function getSubTree(tree: FileTreeNode, folderPath: string): FileTreeNode | null {
  if (!folderPath || folderPath === "") {
    return tree;
  }

  const parts = folderPath.split("/").filter((p) => p.length > 0);
  let current: FileTreeNode = tree;

  for (const part of parts) {
    if (!current.subFolders || !current.subFolders[part]) {
      return null;
    }
    current = current.subFolders[part];
  }

  return current;
}

/**
 * Creates a file list tool that retrieves the directory structure of the vault.
 *
 * This tool allows the LLM to explore the vault's folder organization,
 * understand where documents are located, and discover files by browsing.
 */
export function createFileListTool(context: FileListToolContext) {
  return defineTool({
    name: "list_files",
    description:
      "List the directory structure of the knowledge base vault. " +
      "Returns a tree showing folders, files, and file type statistics. " +
      "Use this to explore what documents exist, find specific folders, " +
      "or understand the organization of the vault. " +
      "For large vaults, consider setting includeFiles to false to see only the folder structure.",
    parameters: fileListArgsSchema,
    execute: async (args: FileListArgs): Promise<FileListResult> => {
      logger.info({
        event: "file_list_start",
        folder: args.folder,
        includeFiles: args.includeFiles,
      });

      // Validate folder path doesn't have leading slash
      if (args.folder?.startsWith("/")) {
        logger.warn({
          event: "file_list_invalid_path",
          folder: args.folder,
          reason: "leading_slash",
        });
        return {
          status: "error",
          message: "Folder path should not start with a leading slash. Use a relative path like 'Projects'.",
        };
      }

      try {
        // Fetch the full file tree
        let fullTree = await context.vaultClient.getFileTree(args.includeFiles ?? true);
        let truncated = false;

        // Check if response is too large
        const responseSize = JSON.stringify(fullTree).length;
        if (responseSize > MAX_TREE_SIZE_BYTES && args.includeFiles !== false) {
          logger.info({
            event: "file_list_truncating",
            originalSize: responseSize,
            reason: "exceeds_max_size",
          });

          // Refetch without filenames
          fullTree = await context.vaultClient.getFileTree(false);
          truncated = true;
        }

        // If a specific folder was requested, navigate to it
        let result: { vault: FileTreeNode } | { [folder: string]: FileTreeNode };

        if (args.folder) {
          const subTree = getSubTree(fullTree.vault, args.folder);

          if (!subTree) {
            logger.warn({
              event: "file_list_folder_not_found",
              folder: args.folder,
            });
            return {
              status: "not_found",
              message: `Folder not found: ${args.folder}. Please verify the path is correct.`,
            };
          }

          result = { [args.folder]: subTree };
        } else {
          result = fullTree;
        }

        logger.info({
          event: "file_list_complete",
          folder: args.folder || "(root)",
          truncated,
          responseSize: JSON.stringify(result).length,
        });

        return {
          status: "success",
          tree: result,
          truncated,
          message: truncated
            ? "File tree was truncated to exclude individual filenames due to size. Extension counts are still included."
            : undefined,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.error({
          event: "file_list_error",
          folder: args.folder,
          error: errorMessage,
        });

        return {
          status: "error",
          message: `Error listing files: ${errorMessage}`,
        };
      }
    },
  });
}
