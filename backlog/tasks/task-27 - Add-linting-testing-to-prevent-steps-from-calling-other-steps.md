---
id: task-27
title: Add linting/testing to prevent steps from calling other steps
status: To Do
assignee: []
created_date: '2025-12-22 16:44'
labels:
  - tooling
  - architecture
  - testing
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Objective

Create automated checks to prevent future violations where steps call other steps.

## Approach Options

### Option 1: Custom ESLint Rule
Create a custom ESLint rule that detects when a step file imports and calls another step.

Rules to detect:
- Import statements in `src/steps/**/*.ts` that import from other step files
- Calls to `.execute()` on imported steps
- Exclude test files from this rule

### Option 2: Grep-based Pre-commit Check
Create a pre-commit hook or CI check that searches for violations:
```bash
# Check for step imports in step files
grep -r "from.*steps.*Step" src/steps --exclude="*.test.ts"

# Check for .execute() calls in step files  
grep -r "Step\.execute" src/steps --exclude="*.test.ts"
```

### Option 3: Unit Test Validation
Create a test that validates the architectural rule:
```typescript
describe("Architecture Rules", () => {
  it("steps should not import other steps", async () => {
    const stepFiles = await glob("src/steps/**/*.ts", { ignore: "**/*.test.ts" });
    for (const file of stepFiles) {
      const content = await readFile(file);
      expect(content).not.toMatch(/import.*from.*steps.*Step/);
      expect(content).not.toMatch(/Step\.execute\(/);
    }
  });
});
```

### Option 4: TypeScript Type-level Enforcement
Explore if we can use TypeScript types to make it impossible to call step.execute() outside of pipeline context.

## Recommendation

Implement **Option 3** (unit test validation) first as it's easiest to set up, then consider Option 1 (ESLint) for better developer experience.

## Testing

- Verify the check catches the current violations
- Verify the check passes after refactoring
- Test with intentional violations to ensure it catches them
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Automated check detects when steps call other steps
- [ ] #2 Check runs in CI/CD pipeline
- [ ] #3 Check passes on refactored codebase
- [ ] #4 False positives are minimized
- [ ] #5 Developer gets clear error message when violation is detected
<!-- AC:END -->
