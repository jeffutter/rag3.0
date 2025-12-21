---
id: task-2
title: Create unit tests for Clean Markdown utility
status: To Do
assignee: []
created_date: '2025-12-21 03:43'
updated_date: '2025-12-21 03:43'
labels: []
dependencies:
  - task-1
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create comprehensive unit tests for the Clean Markdown utility step using Bun's built-in test runner.

The project currently has a test script configured (`bun test`) but no actual test files using Bun's testing framework. This task will establish the pattern for testing utility steps.

Test coverage should include:
- Heading removal (with content until next heading of same/higher level)
- Text formatting removal (bold, italic, strikethrough)
- Tag parsing from frontmatter (empty string, comma-separated, array formats)
- Preservation of links and inline code
- Configurable headings list
- Edge cases (empty content, no frontmatter, nested headings, etc.)

Use Bun's built-in test runner which provides `test()`, `describe()`, and `expect()` similar to Jest/Vitest but with zero configuration and faster performance.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Test file created at src/steps/utilities/clean-markdown.test.ts
- [ ] #2 Tests verify heading removal removes heading AND content until next same/higher level heading
- [ ] #3 Tests verify all default headings from the list are removed correctly
- [ ] #4 Tests verify custom headings list can be passed and works correctly
- [ ] #5 Tests verify text formatting removal (bold, italic, strikethrough) while preserving text content
- [ ] #6 Tests verify links and inline code are preserved (not removed)
- [ ] #7 Tests verify tag parsing handles empty strings correctly
- [ ] #8 Tests verify tag parsing handles comma-separated string format
- [ ] #9 Tests verify tag parsing handles array format from frontmatter
- [ ] #10 Tests verify behavior with no frontmatter present
- [ ] #11 Tests verify behavior with empty markdown content
- [ ] #12 Tests verify nested heading scenarios
- [ ] #13 All tests pass when running 'bun test'
- [ ] #14 Test file follows Bun test runner conventions (describe, test, expect)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Testing Approach

Use Bun's built-in test runner which is already configured in package.json:
```json
"scripts": {
  "test": "bun test"
}
```

## Test File Structure

```typescript
import { describe, test, expect } from "bun:test";
import { createCleanMarkdownStep } from "./clean-markdown";

describe("Clean Markdown Utility", () => {
  describe("Heading Removal", () => {
    test("removes heading and content until next same-level heading", async () => {
      // Test implementation
    });
    
    test("removes heading and content until next higher-level heading", async () => {
      // Test implementation
    });
    
    test("removes all default headings", async () => {
      // Test implementation
    });
    
    test("supports custom headings list", async () => {
      // Test implementation
    });
  });
  
  describe("Text Formatting Removal", () => {
    test("removes bold formatting while preserving text", async () => {
      // Test implementation
    });
    
    test("removes italic formatting while preserving text", async () => {
      // Test implementation
    });
    
    test("removes strikethrough formatting while preserving text", async () => {
      // Test implementation
    });
  });
  
  describe("Link and Code Preservation", () => {
    test("preserves links", async () => {
      // Test implementation
    });
    
    test("preserves inline code", async () => {
      // Test implementation
    });
  });
  
  describe("Tag Parsing", () => {
    test("handles empty string tags", async () => {
      // Test implementation
    });
    
    test("handles comma-separated string tags", async () => {
      // Test implementation
    });
    
    test("handles array format tags", async () => {
      // Test implementation
    });
    
    test("handles missing tags field", async () => {
      // Test implementation
    });
  });
  
  describe("Edge Cases", () => {
    test("handles empty content", async () => {
      // Test implementation
    });
    
    test("handles content without frontmatter", async () => {
      // Test implementation
    });
    
    test("handles nested headings correctly", async () => {
      // Test implementation
    });
  });
});
```

## Test Data Examples

Example markdown with frontmatter:
```markdown
---
tags: "tag1, tag2, tag3"
title: "Test Document"
---

# Introduction
Some content here

## Project List
This should be removed
And this content too

## Normal Section
This should stay
```

## Running Tests

```bash
bun test                    # Run all tests
bun test clean-markdown     # Run specific test file
bun test --watch            # Watch mode
```

## Key Testing Considerations

1. **Pipeline integration**: Since this is a pipeline step, tests should call the step's `execute()` method with proper context
2. **Type safety**: Verify input/output types match the defined schemas
3. **Async handling**: All step executions are async, use `await` properly
4. **Success/failure results**: Check both `StepResult` success and failure cases
5. **Reference the n8n code**: Use the behavior from task-1's reference implementation to guide expected outputs
<!-- SECTION:PLAN:END -->
