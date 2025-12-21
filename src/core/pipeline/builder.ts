import { createLogger } from "../logging/logger";
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
	 * Execute the pipeline with the given input.
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

			logger.info({
				event: "step_start",
				traceId,
				spanId,
				stepName: stage.step.name,
				stepKey: stage.key,
				inputType: typeof currentData,
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

				logger.info({
					event: "step_complete",
					traceId,
					spanId,
					stepName: stage.step.name,
					stepKey: stage.key,
					durationMs: metadata.durationMs,
				});

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
