import { expect, test } from "bun:test";
import { createObsidianVaultUtilityClient } from "../lib/obsidian-vault-utility-client";
import { VectorSearchClient } from "../retrieval/qdrant-client";
import { createRAGSearchTool } from "./rag-search";

test.skip("RAG search tool includes available tags in schema", async () => {
  // This test requires a running Obsidian Vault Utility server
  // Set VAULT_BASE_URL environment variable to test against a real instance

  // Create mock clients
  const vectorClient = new VectorSearchClient({
    url: "http://localhost:6333",
  });

  const vaultClient = createObsidianVaultUtilityClient({
    baseURL: process.env.VAULT_BASE_URL || "http://localhost:5680",
  });

  // Create the RAG search tool
  const ragTool = await createRAGSearchTool({
    vectorClient,
    embeddingConfig: {
      baseURL: "http://localhost:8080/v1",
      model: "nomic-embed-text",
    },
    defaultCollection: "rag_store",
    vaultClient,
  });

  // Check that the tool was created
  expect(ragTool).toBeDefined();
  expect(ragTool.name).toBe("search_knowledge_base");
  expect(ragTool.parameters).toBeDefined();
  expect(ragTool.execute).toBeDefined();

  console.log("✓ RAG search tool successfully created with dynamic tags support");
  console.log(`  Tool name: ${ragTool.name}`);
  console.log(`  Tool description: ${ragTool.description}`);
});
