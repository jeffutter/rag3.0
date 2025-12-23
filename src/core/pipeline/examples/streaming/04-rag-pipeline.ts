/**
 * Real-World RAG Pipeline Example
 *
 * Demonstrates a complete RAG (Retrieval-Augmented Generation) document processing pipeline:
 * - Stream documents from source
 * - Chunk documents in parallel
 * - Batch for embedding API
 * - Stream to vector store
 * - Memory savings vs batch processing
 * - Latency to first result
 * - Progress tracking and metrics
 *
 * Run with: bun run src/core/pipeline/examples/streaming/04-rag-pipeline.ts
 */

import { fromArray } from "../../streaming/generators";
import { StreamingPipeline } from "../../streaming-builder";

// =============================================================================
// Domain Types
// =============================================================================

interface Document {
  id: string;
  content: string;
  metadata: {
    source: string;
    timestamp: number;
  };
}

interface DocumentChunk {
  documentId: string;
  chunkIndex: number;
  content: string;
  metadata: {
    source: string;
    totalChunks: number;
  };
}

interface EmbeddedChunk {
  documentId: string;
  chunkIndex: number;
  content: string;
  embedding: number[];
  metadata: {
    source: string;
    embeddingModel: string;
  };
}

interface VectorStoreEntry {
  id: string;
  vector: number[];
  content: string;
  metadata: Record<string, unknown>;
}

// =============================================================================
// Simulated Services
// =============================================================================

// Simulate document fetching from various sources
async function* fetchDocumentsFromSource(sources: string[]): AsyncGenerator<Document> {
  for (const source of sources) {
    // Simulate fetching multiple documents per source
    const docCount = 2 + Math.floor(Math.random() * 3); // 2-4 docs per source

    for (let i = 0; i < docCount; i++) {
      await Bun.sleep(50); // Simulate network delay

      const doc: Document = {
        id: `${source}-doc-${i}`,
        content: `This is document ${i} from ${source}. `.repeat(20), // ~500 chars
        metadata: {
          source,
          timestamp: Date.now(),
        },
      };

      yield doc;
    }
  }
}

// Simulate text chunking with overlap
async function chunkDocument(doc: Document, chunkSize = 200, overlap = 50): Promise<DocumentChunk[]> {
  await Bun.sleep(20); // Simulate processing time

  const chunks: DocumentChunk[] = [];
  const content = doc.content;
  let position = 0;

  while (position < content.length) {
    const chunkContent = content.slice(position, position + chunkSize);
    chunks.push({
      documentId: doc.id,
      chunkIndex: chunks.length,
      content: chunkContent,
      metadata: {
        source: doc.metadata.source,
        totalChunks: 0, // Will be updated
      },
    });

    position += chunkSize - overlap;
  }

  // Update total chunks
  chunks.forEach((chunk) => {
    chunk.metadata.totalChunks = chunks.length;
  });

  return chunks;
}

// Simulate embedding API (batch or single)
async function generateEmbeddings(chunks: DocumentChunk[]): Promise<EmbeddedChunk[]> {
  // Simulate API call with rate limiting
  await Bun.sleep(100 + chunks.length * 10);

  return chunks.map((chunk) => ({
    documentId: chunk.documentId,
    chunkIndex: chunk.chunkIndex,
    content: chunk.content,
    embedding: Array.from({ length: 384 }, () => Math.random()), // Mock embedding
    metadata: {
      source: chunk.metadata.source,
      embeddingModel: "mock-embed-v1",
    },
  }));
}

// Simulate vector store insertion
async function insertToVectorStore(entries: VectorStoreEntry[]): Promise<void> {
  await Bun.sleep(50 + entries.length * 5);
  console.log(`    Inserted ${entries.length} vectors to store`);
}

// =============================================================================
// Example 1: Basic Streaming RAG Pipeline
// =============================================================================

