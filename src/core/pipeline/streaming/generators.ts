/**
 * Base generator utilities for streaming pipelines.
 *
 * This module provides fundamental building blocks for working with async generators:
 * - Conversion functions (fromArray, fromAsyncIterable, toArray)
 * - Stream manipulation (take, skip)
 * - Resource cleanup helpers
 *
 * All generators implement proper cleanup in try/finally blocks to ensure
 * resources are released even if the consumer stops early.
 *
 * @module generators
 */

/**
 * Convert an array to an async generator stream.
 * Useful for testing and feeding static data into streaming pipelines.
 *
 * @template T - The type of items in the array
 * @param items - Array of items to convert to a stream
 * @returns Async generator yielding items one at a time
 *
 * @example
 * ```typescript
 * const stream = fromArray([1, 2, 3, 4, 5]);
 * for await (const num of stream) {
 *   console.log(num); // 1, 2, 3, 4, 5
 * }
 * ```
 */
export async function* fromArray<T>(items: T[]): AsyncGenerator<T> {
  try {
    for (const item of items) {
      yield item;
    }
  } finally {
    // Cleanup: nothing to clean up for arrays, but pattern is consistent
  }
}

/**
 * Convert an async iterable to an async generator.
 * Normalizes different async iterable sources into a consistent generator type.
 *
 * @template T - The type of items in the iterable
 * @param iterable - An async iterable to convert
 * @returns Async generator yielding items from the iterable
 *
 * @example
 * ```typescript
 * async function* source() {
 *   yield 1;
 *   yield 2;
 * }
 *
 * const normalized = fromAsyncIterable(source());
 * for await (const num of normalized) {
 *   console.log(num); // 1, 2
 * }
 * ```
 */
export async function* fromAsyncIterable<T>(iterable: AsyncIterable<T>): AsyncGenerator<T> {
  try {
    for await (const item of iterable) {
      yield item;
    }
  } finally {
    // Cleanup: if the iterable has a return/cleanup method, it will be called
    // automatically when the for-await loop exits
  }
}

/**
 * Consume an entire async generator and collect all items into an array.
 * Warning: This materializes the entire stream in memory. Use with caution
 * on large or infinite streams.
 *
 * @template T - The type of items in the stream
 * @param stream - Async generator to consume
 * @returns Promise resolving to array of all items from the stream
 *
 * @example
 * ```typescript
 * async function* numbers() {
 *   yield 1;
 *   yield 2;
 *   yield 3;
 * }
 *
 * const array = await toArray(numbers());
 * console.log(array); // [1, 2, 3]
 * ```
 */
export async function toArray<T>(stream: AsyncGenerator<T>): Promise<T[]> {
  const results: T[] = [];

  try {
    for await (const item of stream) {
      results.push(item);
    }
  } finally {
    // Cleanup: ensure generator is properly closed
    // The for-await loop handles this automatically, but we're explicit
    await stream.return?.(undefined);
  }

  return results;
}

/**
 * Limit a stream to the first N items.
 * Automatically closes the source stream after taking N items.
 *
 * @template T - The type of items in the stream
 * @param stream - Source async generator
 * @param n - Maximum number of items to take
 * @returns Async generator yielding at most N items
 *
 * @example
 * ```typescript
 * async function* numbers() {
 *   let i = 0;
 *   while (true) yield i++; // Infinite stream
 * }
 *
 * const limited = take(numbers(), 3);
 * const array = await toArray(limited);
 * console.log(array); // [0, 1, 2]
 * ```
 */
export async function* take<T>(stream: AsyncGenerator<T>, n: number): AsyncGenerator<T> {
  if (n <= 0) {
    // Early return for non-positive limits
    await stream.return?.(undefined);
    return;
  }

  let count = 0;

  try {
    for await (const item of stream) {
      yield item;
      count++;

      if (count >= n) {
        // We've taken enough items, stop consuming the stream
        break;
      }
    }
  } finally {
    // Cleanup: ensure the source stream is properly closed
    // This is critical - if we break early, we need to clean up the source
    await stream.return?.(undefined);
  }
}

