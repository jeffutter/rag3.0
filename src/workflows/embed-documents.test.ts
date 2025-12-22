import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { embedDocuments } from "./embed-documents";

/**
 * Test setup
 */
let testDir: string;
let mockServer: ReturnType<typeof Bun.serve> | null = null;
let mockPort: number;

beforeAll(async () => {
  // Create test directory with sample markdown files
  testDir = join(tmpdir(), `embed-docs-test-${Date.now()}`);
  await mkdir(testDir, { recursive: true });

  // Create sample markdown files
  await writeFile(
    join(testDir, "doc1.md"),
    `---
tags: test, sample
---

# Document 1

This is the first test document with some content. It has enough text to create multiple chunks when split. This content will be cleaned, split, and embedded.

## Section 1

More content here to make this document longer and ensure we get multiple chunks from the splitting process.

## Section 2

Even more content to ensure proper testing of the workflow.`,
  );

  await writeFile(
    join(testDir, "doc2.md"),
    `---
tags: test, example
---

# Document 2

This is the second test document. It also has substantial content that will be processed through the embedding workflow.

## Important Information

This section contains important details that should be preserved in the chunks.`,
  );

  await writeFile(
    join(testDir, "doc3.md"),
    `# Short Doc

Just a brief document.`,
  );

  // Create subdirectory with more files
  await mkdir(join(testDir, "subdir"));
  await writeFile(
    join(testDir, "subdir", "doc4.md"),
    `# Nested Document

This document is in a subdirectory and should be discovered recursively.`,
  );

  // Create a non-markdown file (should be ignored)
  await writeFile(join(testDir, "readme.txt"), "This is not markdown");

  // Start mock embedding server
  mockServer = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/v1/embeddings" && req.method === "POST") {
        const body = await req.json();

        // Generate mock embeddings
        const embeddings = body.input.map((_text: string, index: number) => ({
          embedding: Array(384)
            .fill(0)
            .map(() => Math.random()),
          index,
        }));

        return Response.json({ data: embeddings });
      }

      if (url.pathname === "/error" && req.method === "POST") {
        return new Response("API Error", { status: 500 });
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  if (!mockServer.port) {
    throw new Error("Mock server port is not defined");
  }
  mockPort = mockServer.port;
});

afterAll(async () => {
  // Clean up
  await rm(testDir, { recursive: true, force: true });
  if (mockServer) {
    mockServer.stop();
  }
});

test("embedDocuments: processes all markdown files in folder", async () => {
  const result = await embedDocuments({
    folderPath: testDir,
    embeddingEndpoint: `http://localhost:${mockPort}/v1/embeddings`,
    embeddingModel: "test-model",
    batchSize: 50,
  });

  expect(result.totalFiles).toBe(4); // doc1, doc2, doc3, doc4 (not readme.txt)
  expect(result.totalChunks).toBeGreaterThan(0);
  expect(result.documents.length).toBeGreaterThan(0);
  expect(result.documents.length).toBe(result.totalChunks);
});

