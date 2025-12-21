---
id: task-6
title: Refactor pipeline architecture for composable list-based steps
status: To Do
assignee: []
created_date: '2025-12-21 14:11'
updated_date: '2025-12-21 14:12'
labels:
  - architecture
  - refactoring
  - type-safety
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem Statement

The current pipeline/workflow architecture has a fundamental limitation: steps operate on single items, forcing workflows to manually loop and create single-use pipelines. This leads to:

1. **Non-composable workflows**: The `embed-documents` workflow creates separate pipelines for each file and batch, rather than defining a single declarative pipeline
2. **Type safety gaps**: Manual loops bypass compile-time type checking
3. **Code duplication**: Workflow code is imperative and repetitive rather than declarative
4. **Poor performance**: Creating new pipeline instances for each item adds overhead

### Current Architecture

```typescript
// Steps operate on single items
discoverFilesStep: Config → { files: File[] }
readFileStep: { path: string } → { content: string }

// Workflows must manually loop
for (const file of files) {
  const pipeline = Pipeline.start().add('read', readFileStep);
  const result = await pipeline.execute(file);
}
```

### Desired Architecture

```typescript
// Steps operate on lists naturally
const workflow = Pipeline.start<Config>()
  .add('discover', discoverFilesStep)    // Config → { files: File[] }
  .map('read', readFileStep)             // File[] → Content[]
  .map('clean', cleanMarkdownStep)       // Content[] → Cleaned[]
  .flatMap('split', splitMarkdownStep)   // Cleaned[] → Chunk[]
  .batch('batch', 50)                    // Chunk[] → Chunk[][]
  .map('embed', embedStep)               // Chunk[][] → Embedded[][]
  .flatten('flatten')                    // Embedded[][] → Embedded[]
```

## Requirements

1. **Backward compatibility**: Existing single-item steps must continue to work
2. **Type safety**: Compile-time guarantees for entire pipeline composition
3. **Performance**: Efficient parallel processing where appropriate
4. **Composability**: Steps should be reusable building blocks
5. **Maintainability**: Workflows should be declarative and readable

## Architectural Approach

### 1. Type System Extensions

Add support for list-aware operations while maintaining existing type safety:

- `ListStep<TInput, TOutput>`: Steps that operate on arrays
- Type utilities for mapping between single-item and list steps
- Accumulated state tracking for list operations
- Compile-time validation of pipeline composition

### 2. Pipeline Builder Methods

Extend the `Pipeline` class with list operators:

- `map<K, O>(key, step)`: Apply single-item step to each element
- `flatMap<K, O>(key, step)`: Apply step returning arrays, then flatten
- `batch<K>(key, size)`: Split array into batches
- `flatten<K>(key)`: Flatten nested arrays
- `filter<K>(key, predicate)`: Filter array elements
- `parallel<K>(key, steps[])`: Run multiple steps in parallel

### 3. Step Adapters

Utilities to convert between step types:

- `singleToList(step)`: Wrap single-item step for list processing
- `listToSingle(step)`: Extract single item processing from list step
- `createListStep()`: Helper for creating list-aware steps

### 4. Execution Model

The pipeline executor should:

- Detect list operations and process efficiently
- Support parallel processing where appropriate
- Maintain error handling and retry logic
- Preserve accumulated state semantics

## Success Criteria

1. `embed-documents` workflow refactored to declarative pipeline (no manual loops)
2. All existing tests pass
3. New tests validate list operations and type safety
4. Type errors caught at compile-time for invalid compositions
5. Performance equal to or better than current implementation
6. Documentation and examples updated
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 New type definitions for ListStep and list operations with full type safety
- [ ] #2 Pipeline builder extended with map, flatMap, batch, flatten, filter methods
- [ ] #3 All new methods maintain compile-time type checking guarantees
- [ ] #4 embed-documents workflow refactored to use declarative pipeline (zero manual loops)
- [ ] #5 All existing unit tests pass without modification
- [ ] #6 New test suite for list operations covering map, flatMap, batch, flatten
- [ ] #7 Type safety tests that verify compile errors for invalid compositions
- [ ] #8 Performance benchmarks show no regression (ideally improvement)
- [ ] #9 Documentation updated with new patterns and migration guide
- [ ] #10 At least 3 example workflows demonstrating the new architecture
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Phase 1: Type System Foundation (2-3 hours)

