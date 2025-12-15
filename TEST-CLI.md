# Test CLI - Quick Start Guide

A simple CLI to test the LLM integration with the pipeline system.

## Prerequisites

You need a running LLM server that's OpenAI-compatible. Options:

### Option 1: llama.cpp server (Recommended for local testing)
```bash
# Download and run llama.cpp
# See: https://github.com/ggerganov/llama.cpp

# Example with a small model:
./llama-server -m models/qwen2.5-7b-instruct.gguf -c 4096 --port 8080
```

### Option 2: Ollama (Easiest)
```bash
# Install Ollama: https://ollama.ai
ollama serve

# In another terminal:
ollama pull qwen2.5:7b

# Set environment to use Ollama:
export LLM_BASE_URL=http://localhost:11434/v1
export LLM_MODEL=qwen2.5:7b
```

### Option 3: OpenAI API
```bash
export LLM_BASE_URL=https://api.openai.com/v1
export LLM_MODEL=gpt-4
export LLM_API_KEY=your-api-key-here
```

## Usage

### Basic usage (with default settings):
```bash
bun run test-cli "What is TypeScript?"
```

### With custom model:
```bash
LLM_MODEL=gpt-4 bun run test-cli "Explain recursion"
```

### With Ollama:
```bash
LLM_BASE_URL=http://localhost:11434/v1 LLM_MODEL=llama3:8b bun run test-cli "Hello!"
```

### Help:
```bash
bun run test-cli --help
```

## How It Works

The CLI demonstrates the full pipeline system with three steps:

1. **CLI Input** - Validates and displays the user's input
2. **LLM Call** - Sends the input to the LLM and gets a response
3. **CLI Output** - Displays the response and usage statistics

Each step has access to the accumulated state from previous steps, demonstrating the type-safe pipeline architecture.

## Example Output

```bash
$ bun run test-cli "What is TypeScript in one sentence?"

=== LLM Pipeline Test ===
Model: qwen2.5:7b
Endpoint: http://localhost:8080/v1
========================

[Input] What is TypeScript in one sentence?

[LLM] Sending to model...
[LLM] Received response (45 tokens)

[Output]
TypeScript is a statically typed superset of JavaScript that adds optional type annotations and compile-time type checking to help catch errors early.

[Usage] Prompt: 28, Completion: 17, Total: 45
[Finish Reason] stop

✅ Pipeline completed in 342.15ms
```

## Troubleshooting

**Connection refused:**
- Make sure your LLM server is running
- Check the `LLM_BASE_URL` is correct
- For llama.cpp, ensure the server is started with the OpenAI-compatible API

**Model not found:**
- Verify the model name matches what's available on your server
- For Ollama, run `ollama list` to see available models

**API key errors:**
- Only needed for OpenAI or services requiring authentication
- Set `LLM_API_KEY` environment variable if required
