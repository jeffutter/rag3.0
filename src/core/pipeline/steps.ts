import type { Step, StepError, StepExecutionContext, StepResult } from "./types";

/**
 * Helper functions for creating type-safe steps.
 */

/**
 * Create a type-safe pipeline step.
 *
 * The execute function receives a context object with:
 * - input: The direct output from the previous step
 * - state: Accumulated outputs from all previous steps (by name)
 * - context: Additional runtime context
 *
 * **IMPORTANT: Steps must not call other steps.**
 *
 * Steps are pipeline building blocks designed to be composed in workflows.
 * If you need to share logic between steps, extract it to a utility function
 * in `src/lib/` instead of creating a step that calls another step.
 *
 * @see {@link https://github.com/jeffutter/rag3.0/blob/main/docs/architecture/steps-and-workflows.md} for architecture details
 *
 * @example
 * // Good: Step using a utility function
 * const step = createStep<string, number>('myStep', async ({ input }) => {
 *   // Call utility function for business logic
 *   return await utilityFunction(input);
 * });
 *
 * @example
 * // Bad: Step calling another step (anti-pattern)
 * const badStep = createStep('badStep', async ({ input }) => {
 *   // DON'T DO THIS - creates tight coupling
 *   const result = await otherStep.execute({ input, state: {}, context: undefined });
 *   return result.data;
 * });
 *
 * @example
 * // Type-safe step with state accumulation
 * const step = createStep<string, number, { prevStep: string }>('myStep', async ({ input, state, context }) => {
 *   // input is a string
 *   // state.prevStep is available and typed correctly
 *   return input.length;
 * });
 */
export function createStep<TInput, TOutput, TAccumulatedState = Record<string, never>, TContext = unknown>(
  name: string,
  execute: (ctx: StepExecutionContext<TInput, TAccumulatedState, TContext>) => Promise<TOutput>,
  options?: {
    retry?: {
      maxAttempts: number;
      backoffMs: number;
      retryableErrors?: string[];
    };
  },
): Step<TInput, TOutput, TAccumulatedState, TContext> {
  const step: Step<TInput, TOutput, TAccumulatedState, TContext> = {
    name,
    execute: async (ctx): Promise<StepResult<TOutput>> => {
      try {
        const data = await execute(ctx);
        return {
          success: true,
          data,
          metadata: {
            stepName: name,
            startTime: 0,
            endTime: 0,
            durationMs: 0,
          },
        };
      } catch (error) {
        // Extract error code - prefer explicit code property, fall back to message for common error patterns
        let errorCode = "STEP_ERROR";
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (error instanceof Error && "code" in error) {
          // biome-ignore lint/suspicious/noExplicitAny: Error.code is not typed in TypeScript
          errorCode = String((error as any).code);
        } else if (error instanceof Error) {
          // Check if error message matches common error codes
          const knownErrors = ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "RATE_LIMIT"];
          const matchedCode = knownErrors.find((code) => errorMessage.includes(code));
          if (matchedCode) {
            errorCode = matchedCode;
          }
        }

        const stepError: StepError = {
          code: errorCode,
          message: errorMessage,
          cause: error,
          retryable: isRetryableError(error),
        };
        return {
          success: false,
          error: stepError,
          metadata: {
            stepName: name,
            startTime: 0,
            endTime: 0,
            durationMs: 0,
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

function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    // Network errors, timeouts, etc.
    const retryableMessages = ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "fetch failed", "rate limit"];
    return retryableMessages.some((msg) => error.message.toLowerCase().includes(msg.toLowerCase()));
  }
  return false;
}

/**
 * Create a passthrough step that transforms data without async operations.
 *
 * @example
 * const upperCase = createTransform('upperCase', (input: string) => input.toUpperCase());
 */
export function createTransform<TInput, TOutput, TAccumulatedState = Record<string, never>>(
  name: string,
  transform: (input: TInput, state: TAccumulatedState) => TOutput,
): Step<TInput, TOutput, TAccumulatedState, unknown> {
  return createStep(name, async ({ input, state }) => transform(input, state));
}

/**
 * Create a step that runs multiple sub-steps in parallel.
 *
 * @example
 * const parallel = createParallel('fetchAll', [step1, step2, step3]);
 */
export function createParallel<
  TInput,
  TOutputs extends readonly unknown[],
  TAccumulatedState = Record<string, never>,
  TContext = unknown,
>(
  name: string,
  steps: {
    [K in keyof TOutputs]: Step<TInput, TOutputs[K], TAccumulatedState, TContext>;
  },
): Step<TInput, TOutputs, TAccumulatedState, TContext> {
  return createStep(name, async (ctx) => {
    const results = await Promise.all(steps.map((step) => step.execute(ctx)));

    // Check for failures
    const failed = results.find((r) => !r.success);
    if (failed && !failed.success) {
      throw new Error(`Parallel step failed: ${failed.error.message}`);
    }

    return results.map((r) => (r.success ? r.data : null)) as unknown as TOutputs;
  });
}
