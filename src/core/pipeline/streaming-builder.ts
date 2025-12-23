/**
 * Fluent builder API for streaming pipelines.
 *
 * Provides a type-safe, composable interface for building async generator-based
 * streaming pipelines. Similar to the batch Pipeline API but optimized for
 * lazy evaluation, backpressure, and incremental processing.
 *
 * Key features:
 * - Type-safe method chaining with full TypeScript inference
 * - Accumulated state tracking across steps
 * - Transform operations (map, filter, flatMap, tap)
 * - Windowing operations (batch, window, bufferTime)
 * - Control flow (take, skip, takeWhile, skipWhile)
 * - Cross-cutting concerns (retry, metadata, error strategies)
 * - Terminal operations (build, toArray, forEach, reduce)
 *
 * @see {@link https://github.com/jeffutter/rag3.0/blob/main/docs/architecture/streaming-pipeline-design.md}
 *
 * @example
 * ```typescript
 * const pipeline = StreamingPipeline.start<Document>()
 *   .map('parsed', parseDocument)
 *   .filter('valid', doc => doc.isValid)
 *   .batch('batches', 10)
 *   .map('embedded', embedBatch, { parallel: true, concurrency: 5 })
 *   .flatMap('flattened', batch => batch)
 *   .tap('logged', doc => console.log(doc.id));
 *
 * // Execute lazily
 * for await (const doc of pipeline.build()(inputStream)) {
 *   console.log(doc);
 * }
 * ```
 */

import { createLogger } from "../logging/logger";
import { StreamingStateImpl, arrayToGenerator, collectStream } from "./streaming-state";
import type { StreamingStep, StreamingStepContext } from "./streaming-types";
import type {
  AddToState as AddToStreamingState,
  StreamingPipeline as IStreamingPipeline,
  StreamingStepFn,
} from "./streaming/types";
import {
  batch as genBatch,
  filter as genFilter,
  flatMap as genFlatMap,
  fromArray,
  map as genMap,
  skip as genSkip,
  take as genTake,
  tap as genTap,
  toArray,
} from "./streaming/generators";
import { parallelMap } from "./streaming/parallel";
import { window, bufferTime } from "./streaming/windowing";

const logger = createLogger("streaming-pipeline");

/**
 * Options for map operations in the streaming pipeline.
 */
export interface MapOptions {
  /** Enable parallel processing (default: false) */
  parallel?: boolean;
  /** Concurrency limit for parallel execution (default: 10) */
  concurrency?: number;
  /** Maintain order of results (default: true) */
  ordered?: boolean;
}

/**
 * Options for windowing operations.
 */
export interface WindowOptions {
  /** Window size in items */
  windowSize: number;
  /** Slide size (how many items to move forward, default: windowSize for tumbling windows) */
  slideSize?: number;
}

/**
 * Options for time-based buffering.
 */
export interface BufferTimeOptions {
  /** Time window in milliseconds */
  windowMs: number;
  /** Maximum batch size (optional limit) */
  maxSize?: number;
}

/**
 * Internal representation of a pipeline stage.
 */
interface PipelineStage {
  key: string;
  // biome-ignore lint/suspicious/noExplicitAny: Internal type-erased storage for pipeline stages
  transform: (input: AsyncGenerator<any>) => AsyncGenerator<any>;
}

/**
 * StreamingPipeline builder class with fluent API.
 *
 * @template TInitialInput - The very first input to the pipeline
 * @template TCurrentOutput - The output of the most recent step
 * @template TAccumulatedState - Object containing all previous step outputs by name
 * @template TContext - Additional runtime context
 */
export class StreamingPipeline<
  TInitialInput,
  TCurrentOutput,
  // biome-ignore lint/suspicious/noExplicitAny: Generic constraint allows any value type in accumulated state
  TAccumulatedState extends Record<string, any>,
  TContext = unknown,
