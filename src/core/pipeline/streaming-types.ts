/**
 * Type definitions for streaming pipeline architecture.
 *
 * This module defines the core types for async generator-based streaming pipelines
 * that enable pull-based, demand-driven execution with lazy evaluation and backpressure.
 *
 * Key features:
 * - Streaming state with checkpoint/snapshot support
 * - Per-item and aggregated state access patterns
 * - Type-safe state accumulation through generator chain
 * - Lazy materialization of state when needed
 *
 * @see {@link https://github.com/jeffutter/rag3.0/blob/main/docs/architecture/streaming-pipeline-design.md}
 */

import type { StepMetadata } from "./types";

/**
 * Streaming state interface providing access to accumulated state.
 *
 * Supports hybrid state management:
 * - Streaming: Current item flows through async generators
 * - Snapshots: Accumulated state captured at checkpoints
 * - Lazy: State materialized only when accessed
 *
 * @template TAccumulated - Object containing all previous step outputs by name
 */
export interface StreamingState<
  // biome-ignore lint/suspicious/noExplicitAny: Generic constraint requires any to allow flexible accumulated state types
  TAccumulated extends Record<string, any>,
> {
  /**
   * Access snapshot state (lazy-loaded from checkpoints).
   * Only available for steps that have been checkpointed.
   */
  readonly accumulated: TAccumulated;

  /**
   * Access a previous step's output as an async generator stream.
   * Allows streaming access without materializing the entire result.
   *
   * @param key - The key of the step to access
   * @returns Async generator yielding items from that step
   */
  stream<K extends keyof TAccumulated>(key: K): AsyncGenerator<TAccumulated[K]>;

  /**
   * Force materialization of a stream to an array.
   * Use sparingly as this loads entire stream into memory.
   *
   * @param key - The key of the step to materialize
   * @returns Promise resolving to array of all items
   */
  materialize<K extends keyof TAccumulated>(key: K): Promise<Array<TAccumulated[K]>>;

  /**
   * Check if a key has a snapshot available.
   * Returns true if the step has been checkpointed.
   *
   * @param key - The key to check
   */
  hasSnapshot(key: keyof TAccumulated): boolean;
}

/**
 * Execution context for streaming steps.
 *
 * @template TInput - The input type (as async generator)
 * @template TAccumulated - Accumulated state from previous steps
 * @template TContext - Runtime context
 */
export interface StreamingStepContext<
  TInput,
  // biome-ignore lint/suspicious/noExplicitAny: Generic constraint requires any to allow flexible accumulated state types
  TAccumulated extends Record<string, any>,
  TContext = unknown,
> {
  /**
   * Input stream from previous step.
   * Iterate over this to process items.
   */
  readonly input: AsyncGenerator<TInput>;

  /**
   * State access for previous steps.
   * Supports both snapshot and streaming access.
   */
  readonly state: StreamingState<TAccumulated>;

  /**
   * Runtime context (same as batch Pipeline).
   */
  readonly context: TContext;
}

/**
 * Result of a streaming step (with optional metadata).
 *
 * @template T - The data type
 */
export interface StreamingStepResult<T> {
  /** The actual data */
  readonly data: T;

  /** Optional metadata for observability */
  readonly metadata?: {
    readonly durationMs: number;
    readonly stepName: string;
    readonly itemIndex: number;
  };
}

/**
 * Streaming step interface - the building block of streaming pipelines.
 *
 * Steps execute as async generators, yielding results incrementally.
 *
 * @template TInput - The input type (element type, not generator)
 * @template TOutput - The output type (element type, not generator)
 * @template TAccumulated - Accumulated state from previous steps
 * @template TContext - Runtime context
 */
export interface StreamingStep<
  TInput,
  TOutput,
  // biome-ignore lint/suspicious/noExplicitAny: Generic constraint requires any to allow flexible accumulated state types
  TAccumulated extends Record<string, any> = Record<string, never>,
  TContext = unknown,
> {
  /** Step name for logging and debugging */
  readonly name: string;

  /**
   * Execute the step as an async generator.
   * Yields output items as they are produced.
   *
   * @param ctx - Execution context with input stream, state, and context
   * @returns Async generator yielding output items
   */
  execute(ctx: StreamingStepContext<TInput, TAccumulated, TContext>): AsyncGenerator<TOutput>;

  /**
   * Optional retry configuration.
   * Applied at the item level during execution.
   */
  readonly retry?: {
    maxAttempts: number;
    backoffMs: number;
    retryableErrors?: string[];
  };
}

/**
 * Error handling strategies for streaming operations.
 */
export enum StreamingErrorStrategy {
  /** Stop on first error (default) */
  FAIL_FAST = "FAIL_FAST",

  /** Skip failed items, continue processing */
  SKIP_FAILED = "SKIP_FAILED",

  /** Collect errors but continue, return both successes and failures */
  COLLECT_ERRORS = "COLLECT_ERRORS",

  /** Emit error items to separate error stream */
  SPLIT_ERRORS = "SPLIT_ERRORS",
}

/**
 * Error type for streaming operations.
 */
export interface StreamingError extends Error {
  code: string;
  stepName: string;
  itemIndex?: number;
  retryable: boolean;
  cause?: unknown;
  traceId: string;
  spanId: string;
}

/**
 * Options for streaming operations.
 */
export interface StreamingOptions {
  /** Enable parallel processing (default: false) */
  parallel?: boolean;

  /** Concurrency limit for parallel execution (default: 10) */
  concurrencyLimit?: number;

  /** Error handling strategy (default: FAIL_FAST) */
  errorStrategy?: StreamingErrorStrategy;
}

/**
 * Metadata for streaming operations.
 */
export interface StreamingMetadata extends StepMetadata {
  /** Timing statistics (lazy aggregation) */
  timing?: {
    itemCount: number;
    sampledCount: number;
    avgDurationMs: number;
    p50DurationMs?: number;
    p95DurationMs?: number;
    p99DurationMs?: number;
  };

  /** Error statistics */
  errorCount: number;
  errors?: StreamingError[];

  /** Execution mode */
  executionMode: "streaming" | "parallel-streaming" | "batch";
}

// Type utilities for streaming pipelines

/**
 * Extract input type from a streaming step.
 */
export type StreamingStepInput<S> =
  // biome-ignore lint/suspicious/noExplicitAny: Using any in conditional type to match any type parameter
  S extends StreamingStep<infer I, any, any, any> ? I : never;

/**
 * Extract output type from a streaming step.
 */
export type StreamingStepOutput<S> =
  // biome-ignore lint/suspicious/noExplicitAny: Using any in conditional type to match any type parameter
  S extends StreamingStep<any, infer O, any, any> ? O : never;

/**
 * Extract accumulated state type from a streaming step.
 */
export type StreamingStepAccumulated<S> =
  // biome-ignore lint/suspicious/noExplicitAny: Using any in conditional type to match any type parameter
  S extends StreamingStep<any, any, infer A, any> ? A : never;

/**
 * Helper to merge accumulated state with a new step's output.
 * Same as batch Pipeline to maintain consistency.
 */
export type AddToStreamingState<TState, TKey extends string, TValue> = TState & Record<TKey, TValue>;

/**
 * Validate a new key doesn't exist in state (compile-time check).
 */
export type ValidateNewStreamingKey<TState, TKey extends string> = TKey extends keyof TState ? never : TKey;

/**
 * Checkpoint configuration.
 */
export interface CheckpointConfig {
  /** Checkpoint key (for accessing snapshot) */
  key: string;

  /** Whether to materialize the stream (default: true) */
  materialize?: boolean;
}
