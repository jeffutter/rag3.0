/**
 * Error Handling in Streaming Pipelines Example
 *
 * Demonstrates error handling strategies:
 * - Retry logic with exponential backoff
 * - Different error strategies (fail-fast, skip-failed, wrap-errors)
 * - Error recovery patterns
 * - Metadata for failed items
 * - Resilient streaming pipelines
 *
 * Run with: bun run src/core/pipeline/examples/streaming/03-error-handling.ts
 */

import { ErrorStrategy, mapWithRetry, withErrorStrategy, withRetry } from "../../streaming/errors";
import { fromArray } from "../../streaming/generators";
import type { StreamResult } from "../../streaming/types";
import { StreamingPipeline } from "../../streaming-builder";

// =============================================================================
// Example 1: Basic Error Handling with Try-Catch
// =============================================================================

async function basicErrorHandling() {
  console.log("\n=== Example 1: Basic Error Handling ===\n");

  const items = [1, 2, 3, 4, 5];

  function mayFail(n: number): number {
    if (n === 3) {
      throw new Error(`Failed on ${n}`);
    }
    return n * 2;
  }

  // Without error handling - will crash
  console.log("Without error handling (will fail on 3):");
  const unsafePipeline = StreamingPipeline.start<number>().map("doubled", (n) => mayFail(n));

  try {
    await unsafePipeline.executeToArray(fromArray(items));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`Pipeline failed: ${message}\n`);
  }

  // With error handling - graceful degradation
  console.log("With error handling (skip failed items):");
  const safePipeline = StreamingPipeline.start<number>()
    .map("doubled", (n) => {
      try {
        return mayFail(n);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`  Error on ${n}: ${message}`);
        return null;
      }
    })
    .filter("successful", (n): n is number => n !== null);

  const results = await safePipeline.executeToArray(fromArray(items));
  console.log(`Results: ${results.join(", ")}`);
}

// =============================================================================
// Example 2: Error Strategies with withErrorStrategy
// =============================================================================

async function errorStrategies() {
  console.log("\n=== Example 2: Error Strategies ===\n");

  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  async function unreliableProcess(n: number): Promise<number> {
    await Bun.sleep(10);
    if (n % 3 === 0) {
      throw new Error(`Failed on ${n}`);
    }
    return n * 2;
  }

  // Strategy 1: FAIL_FAST - Stop on first error
  console.log("Strategy 1: FAIL_FAST");
  try {
    const failFastStream = withErrorStrategy(
      fromArray(items),
      async (n) => await unreliableProcess(n),
      ErrorStrategy.FAIL_FAST,
      "process",
    );

    for await (const item of failFastStream) {
      console.log(`  Got: ${item}`);
    }
  } catch (_error) {
    console.log(`  Stopped on error\n`);
  }

  // Strategy 2: SKIP_FAILED - Continue processing, skip errors
  console.log("Strategy 2: SKIP_FAILED");
  const skipFailedStream = withErrorStrategy(
    fromArray(items),
    async (n) => await unreliableProcess(n),
    ErrorStrategy.SKIP_FAILED,
    "process",
  );

  const skipResults: number[] = [];
  for await (const item of skipFailedStream) {
    skipResults.push(item as number);
  }
  console.log(`  Results: ${skipResults.join(", ")}`);
  console.log(`  Success rate: ${skipResults.length}/${items.length}\n`);

  // Strategy 3: WRAP_ERRORS - Get both successes and failures
  console.log("Strategy 3: WRAP_ERRORS");
  const wrapErrorsStream = withErrorStrategy(
    fromArray(items),
    async (n) => await unreliableProcess(n),
    ErrorStrategy.WRAP_ERRORS,
    "process",
  );

  let successCount = 0;
  let errorCount = 0;

  for await (const result of wrapErrorsStream) {
    const streamResult = result as StreamResult<number>;
    if (streamResult.success) {
      successCount++;
      console.log(`  Success: ${streamResult.data}`);
    } else {
      errorCount++;
      console.log(`  Error: ${streamResult.error.message}`);
    }
  }

  console.log(`  Successes: ${successCount}, Errors: ${errorCount}`);
}

// =============================================================================
// Example 3: Retry Logic with Exponential Backoff
// =============================================================================

async function retryLogic() {
  console.log("\n=== Example 3: Retry Logic ===\n");

  const items = [1, 2, 3, 4, 5];
  const attemptCounts: Record<number, number> = {};

  async function flakyOperation(n: number): Promise<number> {
    attemptCounts[n] = (attemptCounts[n] || 0) + 1;
    const attempts = attemptCounts[n];

    console.log(`  Attempt ${attempts} for item ${n}`);

    // Fail on first 2 attempts, succeed on 3rd
    if (attempts < 3) {
      throw new Error(`Temporary failure for ${n}`);
    }

    return n * 2;
  }

  const retryStream = withRetry(fromArray(items), async (n) => await flakyOperation(n), {
    maxAttempts: 3,
    backoffMs: 100, // 100ms, 200ms, 300ms
    stepName: "flakyOperation",
  });

  const results: number[] = [];
  for await (const item of retryStream) {
    results.push(item);
  }

  console.log(`\nResults: ${results.join(", ")}`);
  console.log("Attempt counts:", attemptCounts);
}

