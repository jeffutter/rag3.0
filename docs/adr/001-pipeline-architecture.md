# ADR 001: Pipeline Architecture with List Operations

**Date:** 2025-12-21
**Status:** Accepted
**Deciders:** Development Team

## Context

The RAG 3.0 system requires a flexible, type-safe way to compose data processing workflows. Previous implementations used manual loops and Promise.all() for array processing, which led to:

1. **Repetitive code**: Similar patterns repeated across workflows
2. **Error handling complexity**: Inconsistent error handling strategies
3. **Performance issues**: Lack of concurrency control led to resource exhaustion
4. **Limited observability**: No built-in metrics or timing information
5. **Type safety gaps**: Manual type assertions in complex workflows

We needed a solution that would:
- Provide compile-time type safety for complex workflows
- Support both single-item and list processing
- Enable parallel execution with concurrency control
- Offer flexible error handling strategies
- Include built-in performance monitoring

## Decision

We've implemented a **type-safe pipeline system** with built-in list operations, inspired by functional programming concepts and reactive streams.

### Core Concepts

#### 1. Pipeline Builder Pattern

Pipelines are composed using a fluent API where each step:
- Receives the previous step's output as input
- Can access all previous step outputs via accumulated state
- Returns a new pipeline with updated type information

```typescript
const pipeline = Pipeline.start<Input>()
  .add('step1', step1)  // state: { step1: Output1 }
  .add('step2', step2)  // state: { step1: Output1, step2: Output2 }
  .add('step3', step3); // state: { step1: Output1, step2: Output2, step3: Output3 }
```

#### 2. List Operations

Built-in operations for array processing:

- **map()**: Transform each element (T[] → U[])
- **filter()**: Remove elements (T[] → T[])
- **flatMap()**: Transform and flatten (T[] → U[])
- **batch()**: Group into chunks (T[] → T[][])
- **flatten()**: Flatten one level (T[][] → T[])

#### 3. Execution Strategies

List operations support two execution strategies:

- **Sequential**: Process items one at a time (default)
- **Parallel**: Process multiple items concurrently with configurable limits

#### 4. Error Handling

Three error handling strategies:

- **FAIL_FAST**: Stop on first error (default)
- **COLLECT_ERRORS**: Continue processing, collect all errors
- **SKIP_FAILED**: Skip failed items, return only successes

#### 5. Type Safety

TypeScript enforces:
- Input/output type matching between steps
- Unique step names (no duplicates)
- Valid state access (only reference existing steps)
- Array types for list operations

### Architecture Components

```
┌─────────────────────────────────────────────────────────┐
│                    Pipeline Builder                     │
│  - Fluent API for composing steps                       │
│  - Type accumulation across steps                       │
│  - Compile-time validation                              │
└─────────────────┬───────────────────────────────────────┘
                  │
                  ├─────────────────────────────────────┐
                  │                                     │
        ┌─────────▼─────────┐              ┌───────────▼──────────┐
        │  Single Item Ops  │              │   List Operations    │
        │  - add()          │              │   - map()            │
        │  - branch()       │              │   - filter()         │
        │                   │              │   - flatMap()        │
        │                   │              │   - batch()          │
        │                   │              │   - flatten()        │
        └─────────┬─────────┘              └───────────┬──────────┘
                  │                                    │
                  │         ┌──────────────────────────┘
                  │         │
        ┌─────────▼─────────▼─────────┐
        │    List Adapters             │
        │  - singleToList()            │
        │  - executeParallel()         │
        │  - Error strategy handlers   │
        └─────────┬────────────────────┘
                  │
        ┌─────────▼────────────────────┐
        │   Pipeline Executor          │
        │  - State accumulation        │
        │  - Retry logic               │
        │  - Metrics collection        │
        │  - Logging                   │
        └──────────────────────────────┘
```

## Technical Details

### Type System

The pipeline uses advanced TypeScript features for type safety:

```typescript
// Type accumulation
type AddToState<TState, TKey extends string, TValue> =
  TState & Record<TKey, TValue>;

// Prevent duplicate keys
type ValidateNewKey<TState, TKey extends string> =
  TKey extends keyof TState ? never : TKey;

// Extract array element type
type ArrayElement<T> = T extends (infer E)[] ? E : never;
```

### Adapter Pattern

List operations use an adapter pattern to convert single-item steps to list steps:

```typescript
// Single-item step
const processItem: Step<Item, Result> = ...;

// Converted to list step
const processList = singleToList(processItem, {
  parallel: true,
  concurrencyLimit: 10,
  errorStrategy: ListErrorStrategy.SKIP_FAILED
});
```

This allows:
- Reuse of single-item steps
- Consistent error handling
- Performance optimizations
- Metrics collection

### Concurrency Control

Parallel execution uses a custom implementation with bounded concurrency:

```typescript
async function executeParallel<T, U>(
  items: T[],
  executor: (item: T, index: number) => Promise<U>,
  concurrencyLimit: number
): Promise<U[]>
```

Features:
- Configurable concurrency limit
- Maintains item order
- Prevents memory exhaustion
- Handles backpressure

### Performance Metrics

