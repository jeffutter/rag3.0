import type { Step, StepResult, StepMetadata, StepError } from './types';
import { createLogger } from '../logging/logger';

const logger = createLogger('pipeline');

/**
 * Type-safe pipeline builder using a fluent interface.
 *
 * The key to compile-time type safety is that each `pipe()` call
 * returns a new Pipeline type that encodes both:
 * - The current output type (which becomes the next input type)
 * - The accumulated context requirements
 *
 * This means TypeScript will catch mismatched step types at compile time,
 * not runtime.
 */

// Internal representation of a pipeline stage
interface PipelineStage<TIn, TOut, TCtx> {
  step: Step<TIn, TOut, TCtx>;
}

// The Pipeline class with generic type tracking
export class Pipeline<TInput, TOutput, TContext> {
  private stages: PipelineStage<any, any, any>[] = [];
  private contextBuilder: () => TContext;

  private constructor(
    stages: PipelineStage<any, any, any>[],
    contextBuilder: () => TContext
  ) {
    this.stages = stages;
    this.contextBuilder = contextBuilder;
  }

  /**
   * Create a new pipeline starting with an initial step.
   *
   * @example
   * const pipeline = Pipeline.create(embeddingStep);
   */
  static create<I, O, C>(
    step: Step<I, O, C>,
    contextBuilder: () => C
  ): Pipeline<I, O, C> {
    return new Pipeline([{ step }], contextBuilder);
  }

  /**
   * Add a step to the pipeline.
   *
   * TypeScript enforces that NextIn === TOutput at compile time.
   * If you try to pipe a step that expects a different input type,
   * you'll get a compile error.
   *
   * @example
   * pipeline
   *   .pipe(vectorSearchStep)  // Output: SearchResults
   *   .pipe(rerankStep)        // Input must be SearchResults
   */
  pipe<NextOut, NextCtx>(
    step: Step<TOutput, NextOut, TContext & NextCtx>
  ): Pipeline<TInput, NextOut, TContext & NextCtx> {
    return new Pipeline(
      [...this.stages, { step }],
      this.contextBuilder as () => TContext & NextCtx
    );
  }

  /**
   * Add a conditional branch to the pipeline.
   * Both branches must have the same output type.
   */
  branch<BranchOut>(
    condition: (input: TOutput, context: TContext) => boolean,
    trueBranch: Step<TOutput, BranchOut, TContext>,
    falseBranch: Step<TOutput, BranchOut, TContext>
  ): Pipeline<TInput, BranchOut, TContext> {
    const branchStep: Step<TOutput, BranchOut, TContext> = {
      name: `branch(${trueBranch.name}|${falseBranch.name})`,
      execute: async (input, context) => {
        const selectedStep = condition(input, context) ? trueBranch : falseBranch;
        return selectedStep.execute(input, context);
      }
    };
    return new Pipeline(
      [...this.stages, { step: branchStep }],
      this.contextBuilder
    );
  }

  /**
   * Execute the pipeline with the given input.
   */
  async execute(input: TInput): Promise<StepResult<TOutput>> {
    const context = this.contextBuilder();
    const traceId = crypto.randomUUID();

    let currentData: any = input;

    for (const stage of this.stages) {
      const startTime = performance.now();
      const spanId = crypto.randomUUID();

      logger.info({
        event: 'step_start',
        traceId,
        spanId,
        stepName: stage.step.name,
        inputType: typeof currentData
      });

      try {
        const result = await this.executeWithRetry(
          stage.step,
          currentData,
          context,
          traceId,
          spanId
        );

        const endTime = performance.now();
        const metadata: StepMetadata = {
          stepName: stage.step.name,
          startTime,
          endTime,
          durationMs: endTime - startTime,
          traceId,
          spanId
        };

        if (!result.success) {
          logger.error({
            event: 'step_failed',
            traceId,
            spanId,
            stepName: stage.step.name,
            error: result.error,
            durationMs: metadata.durationMs
          });
          return { ...result, metadata };
        }

        logger.info({
          event: 'step_complete',
          traceId,
          spanId,
          stepName: stage.step.name,
          durationMs: metadata.durationMs
        });

        currentData = result.data;
      } catch (error) {
        const endTime = performance.now();
        const stepError: StepError = {
          code: 'UNHANDLED_ERROR',
          message: error instanceof Error ? error.message : String(error),
          cause: error,
          retryable: false
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
            spanId
          }
        };
      }
    }

    return {
      success: true,
      data: currentData as TOutput,
      metadata: {
        stepName: 'pipeline_complete',
        startTime: 0,
        endTime: performance.now(),
        durationMs: 0,
        traceId
      }
    };
  }

  private async executeWithRetry<I, O, C>(
    step: Step<I, O, C>,
    input: I,
    context: C,
    traceId: string,
    spanId: string
  ): Promise<StepResult<O>> {
    const maxAttempts = step.retry?.maxAttempts ?? 1;
    const backoffMs = step.retry?.backoffMs ?? 1000;

    let lastResult: StepResult<O> | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      lastResult = await step.execute(input, context);

      if (lastResult.success) {
        return lastResult;
      }

      const shouldRetry = lastResult.error.retryable &&
        attempt < maxAttempts &&
        (!step.retry?.retryableErrors ||
         step.retry.retryableErrors.includes(lastResult.error.code));

      if (!shouldRetry) {
        return lastResult;
      }

      logger.warn({
        event: 'step_retry',
        traceId,
        spanId,
        stepName: step.name,
        attempt,
        maxAttempts,
        backoffMs,
        errorCode: lastResult.error.code
      });

      await Bun.sleep(backoffMs * attempt);
    }

    return lastResult!;
  }
}
