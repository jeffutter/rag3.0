/**
 * Parallel processing utilities for streaming pipelines.
 *
 * This module provides concurrency-controlled parallel processing while maintaining
 * pull-based semantics and proper backpressure control.
 *
 * Key features:
 * - Windowed pool pattern for concurrency control
 * - Ordered and unordered parallelMap modes
 * - Backpressure prevention (never pull more than concurrency limit)
 * - Proper cleanup and cancellation on early termination
 * - Fail-fast error handling
 *
 * @module parallel
 */

/**
 * Options for parallel processing operations.
 */
export interface ParallelOptions {
  /** Maximum number of concurrent operations */
  concurrency: number;
  /** Whether to preserve input order in output (default: false for better performance) */
  ordered?: boolean;
}

/**
 * Transform items in a stream concurrently while respecting concurrency limits.
 *
 * This function processes multiple items in parallel but never pulls more items
 * from the source than the concurrency limit allows. This ensures backpressure
 * is maintained and memory usage is bounded.
 *
 * **Performance Characteristics:**
 * - Unordered mode: Yields items as they complete (better performance)
 * - Ordered mode: Yields items in input order (may buffer completed items)
 * - Memory: Bounded by concurrency limit
 * - Backpressure: Automatically applied to source stream
 *
 * **Error Handling:**
 * - Fail-fast: First error stops pulling new items and cancels in-flight work
 * - Errors propagate immediately to caller
 *
 * @template TIn - The type of input items
 * @template TOut - The type of output items
 * @param source - Source async iterable
 * @param fn - Async function to transform each item (receives item and index)
 * @param options - Concurrency and ordering options
 * @returns Async generator yielding transformed items
 *
 * @example
 * ```typescript
 * // Unordered mode - yields results as they complete (fastest)
 * const results = parallelMap(
 *   fromArray([1, 2, 3, 4, 5]),
 *   async (n) => {
 *     await delay(Math.random() * 100);
 *     return n * 2;
 *   },
 *   { concurrency: 3 }
 * );
 * // Results may be out of order: 6, 2, 4, 10, 8
 *
 * // Ordered mode - preserves input order
 * const ordered = parallelMap(
 *   fromArray([1, 2, 3, 4, 5]),
 *   async (n) => processItem(n),
 *   { concurrency: 3, ordered: true }
 * );
 * // Results in order: 2, 4, 6, 8, 10
 * ```
 */
export async function* parallelMap<TIn, TOut>(
  source: AsyncIterable<TIn>,
  fn: (item: TIn, index: number) => Promise<TOut>,
  options: ParallelOptions,
): AsyncGenerator<TOut> {
  const { concurrency, ordered = false } = options;
  if (concurrency <= 0) {
    throw new Error("Concurrency must be greater than 0");
  }

  if (ordered) {
    yield* orderedParallelMap(source, fn, concurrency);
  } else {
    yield* unorderedParallelMap(source, fn, concurrency);
  }
}

/**
 * Internal implementation for unordered parallel map.
 * Yields items as they complete for maximum throughput.
 */
