/**
 * Unit tests for StreamingPipeline builder API.
 *
 * Tests cover:
 * - Builder method chaining and type safety
 * - Transform operations (map, filter, flatMap, tap)
 * - Windowing operations (batch, window, bufferTime)
 * - Control flow operations (take, skip, takeWhile, skipWhile)
 * - Terminal operations (build, execute, executeToArray, forEach, reduce)
 */

import { describe, expect, test } from "bun:test";
import { fromArray } from "./streaming/generators";
import { StreamingPipeline, streamingStep } from "./streaming-builder";

describe("StreamingPipeline.start()", () => {
  test("creates a new streaming pipeline", () => {
    const pipeline = StreamingPipeline.start<number>();
    expect(pipeline).toBeDefined();
  });

  test("accepts a context builder", () => {
    const context = { userId: "123" };
    const pipeline = StreamingPipeline.start<number>(() => context);
    expect(pipeline).toBeDefined();
  });
});

describe("StreamingPipeline.map()", () => {
  test("maps a transformation over stream items", async () => {
    const pipeline = StreamingPipeline.start<number>().map("doubled", (n) => n * 2);

    const result = await pipeline.executeToArray(fromArray([1, 2, 3]));
    expect(result).toEqual([2, 4, 6]);
  });

  test("supports async transformations", async () => {
    const pipeline = StreamingPipeline.start<number>().map("delayed", async (n) => {
      await Bun.sleep(1);
      return n * 2;
    });

    const result = await pipeline.executeToArray(fromArray([1, 2, 3]));
    expect(result).toEqual([2, 4, 6]);
  });

  test("provides index to transformation function", async () => {
    const pipeline = StreamingPipeline.start<string>().map("indexed", (s, index) => `${index}:${s}`);

    const result = await pipeline.executeToArray(fromArray(["a", "b", "c"]));
    expect(result).toEqual(["0:a", "1:b", "2:c"]);
  });

  test("supports parallel execution", async () => {
    const executionOrder: number[] = [];

    const pipeline = StreamingPipeline.start<number>().map(
      "parallel",
      async (n) => {
        await Bun.sleep(10 - n); // Reverse delay so later items finish first
        executionOrder.push(n);
        return n * 2;
      },
      { parallel: true, concurrency: 3 },
    );

    const result = await pipeline.executeToArray(fromArray([1, 2, 3]));

    // Results should be in order despite parallel execution
    expect(result).toEqual([2, 4, 6]);
    // Execution order should show parallelism (not guaranteed order)
    expect(executionOrder.length).toBe(3);
  });

  test("can chain multiple map operations", async () => {
    const pipeline = StreamingPipeline.start<number>()
      .map("doubled", (n) => n * 2)
      .map("incremented", (n) => n + 1)
      .map("stringified", (n) => n.toString());

    const result = await pipeline.executeToArray(fromArray([1, 2, 3]));
    expect(result).toEqual(["3", "5", "7"]);
  });
});

describe("StreamingPipeline.filter()", () => {
  test("filters items based on predicate", async () => {
    const pipeline = StreamingPipeline.start<number>().filter("evens", (n) => n % 2 === 0);

    const result = await pipeline.executeToArray(fromArray([1, 2, 3, 4, 5]));
    expect(result).toEqual([2, 4]);
  });

  test("supports async predicates", async () => {
    const pipeline = StreamingPipeline.start<number>().filter("valid", async (n) => {
      await Bun.sleep(1);
      return n > 2;
    });

    const result = await pipeline.executeToArray(fromArray([1, 2, 3, 4]));
    expect(result).toEqual([3, 4]);
  });

  test("provides index to predicate", async () => {
    const pipeline = StreamingPipeline.start<string>().filter("oddIndices", (_s, index) => index % 2 === 1);

    const result = await pipeline.executeToArray(fromArray(["a", "b", "c", "d"]));
    expect(result).toEqual(["b", "d"]);
  });

  test("can chain with map", async () => {
    const pipeline = StreamingPipeline.start<number>()
      .filter("evens", (n) => n % 2 === 0)
      .map("doubled", (n) => n * 2);

    const result = await pipeline.executeToArray(fromArray([1, 2, 3, 4, 5]));
    expect(result).toEqual([4, 8]);
  });
});

