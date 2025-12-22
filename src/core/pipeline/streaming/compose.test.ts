import { describe, expect, test } from "bun:test";
import { compose, identity, lift, liftFilter, liftFlatMap, pipe } from "./compose";
import { fromArray, map, toArray } from "./generators";

describe("pipe", () => {
  test("composes functions left to right", async () => {
    const double = lift((n: number) => n * 2);
    const addOne = lift((n: number) => n + 1);
    const numToString = lift((n: number) => String(n));

    const transform = pipe(double, addOne, numToString);
    const input = fromArray([1, 2, 3]);
    const result = await toArray(transform(input));

    // 1 -> 2 -> 3 -> "3"
    // 2 -> 4 -> 5 -> "5"
    // 3 -> 6 -> 7 -> "7"
    expect(result).toEqual(["3", "5", "7"]);
  });

  test("handles single function", async () => {
    const double = lift((n: number) => n * 2);
    const transform = pipe(double);
    const input = fromArray([1, 2, 3]);
    const result = await toArray(transform(input));

    expect(result).toEqual([2, 4, 6]);
  });

  test("throws on no functions", () => {
    // @ts-expect-error - Testing error case with no arguments
    expect(() => pipe()).toThrow("pipe requires at least one function");
  });

  test("type inference works correctly", async () => {
    const numberToString = lift((n: number) => String(n));
    const stringLength = lift((s: string) => s.length);

    const transform = pipe(numberToString, stringLength);
    const input = fromArray([10, 100, 1000]);
    const result = await toArray(transform(input));

    expect(result).toEqual([2, 3, 4]); // "10".length=2, "100".length=3, "1000".length=4
  });

  test("works with complex transformations", async () => {
    const input = fromArray([1, 2, 3, 4, 5]);

    const doubleIfEven = (stream: AsyncGenerator<number>) => map(stream, (n) => (n % 2 === 0 ? n * 2 : n));

    const addTen = lift((n: number) => n + 10);

    const transform = pipe(doubleIfEven, addTen);
    const result = await toArray(transform(input));

    // 1 -> 1 -> 11
    // 2 -> 4 -> 14
    // 3 -> 3 -> 13
    // 4 -> 8 -> 18
    // 5 -> 5 -> 15
    expect(result).toEqual([11, 14, 13, 18, 15]);
  });

  test("handles multiple steps", async () => {
    const step1 = lift((n: number) => n + 1);
    const step2 = lift((n: number) => n * 2);
    const step3 = lift((n: number) => n - 3);
    const step4 = lift((n: number) => n * 10);

    const transform = pipe(step1, step2, step3, step4);
    const input = fromArray([5]);
    const result = await toArray(transform(input));

    // 5 -> 6 -> 12 -> 9 -> 90
    expect(result).toEqual([90]);
  });
});

describe("compose", () => {
  test("composes functions right to left", async () => {
    const addOne = lift((n: number) => n + 1);
    const double = lift((n: number) => n * 2);
    const numToString = lift((n: number) => String(n));

    // Mathematical composition: f(g(h(x)))
    // numToString(addOne(double(x)))
    const transform = compose(numToString, addOne, double);
    const input = fromArray([1, 2, 3]);
    const result = await toArray(transform(input));

    // 1 -> 2 -> 3 -> "3"
    // 2 -> 4 -> 5 -> "5"
    // 3 -> 6 -> 7 -> "7"
    expect(result).toEqual(["3", "5", "7"]);
  });

  test("handles single function", async () => {
    const double = lift((n: number) => n * 2);
    const transform = compose(double);
    const input = fromArray([1, 2, 3]);
    const result = await toArray(transform(input));

    expect(result).toEqual([2, 4, 6]);
  });

  test("throws on no functions", () => {
    // @ts-expect-error - Testing error case with no arguments
    expect(() => compose()).toThrow("compose requires at least one function");
  });

  test("compose and pipe are equivalent with reversed arguments", async () => {
    const step1 = lift((n: number) => n * 2);
    const step2 = lift((n: number) => n + 1);
    const step3 = lift((n: number) => String(n));

    const piped = pipe(step1, step2, step3);
    const composed = compose(step3, step2, step1);

    const input1 = fromArray([1, 2, 3]);
    const input2 = fromArray([1, 2, 3]);

    const result1 = await toArray(piped(input1));
    const result2 = await toArray(composed(input2));

    expect(result1).toEqual(result2);
  });

  test("handles complex composition", async () => {
    const input = fromArray([10, 20, 30]);

    const divideBy10 = lift((n: number) => n / 10);
    const addFive = lift((n: number) => n + 5);
    const multiply3 = lift((n: number) => n * 3);

    // multiply3(addFive(divideBy10(x)))
    const transform = compose(multiply3, addFive, divideBy10);
    const result = await toArray(transform(input));

    // 10 -> 1 -> 6 -> 18
    // 20 -> 2 -> 7 -> 21
    // 30 -> 3 -> 8 -> 24
    expect(result).toEqual([18, 21, 24]);
  });
});

