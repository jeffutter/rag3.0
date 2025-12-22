/**
 * Text processing utility functions.
 *
 * This module provides pure utility functions for text manipulation operations
 * used across the RAG pipeline.
 */

/**
 * Appends an end-of-text (EOT) token to content if provided.
 *
 * This is useful for certain embedding models like qwen3 that require
 * end-of-text markers to properly process text chunks.
 *
 * @param content - The text content to process
 * @param eotToken - Optional end-of-text token to append (e.g., '<|endoftext|>')
 * @returns The content with the EOT token appended if provided, otherwise the original content
 *
 * @throws {TypeError} If content is not a string
 *
 * @example
 * ```typescript
 * const result = addEOT('Some text', '<|endoftext|>');
 * // Returns: 'Some text<|endoftext|>'
 *
 * const unchanged = addEOT('Some text');
 * // Returns: 'Some text'
 * ```
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
