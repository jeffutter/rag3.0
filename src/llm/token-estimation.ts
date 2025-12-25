import { encode } from "gpt-tokenizer";
import type OpenAI from "openai";

/**
 * Estimates the number of tokens in a completion request.
 *
 * This is an approximation based on the GPT tokenizer and may not match
 * the exact token count used by all models, but provides a reasonable estimate.
 *
 * @param params - The chat completion parameters
 * @returns Estimated token count for the request
 */
export function estimateCompletionTokens(params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming): number {
  let totalTokens = 0;

  // Estimate tokens from messages
  for (const message of params.messages) {
    // Add tokens for role and formatting (approximately 4 tokens per message overhead)
    totalTokens += 4;

    // Add content tokens
    if ("content" in message && message.content) {
      if (typeof message.content === "string") {
        totalTokens += encode(message.content).length;
      } else if (Array.isArray(message.content)) {
        // Handle content array (e.g., for vision models)
        for (const part of message.content) {
          if ("text" in part && part.text) {
            totalTokens += encode(part.text).length;
          }
          // Note: We can't accurately estimate tokens for images
          // Could add a rough estimate if needed
        }
      }
    }

    // Add tokens for tool calls in assistant messages
    if ("tool_calls" in message && message.tool_calls) {
      for (const toolCall of message.tool_calls) {
        if (toolCall.type === "function") {
          totalTokens += encode(toolCall.function.name).length;
          totalTokens += encode(toolCall.function.arguments).length;
          totalTokens += 10; // Overhead for tool call structure
        }
      }
    }

    // Add tokens for tool message name
    if ("name" in message && message.name) {
      totalTokens += encode(message.name).length;
    }
  }

  // Estimate tokens from tools/functions
  if (params.tools && params.tools.length > 0) {
    for (const tool of params.tools) {
      if (tool.type === "function") {
        // Function name
        totalTokens += encode(tool.function.name).length;

        // Function description
        if (tool.function.description) {
          totalTokens += encode(tool.function.description).length;
        }

        // Function parameters (JSON schema)
        // This is a rough estimate - schemas can be complex
        const schemaStr = JSON.stringify(tool.function.parameters);
        totalTokens += encode(schemaStr).length;

        // Add overhead for function definition structure
        totalTokens += 10;
      }
    }
  }

  // Add base overhead for the request structure
  totalTokens += 3;

  return totalTokens;
}

/**
 * Estimates tokens and formats them for logging with KB/MB indicators.
 *
 * @param params - The chat completion parameters
 * @returns Object with token count and human-readable size
 */
export function estimateAndFormatTokens(params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming): {
  estimatedTokens: number;
  formattedSize: string;
} {
  const estimatedTokens = estimateCompletionTokens(params);

  // Rough estimate: 1 token ≈ 4 bytes
  const estimatedBytes = estimatedTokens * 4;

  let formattedSize: string;
  if (estimatedBytes < 1024) {
    formattedSize = `${estimatedBytes}B`;
  } else if (estimatedBytes < 1024 * 1024) {
    formattedSize = `${(estimatedBytes / 1024).toFixed(1)}KB`;
  } else {
    formattedSize = `${(estimatedBytes / (1024 * 1024)).toFixed(2)}MB`;
  }

  return { estimatedTokens, formattedSize };
}
