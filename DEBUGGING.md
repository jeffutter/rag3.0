# Debugging Guide

## Running with Debug Logs

```bash
LOG_LEVEL=debug bun run test-cli "Your query here"
```

## What to Look For

When debugging RAG search issues, the logs will show you the complete flow:

### 1. Tool Call Detection

**What to check:**
- Did the LLM decide to call the tool?
- What arguments did it pass?

**Log events to look for:**
```
event: "tool_calls_received"
  toolCallCount: 1
  toolCalls: [
    {
      name: "search_knowledge_base",
      arguments: { query: "...", limit: 5 }
    }
  ]

event: "tool_execution_start"
  toolName: "search_knowledge_base"
  validatedArguments: { query: "...", limit: 5 }
```

**Common issues:**
- `event: "no_tool_calls"` → LLM didn't think it needed to search
- Missing tool call → Model might not support tool calling well

### 2. Embedding Generation

**What to check:**
- Is the embedding endpoint correct?
- Is the request succeeding?
- Are embeddings being generated?

**Log events to look for:**
```
event: "embedding_http_request"
  url: "http://localhost:8080/v1/embeddings"
  model: "nomic-embed-text"
  inputText: "your search query"

event: "embedding_http_response"
  status: 200
  statusText: "OK"

event: "embedding_parsed"
  embeddingDimension: 768
  firstFewValues: [0.123, -0.456, ...]
```

**Common issues:**
- `status: 404` → Wrong embedding endpoint or model not loaded
- `status: 500` → Server error, check embedding server logs
- `embeddingDimension: 384` but collection expects 768 → Model mismatch

### 3. Vector Search in Qdrant

**What to check:**
- Is Qdrant reachable?
- Does the collection exist?
- Are there any results?
- What are the similarity scores?

**Log events to look for:**
```
event: "vector_search_params"
  collection: "obsidian-notes"
  embeddingDimension: 768
  limit: 5

event: "qdrant_search_request"
  params: {
    vectorDim: 768,
    vectorPreview: [0.123, -0.456, ...],
    limit: 5
  }

event: "qdrant_search_response"
  resultCount: 3
  results: [
    { id: 1, score: 0.87, payloadKeys: ["text", "title"] },
    { id: 2, score: 0.76, payloadKeys: ["text", "title"] },
    ...
  ]
```

**Common issues:**
- Error: Collection not found → Create collection first
- `resultCount: 0` → No matching documents, or bad embeddings
- Low scores (< 0.5) → Query doesn't match indexed content well

### 4. Tool Result

**What to check:**
- Did the search return results?
- Are the results being formatted correctly?
- Is the LLM receiving the results?

**Log events to look for:**
```
event: "rag_search_complete"
  resultCount: 3
  topScore: 0.87
  results: [...]

event: "tool_execution_result"
  resultType: "object"
  resultIsArray: true
  resultLength: 3
  result: [full search results]

event: "tool_result_message"
  contentLength: 1234
  contentPreview: "[{\"id\":1,\"score\":0.87,..."
```

**Common issues:**
- `resultCount: 0` → No results found
- Results returned but LLM gives generic answer → Results might not be relevant

## Complete Debug Flow Example

Here's what a successful RAG search looks like:

```
1. [tool_calls_received] LLM decides to search
2. [tool_execution_start] Starting search_knowledge_base
3. [embedding_http_request] Requesting embedding
4. [embedding_http_response] Got embedding (200 OK)
5. [embedding_parsed] Parsed 768-dim vector
6. [vector_search_params] Searching collection
7. [qdrant_search_request] Sending to Qdrant
8. [qdrant_search_response] Got 3 results
9. [rag_search_complete] Search complete, top score: 0.87
10. [tool_execution_result] Results: [array of 3]
11. [tool_result_message] Sent results back to LLM
12. LLM generates final response using the results
```

## Troubleshooting Checklist

### Nothing Happens (No Tool Call)

```bash
# Check if LLM received the tool definition
LOG_LEVEL=debug bun run test-cli "Search my notes for X" 2>&1 | grep -A5 "tool_calls"

# If you see "no_tool_calls", try:
# 1. Make query more explicit: "Search my notes for..."
# 2. Check if model supports tool calling
# 3. Try different model (GPT-4, Claude, etc.)
```

### Embedding Errors

```bash
# Check embedding endpoint
LOG_LEVEL=debug bun run test-cli "test" 2>&1 | grep "embedding_http"

# Test embedding directly
curl -X POST $EMBEDDING_BASE_URL/embeddings \
  -H "Content-Type: application/json" \
  -d '{"model":"'$EMBEDDING_MODEL'","input":"test"}'
```

### Qdrant Errors

```bash
# Check Qdrant connection
LOG_LEVEL=debug bun run test-cli "test" 2>&1 | grep "qdrant"

# Verify collection exists
curl $QDRANT_URL/collections/$QDRANT_COLLECTION

# Check collection vector size
curl $QDRANT_URL/collections/$QDRANT_COLLECTION | grep -i "size"

# List all points in collection
curl "$QDRANT_URL/collections/$QDRANT_COLLECTION/points/scroll" \
  -H "Content-Type: application/json" \
  -d '{"limit": 10, "with_payload": true, "with_vector": false}'
```

### Empty Results (resultCount: 0)

This could mean:

1. **No documents indexed:**
   ```bash
   # Check how many points are in the collection
   curl "$QDRANT_URL/collections/$QDRANT_COLLECTION" | grep points_count
   ```

2. **Query doesn't match documents:**
   - Try a query that exactly matches known content
   - Check if embeddings are normalized correctly

3. **Wrong collection:**
   - Verify `QDRANT_COLLECTION` matches where you indexed

4. **Vector dimension mismatch:**
   - Collection expects different dimension than embedding model produces

## Tips for Good Debug Output

**Pipe to file for analysis:**
```bash
LOG_LEVEL=debug bun run test-cli "query" 2>&1 | tee debug.log
```

**Filter to specific component:**
```bash
# Only RAG tool logs
LOG_LEVEL=debug bun run test-cli "query" 2>&1 | grep "rag-tool"

# Only Qdrant logs
LOG_LEVEL=debug bun run test-cli "query" 2>&1 | grep "qdrant"

# Only embedding logs
LOG_LEVEL=debug bun run test-cli "query" 2>&1 | grep "embedding"
```

**Check event sequence:**
```bash
LOG_LEVEL=debug bun run test-cli "query" 2>&1 | grep "event:" | cut -d'"' -f4
```

This will show you the exact sequence of events, making it easy to see where things stop.
