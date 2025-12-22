---
id: task-23
title: Review all workflows for step-calling-step violations
status: Done
assignee: []
created_date: '2025-12-22 16:42'
updated_date: '2025-12-22 16:59'
labels:
  - audit
  - architecture
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Objective

Audit all workflows (not just embed-documents) to identify any other locations where steps call other steps.

## Workflows to Review

1. ✅ `src/workflows/embed-documents.ts` - Already identified violations
2. ⬜ `src/workflows/rag-query.ts` - Check for violations
3. ⬜ Any other workflow files

## Areas to Check

- Custom steps created within workflows that call other steps
- Adapter patterns similar to those in embed-documents
- Any `.execute()` calls on steps outside of the pipeline executor

## Pattern to Look For

```typescript
// This is a violation if it appears in a step
const result = await someStep.execute({
  input: ...,
  state: {},
  context: undefined
});
```

## Output

Document all violations found with:
- File path and line number  
- Which step is calling which other step
- Suggested refactoring approach

Create additional tickets if significant violations are found in other workflows.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All workflow files have been reviewed
- [x] #2 All violations documented with file:line references
- [x] #3 Refactoring approach documented for each violation
- [ ] #4 Additional tickets created if needed for other workflows
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Audit Complete

**Total Violations Found: 8** (all in embed-documents.ts)

### Violations Summary:
1. processFileStep → readFileStep (lines 117-121)
2. processFileStep → cleanMarkdownStep (lines 131-138)
3. processFileStep → splitMarkdownStep (lines 148-159)
4. addEOTToChunkStep → addEOTStep (lines 196-203)
5. embedBatchStep → generateEmbeddingsStep (lines 240-248)
6. processFileAdapter → processFileStep (lines 318-329)
7. addEOTAdapter → addEOTToChunkStep (lines 347-356)
8. embedBatchAdapter → embedBatchStep (lines 378-388)

### Key Findings:
- All standalone step files are CLEAN
- rag-query.ts workflow is CLEAN
- Only embed-documents.ts has violations
- Pattern: Adapter steps that wrap other steps by calling .execute()

### Refactoring Strategy:
1. Extract core logic from each base step (readFile, cleanMarkdown, splitMarkdown, addEOT, generateEmbeddings) into utility functions
2. Remove the 3 adapter steps (processFileStep, addEOTToChunkStep, embedBatchStep)
3. Update the pipeline to compose the base steps directly
4. Simplify the inline adapter steps or remove them
<!-- SECTION:NOTES:END -->
