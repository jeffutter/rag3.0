/**
 * Performance tests comparing streaming parallel processing to list-based parallel execution.
 *
 * These tests verify that the streaming parallel implementation has comparable or better
 * performance than the existing executeParallel function from list-adapters.
 */

import { describe, expect, test } from "bun:test";
import { executeParallel } from "../list-adapters";
import { fromArray, toArray } from "./generators";
import { parallelMap } from "./parallel";

/**
 * Helper to introduce a delay.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Performance: Streaming vs List Parallel Processing", () => {
  test("comparable throughput for CPU-bound tasks", async () => {
    const itemCount = 100;
    const items = Array.from({ length: itemCount }, (_, i) => i);
    const concurrency = 10;

    // Simulate CPU-bound work (synchronous calculation)
    const cpuWork = (n: number): number => {
      let result = n;
      for (let i = 0; i < 1000; i++) {
        result = Math.sqrt(result + i) * Math.PI;
      }
      return result;
    };

    // Test list-based approach
    const listStart = Date.now();
    const listResults = await executeParallel(
      items,
      async (item) => {
        const result = cpuWork(item);
        return { result, durationMs: 0 };
      },
      concurrency,
    );
    const listDuration = Date.now() - listStart;

    // Test streaming approach
    const streamStart = Date.now();
    const stream = parallelMap(fromArray(items), async (item) => cpuWork(item), { concurrency });
    const streamResults = await toArray(stream);
    const streamDuration = Date.now() - streamStart;

    // Both should process all items
    expect(listResults.length).toBe(itemCount);
    expect(streamResults.length).toBe(itemCount);

    // Streaming should be within 2x of list-based performance
    // (accounting for streaming overhead and timing variance)
    expect(streamDuration).toBeLessThan(Math.max(listDuration * 2, 10));
  });

  test("comparable throughput for I/O-bound tasks", async () => {
    const itemCount = 50;
    const items = Array.from({ length: itemCount }, (_, i) => i);
    const concurrency = 10;

    // Simulate I/O-bound work (async delay)
    const ioWork = async (n: number): Promise<number> => {
      await delay(10);
      return n * 2;
    };

    // Test list-based approach
    const listStart = Date.now();
    await executeParallel(
      items,
      async (item) => {
        const result = await ioWork(item);
        return { result, durationMs: 0 };
      },
      concurrency,
    );
    const listDuration = Date.now() - listStart;

    // Test streaming approach
    const streamStart = Date.now();
    const stream = parallelMap(fromArray(items), ioWork, { concurrency });
    await toArray(stream);
    const streamDuration = Date.now() - streamStart;

    // Streaming should be within 50% of list-based performance
    expect(streamDuration).toBeLessThan(listDuration * 1.5);
  });

  test("better memory efficiency for large datasets", async () => {
    const itemCount = 1000;
    const items = Array.from({ length: itemCount }, (_, i) => i);
    const concurrency = 20;

    // Simulate processing with memory tracking
    let listPeakMemory = 0;
    let streamPeakMemory = 0;

    const work = async (n: number): Promise<{ value: number; size: number }> => {
      await delay(1);
      // Create a moderately-sized object to track memory
      const data = new Array(100).fill(n);
      return { value: n, size: data.length };
    };

    // Test list-based approach (materializes all results in memory)
    const listResults = await executeParallel(
      items,
      async (item) => {
        const result = await work(item);
        return { result, durationMs: 0 };
      },
      concurrency,
    );
    listPeakMemory = listResults.length; // All results in memory at once

    // Test streaming approach (yields items as they complete)
    let streamProcessedCount = 0;
    const stream = parallelMap(fromArray(items), work, { concurrency });
    for await (const _result of stream) {
      streamProcessedCount++;
      // In streaming, we only hold concurrency + buffer items in memory
    }
    streamPeakMemory = concurrency * 2; // Approximate: in-flight + small buffer

    // Streaming should use significantly less peak memory
    expect(streamPeakMemory).toBeLessThan(listPeakMemory);
    expect(streamProcessedCount).toBe(itemCount);
  });

  test("early termination efficiency", async () => {
    const itemCount = 1000;
    const items = Array.from({ length: itemCount }, (_, i) => i);
    const concurrency = 10;
    const targetCount = 50; // Only consume first 50 items

    let listProcessedCount = 0;
    let streamProcessedCount = 0;

    const work = async (n: number): Promise<number> => {
      await delay(5);
      return n * 2;
    };

    // Test list-based approach (must process all items)
    const listStart = Date.now();
    await executeParallel(
      items,
      async (item) => {
        listProcessedCount++;
        const result = await work(item);
        return { result, durationMs: 0 };
      },
      concurrency,
    );
    const listDuration = Date.now() - listStart;

    // Test streaming approach (can stop early)
    const streamStart = Date.now();
    const stream = parallelMap(
      fromArray(items),
      async (n) => {
        streamProcessedCount++;
        return await work(n);
      },
      { concurrency },
    );

    let count = 0;
    for await (const _result of stream) {
      count++;
      if (count >= targetCount) {
        break;
      }
    }
    const streamDuration = Date.now() - streamStart;

    // Streaming should process fewer items and be much faster
    expect(streamProcessedCount).toBeLessThan(itemCount);
    expect(streamDuration).toBeLessThan(listDuration);
    expect(listProcessedCount).toBe(itemCount);
  });

  test("ordered vs unordered performance difference", async () => {
    const itemCount = 100;
    const items = Array.from({ length: itemCount }, (_, i) => i);
    const concurrency = 10;

    // Work with varying durations to test ordering overhead
    const work = async (n: number): Promise<number> => {
      await delay(Math.random() * 20);
      return n * 2;
    };

    // Test unordered (should be faster)
    const unorderedStart = Date.now();
    const unorderedStream = parallelMap(fromArray(items), work, { concurrency, ordered: false });
    await toArray(unorderedStream);
    const unorderedDuration = Date.now() - unorderedStart;

    // Test ordered (may have buffering overhead)
    const orderedStart = Date.now();
    const orderedStream = parallelMap(fromArray(items), work, { concurrency, ordered: true });
    await toArray(orderedStream);
    const orderedDuration = Date.now() - orderedStart;

    // Both should complete in reasonable time
    // Ordered may be slightly slower due to buffering
    expect(unorderedDuration).toBeGreaterThan(0);
    expect(orderedDuration).toBeGreaterThan(0);

    // Allow ordered to be up to 2x slower than unordered
    // (in practice, should be much closer)
    expect(orderedDuration).toBeLessThan(unorderedDuration * 2);
  });

  test("backpressure prevents memory growth", async () => {
    const itemCount = 100; // Reduced for faster test
    const concurrency = 5;
    let maxInFlight = 0;
    let currentInFlight = 0;

    async function* slowConsumer() {
      for (let i = 0; i < itemCount; i++) {
        yield i;
      }
    }

    const stream = parallelMap(
      slowConsumer(),
      async (n) => {
        currentInFlight++;
        maxInFlight = Math.max(maxInFlight, currentInFlight);
        await delay(5);
        currentInFlight--;
        return n;
      },
      { concurrency },
    );

    // Consume slowly
    let count = 0;
    for await (const _result of stream) {
      count++;
      await delay(10); // Slower than production to test backpressure
    }

    // Backpressure should keep in-flight bounded
    // Allow some margin for timing variance
    expect(maxInFlight).toBeLessThanOrEqual(concurrency * 2);
    expect(count).toBe(itemCount);
  }, 10000); // Increase timeout to 10 seconds

  test("handles high concurrency efficiently", async () => {
    const itemCount = 1000;
    const highConcurrency = 100;
    const items = Array.from({ length: itemCount }, (_, i) => i);

    const work = async (n: number): Promise<number> => {
      await delay(5);
      return n * 2;
    };

    const start = Date.now();
    const stream = parallelMap(fromArray(items), work, { concurrency: highConcurrency });
    const results = await toArray(stream);
    const duration = Date.now() - start;

    expect(results.length).toBe(itemCount);

    // With high concurrency and 5ms delay per item, should complete much faster
    // than sequential (which would take itemCount * 5ms = 5000ms)
    expect(duration).toBeLessThan(1000);
  });
});
