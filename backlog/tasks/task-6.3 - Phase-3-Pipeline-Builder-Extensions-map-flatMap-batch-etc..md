---
id: task-6.3
title: 'Phase 3: Pipeline Builder Extensions (map, flatMap, batch, etc.)'
status: To Do
assignee: []
created_date: '2025-12-21 14:22'
updated_date: '2025-12-21 14:22'
labels:
  - architecture
  - pipeline
  - api
dependencies:
  - task-6.2
parent_task_id: task-6
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend the Pipeline class with declarative list operation methods.

This is Phase 3 of the pipeline architecture refactoring (parent: task-6).

## Goals

- Add `map`, `flatMap`, `batch`, `flatten`, `filter` methods to Pipeline class
- Maintain full type safety through method chaining
- Support configuration options for parallel execution and error handling
- Validate compile-time type checking works correctly

## Details

### 3.1 Map Operation
- Add `map<TKey, TOutput>(key, step, options?)` method to Pipeline class
- Accept `Step<TElement, TOutput>` where current output is `TElement[]`
- Return `Pipeline<..., TOutput[], AddToState<..., TKey, TOutput[]>>`
- Support `{ parallel: boolean, errorStrategy: ListErrorStrategy }` options

### 3.2 FlatMap Operation
- Add `flatMap<TKey, TOutput>(key, step, options?)` method
- Accept `Step<TElement, TOutput[]>` where current output is `TElement[]`
- Flatten result arrays into single array

### 3.3 Batch Operation
- Add `batch<TKey>(key, size)` method
- Transform `T[]` into `T[][]`

### 3.4 Flatten Operation
- Add `flatten<TKey>(key)` method
- Transform `T[][]` into `T[]`
- Validate at compile-time that input is nested array

### 3.5 Filter Operation
- Add `filter<TKey>(key, predicate)` method
- Accept `(item: TElement, index: number) => boolean | Promise<boolean>`

### 3.6 Reduce Operation (Bonus)
- Add `reduce<TKey, TOutput>(key, reducer, initial)` method
- Support async reducers

### 3.7 Builder Tests
- Test type inference through method chains
- Test compile errors for invalid operations
- Test accumulated state includes correct types
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Pipeline.map() method implemented with full type safety
- [ ] #2 Pipeline.flatMap() method implemented
- [ ] #3 Pipeline.batch() method implemented
- [ ] #4 Pipeline.flatten() method implemented
- [ ] #5 Pipeline.filter() method implemented
- [ ] #6 All methods support options parameter where applicable
- [ ] #7 Type inference works correctly through complex chains
- [ ] #8 Compile-time errors for invalid operations (e.g., map on non-array)
- [ ] #9 Test file pipeline-builder-lists.test.ts validates all methods
- [ ] #10 Accumulated state correctly typed for downstream steps
<!-- AC:END -->
