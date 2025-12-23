/**
 * Parallel Streaming Pipeline Example
 *
 * Demonstrates parallel processing in streaming pipelines:
 * - Parallel map with concurrency control
 * - Ordered vs unordered results
 * - Backpressure handling
 * - Performance comparisons
 * - When to use parallel vs sequential
 *
 * Run with: bun run src/core/pipeline/examples/streaming/02-parallel-streaming.ts
 */

import { fromArray } from "../../streaming/generators";
import { StreamingPipeline } from "../../streaming-builder";

// =============================================================================
// Example 1: Basic Parallel Map
// =============================================================================

async function basicParallelMap() {
  console.log("\n=== Example 1: Basic Parallel Map ===\n");

  const userIds = Array.from({ length: 10 }, (_, i) => `user-${i + 1}`);

  // Simulate slow API call
  async function fetchUser(id: string) {
    const delay = 100 + Math.random() * 100; // 100-200ms
    await Bun.sleep(delay);
    return { id, name: `User ${id}`, delay: Math.round(delay) };
  }

  // Sequential processing
  console.log("Sequential processing:");
  const seqPipeline = StreamingPipeline.start<string>().map("fetched", async (id) => await fetchUser(id));

  const seqStart = Date.now();
  const seqResults = await seqPipeline.executeToArray(fromArray(userIds));
  const seqDuration = Date.now() - seqStart;

  console.log(`Duration: ${seqDuration}ms`);
  console.log(`Results: ${seqResults.length} users\n`);

  // Parallel processing
  console.log("Parallel processing (concurrency: 5):");
  const parPipeline = StreamingPipeline.start<string>().map("fetched", async (id) => await fetchUser(id), {
    parallel: true,
    concurrency: 5,
  });

  const parStart = Date.now();
  const parResults = await parPipeline.executeToArray(fromArray(userIds));
  const parDuration = Date.now() - parStart;

  console.log(`Duration: ${parDuration}ms`);
  console.log(`Results: ${parResults.length} users`);
  console.log(`Speedup: ${(seqDuration / parDuration).toFixed(2)}x faster\n`);
}

// =============================================================================
// Example 2: Ordered vs Unordered Results
// =============================================================================

async function orderedVsUnordered() {
  console.log("\n=== Example 2: Ordered vs Unordered Results ===\n");

  const items = Array.from({ length: 10 }, (_, i) => i + 1);

  // Simulate variable processing time
  async function process(n: number) {
    const delay = n % 2 === 0 ? 50 : 100; // Even numbers faster
    await Bun.sleep(delay);
    return { n, delay };
  }

  // Ordered results (default)
  console.log("Ordered results (order preserved):");
  const orderedPipeline = StreamingPipeline.start<number>()
    .map("processed", async (n) => await process(n), {
      parallel: true,
      concurrency: 5,
      ordered: true, // Default
    })
    .tap("logged", ({ n, delay }) => console.log(`Item ${n} (took ${delay}ms)`));

  await orderedPipeline.executeToArray(fromArray(items));

  console.log("\nUnordered results (finish as they complete):");
  const unorderedPipeline = StreamingPipeline.start<number>()
    .map("processed", async (n) => await process(n), {
      parallel: true,
      concurrency: 5,
      ordered: false,
    })
    .tap("logged", ({ n, delay }) => console.log(`Item ${n} (took ${delay}ms)`));

  await unorderedPipeline.executeToArray(fromArray(items));

  console.log("\nNote: Unordered can be faster for consumers that don't need ordering");
}

// =============================================================================
// Example 3: Concurrency Control
// =============================================================================

async function concurrencyControl() {
  console.log("\n=== Example 3: Concurrency Control ===\n");

  const items = Array.from({ length: 20 }, (_, i) => i + 1);
  let activeRequests = 0;
  let maxActiveRequests = 0;

  async function simulateRequest(n: number) {
    activeRequests++;
    maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
    console.log(`[${activeRequests} active] Processing ${n}`);
    await Bun.sleep(100);
    activeRequests--;
    return n * 2;
  }

  const pipeline = StreamingPipeline.start<number>().map("processed", async (n) => await simulateRequest(n), {
    parallel: true,
    concurrency: 3, // Limit to 3 concurrent operations
  });

  await pipeline.executeToArray(fromArray(items));

  console.log(`\nMax concurrent requests: ${maxActiveRequests}`);
  console.log("Expected: 3 (due to concurrency limit)");
}

