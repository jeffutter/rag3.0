import { expect, test } from "bun:test";
import { createObsidianVaultUtilityClient } from "./obsidian-vault-utility-client";

test.skip("ObsidianVaultUtilityClient can fetch tags", async () => {
  // This test requires a running Obsidian Vault Utility server
  // Set VAULT_BASE_URL environment variable to test against a real instance
  const client = createObsidianVaultUtilityClient({
    baseURL: process.env.VAULT_BASE_URL || "http://localhost:5680",
  });

  const tags = await client.getTags();

  expect(tags).toBeInstanceOf(Array);
  expect(tags.length).toBeGreaterThan(0);
  console.log(`Fetched ${tags.length} tags from vault`);
  console.log(`First few tags: ${tags.slice(0, 5).join(", ")}`);
});
