---
id: task-6.5
title: 'Phase 5: Refactor embed-documents Workflow to Declarative Pipeline'
status: In Progress
assignee: []
created_date: '2025-12-21 14:22'
updated_date: '2025-12-21 22:36'
labels:
  - workflow
  - refactoring
  - embedding
dependencies:
  - task-6.4
parent_task_id: task-6
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Refactor the embed-documents workflow to use declarative pipeline composition with zero manual loops.

This is Phase 5 of the pipeline architecture refactoring (parent: task-6).

## Goals

- Eliminate all manual loops from embed-documents workflow
- Convert to fully declarative pipeline using map/flatMap/batch/flatten
- Ensure error handling matches or exceeds current behavior
- Maintain or improve performance

## Details

### 5.1 Refactor embed-documents.ts
- Remove all manual loops (for files, for batches)
- Replace with declarative pipeline:
  ```typescript
  Pipeline.start<Config>()
    .add('discover', discoverFilesStep)
    .map('read', readFileStep, { parallel: true })
    .map('clean', cleanMarkdownStep)
    .flatMap('split', splitMarkdownStep)
    .flatten('flattenChunks')
    .add('addEOT', addEOTStep)
    .batch('batch', config.batchSize)
    .map('embed', generateEmbeddingsStep)
    .flatten('flattenResults')
    .add('format', formatOutputStep)
  ```
- Update step signatures as needed
- Ensure error handling matches current behavior

### 5.2 Update Individual Steps
- Verify `discoverFilesStep` works as-is (returns array)
- Update `readFileStep` if needed to accept `{ path: string }`
- Update `cleanMarkdownStep` to match expected input/output
- Update `splitMarkdownStep` to match expected input/output
- Create `addEOTStep` for adding end-of-text tokens
- Update `generateEmbeddingsStep` to work with batched input
- Create `formatOutputStep` to build final result

### 5.3 Workflow Tests
- Ensure all existing `embed-documents.test.ts` tests pass
- Add new tests for error scenarios with list operations
- Add integration test comparing old vs new implementation results
- Performance test: ensure new implementation is competitive
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 embed-documents.ts has zero manual for loops
- [ ] #2 Workflow is fully declarative using pipeline methods
- [ ] #3 All existing tests in embed-documents.test.ts pass
- [ ] #4 Error handling behavior matches or exceeds previous implementation
- [ ] #5 addEOTStep created and integrated
- [ ] #6 formatOutputStep created and integrated
- [ ] #7 Integration test verifies output matches previous implementation
- [ ] #8 Performance test shows competitive or better performance
- [ ] #9 Code is more readable and maintainable than before
<!-- AC:END -->