// =============================================================================
// Example 4: Backpressure Demonstration
// =============================================================================

async function backpressureDemo() {
  console.log("\n=== Example 4: Backpressure ===\n");

  const items = Array.from({ length: 30 }, (_, i) => i + 1);

  // Fast producer, slow consumer
  let producerCount = 0;
  let consumerCount = 0;

  const pipeline = StreamingPipeline.start<number>()
    .map("produced", (n) => {
      producerCount++;
      return n * 2;
    })
    .map(
      "processed",
      async (n) => {
        await Bun.sleep(50); // Slow processing
        consumerCount++;
        return n;
      },
      {
        parallel: true,
        concurrency: 5,
      },
    );

  console.log("Processing with backpressure...\n");

  let consumed = 0;
  for await (const _item of pipeline.execute(fromArray(items))) {
    consumed++;
    if (consumed % 5 === 0) {
      console.log(`Consumed: ${consumed}, Produced: ${producerCount}, Processed: ${consumerCount}`);
    }
  }

  console.log(`\nFinal - Consumed: ${consumed}, Produced: ${producerCount}, Processed: ${consumerCount}`);
  console.log("Note: Producer pauses when consumer can't keep up (backpressure)");
}

// =============================================================================
// Example 5: Optimal Concurrency for I/O
// =============================================================================

async function optimalConcurrency() {
  console.log("\n=== Example 5: Finding Optimal Concurrency ===\n");

  const items = Array.from({ length: 50 }, (_, i) => i + 1);

  async function simulateIO(n: number) {
    await Bun.sleep(100);
    return n;
  }

  const concurrencyLevels = [1, 5, 10, 20, 50];

  console.log("Testing different concurrency levels:\n");

  for (const concurrency of concurrencyLevels) {
    const pipeline = StreamingPipeline.start<number>().map("processed", async (n) => await simulateIO(n), {
      parallel: concurrency > 1,
      concurrency,
    });

    const start = Date.now();
    await pipeline.executeToArray(fromArray(items));
    const duration = Date.now() - start;

    const throughput = ((items.length / duration) * 1000).toFixed(2);
    console.log(`Concurrency ${concurrency.toString().padStart(2)}: ${duration}ms (${throughput} items/sec)`);
  }

  console.log("\nNote: Too low = slow, too high = overhead, sweet spot in the middle");
}

// =============================================================================
// Example 6: Parallel with Error Handling
// =============================================================================

async function parallelWithErrors() {
  console.log("\n=== Example 6: Parallel with Error Handling ===\n");

  const items = Array.from({ length: 10 }, (_, i) => i + 1);

  async function unreliableProcess(n: number) {
    await Bun.sleep(50);
    if (n % 3 === 0) {
      throw new Error(`Failed to process ${n}`);
    }
    return n * 2;
  }

  const pipeline = StreamingPipeline.start<number>()
    .map(
      "processed",
      async (n) => {
        try {
          return await unreliableProcess(n);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(`Error processing ${n}: ${message}`);
          return null;
        }
      },
      {
        parallel: true,
        concurrency: 5,
      },
    )
    .filter("successful", (n): n is number => n !== null);

  const results = await pipeline.executeToArray(fromArray(items));

  console.log(`\nSuccessful results: ${results.join(", ")}`);
  console.log(`Success rate: ${results.length}/${items.length}`);
}

// =============================================================================
// Example 7: Mixed Sequential and Parallel Steps
// =============================================================================

async function mixedProcessing() {
  console.log("\n=== Example 7: Mixed Sequential and Parallel ===\n");

  const items = Array.from({ length: 10 }, (_, i) => i + 1);

  const pipeline = StreamingPipeline.start<number>()
    .tap("seq1", (n) => console.log(`Sequential step 1: ${n}`))
    .map(
      "parallel1",
      async (n) => {
        await Bun.sleep(50);
        return n * 2;
      },
      {
        parallel: true,
        concurrency: 5,
      },
    )
    .tap("seq2", (n) => console.log(`Sequential step 2: ${n}`))
    .map(
      "parallel2",
      async (n) => {
        await Bun.sleep(50);
        return n + 10;
      },
      {
        parallel: true,
        concurrency: 3,
      },
    )
    .tap("final", (n) => console.log(`Final: ${n}`));

  await pipeline.executeToArray(fromArray(items));

  console.log("\nNote: Can mix sequential and parallel steps as needed");
}

