/**
 * List adapter utilities for converting between single-item and list-based steps.
 *
 * This module provides:
 * - Adapter functions to convert single-item steps to list steps
 * - Helper functions for common list operations
 * - Error handling strategies for list processing
 * - Partial success result types
 * - Parallel execution with concurrency control
 */

import type { ListStep } from "./list-types";
import type {
	ListOperationMetadata,
	Step,
	StepError,
	StepExecutionContext,
	StepResult,
} from "./types";

/**
 * Error handling strategy for list operations.
 *
 * - FAIL_FAST: Stop on first error and return failure
 * - COLLECT_ERRORS: Continue processing, collect all errors
 * - SKIP_FAILED: Skip failed items, return only successful results
 */
export enum ListErrorStrategy {
	FAIL_FAST = "FAIL_FAST",
	COLLECT_ERRORS = "COLLECT_ERRORS",
	SKIP_FAILED = "SKIP_FAILED",
}

/**
 * Result type for partial list processing.
 * Contains both successful items and errors.
 */
export interface PartialListResult<T, E = StepError> {
	/** Successfully processed items with their original indices */
	successes: Array<{ index: number; data: T }>;
	/** Failed items with their original indices and errors */
	failures: Array<{ index: number; error: E }>;
	/** Total number of items processed */
	total: number;
}

/**
 * Options for singleToList adapter.
 */
export interface SingleToListOptions {
	/** Error handling strategy (default: FAIL_FAST) */
	errorStrategy?: ListErrorStrategy;
	/** Whether to execute in parallel (default: false) */
	parallel?: boolean;
	/** Maximum number of concurrent executions (default: 10, only applies when parallel=true) */
	concurrencyLimit?: number;
}

/**
 * Helper to calculate percentile from sorted array of numbers.
 */
function percentile(sortedArray: number[], p: number): number {
	if (sortedArray.length === 0) return 0;
	const index = Math.ceil((p / 100) * sortedArray.length) - 1;
	return sortedArray[Math.max(0, index)] ?? 0;
}

/**
 * Helper to calculate timing statistics from an array of durations.
 */
function calculateTimingStats(durations: number[]): {
	min: number;
	max: number;
	avg: number;
	p50: number;
	p95: number;
	p99: number;
} {
	if (durations.length === 0) {
		return { min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0 };
	}

	const sorted = [...durations].sort((a, b) => a - b);
	const sum = durations.reduce((acc, d) => acc + d, 0);

	return {
		min: sorted[0] ?? 0,
		max: sorted[sorted.length - 1] ?? 0,
		avg: sum / durations.length,
		p50: percentile(sorted, 50),
		p95: percentile(sorted, 95),
		p99: percentile(sorted, 99),
	};
}

/**
 * Execute items in parallel with a configurable concurrency limit.
 *
 * This helper prevents overwhelming the system by limiting the number
 * of concurrent operations. Maintains order of results.
 *
 * **Performance Characteristics:**
 * - Prevents system overload by limiting concurrent operations
 * - Ideal for I/O-bound tasks (API calls, file I/O, database queries)
 * - Results maintain input order regardless of completion order
 * - Recommended limits: 5-10 for API calls, 50-100 for CPU-bound tasks
 *
 * **Error Handling:**
 * - If any executor throws, the entire operation rejects
 * - Use within singleToList with error strategies for partial success handling
 *
 * @template TInput - The type of items being processed
 * @template TOutput - The type of results
 * @param items - Array of items to process
 * @param executor - Async function to execute for each item
 * @param concurrencyLimit - Maximum number of concurrent executions (default: 10)
 * @returns Array of results and their timings
 *
 * @example
 * const results = await executeParallel(
 *   [1, 2, 3, 4, 5],
 *   async (item) => processItem(item),
 *   2 // Process 2 items at a time
 * );
 */
