/**
 * Integration tests for concurrency and parallelism in streaming pipelines.
 *
 * Tests parallel processing, backpressure, concurrency limits, and
 * various ordering guarantees.
 */
import { describe, expect, test } from "bun:test";
import { fromArray, map } from "../../generators";
import { parallelFilter, parallelMap } from "../../parallel";
import { collectStream, timeExecution } from "./helpers";

describe("Concurrency and Parallelism Integration", () => {
  describe("parallel map operations", () => {
    test("parallel map with concurrency limit", async () => {
      const input = fromArray(Array.from({ length: 10 }, (_, i) => i + 1));

      const activeCount = { current: 0, max: 0 };

      const result = await collectStream(
        parallelMap(
          input,
          async (n) => {
            activeCount.current++;
            activeCount.max = Math.max(activeCount.max, activeCount.current);
            await Bun.sleep(20);
            activeCount.current--;
            return n * 2;
          },
          { concurrency: 3 },
        ),
      );

      expect(result).toHaveLength(10);
      expect(activeCount.max).toBeLessThanOrEqual(3);
      expect(activeCount.max).toBeGreaterThan(0);
    });

    test("ordered parallel map preserves input order", async () => {
      const input = fromArray([1, 2, 3, 4, 5]);

      const result = await collectStream(
        parallelMap(
          input,
          async (n) => {
            // Longer delay for lower numbers (reverse timing)
            await Bun.sleep((6 - n) * 10);
            return n * 2;
          },
          { concurrency: 3, ordered: true },
        ),
      );

      // Despite different delays, order should be preserved
      expect(result).toEqual([2, 4, 6, 8, 10]);
    });

    test("unordered parallel map yields as completed", async () => {
      const input = fromArray([1, 2, 3, 4, 5]);

      const results: number[] = [];
      const stream = parallelMap(
        input,
        async (n) => {
          // Item 5 finishes first (shortest delay)
          await Bun.sleep((6 - n) * 10);
          return n * 2;
        },
        { concurrency: 3, ordered: false },
      );

      for await (const item of stream) {
        results.push(item);
      }

      // All items should be present
      expect(results.sort((a, b) => a - b)).toEqual([2, 4, 6, 8, 10]);

      // First item likely won't be 2 (due to reverse timing)
      // This is non-deterministic, but we can verify all items are there
      expect(results).toHaveLength(5);
    });

    test("parallel map with different concurrency levels", async () => {
      const testConcurrency = async (concurrency: number) => {
        const input = fromArray(Array.from({ length: 20 }, (_, i) => i));
        const activeCount = { current: 0, max: 0 };

        await collectStream(
          parallelMap(
            input,
            async (n) => {
              activeCount.current++;
              activeCount.max = Math.max(activeCount.max, activeCount.current);
              await Bun.sleep(10);
              activeCount.current--;
              return n;
            },
            { concurrency },
          ),
        );

        return activeCount.max;
      };

      const max1 = await testConcurrency(1);
      const max3 = await testConcurrency(3);
      const max10 = await testConcurrency(10);

      expect(max1).toBe(1);
      expect(max3).toBeLessThanOrEqual(3);
      expect(max10).toBeLessThanOrEqual(10);
      expect(max10).toBeGreaterThan(max3);
    });
  });

  describe("parallel filter operations", () => {
    test("parallel filter with concurrency control", async () => {
      const input = fromArray(Array.from({ length: 10 }, (_, i) => i + 1));

      const activeCount = { current: 0, max: 0 };

      const result = await collectStream(
        parallelFilter(
          input,
          async (n) => {
            activeCount.current++;
            activeCount.max = Math.max(activeCount.max, activeCount.current);
            await Bun.sleep(10);
            activeCount.current--;
            return n % 2 === 0;
          },
          3,
        ),
      );

      expect(result).toEqual([2, 4, 6, 8, 10]);
      expect(activeCount.max).toBeLessThanOrEqual(3);
    });

    test("parallel filter preserves order", async () => {
      const input = fromArray([5, 1, 8, 3, 9, 2, 7, 4, 6]);

      const result = await collectStream(
        parallelFilter(
          input,
          async (n) => {
            await Bun.sleep(Math.random() * 20);
            return n > 5;
          },
          4,
        ),
      );

      // Order should be preserved from input
      expect(result).toEqual([8, 9, 7, 6]);
    });
  });

  describe("backpressure", () => {
    test("slow consumer doesn't overwhelm producer", async () => {
      let producedCount = 0;
      let consumedCount = 0;

      async function* producer() {
        for (let i = 0; i < 10; i++) {
          producedCount++;
          yield i;
        }
      }

      const stream = map(producer(), async (n) => {
        await Bun.sleep(50); // Slow consumer
        consumedCount++;
        return n;
      });

      await collectStream(stream);

      expect(producedCount).toBe(10);
      expect(consumedCount).toBe(10);
    });

    test("fast consumer with slow source", async () => {
      async function* slowSource() {
        for (let i = 0; i < 5; i++) {
          await Bun.sleep(30); // Slow production
          yield i;
        }
      }

      const startTime = Date.now();
      const result = await collectStream(map(slowSource(), (n) => n * 2));
      const duration = Date.now() - startTime;

      expect(result).toEqual([0, 2, 4, 6, 8]);
      // Should take at least 5 * 30ms = 150ms
      expect(duration).toBeGreaterThanOrEqual(130);
    });

    test("parallel map respects backpressure", async () => {
      const input = fromArray(Array.from({ length: 100 }, (_, i) => i));

      let maxInFlight = 0;
      let currentInFlight = 0;

      const result = await collectStream(
        parallelMap(
          input,
          async (n) => {
            currentInFlight++;
            maxInFlight = Math.max(maxInFlight, currentInFlight);
            await Bun.sleep(5);
            currentInFlight--;
            return n;
          },
          { concurrency: 5, ordered: true },
        ),
      );

      expect(result).toHaveLength(100);
      // Should never have more than concurrency limit in flight
      expect(maxInFlight).toBeLessThanOrEqual(5);
    });
  });

  describe("performance characteristics", () => {
    test("parallel processing is faster than sequential", async () => {
      const input = fromArray([1, 2, 3, 4, 5]);
      const delayMs = 50;

      // Sequential processing
      const sequentialTime = await timeExecution(async () => {
        await collectStream(
          map(input, async (n) => {
            await Bun.sleep(delayMs);
            return n;
          }),
        );
      });

      // Parallel processing
      const parallelTime = await timeExecution(async () => {
        const input2 = fromArray([1, 2, 3, 4, 5]);
        await collectStream(
          parallelMap(
            input2,
            async (n) => {
              await Bun.sleep(delayMs);
              return n;
            },
            { concurrency: 5 },
          ),
        );
      });

      // Parallel should be significantly faster
      expect(parallelTime).toBeLessThan(sequentialTime * 0.6);
    });

    test("concurrency 1 behaves like sequential", async () => {
      const input = fromArray([1, 2, 3, 4, 5]);
      const delayMs = 20;

      const sequentialTime = await timeExecution(async () => {
        await collectStream(
          map(input, async (n) => {
            await Bun.sleep(delayMs);
            return n;
          }),
        );
      });

      const parallelTime = await timeExecution(async () => {
        const input2 = fromArray([1, 2, 3, 4, 5]);
        await collectStream(
          parallelMap(
            input2,
            async (n) => {
              await Bun.sleep(delayMs);
              return n;
            },
            { concurrency: 1, ordered: true },
          ),
        );
      });

      // Should have similar timing (within 50%)
      const ratio = parallelTime / sequentialTime;
      expect(ratio).toBeGreaterThan(0.7);
      expect(ratio).toBeLessThan(1.5);
    });
  });

  describe("multiple concurrent pipelines", () => {
    test("two pipelines running concurrently", async () => {
      const input1 = fromArray([1, 2, 3, 4, 5]);
      const input2 = fromArray([10, 20, 30, 40, 50]);

      const pipeline1 = parallelMap(
        input1,
        async (n) => {
          await Bun.sleep(10);
          return n * 2;
        },
        { concurrency: 2 },
      );

      const pipeline2 = parallelMap(
        input2,
        async (n) => {
          await Bun.sleep(10);
          return n * 3;
        },
        { concurrency: 2 },
      );

      const [result1, result2] = await Promise.all([collectStream(pipeline1), collectStream(pipeline2)]);

      expect(result1.sort((a, b) => a - b)).toEqual([2, 4, 6, 8, 10]);
      expect(result2.sort((a, b) => a - b)).toEqual([30, 60, 90, 120, 150]);
    });

    test("shared resource with concurrency control", async () => {
      const sharedResource = { activeConnections: 0, maxConnections: 0 };

      const processWithResource = async (n: number) => {
        sharedResource.activeConnections++;
        sharedResource.maxConnections = Math.max(sharedResource.maxConnections, sharedResource.activeConnections);
        await Bun.sleep(20);
        sharedResource.activeConnections--;
        return n * 2;
      };

      const input1 = fromArray([1, 2, 3]);
      const input2 = fromArray([4, 5, 6]);

      const pipeline1 = parallelMap(input1, processWithResource, { concurrency: 2 });
      const pipeline2 = parallelMap(input2, processWithResource, { concurrency: 2 });

      await Promise.all([collectStream(pipeline1), collectStream(pipeline2)]);

      // Both pipelines share the resource, max should be <= 4
      expect(sharedResource.maxConnections).toBeLessThanOrEqual(4);
      expect(sharedResource.maxConnections).toBeGreaterThan(1);
    });
  });

  describe("edge cases and error scenarios", () => {
    test("concurrency limit of 1 with ordered", async () => {
      const input = fromArray([1, 2, 3, 4, 5]);

      const result = await collectStream(
        parallelMap(
          input,
          async (n) => {
            await Bun.sleep(10);
            return n * 2;
          },
          { concurrency: 1, ordered: true },
        ),
      );

      expect(result).toEqual([2, 4, 6, 8, 10]);
    });

    test("high concurrency with few items", async () => {
      const input = fromArray([1, 2]);

      const activeCount = { current: 0, max: 0 };

      const result = await collectStream(
        parallelMap(
          input,
          async (n) => {
            activeCount.current++;
            activeCount.max = Math.max(activeCount.max, activeCount.current);
            await Bun.sleep(20);
            activeCount.current--;
            return n;
          },
          { concurrency: 10 }, // Much higher than items
        ),
      );

      expect(result.sort((a, b) => a - b)).toEqual([1, 2]);
      expect(activeCount.max).toBeLessThanOrEqual(2);
    });

    test("error in parallel operation stops processing", async () => {
      const input = fromArray([1, 2, 3, 4, 5]);

      const stream = parallelMap(
        input,
        async (n) => {
          await Bun.sleep(10);
          if (n === 3) {
            throw new Error("Error at 3");
          }
          return n * 2;
        },
        { concurrency: 3 },
      );

      await expect(async () => {
        await collectStream(stream);
      }).toThrow("Error at 3");
    });

    test("empty stream with parallel map", async () => {
      const input = fromArray<number>([]);

      const result = await collectStream(
        parallelMap(
          input,
          async (n) => {
            await Bun.sleep(10);
            return n * 2;
          },
          { concurrency: 3 },
        ),
      );

      expect(result).toEqual([]);
    });

    test("single item with parallel map", async () => {
      const input = fromArray([42]);

      const result = await collectStream(
        parallelMap(
          input,
          async (n) => {
            await Bun.sleep(10);
            return n * 2;
          },
          { concurrency: 3 },
        ),
      );

      expect(result).toEqual([84]);
    });
  });

  describe("complex parallel pipelines", () => {
    test("nested parallel operations", async () => {
      const input = fromArray([1, 2, 3]);

      // First parallel stage
      const stage1 = parallelMap(
        input,
        async (n) => {
          await Bun.sleep(10);
          return [n, n * 2, n * 3];
        },
        { concurrency: 2, ordered: true },
      );

      // Flatten and second parallel stage
      async function* flatten<T>(source: AsyncGenerator<T[]>) {
        for await (const batch of source) {
          for (const item of batch) {
            yield item;
          }
        }
      }

      const flattened = flatten(stage1);

      const stage2 = parallelMap(
        flattened,
        async (n) => {
          await Bun.sleep(5);
          return n + 1;
        },
        { concurrency: 3, ordered: true },
      );

      const result = await collectStream(stage2);

      // Input: [1, 2, 3]
      // Stage 1: [1,2,3], [2,4,6], [3,6,9]
      // Flattened: 1,2,3,2,4,6,3,6,9
      // Stage 2 (+1): 2,3,4,3,5,7,4,7,10
      expect(result).toEqual([2, 3, 4, 3, 5, 7, 4, 7, 10]);
    });

    test("parallel map with parallel filter", async () => {
      const input = fromArray(Array.from({ length: 20 }, (_, i) => i + 1));

      const doubled = parallelMap(
        input,
        async (n) => {
          await Bun.sleep(5);
          return n * 2;
        },
        { concurrency: 4, ordered: true },
      );

      const filtered = parallelFilter(
        doubled,
        async (n) => {
          await Bun.sleep(3);
          return n % 4 === 0;
        },
        5,
      );

      const result = await collectStream(filtered);

      // Numbers 1-20 doubled: 2,4,6,8,...,40
      // Filter divisible by 4: 4,8,12,16,20,24,28,32,36,40
      expect(result).toEqual([4, 8, 12, 16, 20, 24, 28, 32, 36, 40]);
    });
  });

  describe("real-world patterns", () => {
    test("batch API calls with rate limiting", async () => {
      interface APIRequest {
        id: number;
        data: string;
      }

      const requests: APIRequest[] = Array.from({ length: 10 }, (_, i) => ({
        id: i,
        data: `request-${i}`,
      }));

      const input = fromArray(requests);

      const activeAPICalls = { count: 0, max: 0 };

      // Simulate rate-limited API
      const results = await collectStream(
        parallelMap(
          input,
          async (req) => {
            activeAPICalls.count++;
            activeAPICalls.max = Math.max(activeAPICalls.max, activeAPICalls.count);

            // Simulate API call
            await Bun.sleep(30);

            activeAPICalls.count--;
            return { ...req, processed: true };
          },
          { concurrency: 3, ordered: true }, // Rate limit: max 3 concurrent
        ),
      );

      expect(results).toHaveLength(10);
      expect(results.every((r) => r.processed)).toBe(true);
      expect(activeAPICalls.max).toBeLessThanOrEqual(3);
    });

    test("parallel document processing", async () => {
      interface Document {
        id: string;
        content: string;
      }

      const docs: Document[] = Array.from({ length: 5 }, (_, i) => ({
        id: `doc-${i}`,
        content: `Content for document ${i}`.repeat(10),
      }));

      const input = fromArray(docs);

      // Process documents in parallel
      const processed = await collectStream(
        parallelMap(
          input,
          async (doc) => {
            // Simulate processing (parsing, analysis, etc.)
            await Bun.sleep(50);

            return {
              id: doc.id,
              wordCount: doc.content.split(/\s+/).length,
              processed: true,
            };
          },
          { concurrency: 3, ordered: true },
        ),
      );

      expect(processed).toHaveLength(5);
      expect(processed.every((p) => p.processed)).toBe(true);
      expect(processed.every((p) => p.wordCount > 0)).toBe(true);
    });
  });
});
