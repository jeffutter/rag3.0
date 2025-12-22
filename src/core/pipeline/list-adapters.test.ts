import { describe, expect, test } from "bun:test";
import {
  createBatchStep,
  createFilterStep,
  createFlattenStep,
  createListStep,
  ListErrorStrategy,
  type PartialListResult,
  singleToList,
} from "./list-adapters";
import { createStep } from "./steps";

describe("singleToList adapter", () => {
  test("converts single-item step to list step", async () => {
    const upperCase = createStep<string, string>("upperCase", async ({ input }) => input.toUpperCase());

    const upperCaseList = singleToList(upperCase);

    const result = await upperCaseList.execute({
      input: ["hello", "world"],
      state: {},
      context: {},
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(["HELLO", "WORLD"]);
    }
  });

  test("handles empty arrays", async () => {
    const step = createStep<string, number>("length", async ({ input }) => input.length);

    const listStep = singleToList(step);

    const result = await listStep.execute({
      input: [],
      state: {},
      context: {},
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([]);
    }
  });

  test("preserves step name with _list suffix", async () => {
    const step = createStep<string, string>("myStep", async ({ input }) => input);

    const listStep = singleToList(step);

    expect(listStep.name).toBe("myStep_list");
  });

  test("FAIL_FAST strategy stops on first error", async () => {
    const step = createStep<number, number>("divide10", async ({ input }) => {
      if (input === 0) {
        throw new Error("Division by zero");
      }
      return 10 / input;
    });

    const listStep = singleToList(step, {
      errorStrategy: ListErrorStrategy.FAIL_FAST,
    });

    const result = await listStep.execute({
      input: [2, 5, 0, 10], // Should stop at 0
      state: {},
      context: {},
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("Division by zero");
    }
  });

  test("COLLECT_ERRORS strategy collects all errors", async () => {
    const step = createStep<number, number>("divide10", async ({ input }) => {
      if (input === 0) {
        throw new Error("Division by zero");
      }
      return 10 / input;
    });

    const listStep = singleToList(step, {
      errorStrategy: ListErrorStrategy.COLLECT_ERRORS,
    });

    const result = await listStep.execute({
      input: [2, 0, 5, 0, 10],
      state: {},
      context: {},
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("LIST_PROCESSING_ERRORS");
      expect(result.error.message).toContain("2 of 5 items failed");
      expect(Array.isArray(result.error.cause)).toBe(true);
    }
  });

  test("SKIP_FAILED strategy returns only successful results", async () => {
    const step = createStep<number, number>("divide10", async ({ input }) => {
      if (input === 0) {
        throw new Error("Division by zero");
      }
      return 10 / input;
    });

    const listStep = singleToList(step, {
      errorStrategy: ListErrorStrategy.SKIP_FAILED,
    });

    const result = await listStep.execute({
      input: [2, 0, 5, 0, 10],
      state: {},
      context: {},
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([5, 2, 1]); // 10/2, 10/5, 10/10
    }
  });

  test("parallel execution processes items concurrently", async () => {
    const delays: number[] = [];
    let startTime: number;

    const step = createStep<number, number>("delay", async ({ input }) => {
      const delay = input * 10;
      await new Promise((resolve) => setTimeout(resolve, delay));
      delays.push(Date.now() - startTime);
      return input;
    });

    const listStep = singleToList(step, { parallel: true });

    startTime = Date.now();
    const result = await listStep.execute({
      input: [5, 4, 3, 2, 1],
      state: {},
      context: {},
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([5, 4, 3, 2, 1]);
      // Parallel execution should complete in ~50ms (max delay)
      // Sequential would take ~150ms (sum of delays)
      // We allow some margin for test execution
      expect(Date.now() - startTime).toBeLessThan(100);
    }
  });

  test("sequential execution processes items one by one", async () => {
    const executionOrder: number[] = [];

    const step = createStep<number, number>("track", async ({ input }) => {
      executionOrder.push(input);
      return input;
    });

    const listStep = singleToList(step, { parallel: false });

    const result = await listStep.execute({
      input: [1, 2, 3, 4, 5],
      state: {},
      context: {},
    });

    expect(result.success).toBe(true);
    expect(executionOrder).toEqual([1, 2, 3, 4, 5]);
  });

  test("preserves metadata from execution", async () => {
    const step = createStep<string, string>("identity", async ({ input }) => input);

    const listStep = singleToList(step);

    const result = await listStep.execute({
      input: ["test"],
      state: {},
      context: {},
    });

    expect(result.metadata).toBeDefined();
    expect(result.metadata.stepName).toBe("identity_list");
    expect(result.metadata.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("passes state and context to underlying step", async () => {
    let capturedState: unknown;
    let capturedContext: unknown;

    const step = createStep<string, string, { prev: number }, { user: string }>(
      "capture",
      async ({ input, state, context }) => {
        capturedState = state;
        capturedContext = context;
        return input;
      },
    );

    const listStep = singleToList(step);

    await listStep.execute({
      input: ["test"],
      state: { prev: 42 },
      context: { user: "alice" },
    });

    expect(capturedState).toEqual({ prev: 42 });
    expect(capturedContext).toEqual({ user: "alice" });
  });
});

describe("createListStep", () => {
  test("creates a list step with custom execute function", async () => {
    const sortStep = createListStep<string, string>("sort", async ({ input }) => {
      return [...input].sort();
    });

    const result = await sortStep.execute({
      input: ["c", "a", "b"],
      state: {},
      context: {},
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(["a", "b", "c"]);
    }
  });

  test("handles errors in execute function", async () => {
    const errorStep = createListStep<string, string>("error", async () => {
      throw new Error("Test error");
    });

    const result = await errorStep.execute({
      input: ["test"],
      state: {},
      context: {},
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe("Test error");
      expect(result.error.code).toBe("LIST_STEP_ERROR");
    }
  });

  test("provides access to state and context", async () => {
    const step = createListStep<string, string, { count: number }>("withState", async ({ input, state }) => {
      return input.map((s) => `${s}-${state.count}`);
    });

    const result = await step.execute({
      input: ["a", "b"],
      state: { count: 5 },
      context: {},
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(["a-5", "b-5"]);
    }
  });
});

describe("createBatchStep", () => {
  test("batches array into chunks of specified size", async () => {
    const batch3 = createBatchStep<number>(3);

    const result = await batch3.execute({
      input: [1, 2, 3, 4, 5, 6, 7, 8],
      state: {},
      context: {},
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([
        [1, 2, 3],
        [4, 5, 6],
        [7, 8],
      ]);
    }
  });

  test("handles arrays smaller than batch size", async () => {
    const batch10 = createBatchStep<string>(10);

    const result = await batch10.execute({
      input: ["a", "b", "c"],
      state: {},
      context: {},
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([["a", "b", "c"]]);
    }
  });

  test("handles empty arrays", async () => {
    const batch5 = createBatchStep<number>(5);

    const result = await batch5.execute({
      input: [],
      state: {},
      context: {},
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([]);
    }
  });

  test("throws error for invalid batch size", () => {
    expect(() => createBatchStep(0)).toThrow("Batch size must be greater than 0");
    expect(() => createBatchStep(-5)).toThrow("Batch size must be greater than 0");
  });

  test("allows custom step name", async () => {
    const batch2 = createBatchStep<number>(2, "customBatch");

    expect(batch2.name).toBe("customBatch");
  });
});

describe("createFlattenStep", () => {
  test("flattens nested arrays", async () => {
    const flatten = createFlattenStep<number>();

    const result = await flatten.execute({
      input: [[1, 2], [3, 4], [5]],
      state: {},
      context: {},
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([1, 2, 3, 4, 5]);
    }
  });

  test("handles empty nested arrays", async () => {
    const flatten = createFlattenStep<string>();

    const result = await flatten.execute({
      input: [[], ["a"], [], ["b", "c"], []],
      state: {},
      context: {},
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(["a", "b", "c"]);
    }
  });

  test("handles completely empty input", async () => {
    const flatten = createFlattenStep<number>();

    const result = await flatten.execute({
      input: [],
      state: {},
      context: {},
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([]);
    }
  });

  test("allows custom step name", async () => {
    const flatten = createFlattenStep<string>("customFlatten");

    expect(flatten.name).toBe("customFlatten");
  });
});

describe("createFilterStep", () => {
  test("filters array based on predicate", async () => {
    const filterEven = createFilterStep<number>((n) => n % 2 === 0, "filterEven");

    const result = await filterEven.execute({
      input: [1, 2, 3, 4, 5, 6],
      state: {},
      context: {},
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([2, 4, 6]);
    }
  });

  test("supports async predicates", async () => {
    const asyncFilter = createFilterStep<string>(async (s) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return s.length > 3;
    }, "asyncFilter");

    const result = await asyncFilter.execute({
      input: ["a", "ab", "abc", "abcd", "abcde"],
      state: {},
      context: {},
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(["abcd", "abcde"]);
    }
  });

  test("provides index to predicate", async () => {
    const filterByIndex = createFilterStep<string>((_, index) => index % 2 === 0, "filterByIndex");

    const result = await filterByIndex.execute({
      input: ["a", "b", "c", "d", "e"],
      state: {},
      context: {},
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(["a", "c", "e"]); // indices 0, 2, 4
    }
  });

  test("handles empty arrays", async () => {
    const filter = createFilterStep<number>((n) => n > 0);

    const result = await filter.execute({
      input: [],
      state: {},
      context: {},
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([]);
    }
  });

  test("returns empty array when nothing matches", async () => {
    const filter = createFilterStep<number>((n) => n > 100);

    const result = await filter.execute({
      input: [1, 2, 3, 4, 5],
      state: {},
      context: {},
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([]);
    }
  });

  test("allows custom step name", async () => {
    const filter = createFilterStep<number>((n) => n > 0, "customFilter");

    expect(filter.name).toBe("customFilter");
  });
});

describe("PartialListResult type", () => {
  test("type correctly represents partial success", () => {
    const partialResult: PartialListResult<number> = {
      successes: [
        { index: 0, data: 5 },
        { index: 2, data: 2 },
      ],
      failures: [
        {
          index: 1,
          error: {
            code: "ERROR",
            message: "Failed",
            retryable: false,
          },
        },
      ],
      total: 3,
    };

    expect(partialResult.successes).toHaveLength(2);
    expect(partialResult.failures).toHaveLength(1);
    expect(partialResult.total).toBe(3);
  });
});

describe("integration tests", () => {
  test("can chain list operations together", async () => {
    // Create a pipeline that: batches -> flattens -> filters
    const batch2 = createBatchStep<number>(2, "batch2");
    const flatten = createFlattenStep<number>("flatten");
    const filterEven = createFilterStep<number>((n) => n % 2 === 0, "filterEven");

    // Batch
    const batchResult = await batch2.execute({
      input: [1, 2, 3, 4, 5, 6],
      state: {},
      context: {},
    });

    expect(batchResult.success).toBe(true);
    if (!batchResult.success) return;

    // Flatten
    const flattenResult = await flatten.execute({
      input: batchResult.data,
      state: {},
      context: {},
    });

    expect(flattenResult.success).toBe(true);
    if (!flattenResult.success) return;

    // Filter
    const filterResult = await filterEven.execute({
      input: flattenResult.data,
      state: {},
      context: {},
    });

    expect(filterResult.success).toBe(true);
    if (filterResult.success) {
      expect(filterResult.data).toEqual([2, 4, 6]);
    }
  });

  test("can use singleToList with other list operations", async () => {
    const uppercase = createStep<string, string>("uppercase", async ({ input }) => input.toUpperCase());

    const uppercaseList = singleToList(uppercase);
    const filterLong = createFilterStep<string>((s) => s.length > 3, "filterLong");

    // Apply uppercase to list
    const uppercaseResult = await uppercaseList.execute({
      input: ["hi", "hello", "world", "bye"],
      state: {},
      context: {},
    });

    expect(uppercaseResult.success).toBe(true);
    if (!uppercaseResult.success) return;

    // Filter long words
    const filterResult = await filterLong.execute({
      input: uppercaseResult.data,
      state: {},
      context: {},
    });

    expect(filterResult.success).toBe(true);
    if (filterResult.success) {
      expect(filterResult.data).toEqual(["HELLO", "WORLD"]);
    }
  });
});
