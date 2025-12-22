import { describe, expect, test } from "bun:test";
import { fromArray, toArray } from "./generators";
import { merge, parallelFilter, parallelMap } from "./parallel";

/**
 * Helper to introduce a delay.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Helper to track concurrency levels during execution.
 */
class ConcurrencyTracker {
  private current = 0;
  private max = 0;

  async track<T>(fn: () => Promise<T>): Promise<T> {
    this.current++;
    this.max = Math.max(this.max, this.current);

    try {
      return await fn();
    } finally {
      this.current--;
    }
  }

  getMaxConcurrency(): number {
    return this.max;
  }

  getCurrent(): number {
    return this.current;
  }

  reset(): void {
    this.current = 0;
    this.max = 0;
  }
}

describe("parallelMap", () => {
  describe("unordered mode", () => {
    test("transforms items concurrently", async () => {
      const input = [1, 2, 3, 4, 5];
      const stream = parallelMap(fromArray(input), async (n) => n * 2, { concurrency: 2 });

      const result = await toArray(stream);
      expect(result.sort((a, b) => a - b)).toEqual([2, 4, 6, 8, 10]);
    });

    test("respects concurrency limit", async () => {
      const tracker = new ConcurrencyTracker();
      const input = Array.from({ length: 10 }, (_, i) => i);

      const stream = parallelMap(
        fromArray(input),
        async (n) => {
          return await tracker.track(async () => {
            await delay(10);
            return n * 2;
          });
        },
        { concurrency: 3 },
      );

      await toArray(stream);
      expect(tracker.getMaxConcurrency()).toBeLessThanOrEqual(3);
    });

    test("yields items as they complete (out of order)", async () => {
      const delays = [50, 10, 30, 5, 40];
      const results: number[] = [];

      const stream = parallelMap(
        fromArray(delays),
        async (ms, index) => {
          await delay(ms);
          return index;
        },
        { concurrency: 5 },
      );

      for await (const result of stream) {
        results.push(result);
      }

      // Results should not be in input order due to different delays
      expect(results).not.toEqual([0, 1, 2, 3, 4]);
      expect(results.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
    });

    test("handles empty stream", async () => {
      const stream = parallelMap(fromArray([]), async (n: number) => n * 2, {
        concurrency: 2,
      });

      const result = await toArray(stream);
      expect(result).toEqual([]);
    });

    test("handles single item", async () => {
      const stream = parallelMap(fromArray([42]), async (n) => n * 2, {
        concurrency: 2,
      });

      const result = await toArray(stream);
      expect(result).toEqual([84]);
    });

    test("propagates errors immediately", async () => {
      const stream = parallelMap(
        fromArray([1, 2, 3, 4, 5]),
        async (n) => {
          if (n === 3) {
            throw new Error("Test error");
          }
          await delay(10);
          return n * 2;
        },
        { concurrency: 2 },
      );

      await expect(toArray(stream)).rejects.toThrow("Test error");
    });

    test("stops pulling new items after error", async () => {
      let processedCount = 0;

      const stream = parallelMap(
        fromArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
        async (n) => {
          processedCount++;
          if (n === 3) {
            throw new Error("Test error");
          }
          await delay(5);
          return n * 2;
        },
        { concurrency: 2 },
      );

      await expect(toArray(stream)).rejects.toThrow("Test error");

      // Should process fewer items than total due to early termination
      expect(processedCount).toBeLessThan(10);
    });

    test("receives correct indices", async () => {
      const indices: number[] = [];

      const stream = parallelMap(
        fromArray([10, 20, 30]),
        async (n, index) => {
          indices.push(index);
          return n;
        },
        { concurrency: 2 },
      );

      await toArray(stream);
      expect(indices.sort()).toEqual([0, 1, 2]);
    });
  });

  describe("ordered mode", () => {
    test("preserves input order", async () => {
      const delays = [50, 10, 30, 5, 40];
      const stream = parallelMap(
        fromArray(delays),
        async (ms, index) => {
          await delay(ms);
          return index;
        },
        { concurrency: 5, ordered: true },
      );

      const result = await toArray(stream);
      expect(result).toEqual([0, 1, 2, 3, 4]);
    });

    test("respects concurrency limit in ordered mode", async () => {
      const tracker = new ConcurrencyTracker();
      const input = Array.from({ length: 10 }, (_, i) => i);

      const stream = parallelMap(
        fromArray(input),
        async (n) => {
          return await tracker.track(async () => {
            await delay(10);
            return n * 2;
          });
        },
        { concurrency: 3, ordered: true },
      );

      await toArray(stream);
      expect(tracker.getMaxConcurrency()).toBeLessThanOrEqual(3);
    });

    test("buffers completed items until they can be yielded in order", async () => {
      const results: number[] = [];
      const stream = parallelMap(
        fromArray([30, 10, 5]), // First item takes longest
        async (ms, index) => {
          await delay(ms);
          return index;
        },
        { concurrency: 3, ordered: true },
      );

      for await (const result of stream) {
        results.push(result);
      }

      // Should yield in order despite completion order being 2, 1, 0
      expect(results).toEqual([0, 1, 2]);
    });

    test("handles empty stream in ordered mode", async () => {
      const stream = parallelMap(fromArray([]), async (n: number) => n * 2, {
        concurrency: 2,
        ordered: true,
      });

      const result = await toArray(stream);
      expect(result).toEqual([]);
    });

    test("propagates errors in ordered mode", async () => {
      const stream = parallelMap(
        fromArray([1, 2, 3, 4, 5]),
        async (n) => {
          if (n === 3) {
            throw new Error("Test error");
          }
          await delay(10);
          return n * 2;
        },
        { concurrency: 2, ordered: true },
      );

      await expect(toArray(stream)).rejects.toThrow("Test error");
    });
  });

  describe("backpressure", () => {
    test("never pulls more items than concurrency limit", async () => {
      let pullCount = 0;
      const maxConcurrency = 3;

      async function* trackingSource() {
        for (let i = 0; i < 20; i++) {
          pullCount++;
          yield i;
        }
      }

      const tracker = new ConcurrencyTracker();
      const stream = parallelMap(
        trackingSource(),
        async (n) => {
          return await tracker.track(async () => {
            await delay(50);
            return n;
          });
        },
        { concurrency: maxConcurrency },
      );

      // Consume only first few items
      const iterator = stream[Symbol.asyncIterator]();
      await iterator.next();
      await iterator.next();
      await iterator.next();

      // Give it time to potentially pull more
      await delay(20);

      // Should not have pulled significantly more than concurrency + consumed
      expect(pullCount).toBeLessThanOrEqual(maxConcurrency + 5);
    });

    test("slow consumer prevents unbounded memory growth", async () => {
      const tracker = new ConcurrencyTracker();

      const stream = parallelMap(
        fromArray(Array.from({ length: 100 }, (_, i) => i)),
        async (n) => {
          return await tracker.track(async () => {
            await delay(1);
            return n;
          });
        },
        { concurrency: 5 },
      );

      // Consume slowly
      const iterator = stream[Symbol.asyncIterator]();
      for (let i = 0; i < 10; i++) {
        await iterator.next();
        await delay(20); // Slow consumer
      }

      // Concurrency should remain bounded
      expect(tracker.getMaxConcurrency()).toBeLessThanOrEqual(5);
    });
  });

  describe("early termination", () => {
    test("cleans up when consumer stops early", async () => {
      const tracker = new ConcurrencyTracker();

      const stream = parallelMap(
        fromArray(Array.from({ length: 100 }, (_, i) => i)),
        async (n) => {
          return await tracker.track(async () => {
            await delay(10);
            return n;
          });
        },
        { concurrency: 5 },
      );

      // Take only first 5 items
      const iterator = stream[Symbol.asyncIterator]();
      for (let i = 0; i < 5; i++) {
        await iterator.next();
      }

      // Close the iterator
      await iterator.return?.(undefined);

      // Wait a bit to ensure cleanup
      await delay(50);

      // Should have cleaned up active operations
      expect(tracker.getCurrent()).toBe(0);
    });
  });

  describe("edge cases", () => {
    test("throws error for zero concurrency", async () => {
      const stream = parallelMap(fromArray([1, 2, 3]), async (n) => n, { concurrency: 0 });

      await expect(toArray(stream)).rejects.toThrow("Concurrency must be greater than 0");
    });

    test("throws error for negative concurrency", async () => {
      const stream = parallelMap(fromArray([1, 2, 3]), async (n) => n, { concurrency: -1 });

      await expect(toArray(stream)).rejects.toThrow("Concurrency must be greater than 0");
    });

    test("handles concurrency of 1 (sequential)", async () => {
      const tracker = new ConcurrencyTracker();
      const stream = parallelMap(
        fromArray([1, 2, 3, 4, 5]),
        async (n) => {
          return await tracker.track(async () => {
            await delay(10);
            return n * 2;
          });
        },
        { concurrency: 1 },
      );

      const result = await toArray(stream);
      expect(tracker.getMaxConcurrency()).toBe(1);
      expect(result.sort((a, b) => a - b)).toEqual([2, 4, 6, 8, 10]);
    });

    test("handles concurrency higher than item count", async () => {
      const tracker = new ConcurrencyTracker();
      const stream = parallelMap(
        fromArray([1, 2, 3]),
        async (n) => {
          return await tracker.track(async () => {
            await delay(10);
            return n * 2;
          });
        },
        { concurrency: 10 },
      );

      const result = await toArray(stream);
      expect(tracker.getMaxConcurrency()).toBeLessThanOrEqual(3);
      expect(result.sort()).toEqual([2, 4, 6]);
    });
  });
});

describe("parallelFilter", () => {
  test("filters items with async predicate", async () => {
    const stream = parallelFilter(
      fromArray([1, 2, 3, 4, 5, 6]),
      async (n) => {
        await delay(10);
        return n % 2 === 0;
      },
      3,
    );

    const result = await toArray(stream);
    expect(result).toEqual([2, 4, 6]);
  });

  test("preserves order of filtered items", async () => {
    const stream = parallelFilter(
      fromArray([1, 2, 3, 4, 5, 6, 7, 8]),
      async (n) => {
        // Varying delays to test ordering
        await delay(Math.random() * 20);
        return n > 4;
      },
      4,
    );

    const result = await toArray(stream);
    expect(result).toEqual([5, 6, 7, 8]);
  });

  test("respects concurrency limit", async () => {
    const tracker = new ConcurrencyTracker();
    const stream = parallelFilter(
      fromArray(Array.from({ length: 20 }, (_, i) => i)),
      async (n) => {
        return await tracker.track(async () => {
          await delay(10);
          return n % 2 === 0;
        });
      },
      5,
    );

    await toArray(stream);
    expect(tracker.getMaxConcurrency()).toBeLessThanOrEqual(5);
  });

  test("handles empty stream", async () => {
    const stream = parallelFilter(fromArray([]), async (_n: number) => true, 3);

    const result = await toArray(stream);
    expect(result).toEqual([]);
  });

  test("handles all items filtered out", async () => {
    const stream = parallelFilter(fromArray([1, 2, 3, 4, 5]), async (_n) => false, 3);

    const result = await toArray(stream);
    expect(result).toEqual([]);
  });

  test("handles all items passing filter", async () => {
    const stream = parallelFilter(fromArray([1, 2, 3, 4, 5]), async (_n) => true, 3);

    const result = await toArray(stream);
    expect(result).toEqual([1, 2, 3, 4, 5]);
  });

  test("receives correct indices", async () => {
    const indices: number[] = [];
    const stream = parallelFilter(
      fromArray([10, 20, 30, 40]),
      async (_n, index) => {
        indices.push(index);
        return true;
      },
      2,
    );

    await toArray(stream);
    expect(indices.sort()).toEqual([0, 1, 2, 3]);
  });

  test("propagates errors", async () => {
    const stream = parallelFilter(
      fromArray([1, 2, 3, 4, 5]),
      async (n) => {
        if (n === 3) {
          throw new Error("Test error");
        }
        return n % 2 === 0;
      },
      2,
    );

    await expect(toArray(stream)).rejects.toThrow("Test error");
  });

  test("throws error for zero concurrency", async () => {
    const stream = parallelFilter(fromArray([1, 2, 3]), async (_n) => true, 0);

    await expect(toArray(stream)).rejects.toThrow("Concurrency must be greater than 0");
  });
});

describe("merge", () => {
  test("merges multiple streams", async () => {
    async function* source1() {
      yield 1;
      yield 2;
    }

    async function* source2() {
      yield 3;
      yield 4;
    }

    async function* source3() {
      yield 5;
      yield 6;
    }

    const merged = merge(source1(), source2(), source3());
    const result = await toArray(merged);

    expect(result.sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("yields items as they become available", async () => {
    async function* slow() {
      await delay(50);
      yield 1;
      await delay(50);
      yield 2;
    }

    async function* fast() {
      yield 3;
      await delay(10);
      yield 4;
    }

    const merged = merge(slow(), fast());
    const results: number[] = [];

    for await (const item of merged) {
      results.push(item);
    }

    // Fast items should come first
    expect(results[0]).toBe(3);
    expect(results[1]).toBe(4);
    expect(results.sort()).toEqual([1, 2, 3, 4]);
  });

  test("handles empty streams", async () => {
    async function* empty() {
      // Empty
    }

    const merged = merge(empty(), empty());
    const result = await toArray(merged);
    expect(result).toEqual([]);
  });

  test("handles single stream", async () => {
    async function* source() {
      yield 1;
      yield 2;
      yield 3;
    }

    const merged = merge(source());
    const result = await toArray(merged);
    expect(result).toEqual([1, 2, 3]);
  });

  test("handles no streams", async () => {
    const merged = merge<number>();
    const result = await toArray(merged);
    expect(result).toEqual([]);
  });

  test("handles streams with different lengths", async () => {
    async function* short() {
      yield 1;
    }

    async function* long() {
      yield 2;
      yield 3;
      yield 4;
      yield 5;
    }

    const merged = merge(short(), long());
    const result = await toArray(merged);
    expect(result.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  test("propagates errors from any stream", async () => {
    async function* good() {
      yield 1;
      await delay(100);
      yield 2;
    }

    async function* bad() {
      yield 3;
      throw new Error("Test error");
    }

    const merged = merge(good(), bad());
    await expect(toArray(merged)).rejects.toThrow("Test error");
  });

  test("cleans up all streams on early termination", async () => {
    let source1Cleaned = false;
    let source2Cleaned = false;

    async function* source1() {
      try {
        for (let i = 0; i < 100; i++) {
          yield i;
          await delay(10);
        }
      } finally {
        source1Cleaned = true;
      }
    }

    async function* source2() {
      try {
        for (let i = 100; i < 200; i++) {
          yield i;
          await delay(10);
        }
      } finally {
        source2Cleaned = true;
      }
    }

    const merged = merge(source1(), source2());
    const iterator = merged[Symbol.asyncIterator]();

    // Take only a few items
    await iterator.next();
    await iterator.next();
    await iterator.next();

    // Close the iterator
    await iterator.return?.(undefined);

    // Wait a bit for cleanup
    await delay(50);

    // Both sources should be cleaned up
    expect(source1Cleaned).toBe(true);
    expect(source2Cleaned).toBe(true);
  });

  test("handles mix of sync and async yields", async () => {
    async function* syncYields() {
      yield 1;
      yield 2;
      yield 3;
    }

    async function* asyncYields() {
      await delay(5);
      yield 4;
      await delay(5);
      yield 5;
    }

    const merged = merge(syncYields(), asyncYields());
    const result = await toArray(merged);
    expect(result.sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
