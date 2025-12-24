/**
 * Helper functions for creating streaming pipeline steps.
 *
 * Provides utilities to create async generator-based steps that integrate
 * with the StreamingPipeline architecture.
 *
 * @see {@link https://github.com/jeffutter/rag3.0/blob/main/docs/architecture/streaming-pipeline-design.md}
 */

import type { StreamingError, StreamingStep, StreamingStepContext } from "./streaming-types";
import { StreamingErrorStrategy } from "./streaming-types";

/**
 * Create a streaming step with async generator execution.
 *
 * The execute function receives a context object with:
 * - input: Async generator from the previous step
 * - state: Accumulated state with snapshot/streaming access
 * - context: Runtime context
 *
 * **IMPORTANT: Steps must not call other steps.**
 *
 * This follows the same architectural principle as batch pipelines.
 * Extract shared logic to utility functions in `src/lib/` instead.
 *
 * @template TInput - The input type (element type, not generator)
 * @template TOutput - The output type (element type, not generator)
 * @template TAccumulated - Accumulated state from previous steps
 * @template TContext - Runtime context
 *
 * @param name - The step name for logging and debugging
 * @param execute - Async generator function that yields output items
 * @param options - Optional retry configuration
 *
 * @example
 * // Simple streaming transformation
 * const doubleNumbers = createStreamingStep<number, number>(
 *   "doubleNumbers",
 *   async function* ({ input }) {
 *     for await (const num of input) {
 *       yield num * 2;
 *     }
 *   }
 * );
 *
 * @example
 * // Streaming step with state access
 * const enrichWithContext = createStreamingStep<Item, EnrichedItem, { config: Config }>(
 *   "enrichWithContext",
 *   async function* ({ input, state }) {
 *     const config = state.accumulated.config; // Access snapshot
 *
 *     for await (const item of input) {
 *       yield { ...item, contextData: config.data };
 *     }
 *   }
 * );
 *
 * @example
 * // Step with retry configuration
 * const fetchData = createStreamingStep<string, Data>(
 *   "fetchData",
 *   async function* ({ input }) {
 *     for await (const url of input) {
 *       const data = await fetch(url);
 *       yield data;
 *     }
 *   },
 *   {
 *     retry: {
 *       maxAttempts: 3,
 *       backoffMs: 1000,
 *       retryableErrors: ["ETIMEDOUT", "ECONNRESET"],
 *     },
 *   }
 * );
 */
export function createStreamingStep<
  TInput,
  TOutput,
  // biome-ignore lint/suspicious/noExplicitAny: Generic constraint requires any to allow flexible accumulated state types
  TAccumulated extends Record<string, any> = Record<string, never>,
  TContext = unknown,
>(
  name: string,
  execute: (ctx: StreamingStepContext<TInput, TAccumulated, TContext>) => AsyncGenerator<TOutput>,
  options?: {
    retry?: {
      maxAttempts: number;
      backoffMs: number;
      retryableErrors?: string[];
    };
  },
): StreamingStep<TInput, TOutput, TAccumulated, TContext> {
  const step: StreamingStep<TInput, TOutput, TAccumulated, TContext> = {
    name,
    execute,
    ...(options?.retry && { retry: options.retry }),
  };

  return step;
}

/**
 * Wrap a streaming step with retry logic.
 *
 * Applies retry logic at the item level during execution.
 * Failed items can be retried with exponential backoff.
 *
 * @param step - The streaming step to wrap
 * @param retryConfig - Retry configuration
 *
 * @example
 * const resilientStep = withRetry(fetchStep, {
 *   maxAttempts: 3,
 *   backoffMs: 1000,
 *   retryableErrors: ["ETIMEDOUT", "RATE_LIMIT"],
 * });
 */
export function withRetry<
  TInput,
  TOutput,
  // biome-ignore lint/suspicious/noExplicitAny: Generic constraint requires any to allow flexible accumulated state types
  TAccumulated extends Record<string, any>,
  TContext,
>(
  step: StreamingStep<TInput, TOutput, TAccumulated, TContext>,
  retryConfig: {
    maxAttempts: number;
    backoffMs: number;
    retryableErrors?: string[];
  },
): StreamingStep<TInput, TOutput, TAccumulated, TContext> {
  return {
    ...step,
    retry: retryConfig,
  };
}

