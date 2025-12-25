/**
 * Log sanitization utilities for truncating large data structures in logs.
 *
 * Provides intelligent truncation of:
 * - Large arrays (show length + first N items)
 * - Deep objects (limit depth, show keys beyond threshold)
 * - Long strings (truncate with character count)
 * - Embedding vectors (show dimension + sample)
 *
 * Used to make debug logs more readable while preserving the ability to see
 * full payloads when needed via LOG_SANITIZE=false.
 */

export interface SanitizeOptions {
  /** Maximum number of array items to show */
  maxArrayLength: number;
  /** Maximum string length before truncation */
  maxStringLength: number;
  /** Maximum object depth before showing keys only */
  maxDepth: number;
  /** Current depth (internal, for recursion tracking) */
  currentDepth: number;
  /** Keys that should never be truncated (e.g., id, score) */
  preserveKeys: string[];
  /** Keys that should always be truncated (e.g., embedding, payload) */
  truncateKeys: string[];
}

const DEFAULT_OPTIONS: SanitizeOptions = {
  maxArrayLength: 3,
  maxStringLength: 500,
  maxDepth: 3,
  currentDepth: 0,
  preserveKeys: ["id", "score", "event", "component", "traceId", "spanId"],
  truncateKeys: ["embedding", "vector", "payload", "results", "rawResponse", "fullParams"],
};

/**
 * Detect if a value is likely an embedding vector.
 * Embeddings are numeric arrays with typical dimensions (384, 768, 1024, 1536, etc.)
 */
export function isEmbedding(value: unknown): value is number[] {
  if (!Array.isArray(value)) return false;
  if (value.length === 0) return false;

  // Check if all elements are numbers
  if (!value.every((v) => typeof v === "number")) return false;

  // Common embedding dimensions
  const commonDimensions = [384, 512, 768, 1024, 1536, 3072];
  if (commonDimensions.includes(value.length)) return true;

  // Also consider it an embedding if it's a large array of numbers
  return value.length > 100;
}

/**
 * Truncate an embedding vector to show dimension and sample values.
 */
export function truncateEmbedding(embedding: number[]): string {
  const sample = embedding.slice(0, 3).map((v) => v.toFixed(3));
  return `[Embedding: dim=${embedding.length}, sample=[${sample.join(", ")}, ...]]`;
}

/**
 * Truncate a string to maximum length with ellipsis and character count.
 */
export function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;

  const truncated = str.slice(0, maxLength);
  return `${truncated}... [truncated: ${str.length} chars total]`;
}

/**
 * Truncate an array to show length and first N items.
 */
export function truncateArray(arr: unknown[], options: SanitizeOptions): unknown {
  // Check if it's an embedding first
  if (isEmbedding(arr)) {
    return truncateEmbedding(arr);
  }

  // Empty arrays are fine
  if (arr.length === 0) return arr;

  // If array is within limits, process items recursively
  if (arr.length <= options.maxArrayLength) {
    return arr.map((item) => sanitizeForLogging(item, { ...options, currentDepth: options.currentDepth + 1 }));
  }

  // Truncate array
  const items = arr
    .slice(0, options.maxArrayLength)
    .map((item) => sanitizeForLogging(item, { ...options, currentDepth: options.currentDepth + 1 }));

  return {
    __arrayInfo__: {
      length: arr.length,
      showing: options.maxArrayLength,
      items,
    },
  };
}

/**
 * Truncate an object by limiting depth and showing keys beyond threshold.
 */
export function truncateObject(obj: Record<string, unknown>, options: SanitizeOptions): Record<string, unknown> {
  // If we've exceeded max depth, just show keys
  if (options.currentDepth >= options.maxDepth) {
    return {
      __keys__: Object.keys(obj),
      __depth__: "max depth exceeded",
    };
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    // Check if this key should be preserved without truncation
    if (options.preserveKeys.includes(key)) {
      result[key] = value;
      continue;
    }

    // Check if this key should always be truncated
    if (options.truncateKeys.includes(key)) {
      if (Array.isArray(value)) {
        result[key] = truncateArray(value, { ...options, maxArrayLength: 1 });
      } else if (typeof value === "object" && value !== null) {
        result[key] = { __keys__: Object.keys(value as Record<string, unknown>) };
      } else {
        result[key] = value;
      }
      continue;
    }

    // Process normally
    result[key] = sanitizeForLogging(value, {
      ...options,
      currentDepth: options.currentDepth + 1,
    });
  }

  return result;
}

/**
 * Main sanitization function that recursively processes values.
 *
 * @param value - The value to sanitize
 * @param options - Sanitization options (optional, uses defaults if not provided)
 * @returns Sanitized value safe for logging
 */
export function sanitizeForLogging(value: unknown, options: SanitizeOptions = DEFAULT_OPTIONS): unknown {
  // Primitives: null, undefined, boolean, number
  if (value === null || value === undefined) return value;
  if (typeof value === "boolean" || typeof value === "number") return value;

  // Strings: truncate if too long
  if (typeof value === "string") {
    return truncateString(value, options.maxStringLength);
  }

  // Arrays: check for embeddings, then truncate if needed
  if (Array.isArray(value)) {
    return truncateArray(value, options);
  }

  // Objects: recursively sanitize, limiting depth
  if (typeof value === "object") {
    // Handle special cases
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack ? truncateString(value.stack, options.maxStringLength) : undefined,
      };
    }

    // Regular objects
    return truncateObject(value as Record<string, unknown>, options);
  }

  // Functions and other types: convert to string
  return String(value);
}

/**
 * Get sanitization options from environment variables.
 */
export function getSanitizeOptionsFromEnv(): SanitizeOptions {
  return {
    ...DEFAULT_OPTIONS,
    maxArrayLength: process.env.LOG_MAX_ARRAY_LENGTH
      ? Number.parseInt(process.env.LOG_MAX_ARRAY_LENGTH, 10)
      : DEFAULT_OPTIONS.maxArrayLength,
    maxStringLength: process.env.LOG_MAX_STRING_LENGTH
      ? Number.parseInt(process.env.LOG_MAX_STRING_LENGTH, 10)
      : DEFAULT_OPTIONS.maxStringLength,
    maxDepth: process.env.LOG_MAX_DEPTH ? Number.parseInt(process.env.LOG_MAX_DEPTH, 10) : DEFAULT_OPTIONS.maxDepth,
  };
}
