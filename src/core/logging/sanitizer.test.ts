import { describe, expect, test } from "bun:test";
import {
  getSanitizeOptionsFromEnv,
  isEmbedding,
  type SanitizeOptions,
  sanitizeForLogging,
  truncateArray,
  truncateEmbedding,
  truncateObject,
  truncateString,
} from "./sanitizer.js";

const defaultOptions: SanitizeOptions = {
  maxArrayLength: 3,
  maxStringLength: 500,
  maxDepth: 3,
  currentDepth: 0,
  preserveKeys: ["id", "score", "event", "component", "traceId", "spanId"],
  truncateKeys: ["embedding", "vector", "payload", "results", "rawResponse", "fullParams"],
};

describe("isEmbedding", () => {
  test("detects common embedding dimensions", () => {
    expect(isEmbedding(new Array(384).fill(0.5))).toBe(true);
    expect(isEmbedding(new Array(768).fill(0.5))).toBe(true);
    expect(isEmbedding(new Array(1536).fill(0.5))).toBe(true);
  });

  test("detects large numeric arrays as embeddings", () => {
    expect(isEmbedding(new Array(200).fill(0.5))).toBe(true);
  });

  test("rejects non-arrays", () => {
    expect(isEmbedding("not an array")).toBe(false);
    expect(isEmbedding({ 0: 1, 1: 2 })).toBe(false);
  });

  test("rejects arrays with non-numeric values", () => {
    expect(isEmbedding([1, 2, "3"])).toBe(false);
    expect(isEmbedding([1, null, 3])).toBe(false);
  });

  test("rejects small numeric arrays", () => {
    expect(isEmbedding([1, 2, 3])).toBe(false);
    expect(isEmbedding([1, 2, 3, 4, 5])).toBe(false);
  });

  test("rejects empty arrays", () => {
    expect(isEmbedding([])).toBe(false);
  });
});

describe("truncateEmbedding", () => {
  test("shows dimension and sample values", () => {
    const embedding = [0.123456, -0.987654, 0.555555, 0.1, 0.2];
    const result = truncateEmbedding(embedding);

    expect(result).toContain("dim=5");
    expect(result).toContain("0.123");
    expect(result).toContain("-0.988");
    expect(result).toContain("0.556");
  });

  test("handles large embeddings", () => {
    const embedding = new Array(768).fill(0.5);
    const result = truncateEmbedding(embedding);

    expect(result).toContain("dim=768");
    expect(result).toContain("sample=");
  });
});

describe("truncateString", () => {
  test("preserves short strings", () => {
    const short = "hello world";
    expect(truncateString(short, 500)).toBe(short);
  });

  test("truncates long strings", () => {
    const long = "a".repeat(1000);
    const result = truncateString(long, 500);

    expect(result).toContain("...");
    expect(result).toContain("1000 chars total");
    expect(result.length).toBeLessThan(long.length);
  });

  test("handles exactly max length", () => {
    const exact = "a".repeat(500);
    expect(truncateString(exact, 500)).toBe(exact);
  });
});

describe("truncateArray", () => {
  test("preserves small arrays", () => {
    const small = [1, 2, 3];
    const result = truncateArray(small, defaultOptions);

    expect(result).toEqual([1, 2, 3]);
  });

  test("truncates large arrays", () => {
    const large = Array.from({ length: 100 }, (_, i) => i);
    const result = truncateArray(large, defaultOptions);

    expect(result).toHaveProperty("__arrayInfo__");
    const info = (result as { __arrayInfo__: { length: number; showing: number; items: number[] } }).__arrayInfo__;

    expect(info.length).toBe(100);
    expect(info.showing).toBe(3);
    expect(info.items).toHaveLength(3);
    expect(info.items).toEqual([0, 1, 2]);
  });

  test("detects and truncates embeddings", () => {
    const embedding = new Array(768).fill(0.5);
    const result = truncateArray(embedding, defaultOptions);

    expect(typeof result).toBe("string");
    expect(result).toContain("Embedding");
    expect(result).toContain("dim=768");
  });

  test("handles empty arrays", () => {
    const empty: unknown[] = [];
    const result = truncateArray(empty, defaultOptions);

    expect(result).toEqual([]);
  });

  test("recursively sanitizes array items", () => {
    const nested = [{ foo: "bar" }, { baz: "qux" }];
    const result = truncateArray(nested, defaultOptions);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
  });
});

