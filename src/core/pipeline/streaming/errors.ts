/**
 * Error handling and retry utilities for streaming pipelines.
 *
 * This module provides:
 * - withRetry: Per-item retry logic with exponential backoff
 * - withErrorStrategy: Configurable error handling strategies
 * - mapWithRetry: Combined transformation, retry, and error handling
 *
 * Key principles:
 * - Errors occur during iteration, not upfront
 * - Retry happens inline without breaking the generator chain
 * - Consumers can stop iteration at any time without issues
 * - Retry metadata is tracked per item
 *
 * @module errors
 */

import type { StreamError, StreamResult } from "./types";

/**
 * Error handling strategy for streaming operations.
 *
 * - FAIL_FAST: Throw error immediately on first failure (default)
 * - SKIP_FAILED: Silently skip failed items, yield only successes
 * - WRAP_ERRORS: Yield StreamResult for both successes and failures
 */
export enum ErrorStrategy {
  FAIL_FAST = "FAIL_FAST",
  SKIP_FAILED = "SKIP_FAILED",
  WRAP_ERRORS = "WRAP_ERRORS",
}

/**
 * Retry configuration options.
 */
export interface RetryOptions {
  /** Maximum number of attempts (including initial attempt) */
  maxAttempts: number;
  /** Initial backoff delay in milliseconds (uses exponential backoff) */
  backoffMs: number;
  /** Optional array of error codes that should trigger retries */
  retryableErrors?: string[];
  /** Step name for error metadata */
  stepName?: string;
}

/**
 * Metadata for retry attempts on a single item.
 */
export interface RetryMetadata {
  /** Total number of attempts made (including initial attempt) */
  attempts: number;
  /** Whether the operation ultimately succeeded */
  succeeded: boolean;
  /** Total time spent on all attempts in milliseconds */
  totalDurationMs: number;
  /** Errors from all failed attempts (empty if succeeded) */
  errors: Array<{ attempt: number; error: unknown; durationMs: number }>;
}

/**
 * Extended stream result with retry metadata.
 */
export type StreamResultWithRetry<T> = StreamResult<T> & {
  retryMetadata?: RetryMetadata;
};

/**
 * Check if an error is retryable based on its properties.
 * Reuses the existing retryable error detection logic.
 *
 * @param error - The error to check
 * @returns True if the error should trigger a retry
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    // Network errors, timeouts, rate limits, etc.
    const retryableMessages = ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "fetch failed", "rate limit"];
    return retryableMessages.some((msg) => error.message.toLowerCase().includes(msg.toLowerCase()));
  }
  return false;
}

/**
 * Extract error code from an error object.
 * Prefers explicit code property, falls back to message patterns.
 *
 * @param error - The error to extract code from
 * @returns Error code string
 */
function extractErrorCode(error: unknown): string {
  if (error instanceof Error) {
    // Check for explicit code property
    if ("code" in error) {
      // biome-ignore lint/suspicious/noExplicitAny: Error.code is not typed in TypeScript
      return String((error as any).code);
    }

    // Check if error message matches common error codes
    const knownErrors = ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "RATE_LIMIT"];
    const matchedCode = knownErrors.find((code) => error.message.includes(code));
    if (matchedCode) {
      return matchedCode;
    }
  }

  return "STREAM_ERROR";
}

/**
 * Create a StreamError from an error object.
 *
 * @param error - The error to convert
 * @param stepName - Name of the step where the error occurred
 * @param itemIndex - Index of the item that caused the error
 * @param traceId - Trace ID for distributed tracing
 * @param spanId - Span ID for distributed tracing
 * @returns StreamError object
 */
function createStreamError(
  error: unknown,
  stepName: string,
  itemIndex: number,
  traceId: string,
  spanId: string,
): StreamError {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorCode = extractErrorCode(error);

  return {
    code: errorCode,
    message: errorMessage,
    stepName,
    itemIndex,
    retryable: isRetryableError(error),
    cause: error,
    traceId,
    spanId,
  };
}

