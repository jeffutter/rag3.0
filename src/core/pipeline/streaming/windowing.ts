/**
 * Windowing and time-based batching operations for streaming pipelines.
 *
 * This module provides advanced batching operations beyond simple fixed-size batching:
 * - Window operations (sliding, tumbling, hopping)
 * - Time-based batching
 * - Predicate-based batching
 *
 * All operations implement proper cleanup of timers and resources to prevent memory leaks.
 *
 * @module windowing
 */

/**
 * Create sliding, tumbling, or hopping windows over a stream.
 *
 * Window types:
 * - Tumbling: slideSize === windowSize (non-overlapping windows)
 * - Sliding: slideSize < windowSize (overlapping windows)
 * - Hopping: slideSize > windowSize (gaps between windows)
 *
 * @template T - The type of items in the stream
 * @param source - Source async iterable
 * @param windowSize - Number of items in each window
 * @param slideSize - Number of items to advance for next window (defaults to windowSize for tumbling)
 * @returns Async generator yielding arrays of items representing windows
 *
 * @example
 * ```typescript
 * // Tumbling windows (non-overlapping)
 * const stream = fromArray([1, 2, 3, 4, 5, 6]);
 * const tumbling = window(stream, 2);
 * // Yields: [1, 2], [3, 4], [5, 6]
 * ```
 *
 * @example
 * ```typescript
 * // Sliding windows (overlapping)
 * const stream = fromArray([1, 2, 3, 4, 5]);
 * const sliding = window(stream, 3, 1);
 * // Yields: [1, 2, 3], [2, 3, 4], [3, 4, 5]
 * ```
 *
 * @example
 * ```typescript
 * // Hopping windows (with gaps)
 * const stream = fromArray([1, 2, 3, 4, 5, 6, 7, 8]);
 * const hopping = window(stream, 2, 3);
 * // Yields: [1, 2], [4, 5], [7, 8]
 * ```
 */
export async function* window<T>(
  source: AsyncIterable<T>,
  windowSize: number,
  slideSize: number = windowSize,
): AsyncGenerator<T[]> {
  if (windowSize <= 0) {
    throw new Error("Window size must be positive");
  }
  if (slideSize <= 0) {
    throw new Error("Slide size must be positive");
  }

  const buffer: T[] = [];
  let skipCount = 0;

  try {
    for await (const item of source) {
      // If we're in skip mode (for hopping windows), skip items
      if (skipCount > 0) {
        skipCount--;
        continue;
      }

      buffer.push(item);

      // Check if we have a complete window
      if (buffer.length === windowSize) {
        yield [...buffer];

        // Remove items based on slide size
        if (slideSize >= windowSize) {
          // Tumbling or hopping: clear the entire buffer
          buffer.length = 0;

          // For hopping windows, set up to skip additional items
          if (slideSize > windowSize) {
            skipCount = slideSize - windowSize;
          }
        } else {
          // Sliding: remove items from the front
          buffer.splice(0, slideSize);
        }
      }
    }

    // For sliding windows, emit any remaining partial windows that are complete enough
    // This only applies when slideSize < windowSize and we have buffered items
    if (slideSize < windowSize && buffer.length > 0) {
      // Emit remaining windows by sliding through the buffer
      while (buffer.length >= windowSize - slideSize) {
        if (buffer.length >= windowSize) {
          yield [...buffer.slice(0, windowSize)];
        }
        buffer.splice(0, slideSize);
      }
    }
  } finally {
    // Cleanup: ensure the source stream is properly closed
    if (typeof (source as AsyncGenerator<T>).return === "function") {
      await (source as AsyncGenerator<T>).return?.(undefined);
    }
  }
}

/**
 * Batch items based on time windows with optional size limit.
 *
 * Yields a batch when either:
 * - The time window elapses
 * - The maximum batch size is reached (if specified)
 *
 * This is useful for scenarios like:
 * - Bulk database inserts with time limits
 * - API request batching with time bounds
 * - Log aggregation with periodic flushes
 *
 * @template T - The type of items in the stream
 * @param source - Source async iterable
 * @param windowMs - Time window in milliseconds
 * @param maxSize - Optional maximum batch size (prevents unbounded memory usage)
 * @returns Async generator yielding batched arrays
 *
 * @example
 * ```typescript
 * // Batch every 100ms or when 10 items collected
 * const stream = slowDataSource();
 * const batched = bufferTime(stream, 100, 10);
 * for await (const batch of batched) {
 *   await bulkInsert(batch);
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Time-based batching only (no size limit)
 * const logs = logStream();
 * const batched = bufferTime(logs, 1000);
 * for await (const batch of batched) {
 *   console.log(`Flushing ${batch.length} logs`);
 * }
 * ```
 */
