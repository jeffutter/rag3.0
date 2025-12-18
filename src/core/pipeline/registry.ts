import type { z } from 'zod';
import type { Pipeline } from './builder';

/**
 * Pipeline registry for managing and exposing pipelines
 * as MCP tools and webhook endpoints.
 */

export interface RegisteredPipeline<TInput = unknown, TOutput = unknown, TContext = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;
  // biome-ignore lint/suspicious/noExplicitAny: Pipeline state type is dynamic and varies per pipeline
  pipeline: Pipeline<TInput, TOutput, any, TContext>;
  contextBuilder: () => TContext;
  tags?: string[];
  examples?: Array<{ input: TInput; description: string }>;
}

export class PipelineRegistry {
  private pipelines = new Map<string, RegisteredPipeline>();

  /**
   * Register a pipeline to be exposed as an MCP tool or webhook endpoint.
   */
  register<TInput, TOutput, TContext>(
    pipeline: RegisteredPipeline<TInput, TOutput, TContext>
  ): this {
    if (this.pipelines.has(pipeline.name)) {
      throw new Error(`Pipeline already registered: ${pipeline.name}`);
    }

    this.pipelines.set(pipeline.name, pipeline as RegisteredPipeline);
    return this;
  }

  /**
   * Get a registered pipeline by name.
   */
  get(name: string): RegisteredPipeline | undefined {
    return this.pipelines.get(name);
  }

  /**
   * Get all registered pipelines.
   */
  getAll(): RegisteredPipeline[] {
    return Array.from(this.pipelines.values());
  }

  /**
   * Get pipelines filtered by tags.
   */
  getByTags(tags: string[]): RegisteredPipeline[] {
    return this.getAll().filter(pipeline =>
      pipeline.tags?.some(tag => tags.includes(tag))
    );
  }

  /**
   * Check if a pipeline is registered.
   */
  has(name: string): boolean {
    return this.pipelines.has(name);
  }

  /**
   * Execute a registered pipeline.
   */
  async execute<TInput, TOutput>(
    name: string,
    input: TInput
  ): Promise<{ success: boolean; data?: TOutput; error?: string }> {
    const registered = this.pipelines.get(name);
    if (!registered) {
      return {
        success: false,
        error: `Pipeline not found: ${name}`
      };
    }

    try {
      // Validate input
      const validatedInput = registered.inputSchema.parse(input);

      // Execute pipeline
      const result = await registered.pipeline.execute(validatedInput);

      if (result.success) {
        // Validate output
        const validatedOutput = registered.outputSchema.parse(result.data);
        return {
          success: true,
          data: validatedOutput as TOutput
        };
      } else {
        return {
          success: false,
          error: result.error.message
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}