export async function executeParallel<TInput, TOutput>(
	items: TInput[],
	executor: (
		item: TInput,
		index: number,
	) => Promise<{ result: TOutput; durationMs: number }>,
	concurrencyLimit = 10,
): Promise<Array<{ result: TOutput; durationMs: number }>> {
	const results: Array<{ result: TOutput; durationMs: number }> = new Array(
		items.length,
	);
	let activeCount = 0;
	let currentIndex = 0;

	return new Promise((resolve, reject) => {
		const processNext = () => {
			// If all items are processed and no active tasks, we're done
			if (currentIndex >= items.length && activeCount === 0) {
				resolve(results);
				return;
			}

			// Start new tasks up to the concurrency limit
			while (activeCount < concurrencyLimit && currentIndex < items.length) {
				const index = currentIndex;
				const item = items[index];
				currentIndex++;

				if (item === undefined) {
					processNext();
					continue;
				}

				activeCount++;

				executor(item, index)
					.then((res) => {
						results[index] = res;
					})
					.catch((error) => {
						reject(error);
					})
					.finally(() => {
						activeCount--;
						processNext();
					});
			}
		};

		processNext();
	});
}

/**
 * Converts a single-item step to a list step that processes arrays.
 *
 * @template TInput - Element type of the input array
 * @template TOutput - Element type of the output array
 * @template TAccumulatedState - Object containing all previous step outputs
 * @template TContext - Additional runtime context
 *
 * @param step - The single-item step to adapt
 * @param options - Adapter options (error strategy, parallel execution)
 * @returns A list step that processes arrays
 *
 * @example
 * const upperCase = createStep<string, string>('upperCase', async ({ input }) => input.toUpperCase());
 * const upperCaseList = singleToList(upperCase);
 * // upperCaseList can now process string[] -> string[]
 */
export function singleToList<
	TInput,
	TOutput,
	TAccumulatedState = Record<string, never>,
	TContext = unknown,
