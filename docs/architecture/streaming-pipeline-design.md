# Streaming Pipeline Architecture Design

## Executive Summary

This document presents the design for an async generator-based streaming pipeline architecture that enables pull-based, demand-driven execution for the RAG pipeline system. The design maintains backwards compatibility with the existing Pipeline API while introducing a new StreamingPipeline that provides lazy evaluation, backpressure, and incremental processing.

**Status:** Design Approved (2025-12-22)

**Key Decisions:**
- Parallel implementation (new StreamingPipeline alongside existing Pipeline)
- Hybrid state management (streaming + snapshots)
- Dual error handling (yield-time + pull-time)
- Progressive metadata collection
- Builder pattern API (familiar to existing users)
- Generator-preserving type signatures
- Gradual migration path with interop layer

## Table of Contents

1. [Current State Analysis](#current-state-analysis)
2. [Design Decisions](#design-decisions)
3. [API Design](#api-design)
4. [Type System Design](#type-system-design)
5. [State Management](#state-management)
6. [Error Handling](#error-handling)
7. [Metadata Collection](#metadata-collection)
8. [Migration Strategy](#migration-strategy)
9. [Performance Considerations](#performance-considerations)
10. [Examples](#examples)

## Current State Analysis

### Existing Pipeline Characteristics

**Execution Model:**
- Sequential for-loop execution
- Each step completes fully before the next begins
- Batch-oriented: entire arrays materialized in memory
- Parallel execution available within list operations (map/flatMap)

**State Management:**
- `accumulatedState` object built incrementally
- Each step's output stored by key
- Previous steps' outputs accessible via state

**Error Handling:**
- Step-level try/catch blocks
- Retry logic with exponential backoff
- List error strategies: FAIL_FAST, COLLECT_ERRORS, SKIP_FAILED
- Rich error context with trace IDs

**Strengths:**
- Type-safe accumulated state
- Comprehensive error handling
- Rich observability (logging, timing, metadata)
- Well-tested and production-ready

**Limitations:**
- No streaming: all data materialized in memory
- No lazy evaluation: steps run even if output unused
- No backpressure: cannot slow down upstream producers
- Memory scaling issues with large datasets

## Design Decisions

### Decision 1: Parallel Implementation vs Replacement

**Decision:** Parallel implementation (create StreamingPipeline alongside existing Pipeline)

**Rationale:**
1. **Risk Mitigation:** Existing Pipeline is production-ready with comprehensive test coverage
2. **Backwards Compatibility:** Existing workflows continue working without changes
3. **Gradual Migration:** Teams can migrate workflows incrementally
4. **Different Use Cases:** Both patterns have valid use cases
   - Pipeline: Batch processing, full observability needed
   - StreamingPipeline: Large datasets, memory constraints, real-time processing
5. **Learning Curve:** Users can learn streaming concepts without breaking existing code

**Trade-offs:**
- (+) Zero risk to existing functionality
- (+) Clear migration path
- (-) Increased maintenance burden (two implementations)
- (-) Some code duplication

**Implementation:**
```typescript
// Existing API remains unchanged
const batchPipeline = Pipeline.start<Input>()
  .add("step1", step1)
  .add("step2", step2);

// New streaming API
const streamingPipeline = StreamingPipeline.start<Input>()
  .add("step1", streamingStep1)
  .add("step2", streamingStep2);
```

### Decision 2: State Management Strategy

**Decision:** Hybrid state management (streaming + snapshots)

**Approach:**
1. **Streaming State:** Current item flows through async generators
2. **Snapshot State:** Accumulated state captured at configurable checkpoints
3. **Lazy State Access:** State materialized only when accessed

**Rationale:**
- Maintains type-safe state access (critical for developer experience)
- Enables cross-step references (key Pipeline feature)
- Minimizes memory overhead (snapshots only when needed)
- Supports debugging (can inspect state at checkpoints)

**Implementation Strategy:**

```typescript
interface StreamingState<TAccumulated> {
  // Snapshot of accumulated state (lazy-loaded)
  accumulated: TAccumulated;

  // Access to previous step outputs (async generators)
  stream<K extends keyof TAccumulated>(key: K): AsyncGenerator<TAccumulated[K]>;

  // Force materialization of a stream to array
  materialize<K extends keyof TAccumulated>(key: K): Promise<Array<TAccumulated[K]>>;
}

interface StreamingStepContext<TInput, TAccumulated, TContext> {
  // Current input item
  input: TInput;

  // State access (streaming + snapshots)
  state: StreamingState<TAccumulated>;

  // Runtime context
  context: TContext;
}
```

**State Checkpoint Strategy:**
- Automatic checkpoints after `.add()` steps
- Explicit checkpoints via `.checkpoint()` method
- Configurable checkpoint behavior (always, never, on-demand)

### Decision 3: Error Handling Model

**Decision:** Dual error handling (yield-time + pull-time)

**Approach:**
1. **Yield-time errors:** Caught when generator yields a value
2. **Pull-time errors:** Caught when consumer pulls from generator
3. **Error propagation:** Errors bubble up through generator chain
4. **Retry logic:** Preserved at step level

**Rationale:**
- Maintains existing retry capabilities
- Enables early error detection (fail fast when possible)
- Supports partial success (continue processing after errors)
- Provides flexibility for different error strategies

**Error Strategies for Streaming:**

```typescript
enum StreamingErrorStrategy {
  // Stop on first error (default)
  FAIL_FAST = "FAIL_FAST",

  // Skip failed items, continue processing
  SKIP_FAILED = "SKIP_FAILED",

  // Collect errors but continue, return both successes and failures
  COLLECT_ERRORS = "COLLECT_ERRORS",

  // Emit error items to separate error stream
  SPLIT_ERRORS = "SPLIT_ERRORS",
}
```

**Error Context:**
```typescript
interface StreamingError extends Error {
  code: string;
  stepName: string;
  itemIndex?: number;
  retryable: boolean;
  cause?: unknown;
  traceId: string;
  spanId: string;
}
```

### Decision 4: Metadata Collection Approach

**Decision:** Progressive metadata collection

**Approach:**
1. **Stream-level metadata:** Collected incrementally as items flow
2. **Lazy aggregation:** Statistics computed on-demand
3. **Sampling:** For large streams, sample timing data
4. **Configurable verbosity:** Control metadata overhead

**Metadata Types:**

```typescript
interface StreamingMetadata {
  stepName: string;

  // Timing (lazy aggregation)
  timing: {
    itemCount: number;
    sampledCount: number;
    avgDurationMs: number;
    p50DurationMs?: number;
    p95DurationMs?: number;
    p99DurationMs?: number;
  };

  // Tracing
  traceId: string;
  spanId: string;

  // Errors
  errorCount: number;
  errors?: StreamingError[];

  // Execution mode
  executionMode: "streaming" | "parallel-streaming" | "batch";
}
```

**Collection Strategy:**
- **Inline metadata:** Attached to each yielded item (minimal overhead)
- **Aggregated metadata:** Collected in background, available after stream completes
- **Sampling rate:** Configurable (e.g., sample 1% for very large streams)

### Decision 5: API Design

**Decision:** Builder pattern with async generator support

**Rationale:**
- Familiar to existing Pipeline users
- Type-safe method chaining
- Clear separation between construction and execution
- Easy to add streaming-specific methods

**Core API:**

```typescript
class StreamingPipeline<TInitialInput, TCurrentOutput, TAccumulated, TContext> {
  static start<TInput, TContext = unknown>(
    contextBuilder?: () => TContext
  ): StreamingPipeline<TInput, TInput, {}, TContext>;

  // Add a streaming step
  add<TKey extends string, TNextOutput>(
    key: TKey,
    step: StreamingStep<TCurrentOutput, TNextOutput, TAccumulated, TContext>
  ): StreamingPipeline<...>;

  // Map over stream items
  map<TKey extends string, TOutput>(
    key: TKey,
    step: StreamingStep<TCurrentOutput, TOutput, TAccumulated, TContext>,
    options?: StreamingOptions
  ): StreamingPipeline<...>;

  // FlatMap over stream items
  flatMap<TKey extends string, TOutput>(
    key: TKey,
    step: StreamingStep<TCurrentOutput, AsyncGenerator<TOutput>, TAccumulated, TContext>
  ): StreamingPipeline<...>;

  // Filter stream items
  filter<TKey extends string>(
    key: TKey,
    predicate: (item: TCurrentOutput) => boolean | Promise<boolean>
  ): StreamingPipeline<...>;

  // Batch stream items
  batch<TKey extends string>(
    key: TKey,
    size: number
  ): StreamingPipeline<...>;

  // Take first N items
  take<TKey extends string>(
    key: TKey,
    count: number
  ): StreamingPipeline<...>;

  // Skip first N items
  skip<TKey extends string>(
    key: TKey,
    count: number
  ): StreamingPipeline<...>;

  // Force a checkpoint (materialize state)
  checkpoint<TKey extends string>(
    key: TKey
  ): StreamingPipeline<...>;

  // Execute and return async generator
  execute(input: TInitialInput): AsyncGenerator<TCurrentOutput>;

  // Execute and collect to array
  executeToArray(input: TInitialInput): Promise<TCurrentOutput[]>;

  // Execute and reduce
  executeReduce<TResult>(
    input: TInitialInput,
    reducer: (acc: TResult, item: TCurrentOutput) => TResult,
    initial: TResult
  ): Promise<TResult>;
}
```

**Streaming Step Interface:**

```typescript
interface StreamingStep<TInput, TOutput, TAccumulated, TContext> {
  name: string;

  // Generator-based execution
  execute(
    ctx: StreamingStepContext<TInput, TAccumulated, TContext>
  ): AsyncGenerator<TOutput>;

  // Optional retry configuration
  retry?: {
    maxAttempts: number;
    backoffMs: number;
    retryableErrors?: string[];
  };
}
```

**Helper Function:**

```typescript
function createStreamingStep<TInput, TOutput, TAccumulated, TContext>(
  name: string,
  execute: (
    ctx: StreamingStepContext<TInput, TAccumulated, TContext>
  ) => AsyncGenerator<TOutput>,
  options?: {
    retry?: {
      maxAttempts: number;
      backoffMs: number;
      retryableErrors?: string[];
    };
  }
): StreamingStep<TInput, TOutput, TAccumulated, TContext>;
```

### Decision 6: Type Signature Design

**Decision:** Generator-preserving type signatures

**Approach:**
- Input types flow through as `AsyncGenerator<TInput>`
- Output types flow through as `AsyncGenerator<TOutput>`
- Accumulated state tracks snapshots, not streams
- Type inference maintained throughout chain

**Type System:**

```typescript
// Core types
type StreamingStepInput<S> =
  S extends StreamingStep<infer I, any, any, any> ? AsyncGenerator<I> : never;

type StreamingStepOutput<S> =
  S extends StreamingStep<any, infer O, any, any> ? AsyncGenerator<O> : never;

type StreamingStepAccumulated<S> =
  S extends StreamingStep<any, any, infer A, any> ? A : never;

// State accumulation (same as Pipeline)
type AddToState<TState, TKey extends string, TValue> =
  TState & Record<TKey, TValue>;

// Prevent duplicate keys
type ValidateNewKey<TState, TKey extends string> =
  TKey extends keyof TState ? never : TKey;
```

### Decision 7: Backwards Compatibility Strategy

**Decision:** Gradual migration with interop layer

**Approach:**
1. **Adapter functions:** Convert between Pipeline and StreamingPipeline
2. **Shared step interface:** Steps work in both pipelines where possible
3. **Feature parity:** StreamingPipeline supports key Pipeline features
4. **Documentation:** Clear migration guide with examples

**Interop Layer:**

```typescript
// Convert Pipeline to StreamingPipeline
function pipelineToStreaming<TInput, TOutput, TState, TContext>(
  pipeline: Pipeline<TInput, TOutput, TState, TContext>
): StreamingPipeline<TInput, TOutput, TState, TContext>;

// Convert StreamingPipeline to Pipeline (materialize)
function streamingToPipeline<TInput, TOutput, TState, TContext>(
  streamingPipeline: StreamingPipeline<TInput, TOutput, TState, TContext>
): Pipeline<TInput, TOutput[], TState, TContext>;

// Convert Step to StreamingStep
function stepToStreamingStep<TInput, TOutput, TState, TContext>(
  step: Step<TInput, TOutput, TState, TContext>
): StreamingStep<TInput, TOutput, TState, TContext>;

// Convert StreamingStep to Step (materialize)
function streamingStepToStep<TInput, TOutput, TState, TContext>(
  streamingStep: StreamingStep<TInput, TOutput, TState, TContext>
): Step<TInput[], TOutput[], TState, TContext>;
```

**Migration Path:**
1. **Phase 1:** Introduce StreamingPipeline with basic operations
2. **Phase 2:** Add interop layer for mixed pipelines
3. **Phase 3:** Migrate high-memory workflows to streaming
4. **Phase 4:** Deprecate (but maintain) redundant operations
5. **Phase 5:** Long-term maintenance of both APIs (no removal planned)

## API Design

### Basic Streaming Step

```typescript
const readFilesStep = createStreamingStep<string, FileContent>(
  "readFiles",
  async function* ({ input }) {
    // input is an async generator of file paths
    for await (const path of input) {
      try {
        const content = await readFile(path);
        yield content;
      } catch (error) {
        console.warn(`Error reading ${path}:`, error);
        // Skip failed files
      }
    }
  }
);
```

### Streaming Pipeline Construction

```typescript
const pipeline = StreamingPipeline.start<{ path: string; pattern: string }>()
  // Discover files (returns generator of file entries)
  .add("discover", discoverFilesStreamingStep)

  // Read each file (streaming)
  .map("readFiles", readFileStreamingStep, {
    parallel: true,
    concurrencyLimit: 10,
  })

  // Clean markdown (streaming)
  .map("cleanFiles", cleanMarkdownStreamingStep, {
    parallel: true,
  })

  // Split into chunks (flatMap generates multiple outputs per input)
  .flatMap("chunks", splitMarkdownStreamingStep)

  // Add EOT tokens
  .map("withEOT", addEOTStreamingStep)

  // Batch for embeddings
  .batch("batches", 50)

  // Generate embeddings (batched)
  .map("embeddings", generateEmbeddingsStreamingStep)

  // Flatten batches
  .flatMap("embedded", unbatchStreamingStep);
```

### Execution Modes

```typescript
// Mode 1: Stream consumption
const pipeline = StreamingPipeline.start<Input>()...;

for await (const result of pipeline.execute(input)) {
  // Process results as they arrive
  console.log(result);
}

// Mode 2: Collect to array
const results = await pipeline.executeToArray(input);

// Mode 3: Reduce
const count = await pipeline.executeReduce(
  input,
  (acc, _item) => acc + 1,
  0
);

// Mode 4: Early termination
const pipeline = StreamingPipeline.start<Input>()
  .map("step1", step1)
  .take("first10", 10)  // Only take first 10 results
  .map("step2", step2);

// Mode 5: Pagination
const pipeline = StreamingPipeline.start<Input>()
  .map("step1", step1)
  .skip("skipFirst20", 20)
  .take("next10", 10);  // Get items 21-30
```

## Type System Design

### Complete Type Definitions

```typescript
// Streaming execution context
interface StreamingStepContext<TInput, TAccumulated, TContext> {
  // Input stream
  input: AsyncGenerator<TInput>;

  // State access
  state: StreamingState<TAccumulated>;

  // Runtime context
  context: TContext;
}

// State interface
interface StreamingState<TAccumulated> {
  // Snapshot access (lazy)
  accumulated: TAccumulated;

  // Stream access
  stream<K extends keyof TAccumulated>(key: K): AsyncGenerator<TAccumulated[K]>;

  // Materialize stream to array
  materialize<K extends keyof TAccumulated>(key: K): Promise<Array<TAccumulated[K]>>;

  // Check if key has snapshot
  hasSnapshot(key: keyof TAccumulated): boolean;
}

// Streaming step result (with metadata)
interface StreamingStepResult<T> {
  data: T;
  metadata?: {
    durationMs: number;
    stepName: string;
    itemIndex: number;
  };
}

// Streaming step interface
interface StreamingStep<TInput, TOutput, TAccumulated, TContext> {
  name: string;

  execute(
    ctx: StreamingStepContext<TInput, TAccumulated, TContext>
  ): AsyncGenerator<TOutput>;

  retry?: {
    maxAttempts: number;
    backoffMs: number;
    retryableErrors?: string[];
  };
}

// Pipeline class signature
class StreamingPipeline<
  TInitialInput,
  TCurrentOutput,
  TAccumulated extends Record<string, any>,
  TContext = unknown
> {
  // ... methods ...
}
```

### Type-Safe State Access

```typescript
// Example showing type inference
const pipeline = StreamingPipeline.start<string>()
  .add("step1", step1)  // Returns { value: number }
  .add("step2", createStreamingStep<number, string>(
    "step2",
    async function* ({ input, state }) {
      // Type inference:
      // - input: AsyncGenerator<{ value: number }>
      // - state.accumulated: { step1: { value: number } }

      for await (const item of input) {
        // item: { value: number }
        // state.accumulated.step1: { value: number }

        yield `Value: ${item.value}`;
      }
    }
  ));

// TypeScript enforces state shape
type PipelineState = typeof pipeline extends
  StreamingPipeline<any, any, infer S, any> ? S : never;
// PipelineState = { step1: { value: number }; step2: string }
```

## State Management

### Checkpoint Strategy

```typescript
const pipeline = StreamingPipeline.start<Input>()
  .add("step1", step1)
  .checkpoint("step1_snapshot")  // Force snapshot
  .map("step2", step2)
  .map("step3", step3)
  .checkpoint("step3_snapshot")  // Another snapshot
  .map("step4", createStreamingStep("step4", async function* ({ input, state }) {
    // Can access step1 and step3 snapshots efficiently
    const step1Data = state.accumulated.step1_snapshot;
    const step3Data = state.accumulated.step3_snapshot;

    for await (const item of input) {
      // Process with access to snapshots
      yield processItem(item, step1Data, step3Data);
    }
  }));
```

### Lazy State Materialization

```typescript
const pipeline = StreamingPipeline.start<Input>()
  .add("step1", step1)
  .map("step2", step2)
  .add("step3", createStreamingStep("step3", async function* ({ input, state }) {
    // Option 1: Stream from previous step (no materialization)
    const step2Stream = state.stream("step2");

    // Option 2: Materialize previous step to array
    const step2Array = await state.materialize("step2");

    // Option 3: Access snapshot (if checkpoint exists)
    if (state.hasSnapshot("step1")) {
      const step1Data = state.accumulated.step1;
      // Use snapshot
    }

    for await (const item of input) {
      yield processItem(item, step2Array);
    }
  }));
```

### Memory-Efficient Pattern

```typescript
// Pattern: Only materialize when necessary
const pipeline = StreamingPipeline.start<Input>()
  .map("transform1", transform1)  // Streaming
  .map("transform2", transform2)  // Streaming
  .map("transform3", transform3)  // Streaming
  // No checkpoints = no materialization
  // Memory usage: O(1) per item in flight

  .checkpoint("batch_checkpoint")  // Materialize here
  .batch("batches", 100)
  .map("process_batch", processBatch);
```

## Error Handling

### Retry Logic

```typescript
const resilientStep = createStreamingStep<Input, Output>(
  "resilientStep",
  async function* ({ input }) {
    for await (const item of input) {
      yield processItem(item);
    }
  },
  {
    retry: {
      maxAttempts: 3,
      backoffMs: 1000,
      retryableErrors: ["RATE_LIMIT", "ETIMEDOUT"],
    },
  }
);
```

### Error Strategies

```typescript
// Strategy 1: FAIL_FAST (default)
const pipeline1 = StreamingPipeline.start<Input>()
  .map("step1", step1, { errorStrategy: StreamingErrorStrategy.FAIL_FAST });
// First error throws, stops processing

// Strategy 2: SKIP_FAILED
const pipeline2 = StreamingPipeline.start<Input>()
  .map("step1", step1, { errorStrategy: StreamingErrorStrategy.SKIP_FAILED });
// Failed items are skipped, processing continues

// Strategy 3: COLLECT_ERRORS
const pipeline3 = StreamingPipeline.start<Input>()
  .map("step1", step1, { errorStrategy: StreamingErrorStrategy.COLLECT_ERRORS });
// Errors collected, available in metadata

// Strategy 4: SPLIT_ERRORS
const pipeline4 = StreamingPipeline.start<Input>()
  .map("step1", step1, { errorStrategy: StreamingErrorStrategy.SPLIT_ERRORS });
// Errors emitted to separate error channel
```

### Error Handling in Steps

```typescript
const robustStep = createStreamingStep<Input, Output>(
  "robustStep",
  async function* ({ input }) {
    for await (const item of input) {
      try {
        const result = await processItem(item);
        yield result;
      } catch (error) {
        // Option 1: Skip and log
        console.warn(`Failed to process item:`, error);
        continue;

        // Option 2: Yield error item
        // yield { error: true, message: error.message };

        // Option 3: Throw (let retry/error strategy handle it)
        // throw error;
      }
    }
  }
);
```

## Metadata Collection

### Inline Metadata

```typescript
const stepWithMetadata = createStreamingStep<Input, Output>(
  "stepWithMetadata",
  async function* ({ input }) {
    let itemIndex = 0;

    for await (const item of input) {
      const startTime = performance.now();

      const result = await processItem(item);

      const durationMs = performance.now() - startTime;

      // Yield with metadata
      yield {
        ...result,
        _metadata: {
          durationMs,
          stepName: "stepWithMetadata",
          itemIndex: itemIndex++,
        },
      };
    }
  }
);
```

### Aggregated Metadata

```typescript
// After stream completes, aggregate metadata
const metadata = await pipeline.getMetadata();
// {
//   stepName: "pipeline_complete",
//   steps: [
//     {
//       stepName: "step1",
//       timing: { itemCount: 100, avgDurationMs: 10.5, p95DurationMs: 15.2 },
//       errorCount: 0,
//     },
//     {
//       stepName: "step2",
//       timing: { itemCount: 95, avgDurationMs: 5.2, p95DurationMs: 8.1 },
//       errorCount: 5,
//       errors: [...],
//     },
//   ],
// }
```

## Migration Strategy

### Phase 1: Core Implementation (Week 1-2)

**Deliverables:**
- `StreamingPipeline` class with basic operations
- `createStreamingStep()` helper
- Type system for streaming
- Basic error handling

**Files:**
- `src/core/pipeline/streaming-builder.ts` - StreamingPipeline class
- `src/core/pipeline/streaming-steps.ts` - createStreamingStep helper
- `src/core/pipeline/streaming-types.ts` - Type definitions

### Phase 2: Advanced Operations (Week 3)

**Deliverables:**
- Batch/unbatch operations
- Parallel streaming with concurrency control
- Filter, take, skip operations
- Checkpoint mechanism

### Phase 3: Interop Layer (Week 4)

**Deliverables:**
- Adapter functions (Pipeline ↔ StreamingPipeline)
- Mixed pipeline support
- Migration utilities

**Files:**
- `src/core/pipeline/streaming-adapters.ts`

### Phase 4: Production Workflows (Week 5-6)

**Deliverables:**
- Migrate `embed-documents` workflow to streaming
- Create streaming examples
- Performance benchmarks

### Phase 5: Documentation & Refinement (Week 7)

**Deliverables:**
- API documentation
- Migration guide
- Best practices guide
- Video tutorials

## Performance Considerations

### Memory Benefits

**Before (Pipeline):**
```typescript
// Materializes entire array at each step
const pipeline = Pipeline.start<string>()
  .add("discover", discoverFiles)     // 10,000 files in memory
  .map("read", readFile)              // 10,000 file contents in memory
  .flatMap("chunks", splitIntoChunks) // 100,000 chunks in memory
  .batch("batches", 50)               // 2,000 batches in memory
  .map("embed", generateEmbeddings);  // 100,000 embeddings in memory

// Peak memory: ~100,000 items * item size
```

**After (StreamingPipeline):**
```typescript
// Only items in flight are in memory
const pipeline = StreamingPipeline.start<string>()
  .add("discover", discoverFiles)     // Generator (lazy)
  .map("read", readFile, { parallel: true, concurrencyLimit: 10 })
  // Only 10 files in memory at once
  .flatMap("chunks", splitIntoChunks)
  // Only chunks from 10 files in memory
  .batch("batches", 50)
  .map("embed", generateEmbeddings);

// Peak memory: ~10 files * file size + 50 chunks per batch
// Reduction: 99% memory usage
```

### Throughput Characteristics

**Pipeline:**
- High throughput for small to medium datasets
- Efficient for CPU-bound operations (batch processing)
- Predictable performance

**StreamingPipeline:**
- Constant memory usage regardless of dataset size
- Better for I/O-bound operations (incremental processing)
- Enables early termination (don't process unused data)

### When to Use Each

**Use Pipeline when:**
- Dataset fits in memory comfortably
- Need full observability upfront
- Operations benefit from batching
- Deterministic execution important

**Use StreamingPipeline when:**
- Dataset is large (>10,000 items)
- Memory is constrained
- Need incremental results
- Want to enable early termination
- Processing real-time data

## Examples

### Example 1: Basic Streaming

```typescript
const doubleNumbers = createStreamingStep<number, number>(
  "doubleNumbers",
  async function* ({ input }) {
    for await (const num of input) {
      yield num * 2;
    }
  }
);

const pipeline = StreamingPipeline.start<number>()
  .map("doubled", doubleNumbers);

// Execute
for await (const result of pipeline.execute(asyncGeneratorOf(1, 2, 3))) {
  console.log(result); // 2, 4, 6
}
```

### Example 2: File Processing with Streaming

```typescript
const streamingFilePipeline = StreamingPipeline.start<{ path: string; pattern: string }>()
  .add("discover", createStreamingStep("discover", async function* ({ input }) {
    const glob = new Glob(input.pattern);
    for await (const file of glob.scan({ cwd: input.path })) {
      yield { path: `${input.path}/${file}`, name: file };
    }
  }))

  .map("readFiles", createStreamingStep("readFile", async function* ({ input }) {
    for await (const fileEntry of input) {
      try {
        const content = await readFile(fileEntry.path);
        yield { ...content, path: fileEntry.path };
      } catch (error) {
        console.warn(`Error reading ${fileEntry.path}:`, error);
      }
    }
  }), { parallel: true, concurrencyLimit: 10 })

  .flatMap("chunks", createStreamingStep("splitMarkdown", async function* ({ input }) {
    for await (const file of input) {
      const chunks = await splitMarkdown(file.content, file.path, {}, {
        minChunkSize: 300,
        maxChunkSize: 1000,
        chunkOverlap: 100,
      });

      for (const chunk of chunks) {
        yield chunk;
      }
    }
  }))

  .batch("batches", 50)

  .map("embeddings", createStreamingStep("generateEmbeddings", async function* ({ input }) {
    for await (const batch of input) {
      const contents = batch.map(chunk => chunk.content);
      const embeddings = await generateEmbeddings(contents, EMBEDDING_URL, EMBEDDING_MODEL);

      const results = batch.map((chunk, i) => ({
        id: chunk.id,
        content: chunk.content,
        metadata: chunk.metadata,
        embedding: embeddings[i]?.embedding || [],
      }));

      yield results;
    }
  }))

  .flatMap("embedded", createStreamingStep("unbatch", async function* ({ input }) {
    for await (const batch of input) {
      for (const item of batch) {
        yield item;
      }
    }
  }));

// Execute - process as stream
for await (const embedded of streamingFilePipeline.execute({
  path: "./docs",
  pattern: "**/*.md"
})) {
  // Store to database incrementally
  await storeEmbedding(embedded);
}
```

### Example 3: Early Termination

```typescript
const searchPipeline = StreamingPipeline.start<SearchQuery>()
  .add("search", vectorSearchStep)
  .take("topResults", 10)  // Only take top 10
  .map("rerank", rerankStep)
  .take("bestResults", 3);  // Only take top 3 after reranking

// Only processes 10 items from search, 3 from rerank
const results = await searchPipeline.executeToArray(query);
```

### Example 4: Pagination

```typescript
async function* getPage(pageNumber: number, pageSize: number) {
  const pipeline = StreamingPipeline.start<Input>()
    .map("process", processStep)
    .skip("skipToPage", pageNumber * pageSize)
    .take("pageItems", pageSize);

  const input = getAllItems();
  for await (const item of pipeline.execute(input)) {
    yield item;
  }
}

// Get page 2 (items 20-29) without processing all items
for await (const item of getPage(2, 10)) {
  console.log(item);
}
```

### Example 5: Real-time Processing

```typescript
// Process log stream in real-time
const logPipeline = StreamingPipeline.start<LogEntry>()
  .filter("errors", entry => entry.level === "error")
  .map("enrich", enrichWithContext)
  .batch("batches", 100)
  .map("notify", sendAlertBatch);

// Connect to log stream
const logStream = connectToLogStream();

// Process continuously
for await (const alert of logPipeline.execute(logStream)) {
  // Alerts sent as soon as batch of 100 errors collected
}
```

## Open Questions & Future Work

### Open Questions

1. **Checkpoint Granularity:** What is the optimal default checkpoint strategy?
   - Current thinking: Checkpoints after `.add()`, not after `.map()`
   - Rationale: Balance between state access and memory usage

2. **Parallel Streaming:** How to handle parallel async generators?
   - Current thinking: Use concurrency control similar to existing `executeParallel()`
   - Challenge: Maintaining order vs maximizing parallelism

3. **Backpressure:** How to handle slow consumers?
   - Current thinking: Async generators naturally provide backpressure
   - Question: Should we add explicit backpressure controls?

4. **Error Recovery:** Should streaming support resumption from checkpoints?
   - Current thinking: Not in v1, add if needed
   - Rationale: Complexity vs benefit unclear

### Future Enhancements

1. **Observability:**
   - Real-time metrics streaming
   - Progress tracking
   - Performance profiling

2. **Advanced Operations:**
   - `window()` - sliding window aggregation
   - `groupBy()` - group stream by key
   - `join()` - join two streams
   - `merge()` - merge multiple streams

3. **Optimization:**
   - Automatic batching hints
   - Adaptive concurrency
   - Query optimization (reorder steps)

4. **Integration:**
   - WebSocket streaming
   - Server-sent events
   - gRPC streaming

## Conclusion

This design provides a comprehensive streaming pipeline architecture that:

1. **Maintains Backwards Compatibility:** Existing Pipeline continues working unchanged
2. **Enables New Use Cases:** Streaming supports large datasets, real-time processing, early termination
3. **Preserves Type Safety:** Full TypeScript inference through generator chain
4. **Provides Familiar API:** Builder pattern matches existing Pipeline
5. **Offers Migration Path:** Clear strategy for gradual adoption

The parallel implementation approach minimizes risk while maximizing flexibility. Teams can adopt streaming incrementally, workflow by workflow, based on their specific needs.

**Next Steps:**
1. Review and approve this design
2. Create implementation tasks in backlog
3. Begin Phase 1 implementation (core StreamingPipeline)
4. Iterate based on feedback from early adopters
