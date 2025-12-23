/**
 * Integration tests for StreamingPipeline builder.
 *
 * These tests verify complex, real-world scenarios including:
 * - Document processing pipelines
 * - Data transformation workflows
 * - Error handling and recovery
 * - Performance characteristics
 * - Memory efficiency
 */

import { describe, expect, test } from "bun:test";
import { StreamingPipeline, streamingStep } from "./streaming-builder";
import { fromArray } from "./streaming/generators";

describe("StreamingPipeline Integration - Document Processing", () => {
  interface Document {
    id: string;
    content: string;
    metadata: Record<string, unknown>;
  }

  interface Chunk {
    id: string;
    content: string;
    documentId: string;
    index: number;
  }

  interface EmbeddedChunk extends Chunk {
    embedding: number[];
  }

  test("end-to-end document embedding pipeline", async () => {
    const documents: Document[] = [
      { id: "doc1", content: "Hello world. This is a test.", metadata: { author: "Alice" } },
      { id: "doc2", content: "Another document. With more content.", metadata: { author: "Bob" } },
      { id: "doc3", content: "Third document here.", metadata: { author: "Charlie" } },
    ];

    // Simulate document chunking
    const chunkDocument = (doc: Document): Chunk[] => {
      const sentences = doc.content.split(". ");
      return sentences.map((content, index) => ({
        id: `${doc.id}-chunk-${index}`,
        content: content.trim(),
        documentId: doc.id,
        index,
      }));
    };

    // Simulate embedding generation (just use content length as embedding)
    const generateEmbedding = async (chunks: Chunk[]): Promise<EmbeddedChunk[]> => {
      await Bun.sleep(5); // Simulate API call
      return chunks.map(chunk => ({
        ...chunk,
        embedding: [chunk.content.length, chunk.content.charCodeAt(0)],
      }));
    };

    const pipeline = StreamingPipeline.start<Document>()
      .filter("valid", (doc) => doc.content.length > 0)
      .flatMap("chunks", (doc) => chunkDocument(doc))
      .filter("nonEmpty", (chunk) => chunk.content.length > 0)
      .batch("batches", 2)
      .map("embedded", (batch) => generateEmbedding(batch), { parallel: true })
      .flatMap("flattened", (batch) => batch);

    const results = await pipeline.executeToArray(fromArray(documents));

    // Verify results
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => r.embedding && r.embedding.length > 0)).toBe(true);
    expect(results.every(r => r.documentId && r.content)).toBe(true);

    // Check that chunks from all documents are present
    const docIds = new Set(results.map(r => r.documentId));
    expect(docIds.size).toBe(3);
  });

  test("streaming document processing with early termination", async () => {
    let documentsProcessed = 0;
    let chunksCreated = 0;

    const pipeline = StreamingPipeline.start<Document>()
      .tap("countDocs", () => { documentsProcessed++; })
      .flatMap("chunks", (doc) => {
        const chunks = doc.content.split(". ").map((c, i) => ({
          id: `${doc.id}-${i}`,
          content: c,
          documentId: doc.id,
          index: i,
        }));
        chunksCreated += chunks.length;
        return chunks;
      })
      .take("first5", 5);

    const documents = Array.from({ length: 100 }, (_, i) => ({
      id: `doc${i}`,
      content: "Sentence one. Sentence two. Sentence three.",
      metadata: {},
    }));

    const results = await pipeline.executeToArray(fromArray(documents));

    expect(results.length).toBe(5);
    // Should process fewer than all documents due to early termination
    expect(documentsProcessed).toBeLessThan(100);
    // Should create fewer chunks than would be needed for all documents
    expect(chunksCreated).toBeLessThan(300);
  });
});

