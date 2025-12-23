/**
 * Tests for streaming error handling and retry logic.
 *
 * Test coverage:
 * - Retry logic with exponential backoff
 * - Error strategies (fail-fast, skip-failed, wrap-errors)
 * - mapWithRetry combining transformation + retry + error handling
 * - Retry metadata tracking
 * - Retryable vs non-retryable errors
 * - Consumer stopping iteration during retry
 * - Error propagation through pipeline
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  ErrorStrategy,
  isRetryableError,
  mapWithRetry,
  type RetryOptions,
  type StreamResultWithRetry,
  withErrorStrategy,
  withRetry,
} from "./errors";
import { fromArray, toArray } from "./generators";

// Mock Bun.sleep to speed up tests
const originalSleep = Bun.sleep;
let sleepCalls: number[] = [];

beforeEach(() => {
  sleepCalls = [];
  // Replace Bun.sleep with a mock that tracks calls but doesn't actually sleep
  Bun.sleep = mock(async (ms: number | Date) => {
    const msValue = typeof ms === "number" ? ms : ms.getTime() - Date.now();
    sleepCalls.push(msValue);
    return originalSleep(0); // Don't actually sleep in tests
  }) as typeof Bun.sleep;
});

afterEach(() => {
  // Restore original Bun.sleep
  Bun.sleep = originalSleep;
});

describe("isRetryableError", () => {
  test("identifies network errors as retryable", () => {
    expect(isRetryableError(new Error("ECONNRESET: connection reset"))).toBe(true);
    expect(isRetryableError(new Error("ETIMEDOUT: operation timed out"))).toBe(true);
    expect(isRetryableError(new Error("ECONNREFUSED: connection refused"))).toBe(true);
    expect(isRetryableError(new Error("fetch failed"))).toBe(true);
    expect(isRetryableError(new Error("rate limit exceeded"))).toBe(true);
  });

  test("identifies non-retryable errors", () => {
    expect(isRetryableError(new Error("Validation failed"))).toBe(false);
    expect(isRetryableError(new Error("Not found"))).toBe(false);
    expect(isRetryableError(new Error("Invalid input"))).toBe(false);
  });

  test("handles non-Error objects", () => {
    expect(isRetryableError("string error")).toBe(false);
    expect(isRetryableError({ message: "ETIMEDOUT" })).toBe(false);
    expect(isRetryableError(null)).toBe(false);
  });
});

describe("withRetry", () => {
  test("succeeds on first attempt", async () => {
    const source = fromArray([1, 2, 3]);
    const processFn = mock(async (item: number) => item * 2);

    const retryOptions: RetryOptions = {
      maxAttempts: 3,
      backoffMs: 100,
      stepName: "test",
    };

    const result = await toArray(withRetry(source, processFn, retryOptions));

    expect(result).toEqual([2, 4, 6]);
    expect(processFn).toHaveBeenCalledTimes(3);
    expect(sleepCalls).toEqual([]); // No retries, no sleep calls
  });

  test("retries on retryable error and succeeds", async () => {
    const source = fromArray([1, 2]);
    let attempt = 0;

    const processFn = mock(async (item: number) => {
      attempt++;
      if (attempt === 1) {
        throw new Error("ETIMEDOUT: timeout");
      }
      return item * 2;
    });

    const retryOptions: RetryOptions = {
      maxAttempts: 3,
      backoffMs: 100,
      stepName: "test",
    };

    const result = await toArray(withRetry(source, processFn, retryOptions));

    expect(result).toEqual([2, 4]);
    expect(processFn).toHaveBeenCalledTimes(3); // 2 attempts for first item, 1 for second
    expect(sleepCalls).toEqual([100]); // One retry with backoff
  });

  test("retries up to maxAttempts then throws", async () => {
    const source = fromArray([1]);
    const processFn = mock(async () => {
      throw new Error("ETIMEDOUT: timeout");
    });

    const retryOptions: RetryOptions = {
      maxAttempts: 3,
      backoffMs: 100,
      stepName: "test",
    };

    await expect(async () => {
      await toArray(withRetry(source, processFn, retryOptions));
    }).toThrow();

    expect(processFn).toHaveBeenCalledTimes(3); // Initial + 2 retries
    expect(sleepCalls).toEqual([100, 200]); // Exponential backoff: 100ms, 200ms
  });

  test("does not retry non-retryable errors", async () => {
    const source = fromArray([1]);
    const processFn = mock(async () => {
      throw new Error("Validation failed");
    });

    const retryOptions: RetryOptions = {
      maxAttempts: 3,
      backoffMs: 100,
      stepName: "test",
    };

    await expect(async () => {
      await toArray(withRetry(source, processFn, retryOptions));
    }).toThrow("Validation failed");

    expect(processFn).toHaveBeenCalledTimes(1); // No retries
    expect(sleepCalls).toEqual([]); // No backoff
  });

  test("respects retryableErrors filter", async () => {
    const source = fromArray([1]);
    const processFn = mock(async () => {
      const error = new Error("ECONNRESET: connection reset");
      // biome-ignore lint/suspicious/noExplicitAny: Setting error code for test
      (error as any).code = "ECONNRESET";
      throw error;
    });

    const retryOptions: RetryOptions = {
      maxAttempts: 3,
      backoffMs: 100,
      retryableErrors: ["ETIMEDOUT"], // Only retry timeout errors
      stepName: "test",
    };

    await expect(async () => {
      await toArray(withRetry(source, processFn, retryOptions));
    }).toThrow();

    expect(processFn).toHaveBeenCalledTimes(1); // No retries (ECONNRESET not in filter)
    expect(sleepCalls).toEqual([]);
  });

  test("handles consumer stopping early", async () => {
    const source = fromArray([1, 2, 3, 4, 5]);
    const processFn = mock(async (item: number) => item * 2);

    const retryOptions: RetryOptions = {
      maxAttempts: 3,
      backoffMs: 100,
      stepName: "test",
    };

    const stream = withRetry(source, processFn, retryOptions);

    // Consumer only takes first 2 items
    const results: number[] = [];
    for await (const item of stream) {
      results.push(item);
      if (results.length >= 2) {
        break;
      }
    }

    expect(results).toEqual([2, 4]);
    expect(processFn).toHaveBeenCalledTimes(2); // Only processed 2 items
  });

  test("handles consumer stopping during retry", async () => {
    const source = fromArray([1, 2, 3]);
    let itemCount = 0;

    const processFn = mock(async (item: number) => {
      itemCount++;
      if (itemCount === 1) {
        // First item fails with retryable error
        throw new Error("ETIMEDOUT: timeout");
      }
      return item * 2;
    });

    const retryOptions: RetryOptions = {
      maxAttempts: 3,
      backoffMs: 100,
      stepName: "test",
    };

    const stream = withRetry(source, processFn, retryOptions);

    // Consumer takes first successful item then stops
    const results: number[] = [];
    for await (const item of stream) {
      results.push(item);
      if (results.length >= 1) {
        break;
      }
    }

    expect(results).toEqual([2]); // Got the successful retry
    expect(sleepCalls.length).toBeGreaterThan(0); // Backoff happened
  });
});

describe("withErrorStrategy", () => {
  test("FAIL_FAST throws on first error", async () => {
    const source = fromArray([1, 2, 3]);
    const processFn = mock(async (item: number) => {
      if (item === 2) {
        throw new Error("Failed on 2");
      }
      return item * 2;
    });

    const stream = withErrorStrategy(source, processFn, ErrorStrategy.FAIL_FAST, "test");

    await expect(async () => {
      await toArray(stream);
    }).toThrow("Failed on 2");

    expect(processFn).toHaveBeenCalledTimes(2); // Processed 1, failed on 2, stopped
  });

  test("SKIP_FAILED skips errors and continues", async () => {
    const source = fromArray([1, 2, 3, 4]);
    const processFn = mock(async (item: number) => {
      if (item === 2 || item === 4) {
        throw new Error(`Failed on ${item}`);
      }
      return item * 2;
    });

    const stream = withErrorStrategy(source, processFn, ErrorStrategy.SKIP_FAILED, "test");
    const results = await toArray(stream);

    expect(results).toEqual([2, 6]); // Skipped items 2 and 4
    expect(processFn).toHaveBeenCalledTimes(4); // Processed all items
  });

  test("WRAP_ERRORS yields StreamResult for all items", async () => {
    const source = fromArray([1, 2, 3]);
    const processFn = mock(async (item: number) => {
      if (item === 2) {
        throw new Error("Failed on 2");
      }
      return item * 2;
    });

    const stream = withErrorStrategy(source, processFn, ErrorStrategy.WRAP_ERRORS, "test");
    const results = await toArray(stream);

    expect(results.length).toBe(3);

    // First item succeeded
    expect(results[0]).toMatchObject({
      success: true,
      data: 2,
    });

    // Second item failed
    expect(results[1]).toMatchObject({
      success: false,
      error: expect.objectContaining({
        code: "STREAM_ERROR",
        message: "Failed on 2",
        stepName: "test",
        retryable: false,
      }),
    });

    // Third item succeeded
    expect(results[2]).toMatchObject({
      success: true,
      data: 6,
    });
  });

  test("includes metadata in wrapped results", async () => {
    const source = fromArray([1]);
    const processFn = mock(async (item: number) => item * 2);

    const stream = withErrorStrategy(source, processFn, ErrorStrategy.WRAP_ERRORS, "test");
    const results = await toArray(stream);

    expect(results[0]).toMatchObject({
      success: true,
      data: 2,
      metadata: expect.objectContaining({
        stepName: "test",
        itemIndex: 0,
        durationMs: expect.any(Number),
        traceId: expect.any(String),
        spanId: expect.any(String),
      }),
    });
  });
});

describe("mapWithRetry", () => {
  test("combines transformation, retry, and error wrapping", async () => {
    const source = fromArray([1, 2, 3]);
    let attempt = 0;

    const processFn = mock(async (item: number) => {
      attempt++;
      if (attempt === 2) {
        // Fail on second item (first attempt)
        throw new Error("ETIMEDOUT: timeout");
      }
      if (attempt === 3) {
        // Succeed on second item (retry)
        return item * 2;
      }
      return item * 2;
    });

    const retryOptions: RetryOptions = {
      maxAttempts: 3,
      backoffMs: 100,
      stepName: "test",
    };

    const stream = mapWithRetry(source, processFn, retryOptions, ErrorStrategy.WRAP_ERRORS);
    const results = await toArray(stream);

    expect(results.length).toBe(3);

    // All items succeeded (second item after retry)
    expect(results[0]).toMatchObject({
      success: true,
      data: 2,
      retryMetadata: expect.objectContaining({
        attempts: 1,
        succeeded: true,
      }),
    });

    expect(results[1]).toMatchObject({
      success: true,
      data: 4,
      retryMetadata: expect.objectContaining({
        attempts: 2, // Succeeded on second attempt
        succeeded: true,
      }),
    });

    expect(results[2]).toMatchObject({
      success: true,
      data: 6,
      retryMetadata: expect.objectContaining({
        attempts: 1,
        succeeded: true,
      }),
    });

    expect(sleepCalls).toEqual([100]); // One retry
  });

  test("tracks retry metadata for failed items", async () => {
    const source = fromArray([1]);
    const processFn = mock(async () => {
      throw new Error("ETIMEDOUT: timeout");
    });

    const retryOptions: RetryOptions = {
      maxAttempts: 3,
      backoffMs: 100,
      stepName: "test",
    };

    const stream = mapWithRetry(source, processFn, retryOptions, ErrorStrategy.WRAP_ERRORS);
    const results = await toArray(stream);

    expect(results.length).toBe(1);
    expect(results[0]).toMatchObject({
      success: false,
      error: expect.any(Object),
      retryMetadata: expect.objectContaining({
        attempts: 3, // All attempts failed
        succeeded: false,
        errors: expect.arrayContaining([
          expect.objectContaining({
            attempt: 1,
            error: expect.any(Error),
            durationMs: expect.any(Number),
          }),
          expect.objectContaining({
            attempt: 2,
            error: expect.any(Error),
            durationMs: expect.any(Number),
          }),
          expect.objectContaining({
            attempt: 3,
            error: expect.any(Error),
            durationMs: expect.any(Number),
          }),
        ]),
      }),
    });

    expect(sleepCalls).toEqual([100, 200]); // Two retries with exponential backoff
  });

  test("FAIL_FAST strategy throws after max attempts", async () => {
    const source = fromArray([1, 2]);
    const processFn = mock(async (item: number) => {
      if (item === 1) {
        throw new Error("ETIMEDOUT: timeout");
      }
      return item * 2;
    });

    const retryOptions: RetryOptions = {
      maxAttempts: 3,
      backoffMs: 100,
      stepName: "test",
    };

    const stream = mapWithRetry(source, processFn, retryOptions, ErrorStrategy.FAIL_FAST);

    await expect(async () => {
      await toArray(stream);
    }).toThrow();

    expect(processFn).toHaveBeenCalledTimes(3); // Tried 3 times on first item
    expect(sleepCalls).toEqual([100, 200]); // Two retries
  });

  test("SKIP_FAILED strategy skips items after max attempts", async () => {
    const source = fromArray([1, 2, 3]);
    const processFn = mock(async (item: number) => {
      if (item === 2) {
        throw new Error("ETIMEDOUT: timeout");
      }
      return item * 2;
    });

    const retryOptions: RetryOptions = {
      maxAttempts: 3,
      backoffMs: 100,
      stepName: "test",
    };

    const stream = mapWithRetry(source, processFn, retryOptions, ErrorStrategy.SKIP_FAILED);
    const results = await toArray(stream);

    expect(results.length).toBe(2); // Item 2 was skipped

    expect(results[0]).toMatchObject({
      success: true,
      data: 2,
    });

    expect(results[1]).toMatchObject({
      success: true,
      data: 6,
    });

    expect(processFn).toHaveBeenCalledTimes(5); // 1 + 3 (retries) + 1
    expect(sleepCalls).toEqual([100, 200]); // Two retries for item 2
  });

  test("handles mixed success and failure with retry metadata", async () => {
    const source = fromArray([1, 2, 3]);
    const attemptsByItem = new Map<number, number>();

    const processFn = mock(async (item: number) => {
      const attempts = (attemptsByItem.get(item) ?? 0) + 1;
      attemptsByItem.set(item, attempts);

      // Item 1: success on first attempt
      if (item === 1) return item * 2;

      // Item 2: fail twice, succeed on third
      if (item === 2) {
        if (attempts <= 2) {
          throw new Error("ETIMEDOUT: timeout");
        }
        return item * 2;
      }

      // Item 3: success on first attempt
      return item * 2;
    });

    const retryOptions: RetryOptions = {
      maxAttempts: 3,
      backoffMs: 100,
      stepName: "test",
    };

    const stream = mapWithRetry(source, processFn, retryOptions, ErrorStrategy.WRAP_ERRORS);
    const results = (await toArray(stream)) as StreamResultWithRetry<number>[];

    expect(results.length).toBe(3);

    // Item 1: no retries
    expect(results[0]?.retryMetadata?.attempts).toBe(1);

    // Item 2: 2 retries (3 total attempts)
    expect(results[1]?.retryMetadata?.attempts).toBe(3);
    expect(results[1]?.retryMetadata?.succeeded).toBe(true);

    // Item 3: no retries
    expect(results[2]?.retryMetadata?.attempts).toBe(1);
  });

  test("properly cleans up when consumer stops early", async () => {
    const source = fromArray([1, 2, 3, 4, 5]);
    const processFn = mock(async (item: number) => item * 2);

    const retryOptions: RetryOptions = {
      maxAttempts: 3,
      backoffMs: 100,
      stepName: "test",
    };

    const stream = mapWithRetry(source, processFn, retryOptions, ErrorStrategy.WRAP_ERRORS);

    // Consumer only takes first 2 items
    const results: StreamResultWithRetry<number>[] = [];
    for await (const item of stream) {
      results.push(item);
      if (results.length >= 2) {
        break;
      }
    }

    expect(results.length).toBe(2);
    expect(processFn).toHaveBeenCalledTimes(2); // Only processed 2 items
  });

  test("handles non-retryable errors correctly", async () => {
    const source = fromArray([1, 2]);
    const processFn = mock(async (item: number) => {
      if (item === 1) {
        throw new Error("Validation failed"); // Non-retryable
      }
      return item * 2;
    });

    const retryOptions: RetryOptions = {
      maxAttempts: 3,
      backoffMs: 100,
      stepName: "test",
    };

    const stream = mapWithRetry(source, processFn, retryOptions, ErrorStrategy.WRAP_ERRORS);
    const results = await toArray(stream);

    expect(results.length).toBe(2);

    // First item failed without retries
    expect(results[0]).toMatchObject({
      success: false,
      error: expect.objectContaining({
        message: "Validation failed",
        retryable: false,
      }),
      retryMetadata: expect.objectContaining({
        attempts: 1, // No retries
        succeeded: false,
      }),
    });

    // Second item succeeded
    expect(results[1]).toMatchObject({
      success: true,
      data: 4,
    });

    expect(processFn).toHaveBeenCalledTimes(2); // No retries for non-retryable error
    expect(sleepCalls).toEqual([]); // No backoff
  });

  test("includes error history in retry metadata", async () => {
    const source = fromArray([1]);
    const processFn = mock(async () => {
      throw new Error("ETIMEDOUT: timeout");
    });

    const retryOptions: RetryOptions = {
      maxAttempts: 3,
      backoffMs: 100,
      stepName: "test",
    };

    const stream = mapWithRetry(source, processFn, retryOptions, ErrorStrategy.WRAP_ERRORS);
    const results = (await toArray(stream)) as StreamResultWithRetry<number>[];

    expect(results[0]?.retryMetadata?.errors.length).toBe(3);

    // Each error should have attempt number and duration
    results[0]?.retryMetadata?.errors.forEach((errorInfo, index) => {
      expect(errorInfo.attempt).toBe(index + 1);
      expect(errorInfo.durationMs).toBeGreaterThanOrEqual(0);
      expect(errorInfo.error).toBeInstanceOf(Error);
    });
  });
});

describe("integration: retry + error strategy in pipelines", () => {
  test("can compose multiple error handling layers", async () => {
    const source = fromArray([1, 2, 3, 4, 5]);
    const attemptsByItem = new Map<number, number>();

    // Simulate flaky processing
    const flakyProcess = async (item: number): Promise<number> => {
      const attempts = (attemptsByItem.get(item) ?? 0) + 1;
      attemptsByItem.set(item, attempts);

      // Item 2 fails twice then succeeds
      if (item === 2 && attempts <= 2) {
        throw new Error("ETIMEDOUT: timeout");
      }

      // Item 4 always fails
      if (item === 4) {
        throw new Error("Permanent failure");
      }

      return item * 2;
    };

    const retryOptions: RetryOptions = {
      maxAttempts: 3,
      backoffMs: 100,
      stepName: "flaky",
    };

    // Use mapWithRetry with SKIP_FAILED to handle both transient and permanent failures
    const stream = mapWithRetry(source, flakyProcess, retryOptions, ErrorStrategy.SKIP_FAILED);
    const results = await toArray(stream);

    // Should get items 1, 2, 3, 5 (item 4 skipped after non-retryable error)
    expect(results.length).toBe(4);
    expect(results.map((r) => (r.success ? r.data : null))).toEqual([2, 4, 6, 10]);

    // Verify retry metadata
    expect(results[0]?.retryMetadata?.attempts).toBe(1); // Item 1: no retries
    expect(results[1]?.retryMetadata?.attempts).toBe(3); // Item 2: 2 retries (3 attempts total)
    expect(results[2]?.retryMetadata?.attempts).toBe(1); // Item 3: no retries
    expect(results[3]?.retryMetadata?.attempts).toBe(1); // Item 5: no retries
  });
});
