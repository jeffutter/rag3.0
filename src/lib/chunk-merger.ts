import { createLogger } from "../core/logging/logger";
import type { SearchResult } from "../retrieval/qdrant-client";

const logger = createLogger("chunk-merger");

/**
 * Interface for a chunk with parsed metadata.
 */
interface ChunkWithIndex {
  result: SearchResult;
  source: string;
  chunkIndex: number;
  mergedIndexes?: number[];
}

/**
 * Finds the overlap between the end of text1 and the start of text2.
 * Returns the length of the overlap in characters.
 *
 * @param text1 - The first text
 * @param text2 - The second text
 * @param minOverlap - Minimum overlap length to search for (default: 20)
 * @returns The length of the overlap, or 0 if no overlap found
 */
export function findOverlap(text1: string, text2: string, minOverlap = 20): number {
  const maxOverlap = Math.min(text1.length, text2.length, 500); // Cap search at 500 chars

  // Start from longest possible overlap and work down
  for (let overlapLen = maxOverlap; overlapLen >= minOverlap; overlapLen--) {
    const end1 = text1.slice(-overlapLen);
    const start2 = text2.slice(0, overlapLen);

    if (end1 === start2) {
      return overlapLen;
    }
  }

  return 0;
}

/**
 * Merges two chunks with overlap detection.
 * Combines content, calculates weighted average score, and tracks merged indexes.
 *
 * @param chunk1 - The first chunk
 * @param chunk2 - The second chunk
 * @returns A new merged chunk
 */
function mergeChunks(chunk1: ChunkWithIndex, chunk2: ChunkWithIndex): ChunkWithIndex {
  const content1 = String(chunk1.result.payload.content || "");
  const content2 = String(chunk2.result.payload.content || "");

  const overlapLen = findOverlap(content1, content2);

  let mergedContent: string;
  if (overlapLen > 0) {
    // Remove overlap from second chunk
    mergedContent = content1 + content2.slice(overlapLen);

    logger.debug({
      event: "chunks_merged_with_overlap",
      source: chunk1.source,
      chunk1Index: chunk1.chunkIndex,
      chunk2Index: chunk2.chunkIndex,
      overlapLength: overlapLen,
    });
  } else {
    // No overlap found, add a space separator
    mergedContent = `${content1} ${content2}`;

    logger.debug({
      event: "chunks_merged_without_overlap",
      source: chunk1.source,
      chunk1Index: chunk1.chunkIndex,
      chunk2Index: chunk2.chunkIndex,
    });
  }

  // Combine scores (average weighted by content length)
  const len1 = content1.length;
  const len2 = content2.length;
  const totalLen = len1 + len2;
  const combinedScore =
    totalLen > 0
      ? (chunk1.result.score * len1 + chunk2.result.score * len2) / totalLen
      : (chunk1.result.score + chunk2.result.score) / 2;

  // Combine merged indexes
  const mergedIndexes = [
    ...(chunk1.mergedIndexes || [chunk1.chunkIndex]),
    ...(chunk2.mergedIndexes || [chunk2.chunkIndex]),
  ];

  return {
    result: {
      id: chunk1.result.id,
      score: combinedScore,
      payload: {
        ...chunk1.result.payload,
        content: mergedContent,
        // Add metadata about the merge
        mergedIndexes,
        chunkCount: mergedIndexes.length,
      },
    },
    source: chunk1.source,
    chunkIndex: chunk1.chunkIndex,
    mergedIndexes,
  };
}

/**
 * Merges consecutive chunks from the same document after reranking.
 *
 * This function:
 * 1. Groups chunks by their source document (from metadata.source)
 * 2. Extracts chunk index from metadata.chunk_idx (or metadata.index as fallback)
 * 3. Sorts chunks within each document by chunk index
 * 4. Merges adjacent chunks (with configurable gap tolerance)
 * 5. Detects and removes overlap between merged chunks
 * 6. Calculates combined scores as weighted average by content length
 * 7. Tracks which chunks were merged together
 * 8. Returns results sorted by relevance score
 *
 * Note: Chunks without metadata.chunk_idx or metadata.index are skipped with a warning.
 *
 * @param results - Array of search results from reranking (must have metadata.chunk_idx or metadata.index)
 * @param maxIndexGap - Maximum gap between chunk indexes to still consider them adjacent (default: 2)
 * @returns Array of merged search results sorted by score (descending)
 *
 * @example
 * ```typescript
 * const rerankedResults = await rerankDocuments(...);
 * const merged = mergeConsecutiveChunks(rerankedResults);
 * ```
 */
