/**
 * Simple CLI to test the LLM integration with the pipeline system.
 *
 * Usage:
 *   bun run src/test-cli.ts "What is TypeScript?"
 *   bun run src/test-cli.ts --help
 */

import { Pipeline } from './core/pipeline/builder';
import { createStep } from './core/pipeline/steps';
import { OpenAICompatibleClient } from './llm/openai-client';
import type { CompletionResponse } from './llm/types';

// Configuration - customize these for your setup
const LLM_BASE_URL = process.env.LLM_BASE_URL || 'http://localhost:8080/v1';
const LLM_MODEL = process.env.LLM_MODEL || 'qwen2.5:7b';
const LLM_API_KEY = process.env.LLM_API_KEY; // Optional

// Step 1: CLI Input - just validates and passes through the input
const cliInputStep = createStep<string, string>(
  'cli_input',
  async ({ input }) => {
    console.log(`\n[Input] ${input}\n`);
    return input;
  }
);

// Step 2: LLM Call - sends to the LLM and gets response
interface LLMContext {
  llmClient: OpenAICompatibleClient;
  model: string;
}

const llmStep = createStep<string, CompletionResponse, {}, LLMContext>(
  'llm_call',
  async ({ input, context }) => {
    console.log('[LLM] Sending to model...');

    const response = await context.llmClient.complete({
      model: context.model,
      messages: [
        { role: 'system', content: 'You are a helpful assistant. Be concise and clear.' },
        { role: 'user', content: input }
      ],
      temperature: 0.7
    });

    console.log(`[LLM] Received response (${response.usage.totalTokens} tokens)\n`);
    return response;
  }
);

// Step 3: CLI Output - extracts the message content and returns it
const cliOutputStep = createStep<CompletionResponse, string, { cli_input: string; llm_call: CompletionResponse }>(
  'cli_output',
  async ({ input, state }) => {
    const output = input.message.content;
    console.log(`[Output]\n${output}\n`);

    // Show token usage
    console.log(`[Usage] Prompt: ${input.usage.promptTokens}, Completion: ${input.usage.completionTokens}, Total: ${input.usage.totalTokens}`);
    console.log(`[Finish Reason] ${input.finishReason}`);

    return output;
  }
);

// Main CLI function
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
Simple LLM Test CLI

Usage:
  bun run src/test-cli.ts "Your question here"
  bun run src/test-cli.ts --help

Environment Variables:
  LLM_BASE_URL   - Base URL for LLM API (default: http://localhost:8080/v1)
  LLM_MODEL      - Model to use (default: qwen2.5:7b)
  LLM_API_KEY    - API key if required (optional)

Examples:
  bun run src/test-cli.ts "What is TypeScript?"
  LLM_MODEL=gpt-4 bun run src/test-cli.ts "Explain recursion"
    `);
    process.exit(0);
  }

  const userInput = args.join(' ');

  console.log('=== LLM Pipeline Test ===');
  console.log(`Model: ${LLM_MODEL}`);
  console.log(`Endpoint: ${LLM_BASE_URL}`);
  console.log('========================\n');

  // Initialize LLM client
  const clientOptions: {
    baseURL: string;
    apiKey?: string;
    timeout?: number;
  } = {
    baseURL: LLM_BASE_URL,
    timeout: 120000
  };

  if (LLM_API_KEY) {
    clientOptions.apiKey = LLM_API_KEY;
  }

  const llmClient = new OpenAICompatibleClient(clientOptions);

  // Build the pipeline
  const pipeline = Pipeline.start<string, LLMContext>(() => ({
    llmClient,
    model: LLM_MODEL
  }))
    .add('cli_input', cliInputStep)
    .add('llm_call', llmStep)
    .add('cli_output', cliOutputStep);

  // Execute the pipeline
  try {
    const result = await pipeline.execute(userInput);

    if (result.success) {
      console.log(`\n✅ Pipeline completed in ${result.metadata.durationMs.toFixed(2)}ms`);
      process.exit(0);
    } else {
      console.error('\n❌ Pipeline failed:');
      console.error(`   Error: ${result.error.message}`);
      console.error(`   Code: ${result.error.code}`);
      console.error(`   Step: ${result.metadata.stepName}`);
      process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ Unexpected error:');
    console.error(error);
    process.exit(1);
  }
}

main();
