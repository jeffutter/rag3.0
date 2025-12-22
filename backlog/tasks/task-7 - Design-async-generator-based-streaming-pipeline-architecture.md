---
id: task-7
title: Design async generator-based streaming pipeline architecture
status: Done
assignee: []
created_date: '2025-12-22 16:37'
updated_date: '2025-12-22 22:13'
labels:
  - architecture
  - streaming
  - async-generators
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Design the core architecture for a streaming pipeline that uses async generators for pull-based, demand-driven execution.

**Current State Analysis:**
- Sequential for-loop execution: steps run one-at-a-time, each completing fully before next begins
- All operations already async (Promise-based)
- Batch-oriented: entire arrays processed and materialized in memory
- State accumulation: `accumulatedState` object built up as steps complete
- Rich error handling: step-level try/catch, retry logic with exponential backoff, list error strategies
- No streaming: no lazy evaluation, no backpressure, no incremental results

**Key Design Decisions:**
1. **Parallel vs Replacement**: Should we replace existing Pipeline or create StreamingPipeline alongside it?
2. **State Management**: How to handle accumulated state when execution is lazy and pull-based?
3. **Error Boundaries**: Where should errors surface in pull-based model (at yield point vs at pull point)?
4. **Metadata Collection**: How to track timing/metrics when execution is lazy?
5. **Type Safety**: Preserve strong typing through generator chain
6. **API Design**: Generator functions vs builder pattern?

**Architectural Approaches to Evaluate:**
- Pure async generator functions composed together
- Builder pattern that constructs generator chain
- Hybrid: builder creates generator pipeline
- AsyncIterable protocol throughout

**Considerations:**
- Backwards compatibility with existing Pipeline API
- Migration path for existing steps/pipelines
- Performance implications of generator overhead
- Memory benefits of streaming vs batch
- Integration with existing error handling and observability
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Documented decision on parallel implementation vs replacement approach
- [x] #2 State management strategy for accumulated state in pull-based model
- [x] #3 Error handling model that preserves retry logic and error strategies
- [x] #4 Metadata collection approach for lazy execution
- [x] #5 API design (function composition vs builder pattern)
- [x] #6 Type signature design that maintains type safety
- [x] #7 Backwards compatibility and migration strategy
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Phase 1: Core Implementation (Week 1-2)

**Goal:** Build foundational StreamingPipeline with basic operations

**Tasks:**
1. Create `src/core/pipeline/streaming-types.ts`
   - Define `StreamingStep`, `StreamingStepContext`, `StreamingState` interfaces
   - Define error types: `StreamingError`, `StreamingErrorStrategy`
   - Define metadata types: `StreamingMetadata`
   - Export type utilities: `StreamingStepInput`, `StreamingStepOutput`

2. Create `src/core/pipeline/streaming-steps.ts`
   - Implement `createStreamingStep()` helper function
   - Add retry logic wrapper for streaming steps
   - Add error handling utilities

3. Create `src/core/pipeline/streaming-builder.ts`
   - Implement `StreamingPipeline` class
   - Implement basic methods: `start()`, `add()`, `execute()`
   - Implement state management with lazy snapshots
   - Add basic logging and tracing

4. Write tests:
   - `streaming-builder.test.ts` - test pipeline construction and execution
   - `streaming-steps.test.ts` - test step creation and error handling
   - `streaming-types.test.ts` - test type inference

**Acceptance Criteria:**
- Can create a streaming pipeline with multiple steps
- Steps execute lazily via async generators
- Type inference works through the chain
- Basic error handling works (fail fast)

### Phase 2: Advanced Operations (Week 3)

**Goal:** Add list operations and parallel execution

**Tasks:**
1. Implement `map()` operation
   - Sequential mapping
   - Parallel mapping with concurrency control
   - Error strategies (FAIL_FAST, SKIP_FAILED, COLLECT_ERRORS)

2. Implement `flatMap()` operation
   - Flatten nested generators
   - Maintain type safety

3. Implement utility operations:
   - `filter()` - filter stream items
   - `batch()` - batch items into arrays
   - `take()` - take first N items
   - `skip()` - skip first N items

4. Implement `checkpoint()` mechanism
   - Force state snapshot at specific points
   - Enable efficient state access

5. Add execution modes:
   - `execute()` - returns AsyncGenerator
   - `executeToArray()` - collects to array
   - `executeReduce()` - reduce stream

6. Write tests:
   - `streaming-operations.test.ts` - test all operations
   - `streaming-parallel.test.ts` - test parallel execution
   - Performance benchmarks