/**
 * Skip the first N items from a stream.
 * Useful for pagination or skipping headers.
 *
 * @template T - The type of items in the stream
 * @param stream - Source async generator
 * @param n - Number of items to skip
 * @returns Async generator yielding all items after skipping N
 *
 * @example
 * ```typescript
 * const stream = fromArray([1, 2, 3, 4, 5]);
 * const skipped = skip(stream, 2);
 * const array = await toArray(skipped);
 * console.log(array); // [3, 4, 5]
 * ```
 *
 * @example
 * ```typescript
 * // Pagination: get page 2 (items 10-19)
 * const pageSize = 10;
 * const pageNumber = 2;
 * const page = take(skip(allItems(), pageNumber * pageSize), pageSize);
 * ```
 */
export async function* skip<T>(stream: AsyncGenerator<T>, n: number): AsyncGenerator<T> {
  if (n < 0) {
    throw new Error("Cannot skip negative number of items");
  }

  let count = 0;

  try {
    for await (const item of stream) {
      if (count >= n) {
        // We've skipped enough, start yielding
        yield item;
      } else {
        // Still skipping
        count++;
      }
    }
  } finally {
    // Cleanup: ensure the source stream is properly closed
    await stream.return?.(undefined);
  }
}

/**
 * Filter items from a stream based on a predicate function.
 * Only yields items where the predicate returns true.
 *
 * @template T - The type of items in the stream
 * @param stream - Source async generator
 * @param predicate - Function that returns true for items to keep
 * @returns Async generator yielding only filtered items
 *
 * @example
 * ```typescript
 * const numbers = fromArray([1, 2, 3, 4, 5]);
 * const evens = filter(numbers, n => n % 2 === 0);
 * const array = await toArray(evens);
 * console.log(array); // [2, 4]
 * ```
 *
 * @example
 * ```typescript
 * // Async predicate
 * const validated = filter(items, async item => {
 *   return await validateItem(item);
 * });
 * ```
 */
export async function* filter<T>(
  stream: AsyncGenerator<T>,
  predicate: (item: T) => boolean | Promise<boolean>,
): AsyncGenerator<T> {
  try {
    for await (const item of stream) {
      const shouldKeep = await predicate(item);
      if (shouldKeep) {
        yield item;
      }
    }
  } finally {
    // Cleanup: ensure the source stream is properly closed
    await stream.return?.(undefined);
  }
}

/**
 * Transform items in a stream using a mapping function.
 * Applies the function to each item and yields the result.
 *
 * @template TIn - The type of input items
 * @template TOut - The type of output items
 * @param stream - Source async generator
 * @param fn - Function to transform each item
 * @returns Async generator yielding transformed items
 *
 * @example
 * ```typescript
 * const numbers = fromArray([1, 2, 3]);
 * const doubled = map(numbers, n => n * 2);
 * const array = await toArray(doubled);
 * console.log(array); // [2, 4, 6]
 * ```
 *
 * @example
 * ```typescript
 * // Async transformation
 * const enriched = map(items, async item => {
 *   const details = await fetchDetails(item.id);
 *   return { ...item, details };
 * });
 * ```
 */
export async function* map<TIn, TOut>(
  stream: AsyncGenerator<TIn>,
  fn: (item: TIn) => TOut | Promise<TOut>,
): AsyncGenerator<TOut> {
  try {
    for await (const item of stream) {
      yield await fn(item);
    }
  } finally {
    // Cleanup: ensure the source stream is properly closed
    await stream.return?.(undefined);
  }
}

/**
 * Transform each item into zero or more items (flat map).
 * Useful for expanding items or splitting items into multiple outputs.
 *
 * @template TIn - The type of input items
 * @template TOut - The type of output items
 * @param stream - Source async generator
 * @param fn - Function that returns an array or iterable of outputs for each input
 * @returns Async generator yielding all outputs from all transformations
 *
 * @example
 * ```typescript
 * const words = fromArray(["hello world", "foo bar"]);
 * const letters = flatMap(words, word => word.split(" "));
 * const array = await toArray(letters);
 * console.log(array); // ["hello", "world", "foo", "bar"]
 * ```
 *
 * @example
 * ```typescript
 * // Async expansion
 * const chunks = flatMap(files, async file => {
 *   const content = await readFile(file);
 *   return splitIntoChunks(content);
 * });
 * ```
 */