/**
 * Execute a function with retry logic.
 * Internal helper that implements exponential backoff.
 *
 * @param fn - The function to execute
 * @param options - Retry configuration
 * @param itemIndex - Index of the item being processed (for metadata)
 * @param traceId - Trace ID for distributed tracing
 * @param spanId - Span ID for distributed tracing
 * @returns Object containing the result and retry metadata
 */
async function executeWithRetry<T>(
  fn: () => Promise<T>,
  options: Required<RetryOptions>,
  itemIndex: number,
  traceId: string,
  spanId: string,
): Promise<{
  result: T | null;
  error: StreamError | null;
  metadata: RetryMetadata;
}> {
  const { maxAttempts, backoffMs, retryableErrors, stepName } = options;
  const errors: Array<{ attempt: number; error: unknown; durationMs: number }> = [];
  const startTime = Date.now();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const attemptStart = Date.now();

    try {
      const result = await fn();
      const totalDuration = Date.now() - startTime;

      return {
        result,
        error: null,
        metadata: {
          attempts: attempt,
          succeeded: true,
          totalDurationMs: totalDuration,
          errors,
        },
      };
    } catch (error) {
      const attemptDuration = Date.now() - attemptStart;
      errors.push({ attempt, error, durationMs: attemptDuration });

      const streamError = createStreamError(error, stepName, itemIndex, traceId, spanId);

      // Check if we should retry
      const shouldRetry =
        streamError.retryable &&
        attempt < maxAttempts &&
        (retryableErrors.length === 0 || retryableErrors.includes(streamError.code));

      if (!shouldRetry) {
        const totalDuration = Date.now() - startTime;
        return {
          result: null,
          error: streamError,
          metadata: {
            attempts: attempt,
            succeeded: false,
            totalDurationMs: totalDuration,
            errors,
          },
        };
      }

      // Wait before retrying (exponential backoff)
      await Bun.sleep(backoffMs * attempt);
    }
  }

  // Should never reach here, but TypeScript needs it
  throw new Error("Retry logic error: exceeded maxAttempts without returning");
}

/**
 * Wrap a source stream with retry logic.
 * Each item that fails will be retried according to the retry options.
 *
 * **Behavior:**
 * - Retries individual items that fail
 * - Uses exponential backoff (backoffMs * attemptNumber)
 * - Tracks retry attempts in metadata
 * - Respects retryableErrors filter if provided
 *
 * **Error Handling:**
 * - If an item fails after all retry attempts, the error is thrown
 * - Use with withErrorStrategy to control error propagation
 *
 * **Cleanup:**
 * - Source stream is properly closed even if consumer stops early
 * - Retry state is cleaned up per-item (no memory leaks)
 *
 * @template T - The type of items in the stream
 * @param source - Source async iterable
 * @param processFn - Function to process each item (may throw)
 * @param options - Retry configuration
 * @returns Async generator yielding items with retry logic applied
 *
 * @example
 * ```typescript
 * async function* unreliableSource() {
 *   yield 1; yield 2; yield 3;
 * }
 *
 * const reliable = withRetry(
 *   unreliableSource(),
 *   async (item) => await fetchData(item), // May fail
 *   {
 *     maxAttempts: 3,
 *     backoffMs: 1000,
 *     stepName: "fetch"
 *   }
 * );
 *
 * // Items are retried up to 3 times on failure
 * for await (const item of reliable) {
 *   console.log(item); // Only successful items (or throws after max attempts)
 * }
 * ```
 */
