import { createLogger } from "../logging/logger";
import {
	createBatchStep,
	createFilterStep,
	createFlattenStep,
	type SingleToListOptions,
	singleToList,
} from "./list-adapters";
import type { ArrayElement } from "./list-types";
import type {
	AddToState,
	Step,
	StepError,
	StepExecutionContext,
	StepMetadata,
	StepResult,
} from "./types";

const logger = createLogger("pipeline");

/**
 * Type-safe pipeline builder with accumulated state tracking.
 *
 * Key features:
 * - Each step receives the previous step's output as direct input
 * - Each step can access outputs from ANY previous step via accumulated state
 * - TypeScript validates at compile-time that referenced steps exist
 * - Steps are named, enabling type-safe cross-step references
 *
 * @example
 * const pipeline = Pipeline.start<string>()
 *   .add('embed', embeddingStep)      // state: { embed: EmbeddingOutput }
 *   .add('search', vectorSearchStep)  // Can reference state.embed
 *   .add('rerank', rerankStep);       // Can reference state.embed and state.search
 */

// Internal representation of a pipeline stage
interface PipelineStage {
	key: string;
	// biome-ignore lint/suspicious/noExplicitAny: Internal type-erased storage for pipeline stages
	step: Step<any, any, any, any>;
}

/**
 * Pipeline class with generic type tracking.
 *
 * @template TInitialInput - The very first input to the pipeline
 * @template TCurrentOutput - The output of the most recent step
 * @template TAccumulatedState - Object containing all previous step outputs by name
 * @template TContext - Additional runtime context
 */
export class Pipeline<
	TInitialInput,
	TCurrentOutput,
	// biome-ignore lint/suspicious/noExplicitAny: Generic constraint allows any value type in accumulated state
	TAccumulatedState extends Record<string, any>,
	TContext = unknown,
