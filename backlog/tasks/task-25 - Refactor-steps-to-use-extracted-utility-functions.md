---
id: task-25
title: Refactor steps to use extracted utility functions
status: To Do
assignee: []
created_date: '2025-12-22 16:44'
labels:
  - refactoring
  - architecture
dependencies:
  - task-21
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Objective

Update all step definitions to be thin wrappers around the newly extracted utility functions.

## Steps to Refactor

### `src/steps/io/read-file.ts`
- Update to call `readFile()` utility function
- Keep schema validation and step wrapper

### `src/steps/io/discover-files.ts`
- Update to call `discoverFiles()` utility function
- Keep schema validation and step wrapper

### `src/steps/utilities/clean-markdown.ts`
- Update to call `cleanMarkdown()` utility function
- Keep schema validation and step wrapper

### `src/steps/utilities/split-markdown.ts`
- Update to call `splitMarkdown()` utility function
- Keep schema validation and step wrapper

### `src/steps/utilities/add-eot.ts`
- Update to call `addEOT()` utility function
- Keep schema validation and step wrapper

### `src/steps/utilities/batch-items.ts`
- Update to call `batchItems()` utility function
- Keep schema validation and step wrapper

### `src/steps/ai/generate-embeddings.ts`
- Update to call `generateEmbeddings()` utility function
- Keep schema validation and step wrapper

## Pattern

Each step should follow this pattern:
```typescript
export const myStep = createStep<Input, Output>("myStep", async ({ input }) => {
  const validated = InputSchema.parse(input);
  return await utilityFunction(validated);
});
```

## Testing

- Update step tests to verify schema validation and step wrapping
- Core logic testing happens in utility function tests
- Integration tests verify step behavior in pipelines
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All steps updated to use utility functions
- [ ] #2 Steps remain as thin wrappers with schema validation
- [ ] #3 All existing step tests pass
- [ ] #4 No step calls another step
- [ ] #5 Code is cleaner and more maintainable
<!-- AC:END -->
