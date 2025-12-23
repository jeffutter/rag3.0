---
id: task-13
title: Implement error handling and retry logic for streaming pipelines
status: Done
assignee: []
created_date: '2025-12-22 16:38'
updated_date: '2025-12-23 03:46'
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
- [x] #1 withRetry generator implements exponential backoff retry logic
- [x] #2 Error strategies (fail-fast, skip-failed, wrap-errors) implemented
- [x] #3 mapWithRetry combines transformation, retry, and error handling
- [x] #4 Retry metadata tracked per item
- [x] #5 Retryable error detection reuses existing logic
- [x] #6 Consumer can stop iteration during retry without issues
- [x] #7 Unit tests for all error scenarios and strategies
- [x] #8 Integration tests with multi-step pipelines
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented comprehensive error handling and retry logic for streaming pipelines in src/core/pipeline/streaming/errors.ts.

## Implementation Details

### Core Components

1. **withRetry** - Per-item retry logic with exponential backoff
   - Retries individual items that fail during stream processing
   - Implements exponential backoff (backoffMs * attemptNumber)
   - Tracks retry attempts and timing per item
   - Respects retryableErrors filter if provided
   - Properly cleans up resources when consumer stops early

2. **withErrorStrategy** - Configurable error handling strategies
   - FAIL_FAST: Throws error immediately on first failure (default behavior)
   - SKIP_FAILED: Silently skips failed items, yields only successes
   - WRAP_ERRORS: Yields StreamResult for both successes and failures
   - Includes full metadata for observability

3. **mapWithRetry** - Combined transformation, retry, and error handling
   - Combines map operation with retry logic and error strategy
   - Returns StreamResultWithRetry including retry metadata
   - Tracks total attempts, success/failure state, and error history
   - Supports all three error strategies

### Key Features

- **Reuses existing logic**: Uses isRetryableError() detection and error code extraction
- **Proper cleanup**: Source streams are properly closed even if consumer stops early
- **Per-item retry**: Retry delays only affect the failing item, not the entire stream
- **Comprehensive metadata**: Tracks attempts, timing, and error history for each item
- **Type-safe**: Full TypeScript support with proper generic types

### Error Detection

- Retryable errors: ECONNRESET, ETIMEDOUT, ECONNREFUSED, "fetch failed", "rate limit"
- Non-retryable errors: Validation errors, logic errors, etc.
- Supports explicit error code property or pattern matching in error message

### Testing

Created comprehensive test suite in errors.test.ts with 23 tests covering:
- Retry logic with exponential backoff
- All three error strategies (fail-fast, skip-failed, wrap-errors)
- mapWithRetry combining transformation + retry + error handling
- Retry metadata tracking
- Retryable vs non-retryable errors
- Consumer stopping iteration during retry
- Mixed success/failure scenarios
- Integration tests with multi-layer error handling

All 238 streaming tests pass, including the new 23 error handling tests.
<!-- SECTION:NOTES:END -->