export function mergeConsecutiveChunks(results: SearchResult[], maxIndexGap = 2): SearchResult[] {
  if (results.length === 0) {
    return [];
  }

  logger.debug({
    event: "merge_chunks_start",
    inputCount: results.length,
    maxIndexGap,
  });

  // Parse results and group by source
  const chunksBySource = new Map<string, ChunkWithIndex[]>();

  for (const result of results) {
    // Extract source from metadata or id
    const metadata = result.payload.metadata as Record<string, unknown> | undefined;
    const source = (metadata?.source as string) || String(result.id);

    if (!source) {
      logger.warn({
        event: "chunk_missing_source",
        id: result.id,
      });
      continue;
    }

    // Get chunk index from metadata (try chunk_idx first, then index as fallback)
    let chunkIndex: number | undefined;

    if (metadata?.chunk_idx !== undefined) {
      chunkIndex = Number(metadata.chunk_idx);
    } else if (metadata?.index !== undefined) {
      chunkIndex = Number(metadata.index);
    }

    if (chunkIndex === undefined) {
      logger.warn({
        event: "chunk_missing_index",
        id: result.id,
        source,
        metadata,
      });
      // Skip chunks without index information
      continue;
    }

    const chunk: ChunkWithIndex = {
      result,
      source,
      chunkIndex,
    };

    const chunks = chunksBySource.get(source) || [];
    chunks.push(chunk);
    chunksBySource.set(source, chunks);
  }

  logger.debug({
    event: "chunks_grouped_by_source",
    sourceCount: chunksBySource.size,
    sources: Array.from(chunksBySource.keys()),
  });

  // Process each document's chunks
  const mergedResults: ChunkWithIndex[] = [];

  for (const [source, chunks] of chunksBySource.entries()) {
    // Sort by chunk index
    chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);

    logger.debug({
      event: "processing_source",
      source,
      chunkCount: chunks.length,
      chunkIndexes: chunks.map((c) => c.chunkIndex),
    });

    // Merge adjacent chunks
    // biome-ignore lint/style/noNonNullAssertion: Index 0 is guaranteed to exist when chunks.length > 0
    const merged: ChunkWithIndex[] = [chunks[0]!];

    for (let i = 1; i < chunks.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: Index is guaranteed to exist when i < chunks.length
      const lastMerged = merged[merged.length - 1]!;
      // biome-ignore lint/style/noNonNullAssertion: Index i is guaranteed to exist when i < chunks.length
      const current = chunks[i]!;

      // Get the last index from the merged chunk (handles previously merged chunks)
      const lastIndex = lastMerged.mergedIndexes
        ? // biome-ignore lint/style/noNonNullAssertion: Array is guaranteed to have at least one element
          lastMerged.mergedIndexes[lastMerged.mergedIndexes.length - 1]!
        : lastMerged.chunkIndex;

      const indexDiff = current.chunkIndex - lastIndex;

      if (indexDiff <= maxIndexGap && indexDiff >= 1) {
        // Adjacent or near-adjacent, merge them
        logger.debug({
          event: "merging_chunks",
          source,
          chunk1Index: lastIndex,
          chunk2Index: current.chunkIndex,
          indexDiff,
        });

        merged[merged.length - 1] = mergeChunks(lastMerged, current);
      } else {
        // Not adjacent, keep as separate chunk
        logger.debug({
          event: "keeping_separate",
          source,
          lastIndex,
          currentIndex: current.chunkIndex,
          indexDiff,
        });

        merged.push(current);
      }
    }

    logger.debug({
      event: "source_processed",
      source,
      originalCount: chunks.length,
      mergedCount: merged.length,
      reduction: chunks.length - merged.length,
    });

    mergedResults.push(...merged);
  }

  // Sort by score descending to maintain relevance ranking
  mergedResults.sort((a, b) => b.result.score - a.result.score);

  // Extract just the SearchResult objects
  const finalResults = mergedResults.map((c) => c.result);

  logger.info({
    event: "merge_chunks_complete",
    inputCount: results.length,
    outputCount: finalResults.length,
    reduction: results.length - finalResults.length,
    reductionPercent: Math.round(((results.length - finalResults.length) / results.length) * 100),
  });

  return finalResults;
}
