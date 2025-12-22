import { createHash, randomUUID } from "node:crypto";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import matter from "gray-matter";
import type { Delete, Emphasis, Heading, Root, Strong } from "mdast";
import { remark } from "remark";
import remarkGfm from "remark-gfm";
import { SKIP, visit } from "unist-util-visit";

/**
 * Default headings to remove from markdown documents.
 * These are typically task management and workflow-related sections
 * that don't add value in LLM context or embeddings.
 */
export const DEFAULT_HEADINGS_TO_REMOVE = [
  "Project List",
  "Due Today",
  "Todoist Tasks",
  "Daily Reading",
  "Completed Today",
  "Habit",
  "Jira Tickets",
  "Task",
  "Bullet",
  "File",
] as const;

/**
 * Interface for sections to be removed from the markdown tree.
 */
interface RemovalRange {
  startIndex: number;
  endIndex: number;
}

/**
 * Remark plugin to remove specified heading sections from the markdown tree.
 *
 * This plugin removes both the heading AND all content until the next heading
 * of the same or higher level (lower depth value).
 *
 * @param headingsToRemove - Array of heading text strings to remove
 */
function removeHeadings(headingsToRemove: string[]) {
  return (tree: Root) => {
    const indicesToRemove: RemovalRange[] = [];

    visit(tree, "heading", (node: Heading, index, parent) => {
      if (index === null || index === undefined || !parent) {
        return;
      }

      // Get the heading text by concatenating all text children
      const headingText = node.children
        .filter((child) => child.type === "text")
        .map((child) => ("value" in child ? child.value : ""))
        .join("");

      // Check if this heading should be removed
      if (headingsToRemove.includes(headingText)) {
        // Find the range to remove (heading + all content until next heading of same/higher level)
        const startIndex = index;
        let endIndex = index;

        // Look for the next heading at the same or higher level (lower or equal depth)
        for (let i = index + 1; i < parent.children.length; i++) {
          const nextNode = parent.children[i];
          if (nextNode && nextNode.type === "heading" && (nextNode as Heading).depth <= node.depth) {
            break;
          }
          endIndex = i;
        }

        indicesToRemove.push({ startIndex, endIndex });
      }
    });

    // Remove sections in reverse order to maintain correct indices
    indicesToRemove.reverse().forEach(({ startIndex, endIndex }) => {
      tree.children.splice(startIndex, endIndex - startIndex + 1);
    });
  };
}

/**
 * Remark plugin to remove text formatting while preserving content.
 *
 * This plugin removes:
 * - Emphasis (italic) nodes
 * - Strong (bold) nodes
 * - Delete (strikethrough) nodes
 *
 * It does NOT remove:
 * - Links (preserves both link and text)
 * - Inline code (preserves formatting)
 */
function removeFormatting() {
  return (tree: Root) => {
    visit(tree, (node, index, parent) => {
      // Remove emphasis (italic), strong (bold), delete (strikethrough)
      if (node.type === "emphasis" || node.type === "strong" || node.type === "delete") {
        if (parent && index !== null && index !== undefined) {
          const formattingNode = node as Emphasis | Strong | Delete;
          // Replace the formatting node with its children (the text content)
          parent.children.splice(index, 1, ...formattingNode.children);
          // Return SKIP and index to avoid re-processing the newly inserted children
          return [SKIP, index];
        }
      }
      return undefined;
    });
  };
}

/**
 * Parse tags from frontmatter data.
 *
 * Handles three formats:
 * 1. Empty string -> []
 * 2. Comma-separated string -> split and trim
 * 3. Array -> use as-is
 *
 * @param frontmatterData - The parsed frontmatter object
 * @returns Array of tag strings
 */
// biome-ignore lint/suspicious/noExplicitAny: Frontmatter data structure is dynamic and unknown
function parseTags(frontmatterData: Record<string, any>): string[] {
  const tags = frontmatterData.tags;

  if (!tags) {
    return [];
  }

  if (typeof tags === "string") {
    if (tags === "") {
      return [];
    }
    return tags.split(",").map((tag) => tag.trim());
  }

  if (Array.isArray(tags)) {
    return tags;
  }

  return [];
}

/**
 * Clean markdown content by removing specified heading sections and text formatting.
 *
 * This function:
 * - Parses frontmatter from the markdown content
 * - Removes specified heading sections and their content
 * - Removes text formatting (bold, italic, strikethrough) while preserving text
 * - Extracts tags from frontmatter
 *
 * @param content - The markdown content to clean
 * @param headingsToRemove - Optional array of heading text strings to remove (defaults to DEFAULT_HEADINGS_TO_REMOVE)
 * @returns Object containing cleaned content, tags array, and optional frontmatter
 * @throws Error if markdown processing fails
 *
 * @example
 * ```typescript
 * const result = await cleanMarkdown(markdownText, ['Project List', 'Tasks']);
 * console.log(result.content); // Cleaned markdown text
 * console.log(result.tags); // ['tag1', 'tag2']
 * console.log(result.frontmatter); // { title: 'Document Title', ... }
 * ```
 */