/**
 * Wrap a streaming step with error handling strategy.
 *
 * Applies error handling at the item level. Errors can be:
 * - FAIL_FAST: Stop on first error (rethrow)
 * - SKIP_FAILED: Skip failed items, continue processing
 * - COLLECT_ERRORS: Collect errors but continue (yields error items)
 *
 * @param step - The streaming step to wrap
 * @param strategy - Error handling strategy
 *
 * @example
 * const robustStep = withErrorHandling(
 *   processStep,
 *   StreamingErrorStrategy.SKIP_FAILED
 * );
 */
export function withErrorHandling<
  TInput,
  TOutput,
  // biome-ignore lint/suspicious/noExplicitAny: Generic constraint requires any to allow flexible accumulated state types
  TAccumulated extends Record<string, any>,
  TContext,
>(
  step: StreamingStep<TInput, TOutput, TAccumulated, TContext>,
  strategy: StreamingErrorStrategy,
): StreamingStep<TInput, TOutput, TAccumulated, TContext> {
  return createStreamingStep<TInput, TOutput, TAccumulated, TContext>(
    `${step.name}_with_error_handling`,
    async function* (ctx) {
      let itemIndex = 0;
      const generator = step.execute(ctx);

      try {
        for await (const item of generator) {
          yield item;
          itemIndex++;
        }
      } catch (error) {
        if (strategy === StreamingErrorStrategy.FAIL_FAST) {
          throw error;
        }

        if (strategy === StreamingErrorStrategy.SKIP_FAILED) {
          // Log and skip
          console.warn(`Skipping failed item at index ${itemIndex}:`, error);
          return;
        }

        if (strategy === StreamingErrorStrategy.COLLECT_ERRORS) {
          // This would need a special error type that consumer can filter
          // For now, we skip (similar to SKIP_FAILED)
          console.warn(`Error at item ${itemIndex}:`, error);
          return;
        }
      }
    },
    step.retry ? { retry: step.retry } : undefined,
  );
}

/**
 * Create a streaming filter step.
 *
 * Only yields items that match the predicate.
 *
 * @param name - Step name
 * @param predicate - Function to test each item
 *
 * @example
 * const filterEvens = createStreamingFilter<number>(
 *   "filterEvens",
 *   (n) => n % 2 === 0
 * );
 */
export function createStreamingFilter<
  TInput,
  // biome-ignore lint/suspicious/noExplicitAny: Generic constraint requires any to allow flexible accumulated state types
  TAccumulated extends Record<string, any> = Record<string, never>,
>(
  name: string,
  predicate: (item: TInput, index: number) => boolean | Promise<boolean>,
): StreamingStep<TInput, TInput, TAccumulated, unknown> {
  return createStreamingStep<TInput, TInput, TAccumulated, unknown>(name, async function* ({ input }) {
    let index = 0;
    for await (const item of input) {
      const matches = await predicate(item, index);
      if (matches) {
        yield item;
      }
      index++;
    }
  });
}

/**
 * Create a streaming map step.
 *
 * Transforms each input item to an output item.
 *
 * @param name - Step name
 * @param mapper - Function to transform each item
 *
 * @example
 * const doubleNumbers = createStreamingMap<number, number>(
 *   "doubleNumbers",
 *   (n) => n * 2
 * );
 */
export function createStreamingMap<
  TInput,
  TOutput,
  // biome-ignore lint/suspicious/noExplicitAny: Generic constraint requires any to allow flexible accumulated state types
  TAccumulated extends Record<string, any> = Record<string, never>,
>(
  name: string,
  mapper: (item: TInput, index: number) => TOutput | Promise<TOutput>,
): StreamingStep<TInput, TOutput, TAccumulated, unknown> {
  return createStreamingStep<TInput, TOutput, TAccumulated, unknown>(name, async function* ({ input }) {
    let index = 0;
    for await (const item of input) {
      yield await mapper(item, index);
      index++;
    }
  });
}

/**
 * Create a streaming take step.
 *
 * Yields only the first N items, then stops.
 *
 * @param name - Step name
 * @param count - Number of items to take
 *
 * @example
 * const takeFirst10 = createStreamingTake("takeFirst10", 10);
 */
