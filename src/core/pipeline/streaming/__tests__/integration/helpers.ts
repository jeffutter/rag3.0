/**
 * Test helpers for streaming pipeline integration tests.
 *
 * This module provides utilities for:
 * - Collecting stream results
 * - Generating test streams with various characteristics
 * - Simulating errors and delays
 * - Memory leak detection
 */

/**
 * Collect all items from an async generator into an array.
 * Essential for testing streaming pipelines.
 *
 * @template T - The type of items in the stream
 * @param stream - The async generator to consume
 * @returns Promise resolving to array of all items
 */
export async function collectStream<T>(stream: AsyncGenerator<T>): Promise<T[]> {
  const results: T[] = [];
  try {
    for await (const item of stream) {
      results.push(item);
    }
  } finally {
    // Ensure stream is properly closed
    await stream.return?.(undefined);
  }
  return results;
}

/**
 * Generate a test stream from an array with optional delays between items.
 * Useful for testing backpressure and timing-sensitive operations.
 *
 * @template T - The type of items to generate
 * @param items - Array of items to yield
 * @param delayMs - Optional delay in milliseconds between yields
 * @returns Async generator yielding items with delays
 */
export async function* generateTestStream<T>(items: T[], delayMs?: number): AsyncGenerator<T> {
  for (const item of items) {
    if (delayMs !== undefined && delayMs > 0) {
      await Bun.sleep(delayMs);
    }
    yield item;
  }
}

/**
 * Generate a stream that throws errors at a specified rate.
 * Useful for testing error handling and retry logic.
 *
 * @template T - The type of items to generate
 * @param items - Array of items to yield
 * @param errorRate - Probability (0-1) that any item will cause an error
 * @param errorMessage - Custom error message
 * @returns Async generator that may throw errors
 */
export async function* errorProneStream<T>(
  items: T[],
  errorRate: number,
  errorMessage = "Random test error",
): AsyncGenerator<T> {
  for (const item of items) {
    if (Math.random() < errorRate) {
      throw new Error(errorMessage);
    }
    yield item;
  }
}

/**
 * Generate a stream that throws an error at a specific index.
 * Useful for testing error recovery at specific points.
 *
 * @template T - The type of items to generate
 * @param items - Array of items to yield
 * @param errorIndex - Index at which to throw error
 * @param errorMessage - Error message to throw
 * @returns Async generator that throws at specified index
 */
export async function* streamWithErrorAt<T>(
  items: T[],
  errorIndex: number,
  errorMessage = "Test error at index",
): AsyncGenerator<T> {
  for (let i = 0; i < items.length; i++) {
    if (i === errorIndex) {
      throw new Error(`${errorMessage} ${errorIndex}`);
    }
    yield items[i] as T;
  }
}

/**
 * Generate an infinite stream for testing early termination.
 * Useful for verifying proper cleanup when consumers stop early.
 *
 * @returns Async generator that yields numbers indefinitely
 */
export async function* infiniteStream(): AsyncGenerator<number> {
  let i = 0;
  while (true) {
    yield i++;
    // Small delay to prevent tight loop
    await Bun.sleep(1);
  }
}

/**
 * Measure memory usage before and after executing a function.
 * Useful for detecting memory leaks in streaming operations.
 *
 * @param fn - Async function to measure
 * @returns Object with memory delta in bytes
 */
export async function measureMemory(fn: () => Promise<void>): Promise<{
  heapUsedBefore: number;
  heapUsedAfter: number;
  delta: number;
}> {
  // Force GC if available
  if (global.gc) {
    global.gc();
  }
  await Bun.sleep(100); // Let GC settle

  const heapUsedBefore = process.memoryUsage().heapUsed;

  await fn();

  // Force GC again
  if (global.gc) {
    global.gc();
  }
  await Bun.sleep(100);

  const heapUsedAfter = process.memoryUsage().heapUsed;

  return {
    heapUsedBefore,
    heapUsedAfter,
    delta: heapUsedAfter - heapUsedBefore,
  };
}

/**
 * Create a mock async transformation function with configurable behavior.
 *
 * @template TIn - Input type
 * @template TOut - Output type
 * @param transform - The transformation to apply
 * @param options - Configuration options
 * @returns Async function with configured behavior
 */
export function createMockTransform<TIn, TOut>(
  transform: (input: TIn) => TOut,
  options: {
    delayMs?: number;
    errorRate?: number;
    errorMessage?: string;
  } = {},
): (input: TIn) => Promise<TOut> {
  return async (input: TIn): Promise<TOut> => {
    // Simulate delay
    if (options.delayMs !== undefined && options.delayMs > 0) {
      await Bun.sleep(options.delayMs);
    }

    // Simulate random errors
    if (options.errorRate !== undefined && Math.random() < options.errorRate) {
      throw new Error(options.errorMessage || "Mock transform error");
    }

    return transform(input);
  };
}