export async function cleanMarkdown(
  content: string,
  headingsToRemove?: string[],
): Promise<{
  content: string;
  tags: string[];
  // biome-ignore lint/suspicious/noExplicitAny: Frontmatter data structure is dynamic and unknown
  frontmatter?: Record<string, any>;
}> {
  const headings = headingsToRemove ?? [...DEFAULT_HEADINGS_TO_REMOVE];

  // Parse frontmatter from the markdown content
  const parsed = matter(content);

  // Process the markdown content through remark plugins
  const modified = await remark()
    .use(remarkGfm) // Enable GFM syntax including strikethrough
    .use(removeHeadings, headings)
    .use(removeFormatting)
    .process(parsed.content);

  // Parse tags from frontmatter
  const tags = parseTags(parsed.data);

  return {
    content: String(modified.value),
    tags,
    frontmatter: parsed.data,
  };
}

/**
 * Options for smart markdown splitting.
 */
export interface SplitMarkdownOptions {
  minChunkSize: number;
  maxChunkSize: number;
  chunkOverlap: number;
}

/**
 * Represents a chunk of markdown content.
 */
export interface Chunk {
  id: string;
  content: string;
  // biome-ignore lint/suspicious/noExplicitAny: Metadata structure is dynamic and unknown
  metadata: Record<string, any>;
  index: number;
  length: number;
}

/**
 * Intelligently splits markdown text into chunks using a two-stage approach:
 * 1. Markdown-aware initial split (respects document structure)
 * 2. Character-based refinement (ensures size constraints)
 *
 * Chunks are categorized into three groups:
 * - Small (< minChunkSize): Preserved as-is
 * - Medium (minChunkSize to maxChunkSize): Preserved as-is
 * - Large (> maxChunkSize): Further split with overlap
 *
 * @param text - The markdown text to split
 * @param options - Configuration for chunk sizes and overlap
 * @returns Array of LangChain Document objects with pageContent and metadata
 */
export async function smartSplitMarkdown(
  text: string,
  options: SplitMarkdownOptions,
  // biome-ignore lint/suspicious/noExplicitAny: Metadata structure is dynamic and unknown
): Promise<Array<{ pageContent: string; metadata: Record<string, any> }>> {
  const { minChunkSize, maxChunkSize, chunkOverlap } = options;

  // Stage 1: Markdown-aware split with larger chunk size
  // This respects markdown structure (headings, lists, code blocks, etc.)
  const markdownSplitter = RecursiveCharacterTextSplitter.fromLanguage("markdown", {
    chunkSize: maxChunkSize * 2,
    chunkOverlap: 0,
  });

  const initialDocs = await markdownSplitter.createDocuments([text]);

  // Stage 2: Character-based refinement splitter for oversized chunks
  const charSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: maxChunkSize,
    chunkOverlap: chunkOverlap,
  });

  const finalChunks: Array<{
    pageContent: string;
    // biome-ignore lint/suspicious/noExplicitAny: Metadata structure is dynamic and unknown
    metadata: Record<string, any>;
  }> = [];

  // Process each chunk based on its size
  for (const doc of initialDocs) {
    const contentLength = doc.pageContent.length;

    if (contentLength < minChunkSize) {
      // Small chunks: preserve as-is
      finalChunks.push(doc);
    } else if (contentLength > maxChunkSize) {
      // Large chunks: further split with overlap
      const subChunks = await charSplitter.splitDocuments([doc]);
      finalChunks.push(...subChunks);
    } else {
      // Medium chunks: preserve as-is (optimal size)
      finalChunks.push(doc);
    }
  }

  return finalChunks;
}

/**
 * Generates a deterministic base UUID from a source string using SHA-256.
 *
 * The UUID is generated by:
 * 1. Computing SHA-256 hash of the source string
 * 2. Taking first 16 bytes for UUID
 * 3. Setting last byte (index 15) to 0 (reserved for chunk index)
 * 4. Setting version bits to UUID v4 (byte 6, bits 4-7 = 0100)
 * 5. Setting variant bits to RFC 4122 (byte 8, bits 6-7 = 10)
 *
 * @param sourceString - The source string to hash
 * @returns A valid UUID v4 string with last byte set to 0
 */
