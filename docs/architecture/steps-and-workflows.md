# Steps and Workflows Architecture

This document explains the architectural separation between steps, utility functions, and workflows in the RAG pipeline system.

## Table of Contents

- [Overview](#overview)
- [Component Types](#component-types)
- [The Golden Rule](#the-golden-rule)
- [Why This Architecture](#why-this-architecture)
- [Decision Framework](#decision-framework)
- [Examples](#examples)
- [Testing Strategies](#testing-strategies)
- [Migration Guide](#migration-guide)

## Overview

The pipeline architecture uses a three-layer pattern:

```
Workflows (Orchestration)
    ↓
Steps (Pipeline Integration)
    ↓
Utility Functions (Business Logic)
```

Each layer has a specific responsibility:
- **Workflows** compose steps together to achieve higher-level goals
- **Steps** integrate operations into the pipeline framework
- **Utility Functions** implement the actual business logic

## Component Types

### Steps

**Location:** `src/steps/` and inline in workflows

**Purpose:** Pipeline building blocks that integrate operations into the pipeline framework.

**Characteristics:**
- Created using `createStep(name, executeFunction, options)`
- Receive a context object with `{ input, state, context }`
- Return data that flows to the next step
- Include pipeline-specific concerns (error handling, retries, metadata)
- Should NOT call other steps
- MAY call utility functions

**Example:**
```typescript
const discoverFilesStep = createStep<DiscoverFilesInput, DiscoverFilesOutput>(
  "discoverFiles",
  async ({ input }) => {
    // Validate input
    const validated = DiscoverFilesInputSchema.parse(input);

    // Use Bun's Glob API to find files matching pattern
    const glob = new Glob(validated.pattern);
    const files: Array<{ path: string; name: string }> = [];

    for await (const file of glob.scan({
      cwd: validated.path,
      absolute: false,
    })) {
      const absolutePath = `${validated.path}/${file}`;
      const name = file.split("/").pop() || file;

      files.push({ path: absolutePath, name });
    }

    return { files };
  }
);
```

### Utility Functions

**Location:** `src/lib/`

**Purpose:** Reusable business logic that can be used across steps and workflows.

**Characteristics:**
- Pure functions (when possible) that perform specific operations
- No dependencies on pipeline infrastructure
- Can be tested independently
- Accept simple parameters and return simple results
- Examples: `readFile()`, `cleanMarkdown()`, `splitMarkdown()`, `generateEmbeddings()`

**Example:**
```typescript
// src/lib/file-io.ts
export async function readFile(path: string): Promise<FileReadResult> {
  const file = Bun.file(path);

  if (!(await file.exists())) {
    throw new Error(`File not found: ${path}`);
  }

  const content = await file.text();

  return {
    content,
    source: path,
  };
}
```

### Workflows

**Location:** `src/workflows/`

**Purpose:** Compose multiple steps together to achieve higher-level goals.

**Characteristics:**
- Use the `Pipeline` builder to chain steps
- Define the overall data flow and orchestration
- Handle workflow-level configuration and coordination
- Can call other workflows if needed
- Export a simple function interface for consumers

**Example:**
```typescript
// src/workflows/embed-documents.ts
export async function embedDocuments(config: EmbedDocumentsConfig): Promise<EmbedDocumentsOutput> {
  const validated = EmbedDocumentsConfigSchema.parse(config);

  const pipeline = Pipeline.start<{ path: string; pattern?: string }>()
    // Step 1: Discover all markdown files
    .add("discover", discoverFilesStep)

    // Step 2: Read each file
    .flatMap("readFiles",
      createStep("readFile", async ({ input }) => {
        try {
          const result = await readFile(input.path);
          return [{ ...result, path: input.path }];
        } catch (error) {
          console.warn(`Error reading file ${input.path}:`, error);
          return [];
        }
      }),
      { parallel: true }
    )

    // Step 3: Clean markdown
    .flatMap("cleanedFiles",
      createStep("cleanMarkdown", async ({ input }) => {
        try {
          const result = await cleanMarkdown(input.content, validated.headingsToRemove);
          return [{
            content: result.content,
            source: input.source,
            tags: result.tags,
            path: input.path,
          }];
        } catch (error) {
          console.warn(`Error cleaning file ${input.path}:`, error);
          return [];
        }
      }),
      { parallel: true }
    )

    // ... more steps ...

  const result = await pipeline.execute({
    path: validated.folderPath,
    pattern: validated.pattern,
  });

  if (!result.success) {
    throw new Error(`Pipeline failed: ${result.error.message}`);
  }

  return result.data;
}
```

## The Golden Rule

**Steps must NOT call other steps.**

This is the single most important architectural rule. Violating this rule creates tight coupling and defeats the purpose of the pipeline architecture.

### Anti-Pattern: Steps Calling Steps

```typescript
// ❌ BAD - Step calling another step
const readFileStep = createStep("readFile", async ({ input }) => {
  const file = Bun.file(input.path);
  const content = await file.text();
  return { content, source: input.path };
});

const cleanMarkdownStep = createStep("cleanMarkdown", async ({ input }) => {
  // Anti-pattern: step calling another step
  const fileResult = await readFileStep.execute({
    input: { path: input.path },
    state: {},
    context: undefined
  });

  if (!fileResult.success) {
    throw new Error("Failed to read file");
  }

  const cleaned = await cleanMarkdown(fileResult.data.content);
  return cleaned;
});
```

**Problems with this approach:**
1. **Tight Coupling:** `cleanMarkdownStep` is now tightly coupled to `readFileStep`
2. **Reduced Reusability:** Cannot use `cleanMarkdownStep` with content from other sources
3. **Hidden Dependencies:** The pipeline doesn't know about the dependency chain
4. **Poor Error Handling:** Error context is lost when manually executing steps
5. **Bypasses Pipeline Features:** Loses retry logic, metadata tracking, and state management

### Correct Pattern: Workflows Compose Steps

```typescript
// ✅ GOOD - Workflow composes steps
const pipeline = Pipeline.start<{ path: string }>()
  .add("readFile",
    createStep("readFile", async ({ input }) => {
      const result = await readFile(input.path);
      return result;
    })
  )
  .add("cleanMarkdown",
    createStep("cleanMarkdown", async ({ input }) => {
      const cleaned = await cleanMarkdown(input.content);
      return cleaned;
    })
  );

const result = await pipeline.execute({ path: "./docs/example.md" });
```

**Benefits of this approach:**
1. **Loose Coupling:** Each step is independent and reusable
2. **Clear Dependencies:** The pipeline explicitly shows the data flow
3. **Better Error Handling:** Pipeline tracks which step failed and why
4. **Leverages Pipeline Features:** Retries, metadata, state management all work correctly
5. **Flexible Composition:** Can easily rearrange, remove, or add steps

## Why This Architecture

### Loose Coupling

Each step is independent and doesn't know about other steps. This allows:
- Steps to be reused in different workflows
- Steps to be tested in isolation
- Changes to one step don't affect others

### Testability

The three-layer architecture enables different testing strategies:

**Utility Functions:**
- Test without any pipeline infrastructure
- Fast, pure unit tests
- Easy to mock and verify

**Steps:**
- Test with minimal pipeline setup
- Verify error handling and retries
- Can mock utility functions

**Workflows:**
- Integration tests that verify the full flow
- Can use real or mock steps
- Test error propagation and recovery

### Reusability

**Utility Functions** can be used:
- In steps
- In workflows
- In other utility functions
- Outside the pipeline system entirely

**Steps** can be used:
- In multiple workflows
- In different positions within workflows
- Standalone for testing

**Workflows** can be:
- Called from other workflows
- Exposed as API endpoints
- Run as CLI commands

### Maintainability

The clear separation makes the codebase easier to maintain:
- Business logic lives in `src/lib/`
- Pipeline integration lives in `src/steps/`
- Orchestration lives in `src/workflows/`
- Each file has a single, clear purpose

## Decision Framework

### When to Create a Utility Function

Create a utility function when you need to:
- ✅ Implement business logic that multiple steps might use
- ✅ Perform an operation that should be testable independently
- ✅ Create a pure transformation or calculation
- ✅ Interact with external systems (APIs, databases, file system)
- ✅ Share logic between steps and non-pipeline code

**Examples:**
- `readFile()` - reads files from disk
- `cleanMarkdown()` - removes headings and formatting
- `splitMarkdown()` - splits text into chunks
- `generateEmbeddings()` - calls embedding API
- `addEOT()` - appends end-of-text tokens

### When to Create a Step

Create a step when you need to:
- ✅ Integrate an operation into a pipeline
- ✅ Add pipeline features (error handling, retries, metadata)
- ✅ Make an operation reusable across workflows
- ✅ Create a distinct, trackable pipeline stage

**When to create a named, exported step:**
- The step will be used in multiple workflows
- The step has complex configuration or validation
- The step represents a significant pipeline operation

**When to create an inline step (in workflow):**
- The step is specific to one workflow
- The step is simple wrapper around a utility function
- The step handles workflow-specific error handling

**Examples:**
- `discoverFilesStep` - exported, used in multiple workflows
- Inline `readFile` step in `embed-documents.ts` - workflow-specific error handling
- Inline `cleanMarkdown` step - adds error handling to utility function

### When to Create a Workflow

Create a workflow when you need to:
- ✅ Compose multiple steps to achieve a higher-level goal
- ✅ Define a complete end-to-end process
- ✅ Provide a simple interface for complex operations
- ✅ Coordinate multiple independent operations

**Examples:**
- `embedDocuments()` - complete workflow for embedding markdown files
- `ragQuery()` - complete workflow for RAG query processing

## Examples

### Example 1: Simple Utility to Step to Workflow

**Utility Function (src/lib/text-processing.ts):**
```typescript
/**
 * Appends an end-of-text token to content if provided.
 */
export function addEOT(content: string, eotToken?: string): string {
  if (typeof content !== "string") {
    throw new TypeError("Content must be a string");
  }

  if (eotToken !== undefined && typeof eotToken !== "string") {
    throw new TypeError("EOT token must be a string");
  }

  return eotToken ? content + eotToken : content;
}
```

**Step (inline in workflow):**
```typescript
createStep("addEOT", async ({ input }) => {
  // If no EOT token configured, return chunk as-is
  if (!validated.eotToken) {
    return input;
  }

  try {
    const content = addEOT(input.content, validated.eotToken);

    return {
      ...input,
      content,
    };
  } catch (error) {
    console.warn(`Error adding EOT to chunk ${input.id}:`, error);
    return input;
  }
})
```

**Workflow (src/workflows/embed-documents.ts):**
```typescript
const pipeline = Pipeline.start<ChunkData>()
  .map("chunksWithEOT", createStep("addEOT", async ({ input }) => {
    if (!validated.eotToken) {
      return input;
    }

    try {
      const content = addEOT(input.content, validated.eotToken);
      return { ...input, content };
    } catch (error) {
      console.warn(`Error adding EOT to chunk ${input.id}:`, error);
      return input;
    }
  }), { parallel: false });
```

### Example 2: Complex Utility with Multiple Steps

**Utility Function (src/lib/markdown.ts):**
```typescript
/**
 * Intelligently splits markdown text into chunks.
 */
export async function smartSplitMarkdown(
  text: string,
  options: SplitMarkdownOptions,
): Promise<Array<{ pageContent: string; metadata: Record<string, any> }>> {
  const { minChunkSize, maxChunkSize, chunkOverlap } = options;

  // Stage 1: Markdown-aware split
  const markdownSplitter = RecursiveCharacterTextSplitter.fromLanguage("markdown", {
    chunkSize: maxChunkSize * 2,
    chunkOverlap: 0,
  });

  const initialDocs = await markdownSplitter.createDocuments([text]);

  // Stage 2: Character-based refinement
  const charSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: maxChunkSize,
    chunkOverlap: chunkOverlap,
  });

  const finalChunks: Array<{ pageContent: string; metadata: Record<string, any> }> = [];

  for (const doc of initialDocs) {
    const contentLength = doc.pageContent.length;

    if (contentLength < minChunkSize) {
      finalChunks.push(doc);
    } else if (contentLength > maxChunkSize) {
      const subChunks = await charSplitter.splitDocuments([doc]);
      finalChunks.push(...subChunks);
    } else {
      finalChunks.push(doc);
    }
  }

  return finalChunks;
}
```

**Another Utility Function Building on the First:**
```typescript
/**
 * Split markdown content into chunks suitable for embeddings.
 */
export async function splitMarkdown(
  content: string,
  source: string | undefined,
  metadata: Record<string, any>,
  options: SplitMarkdownOptions,
): Promise<Chunk[]> {
  if (!content || content.trim().length === 0) {
    return [];
  }

  // Use the lower-level utility
  const chunks = await smartSplitMarkdown(content, options);

  // Filter and process chunks
  const validChunks = chunks
    .filter((chunk) => isValidChunk(chunk.pageContent))
    .map((chunk, index) => {
      if (source && index > 255) {
        throw new Error(`Document produces ${chunks.length} chunks, exceeding maximum of 255`);
      }

      return {
        id: source ? getChunkUUID(source, index) : randomUUID(),
        content: chunk.pageContent,
        metadata: { ...metadata, ...chunk.metadata },
        index,
        length: chunk.pageContent.length,
      };
    });

  return validChunks;
}
```

**Step (inline in workflow):**
```typescript
createStep("splitMarkdown", async ({ input }) => {
  try {
    const chunks = await splitMarkdown(
      input.content,
      input.source,
      { source: input.source, tags: input.tags },
      {
        minChunkSize: validated.minChunkSize,
        maxChunkSize: validated.maxChunkSize,
        chunkOverlap: validated.chunkOverlap,
      }
    );

    return chunks;
  } catch (error) {
    console.warn(`Error splitting file ${input.path}:`, error);
    return [];
  }
})
```

### Example 3: Reusable Named Step

**Named Step (src/steps/io/discover-files.ts):**
```typescript
export const discoverFilesStep = createStep<DiscoverFilesInput, DiscoverFilesOutput>(
  "discoverFiles",
  async ({ input }) => {
    // Validate input
    const validated = DiscoverFilesInputSchema.parse(input);

    // Use Bun's Glob API to find files matching pattern
    const glob = new Glob(validated.pattern);
    const files: Array<{ path: string; name: string }> = [];

    for await (const file of glob.scan({
      cwd: validated.path,
      absolute: false,
    })) {
      const absolutePath = `${validated.path}/${file}`;
      const name = file.split("/").pop() || file;

      files.push({ path: absolutePath, name });
    }

    return { files };
  }
);
```

**Usage in Multiple Workflows:**
```typescript
// Workflow 1: Embed documents
const embedPipeline = Pipeline.start<{ path: string; pattern?: string }>()
  .add("discover", discoverFilesStep)
  // ... more steps

// Workflow 2: Index documents
const indexPipeline = Pipeline.start<{ path: string; pattern?: string }>()
  .add("discover", discoverFilesStep)
  // ... different steps
```

## Testing Strategies

### Testing Utility Functions

Utility functions should be tested as pure units without any pipeline infrastructure:

```typescript
import { test, expect } from "bun:test";
import { addEOT } from "../lib/text-processing";

test("addEOT appends token when provided", () => {
  const result = addEOT("Hello world", "<|endoftext|>");
  expect(result).toBe("Hello world<|endoftext|>");
});

test("addEOT returns original content when no token", () => {
  const result = addEOT("Hello world");
  expect(result).toBe("Hello world");
});

test("addEOT throws TypeError for non-string content", () => {
  expect(() => addEOT(123 as any, "<|endoftext|>")).toThrow(TypeError);
});
```

### Testing Steps

Steps can be tested with minimal pipeline setup:

```typescript
import { test, expect } from "bun:test";
import { discoverFilesStep } from "../steps/io/discover-files";

test("discoverFilesStep finds markdown files", async () => {
  const result = await discoverFilesStep.execute({
    input: { path: "./test-fixtures", pattern: "**/*.md" },
    state: {},
    context: undefined,
  });

  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.files.length).toBeGreaterThan(0);
    expect(result.data.files[0].path).toContain(".md");
  }
});
```

### Testing Workflows

Workflows are tested as integration tests:

```typescript
import { test, expect } from "bun:test";
import { embedDocuments } from "../workflows/embed-documents";

test("embedDocuments processes folder and generates embeddings", async () => {
  const result = await embedDocuments({
    folderPath: "./test-fixtures",
    pattern: "**/*.md",
    batchSize: 10,
    embeddingEndpoint: "http://localhost:8080/v1/embeddings",
    embeddingModel: "test-model",
  });

  expect(result.documents.length).toBeGreaterThan(0);
  expect(result.documents[0].vector.length).toBeGreaterThan(0);
  expect(result.totalFiles).toBeGreaterThan(0);
  expect(result.totalChunks).toBeGreaterThan(0);
});
```

## Migration Guide

If you have existing code that violates the architecture, here's how to fix it:

### Scenario 1: Step Calling Another Step

**Before:**
```typescript
const processFileStep = createStep("processFile", async ({ input }) => {
  const readResult = await readFileStep.execute({
    input: { path: input.path },
    state: {},
    context: undefined
  });

  if (!readResult.success) {
    throw new Error("Failed to read file");
  }

  const cleanResult = await cleanMarkdownStep.execute({
    input: { content: readResult.data.content },
    state: {},
    context: undefined,
  });

  if (!cleanResult.success) {
    throw new Error("Failed to clean markdown");
  }

  return cleanResult.data;
});
```

**After:**
```typescript
// Extract utility functions
// src/lib/file-io.ts
export async function readFile(path: string): Promise<FileReadResult> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`File not found: ${path}`);
  }
  const content = await file.text();
  return { content, source: path };
}

// src/lib/markdown.ts
export async function cleanMarkdown(content: string, headingsToRemove?: string[]): Promise<CleanedMarkdown> {
  // ... implementation
}

// Compose in workflow
const pipeline = Pipeline.start<{ path: string }>()
  .add("readFile", createStep("readFile", async ({ input }) => {
    return await readFile(input.path);
  }))
  .add("cleanMarkdown", createStep("cleanMarkdown", async ({ input }) => {
    return await cleanMarkdown(input.content);
  }));
```

### Scenario 2: Complex Logic in Step

**Before:**
```typescript
const processChunkStep = createStep("processChunk", async ({ input }) => {
  // Lots of complex business logic mixed with pipeline code
  const processed = input.content
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/~~(.*?)~~/g, '$1');

  const chunks = [];
  for (let i = 0; i < processed.length; i += 1000) {
    chunks.push(processed.slice(i, i + 1000));
  }

  return chunks;
});
```

**After:**
```typescript
// Extract to utility function
// src/lib/text-processing.ts
export function removeFormatting(content: string): string {
  return content
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/~~(.*?)~~/g, '$1');
}

export function chunkText(content: string, chunkSize: number): string[] {
  const chunks = [];
  for (let i = 0; i < content.length; i += chunkSize) {
    chunks.push(content.slice(i, i + chunkSize));
  }
  return chunks;
}

// Simplify step
const processChunkStep = createStep("processChunk", async ({ input }) => {
  const processed = removeFormatting(input.content);
  return chunkText(processed, 1000);
});
```

### Scenario 3: Workflow-Specific Step

**Before:**
```typescript
// src/steps/utilities/read-and-clean-file.ts
export const readAndCleanFileStep = createStep("readAndCleanFile", async ({ input }) => {
  const file = await readFile(input.path);
  const cleaned = await cleanMarkdown(file.content);
  return cleaned;
});

// Used in only one workflow
import { readAndCleanFileStep } from "../steps/utilities/read-and-clean-file";
const pipeline = Pipeline.start()
  .add("process", readAndCleanFileStep);
```

**After:**
```typescript
// Remove the separate step file, inline in workflow
const pipeline = Pipeline.start<{ path: string }>()
  .add("readFile", createStep("readFile", async ({ input }) => {
    return await readFile(input.path);
  }))
  .add("cleanMarkdown", createStep("cleanMarkdown", async ({ input }) => {
    return await cleanMarkdown(input.content);
  }));
```

## Summary

The steps vs utilities vs workflows architecture provides:

1. **Clear Separation of Concerns**
   - Business logic in utilities
   - Pipeline integration in steps
   - Orchestration in workflows

2. **Better Testability**
   - Utilities: fast unit tests
   - Steps: pipeline integration tests
   - Workflows: end-to-end integration tests

3. **Improved Reusability**
   - Utilities can be used anywhere
   - Steps can be used in multiple workflows
   - Workflows can be composed together

4. **Easier Maintenance**
   - Each component has a single responsibility
   - Changes are localized
   - Dependencies are explicit

Remember the golden rule: **Steps must not call other steps.** Let workflows compose steps together, and let steps call utility functions for business logic.