describe("StreamingPipeline Integration - Data Transformation", () => {
  interface LogEntry {
    timestamp: number;
    level: "info" | "warn" | "error";
    message: string;
    metadata?: Record<string, unknown>;
  }

  interface ErrorSummary {
    hour: number;
    count: number;
    messages: string[];
  }

  test("log processing and aggregation pipeline", async () => {
    const logs: LogEntry[] = [
      { timestamp: 1000, level: "info", message: "Started" },
      { timestamp: 2000, level: "error", message: "Error 1" },
      { timestamp: 3000, level: "warn", message: "Warning" },
      { timestamp: 4000, level: "error", message: "Error 2" },
      { timestamp: 3600000, level: "error", message: "Error 3" },
      { timestamp: 3601000, level: "info", message: "Success" },
    ];

    const pipeline = StreamingPipeline.start<LogEntry>()
      .filter("errors", (log) => log.level === "error")
      .map("withHour", (log) => ({
        ...log,
        hour: Math.floor(log.timestamp / 3600000),
      }))
      .batch("hourly", 100); // Batch for aggregation

    const batches = await pipeline.executeToArray(fromArray(logs));

    expect(batches.length).toBeGreaterThan(0);
    const allErrors = batches.flat();
    expect(allErrors.length).toBe(3);
    expect(allErrors.every(e => e.level === "error")).toBe(true);
  });

  test("real-time event stream processing", async () => {
    interface Event {
      id: string;
      type: string;
      value: number;
    }

    const events: Event[] = Array.from({ length: 100 }, (_, i) => ({
      id: `event-${i}`,
      type: i % 3 === 0 ? "critical" : "normal",
      value: Math.random() * 100,
    }));

    const pipeline = StreamingPipeline.start<Event>()
      .filter("critical", (e) => e.type === "critical")
      .filter("highValue", (e) => e.value > 50)
      .map("enriched", (e) => ({
        ...e,
        processedAt: Date.now(),
        priority: "high",
      }))
      .take("top10", 10);

    const results = await pipeline.executeToArray(fromArray(events));

    expect(results.length).toBeLessThanOrEqual(10);
    expect(results.every(r => r.type === "critical")).toBe(true);
    expect(results.every(r => r.value > 50)).toBe(true);
    expect(results.every(r => r.priority === "high")).toBe(true);
  });
});

describe("StreamingPipeline Integration - Pagination", () => {
  test("implements pagination with skip and take", async () => {
    const items = Array.from({ length: 100 }, (_, i) => i);

    const getPage = (pageNumber: number, pageSize: number) => {
      return StreamingPipeline.start<number>()
        .skip("toPage", pageNumber * pageSize)
        .take("pageItems", pageSize);
    };

    // Get page 0 (items 0-9)
    const page0 = await getPage(0, 10).executeToArray(fromArray(items));
    expect(page0).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    // Get page 2 (items 20-29)
    const page2 = await getPage(2, 10).executeToArray(fromArray(items));
    expect(page2).toEqual([20, 21, 22, 23, 24, 25, 26, 27, 28, 29]);

    // Get page 9 (items 90-99)
    const page9 = await getPage(9, 10).executeToArray(fromArray(items));
    expect(page9).toEqual([90, 91, 92, 93, 94, 95, 96, 97, 98, 99]);

    // Get page beyond end
    const page10 = await getPage(10, 10).executeToArray(fromArray(items));
    expect(page10).toEqual([]);
  });

  test("implements cursor-based pagination", async () => {
    interface Item {
      id: number;
      value: string;
    }

    const items: Item[] = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      value: `item-${i}`,
    }));

    const getAfter = (afterId: number, limit: number) => {
      return StreamingPipeline.start<Item>()
        .skipWhile("afterCursor", (item) => item.id <= afterId)
        .take("limit", limit);
    };

    // Get first 10
    const first10 = await getAfter(-1, 10).executeToArray(fromArray(items));
    expect(first10.length).toBe(10);
    expect(first10[0]?.id).toBe(0);
    expect(first10[9]?.id).toBe(9);

    // Get next 10 after id 9
    const next10 = await getAfter(9, 10).executeToArray(fromArray(items));
    expect(next10.length).toBe(10);
    expect(next10[0]?.id).toBe(10);
    expect(next10[9]?.id).toBe(19);
  });
});

describe("StreamingPipeline Integration - Batching Strategies", () => {
  test("processes in batches for API efficiency", async () => {
    let apiCallCount = 0;

    const batchProcess = async (items: number[]): Promise<number[]> => {
      apiCallCount++;
      await Bun.sleep(10); // Simulate API call
      return items.map(n => n * 2);
    };

    const pipeline = StreamingPipeline.start<number>()
      .batch("batches", 10)
      .map("processed", (batch) => batchProcess(batch))
      .flatMap("flattened", (batch) => batch);

    const items = Array.from({ length: 35 }, (_, i) => i);
    const results = await pipeline.executeToArray(fromArray(items));

    expect(results.length).toBe(35);
    expect(results[0]).toBe(0);
    expect(results[34]).toBe(68);

    // Should make 4 API calls: 10 + 10 + 10 + 5
    expect(apiCallCount).toBe(4);
  });

  test("unbatches for item-level processing", async () => {
    const pipeline = StreamingPipeline.start<number>()
      .batch("batches", 5)
      .map("batchSums", (batch) => ({
        items: batch,
        sum: batch.reduce((a, b) => a + b, 0),
      }))
      .flatMap("unbatched", (batchResult) => batchResult.items.map(item => ({
        item,
        batchSum: batchResult.sum,
      })));

    const results = await pipeline.executeToArray(fromArray([1, 2, 3, 4, 5, 6, 7]));

    expect(results.length).toBe(7);

    // First batch: [1,2,3,4,5] sum=15
    expect(results[0]?.batchSum).toBe(15);
    expect(results[4]?.batchSum).toBe(15);

    // Second batch: [6,7] sum=13
    expect(results[5]?.batchSum).toBe(13);
    expect(results[6]?.batchSum).toBe(13);
  });
});

