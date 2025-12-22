/**
 * Type definitions for list operations in pipelines.
 *
 * This module extends the pipeline type system to support array transformations
 * while maintaining full type safety and state tracking.
 *
 * Key capabilities:
 * - Extract element types from arrays
 * - Detect array types at compile-time
 * - Define list-aware step types
 * - Transform between single items and arrays
 * - Track list state through pipeline execution
 */

import type { AddToState as BaseAddToState, Step } from "./types";

/**
 * Utility type to extract the element type from an array.
 *
 * @example
 * type StringArray = string[];
 * type Element = ArrayElement<StringArray>; // string
 *
 * type NumberArray = number[];
 * type Element = ArrayElement<NumberArray>; // number
 */
export type ArrayElement<T> = T extends (infer U)[] ? U : never;

/**
 * Type predicate to check if a type is an array at compile-time.
 *
 * @example
 * type IsStringArray = IsArray<string[]>; // true
 * type IsString = IsArray<string>; // false
 */
export type IsArray<T> = T extends unknown[] ? true : false;

/**
 * List-aware step that operates on arrays.
 *
 * A ListStep processes an array input and produces an array output,
 * while maintaining access to accumulated state from previous steps.
 *
 * @template TInput - Element type of the input array
 * @template TOutput - Element type of the output array
 * @template TAccumulatedState - Object containing all previous step outputs
 * @template TContext - Additional runtime context
 */
export type ListStep<TInput, TOutput, TAccumulatedState = Record<string, never>, TContext = unknown> = Step<
  TInput[],
  TOutput[],
  TAccumulatedState,
  TContext
>;

/**
 * Computes the output type when mapping a step over an array.
 */
export type MapStepOutput<TStep, TInput> = TInput extends unknown[]
  ? TStep extends Step<ArrayElement<TInput>, infer O, infer _S, infer _C>
    ? O[]
    : never
  : never;

/**
 * Transform type for converting a single-item step to operate on arrays.
 */
export type SingleToListTransform<TStep> =
  TStep extends Step<infer I, infer O, infer S, infer C> ? Step<I[], O[], S, C> : never;

/**
 * Transform type for steps that return arrays and need flattening.
 */
export type FlatMapTransform<TStep> =
  TStep extends Step<infer I, infer O, infer S, infer C> ? (O extends unknown[] ? Step<I[], O, S, C> : never) : never;

/**
 * Transform type for batching operations.
 */
export type BatchTransform<T> = T extends (infer U)[] ? U[][] : never;

/**
 * Transform type for flattening nested arrays.
 */
export type FlattenTransform<T> = T extends (infer U)[][] ? U[] : never;

/**
 * Extended AddToState that correctly handles array types in accumulated state.
 */
export type AddToState<TState, TKey extends string, TValue> = BaseAddToState<TState, TKey, TValue>;

/**
 * Helper type to validate that a step's input type matches an array element type.
 */
export type ValidateMapInput<TStep, TArray> = TArray extends unknown[]
  ? TStep extends Step<ArrayElement<TArray>, unknown, unknown, unknown>
    ? true
    : false
  : false;
