---
id: task-19
title: Integration testing for streaming pipelines
status: To Do
assignee: []
created_date: '2025-12-22 16:38'
labels:
  - streaming
  - testing
  - integration
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create comprehensive integration tests for streaming pipelines covering complex scenarios and edge cases.

**Test Categories:**

1. **End-to-End Pipeline Tests:**
   - Multi-step pipelines (5+ steps)
   - Mix of transform, filter, batch operations
   - Parallel and sequential steps
   - Verify correctness of final results
   - Compare to batch pipeline equivalent

2. **Error Scenarios:**
   - Errors at different pipeline stages
   - Retry exhaustion
   - Different error strategies
   - Partial failure recovery
   - Error propagation through pipeline

3. **Concurrency and Parallelism:**
   - Parallel map with various concurrency limits
   - Backpressure with slow consumer
   - Fast consumer, slow source
   - Multiple concurrent pipelines

4. **Memory and Resource Management:**
   - Large datasets (verify bounded memory)
   - Early termination (cleanup resources)
   - Consumer stops mid-stream
   - Source throws during iteration

5. **State Management:**
   - Reduction points with state access
   - Stateful transformations
   - State across different pipeline branches
   - State with error recovery

6. **Metadata and Observability:**
   - Metadata collection through entire pipeline
   - Trace ID propagation
   - Metrics accuracy (counts, timings)
   - Incremental statistics

7. **Real-World Patterns:**
   - Document chunking and embedding
   - Batch API calls with rate limiting
   - Database streaming with backpressure
   - File processing pipeline

**Test Infrastructure** (`src/core/pipeline/__tests__/integration/streaming/`):

```typescript
// e2e-pipeline.test.ts
import { describe, test, expect } from 'bun:test';

describe('Streaming Pipeline Integration', () => {
  test('complex multi-step pipeline produces correct results', async () => {
    const input = generateTestData(1000);
    
    const pipeline = StreamingPipeline.start<Item>()
      .map('parse', parseItem)
      .filter('valid', item => item.isValid)
      .batch('batches', 10)
      .map('process', processBatch, { parallel: true, concurrency: 3 })
      .flatMap('flatten', batch => batch)
      .withRetry({ maxAttempts: 3 })
      .withMetadata()
      .build();
    
    const results = await collectStream(pipeline(input));
    
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => r.isValid)).toBe(true);
    
    // Compare to batch pipeline
    const batchResults = await batchPipeline.execute(input);
    expect(results).toEqual(batchResults.data);
  });
});
```

**Helper Utilities:**
```typescript
// Test helpers
async function collectStream<T>(stream: AsyncGenerator<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const item of stream) {
    results.push(item);
  }
  return results;
}

async function* generateTestStream<T>(
  items: T[],
  delayMs?: number
): AsyncGenerator<T> {
  for (const item of items) {
    if (delayMs) await Bun.sleep(delayMs);
    yield item;
  }
}

function* errorProneStream<T>(
  items: T[],
  errorRate: number
): Generator<T> {
  for (const item of items) {
    if (Math.random() < errorRate) {
      throw new Error('Random error');
    }
    yield item;
  }
}
```

**Snapshot Testing:**
- Use Bun's snapshot feature for complex pipelines
- Snapshot metadata structure
- Snapshot error messages and codes

**Performance Tests:**
- Assert memory stays bounded
- Assert latency to first item
- Assert cleanup completes

**Edge Cases:**
- Empty stream
- Single item stream
- Stream with all errors
- Consumer stops immediately
- Source never yields

**CI Integration:**
- All tests must pass
- Memory leak detection
- Performance regression detection
- Coverage >90% for streaming code

**Test Data:**
- Deterministic test data generators
- Various data sizes (0, 1, 10, 1000, 100k items)
- Realistic data shapes (documents, embeddings, etc.)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 End-to-end tests for complex multi-step pipelines
- [ ] #2 Error scenario tests covering all error strategies
- [ ] #3 Concurrency tests with various limits and backpressure
- [ ] #4 Memory tests verify bounded usage
- [ ] #5 State management tests for reduction points
- [ ] #6 Metadata and observability tests
- [ ] #7 Real-world pattern tests (RAG pipeline scenarios)
- [ ] #8 Test helpers for streaming (collectStream, generateTestStream)
- [ ] #9 Edge case coverage (empty, single item, all errors)
- [ ] #10 Code coverage >90% for streaming module
- [ ] #11 Tests run successfully in CI
- [ ] #12 No memory leaks detected
<!-- AC:END -->
