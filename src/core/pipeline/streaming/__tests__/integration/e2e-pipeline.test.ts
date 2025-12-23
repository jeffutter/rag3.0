/**
 * End-to-end integration tests for streaming pipelines.
 *
 * Tests complex multi-step pipelines that combine multiple operations
 * to verify correct behavior in realistic scenarios.
 */
import { describe, expect, test } from "bun:test";
import { pipe } from "../../compose";
import { batch, filter, flatMap, fromArray, map, toArray } from "../../generators";
import { parallelMap } from "../../parallel";
import { collectStream, generateDocuments, generateTestStream } from "./helpers";

describe("End-to-End Pipeline Integration", () => {
  describe("multi-step transformation pipelines", () => {
    test("5-step pipeline with various operations", async () => {
      // Create a pipeline that:
      // 1. Generates numbers
      // 2. Filters evens
      // 3. Doubles them
      // 4. Batches them
      // 5. Flattens and sums

      const input = fromArray(Array.from({ length: 20 }, (_, i) => i + 1));

      // Step 1: Filter even numbers
      const evens = filter(input, (n) => n % 2 === 0);

      // Step 2: Double them
      const doubled = map(evens, (n) => n * 2);

      // Step 3: Batch into groups of 3
      const batched = batch(doubled, 3);

      // Step 4: Sum each batch
      const sums = map(batched, (batch) => batch.reduce((sum, n) => sum + n, 0));

      const result = await toArray(sums);

      // Even numbers: 2, 4, 6, 8, 10, 12, 14, 16, 18, 20
      // Doubled: 4, 8, 12, 16, 20, 24, 28, 32, 36, 40
      // Batched: [4,8,12], [16,20,24], [28,32,36], [40]
      // Sums: 24, 60, 96, 40
      expect(result).toEqual([24, 60, 96, 40]);
    });

    test("pipeline with map, flatMap, and filter", async () => {
      interface Item {
        id: number;
        tags: string[];
      }

      const items: Item[] = [
        { id: 1, tags: ["a", "b"] },
        { id: 2, tags: ["b", "c"] },
        { id: 3, tags: [] },
        { id: 4, tags: ["a", "c", "d"] },
      ];

      const input = fromArray(items);

      // Expand tags
      const expandedTags = flatMap(input, (item) => item.tags.map((tag) => ({ id: item.id, tag })));

      // Filter for tag 'a'
      const filtered = filter(expandedTags, (item) => item.tag === "a");

      // Extract IDs
      const ids = map(filtered, (item) => item.id);

      const result = await toArray(ids);

      // Items with tag 'a': id 1 and 4
      expect(result).toEqual([1, 4]);
    });

    test("document processing pipeline", async () => {
      const docs = generateDocuments(10);
      const input = fromArray(docs);

      // Pipeline:
      // 1. Extract words from content
      // 2. Filter out short words
      // 3. Convert to lowercase
      // 4. Count unique words

      const words = flatMap(input, (doc) => doc.content.split(/\s+/));
      const longWords = filter(words, (word) => word.length > 3);
      const lowercase = map(longWords, (word) => word.toLowerCase());

      const wordList = await toArray(lowercase);
      const uniqueWords = new Set(wordList);

      expect(wordList.length).toBeGreaterThan(0);
      expect(uniqueWords.size).toBeGreaterThan(0);
      expect(uniqueWords.size).toBeLessThanOrEqual(wordList.length);
    });
  });

  describe("parallel pipelines", () => {
    test("parallel map in multi-step pipeline", async () => {
      const input = fromArray(Array.from({ length: 10 }, (_, i) => i + 1));

      // Parallel transformation with concurrency limit
      const processed = parallelMap(
        input,
        async (n) => {
          await Bun.sleep(10); // Simulate work
          return n * 2;
        },
        { concurrency: 3, ordered: true },
      );

      // Further processing
      const filtered = filter(processed, (n) => n > 10);
      const result = await toArray(filtered);

      // Numbers 1-10 doubled = 2,4,6,8,10,12,14,16,18,20
      // Filter > 10 = 12,14,16,18,20
      expect(result).toEqual([12, 14, 16, 18, 20]);
    });

    test("multiple parallel stages", async () => {
      const input = fromArray(Array.from({ length: 6 }, (_, i) => i + 1));

      // First parallel stage
      const stage1 = parallelMap(
        input,
        async (n) => {
          await Bun.sleep(5);
          return n * 2;
        },
        { concurrency: 2, ordered: true },
      );

      // Second parallel stage
      const stage2 = parallelMap(
        stage1,
        async (n) => {
          await Bun.sleep(5);
          return n + 1;
        },
        { concurrency: 3, ordered: true },
      );

      const result = await toArray(stage2);

      // Stage 1: 2,4,6,8,10,12
      // Stage 2: 3,5,7,9,11,13
      expect(result).toEqual([3, 5, 7, 9, 11, 13]);
    });
  });

  describe("composition with pipe", () => {
    test("pipe multiple transformations", async () => {
      const double = (stream: AsyncGenerator<number>) => map(stream, (n) => n * 2);
      const addOne = (stream: AsyncGenerator<number>) => map(stream, (n) => n + 1);
      const filterEven = (stream: AsyncGenerator<number>) => filter(stream, (n) => n % 2 === 0);

      const pipeline = pipe(double, addOne, filterEven);

      const input = fromArray([1, 2, 3, 4, 5]);
      const result = await toArray(pipeline(input));

      // Double: 2,4,6,8,10
      // Add one: 3,5,7,9,11
      // Filter even: (none, all are odd)
      expect(result).toEqual([]);
    });

    test("complex composition with batching", async () => {
      const input = fromArray(Array.from({ length: 12 }, (_, i) => i + 1));

      const pipeline = pipe(
        (s: AsyncGenerator<number>) => filter(s, (n) => n % 2 === 0),
        (s: AsyncGenerator<number>) => map(s, (n) => n * 3),
        (s: AsyncGenerator<number>) => batch(s, 2),
        (s: AsyncGenerator<number[]>) => map(s, (b) => b.reduce((sum, n) => sum + n, 0)),
      );

      const result = await toArray(pipeline(input));

      // Even numbers: 2,4,6,8,10,12
      // Times 3: 6,12,18,24,30,36
      // Batched by 2: [6,12],[18,24],[30,36]
      // Sums: 18,42,66
      expect(result).toEqual([18, 42, 66]);
    });
  });

  describe("streaming data sources", () => {
    test("process slow streaming source", async () => {
      const slowSource = generateTestStream([1, 2, 3, 4, 5], 20);

      const doubled = map(slowSource, (n) => n * 2);
      const result = await toArray(doubled);

      expect(result).toEqual([2, 4, 6, 8, 10]);
    });

    test("backpressure with slow consumer", async () => {
      const input = fromArray(Array.from({ length: 5 }, (_, i) => i + 1));

      let processedCount = 0;
      const slowProcess = map(input, async (n) => {
        processedCount++;
        await Bun.sleep(50); // Slow processing
        return n;
      });

      const result = await collectStream(slowProcess);

      expect(result).toEqual([1, 2, 3, 4, 5]);
      expect(processedCount).toBe(5);
    });
  });

  describe("edge cases", () => {
    test("empty stream through pipeline", async () => {
      const input = fromArray<number>([]);

      const result = await toArray(
        pipe(
          (s: AsyncGenerator<number>) => map(s, (n) => n * 2),
          (s: AsyncGenerator<number>) => filter(s, (n) => n > 0),
          (s: AsyncGenerator<number>) => batch(s, 10),
        )(input),
      );

      expect(result).toEqual([]);
    });

    test("single item through complex pipeline", async () => {
      const input = fromArray([42]);

      const pipeline = pipe(
        (s: AsyncGenerator<number>) => map(s, (n) => n * 2),
        (s: AsyncGenerator<number>) => filter(s, (n) => n > 10),
        (s: AsyncGenerator<number>) => map(s, (n) => String(n)),
      );

      const result = await toArray(pipeline(input));

      expect(result).toEqual(["84"]);
    });

    test("all items filtered out", async () => {
      const input = fromArray([1, 2, 3, 4, 5]);

      const filtered = filter(input, (n) => n > 10);
      const result = await toArray(filtered);

      expect(result).toEqual([]);
    });

    test("flatMap producing empty arrays", async () => {
      const input = fromArray([1, 2, 3]);

      // Each item produces empty array
      const flattened = flatMap(input, () => []);
      const result = await toArray(flattened);

      expect(result).toEqual([]);
    });

    test("flatMap with variable outputs", async () => {
      const input = fromArray([0, 1, 2, 3]);

      // Produce N copies of the number
      const expanded = flatMap(input, (n) => Array(n).fill(n));
      const result = await toArray(expanded);

      // 0 produces [], 1 produces [1], 2 produces [2,2], 3 produces [3,3,3]
      expect(result).toEqual([1, 2, 2, 3, 3, 3]);
    });
  });

  describe("real-world patterns", () => {
    test("document chunking pipeline", async () => {
      interface Document {
        id: string;
        content: string;
      }

      interface Chunk {
        docId: string;
        chunkIndex: number;
        content: string;
      }

      const docs: Document[] = [
        { id: "doc1", content: "This is a test document for chunking" },
        { id: "doc2", content: "Another document to be split" },
      ];

      const input = fromArray(docs);

      // Split into chunks (simplified: by words)
      const chunks = flatMap(input, (doc) => {
        const words = doc.content.split(" ");
        const chunkSize = 3;
        const result: Chunk[] = [];

        for (let i = 0; i < words.length; i += chunkSize) {
          result.push({
            docId: doc.id,
            chunkIndex: Math.floor(i / chunkSize),
            content: words.slice(i, i + chunkSize).join(" "),
          });
        }

        return result;
      });

      const result = await toArray(chunks);

      expect(result.length).toBeGreaterThan(0);
      expect(result.every((chunk) => chunk.content.length > 0)).toBe(true);
      expect(result.filter((c) => c.docId === "doc1").length).toBeGreaterThan(0);
      expect(result.filter((c) => c.docId === "doc2").length).toBeGreaterThan(0);
    });

    test("data aggregation pipeline", async () => {
      interface Event {
        userId: string;
        action: string;
        timestamp: number;
      }

      const events: Event[] = [
        { userId: "user1", action: "login", timestamp: 1000 },
        { userId: "user1", action: "view", timestamp: 2000 },
        { userId: "user2", action: "login", timestamp: 1500 },
        { userId: "user1", action: "logout", timestamp: 3000 },
        { userId: "user2", action: "view", timestamp: 2500 },
      ];

      const input = fromArray(events);

      // Group by user and count actions
      const userActions = new Map<string, number>();

      const counted = map(input, (event) => {
        const count = userActions.get(event.userId) || 0;
        userActions.set(event.userId, count + 1);
        return { userId: event.userId, count: count + 1 };
      });

      const result = await toArray(counted);

      expect(result.length).toBe(5);
      expect(result[result.length - 1]?.userId).toBe("user2");
      expect(userActions.get("user1")).toBe(3);
      expect(userActions.get("user2")).toBe(2);
    });
  });

  describe("performance characteristics", () => {
    test("large dataset processing", async () => {
      const size = 10000;
      const input = fromArray(Array.from({ length: size }, (_, i) => i));

      const pipeline = pipe(
        (s: AsyncGenerator<number>) => filter(s, (n) => n % 2 === 0),
        (s: AsyncGenerator<number>) => map(s, (n) => n * 2),
        (s: AsyncGenerator<number>) => batch(s, 100),
        (s: AsyncGenerator<number[]>) => map(s, (b) => b.length),
      );

      const startTime = Date.now();
      const result = await toArray(pipeline(input));
      const duration = Date.now() - startTime;

      // Should process 10k items reasonably fast
      expect(duration).toBeLessThan(1000); // Less than 1 second

      // 5000 even numbers / 100 per batch = 50 batches
      expect(result.length).toBe(50);
      expect(result.every((len) => len === 100)).toBe(true);
    });

    test("latency to first item", async () => {
      const input = fromArray(Array.from({ length: 100 }, (_, i) => i));

      const startTime = Date.now();
      let firstItemTime: number | null = null;

      const stream = map(input, (n) => n);

      for await (const _item of stream) {
        if (firstItemTime === null) {
          firstItemTime = Date.now();
        }
        break; // Only take first item
      }

      await stream.return?.(undefined);

      expect(firstItemTime).not.toBeNull();
      const latency = (firstItemTime as number) - startTime;

      // First item should be available very quickly (streaming)
      expect(latency).toBeLessThan(50); // Less than 50ms
    });
  });
});
