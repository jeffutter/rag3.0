---
id: task-4
title: Create document embedding workflow for folder processing
status: To Do
assignee: []
created_date: '2025-12-21 04:05'
updated_date: '2025-12-21 04:39'
labels: []
dependencies:
  - task-1
  - task-3
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create a complete workflow that processes a folder of markdown documents and generates vector embeddings for use in RAG systems. This workflow orchestrates multiple utilities to clean, split, and embed documents, making them searchable via semantic similarity.

The workflow should handle the complete pipeline:
1. Discover all markdown files in a specified folder
2. Clean markdown content (remove headings, formatting) using the Clean Markdown utility
3. Split cleaned content into appropriately-sized chunks using the Split Markdown utility
4. Batch chunks for efficient embedding API calls (50 chunks per batch)
5. Add end-of-text tokens to each chunk as required by the embedding model
6. Call the embedding API to generate vectors
7. Extract and return vectors with associated metadata

This is based on an existing n8n workflow that successfully processes documents for embedding. The implementation needs to be adapted to work with our pipeline system while preserving the batching, token handling, and API integration patterns.

The workflow should be reusable, configurable, and production-ready with comprehensive tests.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Workflow is implemented as a composable pipeline using existing pipeline infrastructure
- [ ] #2 File discovery finds all .md files in a specified directory (recursive traversal)
- [ ] #3 Clean Markdown utility is integrated and applied to each document
- [ ] #4 Split Markdown utility is integrated to chunk cleaned documents
- [ ] #5 Chunks are batched in groups of 50 for efficient API calls (configurable batch size)
- [ ] #6 End-of-text token '<|endoftext|>' is appended to each chunk before embedding
- [ ] #7 Embedding API endpoint is configurable (default: https://llama.home.jeffutter.com/v1/embeddings)
- [ ] #8 Embedding model is configurable (default: qwen3-embedding)
- [ ] #9 API requests follow OpenAI embeddings format: {input: string[], model: string}
- [ ] #10 Response vectors are extracted from API response format: {data: [{embedding: number[]}]}
- [ ] #11 Output includes chunk content, vector embeddings, metadata, and UUIDs
- [ ] #12 Error handling gracefully manages API failures, invalid files, and malformed responses
- [ ] #13 Configuration includes: folder path, batch size, API endpoint, model name, chunk size parameters
- [ ] #14 Unit tests verify each workflow step in isolation
- [ ] #15 Integration tests verify end-to-end workflow with sample markdown files
- [ ] #16 Integration tests verify API batching and response handling (mock API)
- [ ] #17 Tests verify error handling for missing files, API errors, and invalid markdown
- [ ] #18 All tests pass when running 'bun test'
- [ ] #19 Documentation includes usage examples and configuration options
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Reference n8n Workflow Analysis

The provided n8n workflow performs these operations:
1. **Input**: Receives content items
2. **Loop with batching**: Processes items in batches of 50
3. **Add end-of-text token**: Appends `<|endoftext|>` to each content string
4. **Aggregate**: Collects content strings into an array
5. **HTTP Request**: POST to embedding API with batched input
6. **Split Out**: Extracts individual embeddings from response data array
7. **Rename Keys**: Renames `embedding` field to `vector`
8. **Merge**: Combines original items with their vectors

## Proposed Architecture

### 1. Workflow Structure

Create a composable workflow at `src/workflows/embed-documents.ts`:

```typescript
import { z } from "zod";
import { createWorkflow } from "../core/pipeline/workflow";
import { cleanMarkdownStep } from "../steps/utilities/clean-markdown";
import { splitMarkdownStep } from "../steps/utilities/split-markdown";

// Configuration schema
const EmbedDocumentsConfigSchema = z.object({
  folderPath: z.string(),
  batchSize: z.number().default(50),
  embeddingEndpoint: z.string().default("https://llama.home.jeffutter.com/v1/embeddings"),
  embeddingModel: z.string().default("qwen3-embedding"),
  minChunkSize: z.number().default(300),
  maxChunkSize: z.number().default(1000),
  chunkOverlap: z.number().default(100),
});

// Output schema
const EmbeddedDocumentSchema = z.object({
  id: z.string().uuid(),
  content: z.string(),
  vector: z.array(z.number()),
  metadata: z.record(z.any()),
  index: z.number(),
  tags: z.array(z.string()),
});

export const embedDocumentsWorkflow = createWorkflow({
  name: "embed-documents",
  config: EmbedDocumentsConfigSchema,
  output: z.object({
    documents: z.array(EmbeddedDocumentSchema),
  }),
  steps: [
    // Steps defined below
  ],
});
```

### 2. Required Pipeline Steps

#### Step 1: File Discovery Step
Create `src/steps/io/discover-files.ts`:
- Input: `{ path: string, pattern: string }` (e.g., pattern: "**/*.md")
- Output: `{ files: Array<{ path: string, name: string }> }`
- Use Bun's file system APIs or glob library
- Recursive directory traversal

#### Step 2: Read File Step
Create `src/steps/io/read-file.ts`:
- Input: `{ path: string }`
- Output: `{ content: string, source: string }`
- Use `Bun.file()` to read markdown content
- Include file path as `source` for UUID generation