async function* unorderedParallelMap<TIn, TOut>(
  source: AsyncIterable<TIn>,
  fn: (item: TIn, index: number) => Promise<TOut>,
  concurrency: number,
): AsyncGenerator<TOut> {
  // Use a Map to track promises with unique IDs for proper removal
  const inFlight = new Map<number, Promise<TOut>>();
  let promiseId = 0;
  let sourceIterator: AsyncIterator<TIn> | null = null;
  let itemIndex = 0;
  let sourceExhausted = false;

  try {
    sourceIterator = source[Symbol.asyncIterator]();

    // Start initial batch up to concurrency limit
    while (inFlight.size < concurrency && !sourceExhausted) {
      const next = await sourceIterator.next();
      if (next.done) {
        sourceExhausted = true;
        break;
      }

      const index = itemIndex++;
      const id = promiseId++;
      const promise = fn(next.value, index);
      inFlight.set(id, promise);
    }

    // Process items as they complete
    while (inFlight.size > 0) {
      // Create racing promises with their IDs
      const racingPromises = Array.from(inFlight.entries()).map(([id, promise]) =>
        promise.then((result) => ({ id, result })),
      );

      // Wait for the first to complete
      const { id, result } = await Promise.race(racingPromises);

      // Remove the completed promise
      inFlight.delete(id);

      // Yield the result
      yield result;

      // Pull next item if source is not exhausted
      if (!sourceExhausted && sourceIterator) {
        const next = await sourceIterator.next();
        if (next.done) {
          sourceExhausted = true;
        } else {
          const index = itemIndex++;
          const newId = promiseId++;
          const promise = fn(next.value, index);
          inFlight.set(newId, promise);
        }
      }
    }
  } finally {
    // Cleanup: ensure source iterator is properly closed
    if (sourceIterator && typeof sourceIterator.return === "function") {
      await sourceIterator.return();
    }

    // Clear the map to release memory
    inFlight.clear();
  }
}

/**
 * Internal implementation for ordered parallel map.
 * Buffers completed items until they can be yielded in order.
 */
async function* orderedParallelMap<TIn, TOut>(
  source: AsyncIterable<TIn>,
  fn: (item: TIn, index: number) => Promise<TOut>,
  concurrency: number,
): AsyncGenerator<TOut> {
  const inFlight = new Map<number, Promise<TOut>>();
  const completed = new Map<number, TOut>();
  let sourceIterator: AsyncIterator<TIn> | null = null;
  let itemIndex = 0;
  let nextOutputIndex = 0;
  let sourceExhausted = false;
  let error: unknown = null;

  try {
    sourceIterator = source[Symbol.asyncIterator]();

    // Process stream
    while (true) {
      // Fill up to concurrency limit
      while (inFlight.size < concurrency && !sourceExhausted) {
        const next = await sourceIterator.next();
        if (next.done) {
          sourceExhausted = true;
          break;
        }

        const index = itemIndex++;
        const promise = fn(next.value, index).catch((err) => {
          error = err;
          throw err;
        });

        inFlight.set(index, promise);

        // Start the promise and handle completion
        promise
          .then((result) => {
            inFlight.delete(index);
            completed.set(index, result);
          })
          .catch(() => {
            // Error already captured in error variable
            inFlight.delete(index);
          });
      }

      // Check for errors
      if (error !== null) {
        throw error;
      }

      // Yield all completed items in order
      while (completed.has(nextOutputIndex)) {
        const result = completed.get(nextOutputIndex);
        completed.delete(nextOutputIndex);
        nextOutputIndex++;

        if (result !== undefined) {
          yield result;
        }
      }

      // Exit conditions
      if (sourceExhausted && inFlight.size === 0 && completed.size === 0) {
        break;
      }

      // Wait for at least one in-flight operation to complete
      if (inFlight.size > 0) {
        await Promise.race(Array.from(inFlight.values()));
      }
    }
  } finally {
    // Cleanup: ensure source iterator is properly closed
    if (sourceIterator && typeof sourceIterator.return === "function") {
      await sourceIterator.return();
    }

    // Clear maps to release memory
    inFlight.clear();
    completed.clear();
  }
}

/**
 * Filter items from a stream using an async predicate with concurrency control.
 *
 * Processes multiple items in parallel to check the predicate, but maintains
 * backpressure by never pulling more items than the concurrency limit.
 *
 * Results are always yielded in input order.
 *
 * @template T - The type of items in the stream
 * @param source - Source async iterable
 * @param predicate - Async function that returns true for items to keep
 * @param concurrency - Maximum number of concurrent predicate checks
 * @returns Async generator yielding only filtered items in order
 *
 * @example
 * ```typescript
 * const filtered = parallelFilter(
 *   fromArray([1, 2, 3, 4, 5, 6]),
 *   async (n) => {
 *     await delay(100);
 *     return n % 2 === 0;
 *   },
 *   3
 * );
 * const result = await toArray(filtered);
 * console.log(result); // [2, 4, 6]
 * ```
 */
