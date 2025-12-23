/**
 * Integration tests for error handling in streaming pipelines.
 *
 * Tests various error scenarios, retry strategies, and error propagation
 * through complex pipelines.
 */
import { describe, expect, test } from "bun:test";
import { ErrorStrategy, mapWithRetry, withErrorStrategy, withRetry } from "../../errors";
import { fromArray, map, toArray } from "../../generators";

describe("Error Handling Integration", () => {
  describe("error strategies", () => {
    test("FAIL_FAST stops pipeline on first error", async () => {
      const input = fromArray([1, 2, 3, 4, 5]);

      const withErrors = withErrorStrategy(
        input,
        async (n) => {
          if (n === 3) {
            throw new Error("Test error at 3");
          }
          return n * 2;
        },
        ErrorStrategy.FAIL_FAST,
        "testStep",
      );

      await expect(async () => {
        await toArray(withErrors);
      }).toThrow("Test error at 3");
    });

    test("SKIP_FAILED continues after errors", async () => {
      const input = fromArray([1, 2, 3, 4, 5]);

      const withErrors = withErrorStrategy(
        input,
        async (n) => {
          if (n === 3) {
            throw new Error("Test error at 3");
          }
          return n * 2;
        },
        ErrorStrategy.SKIP_FAILED,
        "testStep",
      );

      const result = await toArray(withErrors);

      // Should have all items except 3
      expect(result).toEqual([2, 4, 8, 10]);
    });

    test("WRAP_ERRORS yields results for all items", async () => {
      const input = fromArray([1, 2, 3, 4, 5]);

      const withErrors = withErrorStrategy(
        input,
        async (n) => {
          if (n === 3) {
            throw new Error("Test error at 3");
          }
          return n * 2;
        },
        ErrorStrategy.WRAP_ERRORS,
        "testStep",
      );

      const results = await toArray(withErrors);

      expect(results).toHaveLength(5);

      // Type guard to check if result is StreamResult
      type StreamResultType = { success: boolean };
      const isStreamResult = (r: unknown): r is StreamResultType =>
        typeof r === "object" && r !== null && "success" in r;

      // Check successful items
      const successes = results.filter((r) => isStreamResult(r) && r.success);
      expect(successes).toHaveLength(4);

      // Check failed items
      const failures = results.filter((r) => isStreamResult(r) && !r.success);
      expect(failures).toHaveLength(1);
      const firstFailure = failures[0];
      if (firstFailure && isStreamResult(firstFailure) && !firstFailure.success) {
        expect((firstFailure as { error: { message: string } }).error.message).toContain("Test error at 3");
      }
    });
  });

  describe("retry logic", () => {
    test("retry succeeds after transient error", async () => {
      let attemptCount = 0;

      const input = fromArray([1, 2, 3]);

      const withRetryLogic = withRetry(
        input,
        async (n) => {
          attemptCount++;
          // Fail first attempt of item 2
          if (n === 2 && attemptCount === 2) {
            throw new Error("ETIMEDOUT"); // Use retryable error
          }
          return n * 2;
        },
        {
          maxAttempts: 3,
          backoffMs: 10,
          stepName: "retryTest",
        },
      );

      const result = await toArray(withRetryLogic);

      // Should succeed after retry
      expect(result).toEqual([2, 4, 6]);
      expect(attemptCount).toBeGreaterThan(3); // At least one retry happened
    });

    test("retry exhaustion throws error", async () => {
      const input = fromArray([1, 2, 3]);

      const withRetryLogic = withRetry(
        input,
        async (n) => {
          if (n === 2) {
            throw new Error("Persistent error");
          }
          return n * 2;
        },
        {
          maxAttempts: 3,
          backoffMs: 5,
          stepName: "exhaustTest",
        },
      );

      await expect(async () => {
        await toArray(withRetryLogic);
      }).toThrow("Persistent error");
    });

    test("mapWithRetry with WRAP_ERRORS shows retry metadata", async () => {
      let attempt = 0;

      const input = fromArray([1, 2, 3]);

      const results = mapWithRetry(
        input,
        async (n) => {
          attempt++;
          // Fail first two attempts of item 2
          if (n === 2 && attempt <= 3) {
            throw new Error("ETIMEDOUT"); // Retryable error
          }
          return n * 2;
        },
        {
          maxAttempts: 5,
          backoffMs: 5,
          stepName: "mapRetryTest",
        },
        ErrorStrategy.WRAP_ERRORS,
      );

      const collected = await toArray(results);

      expect(collected).toHaveLength(3);

      // Find item 2's result
      const item2Result = collected[1];
      expect(item2Result?.success).toBe(true);

      // Check retry metadata
      if (item2Result?.success && item2Result.retryMetadata) {
        expect(item2Result.retryMetadata.attempts).toBeGreaterThan(1);
        expect(item2Result.retryMetadata.succeeded).toBe(true);
      }
    });

    test("retry with exponential backoff timing", async () => {
      const input = fromArray([1]);
      const attemptTimes: number[] = [];

      const withRetryLogic = withRetry(
        input,
        async () => {
          attemptTimes.push(Date.now());
          throw new Error("ETIMEDOUT"); // Retryable error
        },
        {
          maxAttempts: 3,
          backoffMs: 50,
          stepName: "backoffTest",
        },
      );

      try {
        await toArray(withRetryLogic);
      } catch {
        // Expected to fail
      }

      expect(attemptTimes.length).toBe(3);

      // Check backoff delays (approximately)
      const delays = attemptTimes.slice(1).map((time, i) => {
        const prev = attemptTimes[i];
        return prev !== undefined ? time - prev : 0;
      });
      expect(delays[0]).toBeGreaterThanOrEqual(40); // ~50ms * 1
      expect(delays[1]).toBeGreaterThanOrEqual(90); // ~50ms * 2
    });
  });

  describe("error propagation through pipelines", () => {
    test("error in middle of pipeline stops processing", async () => {
      const input = fromArray([1, 2, 3, 4, 5]);

      const doubled = map(input, (n) => n * 2);

      const withError = map(doubled, (n) => {
        if (n === 6) {
          // When input is 3
          throw new Error("Pipeline error");
        }
        return n + 1;
      });

      await expect(async () => {
        await toArray(withError);
      }).toThrow("Pipeline error");
    });

    test("SKIP_FAILED in early stage affects downstream", async () => {
      const input = fromArray([1, 2, 3, 4, 5]);

      // First stage: skip item 3
      const stage1 = withErrorStrategy(
        input,
        async (n) => {
          if (n === 3) {
            throw new Error("Skip this");
          }
          return n * 2;
        },
        ErrorStrategy.SKIP_FAILED,
        "stage1",
      );

      // Second stage: process remaining items (only successful values)
      const stage2 = map(stage1, (n) => (typeof n === "number" ? n + 1 : n));

      const result = await toArray(stage2);

      // Item 3 was skipped, so we have 4 items: 2, 4, 8, 10 + 1
      expect(result).toEqual([3, 5, 9, 11]);
    });

    test("multiple error stages with different strategies", async () => {
      const input = fromArray([1, 2, 3, 4, 5, 6]);

      // Stage 1: Skip errors (skip 3)
      const stage1 = withErrorStrategy(
        input,
        async (n) => {
          if (n === 3) throw new Error("Skip");
          return n;
        },
        ErrorStrategy.SKIP_FAILED,
        "stage1",
      );

      // Stage 2: Transform (handle number or StreamResult)
      const stage2 = map(stage1, (n) => (typeof n === "number" ? n * 2 : n));

      // Stage 3: Wrap errors (fail on 8, which is original 4)
      const stage3 = withErrorStrategy(
        stage2,
        async (n) => {
          if (typeof n === "number" && n === 8) throw new Error("Wrap this");
          return typeof n === "number" ? n : 0;
        },
        ErrorStrategy.WRAP_ERRORS,
        "stage3",
      );

      const results = await toArray(stage3);

      // Should have 5 results (6 original - 1 skipped)
      expect(results.length).toBe(5);

      // Type guard for StreamResult
      const isResult = (r: unknown): r is { success: boolean } => typeof r === "object" && r !== null && "success" in r;

      // Count successes and failures
      const successes = results.filter((r) => isResult(r) && r.success);
      const failures = results.filter((r) => isResult(r) && !r.success);

      expect(successes.length).toBe(4);
      expect(failures.length).toBe(1);
    });
  });

  describe("error recovery patterns", () => {
    test("retry with fallback value", async () => {
      const input = fromArray([1, 2, 3, 4, 5]);

      const results = mapWithRetry(
        input,
        async (n) => {
          if (n === 3) {
            throw new Error("Always fails");
          }
          return n * 2;
        },
        {
          maxAttempts: 2,
          backoffMs: 5,
          stepName: "fallbackTest",
        },
        ErrorStrategy.WRAP_ERRORS,
      );

      const collected = await toArray(results);

      // Transform results, using fallback for errors
      const final = collected.map((r) => {
        if (r.success) {
          return r.data;
        }
        return -1; // Fallback value
      });

      expect(final).toEqual([2, 4, -1, 8, 10]);
    });

    test("partial batch processing with errors", async () => {
      const input = fromArray([
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
      ]);

      const processed = map(input, async (batch) => {
        // Process each item in batch, collecting successes
        const results = await Promise.allSettled(
          batch.map(async (n) => {
            if (n === 5) {
              throw new Error("Item 5 fails");
            }
            return n * 2;
          }),
        );

        return results.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<number>).value);
      });

      const result = await toArray(processed);

      expect(result).toEqual([
        [2, 4, 6], // Batch 1: all succeed
        [8, 12], // Batch 2: 5 failed, 4 and 6 succeed
        [14, 16, 18], // Batch 3: all succeed
      ]);
    });
  });

  describe("complex error scenarios", () => {
    test("cascading errors across pipeline stages", async () => {
      const input = fromArray([1, 2, 3, 4, 5]);

      let stage1Errors = 0;
      let stage2Errors = 0;

      // Stage 1: Fail on 3
      const stage1 = map(input, (n) => {
        if (n === 3) {
          stage1Errors++;
          throw new Error("Stage 1 error");
        }
        return n * 2;
      });

      // Stage 2: Would fail on 6, but won't see it
      const stage2 = map(stage1, (n) => {
        if (n === 6) {
          stage2Errors++;
          throw new Error("Stage 2 error");
        }
        return n + 1;
      });

      await expect(async () => {
        await toArray(stage2);
      }).toThrow("Stage 1 error");

      expect(stage1Errors).toBe(1);
      expect(stage2Errors).toBe(0); // Never reached
    });

    test("error during stream cleanup", async () => {
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

      // Cleanup should still be called
      expect(cleanupCalled).toBe(true);
    });

    test("error in parallel processing", async () => {
      const { parallelMap } = await import("../../parallel");
      const input = fromArray([1, 2, 3, 4, 5]);

      const processed = parallelMap(
        input,
        async (n) => {
          await Bun.sleep(5);
          if (n === 3) {
            throw new Error("Parallel error");
          }
          return n * 2;
        },
        { concurrency: 3, ordered: true },
      );

      await expect(async () => {
        await toArray(processed);
      }).toThrow("Parallel error");
    });
  });

  describe("retryable error detection", () => {
    test("network errors are retryable", async () => {
      const input = fromArray([1]);
      let attempts = 0;

      const results = mapWithRetry(
        input,
        async () => {
          attempts++;
          if (attempts < 3) {
            const err = new Error("ETIMEDOUT: connection timeout");
            throw err;
          }
          return "success";
        },
        {
          maxAttempts: 5,
          backoffMs: 5,
          stepName: "networkTest",
        },
        ErrorStrategy.WRAP_ERRORS,
      );

      const collected = await toArray(results);

      expect(collected).toHaveLength(1);
      expect(collected[0]?.success).toBe(true);
      if (collected[0]?.success && collected[0].retryMetadata) {
        expect(collected[0].retryMetadata.attempts).toBeGreaterThan(1);
      }
    });

    test("non-retryable errors fail immediately", async () => {
      const input = fromArray([1]);
      let attempts = 0;

      const results = mapWithRetry(
        input,
        async () => {
          attempts++;
          throw new Error("VALIDATION_ERROR: invalid input");
        },
        {
          maxAttempts: 5,
          backoffMs: 5,
          retryableErrors: ["ETIMEDOUT"], // Only retry timeouts
          stepName: "validationTest",
        },
        ErrorStrategy.WRAP_ERRORS,
      );

      const collected = await toArray(results);

      expect(collected).toHaveLength(1);
      expect(collected[0]?.success).toBe(false);
      // Should only attempt once (non-retryable)
      expect(attempts).toBe(1);
    });
  });

  describe("error metadata", () => {
    test("error includes step name and item index", async () => {
      const input = fromArray([1, 2, 3]);

      const results = mapWithRetry(
        input,
        async (n) => {
          if (n === 2) {
            throw new Error("Test error");
          }
          return n;
        },
        {
          maxAttempts: 1,
          backoffMs: 0,
          stepName: "metadataTest",
        },
        ErrorStrategy.WRAP_ERRORS,
      );

      const collected = await toArray(results);

      const errorResult = collected.find((r) => !r.success);
      expect(errorResult).toBeDefined();

      if (errorResult && !errorResult.success) {
        expect(errorResult.error.stepName).toBe("metadataTest");
        expect(errorResult.error.itemIndex).toBe(1); // Index of item 2
        expect(errorResult.error.message).toBe("Test error");
      }
    });

    test("retry metadata tracks all attempts", async () => {
      let callCount = 0;

      const input = fromArray([1]);

      const results = mapWithRetry(
        input,
        async () => {
          callCount++;
          if (callCount < 3) {
            throw new Error("ETIMEDOUT");
          }
          return "success";
        },
        {
          maxAttempts: 5,
          backoffMs: 5,
          stepName: "trackingTest",
        },
        ErrorStrategy.WRAP_ERRORS,
      );

      const collected = await toArray(results);

      expect(collected).toHaveLength(1);
      expect(collected[0]?.success).toBe(true);

      if (collected[0]?.success && collected[0].retryMetadata) {
        const { retryMetadata } = collected[0];
        expect(retryMetadata.attempts).toBe(3);
        expect(retryMetadata.succeeded).toBe(true);
        expect(retryMetadata.errors).toHaveLength(2); // First 2 attempts failed
        expect(retryMetadata.totalDurationMs).toBeGreaterThan(0);
      }
    });
  });
});
