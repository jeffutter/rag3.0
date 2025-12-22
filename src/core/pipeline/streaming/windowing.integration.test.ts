/**
 * Integration tests for windowing operations with actual streaming pipelines.
 *
 * These tests verify that windowing operations work correctly when composed
 * with other streaming operations in real-world scenarios.
 */
import { describe, expect, test } from "bun:test";
import { filter, flatMap, fromArray, map, toArray } from "./generators";
import { bufferTime, bufferUntil, window } from "./windowing";

describe("windowing integration tests", () => {
  describe("window with pipeline operations", () => {
    test("sliding window with map and reduce", async () => {
      // Calculate moving average with sliding window
      const numbers = fromArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

      const windowed = window(numbers, 3, 1); // Sliding window of size 3

      // Calculate average of each window
      const averages = map(windowed, (win) => {
        const sum = win.reduce((acc, n) => acc + n, 0);
        return sum / win.length;
      });

      const result = await toArray(averages);

      // Windows: [1,2,3], [2,3,4], [3,4,5], ..., [8,9,10]
      // Averages: 2, 3, 4, 5, 6, 7, 8, 9
      expect(result).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    });

    test("tumbling window with flatMap", async () => {
      // Process batches and expand results
      const numbers = fromArray([1, 2, 3, 4, 5, 6]);

      const windowed = window(numbers, 2); // Tumbling window of size 2

      // For each window, generate pairs
      const expanded = flatMap(windowed, (win) => {
        return [
          [win[0], win[1]],
          [win[1], win[0]],
        ];
      });

      const result = await toArray(expanded);

      expect(result).toEqual([
        [1, 2],
        [2, 1],
        [3, 4],
        [4, 3],
        [5, 6],
        [6, 5],
      ]);
    });

    test("hopping window with filter", async () => {
      // Sample data at intervals
      const numbers = fromArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

      const windowed = window(numbers, 2, 4); // Hopping: take 2, skip 2

      // Only keep windows where sum is even
      const filtered = filter(windowed, (win) => {
        const sum = win.reduce((acc, n) => acc + n, 0);
        return sum % 2 === 0;
      });

      const result = await toArray(filtered);

      // Windows: [1,2], [5,6], [9,10]
      // Sums: 3 (odd), 11 (odd), 19 (odd) - none pass filter
      // Let's verify what we actually get
      expect(result).toEqual([]);
    });

    test("window with complex data types", async () => {
      interface Event {
        timestamp: number;
        value: number;
      }

      const events: Event[] = [
        { timestamp: 1, value: 10 },
        { timestamp: 2, value: 20 },
        { timestamp: 3, value: 30 },
        { timestamp: 4, value: 15 },
        { timestamp: 5, value: 25 },
      ];

      const stream = fromArray(events);
      const windowed = window(stream, 3, 1);

      // Calculate max value in each window
      const maxValues = map(windowed, (win) => {
        return Math.max(...win.map((e) => e.value));
      });

      const result = await toArray(maxValues);

      // Windows: [10,20,30], [20,30,15], [30,15,25]
      // Max values: 30, 30, 30
      expect(result).toEqual([30, 30, 30]);
    });
  });

  describe("bufferTime with pipeline operations", () => {
    test("time-based batching with map", async () => {
      async function* slowSource() {
        for (let i = 1; i <= 6; i++) {
          yield i;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }

      // Batch by time (50ms window should get ~2-3 items per batch)
      const batched = bufferTime(slowSource(), 50);

      // Sum each batch
      const sums = map(batched, (batch) => batch.reduce((sum, n) => sum + n, 0));

      const result = await toArray(sums);

      // We should get multiple batches
      expect(result.length).toBeGreaterThan(1);

      // Total sum should be 1+2+3+4+5+6 = 21
      const total = result.reduce((sum, n) => sum + n, 0);
      expect(total).toBe(21);
    }, 500);

    test("size-limited batching with filter", async () => {
      const numbers = fromArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

      // Batch with size limit of 3
      const batched = bufferTime(numbers, 1000, 3);

      // Only keep batches with sum > 10
      const filtered = filter(batched, (batch) => {
        const sum = batch.reduce((acc, n) => acc + n, 0);
        return sum > 10;
      });

      const result = await toArray(filtered);

      // Batches: [1,2,3]=6, [4,5,6]=15, [7,8,9]=24, [10]=10
      // Filter: keep [4,5,6] and [7,8,9]
      expect(result).toEqual([
        [4, 5, 6],
        [7, 8, 9],
      ]);
    });

    test("time-based batching with flatMap", async () => {
      async function* slowSource() {
        yield "hello";
        await new Promise((resolve) => setTimeout(resolve, 60));
        yield "world";
        await new Promise((resolve) => setTimeout(resolve, 60));
        yield "test";
      }

      const batched = bufferTime(slowSource(), 50);

      // Split each word in each batch into characters
      const chars = flatMap(batched, (batch) => {
        return batch.flatMap((word) => word.split(""));
      });

      const result = await toArray(chars);

      // Each word arrives in a separate batch due to 60ms delay > 50ms window
      // Then flattened to characters
      expect(result).toEqual(["h", "e", "l", "l", "o", "w", "o", "r", "l", "d", "t", "e", "s", "t"]);
    }, 500);
  });

  describe("bufferUntil with pipeline operations", () => {
    test("predicate-based batching with map", async () => {
      const numbers = fromArray([1, 2, 3, 0, 4, 5, 0, 6, 7, 8]);

      // Batch until we see 0
      const batched = bufferUntil(numbers, (_buffer, current) => current === 0);

      // Remove zeros and calculate sum
      const sums = map(batched, (batch) => {
        const filtered = batch.filter((n) => n !== 0);
        return filtered.reduce((sum, n) => sum + n, 0);
      });

      const result = await toArray(sums);

      // Batches: [1,2,3,0], [4,5,0], [6,7,8]
      // After filtering zeros: [1,2,3], [4,5], [6,7,8]
      // Sums: 6, 9, 21
      expect(result).toEqual([6, 9, 21]);
    });

    test("event batching with filter and flatMap", async () => {
      interface LogEntry {
        level: "INFO" | "ERROR" | "FLUSH";
        message: string;
      }

      const logs: LogEntry[] = [
        { level: "INFO", message: "start" },
        { level: "INFO", message: "processing" },
        { level: "ERROR", message: "failed" },
        { level: "FLUSH", message: "checkpoint1" },
        { level: "INFO", message: "retry" },
        { level: "INFO", message: "success" },
        { level: "FLUSH", message: "checkpoint2" },
        { level: "ERROR", message: "timeout" },
      ];

      const stream = fromArray(logs);

      // Batch until FLUSH event
      const batched = bufferUntil(stream, (_buffer, current) => current.level === "FLUSH");

      // Filter out FLUSH events and keep only errors
      const errorBatches = map(batched, (batch) => {
        return batch.filter((log) => log.level === "ERROR");
      });

      // Flatten to get all errors
      const allErrors = flatMap(errorBatches, (batch) => batch);

      const result = await toArray(allErrors);

      expect(result).toEqual([
        { level: "ERROR", message: "failed" },
        { level: "ERROR", message: "timeout" },
      ]);
    });

    test("paragraph processing with complex pipeline", async () => {
      const lines = [
        "First line",
        "Second line",
        "Third line",
        "", // Empty line - paragraph separator
        "Fourth line",
        "Fifth line",
        "", // Empty line
        "Sixth line",
      ];

      const stream = fromArray(lines);

      // Batch by paragraphs (until empty line)
      const paragraphs = bufferUntil(stream, (_buffer, current) => current === "");

      // Remove empty lines and join into single string
      const joined = map(paragraphs, (lines) => {
        return lines.filter((line) => line !== "").join(" ");
      });

      // Filter out empty paragraphs
      const nonEmpty = filter(joined, (para) => para.length > 0);

      const result = await toArray(nonEmpty);

      expect(result).toEqual(["First line Second line Third line", "Fourth line Fifth line", "Sixth line"]);
    });
  });

  describe("composing multiple windowing operations", () => {
    test("window followed by bufferUntil", async () => {
      const numbers = fromArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

      // First create sliding windows
      const windowed = window(numbers, 3, 1);

      // Then batch windows until sum exceeds threshold
      const batched = bufferUntil(windowed, (_buffer, current) => {
        const currentSum = current.reduce((s, n) => s + n, 0);
        return currentSum > 20;
      });

      const result = await toArray(batched);

      // Windows: [1,2,3]=6, [2,3,4]=9, [3,4,5]=12, [4,5,6]=15, [5,6,7]=18, [6,7,8]=21
      // First batch accumulates until sum > 20: [[1,2,3], [2,3,4], [3,4,5], [4,5,6], [5,6,7], [6,7,8]]
      // [6,7,8] has sum 21 > 20, so emit
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]?.length).toBeGreaterThan(0);
    });

    test("bufferTime followed by window", async () => {
      async function* source() {
        for (let i = 1; i <= 10; i++) {
          yield i;
          if (i % 3 === 0) {
            // Longer delay every 3 items
            await new Promise((resolve) => setTimeout(resolve, 60));
          }
        }
      }

      // First batch by time (items within 50ms)
      const timeBatched = bufferTime(source(), 50, 5);

      // Then create sliding windows over batches
      const windowed = window(timeBatched, 2, 1);

      const result = await toArray(windowed);

      // This tests that windowing operations compose correctly
      expect(result.length).toBeGreaterThan(0);
      // Each window should contain 2 batches
      for (const win of result) {
        expect(win.length).toBe(2);
        // Each batch should be an array
        expect(Array.isArray(win[0])).toBe(true);
        expect(Array.isArray(win[1])).toBe(true);
      }
    }, 500);
  });

  describe("real-world scenarios", () => {
    test("moving average calculation", async () => {
      // Simulate sensor data
      const sensorData = fromArray([10, 12, 11, 13, 15, 14, 16, 18, 17, 19]);

      // Calculate 3-point moving average
      const windowed = window(sensorData, 3, 1);
      const movingAvg = map(windowed, (values) => {
        const sum = values.reduce((s, v) => s + v, 0);
        return Math.round((sum / values.length) * 10) / 10; // Round to 1 decimal
      });

      const result = await toArray(movingAvg);

      expect(result).toEqual([11, 12, 13, 14, 15, 16, 17, 18]);
    });

    test("rate limiting with time windows", async () => {
      // Simulate API requests
      const requests = fromArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

      // Batch requests (max 3 per batch)
      const batched = bufferTime(requests, 1000, 3);

      // Process each batch
      const processed = map(batched, async (batch) => {
        // Simulate API call
        return { batchSize: batch.length, items: batch };
      });

      const result = await toArray(processed);

      // Should have 4 batches: [1,2,3], [4,5,6], [7,8,9], [10]
      expect(result).toHaveLength(4);
      expect(result[0]?.batchSize).toBe(3);
      expect(result[1]?.batchSize).toBe(3);
      expect(result[2]?.batchSize).toBe(3);
      expect(result[3]?.batchSize).toBe(1);
    });

    test("log aggregation with time and size limits", async () => {
      interface LogEntry {
        timestamp: number;
        level: string;
        message: string;
      }

      async function* logStream(): AsyncGenerator<LogEntry> {
        const messages = ["msg1", "msg2", "msg3", "msg4", "msg5"];
        for (const message of messages) {
          yield {
            timestamp: Date.now(),
            level: "INFO",
            message: message,
          };
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }

      // Batch logs: flush every 30ms or when 3 logs accumulated
      const batched = bufferTime(logStream(), 30, 3);

      // Format each batch for storage
      const formatted = map(batched, (logs) => ({
        count: logs.length,
        messages: logs.map((l) => l.message),
      }));

      const result = await toArray(formatted);

      // Should have multiple batches
      expect(result.length).toBeGreaterThan(0);

      // Total messages should be 5
      const totalMessages = result.reduce((sum, batch) => sum + batch.count, 0);
      expect(totalMessages).toBe(5);
    }, 500);

    test("stream deduplication with sliding window", async () => {
      // Simulate stream with duplicates
      const values = fromArray([1, 1, 2, 2, 2, 3, 1, 1, 4, 4]);

      // Use sliding window to detect consecutive duplicates
      const windowed = window(values, 2, 1);

      // Filter out windows where values are the same
      const changes = filter(windowed, (win) => win[0] !== win[1]);

      // Map to transition pairs
      const transitions = map(changes, (win) => ({ from: win[0], to: win[1] }));

      const result = await toArray(transitions);

      // Transitions: 1->2, 2->3, 3->1, 1->4
      expect(result).toEqual([
        { from: 1, to: 2 },
        { from: 2, to: 3 },
        { from: 3, to: 1 },
        { from: 1, to: 4 },
      ]);
    });
  });
});
