---
id: task-26
title: Refactor embed-documents workflow to eliminate adapter steps
status: To Do
assignee: []
created_date: '2025-12-22 16:44'
labels:
  - refactoring
  - architecture
  - workflow
dependencies:
  - task-21
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Objective

Remove the three adapter steps (processFileStep, addEOTToChunkStep, embedBatchStep) from the embed-documents workflow and restructure to use either steps directly or utility functions.

## Current Violations to Fix

1. **processFileStep** - Remove and replace with direct step composition or utility functions
2. **addEOTToChunkStep** - Remove and replace with direct step usage or utility function
3. **embedBatchStep** - Remove and replace with direct step usage or utility function

## Approach Options

### Option 1: Use Pipeline Composition
```typescript
// Use pipeline's built-in composition features to chain steps
pipeline
  .add("read", readFileStep)
  .add("clean", cleanMarkdownStep)
  .add("split", splitMarkdownStep)
  // etc.
```

### Option 2: Use Utility Functions in Workflow
```typescript
// Create a single workflow step that uses utility functions
const processFileWorkflow = createStep("processFile", async ({ input }) => {
  const content = await readFile(input.path);
  const cleaned = cleanMarkdown(content.content, input.headingsToRemove);
  const chunks = splitMarkdown(cleaned.content, content.source, ...);
  return chunks;
});
```

### Option 3: Hybrid Approach
Use steps where appropriate in the pipeline, and utility functions for custom workflow-specific logic.

## Decision Required

Analyze which approach works best for the embed-documents workflow and implement accordingly. The key constraint is: **no step may call another step**.

## Testing

- Ensure all existing embed-documents tests pass
- Verify the workflow produces identical results
- Add integration tests if needed
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All adapter steps removed from embed-documents workflow
- [ ] #2 Workflow uses either steps directly or utility functions
- [ ] #3 No step calls another step
- [ ] #4 All workflow tests pass
- [ ] #5 Workflow produces same results as before
<!-- AC:END -->
