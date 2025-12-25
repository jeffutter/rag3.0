import { describe, expect, test } from "bun:test";
import type { SearchResult } from "../retrieval/qdrant-client";
import { findOverlap, mergeConsecutiveChunks } from "./chunk-merger";
import { getChunkUUID } from "./markdown";

describe("findOverlap", () => {
  test("finds exact overlap at the end/start", () => {
    const text1 = "This is a test with some overlap text here";
    const text2 = "with some overlap text here and more content";

    // Default minOverlap is 20, so we need at least 20 chars
    const overlap = findOverlap(text1, text2);
    expect(overlap).toBe(27); // "with some overlap text here"
  });

  test("returns 0 when no overlap exists", () => {
    const text1 = "This is text one";
    const text2 = "This is completely different text";

    const overlap = findOverlap(text1, text2);
    expect(overlap).toBe(0);
  });

  test("respects minimum overlap threshold", () => {
    const text1 = "This is a test with tiny";
    const text2 = "tiny overlap";

    // With default minOverlap of 20, should find nothing
    expect(findOverlap(text1, text2)).toBe(0);

    // With minOverlap of 4, should find "tiny"
    expect(findOverlap(text1, text2, 4)).toBe(4);
  });

  test("caps search at 500 characters", () => {
    // Create a long overlap (600 chars)
    const longText = "a".repeat(600);
    const text1 = `start ${longText}`;
    const text2 = `${longText} end`;

    const overlap = findOverlap(text1, text2);
    // Should find at most 500 chars overlap
    expect(overlap).toBeLessThanOrEqual(500);
    expect(overlap).toBeGreaterThan(0);
  });
});

