---
id: task-22
title: Add architectural documentation and guidelines for steps vs utilities
status: Done
assignee: []
created_date: '2025-12-22 16:42'
updated_date: '2025-12-22 17:23'
labels:
  - documentation
  - architecture
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Objective

Document the architectural rule that steps must not call other steps, and provide clear guidelines for when to use steps vs utility functions.

## Documentation to Create/Update

### 1. Update CLAUDE.md
Add a new section on pipeline architecture:
```markdown
## Pipeline Architecture

### Steps vs Utility Functions

**Rule: Steps must not call other steps.**

- **Steps** are pipeline building blocks that can be composed in workflows
- **Utility Functions** contain reusable business logic
- **Workflows** compose multiple steps together

### When to Create a Step
- The operation will be used in multiple workflows
- The operation needs schema validation and error handling
- The operation should appear as a distinct pipeline stage

### When to Create a Utility Function
- The logic needs to be shared between steps
- The logic needs to be used outside of pipelines
- The logic is a pure transformation or calculation

### Anti-Pattern: Adapter Steps
❌ Do not create steps that call other steps:
```typescript
// BAD - Step calling another step
const badStep = createStep("bad", async ({ input }) => {
  const result = await otherStep.execute({ input, state: {}, context: undefined });
  return result.data;
});
```

✅ Instead, extract shared logic to utility functions:
```typescript
// GOOD - Step using utility function
const goodStep = createStep("good", async ({ input }) => {
  return await utilityFunction(input);
});
```
```

### 2. Create Architecture Documentation
Create `docs/architecture/steps-and-workflows.md`:
- Explain the step/workflow/utility separation
- Provide examples of correct patterns
- Explain why the rule exists (loose coupling, testability, reusability)
- Show how to compose steps in workflows

### 3. Add JSDoc to createStep
Add warnings in the createStep documentation about not calling other steps.

## Examples to Include

Provide clear examples of:
1. A simple step using a utility function
2. A complex workflow composing multiple steps
3. When to extract logic to a utility function
4. How to test steps vs utility functions
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 CLAUDE.md updated with pipeline architecture section
- [x] #2 Architecture documentation created in docs/
- [x] #3 Clear examples provided for steps, utilities, and workflows
- [x] #4 Guidelines explain when to use each pattern
- [x] #5 Anti-patterns are clearly documented
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Documentation Complete

### Files Created/Updated:
1. **CLAUDE.md** - Added Pipeline Architecture section with:
   - Clear rule: Steps must not call other steps
   - Component types (steps, utilities, workflows)
   - When to use each pattern
   - Anti-pattern and good pattern examples
   - Practical examples from codebase

2. **docs/architecture/steps-and-workflows.md** - Comprehensive guide with:
   - Three-layer architecture overview
   - The Golden Rule explanation
   - Why this architecture (benefits)
   - Decision framework
   - Extensive examples
   - Testing strategies
   - Migration guide

3. **src/core/pipeline/steps.ts** - Enhanced JSDoc with:
   - Bold warning about step-calling-step
   - Link to architecture docs
   - Good and bad examples

### All acceptance criteria met:
- ✓ CLAUDE.md updated
- ✓ Architecture documentation created
- ✓ Clear examples provided
- ✓ Guidelines for patterns
- ✓ Anti-patterns documented
<!-- SECTION:NOTES:END -->
