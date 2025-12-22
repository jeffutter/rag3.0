---
id: task-15
title: Create StreamingPipeline builder API
status: To Do
assignee: []
created_date: '2025-12-22 16:38'
labels:
  - streaming
  - builder
  - api
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Design and implement a fluent builder API for constructing streaming pipelines, similar to the existing Pipeline builder.

**Goal:** Create a builder that composes async generators while maintaining type safety and familiar API.

**API Design:**

```typescript
const pipeline = StreamingPipeline.start<Document>()
  .map('parse', parseDocument)
  .filter('valid', doc => doc.isValid)
  .batch('batches', 10)
  .map('embed', embedBatch, { parallel: true, concurrency: 5 })
  .flatMap('flatten', batch => batch)
  .tap('log', doc => console.log(doc.id))
  .withRetry({ maxAttempts: 3, backoffMs: 1000 })
  .withMetadata()
  .build();

// Execute
const results = pipeline.execute(inputStream);
for await (const doc of results) {
  console.log(doc);
}
```

**Builder Methods:**

1. **Transform Operations:**
   - `.map<TOut>(key, fn, options?)`: Transform items
   - `.filter(key, predicate)`: Filter items
   - `.flatMap<TOut>(key, fn)`: Map and flatten
   - `.tap(key, fn)`: Side effects

2. **Windowing:**
   - `.batch(key, size)`: Fixed-size batches
   - `.window(key, windowSize, slideSize?)`: Sliding windows
   - `.bufferTime(key, windowMs, maxSize?)`: Time-based batching

3. **Concurrency:**
   - `.parallel(key, fn, { concurrency, ordered? })`: Parallel map
   - `.merge(...sources)`: Merge multiple streams

4. **Control Flow:**
   - `.take(n)`: Limit items
   - `.skip(n)`: Skip items
   - `.takeWhile(predicate)`: Take until predicate fails
   - `.skipWhile(predicate)`: Skip while predicate true

5. **Cross-Cutting:**
   - `.withRetry(options)`: Add retry to all operations
   - `.withMetadata()`: Enable metadata collection
   - `.withErrorStrategy(strategy)`: Set error handling

6. **Terminal Operations:**
   - `.build()`: Return async generator
   - `.toArray()`: Consume to array
   - `.forEach(fn)`: Consume and run side effect
   - `.reduce(fn, initial)`: Reduce stream

**Type Safety:**
- Each builder method returns `StreamingPipeline<TOut>`
- Accumulated state type tracked through chain
- Compile-time errors for type mismatches

**Implementation** (`streaming/builder.ts`):
```typescript
class StreamingPipeline<TInput, TOutput, TState = {}> {
  private steps: StreamingStep[] = [];
  
  static start<T>(): StreamingPipeline<T, T, {}> {
    return new StreamingPipeline<T, T, {}>();
  }
  
  map<TOut>(
    key: string,
    fn: (item: TOutput) => TOut | Promise<TOut>,
    options?: MapOptions
  ): StreamingPipeline<TInput, TOut, TState & { [key]: TOut }> {
    // Add streaming map step
    // Return new builder with updated output type
  }
  
  build(): (input: AsyncIterable<TInput>) => AsyncGenerator<TOutput> {
    // Compose all steps into single async generator
  }
}
```

**Challenges:**
- State type tracking through builder chain
- Composing generators efficiently
- Error handling through composition
- Metadata collection through chain

**Comparison to Existing:**
- Similar API to current `Pipeline` builder
- Key differences: returns generators, lazy execution
- Migration: can convert existing pipeline definitions

**Testing:**
- Test type safety (should fail at compile time for type errors)
- Test each builder method
- Test composition of multiple operations
- Test terminal operations
- Integration tests with real streaming data
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 StreamingPipeline class with fluent builder API
- [ ] #2 All transform operations (map, filter, flatMap, tap) implemented
- [ ] #3 Windowing operations (batch, window, bufferTime) available
- [ ] #4 Control flow operations (take, skip, takeWhile, skipWhile)
- [ ] #5 Cross-cutting concerns (retry, metadata, error strategy)
- [ ] #6 Terminal operations (build, toArray, forEach, reduce)
- [ ] #7 Type safety preserved through entire chain
- [ ] #8 build() composes all steps into single async generator
- [ ] #9 Unit tests for each builder method
- [ ] #10 Integration tests for complex pipelines
- [ ] #11 API documentation with examples
<!-- AC:END -->
