---
id: task-14
title: Implement metadata collection and observability for streaming pipelines
status: To Do
assignee: []
created_date: '2025-12-22 16:38'
labels:
  - streaming
  - observability
  - metrics
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Build observability infrastructure for streaming pipelines that handles lazy execution and incremental processing.

**Current Metadata** (`types.ts:24-53`):
- Step timing (start, end, duration)
- Trace ID and span ID
- List operation metrics (total items, success/failure counts, latency percentiles)

**Streaming Challenges:**
- No single "start" and "end" time for a step (processes items over time)
- Latency percentiles need to be computed incrementally
- Total item count unknown until stream exhausted
- Per-item metrics may need aggregation

**Metadata to Collect:**

1. **Per-Item Metrics:**
   - Item index/sequence number
   - Item processing start/end time
   - Item processing duration
   - Success/failure status
   - Retry attempts (if any)

2. **Aggregate Stream Metrics:**
   - Total items processed (running count)
   - Success/failure counts
   - Items per second (throughput)
   - Latency statistics (min/max/avg/p50/p95/p99)
   - First item time (time to first yield)
   - Time to completion

3. **Pipeline-Level Metrics:**
   - End-to-end latency per item
   - Pipeline throughput
   - Backpressure indicators
   - Memory usage estimates

**Implementation Approach:**

1. **Metadata Wrapper Generator** (`streaming/metadata.ts`):
   ```typescript
   async function* withMetadata<T>(
     source: AsyncIterable<T>,
     stepName: string,
     collector: MetadataCollector
   ): AsyncGenerator<T>
   ```
   - Wraps any generator
   - Tracks per-item timing
   - Updates aggregate statistics
   - Yields items unchanged

2. **MetadataCollector Class:**
   ```typescript
   class MetadataCollector {
     recordItemStart(index: number): void
     recordItemEnd(index: number, success: boolean): void
     getSnapshot(): StreamMetadata
     incrementalStats(): PercentileTracker
   }
   ```
   - Maintains running statistics
   - Computes percentiles incrementally (t-digest or reservoir sampling)
   - Thread-safe for parallel operations

3. **Integration with Existing:**
   - Extend `StepMetadata` type for streaming
   - Reuse `traceId` and `spanId` propagation
   - Compatible with existing observability tools

**Incremental Percentile Calculation:**
- Can't wait for all items to compute percentiles
- Use online algorithms:
  - **t-digest**: Accurate percentiles with bounded memory
  - **Reservoir sampling**: Approximate percentiles
  - **Histogram bins**: Fast but less accurate

**Reporting:**
- Metadata available incrementally (call `getSnapshot()` anytime)
- Final metadata when stream exhausts
- Hook for external metrics (Prometheus, StatsD, etc.)

**Testing:**
- Test metadata accuracy with known inputs
- Test incremental percentile calculation
- Test metadata doesn't affect stream values
- Test overhead is minimal (<5% performance impact)
- Test metadata for early-terminated streams
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 withMetadata generator wrapper implemented
- [ ] #2 MetadataCollector tracks per-item and aggregate metrics
- [ ] #3 Incremental percentile calculation using online algorithm
- [ ] #4 StreamMetadata type extends existing StepMetadata
- [ ] #5 Metadata snapshots available at any point during streaming
- [ ] #6 Trace ID and span ID propagation preserved
- [ ] #7 Performance overhead <5% in benchmarks
- [ ] #8 Unit tests verify metric accuracy
- [ ] #9 Integration with existing observability infrastructure
<!-- AC:END -->
