---
id: task-3
title: Create Split Markdown utility step for embedding chunks
status: Done
assignee: []
created_date: '2025-12-21 03:51'
updated_date: '2025-12-21 04:38'
labels: []
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create a utility step that intelligently splits markdown files into chunks suitable for embeddings. This utility should handle markdown-aware splitting, generate stable UUIDs for chunks, and filter out invalid content.

This is based on an existing n8n workflow that uses LangChain's RecursiveCharacterTextSplitter to create optimally-sized chunks for vector embeddings. The implementation needs to be adapted to work with our pipeline system's step architecture.

Key features:
- **Smart markdown splitting**: Uses LangChain's markdown-aware splitter to respect document structure
- **Two-stage splitting**: Initial markdown-aware split, followed by character-based refinement
- **Configurable chunk sizes**: Support for minChunkSize, maxChunkSize, and chunkOverlap
- **Stable UUID generation**: Deterministic UUIDs based on source + chunk index
- **Chunk validation**: Filters out empty chunks, markdown fences, punctuation-only content, and standalone headings
- **Metadata preservation**: Maintains document metadata through the splitting process

The utility should integrate with our pipeline system and support batch processing of documents.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Utility step is created at src/steps/utilities/split-markdown.ts
- [x] #2 Required dependencies are added: @langchain/textsplitters and any crypto/uuid libraries needed
- [x] #3 Input schema includes: content (string), optional minChunkSize (default 300), optional maxChunkSize (default 1000), optional chunkOverlap (default 100), and optional metadata object
- [x] #4 Output schema returns array of chunks with: id (UUID), content (string), metadata (object), index (number), length (number)
- [x] #5 Two-stage splitting implemented: markdown-aware initial split, then character-based refinement
- [x] #6 Chunks smaller than minChunkSize are preserved as-is
- [x] #7 Chunks larger than maxChunkSize are further split with overlap
- [x] #8 Chunks between min and max size are preserved as-is
- [x] #9 UUID generation is deterministic using SHA-256 hash of source string
- [x] #10 Chunk UUIDs encode both source document and chunk index (0-255)
- [x] #11 Chunk validation filters out: empty/whitespace-only content, markdown fences (``` or ~~~), punctuation-only content, standalone headings with no body text
- [x] #12 Step follows the Step<TInput, TOutput> interface pattern
- [x] #13 Input and output types are properly defined with Zod schemas
- [x] #14 Comprehensive unit tests are created in src/steps/utilities/split-markdown.test.ts
- [x] #15 Tests verify: splitting behavior with various chunk sizes, UUID generation is deterministic, chunk validation rules, metadata preservation, edge cases (empty content, single line, very large documents)
- [x] #16 All tests pass when running 'bun test'
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Reference Implementation

The following n8n script provides the reference behavior to adapt:

