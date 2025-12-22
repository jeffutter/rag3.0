# Troubleshooting Guide

Common issues and solutions when working with the type-safe pipeline system.

## Table of Contents

- [TypeScript Errors](#typescript-errors)
- [Runtime Errors](#runtime-errors)
- [Performance Issues](#performance-issues)
- [Type Inference Problems](#type-inference-problems)
- [Error Handling](#error-handling)
- [Debugging Tips](#debugging-tips)

## TypeScript Errors

### Error: "Property does not exist on type"

**Problem:**
```typescript
const pipeline = Pipeline.start<string>()
  .add('step1', step1)
  .add('step2', createStep<Output1, Output2, { wrongName: Output1 }>(
    'step2',
    async ({ state }) => {
      return state.wrongName; // Error: Property 'wrongName' does not exist
    }
  ));
```

**Cause:** The state type doesn't match the actual accumulated state. Step names must match the keys used in `.add()`.

**Solution:**
```typescript
const pipeline = Pipeline.start<string>()
  .add('step1', step1)
  .add('step2', createStep<Output1, Output2, { step1: Output1 }>(
    'step2',
    async ({ state }) => {
      return state.step1; // Correct: matches the key 'step1'
    }
  ));
```

**Better Solution:** Let TypeScript infer the state type:
```typescript
const pipeline = Pipeline.start<string>()
  .add('step1', step1)
  .add('step2', createStep('step2', async ({ state }) => {
    return state.step1; // TypeScript infers the correct type
  }));
```

### Error: "Type does not satisfy the constraint 'never'"

**Problem:**
```typescript
const pipeline = Pipeline.start<string>()
  .add('process', step1)
  .add('process', step2); // Error: Type 'process' does not satisfy constraint 'never'
```

**Cause:** Duplicate step names are not allowed.

**Solution:** Use unique names for each step:
```typescript
const pipeline = Pipeline.start<string>()
  .add('process1', step1)
  .add('process2', step2);
```

### Error: "Argument of type X is not assignable to parameter of type Y"

**Problem:**
```typescript
const pipeline = Pipeline.start<string>()
  .add('step1', step1) // Returns number
  .add('step2', createStep<string, boolean>( // Expects string input
    'step2',
    async ({ input }) => input.length > 5
  ));
```

**Cause:** Input type mismatch between steps.

**Solution:** Ensure each step's input type matches the previous step's output:
```typescript
const pipeline = Pipeline.start<string>()
  .add('step1', step1) // Returns number
  .add('step2', createStep<number, boolean>( // Correct: expects number
    'step2',
    async ({ input }) => input > 5
  ));
```

### Error: "Type is not an array type"

**Problem:**
```typescript
const pipeline = Pipeline.start<string>() // Not an array
  .map('items', step); // Error: Cannot use map on non-array type
```

**Cause:** Trying to use array operations (map, filter, etc.) on non-array types.

**Solution:** Ensure the previous step returns an array:
```typescript
const pipeline = Pipeline.start<string[]>() // Array type
  .map('items', step); // Works!

// Or convert to array first
const pipeline2 = Pipeline.start<string>()
  .add('array', createStep('toArray', async ({ input }) => [input]))
  .map('items', step);
```

### Error: "Type instantiation is excessively deep and possibly infinite"

**Problem:** Very long pipeline chains (>15 steps) can cause TypeScript to struggle.

**Cause:** TypeScript has limits on type recursion depth.

**Solution 1:** Break into smaller pipelines:
```typescript
const pipeline1 = Pipeline.start<Input>()
  .add('step1', step1)
  .add('step2', step2)
  // ... up to 10 steps

const pipeline2 = Pipeline.start<Step10Output>()
  .add('step11', step11)
  // ... more steps

// Compose them
async function execute(input: Input) {
  const result1 = await pipeline1.execute(input);
  if (!result1.success) return result1;
  return await pipeline2.execute(result1.data);
}
```

**Solution 2:** Use explicit type annotations:
```typescript
const pipeline = Pipeline.start<Input>()
  .add('step1', step1)
  // ... many steps
  .add('step15', createStep<Step14Output, Step15Output>(
    'step15',
    async ({ input }) => process(input)
  ));
```

## Runtime Errors

### Error: "LIST_PROCESSING_ERROR"

**Problem:**
```typescript
const result = await pipeline.execute(items);
// Error: LIST_PROCESSING_ERROR
```

**Cause:** An exception was thrown during list processing that wasn't caught.

**Solution:** Check the error details:
```typescript
const result = await pipeline.execute(items);
if (!result.success) {
  console.error('Error code:', result.error.code);
  console.error('Message:', result.error.message);
  console.error('Cause:', result.error.cause);
  console.error('Failed at:', result.metadata.stepName);
}
```

**Prevention:** Use appropriate error strategies:
```typescript
.map('items', step, {
  errorStrategy: ListErrorStrategy.SKIP_FAILED // Continue on errors
})
```

### Error: "Maximum call stack size exceeded"

**Problem:** Pipeline execution crashes with stack overflow.

**Cause 1:** Infinite recursion in step logic.
**Solution:** Check your step implementation for recursive calls.

**Cause 2:** Extremely large arrays (>100,000 items) processed sequentially.
**Solution:** Use batching or process in chunks:
```typescript
const pipeline = Pipeline.start<LargeArray>()
  .batch('batches', 1000) // Process 1000 at a time
  .map('processed', step)
  .flatten('results');
```

### Error: Rate Limiting or Timeout

**Problem:** API calls fail with rate limit or timeout errors.

**Cause:** Too many concurrent requests or requests taking too long.

**Solution:** Adjust concurrency and add retries:
```typescript
.map('results', apiStep, {
  parallel: true,
  concurrencyLimit: 5, // Limit concurrent requests
  errorStrategy: ListErrorStrategy.SKIP_FAILED
})

// Or add retry logic to the step
createStep('api', apiCall, {
  retry: {
    maxAttempts: 3,
    backoffMs: 1000,
    retryableErrors: ['ETIMEDOUT', 'RATE_LIMIT']
  }
})
```

## Performance Issues

### Problem: Slow Sequential Processing

**Symptom:** Pipeline takes too long with large arrays.

**Diagnosis:**
```typescript
const result = await pipeline.execute(items);
console.log('Duration:', result.metadata.durationMs);
console.log('List metadata:', result.metadata.listMetadata);
```

**Solution:** Enable parallel execution:
```typescript
.map('items', step, {
  parallel: true,
  concurrencyLimit: 10 // Start with 10, adjust based on results
})
```

**Expected improvement:** 3-10x faster for I/O-bound operations.

### Problem: Too Many API Calls

**Symptom:** High API costs or rate limiting.

**Diagnosis:**
```typescript
// Before: 1000 items = 1000 API calls
.map('embeddings', embedStep)
```

**Solution:** Use batching:
```typescript
// After: 1000 items = 100 API calls
.batch('batches', 10)
.map('embeddings', embedBatchStep)
.flatten('allEmbeddings')
```

**Expected improvement:** 3-5x reduction in API calls.

### Problem: Memory Usage

**Symptom:** High memory consumption with large datasets.

**Diagnosis:**
```typescript
const memBefore = process.memoryUsage().heapUsed;
const result = await pipeline.execute(largeArray);
const memAfter = process.memoryUsage().heapUsed;
console.log('Memory increase:', (memAfter - memBefore) / 1024 / 1024, 'MB');
```

**Solution 1:** Process in batches:
```typescript
async function processLargeDataset(items: Item[]) {
  const batchSize = 1000;
  const results = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResult = await pipeline.execute(batch);
    if (!batchResult.success) return batchResult;
    results.push(...batchResult.data);
  }

  return { success: true, data: results };
}
```

**Solution 2:** Stream processing (for very large datasets):
```typescript
// Process items one at a time without accumulating
for (const item of items) {
  const result = await itemPipeline.execute(item);
  await processResult(result);
}
```

### Problem: Concurrency Limit Too High

**Symptom:** System becomes unresponsive or errors increase.

**Diagnosis:** Monitor system resources and error rates.

**Solution:** Reduce concurrency limit:
```typescript
// Too high: System overloaded
.map('items', step, { parallel: true, concurrencyLimit: 100 })

// Better: Balanced performance
.map('items', step, { parallel: true, concurrencyLimit: 10 })

// Conservative: Safe for most APIs
.map('items', step, { parallel: true, concurrencyLimit: 5 })
```

**Guidelines:**
- API calls: 5-10
- Database queries: 10-20
- CPU-bound tasks: Number of CPU cores
- File I/O: 50-100

## Type Inference Problems

### Problem: TypeScript Can't Infer State Type

**Symptom:**
```typescript
.add('summary', createStep('sum', async ({ state }) => {
  return state.step1; // Error: 'step1' is not a known property
}));
```

**Solution:** Add explicit type annotation:
```typescript
.add('summary', createStep<Input, Output, { step1: Step1Output }>(
  'sum',
  async ({ state }) => {
    return state.step1; // Now TypeScript knows about step1
  }
));
```

### Problem: Wrong Type Inferred

**Symptom:** TypeScript infers `any` or wrong type for state.

**Diagnosis:**
```typescript
.add('step', createStep('name', async ({ state }) => {
  // Hover over 'state' in your IDE to see inferred type
  return state;
}));
```

**Solution:** Verify step return types are explicit:
```typescript
// Bad: Return type not clear
createStep('step', async ({ input }) => {
  return someFunction(input); // What does this return?
})

// Good: Explicit return type
createStep<Input, Output>('step', async ({ input }) => {
  return someFunction(input) as Output;
})
```

## Error Handling

### Problem: Errors Not Being Caught

**Symptom:** Uncaught exceptions crash the application.

**Cause:** Errors in step execution are normally caught and returned in the result.

**Check:** Ensure you're checking `result.success`:
```typescript
const result = await pipeline.execute(input);
if (!result.success) {
  // Handle error
  logger.error('Pipeline failed:', result.error);
  return;
}
// Use result.data
```

### Problem: Partial Failures Not Detected

**Symptom:** Some items fail silently with SKIP_FAILED strategy.

**Solution:** Check list metadata:
```typescript
const result = await pipeline.execute(items);
if (result.success && result.metadata.listMetadata) {
  const { successCount, failureCount, skippedCount } = result.metadata.listMetadata;

  if (skippedCount > 0) {
    logger.warn(`Skipped ${skippedCount} items`);
  }

  if (failureCount > successCount * 0.5) {
    logger.error('More than 50% failure rate!');
  }
}
```

### Problem: Need All Error Details

**Symptom:** FAIL_FAST stops too early, need to see all errors.

**Solution:** Use COLLECT_ERRORS strategy:
```typescript
.map('items', step, {
  errorStrategy: ListErrorStrategy.COLLECT_ERRORS
})

// Then check error cause
if (!result.success && result.error.code === 'LIST_PROCESSING_ERRORS') {
  const failures = result.error.cause as Array<{ index: number; error: StepError }>;
  for (const failure of failures) {
    console.error(`Item ${failure.index} failed:`, failure.error.message);
  }
}
```

## Debugging Tips

### Enable Detailed Logging

The pipeline system uses structured logging. Check your logs for:
```json
{
  "event": "step_start",
  "traceId": "unique-id",
  "stepName": "myStep",
  "stepKey": "myKey"
}
```

```json
{
  "event": "step_complete",
  "traceId": "unique-id",
  "stepName": "myStep",
  "durationMs": 123,
  "listOperation": {
    "totalItems": 100,
    "successCount": 95,
    "failureCount": 5
  }
}
```

### Use Trace IDs

All pipeline executions have unique trace IDs:
```typescript
const result = await pipeline.execute(input);
console.log('Trace ID:', result.metadata.traceId);
// Use this ID to correlate logs across distributed systems
```

### Inspect Metadata

Check detailed timing and operation statistics:
```typescript
const result = await pipeline.execute(items);
if (result.metadata.listMetadata) {
  const meta = result.metadata.listMetadata;
  console.log('Total items:', meta.totalItems);
  console.log('Success:', meta.successCount);
  console.log('Failures:', meta.failureCount);
  console.log('Execution strategy:', meta.executionStrategy);

  if (meta.itemTimings) {
    console.log('Item timing stats:');
    console.log('  Average:', meta.itemTimings.avg, 'ms');
    console.log('  P95:', meta.itemTimings.p95, 'ms');
    console.log('  P99:', meta.itemTimings.p99, 'ms');
  }
}
```

### Test Individual Steps

Isolate problems by testing steps independently:
```typescript
const step = createStep('myStep', async ({ input }) => {
  return processData(input);
});

// Test the step directly
const testResult = await step.execute({
  input: testData,
  state: {},
  context: {}
});

console.log('Step result:', testResult);
```

### Verify Type Safety

Use TypeScript's type checking:
```typescript
// This should cause a compile error if types don't match
const pipeline = Pipeline.start<string>()
  .add('step1', step1)
  .add('step2', step2)
  .add('step3', createStep<WrongType, Output>( // Will error if WrongType doesn't match step2 output
    'step3',
    async ({ input }) => process(input)
  ));
```

### Monitor Performance

Track performance trends:
```typescript
const results = [];
for (let i = 0; i < 10; i++) {
  const result = await pipeline.execute(testData);
  results.push(result.metadata.durationMs);
}

console.log('Average duration:', results.reduce((a, b) => a + b) / results.length);
console.log('Min:', Math.min(...results));
console.log('Max:', Math.max(...results));
```

### Use Performance Benchmarks

Run the included benchmarks:
```bash
bun test src/core/pipeline/performance-benchmark.test.ts
```

This shows:
- Sequential vs parallel performance
- Scalability characteristics
- Memory usage patterns
- Comparison with manual code

## Common Patterns for Debugging

### Pattern 1: Add Logging Steps

```typescript
const pipeline = Pipeline.start<Data>()
  .add('step1', step1)
  .add('log1', createStep('log', async ({ input }) => {
    console.log('After step1:', input);
    return input; // Pass through
  }))
  .add('step2', step2)
  .add('log2', createStep('log', async ({ input, state }) => {
    console.log('After step2:', input);
    console.log('Full state:', state);
    return input;
  }));
```

### Pattern 2: Validate State

```typescript
.add('validate', createStep('validate', async ({ state }) => {
  if (!state.step1) throw new Error('step1 missing from state');
  if (!state.step2) throw new Error('step2 missing from state');
  return state; // Pass through
}))
```

### Pattern 3: Measure Timing

```typescript
.add('timed', createStep('operation', async ({ input }) => {
  const start = Date.now();
  const result = await expensiveOperation(input);
  console.log(`Operation took ${Date.now() - start}ms`);
  return result;
}))
```

## Getting Help

1. Check this troubleshooting guide
2. Review [Pipeline Patterns](./PIPELINE_PATTERNS.md) for examples
3. Check [Migration Guide](./MIGRATION_GUIDE.md) for before/after patterns
4. Look at test files for usage examples
5. Enable detailed logging and check trace IDs
6. Create a minimal reproduction case
7. File an issue with:
   - TypeScript version
   - Code snippet showing the problem
   - Expected vs actual behavior
   - Relevant error messages or logs
