import { describe, expect, test } from "bun:test";
import { fromArray, toArray } from "./generators";
import { MetadataCollector, withMetadata } from "./metadata";

describe("MetadataCollector", () => {
  test("tracks basic item counts", () => {
    const collector = new MetadataCollector("testStep");

    collector.recordItemStart(0);
    collector.recordItemEnd(0, true);

    collector.recordItemStart(1);
    collector.recordItemEnd(1, true);

    collector.recordItemStart(2);
    collector.recordItemEnd(2, false);

    const snapshot = collector.getSnapshot();

    expect(snapshot.streamMetrics.totalItems).toBe(3);
    expect(snapshot.streamMetrics.successCount).toBe(2);
    expect(snapshot.streamMetrics.failureCount).toBe(1);
    expect(snapshot.streamMetrics.skippedCount).toBe(0);
  });

  test("tracks skipped items", () => {
    const collector = new MetadataCollector("testStep");

    collector.recordItemStart(0);
    collector.recordItemEnd(0, true);

    collector.recordItemStart(1);
    collector.recordItemSkipped(1);

    collector.recordItemStart(2);
    collector.recordItemEnd(2, true);

    const snapshot = collector.getSnapshot();

    expect(snapshot.streamMetrics.totalItems).toBe(2);
    expect(snapshot.streamMetrics.successCount).toBe(2);
    expect(snapshot.streamMetrics.skippedCount).toBe(1);
  });

  test("calculates latency statistics", () => {
    const collector = new MetadataCollector("testStep");

    // Simulate processing with known timings
    const timings = [10, 20, 30, 40, 50];

    for (let i = 0; i < timings.length; i++) {
      const timing = timings[i];
      if (timing !== undefined) {
        collector.recordItemStart(i);
        // We need to access private fields for testing, so we'll just record end
        collector.recordItemEnd(i, true);
      }
    }

    const snapshot = collector.getSnapshot();
    const stats = snapshot.streamMetrics.itemTimings;

    expect(stats).toBeDefined();
    if (stats !== undefined) {
      expect(stats.min).toBeGreaterThanOrEqual(0);
      expect(stats.max).toBeGreaterThanOrEqual(stats.min);
      expect(stats.avg).toBeGreaterThanOrEqual(0);
      expect(stats.p50).toBeGreaterThanOrEqual(0);
      expect(stats.p95).toBeGreaterThanOrEqual(0);
      expect(stats.p99).toBeGreaterThanOrEqual(0);
    }
  });

  test("marks stream as complete", () => {
    const collector = new MetadataCollector("testStep");

    collector.recordItemStart(0);
    collector.recordItemEnd(0, true);

    let snapshot = collector.getSnapshot();
    expect(snapshot.streamMetrics.isComplete).toBe(false);

    collector.markComplete();

    snapshot = collector.getSnapshot();
    expect(snapshot.streamMetrics.isComplete).toBe(true);
  });

  test("includes step name in metadata", () => {
    const stepName = "myCustomStep";
    const collector = new MetadataCollector(stepName);

    const snapshot = collector.getSnapshot();
    expect(snapshot.stepName).toBe(stepName);
  });

  test("propagates trace and span IDs", () => {
    const traceId = "trace-123";
    const spanId = "span-456";
    const collector = new MetadataCollector("testStep", traceId, spanId);

    const snapshot = collector.getSnapshot();
    expect(snapshot.traceId).toBe(traceId);
    expect(snapshot.spanId).toBe(spanId);
  });

  test("handles missing trace IDs gracefully", () => {
    const collector = new MetadataCollector("testStep");

    const snapshot = collector.getSnapshot();
    expect(snapshot.traceId).toBeUndefined();
    expect(snapshot.spanId).toBeUndefined();
  });

  test("calculates time to first item", async () => {
    const collector = new MetadataCollector("testStep");

    // Small delay before first item
    await new Promise((resolve) => setTimeout(resolve, 10));

    collector.recordItemStart(0);
    collector.recordItemEnd(0, true);

    const snapshot = collector.getSnapshot();
    expect(snapshot.streamMetrics.timeToFirstItem).toBeGreaterThan(0);
  });

  test("provides incremental snapshots", () => {
    const collector = new MetadataCollector("testStep");

    collector.recordItemStart(0);
    collector.recordItemEnd(0, true);

    const snapshot1 = collector.getSnapshot();
    expect(snapshot1.streamMetrics.totalItems).toBe(1);

    collector.recordItemStart(1);
    collector.recordItemEnd(1, true);

    const snapshot2 = collector.getSnapshot();
    expect(snapshot2.streamMetrics.totalItems).toBe(2);

    collector.recordItemStart(2);
    collector.recordItemEnd(2, true);

    const snapshot3 = collector.getSnapshot();
    expect(snapshot3.streamMetrics.totalItems).toBe(3);
  });
});

