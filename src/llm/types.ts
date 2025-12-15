import { z } from 'zod';

/**
 * LLM abstraction layer supporting multiple backends.
 *
 * Key design principle: The interface should be backend-agnostic
 * while supporting the full feature set needed for tool calling
 * and structured output.
 */

// Message types following OpenAI conventions (widely adopted)
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface Message {
  role: MessageRole;
  content: string;
  name?: string;        // For tool messages
  toolCallId?: string;  // For tool results
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AssistantMessage extends Message {
  role: 'assistant';
  toolCalls?: ToolCall[];
}

// Tool definition
export interface ToolDefinition<TArgs = unknown> {
  name: string;
  description: string;
  parameters: z.ZodType<TArgs>;
  execute: (args: TArgs) => Promise<unknown>;
}

// Completion options
export interface CompletionOptions {
  model: string;
  messages: Message[];
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'required' | 'none' | { name: string };
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
}

// Completion response
export interface CompletionResponse {
  message: AssistantMessage;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter';
}

// LLM client interface
export interface LLMClient {
  complete(options: CompletionOptions): Promise<CompletionResponse>;
  completeWithToolLoop(
    options: CompletionOptions,
    maxIterations?: number
  ): Promise<CompletionResponse>;
}