>(
	step: Step<TInput, TOutput, TAccumulatedState, TContext>,
	options: SingleToListOptions = {},
): ListStep<TInput, TOutput, TAccumulatedState, TContext> {
	const {
		errorStrategy = ListErrorStrategy.FAIL_FAST,
		parallel = false,
		concurrencyLimit = 10,
	} = options;

	const listStep: ListStep<TInput, TOutput, TAccumulatedState, TContext> = {
		name: `${step.name}_list`,
		execute: async (
			ctx: StepExecutionContext<TInput[], TAccumulatedState, TContext>,
		): Promise<StepResult<TOutput[]>> => {
			const startTime = Date.now();
			const results: Array<StepResult<TOutput> & { itemDurationMs: number }> =
				[];
			const itemTimings: number[] = [];

			try {
				if (parallel) {
					// Execute items in parallel with concurrency control
					const parallelResults = await executeParallel(
						ctx.input,
						async (item, _index) => {
							const itemStart = Date.now();
							const result = await step.execute({
								input: item,
								state: ctx.state,
								context: ctx.context,
							});
							const itemDuration = Date.now() - itemStart;
							itemTimings.push(itemDuration);
							return {
								result: { ...result, itemDurationMs: itemDuration },
								durationMs: itemDuration,
							};
						},
						concurrencyLimit,
					);

					results.push(...parallelResults.map((r) => r.result));
				} else {
					// Execute items sequentially
					for (const item of ctx.input) {
						const itemStart = Date.now();
						const result = await step.execute({
							input: item,
							state: ctx.state,
							context: ctx.context,
						});
						const itemDuration = Date.now() - itemStart;
						itemTimings.push(itemDuration);
						results.push({ ...result, itemDurationMs: itemDuration });

						// FAIL_FAST: Stop on first error
						if (
							!result.success &&
							errorStrategy === ListErrorStrategy.FAIL_FAST
						) {
							const endTime = Date.now();
							const listMetadata: ListOperationMetadata = {
								totalItems: ctx.input.length,
								successCount: results.filter((r) => r.success).length,
								failureCount: 1,
								skippedCount: ctx.input.length - results.length,
								itemTimings: calculateTimingStats(itemTimings),
								executionStrategy: "sequential",
							};

							return {
								success: false,
								error: result.error,
								metadata: {
									stepName: `${step.name}_list`,
									startTime,
									endTime,
									durationMs: endTime - startTime,
									listMetadata,
								},
							};
						}
					}
				}

				// Process results based on error strategy
				const successes: TOutput[] = [];
				const failures: Array<{ index: number; error: StepError }> = [];

				for (let i = 0; i < results.length; i++) {
					const result = results[i];
					if (!result) continue; // Should never happen, but satisfies TypeScript
					if (result.success) {
						successes.push(result.data);
					} else {
						failures.push({ index: i, error: result.error });
					}
				}

				const endTime = Date.now();

				// Build list metadata
				const listMetadata: ListOperationMetadata = {
					totalItems: ctx.input.length,
					successCount: successes.length,
					failureCount: failures.length,
					skippedCount: 0,
					itemTimings: calculateTimingStats(itemTimings),
					executionStrategy: parallel ? "parallel" : "sequential",
					...(parallel && { concurrencyLimit }),
				};

				// Handle based on error strategy
				if (failures.length > 0) {
					if (errorStrategy === ListErrorStrategy.FAIL_FAST) {
						// Should not reach here due to early return above (for sequential)
						// For parallel execution, we still get here
						const firstFailure = failures[0];
						if (!firstFailure) {
							throw new Error("Unexpected: failures array is empty");
						}
						return {
							success: false,
							error: firstFailure.error,
							metadata: {
								stepName: `${step.name}_list`,
								startTime,
								endTime,
								durationMs: endTime - startTime,
								listMetadata,
							},
						};
					}

					if (errorStrategy === ListErrorStrategy.COLLECT_ERRORS) {
						// Return error with all failures
						return {
							success: false,
							error: {
								code: "LIST_PROCESSING_ERRORS",
								message: `${failures.length} of ${ctx.input.length} items failed`,
								cause: failures,
								retryable: failures.some((f) => f.error.retryable),
							},
							metadata: {
								stepName: `${step.name}_list`,
								startTime,
								endTime,
								durationMs: endTime - startTime,
								listMetadata,
							},
						};
					}

					// SKIP_FAILED: Return only successes
					listMetadata.skippedCount = failures.length;
					return {
						success: true,
						data: successes,
						metadata: {
							stepName: `${step.name}_list`,
							startTime,
							endTime,
							durationMs: endTime - startTime,
							listMetadata,
						},
					};
				}

				// All succeeded
				return {
					success: true,
					data: successes,
					metadata: {
						stepName: `${step.name}_list`,
						startTime,
						endTime,
						durationMs: endTime - startTime,
						listMetadata,
					},
				};
			} catch (error) {
				const endTime = Date.now();
				const baseMetadata = {
					totalItems: ctx.input.length,
					successCount: 0,
					failureCount: ctx.input.length,
					skippedCount: 0,
					executionStrategy: (parallel ? "parallel" : "sequential") as
						| "sequential"
						| "parallel",
					...(parallel && { concurrencyLimit }),
				};

				const listMetadata: ListOperationMetadata =
					itemTimings.length > 0
						? {
								...baseMetadata,
								itemTimings: calculateTimingStats(itemTimings),
							}
						: baseMetadata;

				return {
					success: false,
					error: {
						code: "LIST_PROCESSING_ERROR",
						message: error instanceof Error ? error.message : "Unknown error",
						cause: error,
						retryable: false,
					},
					metadata: {
						stepName: `${step.name}_list`,
						startTime,
						endTime,
						durationMs: endTime - startTime,
						listMetadata,
					},
				};
			}
		},
	};

	if (step.retry) {
		listStep.retry = step.retry;
	}

	return listStep;
}

/**
 * Create a list step with custom execute function.
 *
 * @template TInput - Element type of the input array
 * @template TOutput - Element type of the output array
 * @template TAccumulatedState - Object containing all previous step outputs
 * @template TContext - Additional runtime context
 *
 * @param name - Step name
 * @param execute - Async function that transforms the input array
 * @param options - Optional retry configuration
 * @returns A list step
 *
 * @example
 * const sortStrings = createListStep<string, string>('sortStrings', async ({ input }) => {
 *   return [...input].sort();
 * });
 */
export function createListStep<
	TInput,
	TOutput,
	TAccumulatedState = Record<string, never>,
	TContext = unknown,
