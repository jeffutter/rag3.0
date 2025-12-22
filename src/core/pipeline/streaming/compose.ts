/**
 * Composition utilities for async generators.
 *
 * This module provides type-safe composition functions for chaining async generators.
 * It supports both pipe (left-to-right) and compose (right-to-left) composition
 * with full TypeScript type inference.
 *
 * @module compose
 */

/**
 * Generator transformation function type.
 * Takes an async generator and returns a transformed async generator.
 */
export type GeneratorFn<TIn, TOut> = (input: AsyncGenerator<TIn>) => AsyncGenerator<TOut>;

/**
 * Compose async generator functions from left to right (pipe).
 * Each function's output becomes the input to the next function.
 *
 * @param fns - Variable number of generator transformation functions
 * @returns A function that applies all transformations in sequence
 *
 * @example
 * ```typescript
 * const double = (stream: AsyncGenerator<number>) => map(stream, n => n * 2);
 * const addOne = (stream: AsyncGenerator<number>) => map(stream, n => n + 1);
 *
 * const transform = pipe(double, addOne);
 * const input = fromArray([1, 2, 3]);
 * const output = transform(input);
 * const result = await toArray(output);
 * console.log(result); // [3, 5, 7] (doubled then added 1)
 * ```
 */
export function pipe<T1>(fn1: GeneratorFn<T1, T1>): GeneratorFn<T1, T1>;
export function pipe<T1, T2>(fn1: GeneratorFn<T1, T2>): GeneratorFn<T1, T2>;
export function pipe<T1, T2, T3>(fn1: GeneratorFn<T1, T2>, fn2: GeneratorFn<T2, T3>): GeneratorFn<T1, T3>;
export function pipe<T1, T2, T3, T4>(
  fn1: GeneratorFn<T1, T2>,
  fn2: GeneratorFn<T2, T3>,
  fn3: GeneratorFn<T3, T4>,
): GeneratorFn<T1, T4>;
export function pipe<T1, T2, T3, T4, T5>(
  fn1: GeneratorFn<T1, T2>,
  fn2: GeneratorFn<T2, T3>,
  fn3: GeneratorFn<T3, T4>,
  fn4: GeneratorFn<T4, T5>,
): GeneratorFn<T1, T5>;
export function pipe<T1, T2, T3, T4, T5, T6>(
  fn1: GeneratorFn<T1, T2>,
  fn2: GeneratorFn<T2, T3>,
  fn3: GeneratorFn<T3, T4>,
  fn4: GeneratorFn<T4, T5>,
  fn5: GeneratorFn<T5, T6>,
): GeneratorFn<T1, T6>;
export function pipe<T1, T2, T3, T4, T5, T6, T7>(
  fn1: GeneratorFn<T1, T2>,
  fn2: GeneratorFn<T2, T3>,
  fn3: GeneratorFn<T3, T4>,
  fn4: GeneratorFn<T4, T5>,
  fn5: GeneratorFn<T5, T6>,
  fn6: GeneratorFn<T6, T7>,
): GeneratorFn<T1, T7>;
export function pipe<T1, T2, T3, T4, T5, T6, T7, T8>(
  fn1: GeneratorFn<T1, T2>,
  fn2: GeneratorFn<T2, T3>,
  fn3: GeneratorFn<T3, T4>,
  fn4: GeneratorFn<T4, T5>,
  fn5: GeneratorFn<T5, T6>,
  fn6: GeneratorFn<T6, T7>,
  fn7: GeneratorFn<T7, T8>,
): GeneratorFn<T1, T8>;
export function pipe<T1, T2, T3, T4, T5, T6, T7, T8, T9>(
  fn1: GeneratorFn<T1, T2>,
  fn2: GeneratorFn<T2, T3>,
  fn3: GeneratorFn<T3, T4>,
  fn4: GeneratorFn<T4, T5>,
  fn5: GeneratorFn<T5, T6>,
  fn6: GeneratorFn<T6, T7>,
  fn7: GeneratorFn<T7, T8>,
  fn8: GeneratorFn<T8, T9>,
): GeneratorFn<T1, T9>;
export function pipe<T1, T2, T3, T4, T5, T6, T7, T8, T9, T10>(
  fn1: GeneratorFn<T1, T2>,
  fn2: GeneratorFn<T2, T3>,
  fn3: GeneratorFn<T3, T4>,
  fn4: GeneratorFn<T4, T5>,
  fn5: GeneratorFn<T5, T6>,
  fn6: GeneratorFn<T6, T7>,
  fn7: GeneratorFn<T7, T8>,
  fn8: GeneratorFn<T8, T9>,
  fn9: GeneratorFn<T9, T10>,
): GeneratorFn<T1, T10>;

