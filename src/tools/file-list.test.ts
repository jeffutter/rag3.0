import { describe, expect, test } from "bun:test";
import type { ObsidianVaultUtilityClient } from "../lib/obsidian-vault-utility-client";
import { createObsidianVaultUtilityClient } from "../lib/obsidian-vault-utility-client";
import { createFileListTool } from "./file-list";

describe("File List Tool", () => {
  // This test requires a running Obsidian Vault Utility server
  test.skip("lists vault file tree successfully", async () => {
    const vaultClient = createObsidianVaultUtilityClient({
      baseURL: process.env.VAULT_BASE_URL || "http://localhost:5680",
    });

    const fileListTool = createFileListTool({ vaultClient });

    expect(fileListTool).toBeDefined();
    expect(fileListTool.name).toBe("list_files");
    expect(fileListTool.parameters).toBeDefined();
    expect(fileListTool.execute).toBeDefined();

    // Test listing root
    // const result = await fileListTool.execute({});
    // expect(result.status).toBe("success");
    // expect(result.tree).toBeDefined();
  });

  test("rejects folder paths with leading slash", async () => {
    const mockVaultClient = {
      getFileTree: async () => {
        throw new Error("Should not be called");
      },
    } as Pick<ObsidianVaultUtilityClient, "getFileTree">;

    const fileListTool = createFileListTool({
      vaultClient: mockVaultClient as ObsidianVaultUtilityClient,
    });

    const result = await fileListTool.execute({ folder: "/invalid/path" });

    expect(result.status).toBe("error");
    expect(result.message).toContain("leading slash");
  });

  test("handles folder not found", async () => {
    const mockVaultClient = {
      getFileTree: async () => ({
        vault: {
          files: ["readme.md"],
          subFolders: {
            Projects: {
              files: ["plan.md"],
            },
          },
        },
      }),
    } as Pick<ObsidianVaultUtilityClient, "getFileTree">;

    const fileListTool = createFileListTool({
      vaultClient: mockVaultClient as ObsidianVaultUtilityClient,
    });

    const result = await fileListTool.execute({ folder: "NonexistentFolder" });

    expect(result.status).toBe("not_found");
  });

  test("navigates to subfolder correctly", async () => {
    const mockVaultClient = {
      getFileTree: async () => ({
        vault: {
          files: ["readme.md"],
          subFolders: {
            Projects: {
              files: ["plan.md", "notes.md"],
              subFolders: {
                Archive: {
                  files: ["old.md"],
                },
              },
              extensionCounts: { md: 2 },
            },
          },
        },
      }),
    } as Pick<ObsidianVaultUtilityClient, "getFileTree">;

    const fileListTool = createFileListTool({
      vaultClient: mockVaultClient as ObsidianVaultUtilityClient,
    });

    const result = await fileListTool.execute({ folder: "Projects" });

    expect(result.status).toBe("success");
    expect(result.tree).toBeDefined();
    expect(result.tree?.Projects).toBeDefined();
    expect(result.tree?.Projects.files).toContain("plan.md");
  });

  test("can list without files for large vaults", async () => {
    const mockVaultClient = {
      getFileTree: async (includeFiles: boolean) => ({
        vault: {
          files: includeFiles ? ["readme.md"] : undefined,
          subFolders: {
            Projects: {
              files: includeFiles ? ["plan.md"] : undefined,
              extensionCounts: { md: 1 },
            },
          },
          extensionCounts: { md: 2 },
        },
      }),
    } as Pick<ObsidianVaultUtilityClient, "getFileTree">;

    const fileListTool = createFileListTool({
      vaultClient: mockVaultClient as ObsidianVaultUtilityClient,
    });

    const result = await fileListTool.execute({ includeFiles: false });

    expect(result.status).toBe("success");
    expect(result.tree?.vault?.files).toBeUndefined();
    expect(result.tree?.vault?.extensionCounts).toBeDefined();
  });
});
