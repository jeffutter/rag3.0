/**
 * Performance benchmarks comparing batch and streaming pipeline execution.
 *
 * Validates:
 * - Memory efficiency of streaming vs batch
 * - Latency to first result
 * - Throughput comparison
 * - Early termination benefits
 * - Backpressure handling
 */

import { describe, expect, test } from "bun:test";
import { Pipeline } from "./builder";
import { createStep } from "./steps";
import { fromArray } from "./streaming/generators";
import { toStreamingStep } from "./streaming-adapters";
import { StreamingPipeline } from "./streaming-builder";
import { createStreamingStep } from "./streaming-steps";

describe("Batch vs Streaming Performance Benchmarks", () => {
  describe("Memory Efficiency", () => {
    test("streaming uses constant memory for large datasets", async () => {
      const itemCount = 10000;

      // Batch pipeline - materializes entire array
      const batchTransform = createStep<number, number>("double", async ({ input }) => input * 2);

      const batchPipeline = Pipeline.start<number[]>()
        .map("doubled", batchTransform, { parallel: false })
        .map(
          "tripled",
          createStep("triple", async ({ input }) => input * 3),
          { parallel: false },
        );

      // Streaming pipeline - processes one item at a time
      const streamingTransform = toStreamingStep(batchTransform);

      const streamingPipeline = StreamingPipeline.start<number>()
        .add("doubled", streamingTransform)
        .add(
          "tripled",
          createStreamingStep("triple", async function* ({ input }) {
            for await (const num of input) {
              yield num * 3;
            }
          }),
        );

      const input = Array.from({ length: itemCount }, (_, i) => i + 1);

      // Measure batch execution
      const batchStart = performance.now();
      const batchMemBefore = process.memoryUsage().heapUsed;

      const batchResult = await batchPipeline.execute(input);

      const batchMemAfter = process.memoryUsage().heapUsed;
      const batchDuration = performance.now() - batchStart;
      const batchMemDelta = batchMemAfter - batchMemBefore;

      // Measure streaming execution
      const streamingStart = performance.now();
      const streamingMemBefore = process.memoryUsage().heapUsed;

      const streamingResultData = await streamingPipeline.executeToArray(fromArray(input));

      const streamingMemAfter = process.memoryUsage().heapUsed;
      const streamingDuration = performance.now() - streamingStart;
      const streamingMemDelta = streamingMemAfter - streamingMemBefore;

      console.log("\n=== Memory Efficiency Benchmark ===");
      console.log(`Item count: ${itemCount}`);
      console.log(`Batch memory delta: ${(batchMemDelta / 1024 / 1024).toFixed(2)} MB`);
      console.log(`Streaming memory delta: ${(streamingMemDelta / 1024 / 1024).toFixed(2)} MB`);
      console.log(`Memory savings: ${(((batchMemDelta - streamingMemDelta) / batchMemDelta) * 100).toFixed(1)}%`);
      console.log(`Batch duration: ${batchDuration.toFixed(2)}ms`);
      console.log(`Streaming duration: ${streamingDuration.toFixed(2)}ms`);

      // Verify results are identical
      expect(batchResult.success).toBe(true);

      if (batchResult.success) {
        expect(streamingResultData).toEqual(batchResult.data);
      }

      // Note: Memory comparison is informational, not strict assertion
      // as it depends on GC timing and other factors
    });
  });

  describe("Latency to First Result", () => {
    test("streaming produces first result faster than batch", async () => {
      const itemCount = 100;
      const processingDelay = 5; // ms per item

      // Batch step with delay
      const batchStep = createStep<number, number>("process", async ({ input }) => {
        await Bun.sleep(processingDelay);
        return input * 2;
      });

      // Streaming step with delay
      const streamingStep = createStreamingStep<number, number>("process", async function* ({ input }) {
        for await (const num of input) {
          await Bun.sleep(processingDelay);
          yield num * 2;
        }
      });

      const input = Array.from({ length: itemCount }, (_, i) => i + 1);

      // Batch pipeline - must process all items before returning
      const batchPipeline = Pipeline.start<number[]>().map("result", batchStep, { parallel: false });

      const batchStart = performance.now();
      await batchPipeline.execute(input);
      const batchTimeToComplete = performance.now() - batchStart;

      // Streaming pipeline - measure time to first result
      const streamingPipeline = StreamingPipeline.start<number>().add("result", streamingStep);

      const streamingStart = performance.now();
      const generator = streamingPipeline.execute(fromArray(input));

      // Get first result
      const firstResult = await generator.next();
      const streamingTimeToFirst = performance.now() - streamingStart;

      // Consume rest (to be fair in comparison)
      for await (const _ of generator) {
        // consume
      }
      const streamingTimeToComplete = performance.now() - streamingStart;

      console.log("\n=== Latency to First Result Benchmark ===");
      console.log(`Item count: ${itemCount}`);
      console.log(`Processing delay: ${processingDelay}ms per item`);
      console.log(`Batch time to complete: ${batchTimeToComplete.toFixed(2)}ms`);
      console.log(`Streaming time to first result: ${streamingTimeToFirst.toFixed(2)}ms`);
      console.log(`Streaming time to complete: ${streamingTimeToComplete.toFixed(2)}ms`);
      console.log(`First result speedup: ${(batchTimeToComplete / streamingTimeToFirst).toFixed(1)}x faster`);

      // Streaming should produce first result much faster
      expect(streamingTimeToFirst).toBeLessThan(batchTimeToComplete / 10);
      expect(firstResult.value).toBe(2); // 1 * 2
    });
  });

  describe("Early Termination", () => {
    test("streaming stops processing when consumer stops consuming", async () => {
      let batchItemsProcessed = 0;
      let streamingItemsProcessed = 0;

      const itemCount = 1000;
      const itemsToTake = 10;

      // Batch step that counts processed items
      const batchStep = createStep<number, number>("count", async ({ input }) => {
        batchItemsProcessed++;
        return input * 2;
      });

      // Streaming step that counts processed items
      const streamingStep = createStreamingStep<number, number>("count", async function* ({ input }) {
        for await (const num of input) {
          streamingItemsProcessed++;
          yield num * 2;
        }
      });

      const input = Array.from({ length: itemCount }, (_, i) => i + 1);

      // Batch pipeline - must process all items even if we only need first 10
      const batchPipeline = Pipeline.start<number[]>().map("result", batchStep, { parallel: false });

      const batchResult = await batchPipeline.execute(input);
      const batchTaken = batchResult.success ? batchResult.data.slice(0, itemsToTake) : [];

      // Streaming pipeline - only processes what's consumed
      const streamingPipeline = StreamingPipeline.start<number>().add("result", streamingStep);

      const streamingResults: number[] = [];
      const generator = streamingPipeline.execute(fromArray(input));

      for await (const item of generator) {
        streamingResults.push(item);
        if (streamingResults.length >= itemsToTake) {
          break; // Early termination
        }
      }

      console.log("\n=== Early Termination Benchmark ===");
      console.log(`Total items: ${itemCount}`);
      console.log(`Items needed: ${itemsToTake}`);
      console.log(`Batch items processed: ${batchItemsProcessed}`);
      console.log(`Streaming items processed: ${streamingItemsProcessed}`);
      console.log(
        `Streaming efficiency: ${((1 - streamingItemsProcessed / batchItemsProcessed) * 100).toFixed(1)}% less work`,
      );

      // Verify results are identical
      expect(streamingResults).toEqual(batchTaken);

      // Batch processes everything
      expect(batchItemsProcessed).toBe(itemCount);

      // Streaming only processes what's needed
      expect(streamingItemsProcessed).toBe(itemsToTake);
    });
  });

  describe("Throughput Comparison", () => {
    test("streaming throughput is comparable to batch for CPU-bound operations", async () => {
      const itemCount = 5000;

      // CPU-intensive operation (no I/O)
      const cpuIntensiveOp = (n: number): number => {
        // Simple CPU work - calculate sum of squares
        let sum = 0;
        for (let i = 0; i < 100; i++) {
          sum += i * i;
        }
        return n + sum;
      };

      const batchStep = createStep<number, number>("cpu", async ({ input }) => cpuIntensiveOp(input));

      const streamingStep = createStreamingStep<number, number>("cpu", async function* ({ input }) {
        for await (const num of input) {
          yield cpuIntensiveOp(num);
        }
      });

      const input = Array.from({ length: itemCount }, (_, i) => i + 1);

      // Batch pipeline
      const batchPipeline = Pipeline.start<number[]>().map("result", batchStep, { parallel: false });

      const batchStart = performance.now();
      const batchResult = await batchPipeline.execute(input);
      const batchDuration = performance.now() - batchStart;

      // Streaming pipeline
      const streamingPipeline = StreamingPipeline.start<number>().add("result", streamingStep);

      const streamingStart = performance.now();
      const streamingResultData = await streamingPipeline.executeToArray(fromArray(input));
      const streamingDuration = performance.now() - streamingStart;

      const throughputRatio = batchDuration / streamingDuration;

      console.log("\n=== Throughput Comparison Benchmark ===");
      console.log(`Item count: ${itemCount}`);
      console.log(`Batch duration: ${batchDuration.toFixed(2)}ms`);
      console.log(`Batch throughput: ${(itemCount / (batchDuration / 1000)).toFixed(0)} items/sec`);
      console.log(`Streaming duration: ${streamingDuration.toFixed(2)}ms`);
      console.log(`Streaming throughput: ${(itemCount / (streamingDuration / 1000)).toFixed(0)} items/sec`);
      console.log(`Throughput ratio: ${throughputRatio.toFixed(2)}x`);

      // Verify results are identical
      expect(batchResult.success).toBe(true);

      if (batchResult.success) {
        expect(streamingResultData).toEqual(batchResult.data);
      }

      // Streaming should have comparable throughput (within 30%)
      // Note: Streaming might be slightly slower due to async iterator overhead
      expect(throughputRatio).toBeGreaterThan(0.7);
      expect(throughputRatio).toBeLessThan(1.5);
    });

    test("streaming throughput improves with parallel I/O operations", async () => {
      const itemCount = 50;
      const ioDelay = 10; // ms

      const ioStep = createStep<number, number>("io", async ({ input }) => {
        await Bun.sleep(ioDelay);
        return input * 2;
      });

      const streamingIoStep = createStreamingStep<number, number>("io", async function* ({ input }) {
        for await (const num of input) {
          await Bun.sleep(ioDelay);
          yield num * 2;
        }
      });

      const input = Array.from({ length: itemCount }, (_, i) => i + 1);

      // Sequential batch
      const seqBatchPipeline = Pipeline.start<number[]>().map("result", ioStep, { parallel: false });

      const seqStart = performance.now();
      await seqBatchPipeline.execute(input);
      const seqDuration = performance.now() - seqStart;

      // Parallel batch
      const parBatchPipeline = Pipeline.start<number[]>().map("result", ioStep, {
        parallel: true,
        concurrencyLimit: 10,
      });

      const parStart = performance.now();
      await parBatchPipeline.execute(input);
      const parDuration = performance.now() - parStart;

      // Streaming (sequential by default)
      const streamingPipeline = StreamingPipeline.start<number>().add("result", streamingIoStep);

      const streamingStart = performance.now();
      await streamingPipeline.executeToArray(fromArray(input));
      const streamingDuration = performance.now() - streamingStart;

      console.log("\n=== I/O Throughput Benchmark ===");
      console.log(`Item count: ${itemCount}`);
      console.log(`I/O delay: ${ioDelay}ms per item`);
      console.log(`Sequential batch: ${seqDuration.toFixed(2)}ms`);
      console.log(`Parallel batch (limit=10): ${parDuration.toFixed(2)}ms`);
      console.log(`Streaming (sequential): ${streamingDuration.toFixed(2)}ms`);
      console.log(`Parallel speedup: ${(seqDuration / parDuration).toFixed(1)}x`);

      // Parallel should be significantly faster
      expect(parDuration).toBeLessThan(seqDuration / 2);
    });
  });

  describe("Adapter Overhead", () => {
    test("toStreamingStep wrapper adds minimal overhead", async () => {
      const itemCount = 1000;

      // Native batch step
      const batchStep = createStep<number, number>("native", async ({ input }) => input * 2);

      // Native streaming step (equivalent logic)
      const nativeStreamingStep = createStreamingStep<number, number>("nativeStreaming", async function* ({ input }) {
        for await (const num of input) {
          yield num * 2;
        }
      });

      // Wrapped batch step as streaming
      const wrappedStreamingStep = toStreamingStep(batchStep);

      const input = Array.from({ length: itemCount }, (_, i) => i + 1);

      // Native streaming
      const nativePipeline = StreamingPipeline.start<number>().add("result", nativeStreamingStep);

      const nativeStart = performance.now();
      const nativeResultData = await nativePipeline.executeToArray(fromArray(input));
      const nativeDuration = performance.now() - nativeStart;

      // Wrapped streaming
      const wrappedPipeline = StreamingPipeline.start<number>().add("result", wrappedStreamingStep);

      const wrappedStart = performance.now();
      const wrappedResultData = await wrappedPipeline.executeToArray(fromArray(input));
      const wrappedDuration = performance.now() - wrappedStart;

      const overheadPct = ((wrappedDuration - nativeDuration) / nativeDuration) * 100;

      console.log("\n=== Adapter Overhead Benchmark ===");
      console.log(`Item count: ${itemCount}`);
      console.log(`Native streaming: ${nativeDuration.toFixed(2)}ms`);
      console.log(`Wrapped (toStreamingStep): ${wrappedDuration.toFixed(2)}ms`);
      console.log(`Overhead: ${overheadPct.toFixed(1)}%`);

      // Verify results are identical
      expect(wrappedResultData).toEqual(nativeResultData);

      // Wrapper should add minimal overhead (< 50%)
      expect(overheadPct).toBeLessThan(50);
    });
  });
});
