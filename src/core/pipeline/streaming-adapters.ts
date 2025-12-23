/**
 * Adapters for converting between batch and streaming steps.
 *
 * This module provides utilities to convert existing batch-oriented steps
 * into streaming-compatible versions, enabling gradual migration to streaming
 * pipelines without rewriting all existing steps.
 *
 * Key features:
 * - toStreamingStep: Wraps a batch step as a streaming step
 * - toBatchStep: Materializes a streaming step back to batch
 * - Hybrid step interface for steps supporting both modes
 * - Maintains error handling and retry semantics
 *
 * @see {@link https://github.com/jeffutter/rag3.0/blob/main/docs/architecture/streaming-pipeline-design.md}
 */

import type { Step, StepExecutionContext } from "./types";
import type { StreamingStep, StreamingStepContext } from "./streaming-types";

/**
 * Convert a batch step to a streaming step.
 *
 * This adapter wraps a batch Step that operates on individual items,
 * converting it to work in a streaming pipeline. The batch step's execute
 * function is called once per item from the input stream.
 *
 * **Important Notes:**
 * - The batch step should process individual items, not arrays
 * - For list-based steps, use toStreamingListStep instead
 * - Error handling and retry logic are preserved
 * - State accumulation works with streaming state
 *
 * @template TInput - The input type (element type)
 * @template TOutput - The output type (element type)
 * @template TAccumulated - Accumulated state from previous steps
 * @template TContext - Runtime context
 *
 * @param step - The batch step to convert
 * @returns A streaming step that processes items one at a time
 *
 * @example
 * ```typescript
 * // Existing batch step
 * const upperCaseStep = createStep<string, string>(
 *   'upperCase',
 *   async ({ input }) => input.toUpperCase()
 * );
 *
 * // Convert to streaming
 * const streamingUpperCase = toStreamingStep(upperCaseStep);
 *
 * // Use in streaming pipeline
 * const pipeline = StreamingPipeline.start<string>()
 *   .add('upper', streamingUpperCase);
 * ```
 *
 * @example
 * ```typescript
 * // Step with state access
 * const enrichStep = createStep<Item, EnrichedItem, { config: Config }>(
 *   'enrich',
 *   async ({ input, state }) => ({
 *     ...input,
 *     configValue: state.config.value
 *   })
 * );
 *
 * const streamingEnrich = toStreamingStep(enrichStep);
 * // State access still works via streaming state snapshots
 * ```
 */
export function toStreamingStep<
	TInput,
	TOutput,
	TAccumulated extends Record<string, any> = Record<string, never>,
	TContext = unknown,
>(step: Step<TInput, TOutput, TAccumulated, TContext>): StreamingStep<TInput, TOutput, TAccumulated, TContext> {
	return {
		name: `${step.name}_streaming`,
		execute: async function* (ctx: StreamingStepContext<TInput, TAccumulated, TContext>) {
			// Process each item from the input stream
			for await (const item of ctx.input) {
				// Convert streaming state to batch-compatible state
				const batchContext: StepExecutionContext<TInput, TAccumulated, TContext> = {
					input: item,
					state: ctx.state.accumulated,
					context: ctx.context,
				};

				// Execute the batch step
				const result = await step.execute(batchContext);

				if (result.success) {
					yield result.data;
				} else {
					// Propagate error
					throw new Error(`Step ${step.name} failed: ${result.error.message}`);
				}
			}
		},
		...(step.retry && { retry: step.retry }),
	};
}

