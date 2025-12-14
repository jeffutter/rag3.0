/**
 * Core pipeline types enabling compile-time type safety for workflow composition.
 *
 * Key insight: We use TypeScript's type inference to ensure that:
 * 1. Each step's input type matches the previous step's output type
 * 2. Required context is accumulated and validated at compile time
 * 3. Tool definitions are type-safe
 */

// Base result type for all pipeline steps
export type StepResult<T> = {
  success: true;
  data: T;
  metadata: StepMetadata;
} | {
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
}

export interface StepError {
  code: string;
  message: string;
  cause?: unknown;
  retryable: boolean;
}

// Step definition - the building block of pipelines
export interface Step<TInput, TOutput, TContext = unknown> {
  name: string;
  execute: (input: TInput, context: TContext) => Promise<StepResult<TOutput>>;
  // Optional retry configuration
  retry?: {
    maxAttempts: number;
    backoffMs: number;
    retryableErrors?: string[];
  };
}

// Pipeline builder types for compile-time safety
export type PipelineStep<TIn, TOut, TCtx> = {
  step: Step<TIn, TOut, TCtx>;
  inputType: TIn;
  outputType: TOut;
};

// Extracts the output type from a step
export type StepOutput<S> = S extends Step<any, infer O, any> ? O : never;

// Extracts the input type from a step
export type StepInput<S> = S extends Step<infer I, any, any> ? I : never;

// Context accumulator type
export type MergeContext<A, B> = A & B;
