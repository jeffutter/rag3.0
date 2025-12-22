import { describe, expect, test } from "bun:test";
import {
  batch,
  filter,
  flatMap,
  flatten,
  fromArray,
  fromAsyncIterable,
  map,
  skip,
  take,
  tap,
  toArray,
} from "./generators";

describe("fromArray", () => {
  test("converts array to async generator", async () => {
    const input = [1, 2, 3, 4, 5];
    const stream = fromArray(input);
    const result = await toArray(stream);
    expect(result).toEqual(input);
  });

  test("handles empty array", async () => {
    const stream = fromArray([]);
    const result = await toArray(stream);
    expect(result).toEqual([]);
  });

  test("handles single item", async () => {
    const stream = fromArray([42]);
    const result = await toArray(stream);
    expect(result).toEqual([42]);
  });

  test("preserves item types", async () => {
    const input = [{ id: 1 }, { id: 2 }];
    const stream = fromArray(input);
    const result = await toArray(stream);
    expect(result).toEqual(input);
  });
});

describe("fromAsyncIterable", () => {
  test("normalizes async generator", async () => {
    async function* source() {
      yield 1;
      yield 2;
      yield 3;
    }

    const stream = fromAsyncIterable(source());
    const result = await toArray(stream);
    expect(result).toEqual([1, 2, 3]);
  });

  test("handles async iterable", async () => {
    const asyncIterable = {
      async *[Symbol.asyncIterator]() {
        yield "a";
        yield "b";
        yield "c";
      },
    };

    const stream = fromAsyncIterable(asyncIterable);
    const result = await toArray(stream);
    expect(result).toEqual(["a", "b", "c"]);
  });

  test("handles empty async iterable", async () => {
    async function* source() {
      // Empty
    }

    const stream = fromAsyncIterable(source());
    const result = await toArray(stream);
    expect(result).toEqual([]);
  });
});

describe("toArray", () => {
  test("collects all items from stream", async () => {
    async function* numbers() {
      yield 1;
      yield 2;
      yield 3;
    }

    const result = await toArray(numbers());
    expect(result).toEqual([1, 2, 3]);
  });

  test("handles empty stream", async () => {
    async function* empty() {
      // Empty
    }

    const result = await toArray(empty());
    expect(result).toEqual([]);
  });

  test("handles large stream", async () => {
    async function* largeStream() {
      for (let i = 0; i < 1000; i++) {
        yield i;
      }
    }

    const result = await toArray(largeStream());
    expect(result).toHaveLength(1000);
    expect(result[0]).toBe(0);
    expect(result[999]).toBe(999);
  });
});

describe("take", () => {
  test("takes first N items", async () => {
    const stream = fromArray([1, 2, 3, 4, 5]);
    const limited = take(stream, 3);
    const result = await toArray(limited);
    expect(result).toEqual([1, 2, 3]);
  });

  test("handles take more than available", async () => {
    const stream = fromArray([1, 2, 3]);
    const limited = take(stream, 10);
    const result = await toArray(limited);
    expect(result).toEqual([1, 2, 3]);
  });

  test("handles take 0", async () => {
    const stream = fromArray([1, 2, 3]);
    const limited = take(stream, 0);
    const result = await toArray(limited);
    expect(result).toEqual([]);
  });

  test("handles take negative", async () => {
    const stream = fromArray([1, 2, 3]);
    const limited = take(stream, -5);
    const result = await toArray(limited);
    expect(result).toEqual([]);
  });

  test("stops consuming after reaching limit", async () => {
    let consumedCount = 0;

    async function* counter() {
      while (true) {
        consumedCount++;
        yield consumedCount;
      }
    }

    const limited = take(counter(), 5);
    const result = await toArray(limited);

    expect(result).toEqual([1, 2, 3, 4, 5]);
    // Should not consume more than needed
    expect(consumedCount).toBe(5);
  });
});

describe("skip", () => {
  test("skips first N items", async () => {
    const stream = fromArray([1, 2, 3, 4, 5]);
    const skipped = skip(stream, 2);
    const result = await toArray(skipped);
    expect(result).toEqual([3, 4, 5]);
  });

  test("handles skip more than available", async () => {
    const stream = fromArray([1, 2, 3]);
    const skipped = skip(stream, 10);
    const result = await toArray(skipped);
    expect(result).toEqual([]);
  });

  test("handles skip 0", async () => {
    const stream = fromArray([1, 2, 3]);
    const skipped = skip(stream, 0);
    const result = await toArray(skipped);
    expect(result).toEqual([1, 2, 3]);
  });

  test("throws on negative skip", async () => {
    const stream = fromArray([1, 2, 3]);
    const skipped = skip(stream, -5);

    await expect(toArray(skipped)).rejects.toThrow("Cannot skip negative number of items");
  });

  test("combines with take for pagination", async () => {
    const stream = fromArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const page2 = take(skip(stream, 5), 3);
    const result = await toArray(page2);
    expect(result).toEqual([6, 7, 8]);
  });
});

