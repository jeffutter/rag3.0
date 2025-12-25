import { expect, test } from "bun:test";
import type OpenAI from "openai";
import { estimateAndFormatTokens, estimateCompletionTokens } from "./token-estimation";

test("estimateCompletionTokens - simple message", () => {
  const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
    model: "gpt-4",
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hello, how are you?" },
    ],
  };

  const tokens = estimateCompletionTokens(params);

  // Should be > 0 and reasonable (system + user messages + overhead)
  expect(tokens).toBeGreaterThan(0);
  expect(tokens).toBeLessThan(100); // Simple messages shouldn't be huge
});

test("estimateCompletionTokens - with tools", () => {
  const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
    model: "gpt-4",
    messages: [{ role: "user", content: "Search for information about TypeScript." }],
    tools: [
      {
        type: "function",
        function: {
          name: "search",
          description: "Search for information",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string" },
            },
            required: ["query"],
          },
        },
      },
    ],
  };

  const tokens = estimateCompletionTokens(params);

  // Should include message + tool definition
  expect(tokens).toBeGreaterThan(0);
});

test("estimateCompletionTokens - with tool calls", () => {
  const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
    model: "gpt-4",
    messages: [
      { role: "user", content: "Search for TypeScript" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call_123",
            type: "function",
            function: {
              name: "search",
              arguments: JSON.stringify({ query: "TypeScript" }),
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_123",
        content: JSON.stringify({ results: ["TypeScript is a programming language"] }),
      },
    ],
  };

  const tokens = estimateCompletionTokens(params);

  // Should include all messages including tool calls and results
  expect(tokens).toBeGreaterThan(0);
});

test("estimateAndFormatTokens - formats sizes correctly", () => {
  const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
    model: "gpt-4",
    messages: [{ role: "user", content: "Hello" }],
  };

  const { estimatedTokens, formattedSize } = estimateAndFormatTokens(params);

  expect(estimatedTokens).toBeGreaterThan(0);
  expect(formattedSize).toMatch(/\d+(\.\d+)?(B|KB|MB)/); // Should match pattern like "123B", "1.2KB", or "1.23MB"
});

test("estimateCompletionTokens - empty messages", () => {
  const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
    model: "gpt-4",
    messages: [],
  };

  const tokens = estimateCompletionTokens(params);

  // Should have minimal overhead even with empty messages
  expect(tokens).toBeGreaterThanOrEqual(0);
});