/**
 * Count items in a stream without collecting them.
 * Useful for verifying stream length without memory overhead.
 *
 * @template T - The type of items in the stream
 * @param stream - The async generator to count
 * @returns Promise resolving to the count of items
 */
export async function countStream<T>(stream: AsyncGenerator<T>): Promise<number> {
  let count = 0;
  try {
    for await (const _item of stream) {
      count++;
    }
  } finally {
    await stream.return?.(undefined);
  }
  return count;
}

/**
 * Take the first N items from a stream and ensure cleanup.
 * Useful for testing partial stream consumption.
 *
 * @template T - The type of items in the stream
 * @param stream - The async generator to consume
 * @param n - Number of items to take
 * @returns Promise resolving to array of first N items
 */
export async function takeN<T>(stream: AsyncGenerator<T>, n: number): Promise<T[]> {
  const results: T[] = [];
  try {
    for await (const item of stream) {
      results.push(item);
      if (results.length >= n) {
        break;
      }
    }
  } finally {
    // Ensure stream is properly closed
    await stream.return?.(undefined);
  }
  return results;
}

/**
 * Verify that a stream properly cleans up when consumer stops early.
 * Returns true if cleanup callback was invoked.
 *
 * @param streamFactory - Factory function that creates a stream and returns a cleanup flag
 * @param takeCount - Number of items to consume before stopping
 * @returns Promise resolving to true if cleanup was performed
 */
export async function verifyEarlyTerminationCleanup(
  streamFactory: () => { stream: AsyncGenerator<unknown>; cleanupFlag: { called: boolean } },
  takeCount: number,
): Promise<boolean> {
  const { stream, cleanupFlag } = streamFactory();
  await takeN(stream, takeCount);
  // Give cleanup a chance to run
  await Bun.sleep(10);
  return cleanupFlag.called;
}

/**
 * Generate test data with realistic structure for document processing scenarios.
 *
 * @param count - Number of documents to generate
 * @returns Array of mock document objects
 */
export function generateDocuments(count: number): Array<{
  id: string;
  content: string;
  metadata: { source: string; timestamp: number };
}> {
  return Array.from({ length: count }, (_, i) => ({
    id: `doc-${i}`,
    content: `This is test document number ${i}. It contains some sample text for testing.`,
    metadata: {
      source: `source-${i % 3}`,
      timestamp: Date.now() + i * 1000,
    },
  }));
}

/**
 * Generate test chunks for embedding scenarios.
 *
 * @param documentId - The document ID
 * @param chunkCount - Number of chunks to generate
 * @returns Array of mock chunk objects
 */
export function generateChunks(
  documentId: string,
  chunkCount: number,
): Array<{
  documentId: string;
  chunkIndex: number;
  content: string;
  size: number;
}> {
  return Array.from({ length: chunkCount }, (_, i) => ({
    documentId,
    chunkIndex: i,
    content: `Chunk ${i} content`,
    size: 50 + i * 10,
  }));
}

/**
 * Simulate a rate-limited API call.
 *
 * @template T - Type of data being processed
 * @param item - The item to process
 * @param delayMs - Delay to simulate API call
 * @param maxConcurrent - Maximum concurrent calls allowed (throws if exceeded)
 * @returns Promise resolving to processed item
 */
export async function simulateRateLimitedAPI<T>(
  item: T,
  delayMs: number,
  activeCallsRef?: { count: number; max: number },
): Promise<T> {
  if (activeCallsRef) {
    activeCallsRef.count++;
    if (activeCallsRef.count > activeCallsRef.max) {
      activeCallsRef.count--;
      throw new Error(`Rate limit exceeded: ${activeCallsRef.count} > ${activeCallsRef.max}`);
    }
  }

  try {
    await Bun.sleep(delayMs);
    return item;
  } finally {
    if (activeCallsRef) {
      activeCallsRef.count--;
    }
  }
}

/**
 * Time the execution of an async function.
 *
 * @param fn - The async function to time
 * @returns Promise resolving to duration in milliseconds
 */
export async function timeExecution(fn: () => Promise<void>): Promise<number> {
  const start = Date.now();
  await fn();
  return Date.now() - start;
}

/**
 * Assert that a promise completes within a timeout.
 *
 * @param promise - The promise to wait for
 * @param timeoutMs - Maximum time to wait in milliseconds
 * @param message - Error message if timeout occurs
 * @returns Promise resolving to the result
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message = "Operation timed out",
): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeout]);
}
