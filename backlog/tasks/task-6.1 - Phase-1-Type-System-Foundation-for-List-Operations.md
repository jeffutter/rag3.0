---
id: task-6.1
title: 'Phase 1: Type System Foundation for List Operations'
status: To Do
assignee: []
created_date: '2025-12-21 14:20'
labels:
  - architecture
  - type-safety
  - pipeline
dependencies: []
parent_task_id: task-6
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend the type system to support list operations while maintaining existing type safety guarantees.

This is Phase 1 of the pipeline architecture refactoring (parent: task-6).

## Goals

- Create type definitions for list operations
- Add utility types for array element extraction and detection
- Extend pipeline state tracking for lists
- Validate type safety with compile-time tests

## Details

### 1.1 Define List Operation Types
- Create `ListStep<TInput[], TOutput[], TAccumulatedState, TContext>` type
- Add `ArrayElement<T>` utility type to extract element type from arrays
- Add `IsArray<T>` type predicate for compile-time array detection
- Add `MapStepOutput<TStep, TInput>` to compute output type when mapping step over array

### 1.2 Step Transformation Types
- Define `SingleToListTransform<TStep>` type for wrapping single-item steps
- Define `FlatMapTransform<TStep>` type for steps that return arrays
- Define `BatchTransform<T>` type for batching operations
- Define `FlattenTransform<T>` type for flattening nested arrays

### 1.3 Pipeline State Tracking for Lists
- Extend `AddToState` to handle array types correctly
- Add type validation for list operations in accumulated state
- Ensure list operations preserve type inference for downstream steps

### 1.4 Type Safety Tests
- Create test file `src/core/pipeline/list-types.test.ts`
- Add compile-time test cases using `@ts-expect-error` for invalid compositions
- Verify type inference works correctly for complex pipeline chains
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 New file src/core/pipeline/list-types.ts with all type definitions
- [ ] #2 ArrayElement<T> correctly extracts element type from arrays
- [ ] #3 IsArray<T> correctly identifies array types at compile-time
- [ ] #4 ListStep type properly extends Step with array semantics
- [ ] #5 All transformation types (SingleToList, FlatMap, Batch, Flatten) defined
- [ ] #6 AddToState correctly handles array types in accumulated state
- [ ] #7 Test file list-types.test.ts with compile-time validation tests
- [ ] #8 Type inference works correctly through multi-step pipeline chains
<!-- AC:END -->
