/**
 * File I/O utility functions.
 *
 * This module provides pure utility functions for file operations,
 * abstracted from pipeline-specific logic.
 */

/**
 * Result of reading a file.
 */
export interface FileReadResult {
  /** The content of the file as a string */
  content: string;
  /** The source path of the file */
  source: string;
}

/**
 * Reads a file from the filesystem using Bun's file API.
 *
 * @param path - The path to the file to read
 * @returns A promise that resolves to the file content and source path
 * @throws {Error} If the file does not exist or cannot be read
 *
 * @example
 * ```typescript
 * const result = await readFile('./docs/example.md');
 * console.log(result.content); // file contents
 * console.log(result.source);  // './docs/example.md'
 * ```
 */
export async function readFile(path: string): Promise<FileReadResult> {
  // Use Bun.file() to read the file
  const file = Bun.file(path);

  // Check if file exists
  if (!(await file.exists())) {
    throw new Error(`File not found: ${path}`);
  }

  // Read file content as text
  const content = await file.text();

  return {
    content,
    source: path,
  };
}
