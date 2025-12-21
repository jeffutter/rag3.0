---
id: task-1
title: Add utility steps infrastructure and Clean Markdown utility
status: To Do
assignee: []
created_date: '2025-12-21 03:39'
updated_date: '2025-12-21 04:12'
labels: []
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a new category of pipeline steps called "utility steps" that provide reusable utilities for workflows without requiring LLM calls or external system interactions.

Create the infrastructure:
- Add a dedicated folder for utility steps
- Create the first utility: Clean Markdown

The Clean Markdown utility should clean up markdown files for use in LLM context or embeddings by:
- Removing specified heading sections and their content (heading + all content until next heading of same/higher level)
- Removing formatting (bold, italic, strikethrough) while preserving text
- Parsing frontmatter to extract tags (handles both comma-separated string and array formats)
- Processing the markdown content through remark plugins

Default headings to remove: Project List, Due Today, Todoist Tasks, Daily Reading, Completed Today, Habit, Jira Tickets, Task, Bullet, File

Note: Link and inline code formatting removal are intentionally excluded (these were commented out in the reference implementation)

This is based on an existing n8n workflow that needs to be adapted to work with our pipeline system's step architecture.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Utility steps folder structure is created at src/steps/utilities/
- [ ] #2 Clean Markdown utility is implemented as a pipeline step following the Step<TInput, TOutput> interface
- [ ] #3 Required dependencies (remark, unist-util-visit, gray-matter) are added to package.json
- [ ] #4 Heading removal removes the heading AND all content until next heading of same/higher level
- [ ] #5 Default headings list matches reference: Project List, Due Today, Todoist Tasks, Daily Reading, Completed Today, Habit, Jira Tickets, Task, Bullet, File
- [ ] #6 Headings to remove can be configured via step input parameter
- [ ] #7 Text formatting removal handles emphasis (italic), strong (bold), and delete (strikethrough) while preserving text content
- [ ] #8 Links and inline code formatting are preserved (not removed)

- [ ] #9 Tag parsing handles empty strings, comma-separated strings, and array formats from frontmatter
- [ ] #10 Input and output types are properly defined with Zod schemas for type safety
- [ ] #11 The utility can be used in workflows like any other pipeline step
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Reference Implementation

The following n8n script provides the reference behavior to adapt:

```javascript
const { remark } = require('remark');
const { visit } = require('unist-util-visit');
const matter = require('gray-matter');

function removeHeadings(headingsToRemove) {
  return (tree) => {
    const indicesToRemove = [];

    visit(tree, (node, index, parent) => {
      if (node.type === 'heading' && index !== null && parent) {
        // Get the heading text
        const headingText = node.children
          .filter(child => child.type === 'text')
          .map(child => child.value)
          .join('');

        // Check if this heading should be removed
        if (headingsToRemove.includes(headingText)) {
          // Find the range to remove (heading + all content until next heading of same/higher level)
          const startIndex = index;
          let endIndex = index;

          for (let i = index + 1; i < parent.children.length; i++) {
            const nextNode = parent.children[i];
            if (nextNode.type === 'heading' && nextNode.depth <= node.depth) {
              break;
            }
            endIndex = i;
          }

          indicesToRemove.push({ startIndex, endIndex });
        }
      }
    });

    // Remove sections in reverse order to maintain correct indices
    indicesToRemove.reverse().forEach(({ startIndex, endIndex }) => {
      tree.children.splice(startIndex, endIndex - startIndex + 1);
    });
  };
}

function removeFormatting() {
  return (tree) => {
    visit(tree, (node, index, parent) => {
      // Remove emphasis (italic), strong (bold), delete (strikethrough)
      if (node.type === 'emphasis' ||
          node.type === 'strong' ||
          node.type === 'delete') {
        if (parent && index !== null) {
          // Replace the formatting node with its children (the text content)
          parent.children.splice(index, 1, ...node.children);
          return [visit.SKIP, index];
        }
      }

      // Convert links to just their text content (removes the URL)
      // if (node.type === 'link') {
      //   if (parent && index !== null) {
      //     parent.children.splice(index, 1, ...node.children);
      //     return [visit.SKIP, index];
      //   }
      // }

      // Remove inline code formatting but keep the text
      // if (node.type === 'inlineCode') {
      //   if (parent && index !== null) {
      //     parent.children.splice(index, 1, {
      //       type: 'text',
      //       value: node.value
      //     });
      //     return [visit.SKIP, index];
      //   }
      // }
    });
  };
}

const content = $input.item.json.content;
const parsed = matter(content);

const modified = await remark()
  .use(removeHeadings, [
    'Project List',
    'Due Today',
    'Todoist Tasks',
    'Daily Reading',
    'Completed Today',
    'Habit',
    'Jira Tickets',
    'Task',
    'Bullet',
    'File'
  ])
  .use(removeFormatting)
  .process(parsed.content);

let tags = [];

if (parsed.data.tags) {
  if (typeof parsed.data.tags == "string") {
    if (parsed.data.tags == "" ) {
      tags = [];
    } else {
      tags = parsed.data.tags.split(',').map(i => i.trim());
    }
  } else {
    tags = parsed.data.tags;
  }
} else {
  tags = [];
}

return {
  json: {
    ... item.json.data,
    tags: tags,
    content: modified.value
  }
}
```

