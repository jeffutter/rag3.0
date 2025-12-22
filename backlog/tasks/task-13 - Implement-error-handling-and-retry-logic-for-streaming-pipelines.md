---
id: task-13
title: Implement error handling and retry logic for streaming pipelines
status: To Do
assignee: []
created_date: '2025-12-22 16:38'
labels:
  - streaming
  - error-handling
  - retry
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Adapt the current error handling and retry mechanisms to work with pull-based async generators.

**Current Error Handling Architecture:**

1. **Step-level** (`steps.ts:48-80`): Try/catch wrapper returns `StepResult`
2. **Retry logic** (`builder.ts:613-659`): Exponential backoff, retryable errors
3. **List strategies** (`list-adapters.ts:22-26`): FAIL_FAST, COLLECT_ERRORS, SKIP_FAILED

**Streaming Challenges:**
- Errors occur during iteration, not upfront
- Retry must happen inline without breaking generator chain
- Consumer may not pull next item after error
- Metadata collection for retries is complex

**Required Components:**

1. **Per-Item Error Handling** (`streaming/errors.ts`):
   ```typescript
   async function* withRetry<T>(
     source: AsyncIterable<T>,
     options: {
       maxAttempts: number,
       backoffMs: number,
       retryableErrors?: string[]
     }
   ): AsyncGenerator<T>
   ```
   - Retry individual items that fail
   - Respect exponential backoff
   - Track retry attempts in metadata

2. **Error Strategies for Streams**:
   ```typescript
   async function* withErrorStrategy<T>(
     source: AsyncIterable<T>,
     strategy: 'fail-fast' | 'skip-failed' | 'wrap-errors'
   ): AsyncGenerator<T | ErrorWrapper<T>>
   ```
   - `fail-fast`: Propagate error immediately (default)
   - `skip-failed`: Silently skip failed items
   - `wrap-errors`: Yield `{ success: false, error }` for failures

3. **Transform with Error Handling**:
   ```typescript
   async function* mapWithRetry<TIn, TOut>(
     source: AsyncIterable<TIn>,
     fn: (item: TIn) => Promise<TOut>,
     retryOptions: RetryOptions,
     errorStrategy: ErrorStrategy
   ): AsyncGenerator<StepResult<TOut>>
   ```
   - Combines map + retry + error strategy
   - Yields StepResult (success/failure) for each item

**Error Metadata:**
- Track retry attempts per item
- Collect error history
- Preserve traceId/spanId through retries
- Final error should include all retry attempts

**Integration with Existing:**
- Reuse `StepError` type
- Reuse retryable error detection logic
- Maintain same retry behavior (exponential backoff)

**Edge Cases:**
- What if source itself throws?
- How to handle cleanup if consumer stops during retry?
- Should retry delay block entire stream or just that item (parallel)?

**Testing:**
- Test retry succeeds on 2nd/3rd attempt
- Test max attempts reached
- Test retryable vs non-retryable errors
- Test error strategies (fail-fast, skip, wrap)
- Test backoff timing
- Test error propagation through pipeline
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 withRetry generator implements exponential backoff retry logic
- [ ] #2 Error strategies (fail-fast, skip-failed, wrap-errors) implemented
- [ ] #3 mapWithRetry combines transformation, retry, and error handling
- [ ] #4 Retry metadata tracked per item
- [ ] #5 Retryable error detection reuses existing logic
- [ ] #6 Consumer can stop iteration during retry without issues
- [ ] #7 Unit tests for all error scenarios and strategies
- [ ] #8 Integration tests with multi-step pipelines
<!-- AC:END -->
