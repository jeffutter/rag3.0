import OpenAI from "openai";
import { z } from "zod";
import { createLogger } from "../core/logging/logger";
import { estimateAndFormatTokens } from "./token-estimation";
import type { AssistantMessage, CompletionOptions, CompletionResponse, LLMClient, Message } from "./types";

const logger = createLogger("llm-client");

/**
 * OpenAI-compatible LLM client.
 *
 * Works with:
 * - OpenAI API
 * - llama.cpp server (with --api-key flag)
 * - vLLM
 * - Any OpenAI-compatible endpoint
 */
export class OpenAICompatibleClient implements LLMClient {
  private client: OpenAI;

  constructor(options: {
    baseURL: string;
    apiKey?: string;
    timeout?: number;
  }) {
    this.client = new OpenAI({
      baseURL: options.baseURL,
      apiKey: options.apiKey || "not-required",
      timeout: options.timeout || 120000,
      maxRetries: 3,
    });
  }

  async complete(options: CompletionOptions): Promise<CompletionResponse> {
    const tools = options.tools?.map((tool) => {
      // Use Zod v4's native JSON Schema conversion with OpenAPI 3.0 target
      // biome-ignore lint/suspicious/noExplicitAny: Zod's ZodType needs casting for toJSONSchema
      const jsonSchema = z.toJSONSchema(tool.parameters as any, {
        // target: "openapi-3.0",
        target: "draft-2020-12",
        // unrepresentable: "any", // Handle unsupported types gracefully
      }) as Record<string, unknown>;

      logger.debug({
        event: "tool_schema_generated",
        toolName: tool.name,
        jsonSchema: jsonSchema,
      });

      return {
        type: "function" as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: jsonSchema,
        },
      };
    });