/**
 * Convert a streaming step to a batch step.
 *
 * This adapter materializes a streaming step back into a batch step that
 * processes entire arrays. The streaming step is executed and all results
 * are collected into an array.
 *
 * **Warning:** This defeats the purpose of streaming by materializing the
 * entire result set in memory. Use only when necessary for compatibility.
 *
 * @template TInput - The input type (element type)
 * @template TOutput - The output type (element type)
 * @template TAccumulated - Accumulated state from previous steps
 * @template TContext - Runtime context
 *
 * @param streamingStep - The streaming step to convert
 * @returns A batch step that processes arrays
 *
 * @example
 * ```typescript
 * const streamingStep = createStreamingStep<number, number>(
 *   'double',
 *   async function* ({ input }) {
 *     for await (const n of input) {
 *       yield n * 2;
 *     }
 *   }
 * );
 *
 * // Convert to batch (materializes results)
 * const batchStep = toBatchStep(streamingStep);
 *
 * // Use in batch pipeline
 * const pipeline = Pipeline.start<number[]>()
 *   .add('doubled', batchStep);
 * ```
 */
export function toBatchStep<
	TInput,
	TOutput,
	TAccumulated extends Record<string, any> = Record<string, never>,
	TContext = unknown,
>(
	streamingStep: StreamingStep<TInput, TOutput, TAccumulated, TContext>,
): Step<TInput[], TOutput[], TAccumulated, TContext> {
	return {
		name: `${streamingStep.name}_batch`,
		execute: async (ctx: StepExecutionContext<TInput[], TAccumulated, TContext>) => {
			try {
				const startTime = Date.now();

				// Create an async generator from the input array
				async function* inputGenerator() {
					for (const item of ctx.input) {
						yield item;
					}
				}

				// Create streaming state wrapper
				const streamingState = {
					accumulated: ctx.state,
					stream: <K extends keyof TAccumulated>(_key: K): AsyncGenerator<TAccumulated[K]> => {
						throw new Error("Stream access not supported in batch mode");
					},
					materialize: async <K extends keyof TAccumulated>(_key: K): Promise<Array<TAccumulated[K]>> => {
						throw new Error("Materialize not supported in batch mode");
					},
					hasSnapshot: (_key: keyof TAccumulated): boolean => {
						return true; // In batch mode, all state is available
					},
				};

				// Execute the streaming step
				const streamingContext: StreamingStepContext<TInput, TAccumulated, TContext> = {
					input: inputGenerator(),
					state: streamingState,
					context: ctx.context,
				};

				const generator = streamingStep.execute(streamingContext);

				// Collect all results
				const results: TOutput[] = [];
				for await (const item of generator) {
					results.push(item);
				}

				const endTime = Date.now();

				return {
					success: true,
					data: results,
					metadata: {
						stepName: streamingStep.name,
						startTime,
						endTime,
						durationMs: endTime - startTime,
					},
				};
			} catch (error) {
				const endTime = Date.now();
				const errorMessage = error instanceof Error ? error.message : String(error);

				return {
					success: false,
					error: {
						code: "BATCH_CONVERSION_ERROR",
						message: errorMessage,
						cause: error,
						retryable: false,
					},
					metadata: {
						stepName: streamingStep.name,
						startTime: Date.now(),
						endTime,
						durationMs: 0,
					},
				};
			}
		},
		...(streamingStep.retry && { retry: streamingStep.retry }),
	};
}

/**
 * Interface for hybrid steps that support both batch and streaming modes.
 *
 * Hybrid steps can be used in either batch or streaming pipelines without
 * conversion. This is useful for steps that can efficiently process both
 * individual items and entire arrays.
 *
 * Note: This interface doesn't extend Step or StreamingStep directly to avoid
 * conflicts. Instead, it provides both execute and stream methods.
 *
 * @template TInput - The input type (element type)
 * @template TOutput - The output type (element type)
 * @template TAccumulated - Accumulated state from previous steps
 * @template TContext - Runtime context
 *
 * @example
 * ```typescript
 * const hybridUpperCase: HybridStep<string, string> = {
 *   name: 'upperCase',
 *
 *   // Batch mode: process array
 *   execute: async ({ input }) => ({
 *     success: true,
 *     data: input.map(s => s.toUpperCase()),
 *     metadata: {
 *       stepName: 'upperCase',
 *       startTime: Date.now(),
 *       endTime: Date.now(),
 *       durationMs: 0,
 *     }
 *   }),
 *
 *   // Streaming mode: process items one by one
 *   stream: async function* ({ input }) {
 *     for await (const item of input) {
 *       yield item.toUpperCase();
 *     }
 *   }
 * };
 *
 * // Use in batch pipeline (via toBatchMode)
 * const batchStep = hybridUpperCase; // Can use as-is with execute method
 *
 * // Use in streaming pipeline (via toStreamingMode)
 * const streamingStep = toStreamingMode(hybridUpperCase);
 * ```
 */
