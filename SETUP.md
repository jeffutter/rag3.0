# Setup Guide

This guide explains what environment variables and services you need based on what features you want to use.

## Quick Start - Minimal Setup (Test CLI only)

For just testing the LLM integration with the simple test CLI:

```bash
# 1. Start an LLM server (pick one):

# Option A: Ollama (easiest)
ollama serve
ollama pull qwen2.5:7b

# Option B: llama.cpp
./llama-server -m your-model.gguf --port 8080

# 2. Set environment variables
export LLM_BASE_URL=http://localhost:11434/v1  # for Ollama
# OR
export LLM_BASE_URL=http://localhost:8080/v1   # for llama.cpp

export LLM_MODEL=qwen2.5:7b

# 3. Test it
bun run test-cli "Hello, world!"
```

**Required:**
- ✅ `LLM_BASE_URL` - Your LLM server endpoint
- ✅ `LLM_MODEL` - Model name

**Optional:**
- `LLM_API_KEY` - Only needed for OpenAI or secured endpoints

---

## Full RAG Setup (Complete System)

For the complete RAG (Retrieval Augmented Generation) system with vector search:

### 1. LLM Server

Same as above - pick Ollama, llama.cpp, or OpenAI.

```bash
export LLM_BASE_URL=http://localhost:8080/v1
export LLM_MODEL=qwen2.5:7b
# export LLM_API_KEY=...  # if needed
```

### 2. Embedding Server

You need a server that can generate embeddings (vector representations of text).

#### Option A: llama.cpp with embedding model

```bash
# Download an embedding model (e.g., nomic-embed-text)
# Start llama.cpp with the embedding model
./llama-server -m nomic-embed-text.gguf --port 8081 --embeddings

export EMBEDDING_BASE_URL=http://localhost:8081/v1
export EMBEDDING_MODEL=nomic-embed-text
```

#### Option B: Ollama with embedding model

```bash
ollama pull nomic-embed-text

export EMBEDDING_BASE_URL=http://localhost:11434/v1
export EMBEDDING_MODEL=nomic-embed-text
```

#### Option C: OpenAI Embeddings

```bash
export EMBEDDING_BASE_URL=https://api.openai.com/v1
export EMBEDDING_MODEL=text-embedding-3-small
export EMBEDDING_API_KEY=sk-...
```

### 3. Qdrant Vector Database

Install and run Qdrant:

```bash
# Option A: Docker (easiest)
docker run -p 6333:6333 qdrant/qdrant

# Option B: Docker Compose
cat > docker-compose.yml <<EOF
version: '3'
services:
  qdrant:
    image: qdrant/qdrant
    ports:
      - "6333:6333"
      - "6334:6334"
    volumes:
      - ./qdrant_storage:/qdrant/storage
EOF
docker-compose up -d

# Option C: Qdrant Cloud
# Sign up at https://cloud.qdrant.io
# Use the provided URL and API key
```

Set environment variables:

```bash
export QDRANT_URL=http://localhost:6333
# export QDRANT_API_KEY=...  # only for Qdrant Cloud
export QDRANT_COLLECTION=obsidian-notes
```

### 4. Create a Collection in Qdrant

Before using RAG, you need to create a collection and add some documents:

```bash
# Example: Create a collection for 768-dimensional embeddings (nomic-embed-text)
curl -X PUT http://localhost:6333/collections/obsidian-notes \
  -H 'Content-Type: application/json' \
  -d '{
    "vectors": {
      "size": 768,
      "distance": "Cosine"
    }
  }'

# Check it was created
curl http://localhost:6333/collections/obsidian-notes
```

**Note:** The vector `size` must match your embedding model's output dimension:
- `nomic-embed-text`: 768
- `all-minilm`: 384
- OpenAI `text-embedding-3-small`: 1536
- OpenAI `text-embedding-ada-002`: 1536

---

## Environment Variables Summary

### Currently Used (Test CLI)

| Variable | Required? | Default | Description |
|----------|-----------|---------|-------------|
| `LLM_BASE_URL` | ✅ Yes | `http://localhost:8080/v1` | LLM API endpoint |
| `LLM_MODEL` | ✅ Yes | `qwen2.5:7b` | Model to use |
| `LLM_API_KEY` | No | - | API key if needed |

### For RAG Features (Not yet wired to main app)

| Variable | Required? | Default | Description |
|----------|-----------|---------|-------------|
| `EMBEDDING_BASE_URL` | Yes | - | Embedding API endpoint |
| `EMBEDDING_MODEL` | Yes | - | Embedding model name |
| `EMBEDDING_API_KEY` | No | - | API key if needed |
| `QDRANT_URL` | Yes | `http://localhost:6333` | Qdrant server URL |
| `QDRANT_API_KEY` | No | - | Qdrant API key |
| `QDRANT_COLLECTION` | Yes | `obsidian-notes` | Default collection |

### For Logging

| Variable | Required? | Default | Description |
|----------|-----------|---------|-------------|
| `LOG_LEVEL` | No | `info` | trace, debug, info, warn, error, fatal |
| `NODE_ENV` | No | - | `production` for JSON logs, else pretty |

---

## Configuration File (Alternative to Env Vars)

Instead of environment variables, you can use a `config.json` file:

```json
{
  "llm": {
    "baseURL": "http://localhost:8080/v1",
    "model": "qwen2.5:7b"
  },
  "embedding": {
    "baseURL": "http://localhost:8080/v1",
    "model": "nomic-embed-text"
  },
  "qdrant": {
    "url": "http://localhost:6333",
    "defaultCollection": "obsidian-notes"
  },
  "logging": {
    "level": "info",
    "pretty": true
  }
}
```

Set the path:
```bash
export CONFIG_FILE=./config.json
```

---

## Verification Checklist

Test each component individually:

### ✅ LLM Server
```bash
curl $LLM_BASE_URL/models
bun run test-cli "Hello"
```

### ✅ Embedding Server
```bash
curl -X POST $EMBEDDING_BASE_URL/embeddings \
  -H "Content-Type: application/json" \
  -d '{"model":"'$EMBEDDING_MODEL'","input":"test"}'
```

### ✅ Qdrant
```bash
curl $QDRANT_URL/collections
curl $QDRANT_URL/collections/$QDRANT_COLLECTION
```

---

## Common Issues

**"Connection refused" errors:**
- Make sure all servers are running
- Check URLs and ports match
- For Ollama, ensure it's serving on port 11434

**"Model not found":**
- For Ollama: `ollama list` to see available models
- For llama.cpp: check the model file path

**"Collection not found" (Qdrant):**
- Create the collection first (see section 4 above)
- Verify collection name matches `QDRANT_COLLECTION`

**Wrong embedding dimensions:**
- Collection vector size must match embedding model output
- Check with: `curl $QDRANT_URL/collections/$QDRANT_COLLECTION`

---

## Next Steps

Currently, only the **test CLI** is fully wired up. The next phases will:

1. Create a proper CLI that uses all components (LLM + RAG)
2. Wire up configuration file loading
3. Add the main application entry point
4. Create systemd service for deployment

For now, you can test:
- ✅ LLM integration: `bun run test-cli "your question"`
- ⏳ Full RAG: Coming in Phase 6-7
