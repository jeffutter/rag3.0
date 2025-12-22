---
id: task-16
title: Convert existing pipeline steps to streaming-compatible versions
status: To Do
assignee: []
created_date: '2025-12-22 16:38'
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
- [ ] #1 Step categories identified (pure transforms, aggregations, stateful, I/O bound)
- [ ] #2 toStreamingStep wrapper converts batch steps to streaming
- [ ] #3 Existing common steps have streaming equivalents
- [ ] #4 Hybrid step interface for steps supporting both modes
- [ ] #5 Migration path documented for custom steps
- [ ] #6 Example pipelines converted to streaming versions
- [ ] #7 Side-by-side comparison showing benefits
- [ ] #8 Performance benchmarks comparing batch vs streaming
- [ ] #9 Unit tests verify behavioral equivalence
<!-- AC:END -->
