import { describe, expect, test } from "bun:test";
import { createObsidianVaultUtilityClient } from "../lib/obsidian-vault-utility-client";
import { createTagSearchTool, type TagSearchResult } from "./tag-search";

// Helper to execute with partial args (tests only)
type PartialTagSearchArgs = {
  tags: string[];
  operator?: "and" | "or";
  maxResults?: number;
};

async function executeTagSearch(
  tool: ReturnType<typeof createTagSearchTool>,
  args: PartialTagSearchArgs,
): Promise<TagSearchResult> {
  // biome-ignore lint/suspicious/noExplicitAny: Test helper needs to accept partial args
  return (await tool.execute(args as any)) as TagSearchResult;
}

describe("Tag Search Tool", () => {
  // Integration test - requires running vault utility server
  test.skip("searches files by tags successfully", async () => {
    const vaultClient = createObsidianVaultUtilityClient({
      baseURL: process.env.VAULT_BASE_URL || "http://localhost:5680",
    });

    const tagSearchTool = createTagSearchTool({ vaultClient });

    expect(tagSearchTool).toBeDefined();
    expect(tagSearchTool.name).toBe("search_by_tags");
    expect(tagSearchTool.parameters).toBeDefined();
    expect(tagSearchTool.execute).toBeDefined();
  });

  test("finds files with OR operator (default)", async () => {
    const mockVaultClient = {
      searchByTags: async (_tags: string[], operator: string) => {
        expect(operator).toBe("or");
        return [
          { path: "notes/meeting-2024-01-15.md", tags: ["meeting", "work"], modified: "2024-01-15T10:00:00Z" },
          { path: "notes/project-plan.md", tags: ["work", "project"], modified: "2024-01-10T09:00:00Z" },
        ];
      },
    };

    const tagSearchTool = createTagSearchTool({
      // biome-ignore lint/suspicious/noExplicitAny: Test mock with partial interface
      vaultClient: mockVaultClient as any,
    });

    const result = await executeTagSearch(tagSearchTool, {
      tags: ["work"],
      operator: "or",
      maxResults: 100,
    });

    expect(result.status).toBe("success");
    expect(result.totalMatches).toBe(2);
    expect(result.matchedFiles).toHaveLength(2);
    expect(result.operator).toBe("or");
  });

  test("finds files with AND operator", async () => {
    const mockVaultClient = {
      searchByTags: async (tags: string[], operator: string) => {
        expect(operator).toBe("and");
        expect(tags).toEqual(["work", "meeting"]);
        // Only one file has both tags
        return [{ path: "notes/meeting-2024-01-15.md", tags: ["meeting", "work"], modified: "2024-01-15T10:00:00Z" }];
      },
    };

    const tagSearchTool = createTagSearchTool({
      // biome-ignore lint/suspicious/noExplicitAny: Test mock with partial interface
      vaultClient: mockVaultClient as any,
    });

    const result = await executeTagSearch(tagSearchTool, {
      tags: ["work", "meeting"],
      operator: "and",
    });

    expect(result.status).toBe("success");
    expect(result.totalMatches).toBe(1);
    expect(result.matchedFiles?.[0]?.path).toBe("notes/meeting-2024-01-15.md");
  });

  test("handles no matches", async () => {
    const mockVaultClient = {
      searchByTags: async () => [],
    };

    const tagSearchTool = createTagSearchTool({
      // biome-ignore lint/suspicious/noExplicitAny: Test mock with partial interface
      vaultClient: mockVaultClient as any,
    });

    const result = await executeTagSearch(tagSearchTool, { tags: ["nonexistent-tag"] });

    expect(result.status).toBe("no_matches");
    expect(result.totalMatches).toBe(0);
    expect(result.message).toContain("No files found");
  });

  test("sorts results by modification date (most recent first)", async () => {
    const mockVaultClient = {
      searchByTags: async () => [
        { path: "old.md", tags: ["work"], modified: "2024-01-01T00:00:00Z" },
        { path: "newest.md", tags: ["work"], modified: "2024-01-20T00:00:00Z" },
        { path: "middle.md", tags: ["work"], modified: "2024-01-10T00:00:00Z" },
      ],
    };

    const tagSearchTool = createTagSearchTool({
      // biome-ignore lint/suspicious/noExplicitAny: Test mock with partial interface
      vaultClient: mockVaultClient as any,
    });

    const result = await executeTagSearch(tagSearchTool, { tags: ["work"] });

    expect(result.status).toBe("success");
    expect(result.matchedFiles?.[0]?.path).toBe("newest.md");
    expect(result.matchedFiles?.[1]?.path).toBe("middle.md");
    expect(result.matchedFiles?.[2]?.path).toBe("old.md");
  });

  test("files without modified date are placed at end", async () => {
    const mockVaultClient = {
      searchByTags: async () => [
        { path: "no-date.md", tags: ["work"] },
        { path: "with-date.md", tags: ["work"], modified: "2024-01-15T00:00:00Z" },
      ],
    };

    const tagSearchTool = createTagSearchTool({
      // biome-ignore lint/suspicious/noExplicitAny: Test mock with partial interface
      vaultClient: mockVaultClient as any,
    });

    const result = await executeTagSearch(tagSearchTool, { tags: ["work"] });

    expect(result.status).toBe("success");
    expect(result.matchedFiles?.[0]?.path).toBe("with-date.md");
    expect(result.matchedFiles?.[1]?.path).toBe("no-date.md");
  });

  test("respects maxResults limit", async () => {
    const mockVaultClient = {
      searchByTags: async () =>
        Array.from({ length: 50 }, (_, i) => ({
          path: `file-${i.toString().padStart(3, "0")}.md`,
          tags: ["work"],
          modified: new Date(2024, 0, i + 1).toISOString(),
        })),
    };

    const tagSearchTool = createTagSearchTool({
      // biome-ignore lint/suspicious/noExplicitAny: Test mock with partial interface
      vaultClient: mockVaultClient as any,
    });

    const result = await executeTagSearch(tagSearchTool, {
      tags: ["work"],
      maxResults: 10,
    });

    expect(result.status).toBe("success");
    expect(result.totalMatches).toBe(50);
    expect(result.returnedCount).toBe(10);
    expect(result.truncated).toBe(true);
  });

  test("normalizes tags (removes # prefix, lowercases)", async () => {
    const mockVaultClient = {
      searchByTags: async (tags: string[]) => {
        expect(tags).toEqual(["work", "meeting"]);
        return [];
      },
    };

    const tagSearchTool = createTagSearchTool({
      // biome-ignore lint/suspicious/noExplicitAny: Test mock with partial interface
      vaultClient: mockVaultClient as any,
    });

    await executeTagSearch(tagSearchTool, { tags: ["#Work", "MEETING"] });
  });

  test("extracts title from file path", async () => {
    const mockVaultClient = {
      searchByTags: async () => [
        { path: "notes/my-awesome-project.md", tags: ["work"] },
        { path: "daily/2024-01-15.md", tags: ["journal"] },
      ],
    };

    const tagSearchTool = createTagSearchTool({
      // biome-ignore lint/suspicious/noExplicitAny: Test mock with partial interface
      vaultClient: mockVaultClient as any,
    });

    const result = await executeTagSearch(tagSearchTool, { tags: ["work", "journal"] });

    expect(result.matchedFiles?.[0]?.title).toBe("My Awesome Project");
    expect(result.matchedFiles?.[1]?.title).toBe("2024 01 15");
  });

  test("handles API errors gracefully", async () => {
    const mockVaultClient = {
      searchByTags: async () => {
        throw new Error("Network error");
      },
    };

    const tagSearchTool = createTagSearchTool({
      // biome-ignore lint/suspicious/noExplicitAny: Test mock with partial interface
      vaultClient: mockVaultClient as any,
    });

    const result = await executeTagSearch(tagSearchTool, { tags: ["work"] });

    expect(result.status).toBe("error");
    expect(result.message).toContain("Network error");
  });

  test("includes all file tags in response (not just matched ones)", async () => {
    const mockVaultClient = {
      searchByTags: async () => [
        { path: "note.md", tags: ["work", "important", "project"], modified: "2024-01-15T00:00:00Z" },
      ],
    };

    const tagSearchTool = createTagSearchTool({
      // biome-ignore lint/suspicious/noExplicitAny: Test mock with partial interface
      vaultClient: mockVaultClient as any,
    });

    const result = await executeTagSearch(tagSearchTool, { tags: ["work"] });

    expect(result.status).toBe("success");
    expect(result.matchedFiles?.[0]?.tags).toEqual(["work", "important", "project"]);
  });
});