List operations automatically collect detailed metrics:

```typescript
interface ListOperationMetadata {
  totalItems: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  itemTimings?: {
    min: number;
    max: number;
    avg: number;
    p50: number;
    p95: number;
    p99: number;
  };
  executionStrategy: "sequential" | "parallel";
  concurrencyLimit?: number;
}
```

## Consequences

### Positive

1. **Type Safety**: Compile-time validation prevents entire classes of runtime errors
2. **Performance**: Parallel execution with concurrency control improves throughput
3. **Observability**: Built-in metrics provide insights into pipeline performance
4. **Flexibility**: Multiple error handling strategies for different use cases
5. **Reusability**: Single-item steps can be used in both single and list contexts
6. **Maintainability**: Declarative code is easier to understand and modify
7. **Testing**: Individual steps can be tested in isolation

### Negative

1. **Learning Curve**: Developers need to understand the pipeline API and TypeScript generics
2. **Type Complexity**: Complex type signatures can be intimidating
3. **Debugging**: Stack traces may be harder to read with many abstraction layers
4. **Bundle Size**: Additional abstractions increase code size (minimal impact)

### Neutral

1. **Migration Required**: Existing workflows need to be migrated to the new API
2. **Documentation Needs**: Comprehensive documentation is essential for adoption
3. **IDE Support**: Works best with modern IDEs that support TypeScript

## Alternatives Considered

### Alternative 1: RxJS Observables

**Pros:**
- Mature library with extensive operators
- Rich ecosystem
- Well-tested

**Cons:**
- Steep learning curve
- Overkill for many use cases
- Additional dependency
- Less type-safe for our specific needs

**Decision:** Rejected - too complex for our use cases

### Alternative 2: AsyncIterables

**Pros:**
- Native JavaScript feature
- Lazy evaluation
- Memory efficient

**Cons:**
- Limited operators
- No built-in parallel execution
- Less intuitive for our workflows
- Poor error handling

**Decision:** Rejected - insufficient features

### Alternative 3: Promise-based Functional Libraries (lodash, ramda)

**Pros:**
- Simple API
- Well-known patterns
- Minimal learning curve

**Cons:**
- Limited type safety
- No accumulated state
- No built-in metrics
- Manual concurrency control

**Decision:** Rejected - doesn't meet type safety requirements

### Alternative 4: Custom Promise.all() Utilities

**Pros:**
- Lightweight
- Full control
- No abstractions

**Cons:**
- Repetitive code
- No type safety
- Manual metrics
- Inconsistent error handling

**Decision:** This is what we had before - the problems we're solving

## Implementation Notes

### Phase 1: Core Pipeline (Completed)
- Pipeline builder with type accumulation
- Basic step composition
- Accumulated state access

### Phase 2: List Types (Completed)
- Type definitions for list operations
- Array element extraction
- Type constraints

### Phase 3: List Adapters (Completed)
- singleToList adapter
- Parallel execution helper
- Error handling strategies
- Metrics collection

### Phase 4: Pipeline Integration (Completed)
- map(), filter(), flatMap() methods
- batch(), flatten() methods
- Type safety validation

### Phase 5: Testing (Completed)
- Unit tests for list operations
- Integration tests
- Performance benchmarks
- Type safety validation tests

### Phase 6: Documentation (Current)
- API documentation
- Migration guide
- Example workflows
- This ADR

## Future Considerations

### Potential Enhancements

1. **Streaming Support**: Add support for processing streams instead of arrays
2. **Backpressure**: Implement proper backpressure mechanisms
3. **Caching**: Add optional caching for expensive operations
4. **Retry Strategies**: More sophisticated retry logic (exponential backoff, jitter)
5. **Cancellation**: Support for cancelling pipeline execution
6. **Conditional Execution**: Skip steps based on runtime conditions
7. **Sub-pipelines**: Compose pipelines within pipelines
8. **Parallel Branches**: Execute multiple branches in parallel

### Monitoring Improvements

1. **Distributed Tracing**: Integration with OpenTelemetry
2. **Custom Metrics**: Allow steps to emit custom metrics
3. **Performance Profiling**: Detailed profiling information
4. **Resource Usage**: Track memory and CPU usage

### Developer Experience

1. **Better Error Messages**: More helpful TypeScript error messages
2. **Debug Mode**: Enhanced logging for troubleshooting
3. **Visual Pipeline Builder**: GUI for composing pipelines
4. **Pipeline Visualization**: Generate diagrams from pipeline definitions

## References

- [Functional Programming Principles](https://en.wikipedia.org/wiki/Functional_programming)
- [Reactive Streams Specification](https://www.reactive-streams.org/)
- [TypeScript Advanced Types](https://www.typescriptlang.org/docs/handbook/2/types-from-types.html)
- [Pipeline Pattern](https://en.wikipedia.org/wiki/Pipeline_(software))

## Related Documents

- [Migration Guide](../migration-guide.md)
- [API Documentation](../../src/core/pipeline/builder.ts)
- [Examples](../../src/core/pipeline/examples/)

## Changelog

- 2025-12-21: Initial ADR created
- 2025-12-21: Implementation completed through Phase 6