describe("lift", () => {
  test("lifts sync function to generator function", async () => {
    const double = lift((n: number) => n * 2);
    const input = fromArray([1, 2, 3]);
    const result = await toArray(double(input));

    expect(result).toEqual([2, 4, 6]);
  });

  test("lifts async function to generator function", async () => {
    const asyncDouble = lift(async (n: number) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return n * 2;
    });

    const input = fromArray([1, 2, 3]);
    const result = await toArray(asyncDouble(input));

    expect(result).toEqual([2, 4, 6]);
  });

  test("preserves type transformations", async () => {
    const numberToString = lift((n: number) => `num:${n}`);
    const input = fromArray([1, 2, 3]);
    const result = await toArray(numberToString(input));

    expect(result).toEqual(["num:1", "num:2", "num:3"]);
  });

  test("works with complex transformations", async () => {
    const enrichObject = lift((n: number) => ({
      value: n,
      doubled: n * 2,
      isEven: n % 2 === 0,
    }));

    const input = fromArray([1, 2, 3]);
    const result = await toArray(enrichObject(input));

    expect(result).toEqual([
      { value: 1, doubled: 2, isEven: false },
      { value: 2, doubled: 4, isEven: true },
      { value: 3, doubled: 6, isEven: false },
    ]);
  });

  test("can be composed with pipe", async () => {
    const double = lift((n: number) => n * 2);
    const addOne = lift((n: number) => n + 1);
    const transform = pipe(double, addOne);

    const input = fromArray([1, 2, 3]);
    const result = await toArray(transform(input));

    expect(result).toEqual([3, 5, 7]);
  });
});

describe("liftFilter", () => {
  test("lifts sync predicate to generator function", async () => {
    const evens = liftFilter((n: number) => n % 2 === 0);
    const input = fromArray([1, 2, 3, 4, 5]);
    const result = await toArray(evens(input));

    expect(result).toEqual([2, 4]);
  });

  test("lifts async predicate to generator function", async () => {
    const asyncEvens = liftFilter(async (n: number) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return n % 2 === 0;
    });

    const input = fromArray([1, 2, 3, 4, 5]);
    const result = await toArray(asyncEvens(input));

    expect(result).toEqual([2, 4]);
  });

  test("handles complex predicates", async () => {
    const activeAdults = liftFilter((user: { age: number; active: boolean }) => user.age >= 18 && user.active);

    const input = fromArray([
      { age: 16, active: true },
      { age: 25, active: true },
      { age: 30, active: false },
      { age: 20, active: true },
    ]);

    const result = await toArray(activeAdults(input));

    expect(result).toEqual([
      { age: 25, active: true },
      { age: 20, active: true },
    ]);
  });

  test("can be composed with other operations", async () => {
    const evens = liftFilter((n: number) => n % 2 === 0);
    const double = lift((n: number) => n * 2);

    const transform = pipe(evens, double);
    const input = fromArray([1, 2, 3, 4, 5]);
    const result = await toArray(transform(input));

    expect(result).toEqual([4, 8]); // Filter [2,4], then double
  });
});

describe("liftFlatMap", () => {
  test("lifts flatMap function returning array", async () => {
    const splitWords = liftFlatMap((line: string) => line.split(" "));
    const input = fromArray(["hello world", "foo bar"]);
    const result = await toArray(splitWords(input));

    expect(result).toEqual(["hello", "world", "foo", "bar"]);
  });

  test("lifts async flatMap function", async () => {
    const asyncExpand = liftFlatMap(async (n: number) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return [n, n * 2];
    });

    const input = fromArray([1, 2, 3]);
    const result = await toArray(asyncExpand(input));

    expect(result).toEqual([1, 2, 2, 4, 3, 6]);
  });

  test("handles async iterable results", async () => {
    async function* expand(n: number) {
      yield n;
      yield n * 2;
    }

    const expandNumbers = liftFlatMap((n: number) => expand(n));
    const input = fromArray([1, 2, 3]);
    const result = await toArray(expandNumbers(input));

    expect(result).toEqual([1, 2, 2, 4, 3, 6]);
  });

  test("handles empty array results", async () => {
    const filterEvenExpand = liftFlatMap((n: number) => (n % 2 === 0 ? [n, n * 2] : []));

    const input = fromArray([1, 2, 3, 4, 5]);
    const result = await toArray(filterEvenExpand(input));

    expect(result).toEqual([2, 4, 4, 8]);
  });

  test("can be composed with other operations", async () => {
    const splitWords = liftFlatMap((line: string) => line.split(" "));
    const wordLength = lift((word: string) => word.length);

    const transform = pipe(splitWords, wordLength);
    const input = fromArray(["hello world", "foo"]);
    const result = await toArray(transform(input));

    expect(result).toEqual([5, 5, 3]); // lengths of ["hello", "world", "foo"]
  });
});

