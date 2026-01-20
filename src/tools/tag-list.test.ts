import { describe, expect, test } from "bun:test";
import { createObsidianVaultUtilityClient } from "../lib/obsidian-vault-utility-client";
import { createTagListTool, type TagListResult } from "./tag-list";

describe("Tag List Tool", () => {
  // Integration test - requires running vault utility server
  test.skip("lists tags with counts successfully", async () => {
    const vaultClient = createObsidianVaultUtilityClient({
      baseURL: process.env.VAULT_BASE_URL || "http://localhost:5680",
    });

    const tagListTool = createTagListTool({ vaultClient });

    expect(tagListTool).toBeDefined();
    expect(tagListTool.name).toBe("list_tags");
    expect(tagListTool.parameters).toBeDefined();
    expect(tagListTool.execute).toBeDefined();

    // Test listing tags
    // const result = await tagListTool.execute({});
    // expect(result.status).toBe("success");
    // expect(result.tags).toBeDefined();
  });

  test("sorts tags by document count descending", async () => {
    const mockVaultClient = {
      getTagsWithCounts: async () => [
        { tag: "rare-tag", documentCount: 1 },
        { tag: "common-tag", documentCount: 100 },
        { tag: "medium-tag", documentCount: 50 },
      ],
    };

    const tagListTool = createTagListTool({
      // biome-ignore lint/suspicious/noExplicitAny: Test mock with partial interface
      vaultClient: mockVaultClient as any,
    });

    const result = (await tagListTool.execute({ maxTags: 500 })) as TagListResult;

    expect(result.status).toBe("success");
    expect(result.tags).toBeDefined();
    // biome-ignore lint/style/noNonNullAssertion: Verified to be defined in test
    const tags = result.tags!;
    // biome-ignore lint/style/noNonNullAssertion: Test data guaranteed to have 3 elements
    expect(tags[0]!.tag).toBe("common-tag");
    // biome-ignore lint/style/noNonNullAssertion: Test data guaranteed to have 3 elements
    expect(tags[1]!.tag).toBe("medium-tag");
    // biome-ignore lint/style/noNonNullAssertion: Test data guaranteed to have 3 elements
    expect(tags[2]!.tag).toBe("rare-tag");
  });

  test("alphabetical tiebreaking when document counts are equal", async () => {
    const mockVaultClient = {
      getTagsWithCounts: async () => [
        { tag: "zebra", documentCount: 10 },
        { tag: "apple", documentCount: 10 },
        { tag: "banana", documentCount: 10 },
      ],
    };

    const tagListTool = createTagListTool({
      // biome-ignore lint/suspicious/noExplicitAny: Test mock with partial interface
      vaultClient: mockVaultClient as any,
    });

    const result = (await tagListTool.execute({ maxTags: 500 })) as TagListResult;

    expect(result.status).toBe("success");
    // biome-ignore lint/style/noNonNullAssertion: Verified to be defined in test
    const tags = result.tags!;
    // biome-ignore lint/style/noNonNullAssertion: Test data guaranteed to have 3 elements
    expect(tags[0]!.tag).toBe("apple");
    // biome-ignore lint/style/noNonNullAssertion: Test data guaranteed to have 3 elements
    expect(tags[1]!.tag).toBe("banana");
    // biome-ignore lint/style/noNonNullAssertion: Test data guaranteed to have 3 elements
    expect(tags[2]!.tag).toBe("zebra");
  });

  test("respects maxTags limit", async () => {
    const mockVaultClient = {
      getTagsWithCounts: async () =>
        Array.from({ length: 100 }, (_, i) => ({
          tag: `tag-${i.toString().padStart(3, "0")}`,
          documentCount: 100 - i,
        })),
    };

    const tagListTool = createTagListTool({
      // biome-ignore lint/suspicious/noExplicitAny: Test mock with partial interface
      vaultClient: mockVaultClient as any,
    });

    const result = (await tagListTool.execute({ maxTags: 10 })) as TagListResult;

    expect(result.status).toBe("success");
    expect(result.returnedCount).toBe(10);
    expect(result.totalUniqueTags).toBe(100);
    expect(result.truncated).toBe(true);
  });

  test("filters by minimum document count", async () => {
    const mockVaultClient = {
      getTagsWithCounts: async () => [
        { tag: "rare", documentCount: 1 },
        { tag: "common", documentCount: 50 },
        { tag: "very-common", documentCount: 100 },
      ],
    };

    const tagListTool = createTagListTool({
      // biome-ignore lint/suspicious/noExplicitAny: Test mock with partial interface
      vaultClient: mockVaultClient as any,
    });

    const result = (await tagListTool.execute({ maxTags: 500, minDocumentCount: 10 })) as TagListResult;

    expect(result.status).toBe("success");
    expect(result.returnedCount).toBe(2);
    // biome-ignore lint/style/noNonNullAssertion: Verified to be defined in test
    expect(result.tags!.map((t: { tag: string; documentCount: number }) => t.tag)).toEqual(["very-common", "common"]);
  });

  test("handles API errors gracefully", async () => {
    const mockVaultClient = {
      getTagsWithCounts: async () => {
        throw new Error("Network error");
      },
    };

    const tagListTool = createTagListTool({
      // biome-ignore lint/suspicious/noExplicitAny: Test mock with partial interface
      vaultClient: mockVaultClient as any,
    });

    const result = (await tagListTool.execute({ maxTags: 500 })) as TagListResult;

    expect(result.status).toBe("error");
    expect(result.message).toContain("Network error");
  });

  test("handles empty tag list", async () => {
    const mockVaultClient = {
      getTagsWithCounts: async () => [],
    };

    const tagListTool = createTagListTool({
      // biome-ignore lint/suspicious/noExplicitAny: Test mock with partial interface
      vaultClient: mockVaultClient as any,
    });

    const result = (await tagListTool.execute({ maxTags: 500 })) as TagListResult;

    expect(result.status).toBe("success");
    expect(result.totalUniqueTags).toBe(0);
    expect(result.returnedCount).toBe(0);
    expect(result.tags).toEqual([]);
  });
});