```javascript
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const { createHash } = require('crypto');
const uuid = require('uuid');

async function smartSplitMarkdown(text, options = {}) {
  const { minChunkSize, maxChunkSize, chunkOverlap} = options;

  const markdownSplitter = RecursiveCharacterTextSplitter.fromLanguage("markdown", {
    chunkSize: maxChunkSize * 2,
    chunkOverlap: 0,
  });

  const initialDocs = await markdownSplitter.createDocuments([text]);
  const charSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: maxChunkSize,
    chunkOverlap: chunkOverlap,
  });

  const finalChunks = [];

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

function stringToBaseUUID(sourceString) {
  const hash = createHash('sha256').update(sourceString).digest();
  const uuidBytes = hash.slice(0, 16);
  uuidBytes[15] = 0;
  uuidBytes[6] = (uuidBytes[6] & 0x0f) | 0x40;
  uuidBytes[8] = (uuidBytes[8] & 0x3f) | 0x80;
  const hex = uuidBytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function getChunkUUID(sourceString, chunkIndex) {
  if (chunkIndex < 0 || chunkIndex > 255) {
    throw new Error('Chunk index must be between 0 and 255');
  }

  const baseUUID = stringToBaseUUID(sourceString);
  const hex = baseUUID.replace(/-/g, '');
  const bytes = Buffer.from(hex, 'hex');
  bytes[15] = chunkIndex;
  const newHex = bytes.toString('hex');
  return `${newHex.slice(0, 8)}-${newHex.slice(8, 12)}-${newHex.slice(12, 16)}-${newHex.slice(16, 20)}-${newHex.slice(20, 32)}`;
}

function isValidChunk(content) {
  const trimmed = content.trim();

  // Filter out empty or whitespace-only chunks
  if (trimmed.length === 0) return false;

  // Filter out chunks that are just markdown fences
  if (trimmed === '```' || trimmed === '~~~') return false;

  // Filter out chunks that are just punctuation/symbols
  if (/^[^\w\s]+$/.test(trimmed)) return false;

  // Filter out chunks that are just a single heading with no content
  // Matches: # Heading, ## Heading, etc. with nothing after
  if (/^#{1,6}\s+.+$/.test(trimmed) && !trimmed.includes('\n')) return false;

  // Also catch headings that only have whitespace after them
  const lines = trimmed.split('\n').filter(line => line.trim().length > 0);
  if (lines.length === 1 && /^#{1,6}\s+.+$/.test(lines[0])) return false;

  return true;
}

// Process all items and collect results
const allResults = [];

for (const item of $input.all()) {
  const markdownText = item.json.content;
  const itemData = item.json.data || {};

  const chunks = await smartSplitMarkdown(markdownText, {
    minChunkSize: 300,
    maxChunkSize: 1000,
    chunkOverlap: 100
  });

  // Filter and process chunks
  const validChunks = chunks
    .filter(chunk => isValidChunk(chunk.pageContent))
    .map((chunk, index) => {
      return {
        json: {
          ...itemData,
          id: itemData.source ? getChunkUUID(itemData.source, index) : uuid.v4(),
          content: chunk.pageContent,
          metadata: chunk.metadata,
          index: index,
          length: chunk.pageContent.length
        }
      };
    });

  allResults.push(...validChunks);
}

return allResults;
```

## Implementation Approach

### 1. Dependencies
Install required packages:
```bash
bun add @langchain/textsplitters
```

Note: Bun has built-in `crypto` module, so no need to install separate crypto package. For UUID, we'll use the crypto-based UUID generation from the reference implementation rather than installing the `uuid` package.

### 2. Step Structure

Create the step at `src/steps/utilities/split-markdown.ts` following the pipeline pattern:

```typescript
import { z } from "zod";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { createHash } from "crypto";

// Input schema
const SplitMarkdownInputSchema = z.object({
  content: z.string(),
  minChunkSize: z.number().optional().default(300),
  maxChunkSize: z.number().optional().default(1000),
  chunkOverlap: z.number().optional().default(100),
  metadata: z.record(z.any()).optional().default({}),
  source: z.string().optional(), // For deterministic UUID generation
});

// Output schema
const ChunkSchema = z.object({
  id: z.string().uuid(),
  content: z.string(),
  metadata: z.record(z.any()),
  index: z.number(),
  length: z.number(),
});

const SplitMarkdownOutputSchema = z.object({
  chunks: z.array(ChunkSchema),
});

// Step implementation follows...
```

### 3. Core Functions to Port

**smartSplitMarkdown**: The two-stage splitting algorithm
- Stage 1: Markdown-aware split with `chunkSize: maxChunkSize * 2`
- Stage 2: Refine chunks based on size constraints

**stringToBaseUUID**: Generate deterministic UUID from source string
- Uses SHA-256 hash
- Converts to valid UUID v4 format
- Reserves last byte (index 15) for chunk index

**getChunkUUID**: Generate chunk-specific UUID
- Takes base UUID and chunk index (0-255)
- Encodes chunk index in the last byte

**isValidChunk**: Validation rules
- Reject empty/whitespace-only content
- Reject markdown fences (`\`\`\`` or `~~~`)
- Reject punctuation-only content
- Reject standalone headings without body text

### 4. Adaptation Notes

**Input differences:**
- n8n: `item.json.content` and `item.json.data`
- Our system: Single input object with `content` and `metadata` fields

**Output differences:**
- n8n: Returns array of `{ json: {...} }` objects
- Our system: Returns `{ chunks: [...] }` with typed chunk objects

**Batch processing:**
- n8n: Processes `$input.all()` (multiple items)
- Our system: Single document per step execution (pipeline handles batching)

**UUID generation:**
- Use `source` field from input if provided for deterministic UUIDs
- Fall back to random UUID if no source provided
- Consider using a hash of the content itself as source if not provided

### 5. Testing Strategy

Create `src/steps/utilities/split-markdown.test.ts` with test cases for:

1. **Basic splitting**:
   - Small document (< minChunkSize)
   - Medium document (between min and max)
   - Large document (> maxChunkSize)