describe("StreamingPipeline Integration - Complex Transformations", () => {
  test("multi-stage data enrichment", async () => {
    interface User {
      id: string;
      name: string;
    }

    interface UserWithScore extends User {
      score: number;
    }

    interface UserWithRank extends UserWithScore {
      rank: string;
    }

    const users: User[] = [
      { id: "1", name: "Alice" },
      { id: "2", name: "Bob" },
      { id: "3", name: "Charlie" },
    ];

    const pipeline = StreamingPipeline.start<User>()
      .map("withScore", (user) => ({
        ...user,
        score: user.name.length * 10,
      }))
      .map("withRank", (user: UserWithScore): UserWithRank => ({
        ...user,
        rank: user.score > 50 ? "high" : "low",
      }))
      .filter("highRank", (user: UserWithRank) => user.rank === "high");

    const results = await pipeline.executeToArray(fromArray(users));

    expect(results.length).toBe(1);
    expect(results[0]?.name).toBe("Charlie");
    expect(results[0]?.score).toBe(70);
    expect(results[0]?.rank).toBe("high");
  });

  test("hierarchical data flattening", async () => {
    interface Category {
      name: string;
      products: Product[];
    }

    interface Product {
      name: string;
      variants: string[];
    }

    interface FlatProduct {
      category: string;
      product: string;
      variant: string;
    }

    const categories: Category[] = [
      {
        name: "Electronics",
        products: [
          { name: "Phone", variants: ["Black", "White"] },
          { name: "Laptop", variants: ["13inch", "15inch"] },
        ],
      },
      {
        name: "Books",
        products: [
          { name: "Fiction", variants: ["Hardcover", "Paperback"] },
        ],
      },
    ];

    const pipeline = StreamingPipeline.start<Category>()
      .flatMap("products", (cat) => cat.products.map(p => ({ category: cat.name, product: p })))
      .flatMap("variants", ({ category, product }) =>
        product.variants.map(v => ({
          category,
          product: product.name,
          variant: v,
        }))
      );

    const results = await pipeline.executeToArray(fromArray(categories));

    expect(results.length).toBe(6); // 2*2 + 1*2 = 6 variants total
    expect(results.filter(r => r.category === "Electronics").length).toBe(4);
    expect(results.filter(r => r.category === "Books").length).toBe(2);
  });
});

describe("StreamingPipeline Integration - Performance", () => {
  test("handles large datasets efficiently", async () => {
    const largeDataset = Array.from({ length: 10000 }, (_, i) => i);

    const startTime = Date.now();

    const pipeline = StreamingPipeline.start<number>()
      .filter("evens", (n) => n % 2 === 0)
      .map("squared", (n) => n * n)
      .filter("large", (n) => n > 1000000)
      .take("first100", 100);

    const results = await pipeline.executeToArray(fromArray(largeDataset));

    const duration = Date.now() - startTime;

    expect(results.length).toBe(100);
    expect(duration).toBeLessThan(1000); // Should complete in under 1 second

    // Verify correctness
    expect(results[0]).toBeGreaterThan(1000000);
    expect(results.every(n => n % 4 === 0)).toBe(true); // Squares of evens
  });

  test("parallel processing improves throughput", async () => {
    const items = Array.from({ length: 100 }, (_, i) => i);

    const slowProcess = async (n: number) => {
      await Bun.sleep(10);
      return n * 2;
    };

    // Sequential processing
    const sequentialStart = Date.now();
    const sequentialPipeline = StreamingPipeline.start<number>()
      .map("processed", (n) => slowProcess(n));

    await sequentialPipeline.executeToArray(fromArray(items));
    const sequentialDuration = Date.now() - sequentialStart;

    // Parallel processing
    const parallelStart = Date.now();
    const parallelPipeline = StreamingPipeline.start<number>()
      .map("processed", (n) => slowProcess(n), { parallel: true, concurrency: 10 });

    await parallelPipeline.executeToArray(fromArray(items));
    const parallelDuration = Date.now() - parallelStart;

    // Parallel should be significantly faster
    expect(parallelDuration).toBeLessThan(sequentialDuration / 2);
  });
});