**Acceptance Criteria:**
- All operations work correctly
- Parallel execution respects concurrency limits
- Checkpoints enable efficient state access
- Memory usage is O(concurrency) not O(dataset)

### Phase 3: Interop Layer (Week 4)

**Goal:** Enable interoperability with existing Pipeline

**Tasks:**
1. Create `src/core/pipeline/streaming-adapters.ts`
   - `stepToStreamingStep()` - convert Step to StreamingStep
   - `streamingStepToStep()` - convert StreamingStep to Step (materialized)
   - `pipelineToStreaming()` - convert Pipeline to StreamingPipeline
   - `streamingToPipeline()` - convert StreamingPipeline to Pipeline

2. Update existing steps to work with both pipelines:
   - Add streaming versions where beneficial
   - Keep batch versions for backwards compatibility

3. Write tests:
   - `streaming-interop.test.ts` - test conversions
   - `streaming-integration.test.ts` - test mixed pipelines

**Acceptance Criteria:**
- Can convert between Pipeline and StreamingPipeline
- Existing steps work in both contexts
- Mixed pipelines execute correctly

### Phase 4: Production Workflows (Week 5-6)

**Goal:** Migrate real workflows and prove production-readiness

**Tasks:**
1. Create streaming version of embed-documents workflow:
   - `src/workflows/embed-documents-streaming.ts`
   - Implement with StreamingPipeline
   - Add performance comparison

2. Create streaming examples:
   - `src/core/pipeline/examples/04-streaming-basic.ts`
   - `src/core/pipeline/examples/05-streaming-parallel.ts`
   - `src/core/pipeline/examples/06-streaming-large-dataset.ts`

3. Performance benchmarks:
   - Memory usage comparison (Pipeline vs StreamingPipeline)
   - Throughput comparison
   - Latency comparison (time to first result)

4. Write tests:
   - `embed-documents-streaming.test.ts`
   - Integration tests with real data

**Acceptance Criteria:**
- Streaming workflow produces same results as batch workflow
- Memory usage reduced by >90% for large datasets
- Time to first result improved significantly
- Throughput comparable or better

### Phase 5: Documentation & Refinement (Week 7)

**Goal:** Complete documentation and address feedback

**Tasks:**
1. API documentation:
   - JSDoc comments for all public APIs
   - Type documentation
   - Usage examples

2. Migration guide:
   - `docs/migration/pipeline-to-streaming.md`
   - Decision framework (when to use streaming)
   - Common patterns and anti-patterns

3. Best practices guide:
   - Memory management
   - Error handling strategies
   - Performance optimization
   - Debugging streaming pipelines

4. Update architecture documentation:
   - Update `steps-and-workflows.md` with streaming patterns
   - Add streaming to decision framework

5. Refinement:
   - Address feedback from code review
   - Performance optimization
   - Bug fixes

**Acceptance Criteria:**
- All public APIs documented
- Migration guide complete
- Best practices documented
- Code reviewed and approved

## Key Technical Decisions

1. **Parallel Implementation:** New StreamingPipeline alongside Pipeline
   - Minimizes risk, enables gradual migration
   - Both APIs maintained long-term

2. **Hybrid State Management:** Streaming + snapshots
   - Current item flows through generators
   - Snapshots captured at checkpoints
   - State materialized lazily on demand

3. **Dual Error Handling:** Yield-time + pull-time
   - Errors caught when yielded and when pulled
   - Retry logic preserved from Pipeline
   - Multiple error strategies supported

4. **Progressive Metadata:** Collected incrementally
   - Inline metadata attached to items
   - Aggregated statistics computed on-demand
   - Sampling for very large streams

5. **Builder Pattern API:** Familiar and type-safe
   - Matches existing Pipeline API
   - Full TypeScript inference
   - Method chaining

6. **Generator-Preserving Types:** Maintain type safety
   - Input/output flow as AsyncGenerator<T>
   - Accumulated state tracks snapshots
   - Type inference throughout chain

7. **Gradual Migration:** Interop layer + adapters
   - Convert between Pipeline and StreamingPipeline
   - Shared steps where possible
   - Clear migration path

## Success Metrics

1. **Memory Efficiency:** 90%+ reduction for large datasets (>10k items)
2. **Type Safety:** 100% type inference (no manual type annotations needed)
3. **API Compatibility:** Migration requires <10% code changes
4. **Performance:** Time to first result <1s (vs minutes for batch)
5. **Adoption:** At least 3 workflows migrated in first month
<!-- SECTION:PLAN:END -->