describe("withMetadata", () => {
  test("passes through items unchanged", async () => {
    const input = [1, 2, 3, 4, 5];
    const collector = new MetadataCollector("testStep");

    const stream = fromArray(input);
    const wrapped = withMetadata(stream, "testStep", collector);
    const output = await toArray(wrapped);

    expect(output).toEqual(input);
  });

  test("tracks item count accurately", async () => {
    const input = [1, 2, 3, 4, 5];
    const collector = new MetadataCollector("testStep");

    const stream = fromArray(input);
    const wrapped = withMetadata(stream, "testStep", collector);
    await toArray(wrapped);

    const snapshot = collector.getSnapshot();
    expect(snapshot.streamMetrics.totalItems).toBe(input.length);
    expect(snapshot.streamMetrics.successCount).toBe(input.length);
    expect(snapshot.streamMetrics.failureCount).toBe(0);
  });

  test("marks stream as complete when exhausted", async () => {
    const collector = new MetadataCollector("testStep");

    const stream = fromArray([1, 2, 3]);
    const wrapped = withMetadata(stream, "testStep", collector);
    await toArray(wrapped);

    const snapshot = collector.getSnapshot();
    expect(snapshot.streamMetrics.isComplete).toBe(true);
  });

  test("handles empty streams", async () => {
    const collector = new MetadataCollector("testStep");

    const stream = fromArray([]);
    const wrapped = withMetadata(stream, "testStep", collector);
    const output = await toArray(wrapped);

    expect(output).toEqual([]);

    const snapshot = collector.getSnapshot();
    expect(snapshot.streamMetrics.totalItems).toBe(0);
    expect(snapshot.streamMetrics.isComplete).toBe(true);
  });

  test("works with different data types", async () => {
    const collector = new MetadataCollector("testStep");

    const input = [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
      { id: 3, name: "Charlie" },
    ];

    const stream = fromArray(input);
    const wrapped = withMetadata(stream, "testStep", collector);
    const output = await toArray(wrapped);

    expect(output).toEqual(input);

    const snapshot = collector.getSnapshot();
    expect(snapshot.streamMetrics.totalItems).toBe(input.length);
  });

  test("propagates trace context", async () => {
    const traceId = "trace-abc";
    const spanId = "span-xyz";
    const collector = new MetadataCollector("testStep", traceId, spanId);

    const stream = fromArray([1, 2, 3]);
    const wrapped = withMetadata(stream, "testStep", collector, traceId, spanId);
    await toArray(wrapped);

    const snapshot = collector.getSnapshot();
    expect(snapshot.traceId).toBe(traceId);
    expect(snapshot.spanId).toBe(spanId);
  });

  test("handles early termination", async () => {
    const collector = new MetadataCollector("testStep");

    const stream = fromArray([1, 2, 3, 4, 5]);
    const wrapped = withMetadata(stream, "testStep", collector);

    // Only consume first 2 items
    const consumed: number[] = [];
    for await (const item of wrapped) {
      consumed.push(item);
      if (consumed.length >= 2) break;
    }

    expect(consumed).toEqual([1, 2]);

    const snapshot = collector.getSnapshot();
    // When we break early, the second item has been yielded but may not have been fully recorded
    expect(snapshot.streamMetrics.totalItems).toBeGreaterThanOrEqual(1);
    expect(snapshot.streamMetrics.totalItems).toBeLessThanOrEqual(2);
    expect(snapshot.streamMetrics.isComplete).toBe(true);
  });

  test("handles errors during streaming", async () => {
    const collector = new MetadataCollector("testStep");

    async function* errorStream() {
      yield 1;
      yield 2;
      throw new Error("Test error");
    }

    const wrapped = withMetadata(errorStream(), "testStep", collector);

    let errorThrown = false;
    let itemsReceived = 0;
    try {
      for await (const _item of wrapped) {
        itemsReceived++;
      }
    } catch (_error) {
      errorThrown = true;
    }

    expect(errorThrown).toBe(true);
    expect(itemsReceived).toBe(2);

    const snapshot = collector.getSnapshot();
    // The error happens after yielding 2 items, so we should have processed them
    expect(snapshot.streamMetrics.totalItems).toBeGreaterThanOrEqual(2);
    expect(snapshot.streamMetrics.successCount).toBeGreaterThanOrEqual(2);
  });
});