export function stringToBaseUUID(sourceString: string): string {
  // Compute SHA-256 hash
  const hash = createHash("sha256").update(sourceString).digest();

  // Take first 16 bytes for UUID
  const uuidBytes = hash.subarray(0, 16);

  // Reserve last byte for chunk index
  uuidBytes[15] = 0;

  // Set version to 4 (random UUID) - byte 6, bits 4-7 = 0100
  // biome-ignore lint/style/noNonNullAssertion: Index 6 is guaranteed to exist in 16-byte buffer
  uuidBytes[6] = (uuidBytes[6]! & 0x0f) | 0x40;

  // Set variant to RFC 4122 - byte 8, bits 6-7 = 10
  // biome-ignore lint/style/noNonNullAssertion: Index 8 is guaranteed to exist in 16-byte buffer
  uuidBytes[8] = (uuidBytes[8]! & 0x3f) | 0x80;

  // Convert to hex string
  const hex = uuidBytes.toString("hex");

  // Format as UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Generates a chunk-specific UUID by encoding the chunk index in the last byte.
 *
 * This creates a deterministic UUID for each chunk that:
 * - Is unique to the source document
 * - Encodes the chunk's position (0-255)
 * - Is reproducible across multiple runs
 *
 * @param sourceString - The source string to hash
 * @param chunkIndex - The chunk index (0-255)
 * @returns A valid UUID v4 string with chunk index encoded in last byte
 * @throws Error if chunkIndex is outside valid range (0-255)
 */
export function getChunkUUID(sourceString: string, chunkIndex: number): string {
  if (chunkIndex < 0 || chunkIndex > 255) {
    throw new Error("Chunk index must be between 0 and 255");
  }

  // Get base UUID (with last byte = 0)
  const baseUUID = stringToBaseUUID(sourceString);

  // Convert UUID to bytes
  const hex = baseUUID.replace(/-/g, "");
  const bytes = Buffer.from(hex, "hex");

  // Set last byte to chunk index
  bytes[15] = chunkIndex;

  // Convert back to UUID string
  const newHex = bytes.toString("hex");
  return `${newHex.slice(0, 8)}-${newHex.slice(8, 12)}-${newHex.slice(12, 16)}-${newHex.slice(16, 20)}-${newHex.slice(20, 32)}`;
}

/**
 * Validates whether a chunk should be included in the final output.
 *
 * Filters out:
 * 1. Empty or whitespace-only chunks
 * 2. Markdown code fences (``` or ~~~)
 * 3. Punctuation-only content
 * 4. Standalone headings with no body text
 *
 * @param content - The chunk content to validate
 * @returns true if chunk is valid, false if it should be filtered out
 */
export function isValidChunk(content: string): boolean {
  const trimmed = content.trim();

  // Filter out empty or whitespace-only chunks
  if (trimmed.length === 0) return false;

  // Filter out chunks that are just markdown fences
  if (trimmed === "```" || trimmed === "~~~") return false;

  // Filter out chunks that are just punctuation/symbols
  if (/^[^\w\s]+$/.test(trimmed)) return false;

  // Filter out chunks that are just a single heading with no content
  // Matches: # Heading, ## Heading, etc. with nothing after
  if (/^#{1,6}\s+.+$/.test(trimmed) && !trimmed.includes("\n")) return false;

  // Also catch headings that only have whitespace after them
  const lines = trimmed.split("\n").filter((line) => line.trim().length > 0);
  // biome-ignore lint/style/noNonNullAssertion: Index 0 is guaranteed to exist when length === 1
  if (lines.length === 1 && /^#{1,6}\s+.+$/.test(lines[0]!)) return false;

  return true;
}

/**
 * Split markdown content into chunks suitable for embeddings.
 *
 * This function intelligently splits markdown files into chunks by:
 * - Using a two-stage splitting approach (markdown-aware, then character-based)
 * - Respecting markdown document structure
 * - Generating stable, deterministic UUIDs for chunks (when source is provided)
 * - Filtering out invalid content (empty, fences, punctuation-only, standalone headings)
 * - Preserving metadata through the splitting process
 *
 * @param content - The markdown content to split
 * @param source - Optional source identifier for deterministic UUID generation
 * @param metadata - Optional metadata to attach to all chunks
 * @param options - Configuration for chunk sizes and overlap
 * @returns Array of chunk objects with id, content, metadata, index, and length
 * @throws Error if document produces more than 255 chunks (when source is provided)
 *
 * @example
 * ```typescript
 * const chunks = await splitMarkdown(
 *   markdownText,
 *   'document-id',
 *   { filename: 'example.md' },
 *   { minChunkSize: 300, maxChunkSize: 1000, chunkOverlap: 100 }
 * );
 * ```
 */
export async function splitMarkdown(
  content: string,
  source: string | undefined,
  // biome-ignore lint/suspicious/noExplicitAny: Metadata structure is dynamic and unknown
  metadata: Record<string, any>,
  options: SplitMarkdownOptions,
): Promise<Chunk[]> {
  // Handle empty content
  if (!content || content.trim().length === 0) {
    return [];
  }

  // Split the content using two-stage approach
  const chunks = await smartSplitMarkdown(content, options);

  // Filter and process chunks
  const validChunks = chunks
    .filter((chunk) => isValidChunk(chunk.pageContent))
    .map((chunk, index) => {
      // Validate chunk index doesn't exceed 255 (byte limitation)
      if (source && index > 255) {
        throw new Error(`Document produces ${chunks.length} chunks, exceeding maximum of 255 chunks per document`);
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