// Implementation
// biome-ignore lint/suspicious/noExplicitAny: Implementation needs to accept any number of functions
export function pipe(...fns: GeneratorFn<any, any>[]): GeneratorFn<any, any> {
  if (fns.length === 0) {
    throw new Error("pipe requires at least one function");
  }

  if (fns.length === 1) {
    // biome-ignore lint/style/noNonNullAssertion: We know fns[0] exists because length === 1
    return fns[0]!;
  }

  // biome-ignore lint/suspicious/noExplicitAny: Implementation needs to work with any types
  return (input: AsyncGenerator<any>) => {
    let result = input;
    for (const fn of fns) {
      result = fn(result);
    }
    return result;
  };
}

/**
 * Compose async generator functions from right to left.
 * Each function's input comes from the next function's output.
 * This is the mathematical composition order: (f ∘ g)(x) = f(g(x))
 *
 * @param fns - Variable number of generator transformation functions
 * @returns A function that applies all transformations in reverse sequence
 *
 * @example
 * ```typescript
 * const double = (stream: AsyncGenerator<number>) => map(stream, n => n * 2);
 * const addOne = (stream: AsyncGenerator<number>) => map(stream, n => n + 1);
 *
 * const transform = compose(addOne, double);
 * const input = fromArray([1, 2, 3]);
 * const output = transform(input);
 * const result = await toArray(output);
 * console.log(result); // [3, 5, 7] (doubled then added 1)
 * ```
 */
export function compose<T1>(fn1: GeneratorFn<T1, T1>): GeneratorFn<T1, T1>;
export function compose<T1, T2>(fn1: GeneratorFn<T1, T2>): GeneratorFn<T1, T2>;
export function compose<T1, T2, T3>(fn2: GeneratorFn<T2, T3>, fn1: GeneratorFn<T1, T2>): GeneratorFn<T1, T3>;
export function compose<T1, T2, T3, T4>(
  fn3: GeneratorFn<T3, T4>,
  fn2: GeneratorFn<T2, T3>,
  fn1: GeneratorFn<T1, T2>,
): GeneratorFn<T1, T4>;
export function compose<T1, T2, T3, T4, T5>(
  fn4: GeneratorFn<T4, T5>,
  fn3: GeneratorFn<T3, T4>,
  fn2: GeneratorFn<T2, T3>,
  fn1: GeneratorFn<T1, T2>,
): GeneratorFn<T1, T5>;
export function compose<T1, T2, T3, T4, T5, T6>(
  fn5: GeneratorFn<T5, T6>,
  fn4: GeneratorFn<T4, T5>,
  fn3: GeneratorFn<T3, T4>,
  fn2: GeneratorFn<T2, T3>,
  fn1: GeneratorFn<T1, T2>,
): GeneratorFn<T1, T6>;
export function compose<T1, T2, T3, T4, T5, T6, T7>(
  fn6: GeneratorFn<T6, T7>,
  fn5: GeneratorFn<T5, T6>,
  fn4: GeneratorFn<T4, T5>,
  fn3: GeneratorFn<T3, T4>,
  fn2: GeneratorFn<T2, T3>,
  fn1: GeneratorFn<T1, T2>,
): GeneratorFn<T1, T7>;
export function compose<T1, T2, T3, T4, T5, T6, T7, T8>(
  fn7: GeneratorFn<T7, T8>,
  fn6: GeneratorFn<T6, T7>,
  fn5: GeneratorFn<T5, T6>,
  fn4: GeneratorFn<T4, T5>,
  fn3: GeneratorFn<T3, T4>,
  fn2: GeneratorFn<T2, T3>,
  fn1: GeneratorFn<T1, T2>,
): GeneratorFn<T1, T8>;
export function compose<T1, T2, T3, T4, T5, T6, T7, T8, T9>(
  fn8: GeneratorFn<T8, T9>,
  fn7: GeneratorFn<T7, T8>,
  fn6: GeneratorFn<T6, T7>,
  fn5: GeneratorFn<T5, T6>,
  fn4: GeneratorFn<T4, T5>,
  fn3: GeneratorFn<T3, T4>,
  fn2: GeneratorFn<T2, T3>,
  fn1: GeneratorFn<T1, T2>,
): GeneratorFn<T1, T9>;
export function compose<T1, T2, T3, T4, T5, T6, T7, T8, T9, T10>(
  fn9: GeneratorFn<T9, T10>,
  fn8: GeneratorFn<T8, T9>,
  fn7: GeneratorFn<T7, T8>,
  fn6: GeneratorFn<T6, T7>,
  fn5: GeneratorFn<T5, T6>,
  fn4: GeneratorFn<T4, T5>,
  fn3: GeneratorFn<T3, T4>,
  fn2: GeneratorFn<T2, T3>,
  fn1: GeneratorFn<T1, T2>,
): GeneratorFn<T1, T10>;

