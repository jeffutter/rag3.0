---
id: task-10
title: Implement streaming windowing and batching operations
status: To Do
assignee: []
created_date: '2025-12-22 16:37'
labels:
  - streaming
  - batching
  - windowing
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create windowing and batching operations for streaming pipelines to handle grouped processing.

**Operations to Implement** (`src/core/pipeline/streaming/windowing.ts`):

1. **batch**: Group items into fixed-size chunks
   ```typescript
   async function* batch<T>(
     source: AsyncIterable<T>,
     size: number
   ): AsyncGenerator<T[]>
   ```
   - Yields when batch reaches `size` or source exhausted
   - Last batch may be smaller than `size`

2. **window**: Sliding/tumbling windows
   ```typescript
   async function* window<T>(
     source: AsyncIterable<T>,
     windowSize: number,
     slideSize: number = windowSize
   ): AsyncGenerator<T[]>
   ```
   - Tumbling: `slideSize === windowSize` (non-overlapping)
   - Sliding: `slideSize < windowSize` (overlapping)
   - Hopping: `slideSize > windowSize` (gaps)

3. **bufferTime**: Time-based batching
   ```typescript
   async function* bufferTime<T>(
     source: AsyncIterable<T>,
     windowMs: number,
     maxSize?: number
   ): AsyncGenerator<T[]>
   ```
   - Yields after `windowMs` elapsed or `maxSize` reached
   - Handles race between time and size limits

4. **bufferUntil**: Predicate-based batching
   ```typescript
   async function* bufferUntil<T>(
     source: AsyncIterable<T>,
     predicate: (items: T[], current: T) => boolean
   ): AsyncGenerator<T[]>
   ```
   - Accumulates items until predicate returns true

**Implementation Challenges:**
- Time-based batching requires managing timers alongside iteration
- Proper cleanup of timers if consumer stops iterating
- Memory management: limit buffer growth
- Handle case where source is slower than time window

**Current Batch Adapter Reference:**
- Existing code: `/home/jeffutter/src/rag3.0/src/core/pipeline/list-adapters.ts:492-507`
- Simple slice-based batching
- New implementation should be compatible but streaming

**Testing:**
- Test various batch sizes including 1 and large values
- Test sliding windows with different slide sizes
- Test time-based batching with fast and slow sources
- Test memory usage doesn't grow unbounded
- Test timer cleanup on early termination
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 batch operation yields fixed-size chunks correctly
- [ ] #2 window operation supports tumbling/sliding/hopping modes
- [ ] #3 bufferTime handles both time and size limits
- [ ] #4 bufferUntil accumulates based on predicate
- [ ] #5 Timers properly cleaned up on early termination
- [ ] #6 Memory usage remains bounded
- [ ] #7 Unit tests cover edge cases (empty streams, size=1, early termination)
- [ ] #8 Integration tests with actual streaming pipelines
<!-- AC:END -->
