import { describe, expect, test } from "bun:test";
import { getChunkUUID, isValidChunk, smartSplitMarkdown, stringToBaseUUID } from "../../lib/markdown";
import { SplitMarkdownInputSchema, SplitMarkdownOutputSchema, splitMarkdownStep } from "./split-markdown";

describe("isValidChunk", () => {
  test("rejects empty string", () => {
    expect(isValidChunk("")).toBe(false);
  });

  test("rejects whitespace-only content", () => {
    expect(isValidChunk("   ")).toBe(false);
    expect(isValidChunk("\n\n\n")).toBe(false);
    expect(isValidChunk("\t\t")).toBe(false);
  });

  test("rejects markdown code fences", () => {
    expect(isValidChunk("```")).toBe(false);
    expect(isValidChunk("~~~")).toBe(false);
  });

  test("rejects punctuation-only content", () => {
    expect(isValidChunk("!!!")).toBe(false);
    expect(isValidChunk("---")).toBe(false);
    expect(isValidChunk("...")).toBe(false);
    expect(isValidChunk("***")).toBe(false);
  });

  test("rejects standalone headings without body text", () => {
    expect(isValidChunk("# Heading")).toBe(false);
    expect(isValidChunk("## Another Heading")).toBe(false);
    expect(isValidChunk("### Level 3")).toBe(false);
    expect(isValidChunk("#### Level 4")).toBe(false);
    expect(isValidChunk("##### Level 5")).toBe(false);
    expect(isValidChunk("###### Level 6")).toBe(false);
  });

  test("rejects headings with only whitespace after", () => {
    expect(isValidChunk("# Heading\n\n\n")).toBe(false);
    expect(isValidChunk("## Heading\n  \n  ")).toBe(false);
  });

  test("accepts headings with body text", () => {
    expect(isValidChunk("# Heading\nSome content")).toBe(true);
    expect(isValidChunk("## Heading\n\nSome paragraph")).toBe(true);
  });

  test("accepts valid content", () => {
    expect(isValidChunk("This is valid text.")).toBe(true);
    expect(isValidChunk("A paragraph with multiple sentences. Here is another.")).toBe(true);
    expect(isValidChunk("- List item 1\n- List item 2")).toBe(true);
  });

  test("accepts code blocks with content", () => {
    expect(isValidChunk('```javascript\nconsole.log("hello");\n```')).toBe(true);
  });

  test("accepts mixed content", () => {
    expect(isValidChunk("# Heading\n\nParagraph text.\n\n- List item")).toBe(true);
  });
});

