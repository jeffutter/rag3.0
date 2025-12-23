# Streaming Pipeline Migration Guide

## Overview

This guide helps you migrate existing batch pipeline steps to streaming-compatible versions. The streaming architecture enables lazy evaluation, backpressure, and incremental processing for better memory efficiency and performance.

## Table of Contents

1. [When to Use Streaming](#when-to-use-streaming)
2. [Step Categories](#step-categories)
3. [Migration Approaches](#migration-approaches)
4. [Step-by-Step Migration](#step-by-step-migration)
5. [Testing Your Migration](#testing-your-migration)
6. [Common Patterns](#common-patterns)
7. [Troubleshooting](#troubleshooting)

## When to Use Streaming

Use streaming pipelines when:

- **Large datasets**: Processing thousands or millions of items
- **Memory constraints**: Can't fit entire dataset in memory
- **Early termination**: May not need all results (e.g., "find first 10 matching items")
- **Real-time processing**: Need to start outputting results before all inputs are available
- **Backpressure**: Need to control flow between producer and consumer

Keep batch pipelines when:

- **Small datasets**: < 1000 items that fit easily in memory
- **Aggregations**: Need full dataset (sort, group by, statistics)
- **Simplicity**: Batch logic is significantly simpler
- **Full observability**: Need complete metadata and timing for all items

## Step Categories

Understanding your step's category helps determine the best migration approach:

### 1. Pure Transforms (Excellent Streaming Candidates)

**Characteristics:**
- 1:1 input to output mapping
- No dependencies between items
- Stateless or minimal state

**Examples:**
```typescript
// Parse JSON
const parse = createStep<string, object>(
  'parse',
  async ({ input }) => JSON.parse(input)
);

// Convert to uppercase
const upperCase = createStep<string, string>(
  'upper',
  async ({ input }) => input.toUpperCase()
);

// Extract field
const extractId = createStep<User, string>(
  'extractId',
  async ({ input }) => input.id
);
```

**Migration:** Use `toStreamingStep()` wrapper - minimal changes needed.

### 2. I/O Bound (Excellent Streaming Candidates)

**Characteristics:**
- External operations (API calls, file I/O, database queries)
- Benefit from concurrency control
- Natural backpressure points

**Examples:**
```typescript
// Read file
const readFile = createStep<string, FileContent>(
  'readFile',
  async ({ input }) => {
    const file = Bun.file(input);
    return { content: await file.text(), path: input };
  }
);

// Fetch API
const fetchUser = createStep<string, User>(
  'fetchUser',
  async ({ input }) => {
    const response = await fetch(`https://api.example.com/users/${input}`);
    return response.json();
  }
);
```

**Migration:** Use `toStreamingStep()` wrapper + parallel options.

### 3. Expansion (Excellent Streaming Candidates)

**Characteristics:**
- Produces multiple outputs per input
- Reduces memory pressure significantly
- Natural for streaming

**Examples:**
```typescript
// Split text into chunks
const chunk = createStep<string, string[]>(
  'chunk',
  async ({ input }) => {
    const chunks = [];
    for (let i = 0; i < input.length; i += 100) {
      chunks.push(input.slice(i, i + 100));
    }
    return chunks;
  }
);
```

**Migration:** Manual conversion with `flatMap` semantics.

### 4. Reduction (Good Streaming Candidates)

**Characteristics:**
- Fewer outputs than inputs
- Reduces downstream load
- May have bounded state

**Examples:**
```typescript
// Filter valid items
const filterValid = createStep<Item[], Item[]>(
  'filter',
  async ({ input }) => input.filter(item => item.isValid)
);

// Deduplicate
const dedupe = createStep<string[], string[]>(
  'dedupe',
  async ({ input }) => [...new Set(input)]
);
```

**Migration:** Use `toStreamingStep()` or create hybrid step.

### 5. Stateful (Good with Caution)

**Characteristics:**
- Maintains state across items
- State must be bounded
- Requires careful state management

**Examples:**
```typescript
// Rate limiting
const rateLimit = createStep<Request, Request>(
  'rateLimit',
  async ({ input }) => {
    await checkRateLimit();
    return input;
  }
);

// Running average (bounded window)
const movingAverage = createStep<number, number>(
  'movingAvg',
  async ({ input }) => {
    // Keep only last 10 values
    return calculateAverage(last10);
  }
);
```

**Migration:** Manual conversion with explicit state management.

### 6. Aggregation (Poor Streaming Candidates)

**Characteristics:**
- Requires full dataset
- Defeats streaming benefits
- Keep as batch or use windowing

**Examples:**
```typescript
// Sort
const sort = createStep<number[], number[]>(
  'sort',
  async ({ input }) => [...input].sort()
);

// Group by
const groupBy = createStep<Item[], Record<string, Item[]>>(
  'groupBy',
  async ({ input }) => {
    // Need all items to group
    return groupByKey(input);
  }
);
```

**Migration:** Keep as batch or use windowing for approximate results.

## Migration Approaches

### Approach 1: Automatic Wrapper (toStreamingStep)

**Best for:** Pure transforms, I/O bound, simple reductions

**Pros:**
- Minimal code changes
- Preserves existing step logic
- Automatic error handling

**Cons:**
- Small performance overhead
- May not optimize for streaming semantics

**Example:**
```typescript
// Before: Batch step
const upperCase = createStep<string, string>(
  'upperCase',
  async ({ input }) => input.toUpperCase()
);

// After: Wrapped as streaming
import { toStreamingStep } from './core/pipeline/streaming-adapters';

const streamingUpperCase = toStreamingStep(upperCase);

// Use in streaming pipeline
const pipeline = StreamingPipeline.start<string>()
  .add('upper', streamingUpperCase);
```

### Approach 2: Manual Conversion (createStreamingStep)

**Best for:** Expansions, stateful steps, performance-critical paths

**Pros:**
- Full control over streaming semantics
- Optimal performance
- Can use flatMap, state, etc.

**Cons:**
- More code changes
- Need to understand async generators

**Example:**
```typescript
// Before: Batch step
const chunk = createStep<string, string[]>(
  'chunk',
  async ({ input }) => {
    const chunks = [];
    for (let i = 0; i < input.length; i += 100) {
      chunks.push(input.slice(i, i + 100));
    }
    return chunks;
  }
);

// After: Native streaming step
import { createStreamingStep } from './core/pipeline/streaming-steps';

const streamingChunk = createStreamingStep<string, string>(
  'chunk',
  async function* ({ input }) {
    for await (const text of input) {
      // Yield chunks as they're produced
      for (let i = 0; i < text.length; i += 100) {
        yield text.slice(i, i + 100);
      }
    }
  }
);
```

### Approach 3: Hybrid Step (createHybridStep)

**Best for:** Reusable steps, library code, gradual migration

**Pros:**
- Works in both batch and streaming pipelines
- Single implementation to maintain
- Smooth migration path

**Cons:**
- Must implement both modes
- Slightly more complex

**Example:**
```typescript
import { createHybridStep } from './core/pipeline/streaming-adapters';

const upperCase = createHybridStep<string, string>(
  'upperCase',
  // Batch mode
  async ({ input }) => input.map(s => s.toUpperCase()),
  // Streaming mode
  async function* ({ input }) {
    for await (const s of input) {
      yield s.toUpperCase();
    }
  }
);

// Use in batch pipeline
const batchPipeline = Pipeline.start<string[]>()
  .add('upper', toBatchMode(upperCase));

// Use in streaming pipeline
const streamingPipeline = StreamingPipeline.start<string>()
  .add('upper', toStreamingMode(upperCase));
```

## Step-by-Step Migration

### Step 1: Categorize Your Step

Use the categorization helper to understand your step:

```typescript
import { categorizeStep, getMigrationRecommendation } from './core/pipeline/streaming-adapters';

const myStep = createStep('myStep', async ({ input }) => {
  // ... your logic
});

const category = categorizeStep(myStep);
const recommendation = getMigrationRecommendation(myStep);

console.log('Category:', category);
console.log('Recommended:', recommendation.recommended);
console.log('Approach:', recommendation.approach);
console.log('Reason:', recommendation.reason);
```

### Step 2: Choose Migration Approach

Based on the recommendation:

- `toStreamingStep` → Use Approach 1 (Automatic Wrapper)
- `manual_conversion` → Use Approach 2 (Manual Conversion)
- `createHybridStep` → Use Approach 3 (Hybrid Step)
- `keep_batch` → Don't migrate, keep as batch

### Step 3: Implement the Migration

See examples above for each approach.

### Step 4: Update Pipeline Usage

```typescript
// Before: Batch pipeline
const batchPipeline = Pipeline.start<Document[]>()
  .map('parsed', parseStep, { parallel: true })
  .map('validated', validateStep, { parallel: false });

const results = await batchPipeline.execute(documents);

// After: Streaming pipeline
import { fromArray } from './core/pipeline/streaming/generators';

const streamingPipeline = StreamingPipeline.start<Document>()
  .add('parsed', streamingParseStep)
  .add('validated', streamingValidateStep);

// Execute and collect all results
const results = await streamingPipeline.executeToArray(fromArray(documents));

// OR iterate lazily
for await (const doc of streamingPipeline.execute(fromArray(documents))) {
  console.log(doc);
  // Early termination possible here
}
```

## Testing Your Migration

### Behavioral Equivalence Tests

Ensure streaming version produces identical results:

```typescript
import { describe, expect, test } from 'bun:test';
import { arrayToGenerator, collectStream } from './core/pipeline/streaming-state';

test('streaming produces same results as batch', async () => {
  const testInputs = ['hello', 'world', 'test'];

  // Run batch version
  const batchResults = await Promise.all(
    testInputs.map(input => batchStep.execute({ input, state: {}, context: undefined }))
  );
  const batchData = batchResults.map(r => r.success ? r.data : null).filter(Boolean);

  // Run streaming version
  const inputGen = arrayToGenerator(testInputs);
  const state = new StreamingStateImpl<Record<string, never>>({}, {});
  const streamingResults = await collectStream(
    streamingStep.execute({ input: inputGen, state, context: undefined })
  );

  expect(streamingResults).toEqual(batchData);
});
```

### Performance Tests

Compare performance characteristics:

```typescript
test('streaming memory usage is lower', async () => {
  const largeInput = Array.from({ length: 10000 }, (_, i) => i);

  const memBefore = process.memoryUsage().heapUsed;
  await streamingPipeline.executeToArray(fromArray(largeInput));
  const memAfter = process.memoryUsage().heapUsed;

  const streamingMemDelta = memAfter - memBefore;

  // Should use reasonable memory (not proportional to input size)
  expect(streamingMemDelta).toBeLessThan(100 * 1024 * 1024); // < 100MB
});
```

## Common Patterns

### Pattern 1: Accessing Checkpointed State

```typescript
// Checkpoint configuration once, use for all items
type State = { config: { apiKey: string }[] };

const processWithConfig = createStreamingStep<Item, ProcessedItem, State>(
  'process',
  async function* ({ input, state }) {
    // Access checkpointed config (fast, no materialization)
    const config = state.accumulated.config[0];

    for await (const item of input) {
      // Use config for each item
      const processed = await processItem(item, config.apiKey);
      yield processed;
    }
  }
);
```

### Pattern 2: Parallel I/O with Streaming

```typescript
// Use parallel map for I/O-bound operations
const pipeline = StreamingPipeline.start<string>()
  .map('fetched', fetchStep, {
    parallel: true,
    concurrency: 10 // Limit concurrent requests
  });
```

### Pattern 3: Early Termination

```typescript
// Take only first N results
const pipeline = StreamingPipeline.start<Item>()
  .add('filtered', filterStep)
  .take('limited', 10); // Only process until 10 results

// OR manual early termination
const generator = pipeline.execute(input);
const results = [];
for await (const item of generator) {
  results.push(item);
  if (results.length >= 10) {
    break; // Stop processing
  }
}
```

### Pattern 4: Batching for Efficiency

```typescript
// Batch items for API calls
const pipeline = StreamingPipeline.start<Item>()
  .batch('batched', 100) // Group into batches of 100
  .map('processed', processBatch); // Process each batch
```

## Troubleshooting

### Issue: Step accesses other step outputs

**Problem:**
```typescript
const badStep = createStep('bad', async ({ input, state }) => {
  // Trying to access another step's output
  const prevResults = state.otherStep; // May not be available in streaming
  // ...
});
```

**Solution:**
Use checkpoints for steps that need to reference previous outputs:

```typescript
// Checkpoint the previous step
const state = await prevState.withCheckpoint('otherStep', otherStepGenerator);

// Now can access in streaming step
const goodStep = createStreamingStep<Input, Output, { otherStep: OtherResult[] }>(
  'good',
  async function* ({ input, state }) {
    const prevResults = state.accumulated.otherStep;
    for await (const item of input) {
      // Use prevResults
      yield process(item, prevResults);
    }
  }
);
```

### Issue: Step needs full dataset

**Problem:**
```typescript
// Can't stream - needs all items
const sort = createStep('sort', async ({ input }) => {
  return input.sort(); // Needs entire array
});
```

**Solution:**
Keep as batch step or use windowing for approximate results:

```typescript
// Option 1: Keep as batch, use materialization point
const pipeline = StreamingPipeline.start<number>()
  .add('filter', filterStep)
  // Materialize here for sorting
  .toArray()
  // Continue with batch
  .then(items => items.sort());

// Option 2: Use windowing for approximate sort
const pipeline = StreamingPipeline.start<number>()
  .window('windowed', { windowSize: 100 })
  .map('sorted', window => window.sort());
```

### Issue: Performance regression

**Problem:** Streaming is slower than batch for small datasets.

**Solution:**
- Use hybrid steps that can choose optimal mode
- Keep batch for small datasets (< 1000 items)
- Use parallel options for I/O-bound steps
- Consider adapter overhead (< 50% typically)

### Issue: State grows unbounded

**Problem:** Stateful step accumulates too much state.

**Solution:**
Use bounded state with explicit cleanup:

```typescript
const boundedState = createStreamingStep('bounded', async function* ({ input }) {
  const recentItems: Item[] = [];
  const maxSize = 100;

  for await (const item of input) {
    recentItems.push(item);
    if (recentItems.length > maxSize) {
      recentItems.shift(); // Remove oldest
    }
    yield processWithRecent(item, recentItems);
  }
});
```

## Best Practices

1. **Start with pure transforms** - Easiest to migrate, lowest risk
2. **Test behavioral equivalence** - Ensure results match batch version
3. **Benchmark performance** - Measure memory and latency improvements
4. **Use hybrid steps for libraries** - Supports both modes
5. **Checkpoint sparingly** - Only for frequently accessed state
6. **Handle errors gracefully** - Use error strategies
7. **Document streaming semantics** - Explain state requirements
8. **Monitor memory usage** - Ensure constant memory consumption
9. **Consider early termination** - Design for partial result scenarios
10. **Profile before optimizing** - Focus on actual bottlenecks

## Next Steps

1. Review [Streaming Pipeline Design](../architecture/streaming-pipeline-design.md)
2. Explore [Streaming Examples](/home/jeffutter/src/core/pipeline/streaming-examples.ts)
3. Check [Performance Benchmarks](../core/pipeline/streaming-adapters.bench.test.ts)
4. Join the discussion on streaming best practices

## Support

For questions or issues:
- Check existing tests in `streaming-adapters.test.ts`
- Review examples in `streaming-examples.ts`
- Consult the architecture document
- Open an issue for bugs or feature requests
