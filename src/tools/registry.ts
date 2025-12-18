import type { ToolDefinition } from '../llm/types';

/**
 * Type-safe tool registry.
 *
 * Tools are defined with Zod schemas for:
 * 1. Runtime argument validation
 * 2. JSON Schema generation for LLM tool descriptions
 * 3. TypeScript type inference for execute functions
 */

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register<TArgs>(tool: ToolDefinition<TArgs>): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool as ToolDefinition);
    return this;
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }
}

// Factory function for creating tools with full type inference
export function defineTool<TArgs>(
  definition: ToolDefinition<TArgs>
): ToolDefinition<TArgs> {
  return definition;
}