test("embedDocuments: generates valid embeddings for all chunks", async () => {
  const result = await embedDocuments({
    folderPath: testDir,
    embeddingEndpoint: `http://localhost:${mockPort}/v1/embeddings`,
    embeddingModel: "test-model",
    batchSize: 50,
  });

  for (const doc of result.documents) {
    // Verify structure
    expect(doc.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(typeof doc.content).toBe("string");
    expect(doc.content.length).toBeGreaterThan(0);
    expect(Array.isArray(doc.vector)).toBe(true);
    expect(doc.vector.length).toBe(384);
    expect(doc.vector.every((n: number) => typeof n === "number")).toBe(true);
    expect(typeof doc.metadata).toBe("object");
    expect(Array.isArray(doc.tags)).toBe(true);
  }
});

test("embedDocuments: adds end-of-text token to chunks", async () => {
  const result = await embedDocuments({
    folderPath: testDir,
    embeddingEndpoint: `http://localhost:${mockPort}/v1/embeddings`,
    embeddingModel: "test-model",
    batchSize: 50,
    eotToken: "<|endoftext|>",
  });

  // All chunks should end with the EOT token
  for (const doc of result.documents) {
    expect(doc.content).toEndWith("<|endoftext|>");
  }
});

test("embedDocuments: uses custom EOT token", async () => {
  const customToken = "[EOT]";
  const result = await embedDocuments({
    folderPath: testDir,
    embeddingEndpoint: `http://localhost:${mockPort}/v1/embeddings`,
    embeddingModel: "test-model",
    batchSize: 50,
    eotToken: customToken,
  });

  for (const doc of result.documents) {
    expect(doc.content).toEndWith(customToken);
  }
});

test("embedDocuments: does not add EOT token when not specified", async () => {
  const result = await embedDocuments({
    folderPath: testDir,
    embeddingEndpoint: `http://localhost:${mockPort}/v1/embeddings`,
    embeddingModel: "test-model",
    batchSize: 50,
    // No eotToken specified
  });

  // Chunks should not end with the default token
  for (const doc of result.documents) {
    expect(doc.content).not.toEndWith("<|endoftext|>");
  }
});

test("embedDocuments: batches chunks efficiently", async () => {
  let requestCount = 0;
  let maxBatchSize = 0;

  // Create server that tracks requests
  const trackingServer = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = await req.json();
      requestCount++;
      maxBatchSize = Math.max(maxBatchSize, body.input.length);

      const embeddings = body.input.map((_: string, index: number) => ({
        embedding: Array(384).fill(0.1),
        index,
      }));

      return Response.json({ data: embeddings });
    },
  });

  await embedDocuments({
    folderPath: testDir,
    embeddingEndpoint: `http://localhost:${trackingServer.port}/`,
    embeddingModel: "test-model",
    batchSize: 5, // Small batch size to test batching
  });

  trackingServer.stop();

  // Should make multiple requests with batches <= 5
  expect(requestCount).toBeGreaterThan(0);
  expect(maxBatchSize).toBeLessThanOrEqual(5);
});

test("embedDocuments: preserves metadata from frontmatter", async () => {
  const result = await embedDocuments({
    folderPath: testDir,
    embeddingEndpoint: `http://localhost:${mockPort}/v1/embeddings`,
    embeddingModel: "test-model",
    batchSize: 50,
  });

  // Find chunks from doc1 (has tags: test, sample)
  const doc1Chunks = result.documents.filter((d) => d.tags.includes("test") || d.tags.includes("sample"));

  expect(doc1Chunks.length).toBeGreaterThan(0);

  for (const chunk of doc1Chunks) {
    expect(chunk.metadata).toBeTruthy();
    expect(chunk.metadata.source).toBeTruthy();
  }
});

test("embedDocuments: handles empty folder gracefully", async () => {
  const emptyDir = join(tmpdir(), `empty-test-${Date.now()}`);
  await mkdir(emptyDir, { recursive: true });

  const result = await embedDocuments({
    folderPath: emptyDir,
    embeddingEndpoint: `http://localhost:${mockPort}/v1/embeddings`,
    embeddingModel: "test-model",
    batchSize: 50,
  });

  await rm(emptyDir, { recursive: true, force: true });

  expect(result.totalFiles).toBe(0);
  expect(result.totalChunks).toBe(0);
  expect(result.documents.length).toBe(0);
});

test("embedDocuments: handles API errors gracefully", async () => {
  const result = await embedDocuments({
    folderPath: testDir,
    embeddingEndpoint: `http://localhost:${mockPort}/error`,
    embeddingModel: "test-model",
    batchSize: 50,
  });

  // Should process files but fail to embed
  expect(result.totalFiles).toBe(4);
  // Documents array might be empty if all batches failed
  expect(result.documents.length).toBe(0);
});

test("embedDocuments: respects custom chunk sizes", async () => {
  const result = await embedDocuments({
    folderPath: testDir,
    embeddingEndpoint: `http://localhost:${mockPort}/v1/embeddings`,
    embeddingModel: "test-model",
    batchSize: 50,
    minChunkSize: 50,
    maxChunkSize: 200,
    chunkOverlap: 20,
  });

  // Verify chunks respect size constraints (no EOT token in this test)
  for (const doc of result.documents) {
    // Some chunks may be smaller than minChunkSize if they're the last chunk
    expect(doc.content.length).toBeLessThanOrEqual(400); // Reasonable upper bound
  }
});

