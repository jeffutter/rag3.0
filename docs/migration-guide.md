# Pipeline Migration Guide

This guide helps you migrate existing workflows to use the new pipeline API with list operations.

## Table of Contents

1. [Overview](#overview)
2. [Key Concepts](#key-concepts)
3. [Migration Patterns](#migration-patterns)
4. [Common Scenarios](#common-scenarios)
5. [Best Practices](#best-practices)

## Overview

The new pipeline API introduces:
- **List operations**: `map()`, `filter()`, `flatMap()`, `batch()`, `flatten()`
- **Parallel execution**: Process list items concurrently
- **Error handling strategies**: Control how errors propagate
- **Performance metrics**: Built-in timing and statistics

### Benefits

- **Better performance**: Parallel execution with concurrency control
- **Cleaner code**: Declarative list operations replace manual loops
- **Type safety**: Compile-time validation of data flow
- **Error handling**: Flexible strategies for list processing
- **Observability**: Detailed metrics for list operations

## Key Concepts

### Before: Manual Loop Processing

```typescript
// Old approach: Manual loop with async/await
async function processItems(items: Item[]): Promise<Result[]> {
  const results: Result[] = [];

  for (const item of items) {
    try {
      const result = await processItem(item);
      results.push(result);
    } catch (error) {
      // Handle error
    }
  }

  return results;
}
```

### After: Declarative List Operations

```typescript
// New approach: Declarative with map()
const pipeline = Pipeline.start<Item[]>()
  .map('results',
    createStep('processItem', async ({ input }) => processItem(input)),
    { parallel: true, concurrencyLimit: 5 }
  );
```

## Migration Patterns

### Pattern 1: Simple Array Transformation

**Before:**
```typescript
async function transformUsers(users: User[]): Promise<EnrichedUser[]> {
  const enriched: EnrichedUser[] = [];

  for (const user of users) {
    const enrichedUser = await enrichUser(user);
    enriched.push(enrichedUser);
  }

  return enriched;
}
```

**After:**
```typescript
const pipeline = Pipeline.start<User[]>()
  .map('enriched',
    createStep('enrichUser', async ({ input }) => enrichUser(input)),
    { parallel: true, concurrencyLimit: 10 }
  );

const result = await pipeline.execute(users);
```

### Pattern 2: Filtering with Async Predicates

**Before:**
```typescript
async function filterActiveUsers(users: User[]): Promise<User[]> {
  const active: User[] = [];

  for (const user of users) {
    const isActive = await checkUserStatus(user);
    if (isActive) {
      active.push(user);
    }
  }

  return active;
}
```

**After:**
```typescript
const pipeline = Pipeline.start<User[]>()
  .filter('active', async (user) => await checkUserStatus(user));

const result = await pipeline.execute(users);
```

### Pattern 3: Nested Array Processing (FlatMap)

**Before:**
```typescript
async function extractAllLinks(pages: Page[]): Promise<Link[]> {
  const allLinks: Link[] = [];

  for (const page of pages) {
    const links = await extractLinks(page);
    allLinks.push(...links);
  }

  return allLinks;
}
```

**After:**
```typescript
const pipeline = Pipeline.start<Page[]>()
  .flatMap('links',
    createStep('extractLinks', async ({ input }) => extractLinks(input)),
    { parallel: true, concurrencyLimit: 5 }
  );

const result = await pipeline.execute(pages);
```

### Pattern 4: Batch Processing

**Before:**
```typescript
async function processInBatches(items: Item[], batchSize: number): Promise<Result[]> {
  const results: Result[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await processBatch(batch);
    results.push(...batchResults);
  }

  return results;
}
```

**After:**
```typescript
const pipeline = Pipeline.start<Item[]>()
  .batch('batches', 10)
  .map('results',
    createStep('processBatch', async ({ input }) => processBatch(input)),
    { parallel: true }
  )
  .flatten('allResults');

const result = await pipeline.execute(items);
```

### Pattern 5: Error Handling

**Before:**
```typescript
async function processWithErrorHandling(items: Item[]): Promise<{
  successes: Result[];
  failures: Error[];
}> {
  const successes: Result[] = [];
  const failures: Error[] = [];

  for (const item of items) {
    try {
      const result = await processItem(item);
      successes.push(result);
    } catch (error) {
      failures.push(error as Error);
    }
  }

  return { successes, failures };
}
```

**After:**
```typescript
import { ListErrorStrategy } from "../core/pipeline/list-adapters";

const pipeline = Pipeline.start<Item[]>()
  .map('results',
    createStep('processItem', async ({ input }) => processItem(input)),
    {
      parallel: true,
      errorStrategy: ListErrorStrategy.SKIP_FAILED // or COLLECT_ERRORS
    }
  );

const result = await pipeline.execute(items);
// Check result.metadata.listMetadata for success/failure counts
```

## Common Scenarios

### Scenario 1: API Rate Limiting

**Before:**
```typescript
async function fetchWithRateLimit(urls: string[]): Promise<Response[]> {
  const responses: Response[] = [];

  for (const url of urls) {
    const response = await fetch(url);
    responses.push(response);
    await sleep(100); // Rate limit
  }

  return responses;
}
```

**After:**
```typescript
const pipeline = Pipeline.start<string[]>()
  .map('responses',
    createStep('fetch', async ({ input }) => {
      const response = await fetch(input);
      await sleep(100); // Rate limit
      return response;
    }),
    { parallel: false } // Sequential to respect rate limit
  );
```

Or with parallel execution and concurrency limit:

```typescript
const pipeline = Pipeline.start<string[]>()
  .map('responses',
    createStep('fetch', async ({ input }) => fetch(input)),
    { parallel: true, concurrencyLimit: 5 } // Max 5 concurrent requests
  );
```

### Scenario 2: Data Transformation Pipeline

**Before:**
```typescript
async function processDocuments(docs: RawDoc[]): Promise<ProcessedDoc[]> {
  // Step 1: Filter
  const validDocs = docs.filter(doc => doc.isValid);

  // Step 2: Transform
  const enriched: EnrichedDoc[] = [];
  for (const doc of validDocs) {
    enriched.push(await enrichDocument(doc));
  }

  // Step 3: Generate embeddings
  const withEmbeddings: ProcessedDoc[] = [];
  for (const doc of enriched) {
    withEmbeddings.push(await generateEmbedding(doc));
  }

  return withEmbeddings;
}
```

**After:**
```typescript
const pipeline = Pipeline.start<RawDoc[]>()
  .filter('valid', (doc) => doc.isValid)
  .map('enriched',
    createStep('enrich', async ({ input }) => enrichDocument(input)),
    { parallel: true }
  )
  .map('withEmbeddings',
    createStep('embed', async ({ input }) => generateEmbedding(input)),
    { parallel: true, concurrencyLimit: 10 }
  );

const result = await pipeline.execute(docs);
```

### Scenario 3: Multi-Stage Processing with Batching

**Before:**
```typescript
async function processLargeDataset(items: Item[]): Promise<Result[]> {
  const batchSize = 100;
  const results: Result[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);

    // Process batch
    const processed = await Promise.all(
      batch.map(item => processItem(item))
    );

    // Generate embeddings for batch
    const embeddings = await generateBatchEmbeddings(processed);

    results.push(...embeddings);
  }

  return results;
}
```

**After:**
```typescript
const pipeline = Pipeline.start<Item[]>()
  .batch('batches', 100)
  .map('processed',
    createStep('processBatch', async ({ input }) =>
      Promise.all(input.map(item => processItem(item)))
    ),
    { parallel: true, concurrencyLimit: 3 }
  )
  .map('embeddings',
    createStep('embed', async ({ input }) =>
      generateBatchEmbeddings(input)
    ),
    { parallel: true }
  )
  .flatten('allResults');

const result = await pipeline.execute(items);
```

## Best Practices

### 1. Choose the Right Error Strategy

```typescript
// For critical data: Fail fast on any error
.map('step', myStep, { errorStrategy: ListErrorStrategy.FAIL_FAST })

// For batch jobs: Collect all errors for reporting
.map('step', myStep, { errorStrategy: ListErrorStrategy.COLLECT_ERRORS })

// For best-effort processing: Skip failures
.map('step', myStep, { errorStrategy: ListErrorStrategy.SKIP_FAILED })
```

### 2. Set Appropriate Concurrency Limits

```typescript
// CPU-intensive work: Match CPU cores
.map('step', cpuIntensiveStep, {
  parallel: true,
  concurrencyLimit: 4
})

// I/O work: Higher concurrency
.map('step', fetchStep, {
  parallel: true,
  concurrencyLimit: 20
})

// Rate-limited APIs: Conservative limits
.map('step', apiStep, {
  parallel: true,
  concurrencyLimit: 5
})
```

### 3. Use Context for Shared Configuration

```typescript
interface MyContext {
  apiKey: string;
  baseURL: string;
  timeout: number;
}

const pipeline = Pipeline.start<Input[], MyContext>(() => ({
  apiKey: process.env.API_KEY!,
  baseURL: 'https://api.example.com',
  timeout: 5000
}))
  .map('results',
    createStep<Item, Result, {}, MyContext>(
      'process',
      async ({ input, context }) => {
        // Access context.apiKey, context.baseURL, etc.
        return processItem(input, context);
      }
    )
  );
```

### 4. Access Previous Step Results

```typescript
const pipeline = Pipeline.start<Input[]>()
  .map('processed', processStep)
  .filter('filtered', filterPredicate)
  .add('summary',
    createStep<Item[], Summary, { processed: Item[], filtered: Item[] }>(
      'summarize',
      async ({ input, state }) => {
        // Can access both processed and filtered
        return {
          totalProcessed: state.processed.length,
          totalFiltered: state.filtered.length,
          finalCount: input.length
        };
      }
    )
  );
```

### 5. Monitor Performance

```typescript
const result = await pipeline.execute(data);

if (result.success && result.metadata.listMetadata) {
  const { listMetadata } = result.metadata;

  console.log('Performance metrics:');
  console.log('  Total items:', listMetadata.totalItems);
  console.log('  Successes:', listMetadata.successCount);
  console.log('  Failures:', listMetadata.failureCount);
  console.log('  Avg time:', listMetadata.itemTimings?.avg, 'ms');
  console.log('  P95 time:', listMetadata.itemTimings?.p95, 'ms');
}
```

## Troubleshooting

### TypeScript Errors

**Problem:** Type errors when using map/filter operations

**Solution:** Ensure the current pipeline output is an array type

```typescript
// ❌ This won't compile if currentOutput is not an array
.map('step', myStep)

// ✅ Correct: Ensure previous step outputs an array
.add('items', createStep('getItems', async () => [...]))
.map('processed', processStep)
```

### Performance Issues

**Problem:** Sequential processing is too slow

**Solution:** Enable parallel execution with appropriate concurrency

```typescript
// ❌ Slow: Sequential processing
.map('results', step, { parallel: false })

// ✅ Fast: Parallel with concurrency limit
.map('results', step, {
  parallel: true,
  concurrencyLimit: 10
})
```

### Error Handling

**Problem:** Need partial results even if some items fail

**Solution:** Use SKIP_FAILED strategy

```typescript
.map('results', step, {
  errorStrategy: ListErrorStrategy.SKIP_FAILED
})
// Check result.metadata.listMetadata.failureCount
```

## Next Steps

- Review the [examples](../src/core/pipeline/examples/) for complete working code
- Read the [ADR](adr/001-pipeline-architecture.md) for architectural decisions
- Check the [API documentation](../src/core/pipeline/builder.ts) for detailed method signatures