export interface HybridStep<
	TInput,
	TOutput,
	TAccumulated extends Record<string, any> = Record<string, never>,
	TContext = unknown,
> {
	/** Step name */
	name: string;

	/**
	 * Batch mode execution - processes arrays.
	 */
	execute: (ctx: StepExecutionContext<TInput[], TAccumulated, TContext>) => ReturnType<
		Step<TInput[], TOutput[], TAccumulated, TContext>["execute"]
	>;

	/**
	 * Streaming mode execution - processes items one by one.
	 */
	stream: (ctx: StreamingStepContext<TInput, TAccumulated, TContext>) => AsyncGenerator<TOutput>;

	/**
	 * Optional retry configuration (applies to both modes).
	 */
	retry?: {
		maxAttempts: number;
		backoffMs: number;
		retryableErrors?: string[];
	};
}

/**
 * Convert a hybrid step to batch mode (returns a Step).
 *
 * @param hybridStep - The hybrid step to convert
 * @returns A batch step that can be used in Pipeline
 */
export function toBatchMode<
	TInput,
	TOutput,
	TAccumulated extends Record<string, any> = Record<string, never>,
	TContext = unknown,
>(hybridStep: HybridStep<TInput, TOutput, TAccumulated, TContext>): Step<TInput[], TOutput[], TAccumulated, TContext> {
	return {
		name: hybridStep.name,
		execute: hybridStep.execute,
		...(hybridStep.retry && { retry: hybridStep.retry }),
	};
}

/**
 * Convert a hybrid step to streaming mode (returns a StreamingStep).
 *
 * @param hybridStep - The hybrid step to convert
 * @returns A streaming step that can be used in StreamingPipeline
 */
export function toStreamingMode<
	TInput,
	TOutput,
	TAccumulated extends Record<string, any> = Record<string, never>,
	TContext = unknown,
>(
	hybridStep: HybridStep<TInput, TOutput, TAccumulated, TContext>,
): StreamingStep<TInput, TOutput, TAccumulated, TContext> {
	return {
		name: hybridStep.name,
		execute: hybridStep.stream,
		...(hybridStep.retry && { retry: hybridStep.retry }),
	};
}

/**
 * Create a hybrid step that supports both batch and streaming modes.
 *
 * This is useful for steps that can efficiently operate in both modes,
 * such as simple transformations that don't require buffering.
 *
 * @template TInput - The input type (element type)
 * @template TOutput - The output type (element type)
 * @template TAccumulated - Accumulated state from previous steps
 * @template TContext - Runtime context
 *
 * @param name - Step name
 * @param batchFn - Function to process arrays in batch mode
 * @param streamFn - Function to process items in streaming mode
 * @param options - Optional retry configuration
 * @returns A hybrid step that works in both modes
 *
 * @example
 * ```typescript
 * const upperCase = createHybridStep<string, string>(
 *   'upperCase',
 *   // Batch mode
 *   async ({ input }) => input.map(s => s.toUpperCase()),
 *   // Streaming mode
 *   async function* ({ input }) {
 *     for await (const s of input) {
 *       yield s.toUpperCase();
 *     }
 *   }
 * );
 *
 * // Use in batch pipeline
 * const batchPipeline = Pipeline.start<string[]>()
 *   .add('upper', toBatchMode(upperCase));
 *
 * // Use in streaming pipeline
 * const streamingPipeline = StreamingPipeline.start<string>()
 *   .add('upper', toStreamingMode(upperCase));
 * ```
 */
export function createHybridStep<
	TInput,
	TOutput,
	TAccumulated extends Record<string, any> = Record<string, never>,
	TContext = unknown,
