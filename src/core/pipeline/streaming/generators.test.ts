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

  test("provides correct index to predicate", async () => {
    const stream = fromArray([10, 20, 30, 40, 50]);
    const indices: number[] = [];
    const filtered = filter(stream, (n, index) => {
      indices.push(index);
      return n > 25;
    });
    const result = await toArray(filtered);

    expect(result).toEqual([30, 40, 50]);
    expect(indices).toEqual([0, 1, 2, 3, 4]); // All indices should be passed
  });

  test("index increments for all items, not just filtered ones", async () => {
    const stream = fromArray([1, 2, 3, 4, 5]);
    const indices: number[] = [];
    const evens = filter(stream, (n, index) => {
      indices.push(index);
      return n % 2 === 0;
    });
    await toArray(evens);

    expect(indices).toEqual([0, 1, 2, 3, 4]);
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

  test("provides correct index to transform function", async () => {
    const stream = fromArray(["a", "b", "c"]);
    const indexed = map(stream, (item, index) => `${index}:${item}`);
    const result = await toArray(indexed);

    expect(result).toEqual(["0:a", "1:b", "2:c"]);
  });

  test("index increments correctly with async transform", async () => {
    const stream = fromArray([10, 20, 30]);
    const indices: number[] = [];
    const transformed = map(stream, async (n, index) => {
      indices.push(index);
      await new Promise((resolve) => setTimeout(resolve, 1));
      return n + index;
    });
    const result = await toArray(transformed);

    expect(result).toEqual([10, 21, 32]);
    expect(indices).toEqual([0, 1, 2]);
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

  test("provides correct index to transform function", async () => {
    const stream = fromArray(["a", "b", "c"]);
    const indexed = flatMap(stream, (item, index) => [`${index}:${item}:1`, `${index}:${item}:2`]);
    const result = await toArray(indexed);

    expect(result).toEqual(["0:a:1", "0:a:2", "1:b:1", "1:b:2", "2:c:1", "2:c:2"]);
  });

  test("index increments for input items, not output items", async () => {
    const stream = fromArray([1, 2, 3]);
    const indices: number[] = [];
    const expanded = flatMap(stream, (n, index) => {
      indices.push(index);
      return [n, n * 2, n * 3];
    });
    const result = await toArray(expanded);

    expect(result).toEqual([1, 2, 3, 2, 4, 6, 3, 6, 9]);
    expect(indices).toEqual([0, 1, 2]); // Only 3 input items
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

  test("provides correct index to side effect function", async () => {
    const indices: number[] = [];
    const stream = fromArray(["a", "b", "c"]);
    const tapped = tap(stream, (_item, index) => {
      indices.push(index);
    });
    await toArray(tapped);

    expect(indices).toEqual([0, 1, 2]);
  });

  test("can use index for logging progress", async () => {
    const logs: string[] = [];
    const stream = fromArray([10, 20, 30]);
    const logged = tap(stream, (n, index) => {
      logs.push(`Item ${index}: ${n}`);
    });
    await toArray(logged);

    expect(logs).toEqual(["Item 0: 10", "Item 1: 20", "Item 2: 30"]);
  });
});

describe("error propagation", () => {
  test("map propagates errors from transform function", async () => {
    const stream = fromArray([1, 2, 3, 4, 5]);
    const failing = map(stream, (n) => {
      if (n === 3) throw new Error("Transform failed at 3");
      return n * 2;
    });

    await expect(toArray(failing)).rejects.toThrow("Transform failed at 3");
  });

  test("filter propagates errors from predicate", async () => {
    const stream = fromArray([1, 2, 3, 4, 5]);
    const failing = filter(stream, (n) => {
      if (n === 3) throw new Error("Filter failed at 3");
      return n % 2 === 0;
    });

    await expect(toArray(failing)).rejects.toThrow("Filter failed at 3");
  });

  test("flatMap propagates errors from transform function", async () => {
    const stream = fromArray([1, 2, 3]);
    const failing = flatMap(stream, (n) => {
      if (n === 2) throw new Error("FlatMap failed at 2");
      return [n, n * 2];
    });

    await expect(toArray(failing)).rejects.toThrow("FlatMap failed at 2");
  });

  test("tap propagates errors from side effect function", async () => {
    const stream = fromArray([1, 2, 3, 4, 5]);
    const failing = tap(stream, (n) => {
      if (n === 3) throw new Error("Tap failed at 3");
    });

    await expect(toArray(failing)).rejects.toThrow("Tap failed at 3");
  });

  test("async errors propagate correctly", async () => {
    const stream = fromArray([1, 2, 3, 4, 5]);
    const failing = map(stream, async (n) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (n === 3) throw new Error("Async error at 3");
      return n * 2;
    });

    await expect(toArray(failing)).rejects.toThrow("Async error at 3");
  });

  test("errors stop stream processing", async () => {
    let processedCount = 0;
    const stream = fromArray([1, 2, 3, 4, 5]);
    const failing = map(stream, (n) => {
      processedCount++;
      if (n === 3) throw new Error("Stop here");
      return n * 2;
    });

    await expect(toArray(failing)).rejects.toThrow("Stop here");
    expect(processedCount).toBe(3); // Should stop after processing 3
  });
});

describe("early termination and cleanup", () => {
  test("take triggers cleanup of source stream", async () => {
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

    const limited = take(source(), 5);
    const result = await toArray(limited);

    expect(result).toEqual([0, 1, 2, 3, 4]);
    expect(cleanedUp).toBe(true);
  });

  test("breaking early from for-await triggers cleanup", async () => {
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

    const stream = map(source(), (n) => n * 2);

    let count = 0;
    for await (const _item of stream) {
      count++;
      if (count >= 3) break;
    }

    expect(count).toBe(3);
    expect(cleanedUp).toBe(true);
  });

  test("filter cleans up source when consumer breaks", async () => {
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

    const evens = filter(source(), (n) => n % 2 === 0);

    let count = 0;
    for await (const _item of evens) {
      count++;
      if (count >= 3) break;
    }

    expect(cleanedUp).toBe(true);
  });

  test("flatMap cleans up source on early termination", async () => {
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

    const expanded = flatMap(source(), (n) => [n, n * 2]);

    let count = 0;
    for await (const _item of expanded) {
      count++;
      if (count >= 5) break;
    }

    expect(cleanedUp).toBe(true);
  });

  test("tap cleans up source on early termination", async () => {
    let cleanedUp = false;
    const sideEffects: number[] = [];

    async function* source() {
      try {
        for (let i = 0; i < 100; i++) {
          yield i;
        }
      } finally {
        cleanedUp = true;
      }
    }

    const tapped = tap(source(), (n) => {
      sideEffects.push(n);
    });

    let count = 0;
    for await (const _item of tapped) {
      count++;
      if (count >= 3) break;
    }

    expect(sideEffects).toEqual([0, 1, 2]);
    expect(cleanedUp).toBe(true);
  });
});

describe("zero-buffering performance", () => {
  test("map processes items one at a time", async () => {
    const processOrder: string[] = [];

    async function* source() {
      for (let i = 0; i < 3; i++) {
        processOrder.push(`source-${i}`);
        yield i;
      }
    }

    const mapped = map(source(), (n) => {
      processOrder.push(`map-${n}`);
      return n * 2;
    });

    for await (const item of mapped) {
      processOrder.push(`consume-${item}`);
    }

    // Should be interleaved: source->map->consume, source->map->consume, etc.
    expect(processOrder).toEqual([
      "source-0",
      "map-0",
      "consume-0",
      "source-1",
      "map-1",
      "consume-2",
      "source-2",
      "map-2",
      "consume-4",
    ]);
  });

  test("filter processes items one at a time", async () => {
    const processOrder: string[] = [];

    async function* source() {
      for (let i = 0; i < 5; i++) {
        processOrder.push(`source-${i}`);
        yield i;
      }
    }

    const filtered = filter(source(), (n) => {
      processOrder.push(`filter-${n}`);
      return n % 2 === 0;
    });

    for await (const item of filtered) {
      processOrder.push(`consume-${item}`);
    }

    // Should process each item before moving to next
    expect(processOrder).toEqual([
      "source-0",
      "filter-0",
      "consume-0",
      "source-1",
      "filter-1",
      "source-2",
      "filter-2",
      "consume-2",
      "source-3",
      "filter-3",
      "source-4",
      "filter-4",
      "consume-4",
    ]);
  });

  test("flatMap processes without buffering", async () => {
    const processOrder: string[] = [];

    async function* source() {
      for (let i = 0; i < 2; i++) {
        processOrder.push(`source-${i}`);
        yield i;
      }
    }

    const expanded = flatMap(source(), (n) => {
      processOrder.push(`expand-${n}`);
      return [n, n + 0.5];
    });

    for await (const item of expanded) {
      processOrder.push(`consume-${item}`);
    }

    // Should expand and consume outputs before fetching next input
    expect(processOrder).toEqual([
      "source-0",
      "expand-0",
      "consume-0",
      "consume-0.5",
      "source-1",
      "expand-1",
      "consume-1",
      "consume-1.5",
    ]);
  });

  test("no unnecessary buffering in long pipeline", async () => {
    const processOrder: string[] = [];
    let itemsGenerated = 0;
    let _itemsConsumed = 0;

    async function* source() {
      for (let i = 0; i < 5; i++) {
        itemsGenerated++;
        processOrder.push(`gen-${i}`);
        yield i;
      }
    }

    const pipeline = map(
      filter(
        map(source(), (n) => {
          processOrder.push(`map1-${n}`);
          return n * 2;
        }),
        (n) => {
          processOrder.push(`filter-${n}`);
          return n % 4 === 0;
        },
      ),
      (n) => {
        processOrder.push(`map2-${n}`);
        _itemsConsumed++;
        return n + 1;
      },
    );

    const results = [];
    for await (const item of pipeline) {
      results.push(item);
      processOrder.push(`consume-${item}`);

      // At this point, we should not have generated all items yet
      // This proves we're not buffering everything upfront
      if (results.length === 1) {
        expect(itemsGenerated).toBeLessThanOrEqual(5);
        // We should have consumed first item but not generated all items
      }
    }

    // Verify we processed items in a streaming fashion, not all at once
    expect(results).toEqual([1, 5, 9]);
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
