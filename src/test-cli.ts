/**
 * Simple CLI to test the LLM integration with RAG tool calling.
 *
 * Usage:
 *   bun run src/test-cli.ts "What is TypeScript?"
 *   bun run src/test-cli.ts "Search my notes for information about TypeScript"
 *   bun run src/test-cli.ts --help
 */

import { Pipeline } from './core/pipeline/builder';
import { createStep } from './core/pipeline/steps';
import { OpenAICompatibleClient } from './llm/openai-client';
import type { CompletionResponse, ToolDefinition } from './llm/types';
import { VectorSearchClient } from './retrieval/qdrant-client';
import { createRAGSearchTool } from './tools/rag-search';

// LLM Configuration
const LLM_BASE_URL = process.env.LLM_BASE_URL || 'http://localhost:8080/v1';
const LLM_MODEL = process.env.LLM_MODEL || 'qwen2.5:7b';
const LLM_API_KEY = process.env.LLM_API_KEY;

// Embedding Configuration (for RAG)
const EMBEDDING_BASE_URL = process.env.EMBEDDING_BASE_URL || process.env.LLM_BASE_URL || 'http://localhost:8080/v1';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'nomic-embed-text';
const EMBEDDING_API_KEY = process.env.EMBEDDING_API_KEY || process.env.LLM_API_KEY;

// Qdrant Configuration
const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;
const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION || 'rag_store';

// Step 1: CLI Input - just validates and passes through the input
const cliInputStep = createStep<string, string>(
  'cli_input',
  async ({ input }) => {
    console.log(`\n[Input] ${input}\n`);
    return input;
  }
);

// Step 2: LLM Call - sends to the LLM with RAG tool support
interface LLMContext {
  llmClient: OpenAICompatibleClient;
  model: string;
  // biome-ignore lint/suspicious/noExplicitAny: Tools can have various argument types
  tools: ToolDefinition<any>[];
}

// biome-ignore lint/complexity/noBannedTypes: Empty state for first step in pipeline
const llmStep = createStep<string, CompletionResponse, {}, LLMContext>(
  'llm_call',
  async ({ input, context }) => {
    console.log('[LLM] Sending to model with RAG tool support...');

    const response = await context.llmClient.completeWithToolLoop({
      model: context.model,
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant. You have access to a knowledge base search tool. Use it when the user asks about specific information that might be in their notes or documents. Be concise and clear.'
        },
        { role: 'user', content: input }
      ],
      tools: context.tools,
      toolChoice: 'auto',
      temperature: 0.7
    }, 5); // Max 5 iterations for tool calls

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
LLM Test CLI with RAG Tool Support

Usage:
  bun run src/test-cli.ts "Your question here"
  bun run src/test-cli.ts --help

Environment Variables:
  LLM Configuration:
    LLM_BASE_URL        - Base URL for LLM API (default: http://localhost:8080/v1)
    LLM_MODEL           - Model to use (default: qwen2.5:7b)
    LLM_API_KEY         - API key if required (optional)

  Embedding Configuration (for RAG):
    EMBEDDING_BASE_URL  - Embedding API endpoint (default: same as LLM_BASE_URL)
    EMBEDDING_MODEL     - Embedding model (default: nomic-embed-text)
    EMBEDDING_API_KEY   - Embedding API key (default: same as LLM_API_KEY)

  Qdrant Configuration:
    QDRANT_URL          - Qdrant server URL (default: http://localhost:6333)
    QDRANT_API_KEY      - Qdrant API key (optional)
    QDRANT_COLLECTION   - Collection name (default: rag_store)

Examples:
  # Simple question (no RAG needed)
  bun run src/test-cli.ts "What is 2+2?"

  # Question that might trigger RAG search
  bun run src/test-cli.ts "Search my notes for information about TypeScript"

  # With custom model
  LLM_MODEL=gpt-4 bun run src/test-cli.ts "Explain recursion"

Note: The LLM will automatically decide whether to use the RAG search tool based on your question.
    `);
    process.exit(0);
  }

  const userInput = args.join(' ');

  console.log('=== LLM Pipeline Test with RAG ===');
  console.log(`LLM Model: ${LLM_MODEL}`);
  console.log(`LLM Endpoint: ${LLM_BASE_URL}`);
  console.log(`Embedding Model: ${EMBEDDING_MODEL}`);
  console.log(`Qdrant: ${QDRANT_URL}`);
  console.log(`Collection: ${QDRANT_COLLECTION}`);
  console.log('===================================\n');

  // Initialize LLM client
  const llmClientOptions: {
    baseURL: string;
    apiKey?: string;
    timeout?: number;
  } = {
    baseURL: LLM_BASE_URL,
    timeout: 120000
  };

  if (LLM_API_KEY) {
    llmClientOptions.apiKey = LLM_API_KEY;
  }

  const llmClient = new OpenAICompatibleClient(llmClientOptions);

  // Initialize Qdrant client
  const qdrantClientConfig: {
    url: string;
    apiKey?: string;
  } = { url: QDRANT_URL };

  if (QDRANT_API_KEY) {
    qdrantClientConfig.apiKey = QDRANT_API_KEY;
  }

  const vectorClient = new VectorSearchClient(qdrantClientConfig);

  // Create RAG search tool
  const embeddingConfig: {
    baseURL: string;
    model: string;
    apiKey?: string;
  } = {
    baseURL: EMBEDDING_BASE_URL,
    model: EMBEDDING_MODEL
  };

  if (EMBEDDING_API_KEY) {
    embeddingConfig.apiKey = EMBEDDING_API_KEY;
  }

  const ragTool = createRAGSearchTool({
    vectorClient,
    embeddingConfig,
    defaultCollection: QDRANT_COLLECTION
  });

  // biome-ignore lint/suspicious/noExplicitAny: Tools can have various argument types
  const tools: ToolDefinition<any>[] = [ragTool];

  // Build the pipeline
  const pipeline = Pipeline.start<string, LLMContext>(() => ({
    llmClient,
    model: LLM_MODEL,
    tools
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