>(
	name: string,
	batchFn: (ctx: StepExecutionContext<TInput[], TAccumulated, TContext>) => Promise<TOutput[]>,
	streamFn: (ctx: StreamingStepContext<TInput, TAccumulated, TContext>) => AsyncGenerator<TOutput>,
	options?: {
		retry?: {
			maxAttempts: number;
			backoffMs: number;
			retryableErrors?: string[];
		};
	},
): HybridStep<TInput, TOutput, TAccumulated, TContext> {
	return {
		name,

		// Batch mode execution
		execute: async (ctx: StepExecutionContext<TInput[], TAccumulated, TContext>) => {
			try {
				const startTime = Date.now();
				const data = await batchFn(ctx);
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
				const errorMessage = error instanceof Error ? error.message : String(error);

				return {
					success: false,
					error: {
						code: "HYBRID_STEP_ERROR",
						message: errorMessage,
						cause: error,
						retryable: false,
					},
					metadata: {
						stepName: name,
						startTime: Date.now(),
						endTime,
						durationMs: 0,
					},
				};
			}
		},

		// Streaming mode execution
		stream: streamFn,

		...(options?.retry && { retry: options.retry }),
	};
}

/**
 * Step categorization for migration guidance.
 *
 * Helps identify which steps are good candidates for streaming conversion.
 */
export enum StepCategory {
	/**
	 * Pure transformation steps that map 1:1 input to output.
	 * Examples: uppercase, parse JSON, extract fields
	 * Streaming: Excellent candidate (no buffering needed)
	 */
	PURE_TRANSFORM = "PURE_TRANSFORM",

	/**
	 * Aggregation steps that need the full dataset.
	 * Examples: sort, group by, calculate statistics
	 * Streaming: Poor candidate (requires full materialization)
	 */
	AGGREGATION = "AGGREGATION",

	/**
	 * Stateful steps that maintain state across items.
	 * Examples: deduplication, running average, rate limiting
	 * Streaming: Good candidate (bounded state)
	 */
	STATEFUL = "STATEFUL",

	/**
	 * I/O-bound steps that perform external operations.
	 * Examples: API calls, database queries, file operations
	 * Streaming: Excellent candidate (benefits from concurrency control)
	 */
	IO_BOUND = "IO_BOUND",

	/**
	 * Expansion steps that output multiple items per input.
	 * Examples: chunk splitter, record flattener
	 * Streaming: Excellent candidate (reduces memory pressure)
	 */
	EXPANSION = "EXPANSION",

	/**
	 * Reduction steps that output fewer items than input.
	 * Examples: filter, deduplication, sampling
	 * Streaming: Good candidate (reduces downstream load)
	 */
	REDUCTION = "REDUCTION",
}

/**
 * Categorize a step for migration guidance.
 *
 * Provides heuristic-based categorization to help decide whether
 * a step is a good candidate for streaming conversion.
 *
 * @param step - The step to categorize
 * @returns The step category
 *
 * @example
 * ```typescript
 * const category = categorizeStep(myStep);
 *
 * if (category === StepCategory.PURE_TRANSFORM) {
 *   console.log('Excellent streaming candidate!');
 *   const streamingStep = toStreamingStep(myStep);
 * }
 * ```
 */
