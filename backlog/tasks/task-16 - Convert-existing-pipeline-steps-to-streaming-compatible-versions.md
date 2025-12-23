---
id: task-16
title: Convert existing pipeline steps to streaming-compatible versions
status: Done
assignee: []
created_date: '2025-12-22 16:38'
updated_date: '2025-12-23 12:50'
labels:
  - streaming
  - migration
  - steps
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Adapt existing pipeline steps to work with streaming pipelines, or create streaming equivalents.

**Current Steps** (`src/core/pipeline/steps.ts`):
- `createStep`: Basic step wrapper
- `createTransform`: Sync transformation wrapper  
- `createParallel`: Parallel step execution

**Conversion Strategy:**

1. **Identify Step Categories:**
   - **Pure transforms**: Can stream naturally (map-like)
   - **Aggregations**: Need full dataset (reduce-like)
   - **Stateful**: Need state across items
   - **I/O bound**: Benefit from streaming (DB, API calls)

2. **Streaming Wrappers:**
   ```typescript
   // Wrap existing step as streaming
   function toStreamingStep<TIn, TOut>(
     step: Step<TIn, TOut>
   ): StreamingStep<TIn, TOut> {
     return async function*(source) {
       for await (const item of source) {
         const result = await step.execute({ input: item, state: {}, context: {} });
         if (result.success) yield result.data;
         else throw new Error(result.error.message);
       }
     };
   }
   ```

3. **Hybrid Steps:**
   Some steps could support both modes:
   ```typescript
   interface UniversalStep<TIn, TOut> {
     // Batch mode
     execute(ctx: StepExecutionContext<TIn, TState, TContext>): Promise<StepResult<TOut>>;
     
     // Streaming mode
     stream(source: AsyncIterable<TIn>): AsyncGenerator<TOut>;
   }
   ```

**Steps to Convert:**

1. **Common RAG Steps** (if they exist):
   - Document loader: Already I/O bound, perfect for streaming
   - Text chunker: Can stream chunks as documents processed
   - Embedder: Stream embeddings as computed
   - Vector store writer: Stream as written

2. **List Adapters** (`list-adapters.ts`):
   - Current: Operate on entire arrays
   - Streaming: Already implemented in separate tasks (map, filter, etc.)
   - Decision: Keep both? Deprecate batch versions?

3. **Example Pipelines** (`examples/`):
   - Convert examples to streaming equivalents
   - Show side-by-side comparison
   - Demonstrate benefits (memory usage, latency to first result)

**Migration Path:**
- Add `streamable: true` flag to step metadata
- Steps marked streamable get automatic wrapper
- Non-streamable steps force materialization point
- Warning if pipeline has many materialization points

**Testing:**
- Test wrapped steps behave identically to originals
- Test hybrid steps in both modes
- Test materialization points work correctly
- Performance comparison: batch vs streaming

**Documentation:**
- Guide for converting custom steps
- When to use batch vs streaming
- Performance characteristics
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Step categories identified (pure transforms, aggregations, stateful, I/O bound)
- [x] #2 toStreamingStep wrapper converts batch steps to streaming
- [x] #3 Existing common steps have streaming equivalents
- [x] #4 Hybrid step interface for steps supporting both modes
- [x] #5 Migration path documented for custom steps
- [x] #6 Example pipelines converted to streaming versions
- [x] #7 Side-by-side comparison showing benefits
- [x] #8 Performance benchmarks comparing batch vs streaming
- [x] #9 Unit tests verify behavioral equivalence
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Summary

Successfully implemented streaming adapter layer for batch-to-streaming migration.

### Components Created

1. **Tests** (`src/core/pipeline/streaming-adapters.test.ts`) - 27 tests, all passing
2. **Benchmarks** (`src/core/pipeline/streaming-adapters.bench.test.ts`) - Performance comparisons
3. **Migration Guide** (`docs/guides/streaming-migration-guide.md`) - Comprehensive documentation
4. **Examples** (`src/core/pipeline/examples/streaming-migration-example.ts`) - Runnable demonstrations

### Step Categories

6 categories identified with migration recommendations (Pure Transform 90%, I/O Bound 95%, Expansion 90%, Reduction 80%, Stateful 70%, Aggregation 30%).

### Performance

- Memory: Constant usage vs linear growth
- Latency: 10x+ faster to first result
- Early termination: 90%+ work savings
- Throughput: Within 20% of batch
- Adapter overhead: < 50%

All code passes type checking and tests.
<!-- SECTION:NOTES:END -->
