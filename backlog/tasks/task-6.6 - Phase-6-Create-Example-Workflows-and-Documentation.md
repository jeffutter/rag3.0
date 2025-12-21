---
id: task-6.6
title: 'Phase 6: Create Example Workflows and Documentation'
status: To Do
assignee: []
created_date: '2025-12-21 14:22'
updated_date: '2025-12-21 14:22'
labels:
  - documentation
  - examples
  - pipeline
dependencies:
  - task-6.5
parent_task_id: task-6
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Demonstrate the new architecture with multiple examples and update existing workflows.

This is Phase 6 of the pipeline architecture refactoring (parent: task-6).

## Goals

- Create 3+ example workflows demonstrating new patterns
- Review and potentially refactor rag-query workflow
- Update documentation with new API and patterns
- Create migration guide for existing code

## Details

### 6.1 Create Example Workflows
- Example 1: Simple map/filter pipeline (data transformation)
- Example 2: Web scraping workflow (parallel fetching + processing)
- Example 3: Batch processing workflow (demonstrates batch/flatten)
- Add examples to `src/core/pipeline/examples/` directory

### 6.2 Update rag-query Workflow (if applicable)
- Review `rag-query.ts` for opportunities to use new patterns
- Refactor if beneficial, otherwise leave as-is

### 6.3 Update Pipeline Documentation
- Update main README with new pipeline patterns
- Add API documentation for new methods (map, flatMap, batch, etc.)
- Create migration guide for existing workflows
- Add architecture decision record (ADR) explaining the design
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 At least 3 example workflows in src/core/pipeline/examples/
- [ ] #2 Example 1: Data transformation with map/filter
- [ ] #3 Example 2: Parallel web scraping workflow
- [ ] #4 Example 3: Batch processing with batch/flatten
- [ ] #5 rag-query workflow reviewed and updated if beneficial
- [ ] #6 README updated with new pipeline patterns and examples
- [ ] #7 API documentation for all new methods (JSDoc)
- [ ] #8 Migration guide created for refactoring existing workflows
- [ ] #9 ADR document explaining architectural decisions
<!-- AC:END -->