#### Step 3: Batch Chunks Step
Create `src/steps/utilities/batch-items.ts`:
- Input: `{ items: Array<any>, batchSize: number }`
- Output: `{ batches: Array<Array<any>> }`
- Generic utility for batching arrays
- Reusable for other workflows

#### Step 4: Add End-of-Text Token Step
Create `src/steps/utilities/add-eot-token.ts`:
- Input: `{ content: string, token?: string }`
- Output: `{ content: string }`
- Default token: `<|endoftext|>`
- Simple string append operation

#### Step 5: Generate Embeddings Step
Create `src/steps/ai/generate-embeddings.ts`:
- Input: `{ contents: string[], endpoint: string, model: string }`
- Output: `{ embeddings: Array<{ embedding: number[] }> }`
- POST request to embedding API
- Request format: `{ input: string[], model: string }`
- Response format: `{ data: [{ embedding: number[] }] }`
- Use `fetch()` (built-in to Bun)

### 3. Workflow Orchestration Pattern

```typescript
// Pseudo-code for workflow logic
async function embedDocuments(config) {
  // 1. Discover files
  const files = await discoverFiles({ 
    path: config.folderPath, 
    pattern: "**/*.md" 
  });
  
  // 2. Process each file
  const allChunks = [];
  for (const file of files) {
    const { content, source } = await readFile({ path: file.path });
    
    // 3. Clean markdown
    const cleaned = await cleanMarkdown({ content });
    
    // 4. Split into chunks
    const { chunks } = await splitMarkdown({
      content: cleaned.content,
      source: source,
      metadata: { 
        source,
        tags: cleaned.tags,
      },
      minChunkSize: config.minChunkSize,
      maxChunkSize: config.maxChunkSize,
      chunkOverlap: config.chunkOverlap,
    });
    
    allChunks.push(...chunks);
  }
  
  // 5. Add end-of-text tokens
  const chunksWithEOT = allChunks.map(chunk => ({
    ...chunk,
    content: chunk.content + "<|endoftext|>",
  }));
  
  // 6. Batch chunks
  const batches = batchItems(chunksWithEOT, config.batchSize);
  
  // 7. Generate embeddings for each batch
  const results = [];
  for (const batch of batches) {
    const contents = batch.map(c => c.content);
    const embeddings = await generateEmbeddings({
      contents,
      endpoint: config.embeddingEndpoint,
      model: config.embeddingModel,
    });
    
    // 8. Merge chunks with embeddings
    batch.forEach((chunk, idx) => {
      results.push({
        id: chunk.id,
        content: chunk.content,
        vector: embeddings[idx].embedding,
        metadata: chunk.metadata,
        index: chunk.index,
        tags: chunk.metadata.tags || [],
      });
    });
  }
  
  return { documents: results };
}
```

### 4. API Integration Sample

```typescript
// src/steps/ai/generate-embeddings.ts
async function generateEmbeddings(input: {
  contents: string[];
  endpoint: string;
  model: string;
}) {
  const response = await fetch(input.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: input.contents,
      model: input.model,
    }),
  });
  
  if (!response.ok) {
    throw new Error(`Embedding API error: ${response.statusText}`);
  }
  
  const data = await response.json();
  
  // Response format: { data: [{ embedding: number[] }] }
  return data.data.map(item => ({
    embedding: item.embedding,
  }));
}
```

### 5. Testing Strategy

#### Unit Tests
Each step should have isolated tests:

```typescript
// src/steps/io/discover-files.test.ts
import { test, expect } from "bun:test";
import { discoverFilesStep } from "./discover-files";

test("discovers markdown files recursively", async () => {
  // Create temp directory with test files
  // Execute step
  // Verify files are found
});
```

#### Integration Tests
Create `src/workflows/embed-documents.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { embedDocumentsWorkflow } from "./embed-documents";

test("end-to-end workflow with sample markdown", async () => {
  // 1. Create temp folder with sample .md files
  // 2. Mock the embedding API endpoint
  // 3. Execute workflow
  // 4. Verify output structure
  // 5. Verify vectors are present
  // 6. Verify metadata is preserved
});

test("handles API failures gracefully", async () => {
  // Mock API to return error
  // Verify workflow handles error properly
});

test("processes multiple files and batches correctly", async () => {
  // Create 150 chunks (3 batches of 50)
  // Verify batching behavior
  // Verify all chunks get embeddings
});
```

#### Mock API Server
For testing, create a simple mock:

```typescript
// test/mocks/embedding-api.ts
import { serve } from "bun";

export function createMockEmbeddingServer() {
  return serve({
    port: 0, // Random port
    fetch(req) {
      const body = await req.json();
      const mockEmbeddings = body.input.map(() => ({
        embedding: Array(384).fill(0).map(() => Math.random()),
      }));
      return Response.json({ data: mockEmbeddings });
    },
  });
}
```

### 6. Error Handling Considerations

