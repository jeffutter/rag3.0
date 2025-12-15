# MCP and Webhook Server Guide

This guide explains how to use the LLM Orchestrator's MCP (Model Context Protocol) and Webhook servers to expose pipelines as tools or HTTP endpoints.

## Overview

The LLM Orchestrator can run in two server modes:

1. **MCP Mode**: Expose pipelines as tools for Claude Desktop and other MCP clients
2. **Webhook Mode**: Expose pipelines as HTTP endpoints for external systems

Both modes use the same pipeline registry, allowing you to write a pipeline once and expose it through both interfaces.

## Quick Start

### Webhook Mode

```bash
# Start webhook server
WEBHOOK_API_KEY=your-secret-key bun run server:webhook

# Or use environment variables
export WEBHOOK_API_KEY=your-secret-key
export WEBHOOK_PORT=3000
export WEBHOOK_HOST=0.0.0.0
bun run server:webhook
```

### MCP Mode

```bash
# Start MCP server (stdio transport for Claude Desktop)
bun run server:mcp
```

## Webhook Server

### Endpoints

#### Health Check
```bash
curl http://localhost:3000/health
# Response: {"status":"ok"}
```

#### List Pipelines
```bash
curl -H "Authorization: Bearer your-secret-key" \
  http://localhost:3000/webhook/list
```

Response:
```json
{
  "pipelines": [
    {
      "name": "rag_query",
      "description": "Answer questions using RAG...",
      "tags": ["rag", "query", "search"],
      "examples": [...]
    }
  ]
}
```

#### Execute Pipeline
```bash
curl -X POST http://localhost:3000/webhook/rag_query \
  -H "Authorization: Bearer your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{"query": "What is TypeScript?"}'
```

Response:
```json
{
  "success": true,
  "pipelineName": "rag_query",
  "executionTime": 1234.56,
  "data": {
    "answer": "TypeScript is...",
    "usage": {
      "promptTokens": 100,
      "completionTokens": 50,
      "totalTokens": 150
    }
  }
}
```

### Authentication

The webhook server supports Bearer token authentication via the `WEBHOOK_API_KEY` environment variable.

**Without API Key** (development only):
```bash
# No authentication required
bun run server:webhook
```

**With API Key** (recommended for production):
```bash
# Require authentication
WEBHOOK_API_KEY=your-secret-key bun run server:webhook
```

Clients must include the API key in the `Authorization` header:
```bash
# Bearer format (recommended)
curl -H "Authorization: Bearer your-secret-key" ...

# Or just the token
curl -H "Authorization: your-secret-key" ...
```

### Configuration

Environment variables for webhook mode:

| Variable | Description | Default |
|----------|-------------|---------|
| `WEBHOOK_PORT` | Port to listen on | `3000` |
| `WEBHOOK_HOST` | Host to bind to | `0.0.0.0` |
| `WEBHOOK_API_KEY` | API key for authentication | (none - no auth) |

## MCP Server

### Setup with Claude Desktop

1. **Start the MCP server:**
   ```bash
   bun run server:mcp
   ```

2. **Configure Claude Desktop:**

   Edit your Claude Desktop config file:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

   Add the MCP server configuration:
   ```json
   {
     "mcpServers": {
       "llm-orchestrator": {
         "command": "bun",
         "args": ["run", "/path/to/rag3.0/src/server.ts", "--mode=mcp"]
       }
     }
   }
   ```

3. **Restart Claude Desktop** and the tools will be available.

### Available Tools

When running in MCP mode, all registered pipelines become tools. For example, the `rag_query` pipeline becomes:

**Tool Name**: `rag_query`

**Description**: Answer questions using RAG (Retrieval Augmented Generation)

**Parameters**:
- `query` (string, required): The user query to answer
- `collection` (string, optional): Optional collection name override
- `systemPrompt` (string, optional): Optional system prompt override

### Using MCP Tools in Claude

Once configured, you can ask Claude to use the tools:

```
You: "Use the rag_query tool to search my notes for information about the BFF project"

Claude: [calls rag_query tool with {"query": "BFF project"}]
        Based on your notes, the BFF project...
```

## Creating Custom Pipelines

### 1. Define Your Pipeline

Create a new file in `src/workflows/`:

```typescript
import { z } from 'zod';
import { Pipeline } from '../core/pipeline/builder';
import { createStep } from '../core/pipeline/steps';
import type { RegisteredPipeline } from '../core/pipeline/registry';

// Define input/output schemas
const myPipelineInputSchema = z.object({
  text: z.string().describe('Input text to process'),
  maxLength: z.number().optional().describe('Maximum length')
});

const myPipelineOutputSchema = z.object({
  result: z.string().describe('Processed result'),
  metadata: z.object({
    inputLength: z.number(),
    outputLength: z.number()
  })
});

// Create the pipeline
export function createMyPipeline(contextBuilder) {
  const step1 = createStep('process', async ({ input }) => {
    // Your processing logic here
    const result = input.text.slice(0, input.maxLength || 100);
    return {
      result,
      metadata: {
        inputLength: input.text.length,
        outputLength: result.length
      }
    };
  });

  return Pipeline.start(contextBuilder)
    .add('process', step1);
}

// Export as registered pipeline
export function createMyPipelineRegistration(context) {
  return {
    name: 'my_pipeline',
    description: 'Process text with custom logic',
    inputSchema: myPipelineInputSchema,
    outputSchema: myPipelineOutputSchema,
    pipeline: createMyPipeline(() => context),
    contextBuilder: () => context,
    tags: ['text', 'processing'],
    examples: [
      {
        input: { text: 'Hello world' },
        description: 'Simple text processing'
      }
    ]
  };
}
```

### 2. Register Your Pipeline

In `src/server.ts`, add your pipeline to the registry:

```typescript
import { createMyPipelineRegistration } from './workflows/my-pipeline';

// ... in main() function
const myPipeline = createMyPipelineRegistration({
  // Your context here
});

pipelineRegistry.register(myPipeline);
```

### 3. Use It

**Via Webhook**:
```bash
curl -X POST http://localhost:3000/webhook/my_pipeline \
  -H "Authorization: Bearer your-key" \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello world", "maxLength": 5}'
```

**Via MCP** (in Claude Desktop):
```
You: "Use my_pipeline to process 'Hello world'"
```

## Pipeline Registry

The `PipelineRegistry` manages all available pipelines:

```typescript
const registry = new PipelineRegistry();

// Register a pipeline
registry.register(myPipeline);

// Execute a pipeline
const result = await registry.execute('my_pipeline', { text: 'input' });

// List all pipelines
const all = registry.getAll();

// Get by tags
const ragPipelines = registry.getByTags(['rag']);
```

## Error Handling

Both servers provide detailed error responses:

**Webhook Error Response**:
```json
{
  "success": false,
  "pipelineName": "rag_query",
  "error": "Pipeline not found: rag_query"
}
```

**MCP Error Response**:
```json
{
  "content": [
    {
      "type": "text",
      "text": "Error executing pipeline: ..."
    }
  ],
  "isError": true
}
```

## Logging

Both servers use structured logging. View logs with different verbosity:

```bash
# Info level (default)
bun run server:webhook

# Debug level
LOG_LEVEL=debug bun run server:webhook

# Events logged:
# - server_starting, server_stopped
# - webhook_execution_start, webhook_execution_complete
# - call_tool_request, call_tool_success
# - unauthorized_request (failed auth)
```

## Production Deployment

### Webhook Server

```bash
# Use PM2 or similar for production
pm2 start bun --name webhook-server -- run src/server.ts --mode=webhook

# Or Docker
docker run -e WEBHOOK_API_KEY=secret -p 3000:3000 your-image
```

### MCP Server

The MCP server runs as a subprocess of Claude Desktop, so no separate deployment is needed. Just ensure the `command` path in `claude_desktop_config.json` is correct.

## Security Best Practices

1. **Always use `WEBHOOK_API_KEY` in production**
2. **Use HTTPS** in production (reverse proxy with nginx/caddy)
3. **Rate limiting**: Consider adding rate limiting for webhooks
4. **Input validation**: Pipelines validate inputs with Zod schemas
5. **Logging**: Monitor logs for unauthorized access attempts

## Troubleshooting

### Webhook Server

**Port already in use**:
```bash
# Change port
WEBHOOK_PORT=3001 bun run server:webhook
```

**Authentication failing**:
```bash
# Check API key matches
echo $WEBHOOK_API_KEY
# Use exact key in Authorization header
curl -H "Authorization: Bearer $WEBHOOK_API_KEY" ...
```

### MCP Server

**Tools not showing in Claude Desktop**:
1. Check Claude Desktop config path is correct
2. Restart Claude Desktop after config changes
3. Check server logs for errors: `LOG_LEVEL=debug bun run server:mcp`

**Pipeline execution errors**:
- Check environment variables (LLM_BASE_URL, QDRANT_URL, etc.)
- Verify services are running (Qdrant, LLM server)
- Check logs in Claude Desktop developer console

## Examples

See the working example in `src/workflows/rag-query.ts` for a complete pipeline implementation with:
- Input/output schemas
- Pipeline steps
- Context management
- Tool integration
- Registration for both MCP and webhooks

## Next Steps

- Add more pipelines in `src/workflows/`
- Customize authentication in `src/io/webhook-server.ts`
- Add rate limiting or other middleware
- Deploy to production with Docker/PM2
- Monitor with structured logs and metrics

## Resources

- [Model Context Protocol Specification](https://modelcontextprotocol.io)
- [Claude Desktop MCP Configuration](https://docs.anthropic.com)
- [Pipeline Builder Documentation](./plan.md)