describe("mergeConsecutiveChunks", () => {
  test("merges consecutive chunks from the same source", () => {
    const source = "document.md";
    const results: SearchResult[] = [
      {
        id: getChunkUUID(source, 0),
        score: 0.9,
        payload: {
          content: "This is chunk zero with some overlap text that is long enough",
          metadata: {
            source,
            chunk_idx: 0,
          },
        },
      },
      {
        id: getChunkUUID(source, 1),
        score: 0.85,
        payload: {
          content: "with some overlap text that is long enough and this is chunk one",
          metadata: {
            source,
            chunk_idx: 1,
          },
        },
      },
    ];

    const merged = mergeConsecutiveChunks(results);

    expect(merged.length).toBe(1);
    expect(merged[0]?.payload.content).toContain("chunk zero");
    expect(merged[0]?.payload.content).toContain("chunk one");
    // Should have removed the overlap (only appears once, not duplicated)
    const content = String(merged[0]?.payload.content || "");
    const overlapText = "with some overlap text that is long enough";
    const firstOccurrence = content.indexOf(overlapText);
    const secondOccurrence = content.indexOf(overlapText, firstOccurrence + 1);
    expect(secondOccurrence).toBe(-1); // Should not find a second occurrence
  });

  test("keeps non-consecutive chunks separate", () => {
    const source = "document.md";
    const results: SearchResult[] = [
      {
        id: getChunkUUID(source, 0),
        score: 0.9,
        payload: {
          content: "This is chunk zero",
          metadata: {
            source,
            chunk_idx: 0,
          },
        },
      },
      {
        id: getChunkUUID(source, 5), // Gap of 5
        score: 0.85,
        payload: {
          content: "This is chunk five",
          metadata: {
            source,
            chunk_idx: 5,
          },
        },
      },
    ];

    const merged = mergeConsecutiveChunks(results);

    // Should not merge due to large gap (default maxIndexGap is 2)
    expect(merged.length).toBe(2);
  });

  test("merges chunks with small gaps when within maxIndexGap", () => {
    const source = "document.md";
    const results: SearchResult[] = [
      {
        id: getChunkUUID(source, 0),
        score: 0.9,
        payload: {
          content: "This is chunk zero",
          metadata: {
            source,
            chunk_idx: 0,
          },
        },
      },
      {
        id: getChunkUUID(source, 2), // Gap of 2
        score: 0.85,
        payload: {
          content: "This is chunk two",
          metadata: {
            source,
            chunk_idx: 2,
          },
        },
      },
    ];

    const merged = mergeConsecutiveChunks(results);

    // Should merge because gap of 2 is within default maxIndexGap of 2
    expect(merged.length).toBe(1);
    expect(merged[0]?.payload.mergedIndexes).toEqual([0, 2]);
  });

  test("keeps chunks from different sources separate", () => {
    const results: SearchResult[] = [
      {
        id: getChunkUUID("doc1.md", 0),
        score: 0.9,
        payload: {
          content: "This is from doc1",
          metadata: {
            source: "doc1.md",
            chunk_idx: 0,
          },
        },
      },
      {
        id: getChunkUUID("doc2.md", 0),
        score: 0.85,
        payload: {
          content: "This is from doc2",
          metadata: {
            source: "doc2.md",
            chunk_idx: 0,
          },
        },
      },
    ];

    const merged = mergeConsecutiveChunks(results);

    // Should not merge chunks from different sources
    expect(merged.length).toBe(2);
  });

  test("calculates weighted average score", () => {
    const source = "document.md";
    const results: SearchResult[] = [
      {
        id: getChunkUUID(source, 0),
        score: 1.0,
        payload: {
          content: "Short", // 5 chars
          metadata: {
            source,
            chunk_idx: 0,
          },
        },
      },
      {
        id: getChunkUUID(source, 1),
        score: 0.5,
        payload: {
          content: "This is much longer content", // 27 chars
          metadata: {
            source,
            chunk_idx: 1,
          },
        },
      },
    ];

    const merged = mergeConsecutiveChunks(results);

    expect(merged.length).toBe(1);

    // Weighted average: (1.0 * 5 + 0.5 * 27) / (5 + 27) = 18.5 / 32 ≈ 0.578
    const expectedScore = (1.0 * 5 + 0.5 * 27) / 32;
    expect(merged[0]?.score).toBeCloseTo(expectedScore, 2);
  });

  test("maintains relevance ranking after merging", () => {
    const source = "document.md";
    const results: SearchResult[] = [
      {
        id: getChunkUUID(source, 10),
        score: 0.7, // Lower score
        payload: {
          content: "Chunk 10",
          metadata: {
            source,
            chunk_idx: 10,
          },
        },
      },
      {
        id: getChunkUUID(source, 11),
        score: 0.65,
        payload: {
          content: "Chunk 11",
          metadata: {
            source,
            chunk_idx: 11,
          },
        },
      },
      {
        id: getChunkUUID(source, 0),
        score: 0.95, // Higher score
        payload: {
          content: "Chunk 0",
          metadata: {
            source,
            chunk_idx: 0,
          },
        },
      },
      {
        id: getChunkUUID(source, 1),
        score: 0.9,
        payload: {
          content: "Chunk 1",
          metadata: {
            source,
            chunk_idx: 1,
          },
        },
      },
    ];

    const merged = mergeConsecutiveChunks(results);

    // Should have 2 merged chunks: (0+1) and (10+11)
    // because there's a large gap between 1 and 10
    expect(merged.length).toBe(2);

    // Results should be sorted by score (descending)
    expect(merged[0]?.score).toBeGreaterThan(merged[1]?.score || 0);
  });

  test("tracks merged indexes", () => {
    const source = "document.md";
    const results: SearchResult[] = [
      {
        id: getChunkUUID(source, 0),
        score: 0.9,
        payload: {
          content: "Chunk 0",
          metadata: {
            source,
            chunk_idx: 0,
          },
        },
      },
      {
        id: getChunkUUID(source, 1),
        score: 0.85,
        payload: {
          content: "Chunk 1",
          metadata: {
            source,
            chunk_idx: 1,
          },
        },
      },
      {
        id: getChunkUUID(source, 2),
        score: 0.8,
        payload: {
          content: "Chunk 2",
          metadata: {
            source,
            chunk_idx: 2,
          },
        },
      },
    ];

    const merged = mergeConsecutiveChunks(results);

    expect(merged.length).toBe(1);
    expect(merged[0]?.payload.mergedIndexes).toEqual([0, 1, 2]);
    expect(merged[0]?.payload.chunkCount).toBe(3);
  });

  test("handles empty input", () => {
    const merged = mergeConsecutiveChunks([]);
    expect(merged).toEqual([]);
  });

  test("skips chunks without chunk index", () => {
    const results: SearchResult[] = [
      {
        id: "some-uuid-1",
        score: 0.9,
        payload: {
          content: "Chunk without chunk index",
          metadata: {
            source: "doc.md",
            // No chunk_idx or index field
          },
        },
      },
    ];

    const merged = mergeConsecutiveChunks(results);

    // Should skip chunks without chunk index
    expect(merged.length).toBe(0);
  });

  test("uses metadata.index as fallback if chunk_idx not available", () => {
    const results: SearchResult[] = [
      {
        id: "random-uuid-1",
        score: 0.9,
        payload: {
          content: "Chunk 0",
          metadata: {
            source: "doc.md",
            index: 0, // Using index instead of chunk_idx
          },
        },
      },
      {
        id: "random-uuid-2",
        score: 0.85,
        payload: {
          content: "Chunk 1",
          metadata: {
            source: "doc.md",
            index: 1,
          },
        },
      },
    ];

    const merged = mergeConsecutiveChunks(results);

    // Should merge based on metadata.index fallback
    expect(merged.length).toBe(1);
    expect(merged[0]?.payload.mergedIndexes).toEqual([0, 1]);
  });
});
