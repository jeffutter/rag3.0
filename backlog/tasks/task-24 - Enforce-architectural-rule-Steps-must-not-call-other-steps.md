---
id: task-24
title: 'Enforce architectural rule: Steps must not call other steps'
status: To Do
assignee: []
created_date: '2025-12-22 16:43'
labels:
  - architecture
  - refactoring
  - technical-debt
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Currently, the codebase has violations where steps call other steps directly. This creates tight coupling and makes it difficult to reuse logic outside of the pipeline context.

### Current Violations

In `src/workflows/embed-documents.ts`:
1. **processFileStep** (lines 106-178) calls:
   - `readFileStep.execute()` (line 117)
   - `cleanMarkdownStep.execute()` (line 131)
   - `splitMarkdownStep.execute()` (line 148)

2. **addEOTToChunkStep** (lines 183-224) calls:
   - `addEOTStep.execute()` (line 196)

3. **embedBatchStep** (lines 229-280) calls:
   - `generateEmbeddingsStep.execute()` (line 240)

## Architectural Rule

**Steps may not call other steps directly.**

- Workflows may compose multiple steps
- Steps may not call steps
- Common code should be extracted into utility functions and reused

## Solution Approach

1. Extract core logic from steps into pure utility functions
2. Refactor steps to be thin wrappers around utility functions
3. Update workflows to use steps directly or utility functions
4. Add documentation and linting to prevent future violations

This is a parent task that tracks several sub-tasks for the complete refactoring.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 No steps call other steps anywhere in the codebase
- [ ] #2 All common logic is extracted into reusable utility functions
- [ ] #3 Documentation clearly states the architectural rule
- [ ] #4 Linting or testing prevents future violations
- [ ] #5 All existing workflows continue to work correctly
<!-- AC:END -->