    const createParams: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: options.model,
      messages: this.convertMessages(options.messages, options.model, !!tools?.length),
      temperature: options.temperature ?? 0.7,
    };

    if (tools && tools.length > 0) {
      createParams.tools = tools;
    }

    const toolChoice = this.convertToolChoice(options.toolChoice);
    if (toolChoice) {
      createParams.tool_choice = toolChoice;
    }

    if (options.maxTokens != null) {
      createParams.max_tokens = options.maxTokens;
    }

    if (options.stopSequences != null) {
      createParams.stop = options.stopSequences;
    }

    const { estimatedTokens, formattedSize } = estimateAndFormatTokens(createParams);

    logger.debug({
      event: "completion_params",
      params: createParams,
      estimatedTokens,
      estimatedSize: formattedSize,
    });

    const response = await this.client.chat.completions.create(createParams);

    logger.debug({
      event: "completion_response",
      response: response,
    });

    const choice = response.choices[0];
    if (!choice) {
      throw new Error("No completion choices returned");
    }

    const message = choice.message;

    const toolCalls = message.tool_calls?.map((tc) => {
      if (tc.type === "function") {
        return {
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments),
        };
      }
      throw new Error(`Unsupported tool call type: ${tc.type}`);
    });

    const assistantMessage: AssistantMessage = {
      role: "assistant",
      content: message.content || "",
    };

    if (toolCalls && toolCalls.length > 0) {
      assistantMessage.toolCalls = toolCalls;
    }

    return {
      message: assistantMessage,
      usage: {
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
      },
      finishReason: this.mapFinishReason(choice.finish_reason),
    };
  }

  async completeWithToolLoop(options: CompletionOptions, maxIterations: number = 10): Promise<CompletionResponse> {
    const messages = [...options.messages];
    let lastResponse: CompletionResponse | null = null;

    // Track tool calls to detect loops
    const previousToolCallSignatures = new Set<string>();
    let consecutiveSameToolCount = 0;
    let lastToolName: string | null = null;

    for (let i = 0; i < maxIterations; i++) {
      logger.debug({
        event: "tool_loop_iteration",
        iteration: i + 1,
        maxIterations,
        messageCount: messages.length,
      });

      lastResponse = await this.complete({
        ...options,
        messages,
      });

      // Check if we should stop (model indicated completion OR no tool calls)
      const shouldStop = lastResponse.finishReason !== "tool_calls" || !lastResponse.message.toolCalls?.length;

      if (shouldStop) {
        logger.debug({
          event: "tool_loop_stopping",
          iteration: i + 1,
          finishReason: lastResponse.finishReason,
          hasToolCalls: !!lastResponse.message.toolCalls?.length,
          reason: lastResponse.finishReason !== "tool_calls" ? "model_indicated_completion" : "no_tool_calls",
        });
        return lastResponse;
      }

      // Type narrowing: we know toolCalls exists and has items after the shouldStop check
      const toolCalls = lastResponse.message.toolCalls;
      if (!toolCalls) {
        // This should never happen given the shouldStop check, but satisfies TypeScript
        return lastResponse;
      }

      logger.debug({
        event: "tool_calls_received",
        iteration: i + 1,
        toolCallCount: toolCalls.length,
        toolCalls: toolCalls.map((tc) => ({
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
        })),
      });

      // Check for duplicate tool calls (Fix 1: Duplicate Detection)
      const toolCallSignature = toolCalls
        .map((tc) => `${tc.name}:${JSON.stringify(tc.arguments)}`)
        .sort()
        .join("|");

      if (previousToolCallSignatures.has(toolCallSignature)) {
        logger.warn({
          event: "duplicate_tool_calls_detected",
          iteration: i + 1,
          toolCalls: toolCalls.map((tc) => tc.name),
          signature: toolCallSignature,
        });

        // Force model to respond without tools
        messages.push(lastResponse.message);
        messages.push({
          role: "user",
          content:
            "You've already tried these exact tool calls. Please provide your final answer without using tools again.",
        });

        // Make one final call without tool use (omit tools property to disable)
        const { tools: _tools, ...optionsWithoutTools } = options;
        const finalResponse = await this.complete({
          ...optionsWithoutTools,
          messages,
        });

        return finalResponse;
      }

      previousToolCallSignatures.add(toolCallSignature);

      // Check for consecutive same-tool calls (Fix 2: Consecutive Detection)
      const currentToolName = toolCalls[0]?.name;
      if (currentToolName === lastToolName) {
        consecutiveSameToolCount++;
        if (consecutiveSameToolCount >= 3) {
          logger.warn({
            event: "repeated_tool_calls_detected",
            iteration: i + 1,
            toolName: currentToolName,
            consecutiveCount: consecutiveSameToolCount,
          });

          // Force model to respond without tools (same as duplicate handling)
          messages.push(lastResponse.message);
          messages.push({
            role: "user",
            content: `You've called the "${currentToolName}" tool ${consecutiveSameToolCount} times in a row. Please provide your final answer without using tools again.`,
          });

          // Make one final call without tool use (omit tools property to disable)
          const { tools: _tools, ...optionsWithoutTools } = options;
          const finalResponse = await this.complete({
            ...optionsWithoutTools,
            messages,
          });

          return finalResponse;
        }
      } else {
        consecutiveSameToolCount = 1;
        lastToolName = currentToolName ?? null;
      }

      // Add assistant message with tool calls
      messages.push(lastResponse.message);

      // Execute tools and add results
      for (const toolCall of toolCalls) {
        const tool = options.tools?.find((t) => t.name === toolCall.name);

        if (!tool) {
          logger.error({
            event: "unknown_tool_call",
            toolName: toolCall.name,
            availableTools: options.tools?.map((t) => t.name),
          });
          messages.push({
            role: "tool",
            name: toolCall.name,
            content: JSON.stringify({
              error: `Unknown tool: ${toolCall.name}`,
            }),
            toolCallId: toolCall.id,
          });
          continue;
        }

        try {
          logger.debug({
            event: "tool_validation_start",
            toolName: tool.name,
            rawArguments: toolCall.arguments,
          });

          // Validate arguments against schema
          const validatedArgs = tool.parameters.parse(toolCall.arguments);

          logger.info({
            event: "tool_execution_start",
            toolName: tool.name,
            validatedArguments: validatedArgs,
          });

          const result = await tool.execute(validatedArgs);

          logger.debug({
            event: "tool_execution_result",
            toolName: tool.name,
            resultType: typeof result,
            resultIsArray: Array.isArray(result),
            resultLength: Array.isArray(result) ? result.length : undefined,
            result: result,
          });

          logger.info({
            event: "tool_execution_complete",
            toolName: tool.name,
            resultType: typeof result,
          });

          const toolResultContent = JSON.stringify(result);
          logger.debug({
            event: "tool_result_message",
            toolCallId: toolCall.id,
            contentLength: toolResultContent.length,
            contentPreview: toolResultContent.slice(0, 200),
          });

          messages.push({
            role: "tool",
            content: toolResultContent,
            name: tool.name,
            toolCallId: toolCall.id,
          });
        } catch (error) {
          logger.error({
            event: "tool_execution_error",
            toolName: tool.name,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
          messages.push({
            role: "tool",
            name: tool.name,
            content: JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
            }),
            toolCallId: toolCall.id,
          });
        }
      }
    }

    // Fix 4: Enhanced logging when max iterations reached
    logger.warn({
      event: "tool_loop_max_iterations",
      maxIterations,
      toolCallHistory: Array.from(previousToolCallSignatures),
      lastToolCalls: lastResponse?.message.toolCalls?.map((tc) => ({
        name: tc.name,
        args: tc.arguments,
      })),
      lastFinishReason: lastResponse?.finishReason,
      consecutiveSameToolCount,
      lastToolName,
    });

    // biome-ignore lint/style/noNonNullAssertion: lastResponse is guaranteed to be set after loop
    return lastResponse!;
  }

  private convertMessages(
    messages: Message[],
    model: string,
    hasTools: boolean,
  ): OpenAI.Chat.ChatCompletionMessageParam[] {
    return messages.map((msg, index) => {
      switch (msg.role) {
        case "system": {
          let content = msg.content;

          // LFM2 models (except lfm2-vl-3b) need "force json schema." appended to system prompt
          // when using tools with llama.cpp
          const needsJsonSchemaForce =
            hasTools && model.toLowerCase().includes("lfm2") && !model.toLowerCase().includes("lfm2-vl-3b");

          if (needsJsonSchemaForce && index === messages.findIndex((m) => m.role === "system")) {
            content = `${content}\n\nforce json schema.`;
            logger.debug({
              event: "lfm2_json_schema_force_applied",
              model,
            });
          }

          return { role: "system", content };
        }
        case "user":
          return { role: "user", content: msg.content };
        case "assistant": {
          const assistantMsg = msg as AssistantMessage;
          const toolCalls = assistantMsg.toolCalls?.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          }));

          if (toolCalls && toolCalls.length > 0) {
            return {
              role: "assistant",
              content: msg.content,
              tool_calls: toolCalls,
            };
          }
          return {
            role: "assistant",
            content: msg.content,
          };
        }
        case "tool":
          return {
            role: "tool",
            name: msg.name,
            content: msg.content,
            // biome-ignore lint/style/noNonNullAssertion: toolCallId is required for tool messages
            tool_call_id: msg.toolCallId!,
          };
        default:
          throw new Error(`Unknown message role: ${msg.role}`);
      }
    });
  }

  private convertToolChoice(
    choice?: CompletionOptions["toolChoice"],
  ): OpenAI.Chat.ChatCompletionToolChoiceOption | undefined {
    if (!choice) return undefined;
    if (typeof choice === "string") return choice;
    return { type: "function", function: { name: choice.name } };
  }

  private mapFinishReason(reason: string | null): CompletionResponse["finishReason"] {
    switch (reason) {
      case "stop":
        return "stop";
      case "tool_calls":
        return "tool_calls";
      case "length":
        return "length";
      case "content_filter":
        return "content_filter";
      default:
        return "stop";
    }
  }
}