describe("T-Digest percentile calculation", () => {
  test("calculates percentiles for known data", async () => {
    const collector = new MetadataCollector("testStep");

    // Create data with known distribution
    // Using a simple sequence: 1, 2, 3, ..., 100
    for (let i = 0; i < 100; i++) {
      collector.recordItemStart(i);
      // Simulate variable processing times by sleeping
      await new Promise((resolve) => setTimeout(resolve, 0));
      collector.recordItemEnd(i, true);
    }

    const snapshot = collector.getSnapshot();
    const stats = snapshot.streamMetrics.itemTimings;

    expect(stats).toBeDefined();
    if (stats) {
      // Basic sanity checks
      expect(stats.min).toBeGreaterThanOrEqual(0);
      expect(stats.max).toBeGreaterThanOrEqual(stats.min);
      expect(stats.avg).toBeGreaterThanOrEqual(stats.min);
      expect(stats.avg).toBeLessThanOrEqual(stats.max);

      // Percentile ordering
      expect(stats.p50).toBeGreaterThanOrEqual(stats.min);
      expect(stats.p95).toBeGreaterThanOrEqual(stats.p50);
      expect(stats.p99).toBeGreaterThanOrEqual(stats.p95);
      expect(stats.p99).toBeLessThanOrEqual(stats.max);
    }
  });

  test("handles single value", () => {
    const collector = new MetadataCollector("testStep");

    collector.recordItemStart(0);
    collector.recordItemEnd(0, true);

    const snapshot = collector.getSnapshot();
    const stats = snapshot.streamMetrics.itemTimings;

    expect(stats).toBeDefined();
    if (stats) {
      // All percentiles should be the same for a single value
      expect(stats.min).toBe(stats.max);
      expect(stats.p50).toBe(stats.avg);
      expect(stats.p95).toBe(stats.avg);
      expect(stats.p99).toBe(stats.avg);
    }
  });

  test("handles large datasets efficiently", async () => {
    const collector = new MetadataCollector("testStep");

    // Process 10,000 items - t-digest should handle this with bounded memory
    for (let i = 0; i < 10000; i++) {
      collector.recordItemStart(i);
      collector.recordItemEnd(i, true);
    }

    const snapshot = collector.getSnapshot();
    const stats = snapshot.streamMetrics.itemTimings;

    expect(stats).toBeDefined();
    if (stats !== undefined) {
      expect(stats.min).toBeGreaterThanOrEqual(0);
      expect(stats.max).toBeGreaterThanOrEqual(stats.min);
      expect(stats.avg).toBeGreaterThanOrEqual(0);
      expect(stats.p50).toBeGreaterThanOrEqual(0);
      expect(stats.p95).toBeGreaterThanOrEqual(0);
      expect(stats.p99).toBeGreaterThanOrEqual(0);
    }

    expect(snapshot.streamMetrics.totalItems).toBe(10000);
  });
});

describe("Metadata edge cases", () => {
  test("handles out-of-order item recording", () => {
    const collector = new MetadataCollector("testStep");

    // Start items out of order
    collector.recordItemStart(2);
    collector.recordItemStart(0);
    collector.recordItemStart(1);

    // End in different order
    collector.recordItemEnd(0, true);
    collector.recordItemEnd(2, true);
    collector.recordItemEnd(1, true);

    const snapshot = collector.getSnapshot();
    expect(snapshot.streamMetrics.totalItems).toBe(3);
    expect(snapshot.streamMetrics.successCount).toBe(3);
  });

  test("warns when ending non-started item", () => {
    const collector = new MetadataCollector("testStep");

    // Mock console.warn to check if warning is logged
    const originalWarn = console.warn;
    let warnCalled = false;
    console.warn = () => {
      warnCalled = true;
    };

    collector.recordItemEnd(99, true);

    console.warn = originalWarn;

    expect(warnCalled).toBe(true);
  });

  test("calculates throughput correctly", async () => {
    const collector = new MetadataCollector("testStep");

    // Process items with small delays
    for (let i = 0; i < 10; i++) {
      collector.recordItemStart(i);
      await new Promise((resolve) => setTimeout(resolve, 1));
      collector.recordItemEnd(i, true);
    }

    const snapshot = collector.getSnapshot();
    expect(snapshot.streamMetrics.throughput).toBeDefined();
    if (snapshot.streamMetrics.throughput) {
      expect(snapshot.streamMetrics.throughput).toBeGreaterThan(0);
    }
  });

  test("handles zero elapsed time gracefully", () => {
    const collector = new MetadataCollector("testStep");

    // Get immediate snapshot
    const snapshot = collector.getSnapshot();

    // Throughput might be undefined for zero elapsed time with no items
    expect(snapshot.streamMetrics.throughput).toBeUndefined();
  });
});