export async function* withRetry<TIn, TOut>(
  source: AsyncIterable<TIn>,
  processFn: (item: TIn, index: number) => Promise<TOut>,
  options: RetryOptions,
): AsyncGenerator<TOut, void, undefined> {
  const fullOptions: Required<RetryOptions> = {
    maxAttempts: options.maxAttempts,
    backoffMs: options.backoffMs,
    retryableErrors: options.retryableErrors ?? [],
    stepName: options.stepName ?? "unknown",
  };

  let itemIndex = 0;
  const traceId = crypto.randomUUID();

  try {
    for await (const item of source) {
      const spanId = crypto.randomUUID();
      const { result, error } = await executeWithRetry(
        () => processFn(item, itemIndex),
        fullOptions,
        itemIndex,
        traceId,
        spanId,
      );

      if (error) {
        throw error;
      }

      if (result !== null) {
        yield result;
      }

      itemIndex++;
    }
  } finally {
    // Cleanup: ensure the source stream is properly closed
    if (typeof (source as AsyncGenerator<TIn>).return === "function") {
      await (source as AsyncGenerator<TIn>).return?.(undefined);
    }
  }
}

/**
 * Wrap a source stream with an error handling strategy.
 * Controls how errors are propagated to the consumer.
 *
 * **Strategies:**
 * - FAIL_FAST: Throw error immediately on first failure (default)
 * - SKIP_FAILED: Silently skip failed items, yield only successes
 * - WRAP_ERRORS: Yield StreamResult for both successes and failures
 *
 * **Use Cases:**
 * - FAIL_FAST: Critical operations where any failure should stop processing
 * - SKIP_FAILED: Best-effort processing where partial results are acceptable
 * - WRAP_ERRORS: When consumer needs to handle errors individually
 *
 * @template T - The type of successful items
 * @param source - Source async iterable
 * @param processFn - Function to process each item (may throw)
 * @param strategy - Error handling strategy
 * @param stepName - Name of the step (for error metadata)
 * @returns Async generator with error strategy applied
 *
 * @example
 * ```typescript
 * // FAIL_FAST: Stop on first error
 * const failFast = withErrorStrategy(
 *   source,
 *   processItem,
 *   ErrorStrategy.FAIL_FAST,
 *   "process"
 * );
 *
 * // SKIP_FAILED: Continue processing, skip errors
 * const skipFailed = withErrorStrategy(
 *   source,
 *   processItem,
 *   ErrorStrategy.SKIP_FAILED,
 *   "process"
 * );
 *
 * // WRAP_ERRORS: Get success/failure for each item
 * const wrapped = withErrorStrategy(
 *   source,
 *   processItem,
 *   ErrorStrategy.WRAP_ERRORS,
 *   "process"
 * );
 * for await (const result of wrapped) {
 *   if (result.success) {
 *     console.log("Success:", result.data);
 *   } else {
 *     console.log("Error:", result.error.message);
 *   }
 * }
 * ```
 */
export async function* withErrorStrategy<TIn, TOut>(
  source: AsyncIterable<TIn>,
  processFn: (item: TIn, index: number) => Promise<TOut>,
  strategy: ErrorStrategy,
  stepName: string,
): AsyncGenerator<TOut | StreamResult<TOut>, void, undefined> {
  let itemIndex = 0;
  const traceId = crypto.randomUUID();

  try {
    for await (const item of source) {
      const spanId = crypto.randomUUID();
      const itemStart = Date.now();

      try {
        const result = await processFn(item, itemIndex);
        const itemDuration = Date.now() - itemStart;

        if (strategy === ErrorStrategy.WRAP_ERRORS) {
          yield {
            success: true,
            data: result,
            metadata: {
              stepName,
              itemIndex,
              durationMs: itemDuration,
              traceId,
              spanId,
            },
          } as StreamResult<TOut>;
        } else {
          yield result;
        }
      } catch (error) {
        const itemDuration = Date.now() - itemStart;
        const streamError = createStreamError(error, stepName, itemIndex, traceId, spanId);

        if (strategy === ErrorStrategy.FAIL_FAST) {
          // Throw immediately
          throw streamError;
        } else if (strategy === ErrorStrategy.SKIP_FAILED) {
          // Skip this item, continue to next
          continue;
        } else {
          // WRAP_ERRORS: Yield error result
          yield {
            success: false,
            error: streamError,
            metadata: {
              stepName,
              itemIndex,
              durationMs: itemDuration,
              traceId,
              spanId,
            },
          } as StreamResult<TOut>;
        }
      }

      itemIndex++;
    }
  } finally {
    // Cleanup: ensure the source stream is properly closed
    if (typeof (source as AsyncGenerator<TIn>).return === "function") {
      await (source as AsyncGenerator<TIn>).return?.(undefined);
    }
  }
}