export async function* flatMap<TIn, TOut>(
  stream: AsyncGenerator<TIn>,
  fn: (item: TIn) => TOut[] | Promise<TOut[]> | AsyncIterable<TOut>,
): AsyncGenerator<TOut> {
  try {
    for await (const item of stream) {
      const outputs = await fn(item);

      // Handle both arrays and async iterables
      if (Symbol.asyncIterator in outputs) {
        for await (const output of outputs) {
          yield output;
        }
      } else if (Symbol.iterator in outputs) {
        for (const output of outputs) {
          yield output;
        }
      } else {
        // If it's already an array
        for (const output of outputs as TOut[]) {
          yield output;
        }
      }
    }
  } finally {
    // Cleanup: ensure the source stream is properly closed
    await stream.return?.(undefined);
  }
}

/**
 * Batch items from a stream into arrays of specified size.
 * The last batch may contain fewer items if the stream doesn't divide evenly.
 *
 * @template T - The type of items in the stream
 * @param stream - Source async generator
 * @param size - Number of items per batch
 * @returns Async generator yielding arrays of items
 *
 * @example
 * ```typescript
 * const numbers = fromArray([1, 2, 3, 4, 5, 6, 7]);
 * const batches = batch(numbers, 3);
 * const array = await toArray(batches);
 * console.log(array); // [[1, 2, 3], [4, 5, 6], [7]]
 * ```
 */
export async function* batch<T>(stream: AsyncGenerator<T>, size: number): AsyncGenerator<T[]> {
  if (size <= 0) {
    throw new Error("Batch size must be positive");
  }

  let currentBatch: T[] = [];

  try {
    for await (const item of stream) {
      currentBatch.push(item);

      if (currentBatch.length >= size) {
        yield currentBatch;
        currentBatch = [];
      }
    }

    // Yield any remaining items as the final batch
    if (currentBatch.length > 0) {
      yield currentBatch;
    }
  } finally {
    // Cleanup: ensure the source stream is properly closed
    await stream.return?.(undefined);
  }
}

/**
 * Flatten a stream of arrays into a stream of individual items.
 * Opposite of batch - useful for unbatching.
 *
 * @template T - The type of items in the arrays
 * @param stream - Source async generator of arrays
 * @returns Async generator yielding individual items
 *
 * @example
 * ```typescript
 * const batches = fromArray([[1, 2], [3, 4], [5]]);
 * const flattened = flatten(batches);
 * const array = await toArray(flattened);
 * console.log(array); // [1, 2, 3, 4, 5]
 * ```
 */
export async function* flatten<T>(stream: AsyncGenerator<T[]>): AsyncGenerator<T> {
  try {
    for await (const batch of stream) {
      for (const item of batch) {
        yield item;
      }
    }
  } finally {
    // Cleanup: ensure the source stream is properly closed
    await stream.return?.(undefined);
  }
}

/**
 * Tap into a stream for side effects without modifying the items.
 * Useful for logging, metrics collection, or debugging.
 *
 * @template T - The type of items in the stream
 * @param stream - Source async generator
 * @param fn - Function to call for each item (return value is ignored)
 * @returns Async generator yielding the same items unchanged
 *
 * @example
 * ```typescript
 * const numbers = fromArray([1, 2, 3]);
 * const logged = tap(numbers, n => console.log("Processing:", n));
 * await toArray(logged);
 * // Logs: Processing: 1, Processing: 2, Processing: 3
 * ```
 */
export async function* tap<T>(stream: AsyncGenerator<T>, fn: (item: T) => void | Promise<void>): AsyncGenerator<T> {
  try {
    for await (const item of stream) {
      await fn(item);
      yield item;
    }
  } finally {
    // Cleanup: ensure the source stream is properly closed
    await stream.return?.(undefined);
  }
}