// =============================================================================
// Example 4: Selective Retry with Retryable Errors
// =============================================================================

async function selectiveRetry() {
  console.log("\n=== Example 4: Selective Retry ===\n");

  const items = [1, 2, 3, 4, 5];

  async function processWithDifferentErrors(n: number): Promise<number> {
    await Bun.sleep(10);

    if (n === 2) {
      // Retryable error
      const error = new Error("ETIMEDOUT: Connection timeout");
      throw error;
    }

    if (n === 4) {
      // Non-retryable error
      throw new Error("VALIDATION_ERROR: Invalid input");
    }

    return n * 2;
  }

  console.log("Testing with retryable error filter:\n");

  const retryStream = withRetry(fromArray(items), async (n) => await processWithDifferentErrors(n), {
    maxAttempts: 3,
    backoffMs: 50,
    retryableErrors: ["ETIMEDOUT"], // Only retry timeout errors
    stepName: "process",
  });

  try {
    for await (const item of retryStream) {
      console.log(`Success: ${item}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`\nFailed with non-retryable error: ${message}`);
  }
}

// =============================================================================
// Example 5: mapWithRetry - Combined Transform, Retry, and Error Strategy
// =============================================================================

async function mapWithRetryExample() {
  console.log("\n=== Example 5: mapWithRetry ===\n");

  const items = Array.from({ length: 10 }, (_, i) => i + 1);
  const attemptsByItem: Record<number, number> = {};

  async function unreliableTransform(n: number): Promise<number> {
    attemptsByItem[n] = (attemptsByItem[n] || 0) + 1;

    // 30% chance of failure
    if (Math.random() < 0.3) {
      throw new Error(`Temporary failure for ${n}`);
    }

    return n * 2;
  }

  const resultStream = mapWithRetry(
    fromArray(items),
    async (n) => await unreliableTransform(n),
    {
      maxAttempts: 3,
      backoffMs: 50,
      stepName: "transform",
    },
    ErrorStrategy.WRAP_ERRORS,
  );

  let successCount = 0;
  let failureCount = 0;
  let totalRetries = 0;

  for await (const result of resultStream) {
    if (result.success) {
      successCount++;
      const attempts = result.retryMetadata?.attempts || 1;
      if (attempts > 1) {
        console.log(`  Success after ${attempts} attempts: ${result.data}`);
        totalRetries += attempts - 1;
      }
    } else {
      failureCount++;
      console.log(`  Failed after ${result.retryMetadata?.attempts} attempts: ${result.error.message}`);
    }
  }

  console.log(`\nSummary:`);
  console.log(`  Successes: ${successCount}`);
  console.log(`  Failures: ${failureCount}`);
  console.log(`  Total retries: ${totalRetries}`);
}

// =============================================================================
// Example 6: Partial Results with Error Recovery
// =============================================================================

async function partialResults() {
  console.log("\n=== Example 6: Partial Results ===\n");

  const items = Array.from({ length: 20 }, (_, i) => i + 1);

  async function processItem(n: number): Promise<{ id: number; value: string }> {
    await Bun.sleep(10);

    // Fail on multiples of 7
    if (n % 7 === 0) {
      throw new Error(`Service unavailable for ${n}`);
    }

    return { id: n, value: `processed-${n}` };
  }

  const pipeline = StreamingPipeline.start<number>()
    .map("processed", async (n) => {
      try {
        return await processItem(n);
      } catch (_error) {
        // Return error marker instead of throwing
        return { id: n, value: "ERROR" };
      }
    })
    .tap("logged", (item) => {
      if (item.value === "ERROR") {
        console.log(`  Failed: item ${item.id}`);
      }
    });

  const results = await pipeline.executeToArray(fromArray(items));

  const successful = results.filter((r) => r.value !== "ERROR");
  const failed = results.filter((r) => r.value === "ERROR");

  console.log(`\nSuccessful: ${successful.length}`);
  console.log(`Failed: ${failed.length}`);
  console.log(`Failed IDs: ${failed.map((r) => r.id).join(", ")}`);
}

// =============================================================================
// Example 7: Error Aggregation
// =============================================================================

async function errorAggregation() {
  console.log("\n=== Example 7: Error Aggregation ===\n");

  const items = Array.from({ length: 50 }, (_, i) => i + 1);

  async function mayFailRandomly(n: number): Promise<number> {
    await Bun.sleep(5);
    if (Math.random() < 0.2) {
      // 20% failure rate
      throw new Error(`Random failure on ${n}`);
    }
    return n * 2;
  }

  const errorStream = withErrorStrategy(
    fromArray(items),
    async (n) => await mayFailRandomly(n),
    ErrorStrategy.WRAP_ERRORS,
    "process",
  );

  const results: number[] = [];
  const errors: Array<{ itemIndex: number; message: string }> = [];

  for await (const result of errorStream) {
    const streamResult = result as StreamResult<number>;
    if (streamResult.success) {
      results.push(streamResult.data);
    } else {
      errors.push({
        itemIndex: streamResult.error.itemIndex || -1,
        message: streamResult.error.message,
      });
    }
  }

  console.log(`Processed ${items.length} items:`);
  console.log(`  Successful: ${results.length}`);
  console.log(`  Failed: ${errors.length}`);
  console.log(`  Success rate: ${((results.length / items.length) * 100).toFixed(1)}%`);

  if (errors.length > 0) {
    console.log(`\nFirst 5 errors:`);
    errors.slice(0, 5).forEach((e) => {
      console.log(`  Item ${e.itemIndex}: ${e.message}`);
    });
  }
}

// =============================================================================
// Example 8: Circuit Breaker Pattern
// =============================================================================

async function circuitBreaker() {
  console.log("\n=== Example 8: Circuit Breaker Pattern ===\n");

  const items = Array.from({ length: 30 }, (_, i) => i + 1);

  let consecutiveFailures = 0;
  const failureThreshold = 5;
  let circuitOpen = false;

  async function processWithCircuitBreaker(n: number): Promise<number> {
    if (circuitOpen) {
      throw new Error("Circuit breaker is OPEN - failing fast");
    }

    // Simulate increasing failure rate
    if (n > 10 && Math.random() < 0.6) {
      consecutiveFailures++;
      console.log(`  Failure on ${n} (consecutive: ${consecutiveFailures})`);

      if (consecutiveFailures >= failureThreshold) {
        circuitOpen = true;
        console.log("  CIRCUIT BREAKER OPENED!");
      }

      throw new Error(`Service degraded for ${n}`);
    }

    consecutiveFailures = 0;
    return n * 2;
  }

  const pipeline = StreamingPipeline.start<number>()
    .map("processed", async (n) => {
      try {
        return await processWithCircuitBreaker(n);
      } catch (_error) {
        return null;
      }
    })
    .filter("successful", (n): n is number => n !== null);

  const results = await pipeline.executeToArray(fromArray(items));

  console.log(`\nResults: ${results.length} successful out of ${items.length}`);
  console.log(`Circuit breaker state: ${circuitOpen ? "OPEN" : "CLOSED"}`);
}

// =============================================================================
// Example 9: Graceful Degradation
// =============================================================================

async function gracefulDegradation() {
  console.log("\n=== Example 9: Graceful Degradation ===\n");

  const items = Array.from({ length: 10 }, (_, i) => i + 1);

  async function fetchWithFallback(n: number): Promise<{ id: number; source: string; value: number }> {
    // Try primary source
    try {
      await Bun.sleep(10);
      if (n % 3 === 0) {
        throw new Error("Primary source failed");
      }
      return { id: n, source: "primary", value: n * 2 };
    } catch (_error) {
      console.log(`  Primary failed for ${n}, trying fallback...`);

      // Try fallback source
      try {
        await Bun.sleep(5);
        if (n % 5 === 0) {
          throw new Error("Fallback source failed");
        }
        return { id: n, source: "fallback", value: n * 2 };
      } catch (_fallbackError) {
        console.log(`  Fallback also failed for ${n}, using cache...`);

        // Final fallback to cache/default
        return { id: n, source: "cache", value: n * 2 };
      }
    }
  }

  const pipeline = StreamingPipeline.start<number>().map("fetched", async (n) => await fetchWithFallback(n));

  const results = await pipeline.executeToArray(fromArray(items));

  const bySource = results.reduce(
    (acc, r) => {
      acc[r.source] = (acc[r.source] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  console.log("\nResults by source:");
  Object.entries(bySource).forEach(([source, count]) => {
    console.log(`  ${source}: ${count}`);
  });
}

// =============================================================================
// Main: Run All Examples
// =============================================================================

async function runAllExamples() {
  console.log("=".repeat(70));
  console.log("ERROR HANDLING IN STREAMING PIPELINES");
  console.log("=".repeat(70));

  await basicErrorHandling();
  await errorStrategies();
  await retryLogic();
  await selectiveRetry();
  await mapWithRetryExample();
  await partialResults();
  await errorAggregation();
  await circuitBreaker();
  await gracefulDegradation();

  console.log(`\n${"=".repeat(70)}`);
  console.log("All error handling examples completed!");
  console.log("=".repeat(70));
}

// Run examples if executed directly
if (import.meta.main) {
  runAllExamples().catch(console.error);
}

export {
  basicErrorHandling,
  errorStrategies,
  retryLogic,
  selectiveRetry,
  mapWithRetryExample,
  partialResults,
  errorAggregation,
  circuitBreaker,
  gracefulDegradation,
};