async function basicStreamingRAG() {
  console.log("\n=== Example 1: Basic Streaming RAG Pipeline ===\n");

  const sources = ["api", "docs", "blog"];
  let firstResultTime: number | null = null;
  let _totalProcessed = 0;

  const pipeline = StreamingPipeline.start<string>()
    .flatMap("documents", async (source) => {
      console.log(`Fetching from ${source}...`);
      const docs: Document[] = [];
      for await (const doc of fetchDocumentsFromSource([source])) {
        docs.push(doc);
      }
      return docs;
    })
    .tap("docReceived", (doc) => {
      if (firstResultTime === null) {
        firstResultTime = Date.now();
      }
      console.log(`  Received: ${doc.id}`);
    })
    .map("chunked", async (doc) => await chunkDocument(doc), {
      parallel: true,
      concurrency: 5,
    })
    .flatMap("chunks", (chunks) => chunks)
    .batch("batchedChunks", 10) // Batch for embedding API
    .map("embedded", async (batch) => await generateEmbeddings(batch as DocumentChunk[]), {
      parallel: true,
      concurrency: 3,
    })
    .flatMap("flattened", (batch) => batch)
    .tap("counted", () => {
      _totalProcessed++;
    });

  const startTime = Date.now();

  const results = await pipeline.executeToArray(fromArray(sources));

  const totalTime = Date.now() - startTime;
  const timeToFirst = firstResultTime ? firstResultTime - startTime : 0;

  console.log(`\nMetrics:`);
  console.log(`  Total chunks embedded: ${results.length}`);
  console.log(`  Time to first result: ${timeToFirst}ms`);
  console.log(`  Total time: ${totalTime}ms`);
  console.log(`  Throughput: ${((results.length / totalTime) * 1000).toFixed(2)} chunks/sec`);
}

// =============================================================================
// Example 2: Streaming vs Batch Comparison
// =============================================================================

async function streamingVsBatch() {
  console.log("\n=== Example 2: Streaming vs Batch Comparison ===\n");

  const sources = ["source-1", "source-2", "source-3"];

  // Batch approach
  console.log("Batch approach:");
  const batchStart = Date.now();

  // Step 1: Fetch all documents
  const allDocs: Document[] = [];
  for await (const doc of fetchDocumentsFromSource(sources)) {
    allDocs.push(doc);
  }
  console.log(`  Fetched ${allDocs.length} documents`);

  // Step 2: Chunk all documents
  const allChunks: DocumentChunk[] = [];
  for (const doc of allDocs) {
    const chunks = await chunkDocument(doc);
    allChunks.push(...chunks);
  }
  console.log(`  Created ${allChunks.length} chunks`);

  // Step 3: Batch and embed
  const batchSize = 10;
  const allEmbedded: EmbeddedChunk[] = [];
  for (let i = 0; i < allChunks.length; i += batchSize) {
    const batch = allChunks.slice(i, i + batchSize);
    const embedded = await generateEmbeddings(batch);
    allEmbedded.push(...embedded);
  }

  const batchTime = Date.now() - batchStart;
  console.log(`  Batch time: ${batchTime}ms`);
  console.log(`  Peak memory: ${allDocs.length} docs + ${allChunks.length} chunks in memory\n`);

  // Streaming approach
  console.log("Streaming approach:");
  const streamStart = Date.now();
  let firstChunkTime: number | null = null;

  const pipeline = StreamingPipeline.start<string>()
    .flatMap("documents", async (source) => {
      const docs: Document[] = [];
      for await (const doc of fetchDocumentsFromSource([source])) {
        docs.push(doc);
      }
      return docs;
    })
    .map("chunked", async (doc) => await chunkDocument(doc), {
      parallel: true,
      concurrency: 5,
    })
    .flatMap("chunks", (chunks) => chunks)
    .tap("firstChunk", () => {
      if (firstChunkTime === null) {
        firstChunkTime = Date.now();
      }
    })
    .batch("batches", batchSize)
    .map("embedded", async (batch) => await generateEmbeddings(batch as DocumentChunk[]), {
      parallel: true,
      concurrency: 3,
    })
    .flatMap("flattened", (batch) => batch);

  const streamResults = await pipeline.executeToArray(fromArray(sources));

  const streamTime = Date.now() - streamStart;
  const timeToFirstChunk = firstChunkTime ? firstChunkTime - streamStart : 0;

  console.log(`  Streaming time: ${streamTime}ms`);
  console.log(`  Time to first chunk: ${timeToFirstChunk}ms`);
  console.log(`  Memory: Only current batch in memory (bounded)\n`);

  console.log(`Comparison:`);
  console.log(`  Batch: ${batchTime}ms (${allEmbedded.length} chunks)`);
  console.log(`  Streaming: ${streamTime}ms (${streamResults.length} chunks)`);
  console.log(`  Time to first result: Batch must complete all steps, Streaming: ${timeToFirstChunk}ms`);
}

// =============================================================================
// Example 3: Progressive Results with Progress Tracking
// =============================================================================