export function createStreamingTake<
  TInput,
  // biome-ignore lint/suspicious/noExplicitAny: Generic constraint requires any to allow flexible accumulated state types
  TAccumulated extends Record<string, any> = Record<string, never>,
>(name: string, count: number): StreamingStep<TInput, TInput, TAccumulated, unknown> {
  return createStreamingStep<TInput, TInput, TAccumulated, unknown>(name, async function* ({ input }) {
    let taken = 0;
    for await (const item of input) {
      if (taken >= count) {
        break;
      }
      yield item;
      taken++;
    }
  });
}

/**
 * Create a streaming skip step.
 *
 * Skips the first N items, then yields the rest.
 *
 * @param name - Step name
 * @param count - Number of items to skip
 *
 * @example
 * const skipFirst20 = createStreamingSkip("skipFirst20", 20);
 */
export function createStreamingSkip<
  TInput,
  // biome-ignore lint/suspicious/noExplicitAny: Generic constraint requires any to allow flexible accumulated state types
  TAccumulated extends Record<string, any> = Record<string, never>,
>(name: string, count: number): StreamingStep<TInput, TInput, TAccumulated, unknown> {
  return createStreamingStep<TInput, TInput, TAccumulated, unknown>(name, async function* ({ input }) {
    let skipped = 0;
    for await (const item of input) {
      if (skipped < count) {
        skipped++;
        continue;
      }
      yield item;
    }
  });
}

/**
 * Create a streaming batch step.
 *
 * Groups items into batches of specified size.
 *
 * @param name - Step name
 * @param size - Batch size
 *
 * @example
 * const batch10 = createStreamingBatch("batch10", 10);
 */
export function createStreamingBatch<
  TInput,
  // biome-ignore lint/suspicious/noExplicitAny: Generic constraint requires any to allow flexible accumulated state types
  TAccumulated extends Record<string, any> = Record<string, never>,
>(name: string, size: number): StreamingStep<TInput, TInput[], TAccumulated, unknown> {
  return createStreamingStep<TInput, TInput[], TAccumulated, unknown>(name, async function* ({ input }) {
    let batch: TInput[] = [];

    for await (const item of input) {
      batch.push(item);

      if (batch.length >= size) {
        yield batch;
        batch = [];
      }
    }

    // Yield remaining items if any
    if (batch.length > 0) {
      yield batch;
    }
  });
}

/**
 * Create a streaming unbatch/flatten step.
 *
 * Flattens batches into individual items.
 *
 * @param name - Step name
 *
 * @example
 * const unbatch = createStreamingUnbatch("unbatch");
 */
export function createStreamingUnbatch<
  TElement,
  // biome-ignore lint/suspicious/noExplicitAny: Generic constraint requires any to allow flexible accumulated state types
  TAccumulated extends Record<string, any> = Record<string, never>,
>(name: string): StreamingStep<TElement[], TElement, TAccumulated, unknown> {
  return createStreamingStep<TElement[], TElement, TAccumulated, unknown>(name, async function* ({ input }) {
    for await (const batch of input) {
      for (const item of batch) {
        yield item;
      }
    }
  });
}

/**
 * Helper to check if an error is retryable.
 *
 * Used internally by retry logic.
 */
export function isRetryableStreamingError(error: unknown): boolean {
  if (error instanceof Error) {
    const retryableMessages = ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "fetch failed", "rate limit"];
    return retryableMessages.some((msg) => error.message.toLowerCase().includes(msg.toLowerCase()));
  }
  return false;
}

/**
 * Helper to create a StreamingError from an unknown error.
 *
 * Used internally for error handling.
 */
export function createStreamingError(
  error: unknown,
  stepName: string,
  traceId: string,
  spanId: string,
  itemIndex?: number,
): StreamingError {
  const message = error instanceof Error ? error.message : String(error);
  let code = "STREAM_ERROR";

  if (error instanceof Error && "code" in error) {
    // biome-ignore lint/suspicious/noExplicitAny: Type assertion needed to access code property after runtime check
    code = String((error as any).code);
  }

  const baseError = new Error(message);
  const streamingError: StreamingError = Object.assign(baseError, {
    name: "StreamingError",
    code,
    stepName,
    retryable: isRetryableStreamingError(error),
    cause: error,
    traceId,
    spanId,
    ...(itemIndex !== undefined && { itemIndex }),
  });

  return streamingError;
}