describe("truncateObject", () => {
  test("preserves shallow objects", () => {
    const shallow = { id: "123", name: "test" };
    const result = truncateObject(shallow, defaultOptions);

    expect(result).toEqual(shallow);
  });

  test("limits object depth", () => {
    const deep = {
      level1: {
        level2: {
          level3: {
            level4: {
              level5: "too deep",
            },
          },
        },
      },
    };

    const result = truncateObject(deep, defaultOptions);

    expect(result).toHaveProperty("level1");
    expect(result.level1 as Record<string, unknown>).toHaveProperty("level2");

    // At depth 3, we should see keys instead of full object
    const level3 = (result.level1 as Record<string, unknown>).level2 as Record<string, unknown>;
    expect(level3.level3).toHaveProperty("__keys__");
  });

  test("preserves specified keys without truncation", () => {
    const obj = {
      id: "very-long-id-that-would-normally-be-truncated-but-should-be-preserved",
      score: 0.999999,
      data: "x".repeat(1000),
    };

    const result = truncateObject(obj, defaultOptions);

    expect(result.id).toBe(obj.id); // Not truncated
    expect(result.score).toBe(obj.score); // Not truncated
    expect((result.data as string).length).toBeLessThan(obj.data.length); // Truncated
  });

  test("always truncates specified keys", () => {
    const obj = {
      embedding: [1, 2, 3, 4, 5],
      payload: { foo: "bar", baz: "qux" },
      normalField: [1, 2, 3],
    };

    const result = truncateObject(obj, defaultOptions);

    // embedding should be truncated more aggressively
    expect(result.embedding).toHaveProperty("__arrayInfo__");
    const embedInfo = (result.embedding as { __arrayInfo__: { showing: number } }).__arrayInfo__;
    expect(embedInfo.showing).toBe(1);

    // payload should show keys only
    expect(result.payload).toHaveProperty("__keys__");

    // normalField should be preserved (within limits)
    expect(Array.isArray(result.normalField)).toBe(true);
  });
});

describe("sanitizeForLogging", () => {
  test("preserves primitives", () => {
    expect(sanitizeForLogging(null)).toBe(null);
    expect(sanitizeForLogging(undefined)).toBe(undefined);
    expect(sanitizeForLogging(true)).toBe(true);
    expect(sanitizeForLogging(42)).toBe(42);
  });

  test("truncates long strings", () => {
    const long = "x".repeat(1000);
    const result = sanitizeForLogging(long);

    expect(typeof result).toBe("string");
    expect((result as string).length).toBeLessThan(long.length);
    expect(result).toContain("...");
  });

  test("handles dates", () => {
    const date = new Date("2024-01-01T12:00:00Z");
    const result = sanitizeForLogging(date);

    expect(result).toBe(date.toISOString());
  });

  test("handles errors", () => {
    const error = new Error("Test error");
    const result = sanitizeForLogging(error) as {
      name: string;
      message: string;
      stack?: string;
    };

    expect(result).toHaveProperty("name", "Error");
    expect(result).toHaveProperty("message", "Test error");
    expect(result).toHaveProperty("stack");
  });

  test("sanitizes complex nested structures", () => {
    const complex = {
      event: "test_event",
      id: "123",
      embedding: new Array(768).fill(0.5),
      results: Array.from({ length: 100 }, (_, i) => ({
        id: `item-${i}`,
        score: i / 100,
        payload: {
          content: "x".repeat(1000),
          metadata: { key: "value" },
        },
      })),
      metadata: {
        level1: {
          level2: {
            level3: {
              level4: "too deep",
            },
          },
        },
      },
    };

    const result = sanitizeForLogging(complex) as Record<string, unknown>;

    // Preserved fields
    expect(result.event).toBe("test_event");
    expect(result.id).toBe("123");

    // Truncated embedding
    expect(typeof result.embedding).toBe("string");
    expect(result.embedding).toContain("Embedding");

    // Truncated results array
    expect(result.results).toHaveProperty("__arrayInfo__");

    // Depth-limited metadata
    expect(result).toHaveProperty("metadata");
  });

  test("handles arrays of primitives", () => {
    const primitives = [1, 2, 3, 4, 5];
    const result = sanitizeForLogging(primitives);

    expect(result).toHaveProperty("__arrayInfo__");
    const info = (result as { __arrayInfo__: { length: number; showing: number; items: number[] } }).__arrayInfo__;

    expect(info.length).toBe(5);
    expect(info.showing).toBe(3);
    expect(info.items).toEqual([1, 2, 3]);
  });

  test("handles arrays of objects", () => {
    const objects = [
      { id: "1", name: "one" },
      { id: "2", name: "two" },
      { id: "3", name: "three" },
      { id: "4", name: "four" },
    ];

    const result = sanitizeForLogging(objects);

    expect(result).toHaveProperty("__arrayInfo__");
    const info = (result as { __arrayInfo__: { length: number; showing: number } }).__arrayInfo__;

    expect(info.length).toBe(4);
    expect(info.showing).toBe(3);
  });

  test("respects custom options", () => {
    const customOptions: SanitizeOptions = {
      ...defaultOptions,
      maxArrayLength: 5,
      maxStringLength: 100,
      maxDepth: 2,
    };

    const data = {
      items: [1, 2, 3, 4, 5, 6],
      text: "x".repeat(200),
      nested: {
        level1: {
          level2: {
            level3: "too deep",
          },
        },
      },
    };

    const result = sanitizeForLogging(data, customOptions) as Record<string, unknown>;

    // Array should show 5 items
    const itemsInfo = (result.items as { __arrayInfo__: { showing: number } }).__arrayInfo__;
    expect(itemsInfo.showing).toBe(5);

    // String should be truncated at 100
    expect((result.text as string).length).toBeLessThan(200);

    // Depth should be limited to 2 (nested counts as depth 0, level1 as depth 1, level2 should be truncated)
    const nested = result.nested as Record<string, unknown>;
    expect(nested.level1).toHaveProperty("__keys__");
  });
});

