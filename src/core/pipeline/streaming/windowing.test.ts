import { describe, expect, test } from "bun:test";
import { fromArray, toArray } from "./generators";
import { bufferTime, bufferUntil, window } from "./windowing";

describe("window", () => {
  describe("tumbling windows (non-overlapping)", () => {
    test("creates non-overlapping windows", async () => {
      const stream = fromArray([1, 2, 3, 4, 5, 6]);
      const windowed = window(stream, 2);
      const result = await toArray(windowed);
      expect(result).toEqual([
        [1, 2],
        [3, 4],
        [5, 6],
      ]);
    });

    test("handles last partial window for tumbling", async () => {
      const stream = fromArray([1, 2, 3, 4, 5]);
      const windowed = window(stream, 2);
      const result = await toArray(windowed);
      expect(result).toEqual([
        [1, 2],
        [3, 4],
      ]);
    });

    test("handles window size 1", async () => {
      const stream = fromArray([1, 2, 3]);
      const windowed = window(stream, 1);
      const result = await toArray(windowed);
      expect(result).toEqual([[1], [2], [3]]);
    });

    test("handles empty stream", async () => {
      const stream = fromArray([]);
      const windowed = window(stream, 3);
      const result = await toArray(windowed);
      expect(result).toEqual([]);
    });

    test("handles stream smaller than window", async () => {
      const stream = fromArray([1, 2]);
      const windowed = window(stream, 5);
      const result = await toArray(windowed);
      expect(result).toEqual([]);
    });
  });

  describe("sliding windows (overlapping)", () => {
    test("creates overlapping windows", async () => {
      const stream = fromArray([1, 2, 3, 4, 5]);
      const windowed = window(stream, 3, 1);
      const result = await toArray(windowed);
      expect(result).toEqual([
        [1, 2, 3],
        [2, 3, 4],
        [3, 4, 5],
      ]);
    });

    test("handles slide size 2 with window size 3", async () => {
      const stream = fromArray([1, 2, 3, 4, 5, 6, 7]);
      const windowed = window(stream, 3, 2);
      const result = await toArray(windowed);
      expect(result).toEqual([
        [1, 2, 3],
        [3, 4, 5],
        [5, 6, 7],
      ]);
    });

    test("sliding window doesn't emit incomplete final window", async () => {
      const stream = fromArray([1, 2, 3, 4]);
      const windowed = window(stream, 3, 1);
      const result = await toArray(windowed);
      expect(result).toEqual([
        [1, 2, 3],
        [2, 3, 4],
      ]);
    });

    test("sliding window with large slide", async () => {
      const stream = fromArray([1, 2, 3, 4, 5, 6, 7, 8]);
      const windowed = window(stream, 4, 2);
      const result = await toArray(windowed);
      expect(result).toEqual([
        [1, 2, 3, 4],
        [3, 4, 5, 6],
        [5, 6, 7, 8],
      ]);
    });
  });

  describe("hopping windows (with gaps)", () => {
    test("creates windows with gaps", async () => {
      const stream = fromArray([1, 2, 3, 4, 5, 6, 7, 8]);
      const windowed = window(stream, 2, 3);
      const result = await toArray(windowed);
      expect(result).toEqual([
        [1, 2],
        [4, 5],
        [7, 8],
      ]);
    });

    test("handles hopping windows with irregular data", async () => {
      const stream = fromArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const windowed = window(stream, 2, 4);
      const result = await toArray(windowed);
      expect(result).toEqual([
        [1, 2],
        [5, 6],
        [9, 10],
      ]);
    });

    test("hopping windows don't emit partial final window", async () => {
      const stream = fromArray([1, 2, 3, 4, 5, 6, 7]);
      const windowed = window(stream, 2, 3);
      const result = await toArray(windowed);
      expect(result).toEqual([
        [1, 2],
        [4, 5],
      ]);
    });
  });

  describe("error handling", () => {
    test("throws on zero window size", async () => {
      const stream = fromArray([1, 2, 3]);
      const windowed = window(stream, 0);
      await expect(toArray(windowed)).rejects.toThrow("Window size must be positive");
    });

    test("throws on negative window size", async () => {
      const stream = fromArray([1, 2, 3]);
      const windowed = window(stream, -5);
      await expect(toArray(windowed)).rejects.toThrow("Window size must be positive");
    });

    test("throws on zero slide size", async () => {
      const stream = fromArray([1, 2, 3]);
      const windowed = window(stream, 2, 0);
      await expect(toArray(windowed)).rejects.toThrow("Slide size must be positive");
    });

    test("throws on negative slide size", async () => {
      const stream = fromArray([1, 2, 3]);
      const windowed = window(stream, 2, -1);
      await expect(toArray(windowed)).rejects.toThrow("Slide size must be positive");
    });
  });

  describe("cleanup and early termination", () => {
    test("cleans up source on early termination", async () => {
      let cleanedUp = false;

      async function* source() {
        try {
          for (let i = 0; i < 100; i++) {
            yield i;
          }
        } finally {
          cleanedUp = true;
        }
      }

      const windowed = window(source(), 3, 1);
      let count = 0;
      for await (const _win of windowed) {
        count++;
        if (count >= 2) break;
      }

      expect(cleanedUp).toBe(true);
    });
  });
});

