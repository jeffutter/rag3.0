---
id: task-6
title: Refactor pipeline architecture for composable list-based steps
status: To Do
assignee: []
created_date: '2025-12-21 14:11'
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
