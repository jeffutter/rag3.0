# Type-Safe Pipeline System with Accumulated State

A compile-time type-safe workflow orchestration system where steps can access outputs from **any** previous step, not just the immediate predecessor.

## Quick Start

Get started in 60 seconds:

```typescript
import { Pipeline, createStep } from '@core/pipeline';

// Create a simple pipeline
const pipeline = Pipeline.start<string>()
  .add('parse', createStep('parse', async ({ input }) => {
    return JSON.parse(input);
  }))
  .add('validate', createStep('validate', async ({ input }) => {
    if (!input.email) throw new Error('Missing email');
    return input;
  }))
  .add('process', createStep('process', async ({ input }) => {
    return await processUser(input);
  }));

// Execute it
const result = await pipeline.execute('{"email": "user@example.com"}');
if (result.success) {
  console.log('Processed:', result.data);
} else {
  console.error('Failed:', result.error.message);
}
```

**Next Steps:**
- [Common Patterns](./docs/PIPELINE_PATTERNS.md) - Learn powerful patterns
- [Migration Guide](./docs/MIGRATION_GUIDE.md) - Migrate existing code
- [Troubleshooting](./docs/TROUBLESHOOTING.md) - Common issues and solutions

## Key Features

✅ **Accumulated State Tracking** - Each step can access all previous step outputs by name
✅ **Compile-Time Type Safety** - TypeScript validates that referenced steps exist and types match
✅ **Named Steps** - Steps are identified by unique keys for easy cross-referencing
✅ **Duplicate Prevention** - TypeScript prevents duplicate step names at compile time
✅ **Retry Logic** - Built-in retry support with backoff
✅ **Structured Logging** - OpenTelemetry-compatible logging with trace IDs
✅ **List Operations** - Built-in map, filter, batch, flatten operations
✅ **Parallel Execution** - 3-10x faster processing with automatic concurrency control
✅ **Error Strategies** - Fail fast, collect errors, or skip failures

## Basic Usage

```typescript
import { Pipeline, createStep } from '@core/pipeline';

// Simple linear pipeline
const pipeline = Pipeline.start<string>()
  .add('step1', createStep<string, number>('step1', async ({ input }) => {
    return input.length;
  }))
  .add('step2', createStep<number, boolean, { step1: number }>('step2', async ({ input, state }) => {
    // input: number from previous step
    // state.step1: also available (same as input in this case)
    return input > 5;
  }));

const result = await pipeline.execute('Hello');
```

## Accessing Previous Steps

The power of this system is that steps can reference **any** previous step, not just the immediate one:

```typescript
const ragPipeline = Pipeline.start<string>()
  // Step 1: Generate embedding
  .add('embed', createStep<string, Embedding>('embed', async ({ input }) => {
    return { vector: await embedText(input), text: input };
  }))

  // Step 2: Search vectors
  .add('search', createStep<Embedding, SearchResult[], { embed: Embedding }>(
    'search',
    async ({ input, state }) => {
      // Can use both input and state.embed
      return await searchVectors(input.vector);
    }
  ))

  // Step 3: Rerank results - references BOTH previous steps!
  .add('rerank', createStep<
    SearchResult[],
    SearchResult[],
    { embed: Embedding; search: SearchResult[] }  // TypeScript validates!
  >('rerank', async ({ input, state }) => {
    // input: SearchResult[] from previous step
    // state.embed: Original embedding
    // state.search: Search results (same as input in this case)

    console.log(`Reranking for query: ${state.embed.text}`);
    return rerank(input, state.embed);
  }));
```

## Execution Context

Each step receives a `StepExecutionContext` object with three properties:

```typescript
interface StepExecutionContext<TInput, TAccumulatedState, TContext> {
  input: TInput;                 // Output from previous step
  state: TAccumulatedState;       // All previous step outputs (by name)
  context: TContext;              // Additional runtime context
}
```

## Compile-Time Safety Examples

### ✅ Valid: Referencing existing steps

```typescript
Pipeline.start<string>()
  .add('a', stepA)      // state: { a: TypeA }
  .add('b', stepB)      // state: { a: TypeA, b: TypeB }
  .add('c', createStep<TypeC, TypeD, { a: TypeA; b: TypeB }>(
    'c',
    async ({ state }) => {
      // TypeScript knows state.a and state.b exist!
      return state.a + state.b;
    }
  ));
```