**Goal**: Extend the type system to support list operations while maintaining existing type safety guarantees.

#### 1.1 Define List Operation Types
- [ ] Create `ListStep<TInput[], TOutput[], TAccumulatedState, TContext>` type
- [ ] Add `ArrayElement<T>` utility type to extract element type from arrays
- [ ] Add `IsArray<T>` type predicate for compile-time array detection
- [ ] Add `MapStepOutput<TStep, TInput>` to compute output type when mapping step over array

#### 1.2 Step Transformation Types
- [ ] Define `SingleToListTransform<TStep>` type for wrapping single-item steps
- [ ] Define `FlatMapTransform<TStep>` type for steps that return arrays
- [ ] Define `BatchTransform<T>` type for batching operations
- [ ] Define `FlattenTransform<T>` type for flattening nested arrays

#### 1.3 Pipeline State Tracking for Lists
- [ ] Extend `AddToState` to handle array types correctly
- [ ] Add type validation for list operations in accumulated state
- [ ] Ensure list operations preserve type inference for downstream steps

#### 1.4 Type Safety Tests
- [ ] Create test file `src/core/pipeline/list-types.test.ts`
- [ ] Add compile-time test cases using `@ts-expect-error` for invalid compositions
- [ ] Verify type inference works correctly for complex pipeline chains

---

### Phase 2: Step Adapter Utilities (2-3 hours)

**Goal**: Create runtime utilities to convert between single-item and list-based steps.

#### 2.1 Core Adapter Functions
- [ ] Implement `singleToList<TInput, TOutput>(step: Step<TInput, TOutput>): ListStep<TInput[], TOutput[]>`
  - Map step over each array element
  - Handle errors gracefully (partial success vs complete failure options)
  - Preserve metadata from individual executions
  - Support optional parallel execution parameter

#### 2.2 List Step Helpers
- [ ] Implement `createListStep<TInput[], TOutput[]>(name, execute)` helper
- [ ] Implement `createBatchStep(batchSize)` utility
- [ ] Implement `createFlattenStep()` utility
- [ ] Implement `createFilterStep(predicate)` utility

#### 2.3 Error Handling Strategies
- [ ] Define `ListErrorStrategy` enum: `FAIL_FAST`, `COLLECT_ERRORS`, `SKIP_FAILED`
- [ ] Implement error aggregation for list operations
- [ ] Add partial success result type: `PartialListResult<T, E>`

#### 2.4 Adapter Tests
- [ ] Test `singleToList` with simple step
- [ ] Test error handling in list operations
- [ ] Test parallel vs sequential execution
- [ ] Test metadata preservation

---

### Phase 3: Pipeline Builder Extensions (3-4 hours)

**Goal**: Extend the `Pipeline` class with declarative list operation methods.

#### 3.1 Map Operation
- [ ] Add `map<TKey, TOutput>(key, step, options?)` method to Pipeline class
  - Accept `Step<TElement, TOutput>` where current output is `TElement[]`
  - Return `Pipeline<..., TOutput[], AddToState<..., TKey, TOutput[]>>`
  - Support `{ parallel: boolean, errorStrategy: ListErrorStrategy }` options
  - Validate at compile-time that current output is an array type

#### 3.2 FlatMap Operation
- [ ] Add `flatMap<TKey, TOutput>(key, step, options?)` method
  - Accept `Step<TElement, TOutput[]>` where current output is `TElement[]`
  - Flatten result arrays into single array
  - Return `Pipeline<..., TOutput[], AddToState<..., TKey, TOutput[]>>`