describe("identity", () => {
  test("returns input unchanged", async () => {
    const id = identity<number>();
    const input = fromArray([1, 2, 3, 4, 5]);
    const result = await toArray(id(input));

    expect(result).toEqual([1, 2, 3, 4, 5]);
  });

  test("works with any type", async () => {
    const id = identity<{ id: number; name: string }>();
    const input = fromArray([
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ]);
    const result = await toArray(id(input));

    expect(result).toEqual([
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ]);
  });

  test("useful as no-op in composition", async () => {
    const double = lift((n: number) => n * 2);
    const conditionalTransform = (condition: boolean) => (condition ? pipe(double, identity()) : identity());

    const input1 = fromArray([1, 2, 3]);
    const input2 = fromArray([1, 2, 3]);

    const result1 = await toArray(conditionalTransform(true)(input1));
    const result2 = await toArray(conditionalTransform(false)(input2));

    expect(result1).toEqual([2, 4, 6]);
    expect(result2).toEqual([1, 2, 3]);
  });

  test("is neutral element in composition", async () => {
    const double = lift((n: number) => n * 2);

    const transform1 = pipe(identity(), double);
    const transform2 = pipe(double, identity());

    const input1 = fromArray([1, 2, 3]);
    const input2 = fromArray([1, 2, 3]);

    const result1 = await toArray(transform1(input1));
    const result2 = await toArray(transform2(input2));

    expect(result1).toEqual([2, 4, 6]);
    expect(result2).toEqual([2, 4, 6]);
  });
});

describe("integration tests", () => {
  test("complex pipeline using all composition utilities", async () => {
    // Pipeline: split lines into words, filter long words, get lengths, double them
    const splitWords = liftFlatMap((line: string) => line.split(" "));
    const longWords = liftFilter((word: string) => word.length > 3);
    const getLength = lift((word: string) => word.length);
    const double = lift((n: number) => n * 2);

    const transform = pipe(splitWords, longWords, getLength, double);

    const input = fromArray(["hello world test", "foo bar amazing"]);
    const result = await toArray(transform(input));

    // Split: ["hello","world","test","foo","bar","amazing"]
    // Filter: ["hello","world","test","amazing"]
    // Lengths: [5,5,4,7]
    // Double: [10,10,8,14]
    expect(result).toEqual([10, 10, 8, 14]);
  });

  test("compose vs pipe equivalence", async () => {
    const step1 = lift((n: number) => n + 1);
    const step2 = lift((n: number) => n * 2);
    const step3 = lift((n: number) => n - 5);

    const piped = pipe(step1, step2, step3);
    const composed = compose(step3, step2, step1);

    const input1 = fromArray([10, 20, 30]);
    const input2 = fromArray([10, 20, 30]);

    const result1 = await toArray(piped(input1));
    const result2 = await toArray(composed(input2));

    expect(result1).toEqual(result2);
  });

  test("deeply nested composition", async () => {
    const ops = Array.from({ length: 10 }, (_, i) => lift((n: number) => n + i));

    // @ts-expect-error - Testing with many arguments
    const transform = pipe(...ops);
    const input = fromArray([0]);
    const result = await toArray(transform(input));

    // 0 + 0 + 1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 = 45
    expect(result).toEqual([45]);
  });

  test("mixing lift types in composition", async () => {
    const numbers = fromArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const filterEvens = liftFilter((n: number) => n % 2 === 0);
    const duplicate = liftFlatMap((n: number) => [n, n]);
    const addTen = lift((n: number) => n + 10);
    const formatValue = lift((n: number) => `value:${n}`);

    const transform = pipe(filterEvens, duplicate, addTen, formatValue);
    const result = await toArray(transform(numbers));

    // Filter: [2,4,6,8,10]
    // Duplicate: [2,2,4,4,6,6,8,8,10,10]
    // Add 10: [12,12,14,14,16,16,18,18,20,20]
    // ToString: ["value:12","value:12",...]
    expect(result).toEqual([
      "value:12",
      "value:12",
      "value:14",
      "value:14",
      "value:16",
      "value:16",
      "value:18",
      "value:18",
      "value:20",
      "value:20",
    ]);
  });
});
