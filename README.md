# RAG 3.0

A modern, type-safe RAG (Retrieval Augmented Generation) system built with Bun and TypeScript.

## Features

- **Type-Safe Pipeline System**: Compose complex workflows with compile-time type checking
- **List Operations**: Built-in support for map, filter, flatMap, batch, and flatten
- **Parallel Execution**: Process multiple items concurrently with configurable limits
- **Error Handling**: Multiple strategies (fail-fast, collect-errors, skip-failed)
- **Accumulated State**: Access outputs from any previous step in the pipeline
- **Performance Monitoring**: Built-in metrics and timing statistics

## Installation

```bash
bun install
```

## Quick Start

```bash
bun run index.ts
```

## Pipeline System

The pipeline system provides a type-safe, composable way to build data processing workflows. Each step in the pipeline receives:
- **input**: The direct output from the previous step
- **state**: All outputs from previous steps (accessible by their keys)
- **context**: Shared runtime context

### Basic Example

```typescript
import { Pipeline } from "./src/core/pipeline/builder";
import { createStep } from "./src/core/pipeline/steps";

const pipeline = Pipeline.start<string>()
  .add('uppercase', createStep('uppercase', async ({ input }) => {
    return input.toUpperCase();
  }))
  .add('addPrefix', createStep('addPrefix', async ({ input, state }) => {
    // Can access state.uppercase if needed
    return `Hello, ${input}!`;
  }));

const result = await pipeline.execute('world');
// result.data = "Hello, WORLD!"
```

### List Operations

The pipeline system includes powerful list operations for processing arrays:

#### map()

Transform each element in an array:

```typescript
const pipeline = Pipeline.start<string[]>()
  .map('uppercased',
    createStep('toUpper', async ({ input }) => input.toUpperCase()),
    { parallel: true, concurrencyLimit: 5 }
  );

// ['hello', 'world'] -> ['HELLO', 'WORLD']
```

#### filter()

Remove elements that don't match a predicate:

```typescript
const pipeline = Pipeline.start<number[]>()
  .filter('evens', (n) => n % 2 === 0);

// [1, 2, 3, 4, 5] -> [2, 4]
```

#### flatMap()

Transform each element into an array and flatten the results:

```typescript
const pipeline = Pipeline.start<string[]>()
  .flatMap('words',
    createStep('split', async ({ input }) => input.split(' ')),
    { parallel: true }
  );

// ['hello world', 'foo bar'] -> ['hello', 'world', 'foo', 'bar']
```

#### batch()

Group elements into chunks:

```typescript
const pipeline = Pipeline.start<number[]>()
  .batch('batches', 3);

// [1, 2, 3, 4, 5] -> [[1, 2, 3], [4, 5]]
```

#### flatten()

Flatten a nested array:

```typescript
const pipeline = Pipeline.start<number[][]>()
  .flatten('flattened');

// [[1, 2], [3, 4]] -> [1, 2, 3, 4]
```

### Error Handling

Control how errors are handled in list operations:

```typescript
import { ListErrorStrategy } from "./src/core/pipeline/list-adapters";

// Stop on first error
.map('step1', myStep, { errorStrategy: ListErrorStrategy.FAIL_FAST })

// Collect all errors but continue processing
.map('step2', myStep, { errorStrategy: ListErrorStrategy.COLLECT_ERRORS })

// Skip failed items, return only successes
.map('step3', myStep, { errorStrategy: ListErrorStrategy.SKIP_FAILED })
```

### Parallel Execution

Process list items in parallel with configurable concurrency:

```typescript
.map('fetchPages', fetchPageStep, {
  parallel: true,
  concurrencyLimit: 10, // Process 10 items at a time
  errorStrategy: ListErrorStrategy.SKIP_FAILED
})
```

### Accessing Previous Steps

Each step can access outputs from any previous step via the accumulated state:

```typescript
const pipeline = Pipeline.start<string>()
  .add('embed', embedStep)
  .add('search', searchStep)
  .add('rerank', createStep('rerank', async ({ input, state }) => {
    // input is the search results from the previous step
    // state.embed contains the embedding from the 'embed' step
    // state.search contains the search results
    return rerank(input, state.embed.text);
  }));
```

TypeScript validates at compile-time that:
- Referenced steps exist
- Step names are unique
- Types match between steps

## Examples

The project includes comprehensive examples demonstrating different patterns:

### Example 1: Data Transformation

Process and filter user records with parallel map operations.

```bash
bun run src/core/pipeline/examples/01-data-transformation.ts
```

**Features demonstrated:**
- filter() for data cleaning
- map() with parallel execution
- Accessing previous step outputs

### Example 2: Web Scraping

Parallel web scraping with link extraction.

```bash
bun run src/core/pipeline/examples/02-web-scraping.ts
```

**Features demonstrated:**
- Parallel fetching with concurrency limits
- flatMap() for link extraction
- Error handling with SKIP_FAILED strategy
- Context usage for configuration

### Example 3: Batch Processing

Efficient batch processing with embeddings generation.

```bash
bun run src/core/pipeline/examples/03-batch-processing.ts
```

**Features demonstrated:**
- batch() for chunking data
- Parallel batch processing
- flatten() to recombine results
- Performance metrics collection

### Run All Examples

```bash
bun run src/core/pipeline/examples/index.ts
```

## Architecture

See [docs/adr/001-pipeline-architecture.md](docs/adr/001-pipeline-architecture.md) for detailed architectural decisions.

## Migration Guide

Migrating from old workflows to the new pipeline API? See [docs/migration-guide.md](docs/migration-guide.md).

## API Documentation

For detailed API documentation, see:
- [Pipeline Builder API](src/core/pipeline/builder.ts) - JSDoc comments in source
- [List Adapters API](src/core/pipeline/list-adapters.ts) - JSDoc comments in source
- [Step Creation](src/core/pipeline/steps.ts) - JSDoc comments in source

## Project Structure

```
src/
├── core/
│   └── pipeline/
│       ├── builder.ts          # Pipeline builder with list operations
│       ├── types.ts            # Core type definitions
│       ├── steps.ts            # Step creation utilities
│       ├── list-adapters.ts    # List operation adapters
│       └── examples/           # Example workflows
│           ├── 01-data-transformation.ts
│           ├── 02-web-scraping.ts
│           └── 03-batch-processing.ts
├── workflows/                  # Production workflows
│   ├── rag-query.ts           # RAG query pipeline
│   └── embed-documents.ts     # Document embedding pipeline
└── ...
```

## Testing

Run the test suite:

```bash
bun test
```

## License

This project was created using `bun init` in bun v1.3.4. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
