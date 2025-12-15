# CLI Usage Guide

The LLM Orchestrator provides a flexible command-line interface for querying your RAG-enabled LLM.

## Quick Start

```bash
# Single query (positional argument)
bun start "What is TypeScript?"

# Single query (explicit flag)
bun start --query "Search my notes for project ideas"

# From stdin
echo "Explain RAG" | bun start

# Interactive mode
bun start --interactive

# Verbose debug mode
bun start --verbose "Debug this query"
```

## Installation

1. Copy the example config:
   ```bash
   cp config.example.json config.json
   ```

2. Edit `config.json` with your settings, or use environment variables (see below)

3. Run the application:
   ```bash
   bun start "your query"
   ```

## Configuration

### Option 1: Config File

Create `config.json` (or specify a custom path with `CONFIG_FILE` env var):

```json
{
  "llm": {
    "baseURL": "http://localhost:8080/v1",
    "model": "qwen2.5:7b",
    "apiKey": "optional-api-key"
  },
  "embedding": {
    "baseURL": "http://localhost:8080/v1",
    "model": "nomic-embed-text"
  },
  "qdrant": {
    "url": "http://localhost:6333",
    "defaultCollection": "rag_store"
  },
  "logging": {
    "level": "info",
    "pretty": true
  }
}
```

### Option 2: Environment Variables

```bash
export LLM_BASE_URL="http://localhost:8080/v1"
export LLM_MODEL="qwen2.5:7b"
export EMBEDDING_BASE_URL="http://localhost:8080/v1"
export EMBEDDING_MODEL="nomic-embed-text"
export QDRANT_URL="http://localhost:6333"
export QDRANT_COLLECTION="rag_store"
export LOG_LEVEL="info"
```

Then use the existing `.env` file or export them in your shell.

## Usage Modes

### 1. Single Query Mode (Positional)

The simplest way to ask a question:

```bash
bun start "What is the BFF project?"
```

### 2. Single Query Mode (Explicit)

Using the `-q` or `--query` flag:

```bash
bun start --query "What is the BFF project?"
```

### 3. Stdin Mode

Pipe input from other commands:

```bash
echo "Explain TypeScript" | bun start
cat question.txt | bun start
```

### 4. Interactive Mode

Start a chat session:

```bash
bun start --interactive
```

In interactive mode:
- Type your questions and press Enter
- Type `exit` or `quit` to end the session
- Press Ctrl+C to quit

Example session:
```
=== Interactive Mode ===
Type your questions and press Enter. Type "exit" or press Ctrl+C to quit.

> What is the BFF project?

The BFF (Backend for Frontend) project is a technical initiative...

> Tell me more about the team

The team includes Rami, Seah, and Mike...

> exit

Goodbye!
```

### 5. Verbose/Debug Mode

Enable detailed logging to see what's happening:

```bash
bun start --verbose "Debug this query"
```

This shows:
- Tool execution details
- Vector search results
- Token usage
- Timing information

## Command Reference

```
llm-orchestrator [OPTIONS] [QUERY]

OPTIONS:
  -q, --query <text>      Single query mode (explicit)
  -i, --interactive       Interactive chat mode
  -v, --verbose           Enable debug logging
  -h, --help              Show help message

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
```

## LLM Backend Support

The CLI works with any OpenAI-compatible API:

### llama.cpp

```bash
# Start llama.cpp server
llama-server --model model.gguf --port 8080

# Configure
export LLM_BASE_URL="http://localhost:8080/v1"
export LLM_MODEL="model-name"
```

### Ollama

```bash
# Ollama automatically runs on port 11434
export LLM_BASE_URL="http://localhost:11434/v1"
export LLM_MODEL="qwen2.5:7b"
```

### OpenAI

```bash
export LLM_BASE_URL="https://api.openai.com/v1"
export LLM_API_KEY="sk-..."
export LLM_MODEL="gpt-4"
```

### vLLM

```bash
# Start vLLM server
python -m vllm.entrypoints.openai.api_server --model model-name --port 8000

# Configure
export LLM_BASE_URL="http://localhost:8000/v1"
export LLM_MODEL="model-name"
```

## RAG Tool Integration

The CLI automatically has access to the `search_knowledge_base` tool, which:
1. Generates embeddings for your query
2. Searches the Qdrant vector database
3. Returns relevant documents to the LLM
4. The LLM synthesizes the information into a response

The LLM autonomously decides when to use this tool based on your question.

## Building for Production

### Compile to Binary

```bash
bun run build
```

This creates a standalone binary at `dist/llm-orchestrator`.

### Run the Binary

```bash
./dist/llm-orchestrator "What is TypeScript?"
```

The binary includes all dependencies and doesn't require Bun to be installed.

## Examples

### Search your notes

```bash
bun start "Search my notes for information about authentication"
```

### Get a quick answer

```bash
bun start "What is 2+2?"
```

### Pipe from files

```bash
cat meeting-notes.txt | bun start
```

### Debug a query

```bash
bun start --verbose "Why isn't the search working?"
```

This will show all the debug logs including HTTP requests, vector search parameters, and results.

## Troubleshooting

### "Failed to load configuration"

Make sure you have either:
- A valid `config.json` file, or
- All required environment variables set

### "Connection refused" errors

Check that:
- Your LLM server is running
- The `LLM_BASE_URL` is correct
- The Qdrant server is running (if using RAG)

### No results from RAG search

Enable verbose mode to see what's happening:
```bash
bun start --verbose "your query"
```

Check the `DEBUGGING.md` file for detailed troubleshooting steps.

## See Also

- `DEBUGGING.md` - Detailed debugging guide
- `RAG-DEMO.md` - RAG setup and testing
- `SETUP.md` - Initial setup instructions