- **File not found**: Skip and log warning
- **Invalid markdown**: Skip and log warning
- **API rate limiting**: Implement retry with exponential backoff
- **API errors**: Retry failed batches, collect errors for reporting
- **Network timeouts**: Configure timeout, fail gracefully
- **Malformed responses**: Validate response schema, fail with clear error

### 7. Configuration Example

```typescript
// Usage example
const result = await embedDocumentsWorkflow.execute({
  folderPath: "./docs",
  batchSize: 50,
  embeddingEndpoint: "https://llama.home.jeffutter.com/v1/embeddings",
  embeddingModel: "qwen3-embedding",
  minChunkSize: 300,
  maxChunkSize: 1000,
  chunkOverlap: 100,
});

console.log(`Embedded ${result.documents.length} chunks`);
```

### 8. Key Implementation Notes

1. **Batching is critical**: Don't send individual requests, always batch
2. **End-of-text token**: Must be added BEFORE batching/aggregation
3. **Preserve chunk order**: Ensure embeddings map correctly to chunks
4. **UUID stability**: Use file path as source for deterministic chunk IDs
5. **Memory efficiency**: Consider streaming for very large document sets
6. **Parallel processing**: Can process multiple files concurrently
7. **Progress reporting**: Consider adding progress callbacks for long-running operations

### 9. Next Steps After Implementation

Once this workflow is complete, it can be:
- Used in a CLI command for batch document embedding
- Integrated into a watch mode for continuous document processing
- Extended to store results in a vector database
- Combined with retrieval workflows for RAG functionality

## Enhanced Pipeline Architecture

Based on the existing pipeline system (src/core/pipeline/builder.ts), the document embedding workflow should follow this pattern:

### Workflow Structure

```typescript
import { Pipeline } from '../core/pipeline/builder';
import { z } from 'zod';

// Configuration schema
const EmbedDocumentsConfigSchema = z.object({
  folderPath: z.string(),
  batchSize: z.number().default(50),
  embeddingEndpoint: z.string().default('https://llama.home.jeffutter.com/v1/embeddings'),
  embeddingModel: z.string().default('qwen3-embedding'),
  minChunkSize: z.number().default(300),
  maxChunkSize: z.number().default(1000),
  chunkOverlap: z.number().default(100),
});

// Output schema
const EmbeddedDocumentSchema = z.object({
  id: z.string().uuid(),
  content: z.string(),
  vector: z.array(z.number()),
  metadata: z.record(z.any()),
  tags: z.array(z.string()),
});

const EmbedDocumentsOutputSchema = z.object({
  documents: z.array(EmbeddedDocumentSchema),
});

type EmbedDocumentsConfig = z.infer<typeof EmbedDocumentsConfigSchema>;
type EmbedDocumentsOutput = z.infer<typeof EmbedDocumentsOutputSchema>;
```

### Required New Steps

#### 1. Discover Files Step (src/steps/io/discover-files.ts)
```typescript
const discoverFilesStep = createStep<
  { path: string; pattern: string },
  { files: Array<{ path: string; name: string }> }
>('discoverFiles', async ({ input }) => {
  // Use glob or recursive fs readdir to find all .md files
  const files = await glob(input.pattern, { cwd: input.path });
  return {
    files: files.map(f => ({
      path: join(input.path, f),
      name: f
    }))
  };
});
```

#### 2. Read File Step (src/steps/io/read-file.ts)
```typescript
const readFileStep = createStep<
  { path: string },
  { content: string; source: string }
>('readFile', async ({ input }) => {
  const file = Bun.file(input.path);
  const content = await file.text();
  return { content, source: input.path };
});
```

## Additional Required Steps

#### 3. Batch Items Step (src/steps/utilities/batch-items.ts)
```typescript
const batchItemsStep = createStep<
  { items: Array<any>; batchSize: number },
  { batches: Array<Array<any>> }
>('batchItems', async ({ input }) => {
  const batches = [];
  for (let i = 0; i < input.items.length; i += input.batchSize) {
    batches.push(input.items.slice(i, i + input.batchSize));
  }
  return { batches };
});
```

#### 4. Add EOT Token Step (src/steps/utilities/add-eot-token.ts)
```typescript
const addEOTTokenStep = createStep<
  { content: string; token?: string },
  { content: string }
>('addEOTToken', async ({ input }) => {
  const token = input.token || '<|endoftext|>';
  return { content: input.content + token };
});
```

#### 5. Generate Embeddings Step (src/steps/ai/generate-embeddings.ts)
```typescript
const generateEmbeddingsStep = createStep<
  { contents: string[]; endpoint: string; model: string },
  { embeddings: Array<{ embedding: number[] }> }
>('generateEmbeddings', async ({ input }) => {
  const response = await fetch(input.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: input.contents, model: input.model }),
  });
  if (!response.ok) throw new Error(`Embedding API error: ${response.statusText}`);
  const data = await response.json();
  return { embeddings: data.data };
});
```

### Pipeline Composition

Note: The pipeline system processes items sequentially. For processing multiple files, we'll need to either:
1. Create a wrapper that loops over files and processes each through the pipeline
2. Or create a single workflow that processes one file at a time

Recommend approach: Create a workflow function that orchestrates the steps for a batch of files.
<!-- SECTION:PLAN:END -->
