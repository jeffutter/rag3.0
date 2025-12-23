# Streaming Pipelines

Comprehensive guide to using streaming pipelines for lazy, memory-efficient data processing.

## Table of Contents

1. [Conceptual Overview](#conceptual-overview)
2. [When to Use Streaming](#when-to-use-streaming)
3. [API Reference](#api-reference)
4. [Patterns and Best Practices](#patterns-and-best-practices)
5. [Migration Guide](#migration-guide)
6. [Comparison with Batch Pipelines](#comparison-with-batch-pipelines)
7. [Examples](#examples)
8. [Troubleshooting](#troubleshooting)

## Conceptual Overview

### What are Streaming Pipelines?

Streaming pipelines process data incrementally using async generators, enabling:

- **Lazy Evaluation**: Items processed only when consumed
- **Bounded Memory**: Process datasets larger than RAM
- **Backpressure**: Automatic flow control
- **Early Termination**: Stop processing when enough results found
- **Progressive Results**: Get first results immediately

### Push vs Pull Execution Models

**Batch (Push) Model:**
```typescript
// Eager: All transformations execute immediately
const step1 = data.map(x => x * 2);      // Processes ALL items
const step2 = step1.filter(x => x > 10); // Processes ALL items
const step3 = step2.slice(0, 5);         // Takes first 5
// Wasted work: Processed 95+ items we didn't need
```

**Streaming (Pull) Model:**
```typescript
// Lazy: Transformations execute only when pulled
for await (const item of pipeline.execute(source)) {
  console.log(item);
  if (count++ >= 5) break; // Stop early
}
// Efficient: Only processed ~5 items
```

### Key Benefits

| Benefit | Description | Example Use Case |
|---------|-------------|------------------|
| **Memory Efficiency** | Process one item at a time | Large file processing |
| **Low Latency** | Results available immediately | Real-time dashboards |
| **Early Termination** | Stop when criteria met | Search operations |
| **Backpressure** | Producer slows for slow consumer | Rate-limited APIs |
| **Composability** | Chain operations declaratively | Data pipelines |

### Tradeoffs

| Aspect | Streaming | Batch |
|--------|-----------|-------|
| Memory | Bounded (per-item) | Unbounded (full dataset) |
| Latency | Low (first item fast) | High (all items first) |
| Throughput | Lower (sequential default) | Higher (parallel easy) |
| State | Complex (incremental) | Simple (full dataset) |
| Debugging | Harder (distributed) | Easier (in-memory) |

## When to Use Streaming

### Perfect For Streaming ✅

- **Large Datasets**: Files/datasets larger than RAM
- **Infinite Streams**: Event streams, log tails, real-time data
- **Progressive Processing**: Show results as they arrive
- **Search Operations**: Stop after finding N results
- **Memory-Constrained**: Processing on limited hardware
- **Real-Time Latency**: Need first results immediately
- **Rate-Limited APIs**: Backpressure prevents overwhelming downstream

### Better With Batch ❌

- **Global Aggregations**: Sort, median, percentiles (need full dataset)
- **Small Datasets**: < 10K items that fit comfortably in memory
- **Complex State**: Algorithms requiring random access to all data
- **Simple Scripts**: One-off processing where simplicity matters

### Hybrid Approach ⚡

For many use cases, combine both:

```typescript
// Stream through large dataset
const pipeline = StreamingPipeline.start<Document>()
  .flatMap("chunks", doc => chunkDocument(doc))
  .batch("batches", 100)  // Materialize batches
  .map("embedded", batch => embedBatch(batch))  // Batch API
  .flatMap("flattened", batch => batch);  // Back to streaming
```

## API Reference

### Creating Pipelines

```typescript
import { StreamingPipeline } from "src/core/pipeline/streaming-builder";
import { fromArray } from "src/core/pipeline/streaming/generators";

// Start a new pipeline
const pipeline = StreamingPipeline.start<InputType>()
  .map("step1", transformFn)
  .filter("step2", predicateFn)
  .batch("step3", 10);
```

### Transform Operations

#### `map<TKey, TOutput>(key, fn, options?)`

Transform each item in the stream.

```typescript
.map("doubled", (n) => n * 2)
.map("users", async (id) => await fetchUser(id))
.map("parallel", processFn, {
  parallel: true,
  concurrency: 10,
  ordered: true  // default
})
```

**Options:**
- `parallel`: Enable parallel processing (default: false)
- `concurrency`: Max concurrent operations (default: 10)
- `ordered`: Maintain input order (default: true)

#### `filter<TKey>(key, predicate)`

Keep only items matching the predicate.

```typescript
.filter("evens", (n) => n % 2 === 0)
.filter("active", async (user) => await isActive(user))
```

#### `flatMap<TKey, TOutput>(key, fn)`

Map and flatten - each input produces 0+ outputs.

```typescript
.flatMap("words", (line) => line.split(" "))
.flatMap("chunks", async (doc) => await chunkDocument(doc))
```

#### `tap<TKey>(key, fn)`

Side effects without modifying items.

```typescript
.tap("logged", (item) => console.log(item))
.tap("metrics", (item, index) => recordMetric("processed", { index }))
```

### Windowing Operations

#### `batch<TKey>(key, size)`

Group items into fixed-size arrays.

```typescript
.batch("batches", 10)  // [[1,2,...,10], [11,12,...,20], ...]
```

#### `window<TKey>(key, windowSize, slideSize?)`

Create sliding or tumbling windows.

```typescript
.window("tumbling", 5)        // Non-overlapping: [1-5], [6-10], ...
.window("sliding", 5, 1)      // Overlapping: [1-5], [2-6], [3-7], ...
```

#### `bufferTime<TKey>(key, windowMs, maxSize?)`

Buffer items by time windows.

```typescript
.bufferTime("timed", 1000)        // Emit every 1 second
.bufferTime("mixed", 1000, 100)   // Every 1s OR 100 items
```

### Control Flow

#### `take<TKey>(key, count)`

Take first N items and stop.

```typescript
.take("first10", 10)
```

#### `skip<TKey>(key, count)`

Skip first N items.

```typescript
.skip("skipHeader", 1)
```

#### `takeWhile<TKey>(key, predicate)`

Take items while predicate is true, then stop.

```typescript
.takeWhile("ascending", (n, prev) => n > prev)
```

#### `skipWhile<TKey>(key, predicate)`

Skip items while predicate is true, then start yielding.

```typescript
.skipWhile("skipNegative", (n) => n < 0)
```

### Terminal Operations

#### `build()`

Get the composed generator function.

```typescript
const transform = pipeline.build();

for await (const item of transform(source)) {
  process(item);
}
```

#### `execute(input)`

Execute and return async generator.

```typescript
for await (const item of pipeline.execute(source)) {
  process(item);
}
```

#### `executeToArray(input)`

Execute and collect all results (materializes in memory).

```typescript
const results = await pipeline.executeToArray(source);
```

#### `forEach(input, fn)`

Execute and run side effect for each item.

```typescript
await pipeline.forEach(source, (item, index) => {
  console.log(item);
});
```

#### `reduce(input, reducer, initial)`

Execute and reduce to single value.

```typescript
const sum = await pipeline.reduce(
  source,
  (acc, item) => acc + item,
  0
);
```

### Error Handling

#### `withErrorStrategy(source, fn, strategy, stepName)`

Control error propagation.

```typescript
import { ErrorStrategy, withErrorStrategy } from "src/core/pipeline/streaming/errors";

// Fail fast (default)
withErrorStrategy(source, processFn, ErrorStrategy.FAIL_FAST, "process");

// Skip failed items
withErrorStrategy(source, processFn, ErrorStrategy.SKIP_FAILED, "process");

// Wrap errors as results
withErrorStrategy(source, processFn, ErrorStrategy.WRAP_ERRORS, "process");
```

#### `withRetry(source, fn, options)`

Retry failed items with exponential backoff.

```typescript
import { withRetry } from "src/core/pipeline/streaming/errors";

withRetry(source, async (item) => await process(item), {
  maxAttempts: 3,
  backoffMs: 1000,
  retryableErrors: ["ETIMEDOUT"],
  stepName: "process"
});
```

#### `mapWithRetry(source, fn, retryOptions, errorStrategy)`

Combined map, retry, and error handling.

```typescript
import { mapWithRetry, ErrorStrategy } from "src/core/pipeline/streaming/errors";

mapWithRetry(
  source,
  async (item) => await process(item),
  {
    maxAttempts: 3,
    backoffMs: 1000,
    stepName: "process"
  },
  ErrorStrategy.WRAP_ERRORS
);
```

## Patterns and Best Practices

### Pattern 1: Progressive Processing

Show results as they become available.

```typescript
const pipeline = StreamingPipeline.start<string>()
  .flatMap("documents", async (source) => fetchDocuments(source))
  .map("processed", async (doc) => processDocument(doc), {
    parallel: true,
    concurrency: 5
  });

// Results appear progressively
for await (const result of pipeline.execute(sources)) {
  displayResult(result);  // User sees results immediately
}
```

### Pattern 2: Early Termination for Search

Stop processing when you have enough results.

```typescript
const pipeline = StreamingPipeline.start<Document>()
  .map("scored", (doc) => ({ doc, score: relevanceScore(doc, query) }))
  .filter("relevant", (result) => result.score > 0.8)
  .map("formatted", (result) => result.doc);

const results: Document[] = [];
for await (const doc of pipeline.execute(allDocuments)) {
  results.push(doc);
  if (results.length >= 10) {
    break;  // Found enough, stop processing
  }
}
```

### Pattern 3: Memory-Efficient Batch Processing

Process large datasets with batched API calls.

```typescript
const pipeline = StreamingPipeline.start<string>()
  .batch("batches", 100)  // API limit
  .map("embedded", async (batch) => {
    return await embeddingAPI.embed(batch);
  }, {
    parallel: false  // Respect rate limits
  })
  .flatMap("flattened", (batch) => batch);

// Processes millions of items without loading all into memory
for await (const item of pipeline.execute(hugeDataset)) {
  await saveToDatabase(item);
}
```

### Pattern 4: Parallel Processing with Backpressure

Process items in parallel while respecting resource limits.

```typescript
const pipeline = StreamingPipeline.start<URL>()
  .map("fetched", async (url) => {
    const response = await fetch(url);
    return response.json();
  }, {
    parallel: true,
    concurrency: 20  // Max 20 concurrent requests
  });

// Backpressure: Only 20 requests in flight at a time
for await (const data of pipeline.execute(urls)) {
  process(data);
}
```

### Pattern 5: Error Recovery with Fallbacks

Handle errors gracefully with fallback strategies.

```typescript
const pipeline = StreamingPipeline.start<string>()
  .map("fetched", async (id) => {
    try {
      return await primaryAPI.fetch(id);
    } catch (error) {
      try {
        return await fallbackAPI.fetch(id);
      } catch (fallbackError) {
        return cachedData.get(id);  // Last resort
      }
    }
  });
```

### Pattern 6: Stateful Transformations

Maintain state across items.

```typescript
const seen = new Set<string>();

const pipeline = StreamingPipeline.start<Item>()
  .filter("unique", (item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  })
  .tap("count", () => console.log(`Unique items so far: ${seen.size}`));
```

### Pattern 7: Time-Based Batching

Group items by time windows.

```typescript
const pipeline = StreamingPipeline.start<Event>()
  .bufferTime("windows", 5000)  // 5-second windows
  .map("aggregated", (events) => ({
    count: events.length,
    timestamp: Date.now(),
    summary: aggregateEvents(events)
  }));

// Emit aggregated stats every 5 seconds
for await (const stats of pipeline.execute(eventStream)) {
  updateDashboard(stats);
}
```

### Pattern 8: Composition and Reusability

Build reusable pipeline components.

```typescript
// Reusable step
const deduplicationStep = <T extends { id: string }>() => {
  const seen = new Set<string>();
  return (pipeline: StreamingPipeline<any, T, any>) =>
    pipeline.filter("deduplicated", (item: T) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
};

// Use in multiple pipelines
const pipeline1 = StreamingPipeline.start<Item>()
  .map("fetched", fetchFn)
  .filter("unique", item => !seen.has(item.id));  // Manual

const pipeline2 = StreamingPipeline.start<Item>()
  .map("fetched", fetchFn);
  // Apply reusable component
```

### Best Practices Summary

1. **Choose the Right Concurrency**:
   - CPU-bound: concurrency = CPU cores (2-8)
   - I/O-bound: concurrency = 10-50
   - Rate-limited: concurrency = rate limit

2. **Handle Errors Appropriately**:
   - Critical data: `FAIL_FAST`
   - Best effort: `SKIP_FAILED`
   - Need details: `WRAP_ERRORS`

3. **Use Backpressure**:
   - Let consumer control flow
   - Don't buffer unboundedly
   - Respect downstream limits

4. **Profile Performance**:
   - Measure latency to first result
   - Monitor throughput
   - Check memory usage

5. **Test Edge Cases**:
   - Empty streams
   - Single-item streams
   - Error recovery
   - Early termination

## Migration Guide

See [docs/migration-guide.md](./migration-guide.md) for detailed guidance on migrating from batch to streaming pipelines.

### Quick Migration Checklist

- [ ] Identify operations that benefit from streaming (see [When to Use](#when-to-use-streaming))
- [ ] Convert array operations to streaming:
  - `array.map()` → `.map()`
  - `array.filter()` → `.filter()`
  - `array.flatMap()` → `.flatMap()`
- [ ] Add batching for API calls: `.batch(size)`
- [ ] Enable parallel where beneficial: `{ parallel: true, concurrency: N }`
- [ ] Add error handling: `withErrorStrategy()` or try-catch
- [ ] Test with real data volumes
- [ ] Measure performance improvements

### Migration Example

**Before (Batch):**
```typescript
const results = await Promise.all(
  documents.map(async (doc) => {
    const chunks = await chunkDocument(doc);
    const embedded = await Promise.all(
      chunks.map(chunk => embedChunk(chunk))
    );
    return embedded;
  })
);
// Problem: All in memory, no early termination
```

**After (Streaming):**
```typescript
const pipeline = StreamingPipeline.start<Document>()
  .flatMap("chunks", async (doc) => await chunkDocument(doc))
  .batch("batches", 10)
  .map("embedded", async (batch) => await embedBatch(batch), {
    parallel: true,
    concurrency: 3
  })
  .flatMap("flattened", (batch) => batch);

for await (const embedded of pipeline.execute(documents)) {
  await save(embedded);  // Save progressively
}
// Benefits: Bounded memory, progressive results, early termination possible
```

## Comparison with Batch Pipelines

| Feature | Batch Pipeline | Streaming Pipeline |
|---------|----------------|-------------------|
| **Execution** | Eager (immediate) | Lazy (on-demand) |
| **Memory** | Full dataset in RAM | Bounded per-item |
| **Latency** | High (wait for all) | Low (first item fast) |
| **Throughput** | High (parallel easy) | Medium (sequential default) |
| **Backpressure** | No | Yes |
| **Early Termination** | No (processes all) | Yes (stop anytime) |
| **State Access** | All accumulated | Reduction points only |
| **Error Handling** | Per-batch | Per-item |
| **Use Case** | Small datasets | Large/infinite streams |
| **Simplicity** | Simpler | More complex |
| **Debugging** | Easier (in-memory) | Harder (distributed) |

### When to Use Which

**Use Batch Pipeline when:**
- Dataset < 10,000 items and fits in memory
- Need random access to all data
- Simple aggregations (sum, average)
- Quick prototypes and scripts
- Team unfamiliar with streaming

**Use Streaming Pipeline when:**
- Dataset > 100,000 items or doesn't fit in memory
- Processing infinite streams
- Need progressive results
- Memory constrained
- Early termination valuable
- Real-time latency required

**Use Both (Hybrid) when:**
- Large dataset with batched operations
- Stream -> batch for API calls -> stream results
- Progressive processing with checkpoints

## Examples

All examples are located in `src/core/pipeline/examples/streaming/`:

### Basic Streaming (`01-basic-streaming.ts`)

Foundational concepts:
- Creating streams from arrays
- map, filter, tap operations
- Lazy evaluation benefits
- Consuming with for-await-of
- Memory efficiency comparison

```bash
bun run src/core/pipeline/examples/streaming/01-basic-streaming.ts
```

### Parallel Processing (`02-parallel-streaming.ts`)

Concurrency and parallelism:
- Parallel map with concurrency control
- Ordered vs unordered results
- Backpressure demonstration
- Finding optimal concurrency
- CPU-bound vs I/O-bound work

```bash
bun run src/core/pipeline/examples/streaming/02-parallel-streaming.ts
```

### Error Handling (`03-error-handling.ts`)

Resilient pipelines:
- Error strategies (fail-fast, skip-failed, wrap-errors)
- Retry logic with exponential backoff
- Selective retry (retryable errors only)
- Error aggregation and reporting
- Circuit breaker pattern
- Graceful degradation

```bash
bun run src/core/pipeline/examples/streaming/03-error-handling.ts
```

### RAG Pipeline (`04-rag-pipeline.ts`)

Real-world document processing:
- Streaming documents from sources
- Parallel chunking
- Batched embedding API calls
- Progress tracking
- Memory savings vs batch
- Early termination for search

```bash
bun run src/core/pipeline/examples/streaming/04-rag-pipeline.ts
```

### Windowing (`05-windowing.ts`)

Batching and windowing:
- Fixed-size batches
- Sliding windows
- Time-based batching
- Moving averages
- Session windows
- Event pattern detection

```bash
bun run src/core/pipeline/examples/streaming/05-windowing.ts
```

### State Management (`06-state-management.ts`)

Stateful processing:
- Stateful counting and deduplication
- Running statistics
- Conditional state updates
- State partitioning (per-user, etc.)
- Pattern matching
- Rate limiting with state

```bash
bun run src/core/pipeline/examples/streaming/06-state-management.ts
```

## Troubleshooting

### Problem: Out of Memory

**Symptoms:** Process crashes with heap limit error

**Causes:**
- Materializing large streams with `executeToArray()`
- Accumulating state unboundedly
- No backpressure (producer faster than consumer)

**Solutions:**
```typescript
// ❌ Don't do this with large streams
const all = await pipeline.executeToArray(hugeStream);

// ✅ Do this instead - consume progressively
for await (const item of pipeline.execute(hugeStream)) {
  await processAndSave(item);
}

// ✅ Or use batching
pipeline
  .batch("batches", 100)
  .tap("processBatch", async (batch) => {
    await saveBatch(batch);
  });
```

### Problem: Slow Performance

**Symptoms:** Processing slower than expected

**Causes:**
- Sequential processing of I/O-bound work
- Too low concurrency
- Overhead from tiny batches

**Solutions:**
```typescript
// ❌ Slow: Sequential I/O
.map("fetched", async (url) => await fetch(url))

// ✅ Fast: Parallel I/O
.map("fetched", async (url) => await fetch(url), {
  parallel: true,
  concurrency: 20
})

// ✅ Right-sized batches
.batch("batches", 100)  // Not 1, not 10000
```

### Problem: Results Out of Order

**Symptoms:** Items appear in wrong order

**Causes:**
- Parallel processing with `ordered: false`
- Async operations complete at different times

**Solutions:**
```typescript
// ❌ Unordered
.map("processed", processFn, {
  parallel: true,
  ordered: false  // Faster but unordered
})

// ✅ Ordered (default)
.map("processed", processFn, {
  parallel: true,
  ordered: true  // Maintains input order
})
```

### Problem: Pipeline Never Completes

**Symptoms:** Hangs forever, no results

**Causes:**
- Source stream never closes
- Deadlock in state management
- Unhandled promise rejection

**Solutions:**
```typescript
// ✅ Ensure source closes
async function* mySource() {
  try {
    yield* items;
  } finally {
    await cleanup();  // Always cleanup
  }
}

// ✅ Add timeout
const timeout = setTimeout(() => {
  console.error("Pipeline timeout!");
  process.exit(1);
}, 60000);

for await (const item of pipeline.execute(source)) {
  process(item);
}

clearTimeout(timeout);
```

### Problem: Type Errors

**Symptoms:** TypeScript compilation errors

**Causes:**
- Type inference limitations
- Missing generic parameters

**Solutions:**
```typescript
// ❌ Type inference may fail
.map("step", (item) => transform(item))

// ✅ Explicit types
.map<"step", OutputType>("step", (item: InputType): OutputType => {
  return transform(item);
})
```

### Getting Help

1. Check the examples in `src/core/pipeline/examples/streaming/`
2. Read the [Architecture Decision Records](./architecture/)
3. Review existing tests for patterns
4. Ask in project discussions

## Further Reading

- [Architecture Decision: Streaming Pipeline Design](./architecture/streaming-pipeline-design.md)
- [Migration Guide](./migration-guide.md)
- [Batch Pipeline Guide](./migration-guide.md)
- [Examples](../src/core/pipeline/examples/streaming/)
