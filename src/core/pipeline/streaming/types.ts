/**
 * Core streaming pipeline types enabling pull-based, demand-driven execution.
 *
 * This module defines the foundational types for async generator-based streaming pipelines
 * that support lazy evaluation, backpressure, and incremental processing.
 *
 * Key concepts:
 * 1. StreamingStep - async generator function type for processing streams
 * 2. StreamingPipeline - composable pipeline type for chaining operations
 * 3. StreamingContext - runtime context for streaming operations
 * 4. StreamResult - result type for success/error per item
 *
 * @see {@link https://github.com/jeffutter/rag3.0/blob/main/docs/architecture/streaming-pipeline-design.md}
 */

/**
 * Result type for streaming operations.
 * Can represent either a successful result or an error for a single item.
 *
 * @template T - The type of the successful result data
 *
 * @example
 * ```typescript
 * const success: StreamResult<number> = { success: true, data: 42 };
 * const failure: StreamResult<number> = {
 *   success: false,
 *   error: {
 *     code: "VALIDATION_ERROR",
 *     message: "Invalid input",
 *     retryable: false
 *   }
 * };
 * ```
 */
export type StreamResult<T> =
  | {
      success: true;
      data: T;
      metadata?: StreamItemMetadata;
    }
  | {
      success: false;
      error: StreamError;
      metadata?: StreamItemMetadata;
    };

/**
 * Metadata for individual stream items.
 * Lightweight metadata attached to each yielded item for observability.
 */
export interface StreamItemMetadata {
  /** Name of the step that produced this item */
  stepName: string;
  /** Index of this item in the stream (0-based) */
  itemIndex: number;
  /** Processing duration for this item in milliseconds */
  durationMs: number;
  /** Trace ID for distributed tracing */
  traceId?: string;
  /** Span ID for distributed tracing */
  spanId?: string;
}

/**
 * Error type for streaming operations.
 * Provides rich context about what went wrong during stream processing.
 */
export interface StreamError {
  /** Error code for programmatic handling */
  code: string;
  /** Human-readable error message */
  message: string;
  /** Name of the step where the error occurred */
  stepName: string;
  /** Index of the item that caused the error (if applicable) */
  itemIndex?: number;
  /** Whether the operation can be retried */
  retryable: boolean;
  /** Original error that caused this error */
  cause?: unknown;
  /** Trace ID for distributed tracing */
  traceId: string;
  /** Span ID for distributed tracing */
  spanId: string;
}

/**
 * State management interface for streaming pipelines.
 * Provides access to both streaming data and materialized snapshots.
 *
 * @template TAccumulated - Object type containing accumulated state from previous steps
 *
 * @example
 * ```typescript
 * async function* myStep({ input, state }: StreamingStepContext<number, { prev: string }>) {
 *   // Access snapshot (if checkpoint exists)
 *   if (state.hasSnapshot("prev")) {
 *     const prevData = state.accumulated.prev;
 *     console.log("Previous data:", prevData);
 *   }
 *
 *   // Stream from previous step (no materialization)
 *   const prevStream = state.stream("prev");
 *   for await (const item of prevStream) {
 *     // Process streaming data
 *   }
 *
 *   // Or materialize if needed
 *   const prevArray = await state.materialize("prev");
 * }
 * ```
 */
export interface StreamingState<TAccumulated extends Record<string, unknown>> {
  /**
   * Snapshot of accumulated state (lazy-loaded).
   * Only available for steps after checkpoints.
   */
  accumulated: TAccumulated;

  /**
   * Access a previous step's output as a stream.
   * This does not materialize the entire stream into memory.
   *
   * @param key - The step name to access
   * @returns Async generator of items from that step
   */
  stream<K extends keyof TAccumulated>(key: K): AsyncGenerator<TAccumulated[K]>;

  /**
   * Materialize a previous step's stream into an array.
   * Use sparingly as this loads the entire stream into memory.
   *
   * @param key - The step name to materialize
   * @returns Promise resolving to array of all items from that step
   */
  materialize<K extends keyof TAccumulated>(key: K): Promise<Array<TAccumulated[K]>>;

  /**
   * Check if a key has a snapshot available.
   * Snapshots are created at checkpoints.
   *
   * @param key - The step name to check
   * @returns True if snapshot exists, false otherwise
   */
  hasSnapshot(key: keyof TAccumulated): boolean;
}

/**
 * Execution context for streaming steps.
 * Provides access to input stream, accumulated state, and runtime context.
 *
 * @template TInput - Type of items in the input stream
 * @template TAccumulated - Object type containing accumulated state from previous steps
 * @template TContext - Type of additional runtime context
 *
 * @example
 * ```typescript
 * async function* processNumbers({
 *   input,
 *   state,
 *   context
 * }: StreamingStepContext<number, {}, AppContext>) {
 *   for await (const num of input) {
 *     yield num * 2;
 *   }
 * }
 * ```
 */