> implements IStreamingPipeline<TInitialInput, TCurrentOutput, TAccumulatedState, TContext>
{
  private stages: PipelineStage[] = [];
  private contextBuilder: () => TContext;

  private constructor(stages: PipelineStage[], contextBuilder: () => TContext) {
    this.stages = stages;
    this.contextBuilder = contextBuilder;
  }

  /**
   * Start a new streaming pipeline.
   *
   * @template TInput - The initial input type
   * @template TContext - Runtime context type
   * @param contextBuilder - Optional function to build runtime context
   * @returns New pipeline builder
   *
   * @example
   * ```typescript
   * const pipeline = StreamingPipeline.start<string>()
   *   .map('upper', s => s.toUpperCase())
   *   .filter('long', s => s.length > 5);
   * ```
   */
  static start<TInput, TContext = unknown>(
    contextBuilder: () => TContext = () => ({}) as TContext,
    // biome-ignore lint/complexity/noBannedTypes: Empty object represents initial empty pipeline state
  ): StreamingPipeline<TInput, TInput, {}, TContext> {
    // biome-ignore lint/complexity/noBannedTypes: Empty object represents initial empty pipeline state
    return new StreamingPipeline<TInput, TInput, {}, TContext>([], contextBuilder);
  }

  /**
   * Add a named streaming step to the pipeline.
   *
   * The step receives:
   * - input: Async generator from the previous step
   * - state: Accumulated state with snapshot/streaming access
   * - context: Runtime context
   *
   * TypeScript enforces:
   * - Input type matches previous step's output
   * - State type contains all previously added steps
   * - No duplicate step names
   *
   * @template TKey - The key name for this step
   * @template TNextOutput - The output type of the step
   * @param key - Unique key for this step
   * @param step - Streaming step to add
   * @returns New pipeline with updated type
   *
   * @example
   * ```typescript
   * const parseStep = createStreamingStep('parse', async function* ({ input }) {
   *   for await (const text of input) {
   *     yield JSON.parse(text);
   *   }
   * });
   *
   * pipeline.add('parsed', parseStep)
   * ```
   */
  add<TKey extends string, TNextOutput>(
    key: TKey,
    step: StreamingStep<TCurrentOutput, TNextOutput, TAccumulatedState, TContext>,
  ): TKey extends keyof TAccumulatedState
    ? never
    : StreamingPipeline<TInitialInput, TNextOutput, AddToStreamingState<TAccumulatedState, TKey, TNextOutput>, TContext> {
    // Capture contextBuilder in closure
    const contextBuilder = this.contextBuilder;

    // Create transform function that wraps the step
    // biome-ignore lint/suspicious/noExplicitAny: Type erasure needed for internal storage
    const transform = async function* (input: AsyncGenerator<any>): AsyncGenerator<TNextOutput> {
      // Create streaming state (will be built up by the executor)
      const state = new StreamingStateImpl<TAccumulatedState>();
      const context = contextBuilder();

      const ctx: StreamingStepContext<TCurrentOutput, TAccumulatedState, TContext> = {
        input: input as AsyncGenerator<TCurrentOutput>,
        state,
        context,
      };

      // Execute the step
      yield* step.execute(ctx);
    };

    return new StreamingPipeline(
      [...this.stages, { key, transform }],
      this.contextBuilder,
      // biome-ignore lint/suspicious/noExplicitAny: TypeScript cannot infer complex conditional return type
    ) as any;
  }

  /**
   * Map a transformation over stream items.
   *
   * Applies a function to each item in the stream, optionally in parallel.
   *
   * @template TKey - The key name for this step
   * @template TOutput - The output type
   * @param key - Unique key for this step
   * @param fn - Transformation function or streaming step
   * @param options - Optional parallel execution settings
   * @returns New pipeline with updated type
   *
   * @example
   * ```typescript
   * // Simple transformation
   * pipeline.map('doubled', n => n * 2)
   *
   * // Async transformation
   * pipeline.map('fetched', async url => await fetch(url))
   *
   * // Parallel transformation
   * pipeline.map('processed', processItem, { parallel: true, concurrency: 5 })
   * ```
   */
  map<TKey extends string, TOutput>(
    key: TKey,
    fn: ((item: TCurrentOutput, index: number) => TOutput | Promise<TOutput>) | StreamingStep<TCurrentOutput, TOutput, TAccumulatedState, TContext>,
    options?: MapOptions,
  ): TKey extends keyof TAccumulatedState
    ? never
    : StreamingPipeline<TInitialInput, TOutput, AddToStreamingState<TAccumulatedState, TKey, TOutput>, TContext> {
    let transform: (input: AsyncGenerator<TCurrentOutput>) => AsyncGenerator<TOutput>;

    if (typeof fn === "function") {
      // It's a plain function
      if (options?.parallel) {
        // Use parallel map
        transform = (input) => parallelMap(input, fn as (item: TCurrentOutput, index: number) => Promise<TOutput>, {
          concurrency: options.concurrency ?? 10,
          ordered: options.ordered ?? true,
        });
      } else {
        // Use sequential map
        transform = (input) => genMap(input, fn);
      }
    } else {
      // It's a StreamingStep
      const step = fn;
      const contextBuilder = this.contextBuilder;

      transform = async function* (input: AsyncGenerator<TCurrentOutput>) {
        const state = new StreamingStateImpl<TAccumulatedState>();
        const context = contextBuilder();

        const ctx: StreamingStepContext<TCurrentOutput, TAccumulatedState, TContext> = {
          input,
          state,
          context,
        };

        yield* step.execute(ctx);
      };
    }

    return new StreamingPipeline(
      [...this.stages, { key, transform: transform as (input: AsyncGenerator<unknown>) => AsyncGenerator<unknown> }],
      this.contextBuilder,
      // biome-ignore lint/suspicious/noExplicitAny: TypeScript cannot infer complex conditional return type
    ) as any;
  }

  /**
   * Filter stream items based on a predicate.
   *
   * Only items matching the predicate are passed through.
   *
   * @template TKey - The key name for this step
   * @param key - Unique key for this step
   * @param predicate - Function to test each item
   * @returns New pipeline with same output type
   *
   * @example
   * ```typescript
   * pipeline.filter('evens', n => n % 2 === 0)
   * pipeline.filter('valid', async item => await validate(item))
   * ```
   */
  filter<TKey extends string>(
    key: TKey,
    predicate: (item: TCurrentOutput, index: number) => boolean | Promise<boolean>,
  ): TKey extends keyof TAccumulatedState
    ? never
    : StreamingPipeline<TInitialInput, TCurrentOutput, AddToStreamingState<TAccumulatedState, TKey, TCurrentOutput>, TContext> {
    const transform = (input: AsyncGenerator<TCurrentOutput>) => genFilter(input, predicate);

    return new StreamingPipeline(
      [...this.stages, { key, transform: transform as (input: AsyncGenerator<unknown>) => AsyncGenerator<unknown> }],
      this.contextBuilder,
      // biome-ignore lint/suspicious/noExplicitAny: TypeScript cannot infer complex conditional return type
    ) as any;
  }

  /**
   * FlatMap a transformation over stream items.
   *
   * Each input item can produce zero or more output items.
   *
   * @template TKey - The key name for this step
   * @template TOutput - The output type
   * @param key - Unique key for this step
   * @param fn - Function that returns an iterable or async iterable
   * @returns New pipeline with updated type
   *
   * @example
   * ```typescript
   * // Split lines into words
   * pipeline.flatMap('words', line => line.split(' '))
   *
   * // Async expansion
   * pipeline.flatMap('chunks', async doc => await splitDocument(doc))
   * ```
   */
  flatMap<TKey extends string, TOutput>(
    key: TKey,
    fn: (item: TCurrentOutput, index: number) => AsyncIterable<TOutput> | Iterable<TOutput> | Promise<Iterable<TOutput>>,
  ): TKey extends keyof TAccumulatedState
    ? never
    : StreamingPipeline<TInitialInput, TOutput, AddToStreamingState<TAccumulatedState, TKey, TOutput>, TContext> {
    const transform = (input: AsyncGenerator<TCurrentOutput>) => genFlatMap(input, fn);

    return new StreamingPipeline(
      [...this.stages, { key, transform: transform as (input: AsyncGenerator<unknown>) => AsyncGenerator<unknown> }],
      this.contextBuilder,
      // biome-ignore lint/suspicious/noExplicitAny: TypeScript cannot infer complex conditional return type
    ) as any;
  }

  /**
   * Tap into the stream for side effects without modifying items.
   *
   * Useful for logging, metrics, or debugging.
   *
   * @template TKey - The key name for this step
   * @param key - Unique key for this step
   * @param fn - Side effect function
   * @returns New pipeline with same output type
   *
   * @example
   * ```typescript
   * pipeline.tap('logged', item => console.log('Processing:', item))
   * pipeline.tap('counted', (item, index) => metrics.increment('processed', { index }))
   * ```
   */
  tap<TKey extends string>(
    key: TKey,
    fn: (item: TCurrentOutput, index: number) => void | Promise<void>,
  ): TKey extends keyof TAccumulatedState
    ? never
    : StreamingPipeline<TInitialInput, TCurrentOutput, AddToStreamingState<TAccumulatedState, TKey, TCurrentOutput>, TContext> {
    const transform = (input: AsyncGenerator<TCurrentOutput>) => genTap(input, fn);

    return new StreamingPipeline(
      [...this.stages, { key, transform: transform as (input: AsyncGenerator<unknown>) => AsyncGenerator<unknown> }],
      this.contextBuilder,
      // biome-ignore lint/suspicious/noExplicitAny: TypeScript cannot infer complex conditional return type
    ) as any;
  }

  /**
   * Batch stream items into fixed-size arrays.
   *
   * Groups items into batches of the specified size. The last batch may be smaller.
   *
   * @template TKey - The key name for this step
   * @param key - Unique key for this step
   * @param size - Number of items per batch
   * @returns New pipeline with array output type
   *
   * @example
   * ```typescript
   * pipeline.batch('batches', 10) // Groups items into arrays of 10
   * ```
   */
  batch<TKey extends string>(
    key: TKey,
    size: number,
  ): TKey extends keyof TAccumulatedState
    ? never
    : StreamingPipeline<TInitialInput, TCurrentOutput[], AddToStreamingState<TAccumulatedState, TKey, TCurrentOutput[]>, TContext> {
    const transform = (input: AsyncGenerator<TCurrentOutput>) => genBatch(input, size);

    return new StreamingPipeline(
      [...this.stages, { key, transform: transform as (input: AsyncGenerator<unknown>) => AsyncGenerator<unknown> }],
      this.contextBuilder,
      // biome-ignore lint/suspicious/noExplicitAny: TypeScript cannot infer complex conditional return type
    ) as any;
  }

  /**
   * Create sliding windows over stream items.
   *
   * Groups items into overlapping or non-overlapping windows.
   *
   * @template TKey - The key name for this step
   * @param key - Unique key for this step
   * @param windowSize - Number of items per window
   * @param slideSize - How many items to move forward (default: windowSize for tumbling)
   * @returns New pipeline with array output type
   *
   * @example
   * ```typescript
   * // Tumbling windows (non-overlapping)
   * pipeline.window('windows', 5)
   *
   * // Sliding windows (overlapping)
   * pipeline.window('sliding', 5, 1) // Window of 5, slide by 1
   * ```
   */
  window<TKey extends string>(
    key: TKey,
    windowSize: number,
    slideSize?: number,
  ): TKey extends keyof TAccumulatedState
    ? never
    : StreamingPipeline<TInitialInput, TCurrentOutput[], AddToStreamingState<TAccumulatedState, TKey, TCurrentOutput[]>, TContext> {
    const transform = (input: AsyncGenerator<TCurrentOutput>) => window(input, windowSize, slideSize);

    return new StreamingPipeline(
      [...this.stages, { key, transform: transform as (input: AsyncGenerator<unknown>) => AsyncGenerator<unknown> }],
      this.contextBuilder,
      // biome-ignore lint/suspicious/noExplicitAny: TypeScript cannot infer complex conditional return type
    ) as any;
  }

  /**
   * Buffer items based on time windows.
   *
   * Groups items that arrive within a time window, with optional max size.
   *
   * @template TKey - The key name for this step
   * @param key - Unique key for this step
   * @param windowMs - Time window in milliseconds
   * @param maxSize - Optional maximum batch size
   * @returns New pipeline with array output type
   *
   * @example
   * ```typescript
   * // Buffer for 1 second
   * pipeline.bufferTime('buffered', 1000)
   *
   * // Buffer for 1 second or 100 items, whichever comes first
   * pipeline.bufferTime('buffered', 1000, 100)
   * ```
   */
  bufferTime<TKey extends string>(
    key: TKey,
    windowMs: number,
    maxSize?: number,
  ): TKey extends keyof TAccumulatedState
    ? never
    : StreamingPipeline<TInitialInput, TCurrentOutput[], AddToStreamingState<TAccumulatedState, TKey, TCurrentOutput[]>, TContext> {
    const transform = (input: AsyncGenerator<TCurrentOutput>) => bufferTime(input, windowMs, maxSize);

    return new StreamingPipeline(
      [...this.stages, { key, transform: transform as (input: AsyncGenerator<unknown>) => AsyncGenerator<unknown> }],
      this.contextBuilder,
      // biome-ignore lint/suspicious/noExplicitAny: TypeScript cannot infer complex conditional return type
    ) as any;
  }

  /**
   * Take only the first N items from the stream.
   *
   * Automatically closes the source stream after taking N items.
   *
   * @template TKey - The key name for this step
   * @param key - Unique key for this step
   * @param count - Number of items to take
   * @returns New pipeline with same output type
   *
   * @example
   * ```typescript
   * pipeline.take('first10', 10) // Only process first 10 items
   * ```
   */
  take<TKey extends string>(
    key: TKey,
    count: number,
  ): TKey extends keyof TAccumulatedState
    ? never
    : StreamingPipeline<TInitialInput, TCurrentOutput, AddToStreamingState<TAccumulatedState, TKey, TCurrentOutput>, TContext> {
    const transform = (input: AsyncGenerator<TCurrentOutput>) => genTake(input, count);

    return new StreamingPipeline(
      [...this.stages, { key, transform: transform as (input: AsyncGenerator<unknown>) => AsyncGenerator<unknown> }],
      this.contextBuilder,
      // biome-ignore lint/suspicious/noExplicitAny: TypeScript cannot infer complex conditional return type
    ) as any;
  }

  /**
   * Skip the first N items from the stream.
   *
   * Useful for pagination or skipping headers.
   *
   * @template TKey - The key name for this step
   * @param key - Unique key for this step
   * @param count - Number of items to skip
   * @returns New pipeline with same output type
   *
   * @example
   * ```typescript
   * pipeline.skip('skipFirst20', 20) // Skip first 20 items
   * ```
   */
  skip<TKey extends string>(
    key: TKey,
    count: number,
  ): TKey extends keyof TAccumulatedState
    ? never
    : StreamingPipeline<TInitialInput, TCurrentOutput, AddToStreamingState<TAccumulatedState, TKey, TCurrentOutput>, TContext> {
    const transform = (input: AsyncGenerator<TCurrentOutput>) => genSkip(input, count);

    return new StreamingPipeline(
      [...this.stages, { key, transform: transform as (input: AsyncGenerator<unknown>) => AsyncGenerator<unknown> }],
      this.contextBuilder,
      // biome-ignore lint/suspicious/noExplicitAny: TypeScript cannot infer complex conditional return type
    ) as any;
  }

  /**
   * Take items while a predicate is true.
   *
   * Stops taking items (and closes the stream) when predicate returns false.
   *
   * @template TKey - The key name for this step
   * @param key - Unique key for this step
   * @param predicate - Function to test each item
   * @returns New pipeline with same output type
   *
   * @example
   * ```typescript
   * pipeline.takeWhile('ascending', (n, prev) => n > prev)
   * ```
   */
  takeWhile<TKey extends string>(
    key: TKey,
    predicate: (item: TCurrentOutput, index: number) => boolean | Promise<boolean>,
  ): TKey extends keyof TAccumulatedState
    ? never
    : StreamingPipeline<TInitialInput, TCurrentOutput, AddToStreamingState<TAccumulatedState, TKey, TCurrentOutput>, TContext> {
    const transform = async function* (input: AsyncGenerator<TCurrentOutput>): AsyncGenerator<TCurrentOutput> {
      let index = 0;
      try {
        for await (const item of input) {
          const shouldContinue = await predicate(item, index);
          if (!shouldContinue) {
            break;
          }
          yield item;
          index++;
        }
      } finally {
        await input.return?.(undefined);
      }
    };

    return new StreamingPipeline(
      [...this.stages, { key, transform: transform as (input: AsyncGenerator<unknown>) => AsyncGenerator<unknown> }],
      this.contextBuilder,
      // biome-ignore lint/suspicious/noExplicitAny: TypeScript cannot infer complex conditional return type
    ) as any;
  }

  /**
   * Skip items while a predicate is true.
   *
   * Starts yielding items when predicate returns false.
   *
   * @template TKey - The key name for this step
   * @param key - Unique key for this step
   * @param predicate - Function to test each item
   * @returns New pipeline with same output type
   *
   * @example
   * ```typescript
   * pipeline.skipWhile('skipNegative', n => n < 0)
   * ```
   */
  skipWhile<TKey extends string>(
    key: TKey,
    predicate: (item: TCurrentOutput, index: number) => boolean | Promise<boolean>,
  ): TKey extends keyof TAccumulatedState
    ? never
    : StreamingPipeline<TInitialInput, TCurrentOutput, AddToStreamingState<TAccumulatedState, TKey, TCurrentOutput>, TContext> {
    const transform = async function* (input: AsyncGenerator<TCurrentOutput>): AsyncGenerator<TCurrentOutput> {
      let index = 0;
      let skipping = true;

      try {
        for await (const item of input) {
          if (skipping) {
            const shouldSkip = await predicate(item, index);
            if (!shouldSkip) {
              skipping = false;
              yield item;
            }
          } else {
            yield item;
          }
          index++;
        }
      } finally {
        await input.return?.(undefined);
      }
    };

    return new StreamingPipeline(
      [...this.stages, { key, transform: transform as (input: AsyncGenerator<unknown>) => AsyncGenerator<unknown> }],
      this.contextBuilder,
      // biome-ignore lint/suspicious/noExplicitAny: TypeScript cannot infer complex conditional return type
    ) as any;
  }

  /**
   * Build and return the composed async generator function.
   *
   * This is the terminal operation that returns the executable pipeline.
   * The pipeline is lazy - it doesn't execute until the returned generator is consumed.
   *
   * @returns Function that takes initial input and returns async generator
   *
   * @example
   * ```typescript
   * const transform = pipeline.build();
   *
   * // Execute lazily
   * for await (const item of transform(inputStream)) {
   *   console.log(item);
   * }
   * ```
   */
  build(): (input: TInitialInput | AsyncGenerator<TInitialInput>) => AsyncGenerator<TCurrentOutput> {
    return (input: TInitialInput | AsyncGenerator<TInitialInput>) => {
      // Convert input to async generator if needed
      let stream: AsyncGenerator<TInitialInput>;

      // Check if input is an async generator
      if (typeof input === "object" && input !== null && Symbol.asyncIterator in input) {
        stream = input as AsyncGenerator<TInitialInput>;
      } else {
        // Wrap single item in array and convert to generator
        stream = fromArray([input as TInitialInput]);
      }

      // Compose all stages
      // biome-ignore lint/suspicious/noExplicitAny: Type erasure needed for composition
      let result = stream as AsyncGenerator<any>;
      for (const stage of this.stages) {
        result = stage.transform(result);
      }

      return result as AsyncGenerator<TCurrentOutput>;
    };
  }

  /**
   * Execute the pipeline and return results as an async generator.
   *
   * This is equivalent to `build()(input)` but more convenient.
   *
   * @param input - Initial input (single item or generator)
   * @returns Async generator of results
   *
   * @example
   * ```typescript
   * for await (const item of pipeline.execute(input)) {
   *   console.log(item);
   * }
   * ```
   */
  execute(input: TInitialInput | AsyncGenerator<TInitialInput>): AsyncGenerator<TCurrentOutput> {
    return this.build()(input);
  }

  /**
   * Execute the pipeline and collect all results into an array.
   *
   * WARNING: This materializes the entire stream in memory.
   * Use only for small datasets or when you need all results at once.
   *
   * @param input - Initial input (single item or generator)
   * @returns Promise resolving to array of all results
   *
   * @example
   * ```typescript
   * const results = await pipeline.executeToArray(input);
   * console.log(results.length);
   * ```
   */
  async executeToArray(input: TInitialInput | AsyncGenerator<TInitialInput>): Promise<TCurrentOutput[]> {
    const stream = this.execute(input);
    return toArray(stream);
  }

  /**
   * Execute the pipeline and run a side effect for each item.
   *
   * The pipeline is consumed but results are not collected.
   *
   * @param input - Initial input (single item or generator)
   * @param fn - Function to call for each item
   * @returns Promise that resolves when the stream completes
   *
   * @example
   * ```typescript
   * await pipeline.forEach(input, item => {
   *   console.log(item);
   *   saveToDatabase(item);
   * });
   * ```
   */
  async forEach(
    input: TInitialInput | AsyncGenerator<TInitialInput>,
    fn: (item: TCurrentOutput, index: number) => void | Promise<void>,
  ): Promise<void> {
    const stream = this.execute(input);
    let index = 0;

    for await (const item of stream) {
      await fn(item, index);
      index++;
    }
  }

  /**
   * Execute the pipeline and reduce results to a single value.
   *
   * Applies a reducer function to accumulate results.
   *
   * @template TResult - The type of the reduced result
   * @param input - Initial input (single item or generator)
   * @param reducer - Function to combine accumulator with each item
   * @param initial - Initial accumulator value
   * @returns Promise resolving to final reduced value
   *
   * @example
   * ```typescript
   * // Count items
   * const count = await pipeline.reduce(input, (acc) => acc + 1, 0);
   *
   * // Sum values
   * const sum = await pipeline.reduce(input, (acc, n) => acc + n, 0);
   *
   * // Collect to object
   * const byId = await pipeline.reduce(
   *   input,
   *   (acc, item) => ({ ...acc, [item.id]: item }),
   *   {}
   * );
   * ```
   */
  async reduce<TResult>(
    input: TInitialInput | AsyncGenerator<TInitialInput>,
    reducer: (accumulator: TResult, item: TCurrentOutput, index: number) => TResult | Promise<TResult>,
    initial: TResult,
  ): Promise<TResult> {
    const stream = this.execute(input);
    let accumulator = initial;
    let index = 0;

    for await (const item of stream) {
      accumulator = await reducer(accumulator, item, index);
      index++;
    }

    return accumulator;
  }
}

/**
 * Helper function to create a streaming step inline.
 *
 * Provides a convenient way to create steps without importing createStreamingStep.
 *
 * @template TInput - Input type
 * @template TOutput - Output type
 * @template TAccumulated - Accumulated state type
 * @template TContext - Context type
 * @param name - Step name
 * @param execute - Generator function
 * @param retry - Optional retry configuration
 * @returns Streaming step
 *
 * @example
 * ```typescript
 * const step = streamingStep('parse', async function* ({ input }) {
 *   for await (const text of input) {
 *     yield JSON.parse(text);
 *   }
 * });
 * ```
 */
export function streamingStep<
  TInput,
  TOutput,
  TAccumulated extends Record<string, unknown> = Record<string, never>,
  TContext = unknown,
>(
  name: string,
  execute: StreamingStepFn<TInput, TOutput, TAccumulated, TContext>,
  retry?: {
    maxAttempts: number;
    backoffMs: number;
    retryableErrors?: string[];
  },
): StreamingStep<TInput, TOutput, TAccumulated, TContext> {
  return {
    name,
    execute,
    ...(retry && { retry }),
  };
}