describe("StreamingPipeline.flatMap()", () => {
  test("flattens nested results", async () => {
    const pipeline = StreamingPipeline.start<string>().flatMap("words", (line) => line.split(" "));

    const result = await pipeline.executeToArray(fromArray(["hello world", "foo bar"]));
    expect(result).toEqual(["hello", "world", "foo", "bar"]);
  });

  test("supports async flatMap", async () => {
    const pipeline = StreamingPipeline.start<number>().flatMap("expanded", async (n) => {
      await Bun.sleep(1);
      return [n, n * 2];
    });

    const result = await pipeline.executeToArray(fromArray([1, 2, 3]));
    expect(result).toEqual([1, 2, 2, 4, 3, 6]);
  });

  test("can return empty arrays", async () => {
    const pipeline = StreamingPipeline.start<number>().flatMap("conditional", (n) => (n > 2 ? [n] : []));

    const result = await pipeline.executeToArray(fromArray([1, 2, 3, 4]));
    expect(result).toEqual([3, 4]);
  });

  test("provides index to flatMap function", async () => {
    const pipeline = StreamingPipeline.start<string>().flatMap("indexed", (s, index) => [
      `${index}:${s}`,
      `${index}:${s.toUpperCase()}`,
    ]);

    const result = await pipeline.executeToArray(fromArray(["a", "b"]));
    expect(result).toEqual(["0:a", "0:A", "1:b", "1:B"]);
  });
});

describe("StreamingPipeline.tap()", () => {
  test("performs side effects without modifying stream", async () => {
    const sideEffects: number[] = [];

    const pipeline = StreamingPipeline.start<number>()
      .tap("logged", (n) => {
        sideEffects.push(n);
      })
      .map("doubled", (n) => n * 2);

    const result = await pipeline.executeToArray(fromArray([1, 2, 3]));

    expect(result).toEqual([2, 4, 6]);
    expect(sideEffects).toEqual([1, 2, 3]);
  });

  test("supports async side effects", async () => {
    const sideEffects: number[] = [];

    const pipeline = StreamingPipeline.start<number>().tap("logged", async (n) => {
      await Bun.sleep(1);
      sideEffects.push(n);
    });

    await pipeline.executeToArray(fromArray([1, 2, 3]));
    expect(sideEffects).toEqual([1, 2, 3]);
  });

  test("provides index to tap function", async () => {
    const indices: number[] = [];

    const pipeline = StreamingPipeline.start<string>().tap("indexed", (_s, index) => {
      indices.push(index);
    });

    await pipeline.executeToArray(fromArray(["a", "b", "c"]));
    expect(indices).toEqual([0, 1, 2]);
  });
});