export async function* bufferTime<T>(
  source: AsyncIterable<T>,
  windowMs: number,
  maxSize?: number,
): AsyncGenerator<T[]> {
  if (windowMs <= 0) {
    throw new Error("Window time must be positive");
  }
  if (maxSize !== undefined && maxSize <= 0) {
    throw new Error("Max size must be positive");
  }

  let buffer: T[] = [];
  let timer: Timer | null = null;
  let timerPromise: Promise<void> | null = null;
  let _timerResolve: (() => void) | null = null;

  // Create a new timer promise and start the timer
  const startTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
    }

    timerPromise = new Promise<void>((resolve) => {
      _timerResolve = resolve;
      timer = setTimeout(() => {
        resolve();
      }, windowMs);
    });
  };

  // Clean up timer resources
  const cleanupTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    timerPromise = null;
    _timerResolve = null;
  };

  try {
    startTimer();

    const iterator = source[Symbol.asyncIterator]();
    let done = false;

    while (!done) {
      // Race between getting next item and timer expiring
      const nextPromise = iterator.next();

      // timerPromise is always set when we reach this point (startTimer called before loop)
      if (!timerPromise) {
        throw new Error("Timer promise not initialized");
      }
      const currentTimerPromise: Promise<void> = timerPromise;

      const result = await Promise.race([
        nextPromise.then((r) => ({ type: "item" as const, value: r })),
        currentTimerPromise.then(() => ({ type: "timeout" as const })),
      ]);

      if (result.type === "timeout") {
        // Timer expired - emit current buffer if non-empty
        if (buffer.length > 0) {
          yield buffer;
          buffer = [];
        }
        startTimer();

        // We still need to wait for the item that was in flight
        const itemResult = await nextPromise;
        if (itemResult.done) {
          done = true;
        } else {
          buffer.push(itemResult.value);
          // Check size limit immediately after adding
          if (maxSize !== undefined && buffer.length >= maxSize) {
            yield buffer;
            buffer = [];
            startTimer();
          }
        }
      } else {
        // Got an item
        if (result.value.done) {
          done = true;
        } else {
          buffer.push(result.value.value);

          // Check if we've hit the size limit
          if (maxSize !== undefined && buffer.length >= maxSize) {
            yield buffer;
            buffer = [];
            startTimer();
          }
        }
      }
    }

    // Emit any remaining items
    if (buffer.length > 0) {
      yield buffer;
    }
  } finally {
    // Critical: clean up timer to prevent memory leaks
    cleanupTimer();

    // Cleanup: ensure the source stream is properly closed
    if (typeof (source as AsyncGenerator<T>).return === "function") {
      await (source as AsyncGenerator<T>).return?.(undefined);
    }
  }
}

/**
 * Batch items based on a predicate function.
 *
 * Accumulates items until the predicate returns true, then yields the batch.
 * The predicate receives the current buffer and the new item, and returns true
 * when the batch should be emitted.
 *
 * Common use cases:
 * - Batch until a delimiter is found
 * - Batch until a certain total size is reached
 * - Batch until a specific condition is met
 *
 * @template T - The type of items in the stream
 * @param source - Source async iterable
 * @param predicate - Function that returns true when batch should be emitted
 * @returns Async generator yielding batched arrays
 *
 * @example
 * ```typescript
 * // Batch lines until we see an empty line (paragraph separator)
 * const lines = readLinesStream();
 * const paragraphs = bufferUntil(lines, (buffer, line) => line === "");
 * ```
 *
 * @example
 * ```typescript
 * // Batch items until total size exceeds threshold
 * interface Item { size: number; data: string; }
 * const items = itemStream();
 * const batched = bufferUntil(items, (buffer, item) => {
 *   const totalSize = buffer.reduce((sum, i) => sum + i.size, 0) + item.size;
 *   return totalSize > 1000;
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Batch until we see a specific marker
 * const events = eventStream();
 * const batched = bufferUntil(events, (buffer, event) => event.type === "END");
 * ```
 */
export async function* bufferUntil<T>(
  source: AsyncIterable<T>,
  predicate: (items: T[], current: T) => boolean | Promise<boolean>,
): AsyncGenerator<T[]> {
  let buffer: T[] = [];

  try {
    for await (const item of source) {
      // Check predicate before adding item
      const shouldEmit = await predicate(buffer, item);

      // Always add the current item to the buffer
      buffer.push(item);

      if (shouldEmit) {
        yield buffer;
        buffer = [];
      }
    }

    // Emit any remaining items
    if (buffer.length > 0) {
      yield buffer;
    }
  } finally {
    // Cleanup: ensure the source stream is properly closed
    if (typeof (source as AsyncGenerator<T>).return === "function") {
      await (source as AsyncGenerator<T>).return?.(undefined);
    }
  }
}