### ❌ Invalid: Referencing non-existent steps

```typescript
Pipeline.start<string>()
  .add('a', stepA)
  .add('b', createStep<TypeA, TypeB, { nonexistent: TypeX }>(
    'b',
    async ({ state }) => {
      return state.nonexistent;  // TypeScript error: property doesn't exist!
    }
  ));
```

### ❌ Invalid: Duplicate step names

```typescript
Pipeline.start<string>()
  .add('step1', stepA)
  .add('step1', stepB);  // TypeScript error: duplicate key 'step1'!
```

## Runtime Context

You can provide additional runtime context to all steps:

```typescript
interface MyContext {
  userId: string;
  apiKey: string;
}

const pipeline = Pipeline.start<string, MyContext>(() => ({
  userId: 'user-123',
  apiKey: process.env.API_KEY
}))
  .add('step1', createStep<string, number, {}, MyContext>(
    'step1',
    async ({ input, context }) => {
      console.log(`Processing for user: ${context.userId}`);
      return input.length;
    }
  ));
```

## Retry Configuration

Steps can specify retry behavior:

```typescript
const step = createStep<string, number>(
  'retryable',
  async ({ input }) => {
    return await unreliableOperation(input);
  },
  {
    retry: {
      maxAttempts: 3,
      backoffMs: 1000,
      retryableErrors: ['ECONNRESET', 'ETIMEDOUT']
    }
  }
);
```

## Execution and Results

```typescript
const result = await pipeline.execute(initialInput);

if (result.success) {
  console.log('Result:', result.data);
  console.log('Metadata:', result.metadata);
} else {
  console.error('Error:', result.error);
  console.error('Metadata:', result.metadata);
}
```

## Type Inference

The best practice is to let TypeScript infer types when possible:

```typescript
// ✅ Good: Minimal type annotations
const pipeline = Pipeline.start<string>()
  .add('step1', createStep('step1', async ({ input }) => {
    return input.length;  // TypeScript infers number
  }))
  .add('step2', createStep('step2', async ({ input, state }) => {
    // TypeScript knows input is number
    // TypeScript knows state.step1 is number
    return input > state.step1;
  }));

// ❌ Less ideal: Explicit types (only needed when referencing earlier steps)
const pipeline = Pipeline.start<string>()
  .add('step1', createStep<string, number>('step1', async ({ input }) => {
    return input.length;
  }))
  .add('step2', createStep<number, boolean, { step1: number }>('step2', async ({ input, state }) => {
    return input > state.step1;
  }));
```

## Benefits

1. **No Hidden Dependencies** - All step dependencies are explicit in the type signature
2. **Refactoring Safety** - Renaming or removing steps causes compile errors
3. **IDE Support** - Full autocomplete for state properties
4. **Self-Documenting** - Types serve as documentation
5. **Runtime Validation** - TypeScript ensures correctness before execution

## Documentation

### Guides
- [Pipeline Patterns Guide](./docs/PIPELINE_PATTERNS.md) - 20+ common patterns and best practices
- [Migration Guide](./docs/MIGRATION_GUIDE.md) - Migrate existing code with before/after examples
- [Troubleshooting Guide](./docs/TROUBLESHOOTING.md) - Common issues and solutions
- [Testing & Performance](./TESTING.md) - Comprehensive test coverage and benchmarks

### Examples
- [Data Transformation](./examples/01-data-transformation.ts) - Basic transformation patterns
- [Web Scraping](./examples/02-web-scraping.ts) - Parallel web scraping with error handling
- [Batch Processing](./examples/03-batch-processing.ts) - Efficient batch API calls

### Code Reference
- `types.ts` - Core type definitions
- `builder.ts` - Pipeline builder implementation
- `steps.ts` - Step factory helpers
- `list-adapters.ts` - List operation adapters
- `list-types.ts` - List operation type definitions
- `registry.ts` - Pipeline registry for reusable pipelines

## Performance

Based on comprehensive benchmarks (see [TESTING.md](./TESTING.md)):

- **Parallel Execution:** 3-10x faster for I/O-bound operations
- **Batching:** 3-5x reduction in API calls
- **Scalability:** Tested up to 10,000 items with no degradation
- **Memory:** <5MB overhead for 10,000 items
- **Test Coverage:** >95% code coverage, 121 tests, 420 assertions