async function progressiveResults() {
  console.log("\n=== Example 3: Progressive Results ===\n");

  const sources = Array.from({ length: 5 }, (_, i) => `source-${i + 1}`);

  let documentsProcessed = 0;
  let chunksCreated = 0;
  let chunksEmbedded = 0;
  let vectorsStored = 0;

  const pipeline = StreamingPipeline.start<string>()
    .flatMap("documents", async (source) => {
      const docs: Document[] = [];
      for await (const doc of fetchDocumentsFromSource([source])) {
        docs.push(doc);
        documentsProcessed++;
      }
      return docs;
    })
    .map(
      "chunked",
      async (doc) => {
        const chunks = await chunkDocument(doc);
        chunksCreated += chunks.length;
        return chunks;
      },
      {
        parallel: true,
        concurrency: 5,
      },
    )
    .flatMap("chunks", (chunks) => chunks)
    .batch("batches", 10)
    .map(
      "embedded",
      async (batch) => {
        const embedded = await generateEmbeddings(batch);
        chunksEmbedded += embedded.length;
        return embedded;
      },
      {
        parallel: true,
        concurrency: 3,
      },
    )
    .flatMap("flattened", (batch) => batch)
    .batch("storeBatches", 20) // Larger batches for storage
    .tap("stored", async (batch) => {
      const entries: VectorStoreEntry[] = batch.map((chunk) => ({
        id: `${chunk.documentId}-${chunk.chunkIndex}`,
        vector: chunk.embedding,
        content: chunk.content,
        metadata: chunk.metadata,
      }));

      await insertToVectorStore(entries);
      vectorsStored += entries.length;

      console.log(
        `Progress: ${documentsProcessed} docs, ${chunksCreated} chunks, ${chunksEmbedded} embedded, ${vectorsStored} stored`,
      );
    });

  console.log("Processing with progress tracking:\n");

  await pipeline.forEach(fromArray(sources), () => {
    // Just consume the stream, progress logged in tap
  });

  console.log(`\nFinal: ${vectorsStored} vectors stored successfully`);
}

// =============================================================================
// Example 4: Error Handling and Retry in RAG Pipeline
// =============================================================================

async function errorHandlingRAG() {
  console.log("\n=== Example 4: Error Handling in RAG ===\n");

  const sources = ["source-1", "source-2", "source-3"];

  let retryCount = 0;
  let skipCount = 0;

  // Simulate unreliable embedding service
  async function unreliableEmbeddings(chunks: DocumentChunk[]): Promise<EmbeddedChunk[]> {
    // 30% chance of failure
    if (Math.random() < 0.3) {
      throw new Error("Embedding service temporarily unavailable");
    }
    return generateEmbeddings(chunks);
  }

  const pipeline = StreamingPipeline.start<string>()
    .flatMap("documents", async (source) => {
      const docs: Document[] = [];
      for await (const doc of fetchDocumentsFromSource([source])) {
        docs.push(doc);
      }
      return docs;
    })
    .flatMap("chunks", async (doc) => await chunkDocument(doc))
    .batch("batches", 10)
    .map("embedded", async (batch) => {
      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts) {
        try {
          return await unreliableEmbeddings(batch);
        } catch (_error) {
          attempts++;
          retryCount++;
          console.log(`  Retry ${attempts}/${maxAttempts} for batch of ${batch.length} chunks`);

          if (attempts >= maxAttempts) {
            console.log(`  Skipping batch after ${maxAttempts} attempts`);
            skipCount += batch.length;
            return []; // Skip this batch
          }

          await Bun.sleep(100 * attempts); // Exponential backoff
        }
      }
      return [];
    })
    .flatMap("flattened", (batch) => batch);

  const results = await pipeline.executeToArray(fromArray(sources));

  console.log(`\nResults:`);
  console.log(`  Successfully embedded: ${results.length} chunks`);
  console.log(`  Total retries: ${retryCount}`);
  console.log(`  Skipped chunks: ${skipCount}`);
}

// =============================================================================
// Example 5: Memory-Efficient Large Dataset Processing
// =============================================================================