describe("StreamingPipeline Integration - Memory Efficiency", () => {
  test("processes items lazily without full materialization", async () => {
    let itemsGenerated = 0;
    let itemsProcessed = 0;

    // Create a generator that tracks how many items are created
    async function* trackedGenerator() {
      for (let i = 0; i < 1000; i++) {
        itemsGenerated++;
        yield i;
      }
    }

    const pipeline = StreamingPipeline.start<number>()
      .tap("track", () => { itemsProcessed++; })
      .filter("evens", (n) => n % 2 === 0)
      .take("first10", 10); // Only take 10 items

    const results = await pipeline.executeToArray(trackedGenerator());

    expect(results.length).toBe(10);

    // Because we only take 10 evens, we should only process about 20 items
    // (not all 1000), demonstrating lazy evaluation
    expect(itemsProcessed).toBeLessThan(100);
    expect(itemsGenerated).toBeLessThan(100);
  });
});

describe("StreamingPipeline Integration - Custom Steps", () => {
  test("integrates custom streaming steps", async () => {
    const deduplicateStep = streamingStep<string, string>(
      "deduplicate",
      async function* ({ input }) {
        const seen = new Set<string>();
        for await (const item of input) {
          if (!seen.has(item)) {
            seen.add(item);
            yield item;
          }
        }
      }
    );

    const pipeline = StreamingPipeline.start<string>()
      .add("deduped", deduplicateStep)
      .map("uppercased", (s) => s.toUpperCase());

    const results = await pipeline.executeToArray(fromArray(["a", "b", "a", "c", "b", "d"]));

    expect(results).toEqual(["A", "B", "C", "D"]);
  });

  test("combines custom steps with built-in operations", async () => {
    const windowAverageStep = streamingStep<number, number>(
      "windowAverage",
      async function* ({ input }) {
        const window: number[] = [];
        const windowSize = 3;

        for await (const item of input) {
          window.push(item);
          if (window.length > windowSize) {
            window.shift();
          }

          if (window.length === windowSize) {
            const avg = window.reduce((a, b) => a + b, 0) / windowSize;
            yield avg;
          }
        }
      }
    );

    const pipeline = StreamingPipeline.start<number>()
      .add("averaged", windowAverageStep)
      .map("rounded", (n) => Math.round(n));

    const results = await pipeline.executeToArray(fromArray([1, 2, 3, 4, 5, 6, 7]));

    expect(results.length).toBe(5); // 7 items - 2 for window warmup
    expect(results[0]).toBe(2); // avg(1,2,3) = 2
    expect(results[1]).toBe(3); // avg(2,3,4) = 3
    expect(results[4]).toBe(6); // avg(5,6,7) = 6
  });
});

describe("StreamingPipeline Integration - Terminal Operations", () => {
  test("reduces to aggregate statistics", async () => {
    interface Stats {
      count: number;
      sum: number;
      min: number;
      max: number;
    }

    const pipeline = StreamingPipeline.start<number>()
      .filter("positive", (n) => n > 0);

    const items = [-5, 3, -2, 7, 1, -1, 9, 4];

    const stats = await pipeline.reduce(
      fromArray(items),
      (acc, n) => ({
        count: acc.count + 1,
        sum: acc.sum + n,
        min: Math.min(acc.min, n),
        max: Math.max(acc.max, n),
      }),
      { count: 0, sum: 0, min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY } as Stats
    );

    expect(stats.count).toBe(5);
    expect(stats.sum).toBe(24); // 3+7+1+9+4
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(9);
  });

  test("forEach processes all items", async () => {
    const processed: number[] = [];
    const errors: string[] = [];

    const pipeline = StreamingPipeline.start<number>()
      .map("doubled", (n) => n * 2);

    await pipeline.forEach(fromArray([1, 2, 3, 4, 5]), (item, index) => {
      if (item > 5) {
        processed.push(item);
      }
    });

    expect(processed).toEqual([6, 8, 10]);
  });
});