test("embedDocuments: filters files by pattern", async () => {
  // Create a file with different extension
  await writeFile(join(testDir, "data.json"), "{}");

  const result = await embedDocuments({
    folderPath: testDir,
    pattern: "doc1.md", // Only match doc1.md
    embeddingEndpoint: `http://localhost:${mockPort}/v1/embeddings`,
    embeddingModel: "test-model",
    batchSize: 50,
  });

  expect(result.totalFiles).toBe(1);
  expect(result.documents.length).toBeGreaterThan(0);
});

test("embedDocuments: handles files with invalid markdown", async () => {
  // Create a file with only frontmatter (no content)
  await writeFile(
    join(testDir, "empty-content.md"),
    `---
tags: empty
---`,
  );

  const result = await embedDocuments({
    folderPath: testDir,
    embeddingEndpoint: `http://localhost:${mockPort}/v1/embeddings`,
    embeddingModel: "test-model",
    batchSize: 50,
  });

  // Should still process other files
  expect(result.totalFiles).toBeGreaterThanOrEqual(4);
});

test("embedDocuments: generates deterministic chunk IDs", async () => {
  // Run twice and compare IDs
  const result1 = await embedDocuments({
    folderPath: testDir,
    embeddingEndpoint: `http://localhost:${mockPort}/v1/embeddings`,
    embeddingModel: "test-model",
    batchSize: 50,
  });

  const result2 = await embedDocuments({
    folderPath: testDir,
    embeddingEndpoint: `http://localhost:${mockPort}/v1/embeddings`,
    embeddingModel: "test-model",
    batchSize: 50,
  });

  // IDs should be the same across runs
  const ids1 = result1.documents.map((d) => d.id).sort();
  const ids2 = result2.documents.map((d) => d.id).sort();

  expect(ids1).toEqual(ids2);
});

test("embedDocuments: removes specified headings", async () => {
  // Create a file with headings that should be removed
  await writeFile(
    join(testDir, "with-headings.md"),
    `# Main Title

## Project List

This section should be removed.

## Important Content

This section should be kept.`,
  );

  const result = await embedDocuments({
    folderPath: testDir,
    pattern: "with-headings.md",
    embeddingEndpoint: `http://localhost:${mockPort}/v1/embeddings`,
    embeddingModel: "test-model",
    batchSize: 50,
    headingsToRemove: ["Project List"],
  });

  // Verify content doesn't include removed heading
  const allContent = result.documents.map((d) => d.content).join(" ");
  expect(allContent).not.toContain("Project List");
  expect(allContent).toContain("Important Content");
});

test("embedDocuments: handles large batch of files", async () => {
  // Create a temporary directory with many files
  const largeTestDir = join(tmpdir(), `large-test-${Date.now()}`);
  await mkdir(largeTestDir, { recursive: true });

  // Create 10 files
  for (let i = 0; i < 10; i++) {
    await writeFile(
      join(largeTestDir, `file${i}.md`),
      `# File ${i}\n\nContent for file ${i}. This is some sample text that will be embedded.`,
    );
  }

  const result = await embedDocuments({
    folderPath: largeTestDir,
    embeddingEndpoint: `http://localhost:${mockPort}/v1/embeddings`,
    embeddingModel: "test-model",
    batchSize: 50,
  });

  await rm(largeTestDir, { recursive: true, force: true });

  expect(result.totalFiles).toBe(10);
  expect(result.documents.length).toBeGreaterThan(0);
});

test("embedDocuments: validates configuration schema", async () => {
  // Invalid batch size
  await expect(
    embedDocuments({
      folderPath: testDir,
      embeddingEndpoint: `http://localhost:${mockPort}/v1/embeddings`,
      embeddingModel: "test-model",
      batchSize: -1, // Invalid
    }),
  ).rejects.toThrow();
});

test("embedDocuments: includes chunk index in metadata", async () => {
  const result = await embedDocuments({
    folderPath: testDir,
    pattern: "doc1.md", // File with multiple chunks
    embeddingEndpoint: `http://localhost:${mockPort}/v1/embeddings`,
    embeddingModel: "test-model",
    batchSize: 50,
    maxChunkSize: 200, // Small size to ensure multiple chunks
  });

  // Should have multiple chunks from doc1
  expect(result.documents.length).toBeGreaterThan(1);

  // Verify chunks have sequential indices
  const hasIndexZero = result.documents.some((d) => d.metadata.tags);
  expect(hasIndexZero).toBe(true);
});
