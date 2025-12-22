---
id: task-9
title: 'Implement streaming transform operations (map, filter, flatMap)'
status: To Do
assignee: []
created_date: '2025-12-22 16:37'
labels:
  - streaming
  - transforms
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Build the core transformation operations for streaming pipelines as async generators.

**Operations to Implement** (`src/core/pipeline/streaming/transforms.ts`):

1. **map**: Transform each item
   ```typescript
   async function* map<TIn, TOut>(
     source: AsyncIterable<TIn>,
     fn: (item: TIn, index: number) => TOut | Promise<TOut>
   ): AsyncGenerator<TOut>
   ```

2. **filter**: Filter items by predicate
   ```typescript
   async function* filter<T>(
     source: AsyncIterable<T>,
     predicate: (item: T, index: number) => boolean | Promise<boolean>
   ): AsyncGenerator<T>
   ```

3. **flatMap**: Map and flatten
   ```typescript
   async function* flatMap<TIn, TOut>(
     source: AsyncIterable<TIn>,
     fn: (item: TIn) => AsyncIterable<TOut> | Iterable<TOut> | Promise<Iterable<TOut>>
   ): AsyncGenerator<TOut>
   ```

4. **tap**: Side effects without changing stream
   ```typescript
   async function* tap<T>(
     source: AsyncIterable<T>,
     fn: (item: T) => void | Promise<void>
   ): AsyncGenerator<T>
   ```

**Implementation Requirements:**
- Item-at-a-time processing (yield as soon as item is transformed)
- Preserve input order
- Support both sync and async transformation functions
- Proper error propagation (let errors bubble up)
- Track index/position for each item
- Zero buffering (pure streaming)

**Error Handling:**
- Errors in transformation function should propagate to consumer
- No automatic retry at this level (handled in higher-level wrappers)
- Proper cleanup if consumer stops iterating

**Testing:**
- Test with sync and async transform functions
- Test error propagation
- Test early termination (consumer stops pulling)
- Test with empty streams
- Test index tracking
- Performance test: ensure no unnecessary buffering
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 map, filter, flatMap, tap implemented as async generators
- [ ] #2 Both sync and async transformation functions supported
- [ ] #3 Errors propagate correctly to consumer
- [ ] #4 Index/position tracked for each item
- [ ] #5 Early termination handled gracefully
- [ ] #6 Unit tests for all operations with edge cases
- [ ] #7 Performance tests verify zero-buffering behavior
<!-- AC:END -->