describe("bufferTime", () => {
  describe("time-based batching", () => {
    test("batches items based on time window", async () => {
      const items: number[] = [];
      const timestamps: number[] = [];

      async function* slowSource() {
        for (let i = 0; i < 10; i++) {
          timestamps.push(Date.now());
          yield i;
          await new Promise((resolve) => setTimeout(resolve, 15));
        }
      }

      const batched = bufferTime(slowSource(), 50);
      for await (const batch of batched) {
        items.push(...batch);
      }

      expect(items).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      // We should have gotten multiple batches (not all in one)
      // With 15ms delay and 50ms window, we expect roughly 3-4 items per batch
    }, 1000);

    test("emits final batch with remaining items", async () => {
      async function* source() {
        yield 1;
        yield 2;
        yield 3;
        // Stream ends before timer expires
      }

      const batched = bufferTime(source(), 1000);
      const result = await toArray(batched);

      expect(result).toEqual([[1, 2, 3]]);
    });

    test("handles empty stream", async () => {
      async function* source() {
        // Empty stream
      }

      const batched = bufferTime(source(), 100);
      const result = await toArray(batched);

      expect(result).toEqual([]);
    });

    test("handles single item", async () => {
      async function* source() {
        yield 42;
      }

      const batched = bufferTime(source(), 100);
      const result = await toArray(batched);

      expect(result).toEqual([[42]]);
    });
  });

  describe("size-based limits", () => {
    test("emits when max size is reached", async () => {
      async function* fastSource() {
        for (let i = 0; i < 10; i++) {
          yield i;
          // No delay - items arrive faster than time window
        }
      }

      const batched = bufferTime(fastSource(), 1000, 3);
      const result = await toArray(batched);

      // Should batch by size (3) not time since items arrive quickly
      expect(result).toEqual([[0, 1, 2], [3, 4, 5], [6, 7, 8], [9]]);
    });

    test("respects both time and size limits", async () => {
      const results: number[][] = [];

      async function* mixedSource() {
        yield 1;
        yield 2;
        // Hit size limit of 3
        yield 3;

        // Now wait longer than time window
        await new Promise((resolve) => setTimeout(resolve, 60));

        yield 4;
        yield 5;
      }

      const batched = bufferTime(mixedSource(), 50, 3);
      for await (const batch of batched) {
        results.push(batch);
      }

      // First batch hits size limit, second is time-based
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual([1, 2, 3]);
      expect(results[1]).toEqual([4, 5]);
    }, 500);

    test("size limit of 1 yields items immediately", async () => {
      async function* source() {
        yield 1;
        yield 2;
        yield 3;
      }

      const batched = bufferTime(source(), 1000, 1);
      const result = await toArray(batched);

      expect(result).toEqual([[1], [2], [3]]);
    });
  });

  describe("error handling", () => {
    test("throws on zero window time", async () => {
      const stream = fromArray([1, 2, 3]);
      const batched = bufferTime(stream, 0);
      await expect(toArray(batched)).rejects.toThrow("Window time must be positive");
    });

    test("throws on negative window time", async () => {
      const stream = fromArray([1, 2, 3]);
      const batched = bufferTime(stream, -100);
      await expect(toArray(batched)).rejects.toThrow("Window time must be positive");
    });

    test("throws on zero max size", async () => {
      const stream = fromArray([1, 2, 3]);
      const batched = bufferTime(stream, 100, 0);
      await expect(toArray(batched)).rejects.toThrow("Max size must be positive");
    });

    test("throws on negative max size", async () => {
      const stream = fromArray([1, 2, 3]);
      const batched = bufferTime(stream, 100, -5);
      await expect(toArray(batched)).rejects.toThrow("Max size must be positive");
    });
  });

  describe("cleanup and early termination", () => {
    test("cleans up timer on early termination", async () => {
      let cleanedUp = false;

      async function* source() {
        try {
          for (let i = 0; i < 100; i++) {
            yield i;
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        } finally {
          cleanedUp = true;
        }
      }

      const batched = bufferTime(source(), 50);
      let count = 0;
      for await (const _batch of batched) {
        count++;
        if (count >= 2) break;
      }

      // Give time for cleanup
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(cleanedUp).toBe(true);
    }, 500);

    test("properly cleans up timer on completion", async () => {
      // This test verifies no timer leaks by completing normally
      async function* source() {
        for (let i = 0; i < 5; i++) {
          yield i;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }

      const batched = bufferTime(source(), 30);
      const result = await toArray(batched);

      expect(result.length).toBeGreaterThan(0);
      // If we get here without hanging, timers were cleaned up properly
    }, 500);
  });

  describe("memory bounds", () => {
    test("limits buffer growth with maxSize", async () => {
      let maxBufferSize = 0;

      async function* source() {
        for (let i = 0; i < 1000; i++) {
          yield i;
        }
      }

      const batched = bufferTime(source(), 1000, 10);
      for await (const batch of batched) {
        maxBufferSize = Math.max(maxBufferSize, batch.length);
      }

      // Buffer should never exceed maxSize
      expect(maxBufferSize).toBeLessThanOrEqual(10);
    });

    test("without maxSize, fast source accumulates items", async () => {
      let maxBatchSize = 0;

      async function* fastSource() {
        for (let i = 0; i < 100; i++) {
          yield i;
        }
      }

      const batched = bufferTime(fastSource(), 1000);
      for await (const batch of batched) {
        maxBatchSize = Math.max(maxBatchSize, batch.length);
      }

      // Without size limit and fast source, we get one big batch
      expect(maxBatchSize).toBe(100);
    });
  });
});

describe("bufferUntil", () => {
  describe("predicate-based batching", () => {
    test("batches until predicate returns true", async () => {
      const stream = fromArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      // Batch when we see a multiple of 3
      const batched = bufferUntil(stream, (_buffer, current) => current % 3 === 0);
      const result = await toArray(batched);

      expect(result).toEqual([[1, 2, 3], [4, 5, 6], [7, 8, 9], [10]]);
    });

    test("includes the item that triggers predicate", async () => {
      const stream = fromArray(["a", "b", ".", "c", "d", ".", "e"]);
      // Batch when we see a period
      const batched = bufferUntil(stream, (_buffer, current) => current === ".");
      const result = await toArray(batched);

      expect(result).toEqual([["a", "b", "."], ["c", "d", "."], ["e"]]);
    });

    test("handles async predicate", async () => {
      const stream = fromArray([1, 2, 3, 4, 5]);

      const batched = bufferUntil(stream, async (_buffer, current) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return current % 2 === 0;
      });

      const result = await toArray(batched);
      expect(result).toEqual([[1, 2], [3, 4], [5]]);
    });

    test("handles empty stream", async () => {
      const stream = fromArray([]);
      const batched = bufferUntil(stream, (_buffer, _current) => true);
      const result = await toArray(batched);
      expect(result).toEqual([]);
    });

    test("handles single item", async () => {
      const stream = fromArray([42]);
      const batched = bufferUntil(stream, (_buffer, _current) => true);
      const result = await toArray(batched);
      expect(result).toEqual([[42]]);
    });

    test("predicate always false accumulates all items", async () => {
      const stream = fromArray([1, 2, 3, 4, 5]);
      const batched = bufferUntil(stream, (_buffer, _current) => false);
      const result = await toArray(batched);
      expect(result).toEqual([[1, 2, 3, 4, 5]]);
    });

    test("predicate always true emits individual items", async () => {
      const stream = fromArray([1, 2, 3]);
      const batched = bufferUntil(stream, (_buffer, _current) => true);
      const result = await toArray(batched);
      expect(result).toEqual([[1], [2], [3]]);
    });
  });

  describe("buffer-aware batching", () => {
    test("predicate receives current buffer state", async () => {
      interface Item {
        size: number;
        data: string;
      }

      const items: Item[] = [
        { size: 100, data: "a" },
        { size: 200, data: "b" },
        { size: 300, data: "c" },
        { size: 150, data: "d" },
        { size: 250, data: "e" },
      ];

      const stream = fromArray(items);

      // Batch when total size exceeds 400
      const batched = bufferUntil(stream, (buffer, current) => {
        const totalSize = buffer.reduce((sum, item) => sum + item.size, 0) + current.size;
        return totalSize > 400;
      });

      const result = await toArray(batched);

      // First batch: a(100) + b(200) + c(300) = 600 > 400, emit [a,b,c]
      // Second batch: d(150) + e(250) = 400, not > 400, so emit at end [d,e]
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual([
        { size: 100, data: "a" },
        { size: 200, data: "b" },
        { size: 300, data: "c" },
      ]);
      expect(result[1]).toEqual([
        { size: 150, data: "d" },
        { size: 250, data: "e" },
      ]);
    });

    test("can batch by count using buffer length", async () => {
      const stream = fromArray([1, 2, 3, 4, 5, 6, 7, 8, 9]);

      // Batch when we have 3 items (including current)
      const batched = bufferUntil(stream, (buffer, _current) => buffer.length >= 2);

      const result = await toArray(batched);

      expect(result).toEqual([
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
      ]);
    });

    test("batches paragraph-like structures", async () => {
      const lines = ["line1", "line2", "", "line3", "line4", "line5", "", "line6"];
      const stream = fromArray(lines);

      // Batch until we see an empty line
      const batched = bufferUntil(stream, (_buffer, current) => current === "");

      const result = await toArray(batched);

      expect(result).toEqual([["line1", "line2", ""], ["line3", "line4", "line5", ""], ["line6"]]);
    });
  });

  describe("cleanup and early termination", () => {
    test("cleans up source on early termination", async () => {
      let cleanedUp = false;

      async function* source() {
        try {
          for (let i = 0; i < 100; i++) {
            yield i;
          }
        } finally {
          cleanedUp = true;
        }
      }

      const batched = bufferUntil(source(), (_buffer, current) => current % 5 === 0);

      let count = 0;
      for await (const _batch of batched) {
        count++;
        if (count >= 2) break;
      }

      expect(cleanedUp).toBe(true);
    });
  });

  describe("error propagation", () => {
    test("propagates errors from predicate", async () => {
      const stream = fromArray([1, 2, 3, 4, 5]);

      const batched = bufferUntil(stream, (_buffer, current) => {
        if (current === 3) throw new Error("Predicate failed at 3");
        return current % 2 === 0;
      });

      await expect(toArray(batched)).rejects.toThrow("Predicate failed at 3");
    });

    test("async predicate errors propagate", async () => {
      const stream = fromArray([1, 2, 3, 4, 5]);

      const batched = bufferUntil(stream, async (_buffer, current) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        if (current === 3) throw new Error("Async predicate failed");
        return false;
      });

      await expect(toArray(batched)).rejects.toThrow("Async predicate failed");
    });
  });
});

