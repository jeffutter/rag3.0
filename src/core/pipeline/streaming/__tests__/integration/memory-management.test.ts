/**
 * Integration tests for memory and resource management in streaming pipelines.
 *
 * Tests bounded memory usage, early termination cleanup, and resource
 * lifecycle management.
 */
import { describe, expect, test } from "bun:test";
import { batch, filter, map, take, toArray } from "../../generators";
import { parallelMap } from "../../parallel";
import { countStream, infiniteStream, takeN } from "./helpers";

describe("Memory and Resource Management Integration", () => {
  describe("bounded memory usage", () => {
    test("large dataset doesn't overflow memory", async () => {
      const size = 100000;

      // Create a large stream without materializing it
      async function* largeStream() {
        for (let i = 0; i < size; i++) {
          yield i;
        }
      }

      // Process without holding everything in memory
      let sum = 0;
      const stream = map(largeStream(), (n) => {
        sum += n;
        return n;
      });

      const count = await countStream(stream);

      expect(count).toBe(size);
      expect(sum).toBe((size * (size - 1)) / 2); // Sum formula
    });

    test("streaming batching maintains bounded memory", async () => {
      const size = 10000;
      const batchSize = 100;

      async function* largeStream() {
        for (let i = 0; i < size; i++) {
          yield i;
        }
      }

      const batched = batch(largeStream(), batchSize);

      let batchCount = 0;
      for await (const b of batched) {
        batchCount++;
        // Each batch should be the right size (except maybe the last)
        expect(b.length).toBeLessThanOrEqual(batchSize);
        // Process and discard - don't accumulate
      }

      expect(batchCount).toBe(size / batchSize);
    });

    test("parallel processing doesn't accumulate unbounded items", async () => {
      const size = 1000;

      async function* source() {
        for (let i = 0; i < size; i++) {
          yield i;
        }
      }

      let processedCount = 0;
      const stream = parallelMap(
        source(),
        async (n) => {
          await Bun.sleep(1);
          processedCount++;
          return n;
        },
        { concurrency: 10 },
      );

      const count = await countStream(stream);

      expect(count).toBe(size);
      expect(processedCount).toBe(size);
    });
  });

  describe("early termination cleanup", () => {
    test("consumer stops mid-stream - cleanup happens", async () => {
      let cleanupCalled = false;

      async function* sourceWithCleanup() {
        try {
          for (let i = 0; i < 100; i++) {
            yield i;
          }
        } finally {
          cleanupCalled = true;
        }
      }

      const stream = map(sourceWithCleanup(), (n) => n * 2);

      // Take only first 5 items
      const result = await takeN(stream, 5);

      expect(result).toEqual([0, 2, 4, 6, 8]);
      expect(cleanupCalled).toBe(true);
    });

    test("break from for-await calls cleanup", async () => {
      let cleanupCalled = false;

      async function* sourceWithCleanup() {
        try {
          for (let i = 0; i < 100; i++) {
            yield i;
          }
        } finally {
          cleanupCalled = true;
        }
      }

      const stream = sourceWithCleanup();

      let count = 0;
      for await (const _item of stream) {
        count++;
        if (count >= 10) {
          break;
        }
      }

      expect(count).toBe(10);
      expect(cleanupCalled).toBe(true);
    });

    test("exception during iteration triggers cleanup", async () => {
      let cleanupCalled = false;

      async function* sourceWithCleanup() {
        try {
          for (let i = 0; i < 100; i++) {
            yield i;
          }
        } finally {
          cleanupCalled = true;
        }
      }

      const stream = map(sourceWithCleanup(), (n) => {
        if (n === 5) {
          throw new Error("Stop here");
        }
        return n;
      });

      await expect(async () => {
        await toArray(stream);
      }).toThrow("Stop here");

      expect(cleanupCalled).toBe(true);
    });

    test("parallel map cleanup on early termination", async () => {
      let cleanupCalled = false;

      async function* sourceWithCleanup() {
        try {
          for (let i = 0; i < 100; i++) {
            yield i;
          }
        } finally {
          cleanupCalled = true;
        }
      }

      const stream = parallelMap(
        sourceWithCleanup(),
        async (n) => {
          await Bun.sleep(5);
          return n * 2;
        },
        { concurrency: 5 },
      );

      const result = await takeN(stream, 10);

      expect(result).toHaveLength(10);
      // Give cleanup a chance to run
      await Bun.sleep(20);
      expect(cleanupCalled).toBe(true);
    });
  });

  describe("resource lifecycle", () => {
    test("resources properly released in pipeline", async () => {
      const resources = new Set<number>();

      async function* acquireResources() {
        for (let i = 0; i < 10; i++) {
          resources.add(i);
          yield i;
        }
      }

      const processed = map(acquireResources(), async (n) => {
        await Bun.sleep(10);
        // Process and release
        resources.delete(n);
        return n;
      });

      await toArray(processed);

      // All resources should be released
      expect(resources.size).toBe(0);
    });

    test("cleanup happens even with filter dropping items", async () => {
      let allocatedCount = 0;
      let freedCount = 0;

      async function* allocatingSource() {
        try {
          for (let i = 0; i < 20; i++) {
            allocatedCount++;
            yield i;
          }
        } finally {
          freedCount = allocatedCount;
        }
      }

      const filtered = filter(allocatingSource(), (n) => n % 2 === 0);
      const result = await toArray(filtered);

      expect(result).toHaveLength(10); // Only evens
      expect(allocatedCount).toBe(20); // All items created
      expect(freedCount).toBe(20); // All items cleaned up
    });

    test("multiple pipeline stages share cleanup", async () => {
      let stage1Cleanup = false;
      let stage2Cleanup = false;

      async function* stage1() {
        try {
          for (let i = 0; i < 10; i++) {
            yield i;
          }
        } finally {
          stage1Cleanup = true;
        }
      }

      async function* stage2(source: AsyncGenerator<number>) {
        try {
          for await (const item of source) {
            yield item * 2;
          }
        } finally {
          stage2Cleanup = true;
        }
      }

      const stream = stage2(stage1());
      await takeN(stream, 5);

      expect(stage1Cleanup).toBe(true);
      expect(stage2Cleanup).toBe(true);
    });
  });

  describe("infinite streams", () => {
    test("take N from infinite stream", async () => {
      const stream = infiniteStream();
      const result = await takeN(stream, 10);

      expect(result).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    test("infinite stream with filter and take", async () => {
      const stream = infiniteStream();
      const evens = filter(stream, (n) => n % 2 === 0);
      const result = await takeN(evens, 5);

      expect(result).toEqual([0, 2, 4, 6, 8]);
    });

    test("infinite stream processes until termination", async () => {
      async function* infiniteNumbers() {
        let i = 0;
        while (true) {
          yield i++;
        }
      }

      const stream = take(infiniteNumbers(), 100);
      const count = await countStream(stream);

      expect(count).toBe(100);
    });
  });

  describe("memory leak prevention", () => {
    test("no accumulation with map chains", async () => {
      const size = 10000;

      async function* source() {
        for (let i = 0; i < size; i++) {
          yield { id: i, data: new Array(100).fill(i) };
        }
      }

      const pipeline = map(
        map(
          map(source(), (obj) => ({ ...obj, step1: true })),
          (obj) => ({ ...obj, step2: true }),
        ),
        (obj) => obj.id, // Extract just ID, discard large data
      );

      const count = await countStream(pipeline);

      expect(count).toBe(size);
      // If there was a memory leak, this test would likely fail or be very slow
    });

    test("no accumulation with parallel map", async () => {
      const size = 1000;

      async function* source() {
        for (let i = 0; i < size; i++) {
          yield { id: i, data: new Array(100).fill(i) };
        }
      }

      const processed = parallelMap(
        source(),
        async (obj) => {
          await Bun.sleep(1);
          return obj.id; // Discard large data
        },
        { concurrency: 10 },
      );

      const count = await countStream(processed);

      expect(count).toBe(size);
    });

    test("batching and unbatching doesn't leak", async () => {
      const size = 10000;

      async function* source() {
        for (let i = 0; i < size; i++) {
          yield i;
        }
      }

      const batched = batch(source(), 100);

      const unbatched = (async function* () {
        for await (const b of batched) {
          for (const item of b) {
            yield item;
          }
        }
      })();

      const count = await countStream(unbatched);

      expect(count).toBe(size);
    });
  });

  describe("cleanup with errors", () => {
    test("cleanup happens even when error is thrown", async () => {
      let cleanupCalled = false;

      async function* sourceWithCleanup() {
        try {
          yield 1;
          yield 2;
          throw new Error("Source error");
        } finally {
          cleanupCalled = true;
        }
      }

      const stream = map(sourceWithCleanup(), (n) => n * 2);

      await expect(async () => {
        await toArray(stream);
      }).toThrow("Source error");

      expect(cleanupCalled).toBe(true);
    });

    test("cleanup in pipeline with error in middle", async () => {
      let sourceCleanup = false;
      let transformCleanup = false;

      async function* source() {
        try {
          for (let i = 0; i < 10; i++) {
            yield i;
          }
        } finally {
          sourceCleanup = true;
        }
      }

      async function* transform(input: AsyncGenerator<number>) {
        try {
          for await (const n of input) {
            if (n === 5) {
              throw new Error("Transform error");
            }
            yield n * 2;
          }
        } finally {
          transformCleanup = true;
        }
      }

      const stream = transform(source());

      await expect(async () => {
        await toArray(stream);
      }).toThrow("Transform error");

      expect(sourceCleanup).toBe(true);
      expect(transformCleanup).toBe(true);
    });

    test("parallel map cleanup on error", async () => {
      let sourceCleanup = false;

      async function* source() {
        try {
          for (let i = 0; i < 10; i++) {
            yield i;
          }
        } finally {
          sourceCleanup = true;
        }
      }

      const stream = parallelMap(
        source(),
        async (n) => {
          await Bun.sleep(5);
          if (n === 5) {
            throw new Error("Parallel error");
          }
          return n * 2;
        },
        { concurrency: 3 },
      );

      await expect(async () => {
        await toArray(stream);
      }).toThrow("Parallel error");

      // Give cleanup time to run
      await Bun.sleep(20);
      expect(sourceCleanup).toBe(true);
    });
  });

  describe("real-world scenarios", () => {
    test("streaming file processing with bounded memory", async () => {
      interface FileChunk {
        chunkId: number;
        data: Uint8Array;
      }

      const totalChunks = 1000;
      const chunkSize = 1024; // 1KB per chunk

      async function* fileChunks(): AsyncGenerator<FileChunk> {
        for (let i = 0; i < totalChunks; i++) {
          yield {
            chunkId: i,
            data: new Uint8Array(chunkSize),
          };
        }
      }

      // Process chunks without accumulating them all in memory
      const processed = map(fileChunks(), (chunk) => ({
        chunkId: chunk.chunkId,
        processed: true,
        size: chunk.data.length,
      }));

      let totalSize = 0;
      for await (const chunk of processed) {
        totalSize += chunk.size;
        // Process and discard - streaming fashion
      }

      expect(totalSize).toBe(totalChunks * chunkSize);
    });

    test("database streaming with cleanup", async () => {
      // Simulate database cursor
      let cursorOpen = true;

      async function* dbCursor() {
        try {
          for (let i = 0; i < 100; i++) {
            yield { id: i, value: `row-${i}` };
          }
        } finally {
          cursorOpen = false; // Close cursor
        }
      }

      const limited = take(dbCursor(), 50);
      const result = await toArray(limited);

      expect(result).toHaveLength(50);
      expect(cursorOpen).toBe(false); // Cursor should be closed
    });

    test("API pagination with resource management", async () => {
      let activeRequests = 0;
      let maxActiveRequests = 0;

      async function* paginatedAPI() {
        for (let page = 0; page < 10; page++) {
          activeRequests++;
          maxActiveRequests = Math.max(maxActiveRequests, activeRequests);

          // Simulate API call
          await Bun.sleep(20);

          yield Array.from({ length: 10 }, (_, i) => ({
            id: page * 10 + i,
            page,
          }));

          activeRequests--;
        }
      }

      const flattened = (async function* () {
        for await (const page of paginatedAPI()) {
          for (const item of page) {
            yield item;
          }
        }
      })();

      const result = await toArray(flattened);

      expect(result).toHaveLength(100);
      expect(activeRequests).toBe(0); // All requests completed
      expect(maxActiveRequests).toBe(1); // Sequential, not parallel
    });
  });
});
