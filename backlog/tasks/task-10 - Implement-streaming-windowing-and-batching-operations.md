---
id: task-10
title: Implement streaming windowing and batching operations
status: Done
assignee: []
created_date: '2025-12-22 16:37'
updated_date: '2025-12-22 22:39'
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
- [x] #1 batch operation yields fixed-size chunks correctly
- [x] #2 window operation supports tumbling/sliding/hopping modes
- [x] #3 bufferTime handles both time and size limits
- [x] #4 bufferUntil accumulates based on predicate
- [x] #5 Timers properly cleaned up on early termination
- [x] #6 Memory usage remains bounded
- [x] #7 Unit tests cover edge cases (empty streams, size=1, early termination)
- [x] #8 Integration tests with actual streaming pipelines
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Summary

Successfully implemented streaming windowing and batching operations in `/home/jeffutter/src/rag3.0/src/core/pipeline/streaming/windowing.ts`.

### Operations Implemented

1. **batch** - Already existed in `generators.ts` (lines 375-400)
   - Fixed-size chunking with proper cleanup
   - Handles partial final batches correctly

2. **window** - Sliding/tumbling/hopping windows
   - Tumbling windows: `slideSize === windowSize` (non-overlapping)
   - Sliding windows: `slideSize < windowSize` (overlapping) 
   - Hopping windows: `slideSize > windowSize` (gaps between windows)
   - Uses skip counter to efficiently handle hopping without consuming extra items
   - Proper cleanup on early termination

3. **bufferTime** - Time-based batching with optional size limits
   - Uses `Promise.race()` to handle both time and item arrival
   - Properly cleans up timers on completion or early termination
   - Handles fast sources (items arrive quickly) and slow sources correctly
   - Memory-bounded when `maxSize` parameter is provided

4. **bufferUntil** - Predicate-based batching
   - Accumulates items until predicate returns true
   - Predicate receives both current buffer state and incoming item
   - Includes triggering item in the emitted batch
   - Supports both sync and async predicates

### Key Implementation Details

**Timer Cleanup**: `bufferTime` properly manages timer lifecycle:
- Creates new timer promise for each window
- Cleans up timers in finally block
- Prevents memory leaks on early termination

**Memory Bounds**: All operations implement bounded buffering:
- `window`: Buffer size limited to `windowSize` 
- `bufferTime`: Optional `maxSize` parameter prevents unbounded growth
- `bufferUntil`: Emits batches based on predicate, preventing accumulation

**Early Termination**: All operations call `source.return?.()` in finally blocks to ensure proper cleanup when consumer stops early.

### Testing

**Unit Tests** (`windowing.test.ts`): 48 tests covering:
- All window modes (tumbling, sliding, hopping)
- Edge cases (empty streams, size=1, partial windows)
- Timer cleanup on early termination
- Error propagation
- Memory bounds verification

**Integration Tests** (`windowing.integration.test.ts`): 16 tests covering:
- Composition with map, filter, flatMap
- Real-world scenarios (moving averages, rate limiting, log aggregation)
- Complex pipelines combining multiple windowing operations
- Event batching and stream deduplication

**All 170 streaming tests pass** (including existing generators and compose tests).
<!-- SECTION:NOTES:END -->