export interface StreamingStepContext<TInput, TAccumulated extends Record<string, unknown>, TContext = unknown> {
  /** Input stream of items to process */
  input: AsyncGenerator<TInput>;
  /** State access (streaming + snapshots) */
  state: StreamingState<TAccumulated>;
  /** Additional runtime context */
  context: TContext;
}

/**
 * Streaming step function type.
 * An async generator function that processes a stream of inputs and yields outputs.
 *
 * @template TInput - Type of items in the input stream
 * @template TOutput - Type of items yielded by this step
 * @template TAccumulated - Object type containing accumulated state from previous steps
 * @template TContext - Type of additional runtime context
 *
 * @example
 * ```typescript
 * const doubleNumbers: StreamingStepFn<number, number> = async function* ({ input }) {
 *   for await (const num of input) {
 *     yield num * 2;
 *   }
 * };
 * ```
 */
export type StreamingStepFn<
  TInput,
  TOutput,
  TAccumulated extends Record<string, unknown> = Record<string, never>,
  TContext = unknown,
> = (ctx: StreamingStepContext<TInput, TAccumulated, TContext>) => AsyncGenerator<TOutput>;

/**
 * Streaming step interface.
 * Encapsulates an async generator function with metadata and retry configuration.
 *
 * @template TInput - Type of items in the input stream
 * @template TOutput - Type of items yielded by this step
 * @template TAccumulated - Object type containing accumulated state from previous steps
 * @template TContext - Type of additional runtime context
 *
 * @example
 * ```typescript
 * const step: StreamingStep<number, string> = {
 *   name: "toString",
 *   execute: async function* ({ input }) {
 *     for await (const num of input) {
 *       yield String(num);
 *     }
 *   },
 *   retry: {
 *     maxAttempts: 3,
 *     backoffMs: 1000,
 *     retryableErrors: ["ETIMEDOUT"]
 *   }
 * };
 * ```
 */
export interface StreamingStep<
  TInput,
  TOutput,
  TAccumulated extends Record<string, unknown> = Record<string, never>,
  TContext = unknown,
> {
  /** Name of this step (for observability and state accumulation) */
  name: string;

  /** Generator-based execution function */
  execute: StreamingStepFn<TInput, TOutput, TAccumulated, TContext>;

  /** Optional retry configuration for resilient execution */
  retry?: {
    /** Maximum number of retry attempts */
    maxAttempts: number;
    /** Initial backoff delay in milliseconds (uses exponential backoff) */
    backoffMs: number;
    /** Optional array of error codes that should trigger retries */
    retryableErrors?: string[];
  };
}

/**
 * Composable streaming pipeline type.
 * Represents a chain of streaming steps that can be composed and executed.
 *
 * @template TInitialInput - Type of the initial input to the pipeline
 * @template TCurrentOutput - Type of the current output after all steps
 * @template TAccumulated - Object type containing accumulated state from all steps
 * @template TContext - Type of additional runtime context
 *
 * Note: This is a placeholder type. The actual StreamingPipeline class
 * will be implemented in future tasks.
 */
export interface StreamingPipeline<
  TInitialInput,
  TCurrentOutput,
  _TAccumulated extends Record<string, unknown>,
  _TContext = unknown,
> {
  /** Execute the pipeline and return an async generator of results */
  execute(input: TInitialInput): AsyncGenerator<TCurrentOutput>;

  /** Execute the pipeline and collect all results into an array */
  executeToArray(input: TInitialInput): Promise<TCurrentOutput[]>;
}

// Type extraction utilities

/**
 * Extract the input type from a StreamingStep
 */
// biome-ignore lint/suspicious/noExplicitAny: Type utility requires any for proper type inference
export type StreamingStepInput<S> = S extends StreamingStep<infer I, any, any, any> ? I : never;

/**
 * Extract the output type from a StreamingStep
 */
// biome-ignore lint/suspicious/noExplicitAny: Type utility requires any for proper type inference
export type StreamingStepOutput<S> = S extends StreamingStep<any, infer O, any, any> ? O : never;

/**
 * Extract the accumulated state type from a StreamingStep
 */
export type StreamingStepAccumulated<S> =
  // biome-ignore lint/suspicious/noExplicitAny: Type utility requires any for proper type inference
  S extends StreamingStep<any, any, infer A, any> ? A : never;

/**
 * Helper to merge accumulated state with a new step's output
 */
export type AddToState<TState, TKey extends string, TValue> = TState & Record<TKey, TValue>;

/**
 * Helper to check if a key already exists in the accumulated state
 */
export type KeyExists<TState, TKey extends string> = TKey extends keyof TState ? true : false;

/**
 * Helper to validate a new key doesn't exist (prevents duplicate step names)
 */
export type ValidateNewKey<TState, TKey extends string> = KeyExists<TState, TKey> extends true ? never : TKey;