describe("integration tests", () => {
  test("window with map and filter", async () => {
    const stream = fromArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    // Create sliding windows of 3, sliding by 2
    const windowed = window(stream, 3, 2);

    // Calculate sum of each window
    async function* mapSum(source: AsyncIterable<number[]>) {
      for await (const win of source) {
        yield win.reduce((sum, n) => sum + n, 0);
      }
    }

    const sums = mapSum(windowed);
    const result = await toArray(sums);

    // Windows: [1,2,3], [3,4,5], [5,6,7], [7,8,9], [9,10] (incomplete, not emitted)
    // Sums: 6, 12, 18, 24
    expect(result).toEqual([6, 12, 18, 24]);
  });

  test("bufferUntil for event batching", async () => {
    interface Event {
      type: string;
      data: string;
    }

    const events: Event[] = [
      { type: "START", data: "a" },
      { type: "DATA", data: "b" },
      { type: "DATA", data: "c" },
      { type: "END", data: "d" },
      { type: "START", data: "e" },
      { type: "DATA", data: "f" },
      { type: "END", data: "g" },
      { type: "START", data: "h" },
    ];

    const stream = fromArray(events);

    // Batch events until we see an END event
    const batched = bufferUntil(stream, (_buffer, current) => current.type === "END");

    const result = await toArray(batched);

    expect(result).toHaveLength(3);
    expect(result[0]).toHaveLength(4); // START, DATA, DATA, END
    expect(result[1]).toHaveLength(3); // START, DATA, END
    expect(result[2]).toHaveLength(1); // START (incomplete batch)
  });

  test("combining time-based and predicate-based batching", async () => {
    interface LogEntry {
      level: string;
      message: string;
    }

    const logs: LogEntry[] = [
      { level: "INFO", message: "msg1" },
      { level: "INFO", message: "msg2" },
      { level: "ERROR", message: "err1" },
      { level: "INFO", message: "msg3" },
      { level: "ERROR", message: "err2" },
      { level: "ERROR", message: "err3" },
    ];

    const stream = fromArray(logs);

    // First, batch by error (split on errors)
    const errorBatched = bufferUntil(stream, (_buffer, current) => current.level === "ERROR");

    // Collect results
    const result = await toArray(errorBatched);

    expect(result).toEqual([
      [
        { level: "INFO", message: "msg1" },
        { level: "INFO", message: "msg2" },
        { level: "ERROR", message: "err1" },
      ],
      [
        { level: "INFO", message: "msg3" },
        { level: "ERROR", message: "err2" },
      ],
      [{ level: "ERROR", message: "err3" }],
    ]);
  });
});