>(
	name: string,
	execute: (
		ctx: StepExecutionContext<TInput[], TAccumulatedState, TContext>,
	) => Promise<TOutput[]>,
	options?: {
		retry?: {
			maxAttempts: number;
			backoffMs: number;
			retryableErrors?: string[];
		};
	},
): ListStep<TInput, TOutput, TAccumulatedState, TContext> {
	const step: ListStep<TInput, TOutput, TAccumulatedState, TContext> = {
		name,
		execute: async (ctx): Promise<StepResult<TOutput[]>> => {
			const startTime = Date.now();
			try {
				const data = await execute(ctx);
				const endTime = Date.now();
				return {
					success: true,
					data,
					metadata: {
						stepName: name,
						startTime,
						endTime,
						durationMs: endTime - startTime,
					},
				};
			} catch (error) {
				const endTime = Date.now();
				const errorMessage =
					error instanceof Error ? error.message : String(error);

				return {
					success: false,
					error: {
						code: "LIST_STEP_ERROR",
						message: errorMessage,
						cause: error,
						retryable: false,
					},
					metadata: {
						stepName: name,
						startTime,
						endTime,
						durationMs: endTime - startTime,
					},
				};
			}
		},
	};

	if (options?.retry) {
		step.retry = options.retry;
	}

	return step;
}

/**
 * Create a step that batches an array into smaller chunks.
 *
 * @param batchSize - Number of items per batch
 * @param name - Optional step name (default: "batch")
 * @returns A step that transforms T[] into T[][]
 *
 * @example
 * const batch10 = createBatchStep(10);
 * // [1, 2, 3, ..., 25] -> [[1, 2, ..., 10], [11, 12, ..., 20], [21, 22, ..., 25]]
 */
export function createBatchStep<
	TInput,
	TAccumulatedState = Record<string, never>,
	TContext = unknown,
>(
	batchSize: number,
	name = "batch",
): Step<TInput[], TInput[][], TAccumulatedState, TContext> {
	if (batchSize <= 0) {
		throw new Error("Batch size must be greater than 0");
	}

	return createListStep<TInput, TInput[], TAccumulatedState, TContext>(
		name,
		async ({ input }) => {
			const batches: TInput[][] = [];
			for (let i = 0; i < input.length; i += batchSize) {
				batches.push(input.slice(i, i + batchSize));
			}
			return batches;
		},
	);
}

/**
 * Create a step that flattens a nested array.
 *
 * @param name - Optional step name (default: "flatten")
 * @returns A step that transforms T[][] into T[]
 *
 * @example
 * const flatten = createFlattenStep();
 * // [[1, 2], [3, 4], [5]] -> [1, 2, 3, 4, 5]
 */
export function createFlattenStep<
	TInput,
	TAccumulatedState = Record<string, never>,
	TContext = unknown,
>(name = "flatten"): Step<TInput[][], TInput[], TAccumulatedState, TContext> {
	return createListStep<TInput[], TInput, TAccumulatedState, TContext>(
		name,
		async ({ input }) => {
			return input.flat();
		},
	);
}

/**
 * Create a step that filters an array based on a predicate.
 *
 * @param predicate - Function to test each element
 * @param name - Optional step name (default: "filter")
 * @returns A step that filters the input array
 *
 * @example
 * const filterEven = createFilterStep((n: number) => n % 2 === 0, 'filterEven');
 * // [1, 2, 3, 4, 5, 6] -> [2, 4, 6]
 */
export function createFilterStep<
	TInput,
	TAccumulatedState = Record<string, never>,
	TContext = unknown,
>(
	predicate: (item: TInput, index: number) => boolean | Promise<boolean>,
	name = "filter",
): ListStep<TInput, TInput, TAccumulatedState, TContext> {
	return createListStep<TInput, TInput, TAccumulatedState, TContext>(
		name,
		async ({ input }) => {
			const results: TInput[] = [];
			for (let i = 0; i < input.length; i++) {
				const item = input[i];
				if (item === undefined) continue; // Should never happen, but satisfies TypeScript
				const shouldInclude = await predicate(item, i);
				if (shouldInclude) {
					results.push(item);
				}
			}
			return results;
		},
	);
}
