# Pipeline Patterns Guide

A collection of common pipeline patterns and best practices for building robust, type-safe workflows.

## Table of Contents

- [Basic Patterns](#basic-patterns)
- [List Processing Patterns](#list-processing-patterns)
- [Error Handling Patterns](#error-handling-patterns)
- [Performance Optimization Patterns](#performance-optimization-patterns)
- [RAG-Specific Patterns](#rag-specific-patterns)
- [Advanced Patterns](#advanced-patterns)

## Basic Patterns

### 1. Simple Linear Pipeline

The most basic pattern - each step transforms data sequentially.

```typescript
import { Pipeline, createStep } from '@core/pipeline';

const pipeline = Pipeline.start<string>()
  .add('normalize', createStep('normalize', async ({ input }) => {
    return input.toLowerCase().trim();
  }))
  .add('validate', createStep('validate', async ({ input }) => {
    if (input.length === 0) throw new Error('Empty input');
    return input;
  }))
  .add('hash', createStep('hash', async ({ input }) => {
    return await hashString(input);
  }));

const result = await pipeline.execute('Hello World');
```

**Use Case:** Simple data transformations, validation chains, preprocessing

### 2. State Accumulation

Access outputs from any previous step, not just the immediate predecessor.

```typescript
const pipeline = Pipeline.start<string>()
  .add('tokenize', createStep('tokenize', async ({ input }) => {
    return input.split(' ');
  }))
  .add('count', createStep('count', async ({ input }) => {
    return input.length;
  }))
  .add('summary', createStep<
    number,
    { tokens: string[]; count: number; original: string },
    { tokenize: string[]; count: number }
  >('summary', async ({ input, state }) => {
    return {
      tokens: state.tokenize,  // Access earlier step
      count: input,             // Current input
      original: state.tokenize.join(' ') // Recompute from earlier state
    };
  }));
```

**Use Case:** Building summaries, combining data from multiple steps, debugging

### 3. Conditional Branching

Execute different logic based on runtime conditions.

```typescript
const pipeline = Pipeline.start<number>()
  .branch(
    'process',
    (input) => input > 100,
    // True branch: Large number handling
    createStep('large', async ({ input }) => {
      return await processLargeNumber(input);
    }),
    // False branch: Small number handling
    createStep('small', async ({ input }) => {
      return await processSmallNumber(input);
    })
  );
```

**Use Case:** A/B testing, environment-specific logic, feature flags

## List Processing Patterns

### 4. Map Pattern

Transform each element of an array.

```typescript
const pipeline = Pipeline.start<string[]>()
  .map('uppercase', createStep('toUpper', async ({ input }) => {
    return input.toUpperCase();
  }));

// Input: ['hello', 'world']
// Output: ['HELLO', 'WORLD']
```

**Use Case:** Applying transformations to collections, parallel processing

### 5. Batch-Map-Flatten Pattern

Efficient API usage by batching requests.

```typescript
const pipeline = Pipeline.start<string[]>()
  .batch('batches', 10)           // Group into batches of 10
  .map('embeddings', createStep(  // Process each batch
    'embed',
    async ({ input }) => {
      return await embedBatch(input); // Returns embedding[]
    }
  ))
  .flatten('allEmbeddings');      // Flatten back to single array

// Input: 100 texts
// Processing: 10 API calls instead of 100
// Output: 100 embeddings
```

**Use Case:** Embedding generation, API rate limiting, bulk database operations

**Performance:** 3-10x faster than individual calls, reduces API costs

### 6. Filter-Process Pattern

Remove unwanted elements before expensive processing.

```typescript
const pipeline = Pipeline.start<Document[]>()
  .filter('valid', (doc) => doc.content.length > 100)
  .map('processed', expensiveProcessingStep, { parallel: true });

// Only processes documents that pass validation
```

**Use Case:** Early filtering, validation before processing, data cleaning

### 7. FlatMap Pattern

Expand elements into multiple items.

```typescript
const pipeline = Pipeline.start<Document[]>()
  .flatMap('chunks', createStep(
    'chunk',
    async ({ input }) => {
      // Each document becomes multiple chunks
      return chunkDocument(input, { size: 512, overlap: 50 });
    }
  ), { parallel: true });

// Input: 10 documents
// Output: 50 chunks (flattened)
```

**Use Case:** Document chunking, expanding hierarchies, one-to-many transformations

## Error Handling Patterns

### 8. Fail Fast (Default)

Stop immediately on first error.

```typescript
const pipeline = Pipeline.start<string[]>()
  .map('results', riskyStep, {
    errorStrategy: ListErrorStrategy.FAIL_FAST
  });

// If any item fails, entire pipeline fails immediately
```

**Use Case:** Critical operations where partial results are useless

### 9. Collect All Errors

Process all items and collect all errors.

```typescript
const pipeline = Pipeline.start<string[]>()
  .map('results', riskyStep, {
    errorStrategy: ListErrorStrategy.COLLECT_ERRORS
  });

// Processes all items, returns error with all failures
// result.error.cause contains array of all failures
```

**Use Case:** Validation, batch operations where you need all error details

### 10. Skip Failed Items

Continue processing, skip failures.

```typescript
const pipeline = Pipeline.start<string[]>()
  .map('results', riskyStep, {
    errorStrategy: ListErrorStrategy.SKIP_FAILED,
    parallel: true
  });

// Returns only successful results, skips failures
// Check result.metadata.listMetadata.skippedCount
```

**Use Case:** Best-effort processing, resilient pipelines, data scraping

### 11. Retry with Backoff

Automatically retry failed operations.

```typescript
const pipeline = Pipeline.start<string>()
  .add('fetch', createStep(
    'fetchData',
    async ({ input }) => {
      return await fetchFromAPI(input);
    },
    {
      retry: {
        maxAttempts: 3,
        backoffMs: 1000,
        retryableErrors: ['ETIMEDOUT', 'ECONNRESET']
      }
    }
  ));

// Retries up to 3 times with exponential backoff
// Only retries specific error codes
```

**Use Case:** Network requests, flaky external services, transient failures

## Performance Optimization Patterns

### 12. Parallel Execution

Process items concurrently for I/O-bound operations.

```typescript
const pipeline = Pipeline.start<string[]>()
  .map('results', fetchStep, {
    parallel: true,
    concurrencyLimit: 5  // Don't overwhelm the API
  });

// Fetches 5 URLs at a time
```

**Performance:** 3-10x faster for I/O-bound operations
**Recommended Limits:** 5-10 for APIs, 50-100 for CPU tasks

### 13. Batching for API Efficiency

Reduce API calls by batching.

```typescript
const pipeline = Pipeline.start<string[]>()
  .batch('batches', 10)
  .map('embeddings', batchEmbedStep)
  .flatten('results');

// 100 items -> 10 API calls instead of 100
```

**Performance:** 3-5x improvement, reduces costs

### 14. Early Filtering

Filter before expensive operations.

```typescript
const pipeline = Pipeline.start<Document[]>()
  .filter('nonEmpty', (doc) => doc.content.length > 0)
  .filter('english', async (doc) => await detectLanguage(doc) === 'en')
  .map('processed', expensiveStep, { parallel: true });

// Cheap filters first, expensive processing only on valid items
```

**Performance:** Reduces processing time proportional to filtered items

## RAG-Specific Patterns

### 15. Document Embedding Pipeline

Complete workflow for embedding documents.

```typescript
const pipeline = Pipeline.start<string[]>()
  // Load and parse documents
  .map('documents', createStep('load', async ({ input }) => {
    return await loadMarkdown(input);
  }))

  // Chunk documents (flatMap: doc -> chunks)
  .flatMap('chunks', createStep('chunk', async ({ input }) => {
    return chunkDocument(input, { size: 512, overlap: 50 });
  }), { parallel: true })

  // Batch for efficient embedding
  .batch('batches', 10)
  .map('embeddings', createStep('embed', async ({ input }) => {
    return await embedBatch(input);
  }))
  .flatten('allEmbeddings')

  // Store in vector database
  .add('stored', createStep('store', async ({ input, state }) => {
    return await storeEmbeddings(input, state.chunks);
  }));
```

**Use Case:** RAG ingestion, document processing, semantic search indexing

### 16. Semantic Search Pipeline

Retrieve and rerank results.

```typescript
const pipeline = Pipeline.start<string>()
  .add('embedding', createStep('embed', async ({ input }) => {
    return await embedQuery(input);
  }))
  .add('search', createStep('vectorSearch', async ({ input, state }) => {
    return await vectorDB.search(input, { limit: 100 });
  }))
  .add('rerank', createStep('rerank', async ({ input, state }) => {
    // Access original query from state
    return await rerank(input, state.embedding.text, { limit: 10 });
  }));
```

**Use Case:** RAG retrieval, semantic search, question answering

### 17. Multi-Source Retrieval

Combine results from multiple sources.

```typescript
const pipeline = Pipeline.start<string>()
  .add('embedded', embedStep)
  .add('results', createParallel('search', [
    vectorSearchStep,
    keywordSearchStep,
    knowledgeGraphStep
  ]))
  .add('merged', createStep('merge', async ({ input }) => {
    return mergeAndDeduplicate(input);
  }))
  .add('reranked', rerankStep);
```

**Use Case:** Hybrid search, multi-modal retrieval, ensemble methods

## Advanced Patterns

### 18. Fan-Out Fan-In

Process in parallel, then combine.

```typescript
const pipeline = Pipeline.start<Document>()
  .add('analyses', createParallel('analyze', [
    sentimentStep,
    entityExtractionStep,
    summaryStep
  ]))
  .add('combined', createStep('combine', async ({ input }) => {
    const [sentiment, entities, summary] = input;
    return { sentiment, entities, summary };
  }));
```

**Use Case:** Multi-aspect analysis, parallel feature extraction

### 19. Iterative Refinement

Refine results through multiple passes.

```typescript
async function refineUntilGood(input: string, maxIterations = 3) {
  const pipeline = Pipeline.start<string>()
    .add('refined', createStep('refine', async ({ input }) => {
      return await llm.refine(input);
    }))
    .add('quality', createStep('check', async ({ input }) => {
      return await checkQuality(input);
    }));

  let result = input;
  for (let i = 0; i < maxIterations; i++) {
    const output = await pipeline.execute(result);
    if (!output.success) break;
    if (output.data.quality > 0.8) return output.data.refined;
    result = output.data.refined;
  }
  return result;
}
```

**Use Case:** Iterative improvement, quality-driven refinement

### 20. Pipeline Composition

Combine pipelines for complex workflows.

```typescript
const preprocessPipeline = Pipeline.start<string>()
  .add('cleaned', cleanStep)
  .add('normalized', normalizeStep);

const embeddingPipeline = Pipeline.start<string>()
  .add('embedded', embedStep)
  .add('stored', storeStep);

// Compose them
async function processDocument(doc: string) {
  const preprocessed = await preprocessPipeline.execute(doc);
  if (!preprocessed.success) return preprocessed;

  return await embeddingPipeline.execute(preprocessed.data);
}
```

**Use Case:** Modular pipelines, reusable components, testing

## Best Practices

### Type Safety

1. Let TypeScript infer types when possible
2. Only add explicit types when referencing earlier state
3. Use the state parameter to access previous steps

### Performance

1. Use parallel execution for I/O-bound operations
2. Batch API calls to reduce overhead
3. Filter early to reduce processing
4. Set appropriate concurrency limits

### Error Handling

1. Choose error strategy based on use case
2. Use retry for transient failures
3. Log errors with trace IDs for debugging
4. Consider SKIP_FAILED for resilient pipelines

### Debugging

1. Use unique step names for clarity
2. Check `result.metadata` for timing information
3. Use trace IDs to correlate logs
4. Leverage list operation metadata (success/failure counts)

### Code Organization

1. Create reusable steps as functions
2. Compose pipelines from smaller pipelines
3. Use the registry for commonly-used pipelines
4. Document complex state dependencies

## Performance Metrics

Based on comprehensive benchmarks:

- **Sequential vs Parallel:** 3-10x speedup for I/O-bound operations
- **Batching:** 3-5x improvement for API calls
- **Early Filtering:** Linear reduction based on filter ratio
- **Memory Overhead:** <5MB for 10,000 items
- **Scalability:** Tested up to 10,000 items with no degradation

## See Also

- [README.md](../README.md) - Basic usage and examples
- [TESTING.md](../TESTING.md) - Test coverage and performance data
- [Migration Guide](./MIGRATION_GUIDE.md) - Migrating existing code
- [Troubleshooting](./TROUBLESHOOTING.md) - Common issues and solutions