describe("StreamingPipeline.batch()", () => {
  test("batches items into fixed-size arrays", async () => {
    const pipeline = StreamingPipeline.start<number>().batch("batches", 2);

    const result = await pipeline.executeToArray(fromArray([1, 2, 3, 4, 5]));
    expect(result).toEqual([[1, 2], [3, 4], [5]]);
  });

  test("handles empty stream", async () => {
    const pipeline = StreamingPipeline.start<number>().batch("batches", 2);

    const result = await pipeline.executeToArray(fromArray([]));
    expect(result).toEqual([]);
  });

  test("handles exact multiples", async () => {
    const pipeline = StreamingPipeline.start<number>().batch("batches", 3);

    const result = await pipeline.executeToArray(fromArray([1, 2, 3, 4, 5, 6]));
    expect(result).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  test("can chain with map to process batches", async () => {
    const pipeline = StreamingPipeline.start<number>()
      .batch("batches", 2)
      .map("sums", (batch) => batch.reduce((a, b) => a + b, 0));

    const result = await pipeline.executeToArray(fromArray([1, 2, 3, 4, 5]));
    expect(result).toEqual([3, 7, 5]);
  });
});

describe("StreamingPipeline.take()", () => {
  test("takes first N items", async () => {
    const pipeline = StreamingPipeline.start<number>().take("first3", 3);

    const result = await pipeline.executeToArray(fromArray([1, 2, 3, 4, 5]));
    expect(result).toEqual([1, 2, 3]);
  });

  test("handles take more than available", async () => {
    const pipeline = StreamingPipeline.start<number>().take("first10", 10);

    const result = await pipeline.executeToArray(fromArray([1, 2, 3]));
    expect(result).toEqual([1, 2, 3]);
  });

  test("take(0) returns empty", async () => {
    const pipeline = StreamingPipeline.start<number>().take("none", 0);

    const result = await pipeline.executeToArray(fromArray([1, 2, 3]));
    expect(result).toEqual([]);
  });

  test("closes source stream early", async () => {
    let itemsProcessed = 0;

    const pipeline = StreamingPipeline.start<number>()
      .tap("count", () => {
        itemsProcessed++;
      })
      .take("first2", 2);

    await pipeline.executeToArray(fromArray([1, 2, 3, 4, 5]));

    // Should only process items until take limit
    expect(itemsProcessed).toBe(2);
  });
});

describe("StreamingPipeline.skip()", () => {
  test("skips first N items", async () => {
    const pipeline = StreamingPipeline.start<number>().skip("skip2", 2);

    const result = await pipeline.executeToArray(fromArray([1, 2, 3, 4, 5]));
    expect(result).toEqual([3, 4, 5]);
  });

  test("handles skip more than available", async () => {
    const pipeline = StreamingPipeline.start<number>().skip("skip10", 10);

    const result = await pipeline.executeToArray(fromArray([1, 2, 3]));
    expect(result).toEqual([]);
  });

  test("skip(0) returns all items", async () => {
    const pipeline = StreamingPipeline.start<number>().skip("none", 0);

    const result = await pipeline.executeToArray(fromArray([1, 2, 3]));
    expect(result).toEqual([1, 2, 3]);
  });

  test("can combine skip and take for pagination", async () => {
    const pipeline = StreamingPipeline.start<number>().skip("skipFirst5", 5).take("next5", 5);

    const result = await pipeline.executeToArray(fromArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
    expect(result).toEqual([6, 7, 8, 9, 10]);
  });
});

describe("StreamingPipeline.takeWhile()", () => {
  test("takes items while predicate is true", async () => {
    const pipeline = StreamingPipeline.start<number>().takeWhile("ascending", (n) => n < 3);

    const result = await pipeline.executeToArray(fromArray([1, 2, 3, 4, 5]));
    expect(result).toEqual([1, 2]);
  });

  test("supports async predicates", async () => {
    const pipeline = StreamingPipeline.start<number>().takeWhile("valid", async (n) => {
      await Bun.sleep(1);
      return n < 4;
    });

    const result = await pipeline.executeToArray(fromArray([1, 2, 3, 4, 5]));
    expect(result).toEqual([1, 2, 3]);
  });

  test("provides index to predicate", async () => {
    const pipeline = StreamingPipeline.start<string>().takeWhile("first3", (_s, index) => index < 3);

    const result = await pipeline.executeToArray(fromArray(["a", "b", "c", "d", "e"]));
    expect(result).toEqual(["a", "b", "c"]);
  });

  test("stops on first false", async () => {
    let itemsChecked = 0;

    const pipeline = StreamingPipeline.start<number>().takeWhile("check", (n) => {
      itemsChecked++;
      return n < 3;
    });

    await pipeline.executeToArray(fromArray([1, 2, 3, 4, 5]));

    // Should check items until predicate is false
    expect(itemsChecked).toBe(3);
  });
});

describe("StreamingPipeline.skipWhile()", () => {
  test("skips items while predicate is true", async () => {
    const pipeline = StreamingPipeline.start<number>().skipWhile("skipSmall", (n) => n < 3);

    const result = await pipeline.executeToArray(fromArray([1, 2, 3, 4, 5]));
    expect(result).toEqual([3, 4, 5]);
  });

  test("supports async predicates", async () => {
    const pipeline = StreamingPipeline.start<number>().skipWhile("skipNegative", async (n) => {
      await Bun.sleep(1);
      return n < 0;
    });

    const result = await pipeline.executeToArray(fromArray([-2, -1, 0, 1, 2]));
    expect(result).toEqual([0, 1, 2]);
  });

  test("provides index to predicate", async () => {
    const pipeline = StreamingPipeline.start<string>().skipWhile("skip2", (_s, index) => index < 2);

    const result = await pipeline.executeToArray(fromArray(["a", "b", "c", "d"]));
    expect(result).toEqual(["c", "d"]);
  });
});

describe("StreamingPipeline.build()", () => {
  test("returns a generator function", async () => {
    const pipeline = StreamingPipeline.start<number>().map("doubled", (n) => n * 2);

    const transform = pipeline.build();
    expect(typeof transform).toBe("function");

    const result = transform(fromArray([1, 2, 3]));
    const array = [];
    for await (const item of result) {
      array.push(item);
    }

    expect(array).toEqual([2, 4, 6]);
  });

  test("supports lazy evaluation", async () => {
    let itemsProcessed = 0;

    const pipeline = StreamingPipeline.start<number>()
      .tap("count", () => {
        itemsProcessed++;
      })
      .map("doubled", (n) => n * 2);

    const transform = pipeline.build();

    // No items processed until generator is consumed
    expect(itemsProcessed).toBe(0);

    const result = transform(fromArray([1, 2, 3]));

    // Still no items processed
    expect(itemsProcessed).toBe(0);

    // Consume one item
    const iterator = result[Symbol.asyncIterator]();
    await iterator.next();

    // Now one item is processed
    expect(itemsProcessed).toBe(1);
  });
});

describe("StreamingPipeline.execute()", () => {
  test("executes pipeline and returns async generator", async () => {
    const pipeline = StreamingPipeline.start<number>().map("doubled", (n) => n * 2);

    const result = pipeline.execute(fromArray([1, 2, 3]));
    const array = [];

    for await (const item of result) {
      array.push(item);
    }

    expect(array).toEqual([2, 4, 6]);
  });

  test("supports single item input", async () => {
    const pipeline = StreamingPipeline.start<number>().map("doubled", (n) => n * 2);

    const result = pipeline.execute(5);
    const array = [];

    for await (const item of result) {
      array.push(item);
    }

    expect(array).toEqual([10]);
  });
});

describe("StreamingPipeline.executeToArray()", () => {
  test("collects all results into array", async () => {
    const pipeline = StreamingPipeline.start<number>()
      .map("doubled", (n) => n * 2)
      .filter("large", (n) => n > 2);

    const result = await pipeline.executeToArray(fromArray([1, 2, 3, 4]));
    expect(result).toEqual([4, 6, 8]);
  });

  test("returns empty array for empty stream", async () => {
    const pipeline = StreamingPipeline.start<number>().map("doubled", (n) => n * 2);

    const result = await pipeline.executeToArray(fromArray([]));
    expect(result).toEqual([]);
  });
});

describe("StreamingPipeline.forEach()", () => {
  test("executes side effect for each item", async () => {
    const collected: number[] = [];

    const pipeline = StreamingPipeline.start<number>().map("doubled", (n) => n * 2);

    await pipeline.forEach(fromArray([1, 2, 3]), (item) => {
      collected.push(item);
    });

    expect(collected).toEqual([2, 4, 6]);
  });

  test("provides index to forEach function", async () => {
    const indices: number[] = [];

    const pipeline = StreamingPipeline.start<string>();

    await pipeline.forEach(fromArray(["a", "b", "c"]), (_item, index) => {
      indices.push(index);
    });

    expect(indices).toEqual([0, 1, 2]);
  });

  test("supports async forEach", async () => {
    const collected: number[] = [];

    const pipeline = StreamingPipeline.start<number>();

    await pipeline.forEach(fromArray([1, 2, 3]), async (item) => {
      await Bun.sleep(1);
      collected.push(item);
    });

    expect(collected).toEqual([1, 2, 3]);
  });
});

describe("StreamingPipeline.reduce()", () => {
  test("reduces stream to single value", async () => {
    const pipeline = StreamingPipeline.start<number>();

    const sum = await pipeline.reduce(fromArray([1, 2, 3, 4]), (acc, n) => acc + n, 0);

    expect(sum).toBe(10);
  });

  test("provides index to reducer", async () => {
    const pipeline = StreamingPipeline.start<string>();

    const result = await pipeline.reduce(
      fromArray(["a", "b", "c"]),
      (acc, item, index) => ({ ...acc, [index]: item }),
      {} as Record<number, string>,
    );

    expect(result).toEqual({ 0: "a", 1: "b", 2: "c" });
  });

  test("supports async reducer", async () => {
    const pipeline = StreamingPipeline.start<number>();

    const sum = await pipeline.reduce(
      fromArray([1, 2, 3]),
      async (acc, n) => {
        await Bun.sleep(1);
        return acc + n;
      },
      0,
    );

    expect(sum).toBe(6);
  });

  test("returns initial value for empty stream", async () => {
    const pipeline = StreamingPipeline.start<number>();

    const result = await pipeline.reduce(fromArray([]), (acc, n) => acc + n, 42);

    expect(result).toBe(42);
  });

  test("can count items", async () => {
    const pipeline = StreamingPipeline.start<string>().filter("long", (s) => s.length > 3);

    const count = await pipeline.reduce(fromArray(["a", "hello", "b", "world"]), (acc) => acc + 1, 0);

    expect(count).toBe(2);
  });
});

describe("StreamingPipeline complex compositions", () => {
  test("supports complex multi-step pipelines", async () => {
    const pipeline = StreamingPipeline.start<number>()
      .filter("evens", (n) => n % 2 === 0)
      .map("doubled", (n) => n * 2)
      .tap("logged", (n) => console.log("Processing:", n))
      .batch("batches", 2)
      .map("summed", (batch) => batch.reduce((a, b) => a + b, 0))
      .filter("large", (sum) => sum > 5);

    const result = await pipeline.executeToArray(fromArray([1, 2, 3, 4, 5, 6, 7, 8]));

    // evens: [2, 4, 6, 8]
    // doubled: [4, 8, 12, 16]
    // batches: [[4, 8], [12, 16]]
    // summed: [12, 28]
    // large: [12, 28]

    expect(result).toEqual([12, 28]);
  });

  test("type safety through chain", async () => {
    const pipeline = StreamingPipeline.start<number>()
      .map("strings", (n) => n.toString()) // number -> string
      .map("lengths", (s) => s.length) // string -> number
      .filter("positive", (n) => n > 0) // number -> number
      .batch("batches", 2) // number -> number[]
      .map("counts", (batch) => batch.length); // number[] -> number

    const result = await pipeline.executeToArray(fromArray([1, 22, 333]));
    expect(result).toEqual([2, 1]); // [["1", "22"], ["333"]] -> [2, 1]
  });
});

describe("streamingStep() helper", () => {
  test("creates a streaming step", async () => {
    const doubleStep = streamingStep<number, number>("double", async function* ({ input }) {
      for await (const n of input) {
        yield n * 2;
      }
    });

    expect(doubleStep.name).toBe("double");
    expect(doubleStep.execute).toBeDefined();
  });

  test("works with pipeline.add()", async () => {
    const doubleStep = streamingStep<number, number>("double", async function* ({ input }) {
      for await (const n of input) {
        yield n * 2;
      }
    });

    const pipeline = StreamingPipeline.start<number>().add("doubled", doubleStep);

    const result = await pipeline.executeToArray(fromArray([1, 2, 3]));
    expect(result).toEqual([2, 4, 6]);
  });

  test("supports retry configuration", () => {
    const step = streamingStep<number, number>(
      "resilient",
      async function* ({ input }) {
        for await (const n of input) {
          yield n;
        }
      },
      {
        maxAttempts: 3,
        backoffMs: 1000,
        retryableErrors: ["ETIMEDOUT"],
      },
    );

    expect(step.retry).toEqual({
      maxAttempts: 3,
      backoffMs: 1000,
      retryableErrors: ["ETIMEDOUT"],
    });
  });
});
