import OpenAI from "openai";
import { z } from "zod";
import { createLogger } from "../core/logging/logger";
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
      messages: this.convertMessages(options.messages),
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

    logger.debug({
      event: "completion_params",
      params: createParams,
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

      // If no tool calls, we're done
      if (!lastResponse.message.toolCalls?.length) {
        logger.debug({
          event: "no_tool_calls",
          iteration: i + 1,
          finishReason: lastResponse.finishReason,
        });
        return lastResponse;
      }

      logger.debug({
        event: "tool_calls_received",
        iteration: i + 1,
        toolCallCount: lastResponse.message.toolCalls.length,
        toolCalls: lastResponse.message.toolCalls.map((tc) => ({
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
        })),
      });

      // Add assistant message with tool calls
      messages.push(lastResponse.message);

      // Execute tools and add results
      for (const toolCall of lastResponse.message.toolCalls) {
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

    logger.warn({
      event: "tool_loop_max_iterations",
      maxIterations,
    });

    // biome-ignore lint/style/noNonNullAssertion: lastResponse is guaranteed to be set after loop
    return lastResponse!;
  }

  private convertMessages(messages: Message[]): OpenAI.Chat.ChatCompletionMessageParam[] {
    return messages.map((msg) => {
      switch (msg.role) {
        case "system":
          return { role: "system", content: msg.content };
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