## Implementation Approach

1. **Create folder structure**: `src/steps/utilities/`
2. **Install dependencies**: `bun add remark unist-util-visit gray-matter`
3. **Adapt to pipeline system**:
   - Define proper Input/Output types for the step
   - Input should include: content (string), headingsToRemove (optional string[]), and any additional frontmatter to preserve
   - Output should include: content (cleaned markdown string), tags (string[]), and any other frontmatter data
   - Use `createStep` helper from `src/core/pipeline/steps.ts`
4. **Port the remark plugins**: Convert removeHeadings and removeFormatting functions to work with our system
5. **Handle tag parsing**: Implement the tag parsing logic that handles both string (comma-separated) and array formats from frontmatter
6. **Make configurable**: Allow headingsToRemove to be passed as a parameter, with the original list as default

## Key Behaviors to Preserve

- **Heading removal**: Remove the heading AND all content until the next heading of same or higher level (not just the heading itself)
- **Tag parsing**: Handle empty strings, comma-separated strings, and arrays from frontmatter
- **Formatting removal**: Remove emphasis, strong, and delete nodes while preserving their text children
- **Do NOT remove**: Links and inline code (these were intentionally excluded in the reference)

## Enhanced Implementation Details

### Pipeline Integration Pattern

Based on the existing pipeline infrastructure in src/core/pipeline/, the Clean Markdown step should:

1. **Use the `createStep` helper** from src/core/pipeline/steps.ts:
```typescript
import { createStep } from '../../core/pipeline/steps';
import type { StepResult } from '../../core/pipeline/types';
import { z } from 'zod';
```

2. **Define Zod schemas for input/output**:
```typescript
const CleanMarkdownInputSchema = z.object({
  content: z.string(),
  headingsToRemove: z.array(z.string()).optional().default([
    'Project List', 'Due Today', 'Todoist Tasks', 'Daily Reading',
    'Completed Today', 'Habit', 'Jira Tickets', 'Task', 'Bullet', 'File'
  ])
});

const CleanMarkdownOutputSchema = z.object({
  content: z.string(),
  tags: z.array(z.string()),
  frontmatter: z.record(z.any()).optional()
});

type CleanMarkdownInput = z.infer<typeof CleanMarkdownInputSchema>;
type CleanMarkdownOutput = z.infer<typeof CleanMarkdownOutputSchema>;
```

3. **Create the step using the pipeline pattern**:
```typescript
export const cleanMarkdownStep = createStep<CleanMarkdownInput, CleanMarkdownOutput>(
  'cleanMarkdown',
  async ({ input }) => {
    // Validate input
    const validated = CleanMarkdownInputSchema.parse(input);
    
    // Implementation here
    
    return {
      content: cleanedContent,
      tags: parsedTags,
      frontmatter: parsed.data
    };
  }
);
```

4. **Error handling**: The `createStep` wrapper automatically catches errors and returns proper StepResult, so focus on business logic

5. **Export pattern**: Export both the step and the schemas for testing and composition

### Dependencies Installation

```bash
bun add remark unist-util-visit gray-matter
bun add -d @types/unist
```

### File Structure to Create

```
src/steps/
  utilities/
    clean-markdown.ts      # Main implementation
    index.ts               # Barrel export
```

### Verification Steps

1. Create a simple test file to verify the step works with the pipeline system
2. Ensure the step can be imported and used in pipeline composition
3. Verify input validation works correctly
4. Test the StepResult success/failure paths
<!-- SECTION:PLAN:END -->