describe("filter", () => {
  test("filters items based on predicate", async () => {
    const stream = fromArray([1, 2, 3, 4, 5]);
    const evens = filter(stream, (n) => n % 2 === 0);
    const result = await toArray(evens);
    expect(result).toEqual([2, 4]);
  });

  test("handles async predicate", async () => {
    const stream = fromArray([1, 2, 3, 4, 5]);
    const evens = filter(stream, async (n) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return n % 2 === 0;
    });
    const result = await toArray(evens);
    expect(result).toEqual([2, 4]);
  });

  test("handles no matches", async () => {
    const stream = fromArray([1, 3, 5, 7]);
    const evens = filter(stream, (n) => n % 2 === 0);
    const result = await toArray(evens);
    expect(result).toEqual([]);
  });

  test("handles all matches", async () => {
    const stream = fromArray([2, 4, 6, 8]);
    const evens = filter(stream, (n) => n % 2 === 0);
    const result = await toArray(evens);
    expect(result).toEqual([2, 4, 6, 8]);
  });

  test("filters complex objects", async () => {
    const stream = fromArray([
      { id: 1, active: true },
      { id: 2, active: false },
      { id: 3, active: true },
    ]);
    const active = filter(stream, (item) => item.active);
    const result = await toArray(active);
    expect(result).toEqual([
      { id: 1, active: true },
      { id: 3, active: true },
    ]);
  });
});

describe("map", () => {
  test("transforms items", async () => {
    const stream = fromArray([1, 2, 3]);
    const doubled = map(stream, (n) => n * 2);
    const result = await toArray(doubled);
    expect(result).toEqual([2, 4, 6]);
  });

  test("handles async transformation", async () => {
    const stream = fromArray([1, 2, 3]);
    const doubled = map(stream, async (n) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return n * 2;
    });
    const result = await toArray(doubled);
    expect(result).toEqual([2, 4, 6]);
  });

  test("changes type", async () => {
    const stream = fromArray([1, 2, 3]);
    const strings = map(stream, (n) => String(n));
    const result = await toArray(strings);
    expect(result).toEqual(["1", "2", "3"]);
  });

  test("transforms complex objects", async () => {
    const stream = fromArray([
      { id: 1, value: 10 },
      { id: 2, value: 20 },
    ]);
    const enriched = map(stream, (item) => ({
      ...item,
      doubled: item.value * 2,
    }));
    const result = await toArray(enriched);
    expect(result).toEqual([
      { id: 1, value: 10, doubled: 20 },
      { id: 2, value: 20, doubled: 40 },
    ]);
  });
});