> {
	private stages: PipelineStage[] = [];
	private contextBuilder: () => TContext;

	private constructor(stages: PipelineStage[], contextBuilder: () => TContext) {
		this.stages = stages;
		this.contextBuilder = contextBuilder;
	}

	/**
	 * Start a new pipeline.
	 *
	 * @example
	 * const pipeline = Pipeline.start<string>()
	 *   .add('step1', step1)
	 *   .add('step2', step2);
	 */
	static start<TInput, TContext = unknown>(
		contextBuilder: () => TContext = () => ({}) as TContext,
		// biome-ignore lint/complexity/noBannedTypes: Empty object represents initial empty pipeline state
	): Pipeline<TInput, TInput, {}, TContext> {
		// biome-ignore lint/complexity/noBannedTypes: Empty object represents initial empty pipeline state
		return new Pipeline<TInput, TInput, {}, TContext>([], contextBuilder);
	}

	/**
	 * Add a named step to the pipeline.
	 *
	 * The step receives:
	 * - input: The direct output from the previous step
	 * - state: All outputs from previous steps (by their keys)
	 * - context: Runtime context
	 *
	 * TypeScript enforces:
	 * - Input type matches previous step's output
	 * - State type contains all previously added steps
	 * - No duplicate step names
	 *
	 * @example
	 * pipeline
	 *   .add('embed', createStep('embed', async ({ input }) => {
	 *     return embedText(input);
	 *   }))
	 *   .add('search', createStep('search', async ({ input, state }) => {
	 *     // input is the embedding from previous step
	 *     // state.embed is also available
	 *     return searchVectors(input, state.embed);
	 *   }));
	 */
	add<TKey extends string, TNextOutput>(
		key: TKey,
		step: Step<TCurrentOutput, TNextOutput, TAccumulatedState, TContext>,
	): TKey extends keyof TAccumulatedState
		? never
		: Pipeline<
				TInitialInput,
				TNextOutput,
				AddToState<TAccumulatedState, TKey, TNextOutput>,
				TContext
			> {
		return new Pipeline(
			[...this.stages, { key, step }],
			this.contextBuilder,
			// biome-ignore lint/suspicious/noExplicitAny: TypeScript cannot infer complex conditional return type
		) as any;
	}

	/**
	 * Add a conditional branch to the pipeline.
	 * Both branches must have the same output type.
	 */
	branch<TKey extends string, TBranchOutput>(
		key: TKey,
		condition: (
			input: TCurrentOutput,
			state: TAccumulatedState,
			context: TContext,
		) => boolean,
		trueBranch: Step<
			TCurrentOutput,
			TBranchOutput,
			TAccumulatedState,
			TContext
		>,
		falseBranch: Step<
			TCurrentOutput,
			TBranchOutput,
			TAccumulatedState,
			TContext
		>,
	): TKey extends keyof TAccumulatedState
		? never
		: Pipeline<
				TInitialInput,
				TBranchOutput,
				AddToState<TAccumulatedState, TKey, TBranchOutput>,
				TContext
			> {
		const branchStep: Step<
			TCurrentOutput,
			TBranchOutput,
			TAccumulatedState,
			TContext
		> = {
			name: `branch(${trueBranch.name}|${falseBranch.name})`,
			execute: async (ctx) => {
				const selectedStep = condition(ctx.input, ctx.state, ctx.context)
					? trueBranch
					: falseBranch;
				return selectedStep.execute(ctx);
			},
		};

		return new Pipeline(
			[...this.stages, { key, step: branchStep }],
			this.contextBuilder,
			// biome-ignore lint/suspicious/noExplicitAny: TypeScript cannot infer complex conditional return type
		) as any;
	}

	/**
	 * Map a step over an array.
	 *
	 * Applies a single-item step to each element of an array, producing a new array.
	 * Validates at compile-time that the current output is an array type.
	 *
	 * **Performance Characteristics:**
	 * - Sequential: O(n) time, processes items one by one
	 * - Parallel (default limit=10): Can be 3-10x faster for I/O-bound operations
	 * - Parallel with high concurrency: Up to 25x faster for large arrays (1000+ items)
	 * - Memory: O(n) to store results, no significant overhead
	 *
	 * **Error Handling:**
	 * - FAIL_FAST (default): Stops at first error, returns immediately
	 * - COLLECT_ERRORS: Processes all items, returns all errors
	 * - SKIP_FAILED: Skips failed items, returns only successes
	 *
	 * @template TKey - The key to store the result in accumulated state
	 * @template TOutput - The output type of the mapped step
	 * @param key - The key for this step in accumulated state
	 * @param step - A step that operates on single elements
	 * @param options - Optional configuration for parallel execution and error handling
	 * @param options.parallel - Execute items in parallel (default: false)
	 * @param options.concurrencyLimit - Max concurrent operations when parallel (default: 10)
	 * @param options.errorStrategy - How to handle errors (default: FAIL_FAST)
	 *
	 * @example
	 * // Simple sequential mapping
	 * pipeline
	 *   .add('items', getItems) // Returns string[]
	 *   .map('uppercased', uppercaseStep)
	 *   // Now state has: { items: string[], uppercased: string[] }
	 *
	 * @example
	 * // Parallel mapping with error handling
	 * pipeline
	 *   .add('urls', getUrls) // Returns string[]
	 *   .map('pages', fetchStep, {
	 *     parallel: true,
	 *     concurrencyLimit: 5,
	 *     errorStrategy: ListErrorStrategy.SKIP_FAILED
	 *   })
	 *   // Fetches 5 URLs at a time, skips any that fail
	 */
	map<TKey extends string, TOutput>(
		key: TKey,
		step: TCurrentOutput extends (infer TElement)[]
			? Step<TElement, TOutput, TAccumulatedState, TContext>
			: never,
		options?: SingleToListOptions,
	): TCurrentOutput extends unknown[]
		? TKey extends keyof TAccumulatedState
			? never
			: Pipeline<
					TInitialInput,
					TOutput[],
					AddToState<TAccumulatedState, TKey, TOutput[]>,
					TContext
				>
		: never {
		// Convert the single-item step to a list step
		const listStep = singleToList(step, options);

		return new Pipeline(
			[...this.stages, { key, step: listStep }],
			this.contextBuilder,
			// biome-ignore lint/suspicious/noExplicitAny: TypeScript cannot infer complex conditional return type
		) as any;
	}

	/**
	 * FlatMap a step over an array.
	 *
	 * Applies a step that returns arrays to each element, then flattens the results.
	 * Validates at compile-time that the current output is an array type.
	 *
	 * **Performance Characteristics:**
	 * - Time: O(n * m) where n is input array length, m is avg output array length
	 * - Parallel execution recommended for I/O-bound steps (e.g., API calls)
	 * - Flattening is O(total output elements)
	 *
	 * **Error Handling:**
	 * Supports all error strategies (FAIL_FAST, COLLECT_ERRORS, SKIP_FAILED)
	 *
	 * @template TKey - The key to store the result in accumulated state
	 * @template TOutput - The element type of arrays returned by the step
	 * @param key - The key for this step in accumulated state
	 * @param step - A step that operates on single elements and returns arrays
	 * @param options - Optional configuration for parallel execution and error handling
	 *
	 * @example
	 * // Split sentences into words
	 * pipeline
	 *   .add('sentences', getSentences) // Returns string[]
	 *   .flatMap('words', splitWordsStep) // Each sentence -> string[]
	 *   // Now state has: { sentences: string[], words: string[] }
	 *
	 * @example
	 * // Expand documents into chunks (common RAG pattern)
	 * pipeline
	 *   .add('documents', getDocuments) // Returns Document[]
	 *   .flatMap('chunks', chunkDocumentStep, { parallel: true })
	 *   // Each document -> Chunk[], result is flattened to Chunk[]
	 */
	flatMap<TKey extends string, TOutput>(
		key: TKey,
		step: TCurrentOutput extends (infer TElement)[]
			? Step<TElement, TOutput[], TAccumulatedState, TContext>
			: never,
		options?: SingleToListOptions,
	): TCurrentOutput extends unknown[]
		? TKey extends keyof TAccumulatedState
			? never
			: Pipeline<
					TInitialInput,
					TOutput[],
					AddToState<TAccumulatedState, TKey, TOutput[]>,
					TContext
				>
		: never {
		// Convert the single-item step to a list step, then flatten
		const listStep = singleToList(step, options);

		// Wrap the list step to flatten the output
		const flatMappedStep: Step<
			TCurrentOutput,
			TOutput[],
			TAccumulatedState,
			TContext
		> = {
			name: `${listStep.name}_flatMap`,
			execute: async (ctx): Promise<StepResult<TOutput[]>> => {
				// biome-ignore lint/suspicious/noExplicitAny: Runtime type erasure - ctx.input is guaranteed to be an array at runtime
				const result = await listStep.execute(ctx as any);
				if (!result.success) {
					return {
						success: false,
						error: result.error,
						metadata: result.metadata,
					};
				}

				// Flatten the array of arrays
				// biome-ignore lint/suspicious/noExplicitAny: Runtime type erasure requires any for nested array flattening
				const flattened = (result.data as any[][]).flat() as TOutput[];

				return {
					success: true,
					data: flattened,
					metadata: result.metadata,
				};
			},
		};

		if (listStep.retry) {
			flatMappedStep.retry = listStep.retry;
		}

		return new Pipeline(
			[...this.stages, { key, step: flatMappedStep }],
			this.contextBuilder,
			// biome-ignore lint/suspicious/noExplicitAny: TypeScript cannot infer complex conditional return type
		) as any;
	}

	/**
	 * Batch an array into chunks.
	 *
	 * Transforms T[] into T[][], grouping elements into batches of the specified size.
	 * Validates at compile-time that the current output is an array type.
	 *
	 * **Performance Characteristics:**
	 * - Time: O(n) for batching operation
	 * - Memory: O(n) (creates new arrays but reuses elements)
	 * - Improves downstream performance by reducing API call count
	 *
	 * **Use Cases:**
	 * - Batch API calls to respect rate limits
	 * - Group items for bulk database operations
	 * - Reduce network overhead (e.g., embedding generation)
	 *
	 * @template TKey - The key to store the result in accumulated state
	 * @param key - The key for this step in accumulated state
	 * @param size - The number of elements per batch
	 *
	 * @example
	 * // Batch for efficient API calls
	 * pipeline
	 *   .add('items', getItems) // Returns string[]
	 *   .batch('batches', 10)
	 *   .map('results', batchApiStep)
	 *   // Processes 10 items per API call instead of 1
	 *
	 * @example
	 * // Common pattern: batch -> process -> flatten
	 * pipeline
	 *   .add('texts', getTexts) // 100 texts
	 *   .batch('batches', 10)   // 10 batches of 10
	 *   .map('embeddings', embedBatchStep) // 10 API calls
	 *   .flatten('allEmbeddings') // Back to 100 embeddings
	 */
	batch<TKey extends string>(
		key: TKey,
		size: number,
	): TCurrentOutput extends (infer TElement)[]
		? TKey extends keyof TAccumulatedState
			? never
			: Pipeline<
					TInitialInput,
					TElement[][],
					AddToState<TAccumulatedState, TKey, TElement[][]>,
					TContext
				>
		: never {
		const batchStep = createBatchStep<
			ArrayElement<TCurrentOutput>,
			TAccumulatedState,
			TContext
		>(size, `batch_${size}`);

		return new Pipeline(
			[...this.stages, { key, step: batchStep }],
			this.contextBuilder,
			// biome-ignore lint/suspicious/noExplicitAny: TypeScript cannot infer complex conditional return type
		) as any;
	}

	/**
	 * Flatten a nested array.
	 *
	 * Transforms T[][] into T[], flattening one level of nesting.
	 * Validates at compile-time that the current output is a nested array type.
	 *
	 * **Performance Characteristics:**
	 * - Time: O(n) where n is total number of elements
	 * - Memory: O(n) for the flattened array
	 * - Very efficient, uses native Array.flat()
	 *
	 * **Use Cases:**
	 * - After batching and processing, to get back to flat array
	 * - After flatMap internally (automatically applied)
	 * - Combining results from multiple sources
	 *
	 * @template TKey - The key to store the result in accumulated state
	 * @param key - The key for this step in accumulated state
	 *
	 * @example
	 * // Flatten batched results
	 * pipeline
	 *   .add('batches', getBatches) // Returns string[][]
	 *   .flatten('items')
	 *   // Now state has: { batches: string[][], items: string[] }
	 *
	 * @example
	 * // Common pattern with batch processing
	 * pipeline
	 *   .add('items', getItems)
	 *   .batch('batches', 10)
	 *   .map('processed', processStep)
	 *   .flatten('results')
	 *   // Back to flat array of results
	 */
	flatten<TKey extends string>(
		key: TKey,
	): TCurrentOutput extends (infer TElement)[][]
		? TKey extends keyof TAccumulatedState
			? never
			: Pipeline<
					TInitialInput,
					TElement[],
					AddToState<TAccumulatedState, TKey, TElement[]>,
					TContext
				>
		: never {
		const flattenStep = createFlattenStep<
			ArrayElement<ArrayElement<TCurrentOutput>>,
			TAccumulatedState,
			TContext
		>("flatten");

		return new Pipeline(
			[...this.stages, { key, step: flattenStep }],
			this.contextBuilder,
			// biome-ignore lint/suspicious/noExplicitAny: TypeScript cannot infer complex conditional return type
		) as any;
	}

	/**
	 * Filter an array based on a predicate.
	 *
	 * Removes elements that don't match the predicate condition.
	 * Validates at compile-time that the current output is an array type.
	 *
	 * **Performance Characteristics:**
	 * - Time: O(n) for sequential, O(n/p) for parallel (p = cores)
	 * - Memory: O(m) where m is number of matching elements
	 * - Predicate can be async for complex filtering logic
	 *
	 * **Error Handling:**
	 * If predicate throws, the element is not included (treated as false)
	 *
	 * @template TKey - The key to store the result in accumulated state
	 * @param key - The key for this step in accumulated state
	 * @param predicate - Function to test each element (can be async)
	 *
	 * @example
	 * // Simple sync filter
	 * pipeline
	 *   .add('numbers', getNumbers) // Returns number[]
	 *   .filter('evens', (n) => n % 2 === 0)
	 *   // Now state has: { numbers: number[], evens: number[] }
	 *
	 * @example
	 * // Async filter with API validation
	 * pipeline
	 *   .add('emails', getEmails)
	 *   .filter('valid', async (email) => {
	 *     return await validateEmail(email);
	 *   })
	 *   // Keeps only emails that pass async validation
	 */
	filter<TKey extends string>(
		key: TKey,
		predicate: TCurrentOutput extends (infer TElement)[]
			? (item: TElement, index: number) => boolean | Promise<boolean>
			: never,
	): TCurrentOutput extends (infer TElement)[]
		? TKey extends keyof TAccumulatedState
			? never
			: Pipeline<
					TInitialInput,
					TElement[],
					AddToState<TAccumulatedState, TKey, TElement[]>,
					TContext
				>
		: never {
		const filterStep = createFilterStep<
			ArrayElement<TCurrentOutput>,
			TAccumulatedState,
			TContext
		>(predicate, `filter_${key}`);

		return new Pipeline(
			[...this.stages, { key, step: filterStep }],
			this.contextBuilder,
			// biome-ignore lint/suspicious/noExplicitAny: TypeScript cannot infer complex conditional return type
		) as any;
	}

	/**
	 * Execute the pipeline with the given input.
	 *
	 * Runs all steps in sequence, accumulating state and handling errors.
	 *
	 * **Performance Characteristics:**
	 * - Steps execute sequentially in the order they were added
	 * - List operations (map, filter, etc.) can run in parallel within a step
	 * - Includes retry logic with exponential backoff for configured steps
	 * - Automatic tracing with unique IDs for debugging
	 *
	 * **Error Handling:**
	 * - Stops at first step failure (unless using SKIP_FAILED strategy in list ops)
	 * - Returns detailed error with step name, timing, and trace IDs
	 * - Retry logic applied automatically for retryable errors
	 *
	 * **Metadata:**
	 * Result includes comprehensive metadata:
	 * - Step name and timing information
	 * - Trace ID and span IDs for distributed tracing
	 * - List operation stats (for map/filter/etc.)
	 * - Item-level timing percentiles (p50, p95, p99)
	 *
	 * @param input - The initial input to the pipeline
	 * @returns Promise resolving to StepResult with data or error
	 *
	 * @example
	 * const result = await pipeline.execute('input');
	 * if (result.success) {
	 *   console.log('Data:', result.data);
	 *   console.log('Duration:', result.metadata.durationMs);
	 * } else {
	 *   console.error('Error:', result.error.message);
	 *   console.error('Failed at:', result.metadata.stepName);
	 * }
	 */
	async execute(input: TInitialInput): Promise<StepResult<TCurrentOutput>> {
		const context = this.contextBuilder();
		const traceId = crypto.randomUUID();

		// biome-ignore lint/suspicious/noExplicitAny: Runtime type erasure requires any for dynamic data flow
		let currentData: any = input;
		// biome-ignore lint/suspicious/noExplicitAny: Runtime type erasure requires any for accumulated state
		const accumulatedState: any = {};

		for (const stage of this.stages) {
			const startTime = performance.now();
			const spanId = crypto.randomUUID();

			// Detect if this is a list operation
			const isListOperation = Array.isArray(currentData);
			const listInfo = isListOperation
				? { isListOperation: true, itemCount: currentData.length }
				: { isListOperation: false };

			logger.info({
				event: "step_start",
				traceId,
				spanId,
				stepName: stage.step.name,
				stepKey: stage.key,
				inputType: typeof currentData,
				...listInfo,
			});

			try {
				const result = await this.executeWithRetry(
					stage.step,
					currentData,
					accumulatedState,
					context,
					traceId,
					spanId,
				);

				const endTime = performance.now();
				const metadata: StepMetadata = {
					stepName: stage.step.name,
					startTime,
					endTime,
					durationMs: endTime - startTime,
					traceId,
					spanId,
				};

				if (!result.success) {
					logger.error({
						event: "step_failed",
						traceId,
						spanId,
						stepName: stage.step.name,
						stepKey: stage.key,
						error: result.error,
						durationMs: metadata.durationMs,
					});
					return { ...result, metadata };
				}

				// Include list operation metrics in logs if available
				const logData: Record<string, unknown> = {
					event: "step_complete",
					traceId,
					spanId,
					stepName: stage.step.name,
					stepKey: stage.key,
					durationMs: metadata.durationMs,
				};

				if (result.metadata.listMetadata) {
					const listMeta = result.metadata.listMetadata;
					logData.listOperation = {
						totalItems: listMeta.totalItems,
						successCount: listMeta.successCount,
						failureCount: listMeta.failureCount,
						skippedCount: listMeta.skippedCount,
						executionStrategy: listMeta.executionStrategy,
						...(listMeta.concurrencyLimit && {
							concurrencyLimit: listMeta.concurrencyLimit,
						}),
						...(listMeta.itemTimings && {
							itemTimings: {
								avg: `${listMeta.itemTimings.avg.toFixed(2)}ms`,
								p50: `${listMeta.itemTimings.p50.toFixed(2)}ms`,
								p95: `${listMeta.itemTimings.p95.toFixed(2)}ms`,
								p99: `${listMeta.itemTimings.p99.toFixed(2)}ms`,
							},
						}),
					};
				}

				logger.info(logData);

				// Store in accumulated state
				accumulatedState[stage.key] = result.data;
				currentData = result.data;
			} catch (error) {
				const endTime = performance.now();
				const stepError: StepError = {
					code: "UNHANDLED_ERROR",
					message: error instanceof Error ? error.message : String(error),
					cause: error,
					retryable: false,
				};

				return {
					success: false,
					error: stepError,
					metadata: {
						stepName: stage.step.name,
						startTime,
						endTime,
						durationMs: endTime - startTime,
						traceId,
						spanId,
					},
				};
			}
		}

		return {
			success: true,
			data: currentData as TCurrentOutput,
			metadata: {
				stepName: "pipeline_complete",
				startTime: 0,
				endTime: performance.now(),
				durationMs: 0,
				traceId,
			},
		};
	}

	private async executeWithRetry<I, O, S, C>(
		step: Step<I, O, S, C>,
		input: I,
		state: S,
		context: C,
		traceId: string,
		spanId: string,
	): Promise<StepResult<O>> {
		const maxAttempts = step.retry?.maxAttempts ?? 1;
		const backoffMs = step.retry?.backoffMs ?? 1000;

		let lastResult: StepResult<O> | null = null;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			const ctx: StepExecutionContext<I, S, C> = { input, state, context };
			lastResult = await step.execute(ctx);

			if (lastResult.success) {
				return lastResult;
			}

			const shouldRetry =
				lastResult.error.retryable &&
				attempt < maxAttempts &&
				(!step.retry?.retryableErrors ||
					step.retry.retryableErrors.includes(lastResult.error.code));

			if (!shouldRetry) {
				return lastResult;
			}

			logger.warn({
				event: "step_retry",
				traceId,
				spanId,
				stepName: step.name,
				attempt,
				maxAttempts,
				backoffMs,
				errorCode: lastResult.error.code,
			});

			await Bun.sleep(backoffMs * attempt);
		}

		// biome-ignore lint/style/noNonNullAssertion: lastResult is guaranteed to be set after loop
		return lastResult!;
	}
}
