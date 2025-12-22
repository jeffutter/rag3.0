---
id: task-18
title: 'Performance benchmarking: streaming vs batch pipelines'
status: To Do
assignee: []
created_date: '2025-12-22 16:38'
labels:
  - streaming
  - benchmarks
  - performance
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create comprehensive benchmarks comparing streaming and batch pipeline performance across different scenarios.

**Benchmark Scenarios:**

1. **Memory Usage:**
   - Large dataset (1M+ items)
   - Batch: Load all into memory
   - Streaming: Process incrementally
   - Measure: Peak memory, memory over time
   - Expected: Streaming uses O(1) memory, batch uses O(n)

2. **Latency to First Result:**
   - 10k item pipeline with 3 transformation steps
   - Batch: Wait for all items through all steps
   - Streaming: Yield first item ASAP
   - Measure: Time to first result available
   - Expected: Streaming 100x+ faster to first result

3. **Throughput:**
   - Same work, measure total completion time
   - Batch: Sequential step execution, parallel items
   - Streaming: Per-item pipeline execution
   - Measure: Items per second, total time
   - Expected: Batch may be faster due to less overhead

4. **I/O Bound Operations:**
   - Pipeline with API calls (simulated with delays)
   - Batch: Can parallelize within step
   - Streaming: Can parallelize across steps
   - Measure: Total time, concurrent operations
   - Expected: Depends on concurrency limits

5. **CPU Bound Operations:**
   - Heavy computation per item
   - Batch: Optimize with parallel processing
   - Streaming: Limited parallelism
   - Measure: CPU utilization, total time
   - Expected: Batch likely faster

6. **Error Recovery:**
   - Pipeline with 10% failure rate
   - Different retry and error strategies
   - Measure: Success rate, retries, total time
   - Compare: Both modes with same error handling

**Benchmark Implementation** (`src/core/pipeline/benchmarks/`):

```typescript
// streaming-vs-batch.bench.ts
import { bench, group } from 'bun:test';

group('memory-usage', () => {
  bench('batch-pipeline-1m-items', async () => {
    // Measure memory before/after
  });
  
  bench('streaming-pipeline-1m-items', async () => {
    // Measure memory during streaming
  });
});

group('latency-to-first-result', () => {
  bench('batch-pipeline', async () => {
    const start = Date.now();
    const result = await batchPipeline.execute(data);
    // Measure when first result available
  });
  
  bench('streaming-pipeline', async () => {
    const start = Date.now();
    const stream = streamingPipeline.execute(data);
    const first = await stream.next();
    // Measure time to first item
  });
});
```

**Metrics to Collect:**
- Peak memory usage (RSS)
- Memory over time (graph)
- Latency to first result
- Latency to completion
- Throughput (items/sec)
- CPU utilization
- Concurrent operations
- Error recovery metrics

**Visualization:**
- Generate markdown report with results
- Memory usage graphs
- Latency comparison tables
- Throughput vs concurrency graphs
- Decision tree: when to use each approach

**Real-World Scenarios:**
- Document processing pipeline
- Embedding generation pipeline
- Vector store ingestion pipeline
- Should use realistic data sizes and operation costs

**Benchmark Infrastructure:**
- Use Bun's built-in benchmark runner
- Deterministic data generation
- Warmup runs to avoid cold start
- Multiple iterations for statistical significance
- CI integration to track performance over time

**Expected Outcomes:**
Document when to use each approach:
- **Use Streaming**: Large datasets, memory-constrained, need partial results fast
- **Use Batch**: Small datasets, CPU-bound, need maximum throughput
- **Hybrid**: Mix approaches based on step characteristics
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Benchmarks for memory usage, latency, throughput implemented
- [ ] #2 Real-world RAG pipeline scenarios benchmarked
- [ ] #3 Metrics collected and visualized in reports
- [ ] #4 Decision guide created based on benchmark results
- [ ] #5 Benchmarks run in CI to track performance
- [ ] #6 Statistical significance validated with multiple runs
- [ ] #7 Memory profiling shows expected O(1) vs O(n) behavior
- [ ] #8 Latency measurements confirm streaming yields faster
- [ ] #9 Documentation includes when to use each approach
<!-- AC:END -->