export function categorizeStep<TInput, TOutput, TAccumulated, TContext>(
	step: Step<TInput, TOutput, TAccumulated, TContext>,
): StepCategory {
	// This is a heuristic-based categorization
	// In practice, developers would manually categorize their steps
	// or use naming conventions

	const name = step.name.toLowerCase();

	// I/O operations
	if (
		name.includes("read") ||
		name.includes("write") ||
		name.includes("fetch") ||
		name.includes("api") ||
		name.includes("db") ||
		name.includes("database")
	) {
		return StepCategory.IO_BOUND;
	}

	// Aggregations
	if (
		name.includes("sort") ||
		name.includes("group") ||
		name.includes("aggregate") ||
		name.includes("sum") ||
		name.includes("count") ||
		name.includes("statistics")
	) {
		return StepCategory.AGGREGATION;
	}

	// Expansions
	if (
		name.includes("split") ||
		name.includes("chunk") ||
		name.includes("expand") ||
		name.includes("flatten") ||
		name.includes("flatmap")
	) {
		return StepCategory.EXPANSION;
	}

	// Reductions
	if (
		name.includes("filter") ||
		name.includes("dedupe") ||
		name.includes("sample") ||
		name.includes("limit") ||
		name.includes("take")
	) {
		return StepCategory.REDUCTION;
	}

	// Stateful
	if (
		name.includes("cache") ||
		name.includes("memo") ||
		name.includes("state") ||
		name.includes("rate") ||
		name.includes("throttle")
	) {
		return StepCategory.STATEFUL;
	}

	// Default to pure transform
	return StepCategory.PURE_TRANSFORM;
}

/**
 * Migration recommendation for a step.
 */
export interface MigrationRecommendation {
	/** The step category */
	category: StepCategory;
	/** Whether streaming is recommended */
	recommended: boolean;
	/** Recommendation strength (0-1, higher is better) */
	strength: number;
	/** Explanation of the recommendation */
	reason: string;
	/** Suggested approach */
	approach: "toStreamingStep" | "createHybridStep" | "keep_batch" | "manual_conversion";
}

/**
 * Get migration recommendation for a step.
 *
 * Analyzes a step and provides guidance on whether and how to
 * convert it to streaming.
 *
 * @param step - The step to analyze
 * @returns Migration recommendation
 *
 * @example
 * ```typescript
 * const recommendation = getMigrationRecommendation(myStep);
 * console.log(recommendation.reason);
 *
 * if (recommendation.recommended && recommendation.approach === 'toStreamingStep') {
 *   const streamingStep = toStreamingStep(myStep);
 * }
 * ```
 */
export function getMigrationRecommendation<TInput, TOutput, TAccumulated, TContext>(
	step: Step<TInput, TOutput, TAccumulated, TContext>,
): MigrationRecommendation {
	const category = categorizeStep(step);

	switch (category) {
		case StepCategory.PURE_TRANSFORM:
			return {
				category,
				recommended: true,
				strength: 0.9,
				reason:
					"Pure transformations stream naturally with no buffering. Excellent candidate for toStreamingStep() wrapper.",
				approach: "toStreamingStep",
			};

		case StepCategory.IO_BOUND:
			return {
				category,
				recommended: true,
				strength: 0.95,
				reason:
					"I/O-bound operations benefit greatly from streaming's concurrency control and backpressure. Use toStreamingStep() with parallel options.",
				approach: "toStreamingStep",
			};

		case StepCategory.EXPANSION:
			return {
				category,
				recommended: true,
				strength: 0.9,
				reason:
					"Expansion steps generate multiple outputs per input, streaming reduces memory pressure significantly. Consider manual conversion for flatMap semantics.",
				approach: "manual_conversion",
			};

		case StepCategory.REDUCTION:
			return {
				category,
				recommended: true,
				strength: 0.8,
				reason:
					"Reduction steps decrease downstream load, good streaming candidate. Use toStreamingStep() or createHybridStep().",
				approach: "createHybridStep",
			};

		case StepCategory.STATEFUL:
			return {
				category,
				recommended: true,
				strength: 0.7,
				reason:
					"Stateful steps can stream if state is bounded. Consider manual conversion to manage state lifecycle properly.",
				approach: "manual_conversion",
			};

		case StepCategory.AGGREGATION:
			return {
				category,
				recommended: false,
				strength: 0.3,
				reason:
					"Aggregations require full dataset, defeating streaming benefits. Keep as batch or use windowing for approximate results.",
				approach: "keep_batch",
			};

		default:
			return {
				category,
				recommended: true,
				strength: 0.5,
				reason: "Unknown category, default to streaming with caution. Review step logic carefully.",
				approach: "toStreamingStep",
			};
	}
}
