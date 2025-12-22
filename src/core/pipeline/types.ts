/**
 * Core pipeline types enabling compile-time type safety for workflow composition.
 *
 * Key insights:
 * 1. Each step's input type matches the previous step's output type
 * 2. Steps can access outputs from ANY previous step via accumulated state
 * 3. TypeScript validates at compile-time that referenced steps exist
 * 4. Type-safe tool definitions
 */

// Base result type for all pipeline steps
export type StepResult<T> =
  | {
      success: true;
      data: T;
      metadata: StepMetadata;
    }
  | {
      success: false;
      error: StepError;
      metadata: StepMetadata;
    };

export interface StepMetadata {
  stepName: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  traceId?: string;
  spanId?: string;
  // List operation metadata (optional)
  listMetadata?: ListOperationMetadata;
}

export interface ListOperationMetadata {
  totalItems: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  // Per-item timing statistics
  itemTimings?: {
    min: number;
    max: number;
    avg: number;
    p50: number;
    p95: number;
    p99: number;
  };
  // Execution strategy used
  executionStrategy: "sequential" | "parallel";
  // Concurrency limit (for parallel execution)
  concurrencyLimit?: number;
}

export interface StepError {
  code: string;
  message: string;
  cause?: unknown;
  retryable: boolean;
}

/**
 * Step execution context containing:
 * - input: The direct output from the previous step
 * - state: Accumulated outputs from ALL previous steps (by name)
 * - context: Additional runtime context
 */
export interface StepExecutionContext<TInput, TAccumulatedState, TContext = unknown> {
  input: TInput;
  state: TAccumulatedState;
  context: TContext;
}

/**
 * Step definition - the building block of pipelines.
 *
 * @template TInput - The direct input type (output of previous step)
 * @template TOutput - The output type of this step
 * @template TAccumulatedState - Object containing all previous step outputs
 * @template TContext - Additional runtime context
 */
export interface Step<TInput, TOutput, TAccumulatedState = Record<string, never>, TContext = unknown> {
  name: string;
  execute: (ctx: StepExecutionContext<TInput, TAccumulatedState, TContext>) => Promise<StepResult<TOutput>>;
  // Optional retry configuration
  retry?: {
    maxAttempts: number;
    backoffMs: number;
    retryableErrors?: string[];
  };
}

// Extracts the output type from a step
// biome-ignore lint/suspicious/noExplicitAny: Type utility requires any for proper type inference
export type StepOutput<S> = S extends Step<any, infer O, any, any> ? O : never;

// Extracts the input type from a step
// biome-ignore lint/suspicious/noExplicitAny: Type utility requires any for proper type inference
export type StepInput<S> = S extends Step<infer I, any, any, any> ? I : never;

// Extracts the accumulated state type from a step
export type StepAccumulatedState<S> =
  // biome-ignore lint/suspicious/noExplicitAny: Type utility requires any for proper type inference
  S extends Step<any, any, infer A, any> ? A : never;

// Helper to merge accumulated state with a new step's output
export type AddToState<TState, TKey extends string, TValue> = TState & Record<TKey, TValue>;

// Helper to check if a key already exists in the accumulated state
// This prevents duplicate step names at compile time
export type KeyExists<TState, TKey extends string> = TKey extends keyof TState ? true : false;

// Helper to validate a new key doesn't exist
export type ValidateNewKey<TState, TKey extends string> = KeyExists<TState, TKey> extends true ? never : TKey;
