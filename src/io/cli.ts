import { parseArgs } from 'util';
import { createLogger } from '../core/logging/logger';
import type { LLMClient } from '../llm/types';
import type { ToolDefinition } from '../llm/types';

const logger = createLogger('cli');

export interface CLIOptions {
  llmClient: LLMClient;
  tools: ToolDefinition[];
  systemPrompt?: string;
  model: string;
}

export async function runCLI(options: CLIOptions) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      query: { type: 'string', short: 'q' },
      interactive: { type: 'boolean', short: 'i', default: false },
      verbose: { type: 'boolean', short: 'v', default: false },
      help: { type: 'boolean', short: 'h', default: false }
    },
    strict: false,
    allowPositionals: true
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  if (values.verbose) {
    process.env.LOG_LEVEL = 'debug';
  }

  const systemPrompt = options.systemPrompt || `You are a helpful assistant with access to a knowledge base. Use the available tools to answer user questions accurately.`;

  if (values.query) {
    // Single query mode with -q flag
    await processQuery(options, systemPrompt, values.query);
  } else if (values.interactive) {
    // Interactive mode
    await runInteractive(options, systemPrompt);
  } else {
    // Check for positional arguments (e.g., "llm-orchestrator 'what is the weather?'")
    const positionals = process.argv.slice(2).filter(arg => !arg.startsWith('-'));
    if (positionals.length > 0) {
      const query = positionals.join(' ');
      await processQuery(options, systemPrompt, query);
    } else {
      // Read from stdin
      const stdinText = await Bun.stdin.text();
      const input = stdinText.trim();
      if (input) {
        await processQuery(options, systemPrompt, input);
      } else {
        printHelp();
        process.exit(1);
      }
    }
  }
}

async function processQuery(
  options: CLIOptions,
  systemPrompt: string,
  query: string
) {
  logger.info({ event: 'query_start', query });

  const startTime = performance.now();

  try {
    const response = await options.llmClient.completeWithToolLoop({
      model: options.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: query }
      ],
      tools: options.tools,
      toolChoice: 'auto',
      temperature: 0.7
    });

    const durationMs = performance.now() - startTime;

    logger.info({
      event: 'query_complete',
      durationMs,
      finishReason: response.finishReason,
      usage: response.usage
    });

    // Output just the response content
    console.log(response.message.content);

  } catch (error) {
    logger.error({
      event: 'query_error',
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    console.error('Error processing query:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function runInteractive(
  options: CLIOptions,
  systemPrompt: string
) {
  const messages = [
    { role: 'system' as const, content: systemPrompt }
  ];

  console.log('=== Interactive Mode ===');
  console.log('Type your questions and press Enter. Type "exit" or press Ctrl+C to quit.\n');

  // Use readline-like interface via Bun
  const stdin = process.stdin;
  stdin.setRawMode(false); // Line mode

  const decoder = new TextDecoder();
  let buffer = '';

  process.stdout.write('> ');

  for await (const chunk of stdin) {
    const text = decoder.decode(chunk);
    buffer += text;

    // Check for newline
    if (buffer.includes('\n')) {
      const input = buffer.trim();
      buffer = '';

      if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
        console.log('\nGoodbye!');
        process.exit(0);
      }

      if (!input) {
        process.stdout.write('> ');
        continue;
      }

      messages.push({ role: 'user', content: input });

      try {
        const response = await options.llmClient.completeWithToolLoop({
          model: options.model,
          messages,
          tools: options.tools,
          toolChoice: 'auto',
          temperature: 0.7
        });

        messages.push(response.message);

        console.log('\n' + response.message.content + '\n');
      } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : String(error));
      }

      process.stdout.write('> ');
    }
  }
}

function printHelp() {
  console.log(`
LLM Orchestrator - Type-safe RAG workflow engine

USAGE:
  llm-orchestrator [OPTIONS] [QUERY]
  llm-orchestrator --interactive
  echo "question" | llm-orchestrator

OPTIONS:
  -q, --query <text>      Single query mode (explicit)
  -i, --interactive       Interactive chat mode
  -v, --verbose           Enable debug logging
  -h, --help              Show this help message

EXAMPLES:
  # Single query (positional argument)
  llm-orchestrator "What is TypeScript?"

  # Single query (explicit flag)
  llm-orchestrator --query "Search my notes for project ideas"

  # Interactive mode
  llm-orchestrator --interactive

  # From stdin
  echo "Explain RAG" | llm-orchestrator

  # Verbose mode
  llm-orchestrator --verbose "Debug this query"

ENVIRONMENT VARIABLES:
  LLM_BASE_URL          LLM API endpoint
  LLM_MODEL             Model to use
  LLM_API_KEY           API key (if required)
  EMBEDDING_BASE_URL    Embedding API endpoint
  EMBEDDING_MODEL       Embedding model
  QDRANT_URL            Qdrant server URL
  QDRANT_COLLECTION     Default collection name
  CONFIG_FILE           Path to config.json
  LOG_LEVEL             Logging level (info, debug, etc.)
`);
}