// Implementation
// biome-ignore lint/suspicious/noExplicitAny: Implementation needs to accept any number of functions
export function compose(...fns: GeneratorFn<any, any>[]): GeneratorFn<any, any> {
  if (fns.length === 0) {
    throw new Error("compose requires at least one function");
  }

  if (fns.length === 1) {
    // biome-ignore lint/style/noNonNullAssertion: We know fns[0] exists because length === 1
    return fns[0]!;
  }

  // Reverse the order and apply manually (avoid spread issue with reverse)
  // biome-ignore lint/suspicious/noExplicitAny: Implementation needs to work with any types
  return (input: AsyncGenerator<any>) => {
    let result = input;
    // Apply functions in reverse order (right to left)
    for (let i = fns.length - 1; i >= 0; i--) {
      // biome-ignore lint/style/noNonNullAssertion: We know fns[i] exists because of loop bounds
      result = fns[i]!(result);
    }
    return result;
  };
}

/**
 * Create a generator function from a synchronous transformation function.
 * Useful for lifting regular functions into the generator composition context.
 *
 * @template TIn - Input type
 * @template TOut - Output type
 * @param fn - Synchronous or asynchronous transformation function
 * @returns Generator function that applies the transformation to each item
 *
 * @example
 * ```typescript
 * const double = lift((n: number) => n * 2);
 * const input = fromArray([1, 2, 3]);
 * const output = double(input);
 * const result = await toArray(output);
 * console.log(result); // [2, 4, 6]
 * ```
 */
export function lift<TIn, TOut>(fn: (item: TIn) => TOut | Promise<TOut>): GeneratorFn<TIn, TOut> {
  return async function* (input: AsyncGenerator<TIn>): AsyncGenerator<TOut> {
    try {
      for await (const item of input) {
        yield await fn(item);
      }
    } finally {
      // Cleanup: ensure the source stream is properly closed
      await input.return?.(undefined);
    }
  };
}

/**
 * Create a generator function from a filter predicate.
 * Useful for lifting filter predicates into the generator composition context.
 *
 * @template T - Item type
 * @param predicate - Function that returns true for items to keep
 * @returns Generator function that filters items based on the predicate
 *
 * @example
 * ```typescript
 * const evens = liftFilter((n: number) => n % 2 === 0);
 * const input = fromArray([1, 2, 3, 4, 5]);
 * const output = evens(input);
 * const result = await toArray(output);
 * console.log(result); // [2, 4]
 * ```
 */
export function liftFilter<T>(predicate: (item: T) => boolean | Promise<boolean>): GeneratorFn<T, T> {
  return async function* (input: AsyncGenerator<T>): AsyncGenerator<T> {
    try {
      for await (const item of input) {
        const shouldKeep = await predicate(item);
        if (shouldKeep) {
          yield item;
        }
      }
    } finally {
      // Cleanup: ensure the source stream is properly closed
      await input.return?.(undefined);
    }
  };
}

/**
 * Create a generator function from a flat map transformation.
 * Useful for lifting flat map operations into the generator composition context.
 *
 * @template TIn - Input type
 * @template TOut - Output type
 * @param fn - Function that returns an array or iterable of outputs for each input
 * @returns Generator function that applies the flat map transformation
 *
 * @example
 * ```typescript
 * const splitWords = liftFlatMap((line: string) => line.split(" "));
 * const input = fromArray(["hello world", "foo bar"]);
 * const output = splitWords(input);
 * const result = await toArray(output);
 * console.log(result); // ["hello", "world", "foo", "bar"]
 * ```
 */
export function liftFlatMap<TIn, TOut>(
  fn: (item: TIn) => TOut[] | Promise<TOut[]> | AsyncIterable<TOut>,
): GeneratorFn<TIn, TOut> {
  return async function* (input: AsyncGenerator<TIn>): AsyncGenerator<TOut> {
    try {
      for await (const item of input) {
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
      await input.return?.(undefined);
    }
  };
}

/**
 * Identity function - returns the input unchanged.
 * Useful as a no-op in composition chains or as a default.
 *
 * @template T - Type of items in the stream
 * @returns Generator function that yields all items unchanged
 *
 * @example
 * ```typescript
 * const transform = someCondition ? processItems : identity();
 * const output = transform(input);
 * ```
 */
export function identity<T>(): GeneratorFn<T, T> {
  return async function* (input: AsyncGenerator<T>): AsyncGenerator<T> {
    try {
      for await (const item of input) {
        yield item;
      }
    } finally {
      // Cleanup: ensure the source stream is properly closed
      await input.return?.(undefined);
    }
  };
}