#### 3.3 Batch Operation
- [ ] Add `batch<TKey>(key, size)` method
  - Accept number for batch size
  - Transform `T[]` into `T[][]`
  - Return `Pipeline<..., TElement[][], AddToState<..., TKey, TElement[][]>>`

#### 3.4 Flatten Operation
- [ ] Add `flatten<TKey>(key)` method
  - Transform `T[][]` into `T[]`
  - Return `Pipeline<..., TElement[], AddToState<..., TKey, TElement[]>>`
  - Validate at compile-time that input is nested array

#### 3.5 Filter Operation
- [ ] Add `filter<TKey>(key, predicate)` method
  - Accept `(item: TElement, index: number) => boolean | Promise<boolean>`
  - Filter array based on predicate
  - Return same array type with filtered elements

#### 3.6 Reduce Operation (Bonus)
- [ ] Add `reduce<TKey, TOutput>(key, reducer, initial)` method
  - Transform array into single value
  - Support async reducers

#### 3.7 Builder Tests
- [ ] Test type inference through method chains
- [ ] Test compile errors for invalid operations (e.g., map on non-array)
- [ ] Test accumulated state includes correct types
- [ ] Test that downstream steps see correct types

---

### Phase 4: Pipeline Executor Updates (2-3 hours)

**Goal**: Update the pipeline execution engine to efficiently handle list operations.

#### 4.1 Execution Strategy Detection
- [ ] Detect when a step is a list operation (map, flatMap, etc.)
- [ ] Choose appropriate execution strategy (parallel vs sequential)
- [ ] Optimize for batch operations (avoid unnecessary array copying)

#### 4.2 Parallel Execution Engine
- [ ] Implement `executeParallel<T>(items: T[], step, context)` helper
  - Use `Promise.all()` for concurrent execution
  - Add configurable concurrency limit (e.g., max 10 parallel)
  - Collect results and errors appropriately

#### 4.3 Error Handling
- [ ] Implement `FAIL_FAST`: Stop on first error
- [ ] Implement `COLLECT_ERRORS`: Continue and collect all errors
- [ ] Implement `SKIP_FAILED`: Continue and skip failed items
- [ ] Update `StepResult` to support partial results

#### 4.4 Metadata Aggregation
- [ ] Aggregate timing metadata from list operations
- [ ] Include per-item metadata in result
- [ ] Track success/failure rates for list operations

#### 4.5 Executor Tests
- [ ] Test parallel execution with concurrency limits
- [ ] Test each error handling strategy
- [ ] Test metadata aggregation
- [ ] Test performance with large arrays

---

### Phase 5: Workflow Refactoring (2-3 hours)

**Goal**: Refactor `embed-documents` workflow to use declarative pipeline composition.

#### 5.1 Refactor embed-documents.ts
- [ ] Remove all manual loops (for files, for batches)
- [ ] Replace with declarative pipeline:
  ```typescript
  Pipeline.start<Config>()
    .add('discover', discoverFilesStep)
    .map('read', readFileStep, { parallel: true })
    .map('clean', cleanMarkdownStep)
    .flatMap('split', splitMarkdownStep)
    .flatten('flattenChunks')
    .add('addEOT', addEOTStep)
    .batch('batch', config.batchSize)
    .map('embed', generateEmbeddingsStep)
    .flatten('flattenResults')
    .add('format', formatOutputStep)
  ```
- [ ] Update step signatures as needed to work with new architecture
- [ ] Ensure error handling matches or exceeds current behavior

#### 5.2 Update Individual Steps
- [ ] Verify `discoverFilesStep` works as-is (returns array)
- [ ] Update `readFileStep` if needed to accept `{ path: string }`
- [ ] Update `cleanMarkdownStep` to match expected input/output
- [ ] Update `splitMarkdownStep` to match expected input/output
- [ ] Create `addEOTStep` for adding end-of-text tokens
- [ ] Update `generateEmbeddingsStep` to work with batched input
- [ ] Create `formatOutputStep` to build final result