/**
 * Transform items in a stream with retry logic and error handling.
 * Combines map, retry, and error strategy into a single operation.
 *
 * **Features:**
 * - Transforms each item using the provided function
 * - Retries failed items with exponential backoff
 * - Handles errors according to the specified strategy
 * - Returns StreamResult for observability
 *
 * **Performance:**
 * - Each item is processed independently
 * - Retry delays only affect the failing item
 * - Other items continue processing (if using SKIP_FAILED or WRAP_ERRORS)
 *
 * @template TIn - The type of input items
 * @template TOut - The type of output items
 * @param source - Source async iterable
 * @param fn - Function to transform each item (may throw)
 * @param retryOptions - Retry configuration
 * @param errorStrategy - How to handle errors
 * @returns Async generator yielding StreamResult for each item
 *
 * @example
 * ```typescript
 * const results = mapWithRetry(
 *   sourceStream,
 *   async (item) => await processItem(item),
 *   {
 *     maxAttempts: 3,
 *     backoffMs: 1000,
 *     stepName: "process"
 *   },
 *   ErrorStrategy.WRAP_ERRORS
 * );
 *
 * for await (const result of results) {
 *   if (result.success) {
 *     console.log("Processed:", result.data);
 *     if (result.retryMetadata) {
 *       console.log(`Took ${result.retryMetadata.attempts} attempts`);
 *     }
 *   } else {
 *     console.error("Failed:", result.error.message);
 *   }
 * }
 * ```
 */
export async function* mapWithRetry<TIn, TOut>(
  source: AsyncIterable<TIn>,
  fn: (item: TIn, index: number) => Promise<TOut>,
  retryOptions: RetryOptions,
  errorStrategy: ErrorStrategy = ErrorStrategy.WRAP_ERRORS,
): AsyncGenerator<StreamResultWithRetry<TOut>, void, undefined> {
  const fullOptions: Required<RetryOptions> = {
    maxAttempts: retryOptions.maxAttempts,
    backoffMs: retryOptions.backoffMs,
    retryableErrors: retryOptions.retryableErrors ?? [],
    stepName: retryOptions.stepName ?? "unknown",
  };

  let itemIndex = 0;
  const traceId = crypto.randomUUID();

  try {
    for await (const item of source) {
      const spanId = crypto.randomUUID();
      const itemStart = Date.now();

      const { result, error, metadata } = await executeWithRetry(
        () => fn(item, itemIndex),
        fullOptions,
        itemIndex,
        traceId,
        spanId,
      );

      const itemDuration = Date.now() - itemStart;

      if (error) {
        // Item failed after all retry attempts
        if (errorStrategy === ErrorStrategy.FAIL_FAST) {
          throw error;
        } else if (errorStrategy === ErrorStrategy.SKIP_FAILED) {
          // Skip this item, continue to next
          itemIndex++;
          continue;
        } else {
          // WRAP_ERRORS: Yield error result with retry metadata
          yield {
            success: false,
            error,
            metadata: {
              stepName: fullOptions.stepName,
              itemIndex,
              durationMs: itemDuration,
              traceId,
              spanId,
            },
            retryMetadata: metadata,
          };
        }
      } else if (result !== null) {
        // Item succeeded
        yield {
          success: true,
          data: result,
          metadata: {
            stepName: fullOptions.stepName,
            itemIndex,
            durationMs: itemDuration,
            traceId,
            spanId,
          },
          retryMetadata: metadata,
        };
      }

      itemIndex++;
    }
  } finally {
    // Cleanup: ensure the source stream is properly closed
    if (typeof (source as AsyncGenerator<TIn>).return === "function") {
      await (source as AsyncGenerator<TIn>).return?.(undefined);
    }
  }
}
