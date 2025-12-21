---
id: task-6.2
title: 'Phase 2: Step Adapter Utilities for List Processing'
status: In Progress
assignee: []
created_date: '2025-12-21 14:22'
updated_date: '2025-12-21 21:12'
labels:
  - architecture
  - utilities
  - pipeline
dependencies:
  - task-6.1
parent_task_id: task-6
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create runtime utilities to convert between single-item and list-based steps.

This is Phase 2 of the pipeline architecture refactoring (parent: task-6).

## Goals

- Implement adapter functions to convert single-item steps to list steps
- Create helper functions for common list operations
- Define error handling strategies for list processing
- Test adapters with various scenarios

## Details

### 2.1 Core Adapter Functions
- Implement `singleToList<TInput, TOutput>(step: Step<TInput, TOutput>): ListStep<TInput[], TOutput[]>`
  - Map step over each array element
  - Handle errors gracefully (partial success vs complete failure options)
  - Preserve metadata from individual executions
  - Support optional parallel execution parameter

### 2.2 List Step Helpers
- Implement `createListStep<TInput[], TOutput[]>(name, execute)` helper
- Implement `createBatchStep(batchSize)` utility
- Implement `createFlattenStep()` utility
- Implement `createFilterStep(predicate)` utility

### 2.3 Error Handling Strategies
- Define `ListErrorStrategy` enum: `FAIL_FAST`, `COLLECT_ERRORS`, `SKIP_FAILED`
- Implement error aggregation for list operations
- Add partial success result type: `PartialListResult<T, E>`

### 2.4 Adapter Tests
- Test `singleToList` with simple step
- Test error handling in list operations
- Test parallel vs sequential execution
- Test metadata preservation
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 New file src/core/pipeline/list-adapters.ts with adapter functions
- [x] #2 singleToList adapter correctly wraps single-item steps
- [x] #3 ListErrorStrategy enum with FAIL_FAST, COLLECT_ERRORS, SKIP_FAILED
- [x] #4 PartialListResult type for partial success scenarios
- [x] #5 createBatchStep, createFlattenStep, createFilterStep helpers implemented
- [x] #6 Test file list-adapters.test.ts with comprehensive adapter tests
- [x] #7 Error handling works correctly for all three strategies
- [x] #8 Metadata preservation verified through tests
- [x] #9 Parallel execution option works correctly
<!-- AC:END -->
