---
id: task-8
title: Implement core async generator streaming primitives
status: To Do
assignee: []
created_date: '2025-12-22 16:37'
labels:
  - streaming
  - async-generators
  - core
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create the foundational building blocks for streaming pipelines using async generators.

**Core Components:**

1. **Streaming Types** (`src/core/pipeline/streaming/types.ts`):
   - `StreamingStep<TIn, TOut>`: async generator function type
   - `StreamingPipeline<TIn, TOut>`: composable pipeline type
   - `StreamingContext`: runtime context for streaming operations
   - `StreamResult<T>`: result type (success/error per item or batched)

2. **Base Generator Utilities** (`src/core/pipeline/streaming/generators.ts`):
   - `fromArray<T>(items: T[]): AsyncGenerator<T>`: Convert array to stream
   - `fromAsyncIterable<T>(iter: AsyncIterable<T>): AsyncGenerator<T>`: Normalize input
   - `toArray<T>(stream: AsyncGenerator<T>): Promise<T[]>`: Consume entire stream
   - `take<T>(stream: AsyncGenerator<T>, n: number): AsyncGenerator<T>`: Limit items
   - `skip<T>(stream: AsyncGenerator<T>, n: number): AsyncGenerator<T>`: Skip items

3. **Composition Helpers** (`src/core/pipeline/streaming/compose.ts`):
   - `pipe<T>(...generators): AsyncGenerator<T>`: Compose generator functions
   - `compose<T>(...generators): AsyncGenerator<T>`: Compose in reverse order
   - Type-safe composition with up to 10 steps (overload signatures)

**Implementation Notes:**
- Use `async function*` for all generators
- Implement proper cleanup (try/finally for resource cleanup)
- Support both item-at-a-time and async iterable inputs
- Add comprehensive JSDoc documentation
- Write unit tests for each primitive

**Dependencies:**
- Requires architecture design decision (task-X) to determine API shape
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 StreamingStep and StreamingPipeline types defined with full TypeScript generics
- [ ] #2 Base generator utilities implemented (fromArray, toArray, take, skip)
- [ ] #3 Composition helpers with type-safe overloads
- [ ] #4 Unit tests achieving >90% coverage
- [ ] #5 JSDoc documentation for all public APIs
- [ ] #6 Resource cleanup properly implemented in generators
<!-- AC:END -->
