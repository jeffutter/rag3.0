import { describe, expect, test } from "bun:test";
import type { ObsidianVaultUtilityClient } from "../lib/obsidian-vault-utility-client";
import { createObsidianVaultUtilityClient } from "../lib/obsidian-vault-utility-client";
import { createFileReadTool, type FileReadResult } from "./file-read";

describe("File Read Tool", () => {
  // This test requires a running Obsidian Vault Utility server
  // Set VAULT_BASE_URL environment variable to test against a real instance
  test.skip("reads file content successfully", async () => {
    const vaultClient = createObsidianVaultUtilityClient({
      baseURL: process.env.VAULT_BASE_URL || "http://localhost:5680",
    });

    const fileReadTool = createFileReadTool({ vaultClient });

    // Check that the tool was created
    expect(fileReadTool).toBeDefined();
    expect(fileReadTool.name).toBe("read_file");
    expect(fileReadTool.parameters).toBeDefined();
    expect(fileReadTool.execute).toBeDefined();

    // Test reading a file (requires actual file in vault)
    // const result = await fileReadTool.execute({ path: "test.md" });
    // expect(result.status).toBe("success");
  });

  test("rejects paths with leading slash", async () => {
    const mockVaultClient: Pick<ObsidianVaultUtilityClient, "getFileContent"> = {
      getFileContent: async () => {
        throw new Error("Should not be called");
      },
    };

    const fileReadTool = createFileReadTool({
      vaultClient: mockVaultClient as ObsidianVaultUtilityClient,
    });

    const result = (await fileReadTool.execute({ path: "/invalid/path.md" })) as FileReadResult;

    expect(result.status).toBe("invalid_path");
    expect(result.message).toContain("leading slash");
  });

  test("handles not found errors", async () => {
    const mockVaultClient: Pick<ObsidianVaultUtilityClient, "getFileContent"> = {
      getFileContent: async () => {
        throw new Error("File not found: nonexistent.md");
      },
    };

    const fileReadTool = createFileReadTool({
      vaultClient: mockVaultClient as ObsidianVaultUtilityClient,
    });

    const result = (await fileReadTool.execute({ path: "nonexistent.md" })) as FileReadResult;

    expect(result.status).toBe("not_found");
  });

  test("handles API errors", async () => {
    const mockVaultClient: Pick<ObsidianVaultUtilityClient, "getFileContent"> = {
      getFileContent: async () => {
        throw new Error("Network error");
      },
    };

    const fileReadTool = createFileReadTool({
      vaultClient: mockVaultClient as ObsidianVaultUtilityClient,
    });

    const result = (await fileReadTool.execute({ path: "test.md" })) as FileReadResult;

    expect(result.status).toBe("error");
    expect(result.message).toContain("Network error");
  });
});