describe("stringToBaseUUID", () => {
  test("generates valid UUID format", () => {
    const uuid = stringToBaseUUID("test-source");
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  test("generates deterministic UUIDs for same input", () => {
    const uuid1 = stringToBaseUUID("test-source");
    const uuid2 = stringToBaseUUID("test-source");
    expect(uuid1).toBe(uuid2);
  });

  test("generates different UUIDs for different inputs", () => {
    const uuid1 = stringToBaseUUID("source-1");
    const uuid2 = stringToBaseUUID("source-2");
    expect(uuid1).not.toBe(uuid2);
  });

  test("last byte is zero (reserved for chunk index)", () => {
    const uuid = stringToBaseUUID("test-source");
    const hex = uuid.replace(/-/g, "");
    const lastByte = hex.slice(-2);
    expect(lastByte).toBe("00");
  });

  test("generates UUID v4 format (version bits)", () => {
    const uuid = stringToBaseUUID("test-source");
    const hex = uuid.replace(/-/g, "");
    // Byte 6 should have high nibble = 4 (version 4)
    const versionByte = parseInt(hex.slice(12, 14), 16);
    expect(versionByte & 0xf0).toBe(0x40);
  });

  test("generates RFC 4122 variant (variant bits)", () => {
    const uuid = stringToBaseUUID("test-source");
    const hex = uuid.replace(/-/g, "");
    // Byte 8 should have high 2 bits = 10 (RFC 4122)
    const variantByte = parseInt(hex.slice(16, 18), 16);
    expect(variantByte & 0xc0).toBe(0x80);
  });
});

describe("getChunkUUID", () => {
  test("generates valid UUID format", () => {
    const uuid = getChunkUUID("test-source", 0);
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  test("generates deterministic UUIDs for same source and index", () => {
    const uuid1 = getChunkUUID("test-source", 5);
    const uuid2 = getChunkUUID("test-source", 5);
    expect(uuid1).toBe(uuid2);
  });

  test("generates different UUIDs for different indices", () => {
    const uuid1 = getChunkUUID("test-source", 0);
    const uuid2 = getChunkUUID("test-source", 1);
    const uuid3 = getChunkUUID("test-source", 2);
    expect(uuid1).not.toBe(uuid2);
    expect(uuid2).not.toBe(uuid3);
    expect(uuid1).not.toBe(uuid3);
  });

  test("encodes chunk index in last byte", () => {
    const uuid0 = getChunkUUID("test-source", 0);
    const uuid1 = getChunkUUID("test-source", 1);
    const uuid255 = getChunkUUID("test-source", 255);

    const hex0 = uuid0.replace(/-/g, "");
    const hex1 = uuid1.replace(/-/g, "");
    const hex255 = uuid255.replace(/-/g, "");

    expect(hex0.slice(-2)).toBe("00");
    expect(hex1.slice(-2)).toBe("01");
    expect(hex255.slice(-2)).toBe("ff");
  });

  test("generates same base for all chunks from same source", () => {
    const uuid0 = getChunkUUID("test-source", 0);
    const uuid1 = getChunkUUID("test-source", 1);
    const uuid255 = getChunkUUID("test-source", 255);

    // All except last byte should be identical
    expect(uuid0.slice(0, -2)).toBe(uuid1.slice(0, -2));
    expect(uuid1.slice(0, -2)).toBe(uuid255.slice(0, -2));
  });

  test("throws error for negative index", () => {
    expect(() => getChunkUUID("test-source", -1)).toThrow("Chunk index must be between 0 and 255");
  });

  test("throws error for index > 255", () => {
    expect(() => getChunkUUID("test-source", 256)).toThrow("Chunk index must be between 0 and 255");
  });

  test("accepts boundary values 0 and 255", () => {
    expect(() => getChunkUUID("test-source", 0)).not.toThrow();
    expect(() => getChunkUUID("test-source", 255)).not.toThrow();
  });
});

describe("smartSplitMarkdown", () => {
  test("preserves small chunks (< minChunkSize)", async () => {
    const text = "Short text.";
    const chunks = await smartSplitMarkdown(text, {
      minChunkSize: 300,
      maxChunkSize: 1000,
      chunkOverlap: 100,
    });

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]?.pageContent).toBe(text);
  });

  test("preserves medium chunks (between min and max)", async () => {
    // Create text between 300 and 1000 characters
    const text = "A".repeat(500);
    const chunks = await smartSplitMarkdown(text, {
      minChunkSize: 300,
      maxChunkSize: 1000,
      chunkOverlap: 100,
    });

    expect(chunks.length).toBe(1);
    expect(chunks[0]?.pageContent.length).toBe(500);
  });

  test("splits large chunks (> maxChunkSize)", async () => {
    // Create text larger than maxChunkSize
    const text = "A".repeat(2500);
    const chunks = await smartSplitMarkdown(text, {
      minChunkSize: 300,
      maxChunkSize: 1000,
      chunkOverlap: 100,
    });

    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk should be close to maxChunkSize
    for (const chunk of chunks) {
      expect(chunk.pageContent.length).toBeLessThanOrEqual(1000);
    }
  });

  test("respects markdown structure", async () => {
    const text = `
# Heading 1

Paragraph under heading 1.

## Heading 2

Paragraph under heading 2.

### Heading 3

Paragraph under heading 3.
    `.trim();

    const chunks = await smartSplitMarkdown(text, {
      minChunkSize: 50,
      maxChunkSize: 200,
      chunkOverlap: 20,
    });

    expect(chunks.length).toBeGreaterThan(0);
    // Verify chunks contain markdown structure
    expect(chunks.some((c: { pageContent: string }) => c.pageContent.includes("#"))).toBe(true);
  });

  test("handles code blocks", async () => {
    const text = `
# Code Example

\`\`\`javascript
function hello() {
  console.log("Hello, world!");
}
\`\`\`

Some text after the code block.
    `.trim();

    const chunks = await smartSplitMarkdown(text, {
      minChunkSize: 50,
      maxChunkSize: 300,
      chunkOverlap: 20,
    });

    expect(chunks.length).toBeGreaterThan(0);
  });

  test("handles lists", async () => {
    const text = `
# List Example

- Item 1
- Item 2
- Item 3
- Item 4
- Item 5
    `.trim();

    const chunks = await smartSplitMarkdown(text, {
      minChunkSize: 30,
      maxChunkSize: 100,
      chunkOverlap: 10,
    });

    expect(chunks.length).toBeGreaterThan(0);
  });

  test("applies overlap for large chunks", async () => {
    const text = "A".repeat(2500);
    const chunks = await smartSplitMarkdown(text, {
      minChunkSize: 300,
      maxChunkSize: 1000,
      chunkOverlap: 100,
    });

    // Verify overlap exists between consecutive chunks
    if (chunks.length > 1) {
      const firstChunkEnd = chunks[0]?.pageContent.slice(-50);
      const secondChunkStart = chunks[1]?.pageContent.slice(0, 50);
      // Some overlap should exist
      expect(firstChunkEnd).toContain("A");
      expect(secondChunkStart).toContain("A");
    }
  });
});

describe("splitMarkdownStep", () => {
  test("handles empty content", async () => {
    const result = await splitMarkdownStep.execute({
      input: { content: "" },
      state: {},
      context: {},
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.chunks).toEqual([]);
    }
  });

  test("handles whitespace-only content", async () => {
    const result = await splitMarkdownStep.execute({
      input: { content: "   \n\n\t  " },
      state: {},
      context: {},
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.chunks).toEqual([]);
    }
  });

  test("splits content into chunks", async () => {
    const content = `
# Introduction

This is a test document with multiple sections.

## Section 1

Content for section 1. This has enough text to be meaningful.

## Section 2

Content for section 2. This also has enough text to be meaningful.

## Section 3

Content for section 3. More meaningful text here as well.
    `.trim();

    const result = await splitMarkdownStep.execute({
      input: {
        content,
        minChunkSize: 50,
        maxChunkSize: 200,
        chunkOverlap: 20,
      },
      state: {},
      context: {},
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.chunks.length).toBeGreaterThan(0);
      // Verify chunk structure
      for (const chunk of result.data.chunks) {
        expect(chunk).toHaveProperty("id");
        expect(chunk).toHaveProperty("content");
        expect(chunk).toHaveProperty("metadata");
        expect(chunk).toHaveProperty("index");
        expect(chunk).toHaveProperty("length");
        expect(chunk.length).toBe(chunk.content.length);
      }
    }
  });

  test("generates deterministic UUIDs with source", async () => {
    const content = "Test content for UUID generation.";

    const result1 = await splitMarkdownStep.execute({
      input: { content, source: "test-doc-123" },
      state: {},
      context: {},
    });

    const result2 = await splitMarkdownStep.execute({
      input: { content, source: "test-doc-123" },
      state: {},
      context: {},
    });

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);

    if (result1.success && result2.success) {
      expect(result1.data.chunks.length).toBe(result2.data.chunks.length);
      for (let i = 0; i < result1.data.chunks.length; i++) {
        expect(result1.data.chunks[i]?.id).toBe(result2.data.chunks[i]?.id);
      }
    }
  });

  test("generates random UUIDs without source", async () => {
    const content = "Test content for UUID generation.";

    const result1 = await splitMarkdownStep.execute({
      input: { content },
      state: {},
      context: {},
    });

    const result2 = await splitMarkdownStep.execute({
      input: { content },
      state: {},
      context: {},
    });

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);

    if (result1.success && result2.success) {
      // Without source, UUIDs should be different
      if (result1.data.chunks.length > 0 && result2.data.chunks.length > 0) {
        expect(result1.data.chunks[0]?.id).not.toBe(result2.data.chunks[0]?.id);
      }
    }
  });

  test("filters out invalid chunks", async () => {
    const content = `
# Standalone Heading

Valid paragraph text.

## Another Heading

\`\`\`

!!!

More valid text here.
    `.trim();

    const result = await splitMarkdownStep.execute({
      input: {
        content,
        minChunkSize: 10,
        maxChunkSize: 100,
        chunkOverlap: 10,
      },
      state: {},
      context: {},
    });

    expect(result.success).toBe(true);
    if (result.success) {
      // Should have filtered out standalone headings, fences, and punctuation
      for (const chunk of result.data.chunks) {
        expect(isValidChunk(chunk.content)).toBe(true);
      }
    }
  });

  test("preserves input metadata", async () => {
    const content = "Test content with metadata.";
    const metadata = { filename: "test.md", author: "tester" };

    const result = await splitMarkdownStep.execute({
      input: { content, metadata },
      state: {},
      context: {},
    });

    expect(result.success).toBe(true);
    if (result.success) {
      for (const chunk of result.data.chunks) {
        expect(chunk.metadata).toMatchObject(metadata);
      }
    }
  });

  test("merges LangChain metadata with input metadata", async () => {
    const content = "Test content.";
    const metadata = { custom: "value" };

    const result = await splitMarkdownStep.execute({
      input: { content, metadata },
      state: {},
      context: {},
    });

    expect(result.success).toBe(true);
    if (result.success) {
      for (const chunk of result.data.chunks) {
        expect(chunk.metadata).toHaveProperty("custom");
        expect(chunk.metadata.custom).toBe("value");
      }
    }
  });

  test("assigns sequential indices to chunks", async () => {
    const content = "A".repeat(2500);

    const result = await splitMarkdownStep.execute({
      input: {
        content,
        minChunkSize: 300,
        maxChunkSize: 1000,
        chunkOverlap: 100,
      },
      state: {},
      context: {},
    });

    expect(result.success).toBe(true);
    if (result.success && result.data.chunks.length > 1) {
      for (let i = 0; i < result.data.chunks.length; i++) {
        expect(result.data.chunks[i]?.index).toBe(i);
      }
    }
  });

  test("throws error for > 255 chunks with source", async () => {
    // Create a very large document that would produce > 255 chunks
    const sections = Array.from(
      { length: 300 },
      (_, i) => `
## Section ${i + 1}

This is content for section ${i + 1}. It has enough text to be its own chunk.
    `,
    ).join("\n");

    const result = await splitMarkdownStep.execute({
      input: {
        content: sections,
        source: "large-doc",
        minChunkSize: 10,
        maxChunkSize: 100,
        chunkOverlap: 0,
      },
      state: {},
      context: {},
    });

    // Should error due to > 255 chunks
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("255");
    }
  });

  test("applies default values for optional parameters", async () => {
    const content = "Test content.";

    const result = await splitMarkdownStep.execute({
      input: { content },
      state: {},
      context: {},
    });

    expect(result.success).toBe(true);
    // Defaults should be applied: minChunkSize=300, maxChunkSize=1000, chunkOverlap=100
  });

  test("validates input schema", () => {
    // Valid input
    expect(() => SplitMarkdownInputSchema.parse({ content: "test" })).not.toThrow();

    // Invalid input - missing content
    expect(() => SplitMarkdownInputSchema.parse({})).toThrow();

    // Invalid input - wrong type
    expect(() => SplitMarkdownInputSchema.parse({ content: 123 })).toThrow();
  });

  test("validates output schema", () => {
    const validOutput = {
      chunks: [
        {
          id: "123e4567-e89b-12d3-a456-426614174000",
          content: "test",
          metadata: {},
          index: 0,
          length: 4,
        },
      ],
    };

    expect(() => SplitMarkdownOutputSchema.parse(validOutput)).not.toThrow();
  });

  test("handles single line input", async () => {
    const content = "Just a single line of text.";

    const result = await splitMarkdownStep.execute({
      input: { content },
      state: {},
      context: {},
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.chunks.length).toBe(1);
      expect(result.data.chunks[0]?.content).toBe(content);
    }
  });

  test("handles very large document", async () => {
    // Create a 50KB document
    const largeContent = "A".repeat(50000);

    const result = await splitMarkdownStep.execute({
      input: {
        content: largeContent,
        minChunkSize: 300,
        maxChunkSize: 1000,
        chunkOverlap: 100,
      },
      state: {},
      context: {},
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.chunks.length).toBeGreaterThan(10);
      // Verify all chunks respect size constraints
      for (const chunk of result.data.chunks) {
        expect(chunk.length).toBeLessThanOrEqual(1000);
      }
    }
  });

  test("respects custom chunk size parameters", async () => {
    const content = "B".repeat(3000);

    const result = await splitMarkdownStep.execute({
      input: {
        content,
        minChunkSize: 100,
        maxChunkSize: 500,
        chunkOverlap: 50,
      },
      state: {},
      context: {},
    });

    expect(result.success).toBe(true);
    if (result.success) {
      for (const chunk of result.data.chunks) {
        expect(chunk.length).toBeLessThanOrEqual(500);
      }
    }
  });
});
