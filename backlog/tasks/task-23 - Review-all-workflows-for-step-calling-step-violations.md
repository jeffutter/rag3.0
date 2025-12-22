---
id: task-23
title: Review all workflows for step-calling-step violations
status: To Do
assignee: []
created_date: '2025-12-22 16:42'
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
- [ ] #1 All workflow files have been reviewed
- [ ] #2 All violations documented with file:line references
- [ ] #3 Refactoring approach documented for each violation
- [ ] #4 Additional tickets created if needed for other workflows
<!-- AC:END -->