#### 5.3 Workflow Tests
- [ ] Ensure all existing `embed-documents.test.ts` tests pass
- [ ] Add new tests for error scenarios with list operations
- [ ] Add integration test comparing old vs new implementation results
- [ ] Performance test: ensure new implementation is competitive

---

### Phase 6: Additional Workflows and Examples (1-2 hours)

**Goal**: Demonstrate the new architecture with multiple examples and update existing workflows.

#### 6.1 Create Example Workflows
- [ ] Example 1: Simple map/filter pipeline (data transformation)
- [ ] Example 2: Web scraping workflow (parallel fetching + processing)
- [ ] Example 3: Batch processing workflow (demonstrates batch/flatten)
- [ ] Add examples to `src/core/pipeline/examples/` directory

#### 6.2 Update rag-query Workflow (if applicable)
- [ ] Review `rag-query.ts` for opportunities to use new patterns
- [ ] Refactor if beneficial, otherwise leave as-is

#### 6.3 Update Pipeline Documentation
- [ ] Update main README with new pipeline patterns
- [ ] Add API documentation for new methods (map, flatMap, batch, etc.)
- [ ] Create migration guide for existing workflows
- [ ] Add architecture decision record (ADR) explaining the design

---

### Phase 7: Testing and Validation (2-3 hours)

**Goal**: Comprehensive testing and performance validation.

#### 7.1 Unit Test Coverage
- [ ] Achieve >90% code coverage for new pipeline methods
- [ ] Test edge cases: empty arrays, single elements, large arrays
- [ ] Test error propagation through pipeline chains
- [ ] Test accumulated state with complex pipelines

#### 7.2 Integration Tests
- [ ] End-to-end test of refactored embed-documents workflow
- [ ] Test with real markdown files
- [ ] Verify embeddings match previous implementation
- [ ] Test with various configuration options

#### 7.3 Type Safety Validation
- [ ] Create test file with intentionally invalid compositions
- [ ] Verify TypeScript compiler catches all errors
- [ ] Test IDE autocomplete suggestions work correctly
- [ ] Document known type system limitations (if any)

#### 7.4 Performance Benchmarking
- [ ] Benchmark old vs new embed-documents implementation
- [ ] Test with varying input sizes (10, 100, 1000 files)
- [ ] Profile memory usage
- [ ] Document performance characteristics

---

### Phase 8: Documentation and Cleanup (1-2 hours)

**Goal**: Polish documentation and prepare for production use.

#### 8.1 Code Documentation
- [ ] Add JSDoc comments to all new types and functions
- [ ] Include usage examples in JSDoc
- [ ] Document performance characteristics of each operation
- [ ] Document error handling behavior

#### 8.2 User Documentation
- [ ] Update main README with quick start examples
- [ ] Create "Pipeline Patterns" guide
- [ ] Create "Migration Guide" for existing code
- [ ] Add troubleshooting section

#### 8.3 Final Cleanup
- [ ] Remove any dead code or unused utilities
- [ ] Ensure consistent naming conventions
- [ ] Run linter and formatter
- [ ] Final review of all changes

---

## Estimated Total Time: 15-23 hours

## Key Risks and Mitigations

1. **Risk**: Breaking changes to existing code
   - **Mitigation**: Maintain backward compatibility; add new methods alongside existing ones

2. **Risk**: TypeScript type inference limitations
   - **Mitigation**: Use explicit type annotations where needed; document limitations

3. **Risk**: Performance degradation
   - **Mitigation**: Benchmark early and often; optimize critical paths

4. **Risk**: Complexity explosion in type system
   - **Mitigation**: Keep types focused; use helper utilities; extensive documentation

## Success Metrics

- Zero breaking changes to existing workflows
- embed-documents workflow has zero manual loops
- All acceptance criteria met
- Performance within 10% of current implementation
- Positive developer experience feedback
<!-- SECTION:PLAN:END -->
