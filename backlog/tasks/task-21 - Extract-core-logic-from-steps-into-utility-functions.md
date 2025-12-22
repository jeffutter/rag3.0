---
id: task-21
title: Extract core logic from steps into utility functions
status: To Do
assignee: []
created_date: '2025-12-22 16:42'
labels:
  - refactoring
  - architecture
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Objective

Create a new `src/lib/` or `src/core/processing/` directory containing pure utility functions that implement the core business logic currently embedded in steps.

## Functions to Extract

### File I/O Functions (`src/lib/file-io.ts` or similar)
- `readFile(path: string): Promise<{content: string, source: string}>`
- `discoverFiles(path: string, pattern?: string): Promise<FileEntry[]>`

### Markdown Processing Functions (`src/lib/markdown.ts`)
- `cleanMarkdown(content: string, headingsToRemove?: string[]): {content: string, tags: string[], frontmatter?: Record<string, any>}`
- `splitMarkdown(content: string, source: string, metadata: Record<string, any>, options: {minChunkSize, maxChunkSize, chunkOverlap}): Chunk[]`

### Text Processing Functions (`src/lib/text-processing.ts`)
- `addEOT(content: string, eotToken?: string): string`
- `batchItems<T>(items: T[], batchSize: number): T[][]`

### AI/Embedding Functions (`src/lib/embeddings.ts`)
- `generateEmbeddings(contents: string[], endpoint: string, model: string): Promise<{embedding: number[]}[]>`

## Design Principles

- Functions should be pure where possible (no side effects except I/O)
- Functions should have explicit type signatures
- Functions should not depend on the pipeline context
- Functions should be easily testable in isolation
- Error handling should use standard throw/try-catch (not Result types)

## Testing

- Move existing step tests to test the utility functions directly
- Ensure 100% coverage of utility functions
- Steps will become thin wrappers with minimal testing needed
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 New utility module(s) created with all extracted functions
- [ ] #2 All functions have proper TypeScript types
- [ ] #3 All functions have unit tests with good coverage
- [ ] #4 Functions are pure/stateless where possible
- [ ] #5 Documentation/JSDoc for each function
<!-- AC:END -->