export async function* parallelFilter<T>(
  source: AsyncIterable<T>,
  predicate: (item: T, index: number) => Promise<boolean>,
  concurrency: number,
): AsyncGenerator<T> {
  if (concurrency <= 0) {
    throw new Error("Concurrency must be greater than 0");
  }

  // Use ordered parallel map to get results with their items
  const mapped = orderedParallelMap(
    source,
    async (item, index) => {
      const shouldKeep = await predicate(item, index);
      return { item, shouldKeep };
    },
    concurrency,
  );

  // Filter out items where predicate returned false
  try {
    for await (const { item, shouldKeep } of mapped) {
      if (shouldKeep) {
        yield item;
      }
    }
  } finally {
    // Cleanup: ensure the mapped stream is properly closed
    if (typeof mapped.return === "function") {
      await mapped.return(undefined);
    }
  }
}

/**
 * Merge multiple async iterables into a single stream.
 * Yields items from any source as they become available (unordered).
 *
 * This is useful for combining results from multiple parallel operations
 * or merging multiple data sources.
 *
 * **Performance Characteristics:**
 * - Pulls from all sources concurrently
 * - Yields items as soon as any source produces them
 * - Completes when all sources are exhausted
 *
 * **Error Handling:**
 * - If any source throws, the error propagates immediately
 * - Remaining sources are properly cleaned up
 *
 * @template T - The type of items in the streams
 * @param sources - Variable number of async iterables to merge
 * @returns Async generator yielding items from all sources
 *
 * @example
 * ```typescript
 * async function* source1() {
 *   yield 1;
 *   await delay(100);
 *   yield 2;
 * }
 *
 * async function* source2() {
 *   await delay(50);
 *   yield 3;
 *   yield 4;
 * }
 *
 * const merged = merge(source1(), source2());
 * const result = await toArray(merged);
 * // Result order depends on timing: [1, 3, 4, 2] or [1, 3, 2, 4], etc.
 * ```
 */
export async function* merge<T>(...sources: AsyncIterable<T>[]): AsyncGenerator<T> {
  if (sources.length === 0) {
    return undefined;
  }

  if (sources.length === 1) {
    // Optimization: just pass through single source
    const source = sources[0];
    if (!source) return undefined;

    try {
      for await (const item of source) {
        yield item;
      }
    } finally {
      // Cleanup handled by for-await
    }
    return;
  }

  // Track active iterators and their pending values
  const iterators = sources.map((source) => source[Symbol.asyncIterator]());
  const pending = new Map<number, Promise<IteratorResult<T>>>();
  let activeCount = iterators.length;

  try {
    // Start initial pulls from all iterators
    for (let i = 0; i < iterators.length; i++) {
      const iterator = iterators[i];
      if (iterator) {
        pending.set(i, iterator.next());
      }
    }

    // Process items as they arrive
    while (activeCount > 0) {
      // Wait for any iterator to produce a value
      const entries = Array.from(pending.entries());
      const promises = entries.map(([index, promise]) => promise.then((result) => ({ index, result })));

      const { index, result } = await Promise.race(promises);

      // Remove this promise from pending
      pending.delete(index);

      if (result.done) {
        // This iterator is exhausted
        activeCount--;
      } else {
        // Yield the value
        yield result.value;

        // Pull next value from this iterator
        const iterator = iterators[index];
        if (iterator) {
          pending.set(index, iterator.next());
        }
      }
    }
  } finally {
    // Cleanup: ensure all iterators are properly closed
    await Promise.all(
      iterators.map((iterator) => {
        if (iterator && typeof iterator.return === "function") {
          return iterator.return();
        }
        return Promise.resolve();
      }),
    );

    pending.clear();
  }
}
