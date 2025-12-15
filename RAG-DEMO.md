# RAG Demo - Testing Tool Calling

The test CLI now includes a **RAG search tool** that the LLM can automatically use when appropriate!

## What's New

The CLI now:
- ✅ Initializes a Qdrant vector database client
- ✅ Creates a RAG search tool with embedding generation
- ✅ Passes the tool to the LLM
- ✅ **LLM automatically decides** when to use the tool
- ✅ Executes tool calls in a loop until completion

## How It Works

1. You ask a question
2. LLM receives your question **and** the tool definition
3. LLM decides: "Do I need to search the knowledge base?"
   - **Yes** → Calls `search_knowledge_base` tool
   - **No** → Answers directly
4. If tool is called:
   - Query is embedded using your embedding model
   - Vector search runs in Qdrant
   - Results are returned to the LLM
   - LLM uses the results to formulate an answer

## Required Setup

### 1. Environment Variables (Already Set)

You mentioned these are already set in your environment:

```bash
# LLM (already set)
LLM_BASE_URL=...
LLM_MODEL=...

# Embedding (newly needed)
EMBEDDING_BASE_URL=...      # Can be same as LLM_BASE_URL
EMBEDDING_MODEL=...          # e.g., nomic-embed-text

# Qdrant (newly needed)
QDRANT_URL=...               # e.g., http://localhost:6333
QDRANT_COLLECTION=...        # e.g., obsidian-notes
```

### 2. Start Qdrant

If not already running:

```bash
# Option 1: Docker
docker run -p 6333:6333 qdrant/qdrant

# Option 2: Docker Compose
docker-compose up -d  # if you have docker-compose.yml

# Option 3: Native installation
# See: https://qdrant.tech/documentation/quick-start/
```

### 3. Create a Collection

You need at least one collection with some documents:

```bash
# Create a collection (adjust vector size to match your embedding model)
# nomic-embed-text = 768 dimensions
# all-minilm = 384 dimensions
# OpenAI text-embedding-3-small = 1536 dimensions

curl -X PUT http://localhost:6333/collections/obsidian-notes \
  -H 'Content-Type: application/json' \
  -d '{
    "vectors": {
      "size": 768,
      "distance": "Cosine"
    }
  }'
```

### 4. Add Some Test Documents

```bash
# Add a test document
curl -X PUT http://localhost:6333/collections/obsidian-notes/points \
  -H 'Content-Type: application/json' \
  -d '{
    "points": [
      {
        "id": 1,
        "vector": [0.1, 0.2, 0.3, ...],  # 768 numbers for nomic-embed-text
        "payload": {
          "text": "TypeScript is a strongly typed programming language that builds on JavaScript.",
          "title": "TypeScript Overview",
          "tags": ["programming", "typescript"]
        }
      }
    ]
  }'
```

**Note:** For real usage, you'd generate embeddings for your documents using the embedding model, not random numbers!

## Example Usage

### Questions That Won't Trigger RAG

Simple factual questions the LLM can answer directly:

```bash
bun run test-cli "What is 2+2?"
bun run test-cli "Explain what a variable is in programming"
bun run test-cli "Write a haiku about coding"
```

**Expected:** LLM answers directly without calling the tool.

### Questions That Should Trigger RAG

Questions about specific information that might be in your knowledge base:

```bash
bun run test-cli "Search my notes for information about TypeScript"
bun run test-cli "What do my notes say about design patterns?"
bun run test-cli "Find information about React hooks in my documents"
```

**Expected:** LLM calls `search_knowledge_base` tool, then uses results to answer.

## Observing Tool Calls

When the LLM decides to use the RAG tool, you'll see log output like:

```
[LLM] Sending to model with RAG tool support...
[02:45:12.345] INFO:
    event: "tool_execution_start"
    toolName: "search_knowledge_base"
    arguments: { query: "TypeScript", limit: 5 }
[02:45:12.567] INFO:
    event: "rag_search_start"
    query: "TypeScript"
    collection: "obsidian-notes"
[02:45:12.789] INFO:
    event: "rag_search_complete"
    resultCount: 3
    topScore: 0.87
[02:45:13.012] INFO:
    event: "tool_execution_complete"
    toolName: "search_knowledge_base"
[LLM] Received response (234 tokens)

[Output]
Based on your notes, TypeScript is a strongly typed programming language...
```

## Troubleshooting

### "Connection refused" to Qdrant
```bash
# Make sure Qdrant is running
curl http://localhost:6333/collections
```

### "Collection not found"
```bash
# Check collection exists
curl http://localhost:6333/collections/obsidian-notes

# Create it if missing (see setup step 3 above)
```

### "No embedding data returned"
```bash
# Test embedding endpoint
curl -X POST $EMBEDDING_BASE_URL/embeddings \
  -H "Content-Type: application/json" \
  -d '{"model":"'$EMBEDDING_MODEL'","input":"test"}'
```

### Tool Never Gets Called

Some models are better at tool calling than others. Try:

1. **Use explicit keywords** in your question:
   - "Search my notes for..."
   - "Find in my documents..."
   - "Look up..."

2. **Check model capabilities:**
   - GPT-4, GPT-3.5-turbo: Excellent tool calling
   - Claude: Excellent tool calling
   - Smaller local models: Varies (some support it, some don't)

3. **Try forcing the tool:**
   - Add `toolChoice: 'required'` in test-cli.ts line 63

## Next Steps

Once you have this working, you could:

1. **Add more tools:**
   - Web search
   - Calculator
   - Code execution
   - File operations

2. **Build a proper indexing pipeline:**
   - Scan Obsidian vault
   - Generate embeddings
   - Index to Qdrant
   - Keep in sync with changes

3. **Create a full CLI app:**
   - Interactive mode
   - History tracking
   - Multiple knowledge bases
   - Custom tool definitions

## Testing Checklist

- [ ] Qdrant is running
- [ ] Collection exists with correct vector dimensions
- [ ] Test documents are indexed
- [ ] Environment variables are set
- [ ] Simple question works (no tool call)
- [ ] Search question triggers tool call
- [ ] Results are used in response

---

**Ready to test?** Make sure Qdrant is running with your collection, then try:

```bash
bun run test-cli "Search for TypeScript in my notes"
```
