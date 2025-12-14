import type { Step, StepResult, StepError } from './types';

/**
 * Helper functions for creating type-safe steps.
 */

export function createStep<TInput, TOutput, TContext = unknown>(
  name: string,
  execute: (input: TInput, context: TContext) => Promise<TOutput>,
  options?: {
    retry?: {
      maxAttempts: number;
      backoffMs: number;
      retryableErrors?: string[];
    };
  }
): Step<TInput, TOutput, TContext> {
  const step: Step<TInput, TOutput, TContext> = {
    name,
    execute: async (input, context): Promise<StepResult<TOutput>> => {
      try {
        const data = await execute(input, context);
        return {
          success: true,
          data,
          metadata: {
            stepName: name,
            startTime: 0,
            endTime: 0,
            durationMs: 0
          }
        };
      } catch (error) {
        const stepError: StepError = {
          code: error instanceof Error && 'code' in error
            ? String((error as any).code)
            : 'STEP_ERROR',
          message: error instanceof Error ? error.message : String(error),
          cause: error,
          retryable: isRetryableError(error)
        };
        return {
          success: false,
          error: stepError,
          metadata: {
            stepName: name,
            startTime: 0,
            endTime: 0,
            durationMs: 0
          }
        };
      }
    }
  };

  if (options?.retry) {
    step.retry = options.retry;
  }

  return step;
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    // Network errors, timeouts, etc.
    const retryableMessages = [
      'ECONNRESET',
      'ETIMEDOUT',
      'ECONNREFUSED',
      'fetch failed',
      'rate limit'
    ];
    return retryableMessages.some(msg =>
      error.message.toLowerCase().includes(msg.toLowerCase())
    );
  }
  return false;
}

/**
 * Create a passthrough step that transforms data without async operations.
 */
export function createTransform<TInput, TOutput>(
  name: string,
  transform: (input: TInput) => TOutput
): Step<TInput, TOutput, unknown> {
  return createStep(name, async (input) => transform(input));
}

/**
 * Create a step that runs multiple sub-steps in parallel.
 */
export function createParallel<TInput, TOutputs extends readonly unknown[]>(
  name: string,
  steps: { [K in keyof TOutputs]: Step<TInput, TOutputs[K], unknown> }
): Step<TInput, TOutputs, unknown> {
  return createStep(name, async (input) => {
    const results = await Promise.all(
      steps.map(step => step.execute(input, {}))
    );

    // Check for failures
    const failed = results.find(r => !r.success);
    if (failed && !failed.success) {
      throw new Error(`Parallel step failed: ${failed.error.message}`);
    }

    return results.map(r => r.success ? r.data : null) as unknown as TOutputs;
  });
}
