---
id: task-11
title: Implement parallel processing for streaming pipelines
status: To Do
assignee: []
created_date: '2025-12-22 16:37'
labels:
  - streaming
  - parallel
  - concurrency
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add concurrency-controlled parallel processing to streaming pipelines while maintaining pull-based semantics.

**Challenge:**
Current `executeParallel` (list-adapters.ts:120-166) processes entire array with concurrency limit. For streaming, we need to:
- Process items in parallel as they arrive
- Yield results as they complete (potentially out of order)
- Maintain backpressure (don't pull more items than we can handle)
- Respect concurrency limit

**Operations to Implement** (`src/core/pipeline/streaming/parallel.ts`):

1. **parallelMap**: Transform items concurrently
   ```typescript
   async function* parallelMap<TIn, TOut>(
     source: AsyncIterable<TIn>,
     fn: (item: TIn) => Promise<TOut>,
     options: {
       concurrency: number,
       ordered?: boolean  // false = yield as completed, true = preserve order
     }
   ): AsyncGenerator<TOut>
   ```

2. **parallelFilter**: Filter with async predicate concurrently
   ```typescript
   async function* parallelFilter<T>(
     source: AsyncIterable<T>,
     predicate: (item: T) => Promise<boolean>,
     concurrency: number
   ): AsyncGenerator<T>
   ```

3. **merge**: Merge multiple streams, yielding items as they arrive
   ```typescript
   async function* merge<T>(
     ...sources: AsyncIterable<T>[]
   ): AsyncGenerator<T>
   ```

**Implementation Approach:**
- Use a "windowed pool" pattern:
  1. Pull up to `concurrency` items from source
  2. Start processing all in parallel
  3. As each completes, pull next item and start processing
  4. Yield results (ordered or unordered based on options)
- Track active promises in a Set
- Use `Promise.race` to yield as items complete (unordered)
- Use queue + promise tracking to preserve order (ordered)

**Backpressure:**
- Never pull more than `concurrency` items ahead
- If consumer stops pulling results, stop pulling from source
- Cleanup: cancel in-flight operations if consumer disconnects

**Error Handling:**
- Single item error propagates immediately (fail-fast)
- Optional: collect errors and continue (error strategy)
- Cleanup remaining in-flight work on error

**Testing:**
- Test concurrency limit is respected
- Test ordered vs unordered mode
- Test backpressure (slow consumer shouldn't cause unbounded queue)
- Test error propagation stops pulling new items
- Test early termination cancels in-flight work
- Performance: compare to current executeParallel
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 parallelMap supports both ordered and unordered modes
- [ ] #2 Concurrency limit strictly enforced
- [ ] #3 Backpressure prevents unbounded memory growth
- [ ] #4 Errors propagate and stop new work
- [ ] #5 parallelFilter yields passing items with concurrency control
- [ ] #6 merge combines multiple streams correctly
- [ ] #7 In-flight work cancelled on early termination
- [ ] #8 Unit tests verify concurrency limits and backpressure
- [ ] #9 Performance comparable to or better than current executeParallel
<!-- AC:END -->