describe("getSanitizeOptionsFromEnv", () => {
  test("uses defaults when no env vars set", () => {
    const original = {
      LOG_MAX_ARRAY_LENGTH: process.env.LOG_MAX_ARRAY_LENGTH,
      LOG_MAX_STRING_LENGTH: process.env.LOG_MAX_STRING_LENGTH,
      LOG_MAX_DEPTH: process.env.LOG_MAX_DEPTH,
    };

    delete process.env.LOG_MAX_ARRAY_LENGTH;
    delete process.env.LOG_MAX_STRING_LENGTH;
    delete process.env.LOG_MAX_DEPTH;

    const options = getSanitizeOptionsFromEnv();

    expect(options.maxArrayLength).toBe(3);
    expect(options.maxStringLength).toBe(500);
    expect(options.maxDepth).toBe(3);

    // Restore
    process.env.LOG_MAX_ARRAY_LENGTH = original.LOG_MAX_ARRAY_LENGTH;
    process.env.LOG_MAX_STRING_LENGTH = original.LOG_MAX_STRING_LENGTH;
    process.env.LOG_MAX_DEPTH = original.LOG_MAX_DEPTH;
  });

  test("reads from environment variables", () => {
    const original = {
      LOG_MAX_ARRAY_LENGTH: process.env.LOG_MAX_ARRAY_LENGTH,
      LOG_MAX_STRING_LENGTH: process.env.LOG_MAX_STRING_LENGTH,
      LOG_MAX_DEPTH: process.env.LOG_MAX_DEPTH,
    };

    process.env.LOG_MAX_ARRAY_LENGTH = "10";
    process.env.LOG_MAX_STRING_LENGTH = "1000";
    process.env.LOG_MAX_DEPTH = "5";

    const options = getSanitizeOptionsFromEnv();

    expect(options.maxArrayLength).toBe(10);
    expect(options.maxStringLength).toBe(1000);
    expect(options.maxDepth).toBe(5);

    // Restore
    process.env.LOG_MAX_ARRAY_LENGTH = original.LOG_MAX_ARRAY_LENGTH;
    process.env.LOG_MAX_STRING_LENGTH = original.LOG_MAX_STRING_LENGTH;
    process.env.LOG_MAX_DEPTH = original.LOG_MAX_DEPTH;
  });
});
