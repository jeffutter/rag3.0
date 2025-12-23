/**
 * Integration tests for metadata and observability in streaming pipelines.
 *
 * Tests trace ID propagation, retry metadata, and error tracking.
 */
import { describe, expect, test } from "bun:test";
import { ErrorStrategy, mapWithRetry } from "../../errors";
import { fromArray, toArray } from "../../generators";

describe("Metadata and Observability Integration", () => {
  describe("trace ID propagation", () => {
    test("trace ID in error metadata", async () => {
      const input = fromArray([1, 2, 3]);

      const results = await toArray(
        mapWithRetry(
          input,
          async (n) => {
            if (n === 2) {
              throw new Error("Test error");
            }
            return n * 2;
          },
          {
            maxAttempts: 1,
            backoffMs: 0,
            stepName: "errorTraceTest",
          },
          ErrorStrategy.WRAP_ERRORS,
        ),
      );

      const errorResult = results.find((r) => !r.success);
      expect(errorResult).toBeDefined();

      if (errorResult && !errorResult.success) {
        expect(errorResult.error.traceId).toBeDefined();
        expect(errorResult.error.spanId).toBeDefined();
      }
    });

    test("all items have same trace ID in pipeline", async () => {
      const input = fromArray([1, 2, 3]);

      const results = await toArray(
        mapWithRetry(
          input,
          async (n) => n * 2,
          {
            maxAttempts: 1,
            backoffMs: 0,
            stepName: "traceTest",
          },
          ErrorStrategy.WRAP_ERRORS,
        ),
      );

      const traceIds = results.filter((r) => r.success && r.metadata).map((r) => r.metadata?.traceId);

      // All should have trace IDs
      expect(traceIds.every((id) => id !== undefined)).toBe(true);

      // All should have same trace ID
      const uniqueTraceIds = new Set(traceIds);
      expect(uniqueTraceIds.size).toBe(1);
    });
  });

  describe("item-level metadata", () => {
    test("metadata includes item index", async () => {
      const input = fromArray([1, 2, 3]);

      const results = await toArray(
        mapWithRetry(
          input,
          async (n) => n * 2,
          {
            maxAttempts: 1,
            backoffMs: 0,
            stepName: "indexTest",
          },
          ErrorStrategy.WRAP_ERRORS,
        ),
      );

      results.forEach((result, index) => {
        if (result.success && result.metadata) {
          expect(result.metadata.itemIndex).toBe(index);
        }
      });
    });

    test("metadata includes step name", async () => {
      const stepName = "customStepName";
      const input = fromArray([1, 2, 3]);

      const results = await toArray(
        mapWithRetry(
          input,
          async (n) => n * 2,
          {
            maxAttempts: 1,
            backoffMs: 0,
            stepName,
          },
          ErrorStrategy.WRAP_ERRORS,
        ),
      );

      results.forEach((result) => {
        if (result.success && result.metadata) {
          expect(result.metadata.stepName).toBe(stepName);
        }
      });
    });

    test("metadata includes duration", async () => {
      const input = fromArray([1, 2, 3]);

      const results = await toArray(
        mapWithRetry(
          input,
          async (n) => {
            await Bun.sleep(10);
            return n * 2;
          },
          {
            maxAttempts: 1,
            backoffMs: 0,
            stepName: "durationTest",
          },
          ErrorStrategy.WRAP_ERRORS,
        ),
      );

      results.forEach((result) => {
        if (result.success && result.metadata) {
          expect(result.metadata.durationMs).toBeGreaterThan(0);
        }
      });
    });
  });

  describe("retry metadata", () => {
    test("retry metadata shows attempt count", async () => {
      const attemptMap = new Map<number, number>();

      const input = fromArray([1, 2, 3]);

      const results = await toArray(
        mapWithRetry(
          input,
          async (n) => {
            const attempts = attemptMap.get(n) || 0;
            attemptMap.set(n, attempts + 1);

            if (n === 2 && attempts < 2) {
              throw new Error("ETIMEDOUT"); // Retryable error
            }
            return n * 2;
          },
          {
            maxAttempts: 5,
            backoffMs: 5,
            stepName: "retryMetadataTest",
          },
          ErrorStrategy.WRAP_ERRORS,
        ),
      );

      const item2Result = results[1];
      expect(item2Result?.success).toBe(true);

      if (item2Result?.success && item2Result.retryMetadata) {
        expect(item2Result.retryMetadata.attempts).toBeGreaterThan(1);
        expect(item2Result.retryMetadata.succeeded).toBe(true);
        expect(item2Result.retryMetadata.totalDurationMs).toBeGreaterThan(0);
      }
    });

    test("failed retry metadata", async () => {
      const input = fromArray([1]);

      const results = await toArray(
        mapWithRetry(
          input,
          async () => {
            throw new Error("ETIMEDOUT"); // Retryable error that always fails
          },
          {
            maxAttempts: 3,
            backoffMs: 5,
            stepName: "failedRetryTest",
          },
          ErrorStrategy.WRAP_ERRORS,
        ),
      );

      expect(results).toHaveLength(1);
      const result = results[0];

      expect(result?.success).toBe(false);
      if (!result?.success && result?.retryMetadata) {
        expect(result.retryMetadata.attempts).toBe(3);
        expect(result.retryMetadata.succeeded).toBe(false);
        expect(result.retryMetadata.errors).toHaveLength(3);
      }
    });

    test("retry metadata includes error details", async () => {
      const input = fromArray([1]);

      const results = await toArray(
        mapWithRetry(
          input,
          async () => {
            throw new Error("ETIMEDOUT");
          },
          {
            maxAttempts: 2,
            backoffMs: 5,
            stepName: "errorDetailsTest",
          },
          ErrorStrategy.WRAP_ERRORS,
        ),
      );

      const result = results[0];
      if (!result?.success && result?.retryMetadata) {
        expect(result.retryMetadata.errors).toHaveLength(2);
        result.retryMetadata.errors.forEach((err) => {
          expect(err.attempt).toBeGreaterThan(0);
          expect(err.durationMs).toBeGreaterThanOrEqual(0); // Can be 0 for very fast failures
        });
      }
    });

    test("successful items have minimal retry metadata", async () => {
      const input = fromArray([1, 2, 3]);

      const results = await toArray(
        mapWithRetry(
          input,
          async (n) => n * 2,
          {
            maxAttempts: 3,
            backoffMs: 5,
            stepName: "noRetryTest",
          },
          ErrorStrategy.WRAP_ERRORS,
        ),
      );

      results.forEach((result) => {
        if (result.success && result.retryMetadata) {
          expect(result.retryMetadata.attempts).toBe(1);
          expect(result.retryMetadata.succeeded).toBe(true);
          expect(result.retryMetadata.errors).toHaveLength(0);
        }
      });
    });
  });

  describe("error tracking", () => {
    test("track error rates in pipeline", async () => {
      const input = fromArray(Array.from({ length: 20 }, (_, i) => i));

      const results = await toArray(
        mapWithRetry(
          input,
          async (n) => {
            // Fail every 5th item
            if (n % 5 === 0 && n > 0) {
              throw new Error("Periodic failure");
            }
            return n * 2;
          },
          {
            maxAttempts: 1,
            backoffMs: 0,
            stepName: "errorRateTest",
          },
          ErrorStrategy.WRAP_ERRORS,
        ),
      );

      const successCount = results.filter((r) => r.success).length;
      const failureCount = results.filter((r) => !r.success).length;
      const errorRate = failureCount / results.length;

      expect(results).toHaveLength(20);
      expect(successCount).toBe(17); // 20 - 3 failures (5, 10, 15)
      expect(failureCount).toBe(3);
      expect(errorRate).toBe(0.15); // 15% error rate
    });

    test("error metadata includes correct information", async () => {
      const input = fromArray([1, 2, 3]);

      const results = await toArray(
        mapWithRetry(
          input,
          async (n) => {
            if (n === 2) {
              throw new Error("Test error at 2");
            }
            return n * 2;
          },
          {
            maxAttempts: 1,
            backoffMs: 0,
            stepName: "errorInfoTest",
          },
          ErrorStrategy.WRAP_ERRORS,
        ),
      );

      const errorResult = results[1];
      expect(errorResult).toBeDefined();
      expect(errorResult?.success).toBe(false);

      if (errorResult && !errorResult.success) {
        expect(errorResult.error.message).toBe("Test error at 2");
        expect(errorResult.error.stepName).toBe("errorInfoTest");
        expect(errorResult.error.itemIndex).toBe(1);
      }
    });
  });

  describe("span and trace correlation", () => {
    test("each item has unique span ID", async () => {
      const input = fromArray([1, 2, 3, 4, 5]);

      const results = await toArray(
        mapWithRetry(
          input,
          async (n) => n * 2,
          {
            maxAttempts: 1,
            backoffMs: 0,
            stepName: "spanTest",
          },
          ErrorStrategy.WRAP_ERRORS,
        ),
      );

      const spanIds = results.filter((r) => r.success && r.metadata).map((r) => r.metadata?.spanId);

      // All should have span IDs
      expect(spanIds.every((id) => id !== undefined)).toBe(true);

      // All span IDs should be unique
      const uniqueSpanIds = new Set(spanIds);
      expect(uniqueSpanIds.size).toBe(spanIds.length);
    });

    test("trace ID same, span IDs different", async () => {
      const input = fromArray([1, 2, 3]);

      const results = await toArray(
        mapWithRetry(
          input,
          async (n) => n * 2,
          {
            maxAttempts: 1,
            backoffMs: 0,
            stepName: "correlationTest",
          },
          ErrorStrategy.WRAP_ERRORS,
        ),
      );

      const traceIds = results.filter((r) => r.success && r.metadata).map((r) => r.metadata?.traceId);

      const spanIds = results.filter((r) => r.success && r.metadata).map((r) => r.metadata?.spanId);

      // All trace IDs should be the same
      expect(new Set(traceIds).size).toBe(1);

      // All span IDs should be different
      expect(new Set(spanIds).size).toBe(spanIds.length);
    });
  });

  describe("performance observability", () => {
    test("duration tracking across pipeline", async () => {
      const input = fromArray([1, 2, 3, 4, 5]);

      const results = await toArray(
        mapWithRetry(
          input,
          async (n) => {
            // Variable processing time
            await Bun.sleep(n * 5);
            return n * 2;
          },
          {
            maxAttempts: 1,
            backoffMs: 0,
            stepName: "perfTest",
          },
          ErrorStrategy.WRAP_ERRORS,
        ),
      );

      const durations = results.filter((r) => r.success && r.metadata).map((r) => r.metadata?.durationMs || 0);

      // All durations should be positive
      expect(durations.every((d) => d > 0)).toBe(true);

      // Later items should take longer (roughly)
      const last = durations[4];
      const first = durations[0];
      if (last !== undefined && first !== undefined) {
        expect(last).toBeGreaterThan(first);
      }
    });

    test("retry increases total duration", async () => {
      const attemptMap = new Map<number, number>();

      const input = fromArray([1, 2]);

      const results = await toArray(
        mapWithRetry(
          input,
          async (n) => {
            const attempts = attemptMap.get(n) || 0;
            attemptMap.set(n, attempts + 1);

            if (n === 2 && attempts < 2) {
              await Bun.sleep(10);
              throw new Error("ETIMEDOUT"); // Retryable error
            }
            await Bun.sleep(10);
            return n * 2;
          },
          {
            maxAttempts: 5,
            backoffMs: 5,
            stepName: "retryDurationTest",
          },
          ErrorStrategy.WRAP_ERRORS,
        ),
      );

      const noRetryDuration = results[0]?.retryMetadata?.totalDurationMs || 0;
      const withRetryDuration = results[1]?.retryMetadata?.totalDurationMs || 0;

      // Item with retries should take longer
      expect(withRetryDuration).toBeGreaterThan(noRetryDuration);
    });
  });
});