async function largeDatasetProcessing() {
  console.log("\n=== Example 5: Large Dataset Processing ===\n");

  const LARGE_SOURCE_COUNT = 20;
  const sources = Array.from({ length: LARGE_SOURCE_COUNT }, (_, i) => `source-${i + 1}`);

  console.log(`Processing ${LARGE_SOURCE_COUNT} sources with streaming...\n`);

  let peakConcurrentChunks = 0;
  let currentConcurrentChunks = 0;

  const pipeline = StreamingPipeline.start<string>()
    .flatMap("documents", async (source) => {
      const docs: Document[] = [];
      for await (const doc of fetchDocumentsFromSource([source])) {
        docs.push(doc);
      }
      return docs;
    })
    .map(
      "chunked",
      async (doc) => {
        currentConcurrentChunks++;
        peakConcurrentChunks = Math.max(peakConcurrentChunks, currentConcurrentChunks);

        const chunks = await chunkDocument(doc);

        currentConcurrentChunks--;
        return chunks;
      },
      {
        parallel: true,
        concurrency: 10,
      },
    )
    .flatMap("chunks", (chunks) => chunks)
    .batch("batches", 20)
    .map("embedded", async (batch) => await generateEmbeddings(batch), {
      parallel: true,
      concurrency: 5,
    })
    .flatMap("flattened", (batch) => batch);

  const startTime = Date.now();
  let processed = 0;

  // Process in streaming fashion
  for await (const _chunk of pipeline.execute(fromArray(sources))) {
    processed++;

    if (processed % 50 === 0) {
      const elapsed = Date.now() - startTime;
      const rate = (processed / elapsed) * 1000;
      console.log(`  Processed ${processed} chunks (${rate.toFixed(2)} chunks/sec)`);
    }
  }

  const totalTime = Date.now() - startTime;

  console.log(`\nCompleted:`);
  console.log(`  Total chunks: ${processed}`);
  console.log(`  Total time: ${totalTime}ms`);
  console.log(`  Average rate: ${((processed / totalTime) * 1000).toFixed(2)} chunks/sec`);
  console.log(`  Peak concurrent chunks in processing: ${peakConcurrentChunks}`);
  console.log(`  Memory: Bounded by concurrency limits`);
}

// =============================================================================
// Example 6: Early Termination for Search
// =============================================================================

async function earlyTerminationSearch() {
  console.log("\n=== Example 6: Early Termination (Search Use Case) ===\n");

  const sources = Array.from({ length: 100 }, (_, i) => `source-${i + 1}`);

  const searchQuery = "important";
  let documentsScanned = 0;
  let chunksProcessed = 0;

  const pipeline = StreamingPipeline.start<string>()
    .flatMap("documents", async (source) => {
      const docs: Document[] = [];
      for await (const doc of fetchDocumentsFromSource([source])) {
        docs.push(doc);
        documentsScanned++;
      }
      return docs;
    })
    .flatMap("chunks", async (doc) => await chunkDocument(doc))
    .tap("counted", () => {
      chunksProcessed++;
    })
    .batch("batches", 10)
    .map("embedded", async (batch) => await generateEmbeddings(batch))
    .flatMap("flattened", (batch) => batch);

  console.log(`Searching for first 10 relevant chunks...\n`);

  const results: EmbeddedChunk[] = [];
  const startTime = Date.now();

  for await (const chunk of pipeline.execute(fromArray(sources))) {
    // Simulate relevance check
    if (chunk.content.includes(searchQuery) || Math.random() < 0.1) {
      results.push(chunk);
      console.log(`  Found relevant chunk ${results.length}`);

      if (results.length >= 10) {
        console.log("\n  Found enough results, stopping...");
        break; // Early termination!
      }
    }
  }

  const totalTime = Date.now() - startTime;

  console.log(`\nEarly Termination Results:`);
  console.log(`  Found: ${results.length} relevant chunks`);
  console.log(`  Documents scanned: ${documentsScanned}/${sources.length}`);
  console.log(`  Chunks processed: ${chunksProcessed}`);
  console.log(`  Time: ${totalTime}ms`);
  console.log(`  Saved: ${((1 - documentsScanned / sources.length) * 100).toFixed(1)}% of work`);
}

// =============================================================================
// Main: Run All Examples
// =============================================================================

async function runAllExamples() {
  console.log("=".repeat(70));
  console.log("REAL-WORLD RAG PIPELINE EXAMPLES");
  console.log("=".repeat(70));

  await basicStreamingRAG();
  await streamingVsBatch();
  await progressiveResults();
  await errorHandlingRAG();
  await largeDatasetProcessing();
  await earlyTerminationSearch();

  console.log(`\n${"=".repeat(70)}`);
  console.log("All RAG pipeline examples completed!");
  console.log("=".repeat(70));
}

// Run examples if executed directly
if (import.meta.main) {
  runAllExamples().catch(console.error);
}

export {
  basicStreamingRAG,
  streamingVsBatch,
  progressiveResults,
  errorHandlingRAG,
  largeDatasetProcessing,
  earlyTerminationSearch,
};