// =============================================================================
// Example 8: CPU-Bound vs I/O-Bound Concurrency
// =============================================================================

async function cpuVsIO() {
  console.log("\n=== Example 8: CPU-Bound vs I/O-Bound ===\n");

  const items = Array.from({ length: 100 }, (_, i) => i + 1);

  // CPU-bound: Low concurrency (matches CPU cores)
  console.log("CPU-bound work (low concurrency):");
  function cpuIntensive(n: number): number {
    let result = n;
    for (let i = 0; i < 100000; i++) {
      result = (result * 1.1) % 1000;
    }
    return Math.floor(result);
  }

  const cpuPipeline = StreamingPipeline.start<number>().map("computed", (n) => cpuIntensive(n), {
    parallel: true,
    concurrency: 4, // Match CPU cores
  });

  const cpuStart = Date.now();
  await cpuPipeline.executeToArray(fromArray(items));
  const cpuDuration = Date.now() - cpuStart;
  console.log(`Duration with concurrency=4: ${cpuDuration}ms\n`);

  // I/O-bound: High concurrency
  console.log("I/O-bound work (high concurrency):");
  async function ioIntensive(n: number): Promise<number> {
    await Bun.sleep(10);
    return n;
  }

  const ioPipeline = StreamingPipeline.start<number>().map("fetched", async (n) => await ioIntensive(n), {
    parallel: true,
    concurrency: 20, // Higher for I/O
  });

  const ioStart = Date.now();
  await ioPipeline.executeToArray(fromArray(items));
  const ioDuration = Date.now() - ioStart;
  console.log(`Duration with concurrency=20: ${ioDuration}ms\n`);

  console.log("Rule of thumb:");
  console.log("- CPU-bound: concurrency = number of CPU cores (2-8)");
  console.log("- I/O-bound: concurrency = 10-50 depending on latency");
}

// =============================================================================
// Example 9: Early Termination with Parallel Processing
// =============================================================================

async function earlyTerminationParallel() {
  console.log("\n=== Example 9: Early Termination with Parallel ===\n");

  const items = Array.from({ length: 100 }, (_, i) => i + 1);
  let processed = 0;

  const pipeline = StreamingPipeline.start<number>().map(
    "processed",
    async (n) => {
      await Bun.sleep(50);
      processed++;
      console.log(`Processed ${n} (total processed: ${processed})`);
      return n * 2;
    },
    {
      parallel: true,
      concurrency: 10,
    },
  );

  console.log("Taking only first 15 results:\n");

  let count = 0;
  for await (const _item of pipeline.execute(fromArray(items))) {
    count++;
    if (count >= 15) {
      break; // Stop consuming
    }
  }

  // Give time for in-flight requests to complete
  await Bun.sleep(200);

  console.log(`\nConsumed: ${count}`);
  console.log(`Actually processed: ${processed}`);
  console.log("Note: Some items processed beyond what was consumed (concurrency buffer)");
}

// =============================================================================
// Main: Run All Examples
// =============================================================================

async function runAllExamples() {
  console.log("=".repeat(70));
  console.log("PARALLEL STREAMING PIPELINE EXAMPLES");
  console.log("=".repeat(70));

  await basicParallelMap();
  await orderedVsUnordered();
  await concurrencyControl();
  await backpressureDemo();
  await optimalConcurrency();
  await parallelWithErrors();
  await mixedProcessing();
  await cpuVsIO();
  await earlyTerminationParallel();

  console.log(`\n${"=".repeat(70)}`);
  console.log("All parallel examples completed!");
  console.log("=".repeat(70));
}

// Run examples if executed directly
if (import.meta.main) {
  runAllExamples().catch(console.error);
}

export {
  basicParallelMap,
  orderedVsUnordered,
  concurrencyControl,
  backpressureDemo,
  optimalConcurrency,
  parallelWithErrors,
  mixedProcessing,
  cpuVsIO,
  earlyTerminationParallel,
};