describe("flatMap", () => {
  test("expands items into arrays", async () => {
    const stream = fromArray(["hello world", "foo bar"]);
    const words = flatMap(stream, (line) => line.split(" "));
    const result = await toArray(words);
    expect(result).toEqual(["hello", "world", "foo", "bar"]);
  });

  test("handles async expansion", async () => {
    const stream = fromArray([1, 2, 3]);
    const expanded = flatMap(stream, async (n) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return [n, n * 2];
    });
    const result = await toArray(expanded);
    expect(result).toEqual([1, 2, 2, 4, 3, 6]);
  });

  test("handles empty arrays", async () => {
    const stream = fromArray([1, 2, 3]);
    const filtered = flatMap(stream, (n) => (n % 2 === 0 ? [n] : []));
    const result = await toArray(filtered);
    expect(result).toEqual([2]);
  });

  test("handles async iterables", async () => {
    async function* expand(n: number) {
      yield n;
      yield n * 2;
    }

    const stream = fromArray([1, 2, 3]);
    const expanded = flatMap(stream, (n) => expand(n));
    const result = await toArray(expanded);
    expect(result).toEqual([1, 2, 2, 4, 3, 6]);
  });

  test("flattens nested structures", async () => {
    const stream = fromArray([{ items: [1, 2] }, { items: [3, 4] }, { items: [5] }]);
    const flattened = flatMap(stream, (obj) => obj.items);
    const result = await toArray(flattened);
    expect(result).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("batch", () => {
  test("batches items by size", async () => {
    const stream = fromArray([1, 2, 3, 4, 5, 6, 7]);
    const batched = batch(stream, 3);
    const result = await toArray(batched);
    expect(result).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
  });

  test("handles exact division", async () => {
    const stream = fromArray([1, 2, 3, 4, 5, 6]);
    const batched = batch(stream, 2);
    const result = await toArray(batched);
    expect(result).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
  });

  test("handles batch size 1", async () => {
    const stream = fromArray([1, 2, 3]);
    const batched = batch(stream, 1);
    const result = await toArray(batched);
    expect(result).toEqual([[1], [2], [3]]);
  });

  test("throws on batch size 0", async () => {
    const stream = fromArray([1, 2, 3]);
    const batched = batch(stream, 0);
    await expect(toArray(batched)).rejects.toThrow("Batch size must be positive");
  });

  test("throws on negative batch size", async () => {
    const stream = fromArray([1, 2, 3]);
    const batched = batch(stream, -5);
    await expect(toArray(batched)).rejects.toThrow("Batch size must be positive");
  });

  test("handles empty stream", async () => {
    const stream = fromArray([]);
    const batched = batch(stream, 3);
    const result = await toArray(batched);
    expect(result).toEqual([]);
  });
});

describe("flatten", () => {
  test("flattens arrays", async () => {
    const stream = fromArray([[1, 2], [3, 4], [5]]);
    const flattened = flatten(stream);
    const result = await toArray(flattened);
    expect(result).toEqual([1, 2, 3, 4, 5]);
  });

  test("handles empty arrays", async () => {
    const stream = fromArray([[1, 2], [], [3]]);
    const flattened = flatten(stream);
    const result = await toArray(flattened);
    expect(result).toEqual([1, 2, 3]);
  });

  test("handles all empty arrays", async () => {
    const stream = fromArray([[], [], []]);
    const flattened = flatten(stream);
    const result = await toArray(flattened);
    expect(result).toEqual([]);
  });

  test("is inverse of batch", async () => {
    const input = [1, 2, 3, 4, 5, 6, 7];
    const stream = fromArray(input);
    const batched = batch(stream, 3);
    const flattened = flatten(batched);
    const result = await toArray(flattened);
    expect(result).toEqual(input);
  });
});

describe("tap", () => {
  test("executes side effect without modifying stream", async () => {
    const sideEffects: number[] = [];
    const stream = fromArray([1, 2, 3]);
    const tapped = tap(stream, (n) => {
      sideEffects.push(n * 2);
    });
    const result = await toArray(tapped);

    expect(result).toEqual([1, 2, 3]); // Original values unchanged
    expect(sideEffects).toEqual([2, 4, 6]); // Side effects executed
  });

  test("handles async side effects", async () => {
    const sideEffects: number[] = [];
    const stream = fromArray([1, 2, 3]);
    const tapped = tap(stream, async (n) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      sideEffects.push(n);
    });
    const result = await toArray(tapped);

    expect(result).toEqual([1, 2, 3]);
    expect(sideEffects).toEqual([1, 2, 3]);
  });

  test("useful for logging", async () => {
    const logs: string[] = [];
    const stream = fromArray([1, 2, 3]);
    const logged = tap(stream, (n) => {
      logs.push(`Processing: ${n}`);
    });
    await toArray(logged);

    expect(logs).toEqual(["Processing: 1", "Processing: 2", "Processing: 3"]);
  });
});

describe("integration tests", () => {
  test("complex pipeline with multiple operations", async () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const stream = fromArray(input);

    // Skip first 2, take next 6, filter evens, double them
    const result = await toArray(
      map(
        filter(take(skip(stream, 2), 6), (n) => n % 2 === 0),
        (n) => n * 2,
      ),
    );

    // Skip 2: [3,4,5,6,7,8,9,10]
    // Take 6: [3,4,5,6,7,8]
    // Filter evens: [4,6,8]
    // Double: [8,12,16]
    expect(result).toEqual([8, 12, 16]);
  });

  test("batch and flatten roundtrip", async () => {
    const input = Array.from({ length: 100 }, (_, i) => i);
    const stream = fromArray(input);
    const batched = batch(stream, 10);
    const flattened = flatten(batched);
    const result = await toArray(flattened);

    expect(result).toEqual(input);
  });

  test("flatMap with filtering and mapping", async () => {
    const input = ["hello world", "foo bar baz", "a"];
    const stream = fromArray(input);

    const result = await toArray(
      flatMap(
        filter(
          map(
            flatMap(stream, (line) => line.split(" ")),
            (word) => word.length,
          ),
          (len) => len > 2,
        ),
        (len) => [len, len * 2],
      ),
    );

    // Split: ["hello","world","foo","bar","baz","a"]
    // Map to lengths: [5,5,3,3,3,1]
    // Filter > 2: [5,5,3,3,3]
    // FlatMap duplicate: [5,10,5,10,3,6,3,6,3,6]
    expect(result).toEqual([5, 10, 5, 10, 3, 6, 3, 6, 3, 6]);
  });
});