2. **UUID generation**:
   - Deterministic UUIDs with same source
   - Different UUIDs for different sources
   - Sequential chunk indices

3. **Validation**:
   - Empty content filtered out
   - Markdown fences filtered out
   - Punctuation-only filtered out
   - Standalone headings filtered out
   - Valid content preserved

4. **Edge cases**:
   - Empty string input
   - Single line
   - Very large document
   - Document with mixed valid/invalid chunks
   - No source provided (random UUIDs)

5. **Metadata preservation**:
   - Metadata passed through to all chunks
   - LangChain metadata preserved

### 6. Key Behaviors to Preserve

- **Two-stage split**: Always do markdown-aware split first, then character refinement
- **Size thresholds**: Respect the three size categories (< min, min-max, > max)
- **Deterministic UUIDs**: Same source + index = same UUID every time
- **Validation rules**: All four validation rules from `isValidChunk`
- **Chunk index limit**: Maximum 255 chunks per document (byte limitation)

### 7. Integration Considerations

This utility step should:
- Be usable in workflows alongside other steps
- Support the standard Step interface
- Return proper StepResult (success/failure)
- Handle errors gracefully (e.g., chunk index > 255)
- Log warnings for filtered chunks (optional, for debugging)

## Enhanced Implementation Details

### Dependencies
```bash
bun add @langchain/textsplitters
```
Note: Bun has built-in `crypto` module.

### Pipeline Integration Pattern

```typescript
import { createStep } from '../../core/pipeline/steps';
import { z } from 'zod';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { createHash } from 'crypto';

const SplitMarkdownInputSchema = z.object({
  content: z.string(),
  source: z.string().optional(),
  metadata: z.record(z.any()).optional().default({}),
  minChunkSize: z.number().optional().default(300),
  maxChunkSize: z.number().optional().default(1000),
  chunkOverlap: z.number().optional().default(100),
});

const ChunkSchema = z.object({
  id: z.string().uuid(),
  content: z.string(),
  metadata: z.record(z.any()),
  index: z.number(),
  length: z.number(),
});

const SplitMarkdownOutputSchema = z.object({
  chunks: z.array(ChunkSchema),
});
```

### Step Creation

```typescript
export const splitMarkdownStep = createStep<SplitMarkdownInput, SplitMarkdownOutput>(
  'splitMarkdown',
  async ({ input }) => {
    const validated = SplitMarkdownInputSchema.parse(input);
    const chunks = await smartSplitMarkdown(validated.content, {
      minChunkSize: validated.minChunkSize,
      maxChunkSize: validated.maxChunkSize,
      chunkOverlap: validated.chunkOverlap,
    });
    
    const validChunks = chunks
      .filter(chunk => isValidChunk(chunk.pageContent))
      .map((chunk, index) => ({
        id: validated.source ? getChunkUUID(validated.source, index) : crypto.randomUUID(),
        content: chunk.pageContent,
        metadata: { ...validated.metadata, ...chunk.metadata },
        index,
        length: chunk.pageContent.length,
      }));
    
    return { chunks: validChunks };
  }
);
```

### File Structure
```
src/steps/utilities/
  split-markdown.ts
  split-markdown.test.ts
  index.ts (update to export)
```

## Critical Implementation Notes

### Key Functions to Implement

1. **smartSplitMarkdown**: Two-stage splitting
   - Stage 1: Markdown-aware (RecursiveCharacterTextSplitter with "markdown")
   - Stage 2: Character refinement based on size constraints

2. **stringToBaseUUID**: Deterministic UUID from SHA-256 hash
3. **getChunkUUID**: Modify last byte with chunk index (0-255)
4. **isValidChunk**: Validate content (no empty, fences, punctuation-only, standalone headings)

### Important Constraints

- **Max 255 chunks** per document (byte limitation)
- **UUID determinism**: Same source + index = same UUID
- **Metadata merging**: Input metadata + LangChain metadata
- **Empty content**: Return empty array (not error)
- **Index > 255**: Throw error

### Testing Requirements (Per AC #14-16)

1. Splitting: small/medium/large documents
2. UUID: determinism, sequential indices
3. Validation: all 4 filter rules
4. Metadata: preservation and merging
5. Edge cases: empty, single line, >256 chunks, no source

### Integration

- Works with Clean Markdown step output
- Proper StepResult handling
- Type-safe with Zod
<!-- SECTION:PLAN:END -->
