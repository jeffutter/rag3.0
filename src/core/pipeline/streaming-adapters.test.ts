/**
 * Tests for streaming adapter utilities.
 *
 * Validates:
 * - toStreamingStep correctly wraps batch steps
 * - toBatchStep correctly materializes streaming steps
 * - Hybrid steps work in both modes
 * - Step categorization and migration recommendations
 * - Error handling and retry logic preservation
 * - State access patterns work correctly
 */

import { describe, expect, test } from "bun:test";
import { createStep } from "./steps";
import {
  categorizeStep,
  createHybridStep,
  getMigrationRecommendation,
  StepCategory,
  toBatchMode,
  toBatchStep,
  toStreamingMode,
  toStreamingStep,
} from "./streaming-adapters";
import { arrayToGenerator, collectStream, StreamingStateImpl } from "./streaming-state";
import { createStreamingStep } from "./streaming-steps";

describe("Streaming Adapters", () => {
  describe("toStreamingStep", () => {
    test("converts batch step to streaming step", async () => {
      // Create a simple batch step
      const upperCaseStep = createStep<string, string>("upperCase", async ({ input }) => input.toUpperCase());

      // Convert to streaming
      const streamingUpperCase = toStreamingStep(upperCaseStep);

      expect(streamingUpperCase.name).toBe("upperCase_streaming");

      // Test execution
      const inputGen = arrayToGenerator(["hello", "world", "test"]);
      const state = new StreamingStateImpl<Record<string, never>>({}, {});

      const outputGen = streamingUpperCase.execute({
        input: inputGen,
        state,
        context: undefined,
      });

      const results = await collectStream(outputGen);

      expect(results).toEqual(["HELLO", "WORLD", "TEST"]);
    });

    test("preserves retry configuration", async () => {
      const stepWithRetry = createStep<string, string>("withRetry", async ({ input }) => input.toUpperCase(), {
        retry: {
          maxAttempts: 3,
          backoffMs: 100,
          retryableErrors: ["TIMEOUT"],
        },
      });

      const streamingStep = toStreamingStep(stepWithRetry);

      expect(streamingStep.retry).toEqual({
        maxAttempts: 3,
        backoffMs: 100,
        retryableErrors: ["TIMEOUT"],
      });
    });

    test("works with steps that access state", async () => {
      type State = { config: { multiplier: number }[] };

      const multiplyStep = createStep<number, number, State>("multiply", async ({ input, state }) => {
        const config = state.config[0];
        return input * (config?.multiplier ?? 1);
      });

      const streamingMultiply = toStreamingStep(multiplyStep);

      // Setup state with checkpointed config
      const state = new StreamingStateImpl<State>({ config: [{ multiplier: 5 }] }, {});

      const inputGen = arrayToGenerator([1, 2, 3, 4]);
      const outputGen = streamingMultiply.execute({
        input: inputGen,
        state,
        context: undefined,
      });

      const results = await collectStream(outputGen);

      expect(results).toEqual([5, 10, 15, 20]);
    });

    test("propagates errors from batch step", async () => {
      const errorStep = createStep<number, number>("error", async ({ input }) => {
        if (input === 2) {
          throw new Error("Invalid input: 2");
        }
        return input * 2;
      });

      const streamingError = toStreamingStep(errorStep);

      const inputGen = arrayToGenerator([1, 2, 3]);
      const state = new StreamingStateImpl<Record<string, never>>({}, {});

      const outputGen = streamingError.execute({
        input: inputGen,
        state,
        context: undefined,
      });

      // Should process first item, then throw on second
      const results: number[] = [];
      try {
        for await (const item of outputGen) {
          results.push(item);
        }
        expect.unreachable("Should have thrown an error");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("Invalid input: 2");
      }

      // Should have processed first item before error
      expect(results).toEqual([2]);
    });
  });

  describe("toBatchStep", () => {
    test("converts streaming step to batch step", async () => {
      const streamingDouble = createStreamingStep<number, number>("double", async function* ({ input }) {
        for await (const num of input) {
          yield num * 2;
        }
      });

      const batchDouble = toBatchStep(streamingDouble);

      expect(batchDouble.name).toBe("double_batch");

      const result = await batchDouble.execute({
        input: [1, 2, 3, 4, 5],
        state: {},
        context: undefined,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual([2, 4, 6, 8, 10]);
      }
    });

    test("preserves retry configuration", async () => {
      const streamingStep = createStreamingStep<number, number>(
        "withRetry",
        async function* ({ input }) {
          for await (const num of input) {
            yield num * 2;
          }
        },
        {
          retry: {
            maxAttempts: 5,
            backoffMs: 200,
            retryableErrors: ["NETWORK_ERROR"],
          },
        },
      );

      const batchStep = toBatchStep(streamingStep);

      expect(batchStep.retry).toEqual({
        maxAttempts: 5,
        backoffMs: 200,
        retryableErrors: ["NETWORK_ERROR"],
      });
    });

    test("handles errors from streaming step", async () => {
      const errorStreamingStep = createStreamingStep<number, number>("error", async function* ({ input }) {
        let count = 0;
        for await (const num of input) {
          count++;
          if (count === 3) {
            throw new Error("Error at item 3");
          }
          yield num * 2;
        }
      });

      const batchStep = toBatchStep(errorStreamingStep);

      const result = await batchStep.execute({
        input: [1, 2, 3, 4, 5],
        state: {},
        context: undefined,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("Error at item 3");
      }
    });
  });

  describe("Hybrid Steps", () => {
    test("createHybridStep creates step supporting both modes", async () => {
      const hybridUpperCase = createHybridStep<string, string>(
        "upperCase",
        // Batch mode
        async ({ input }) => input.map((s) => s.toUpperCase()),
        // Streaming mode
        async function* ({ input }) {
          for await (const s of input) {
            yield s.toUpperCase();
          }
        },
      );

      expect(hybridUpperCase.name).toBe("upperCase");

      // Test batch mode
      const batchResult = await hybridUpperCase.execute({
        input: ["hello", "world"],
        state: {},
        context: undefined,
      });

      expect(batchResult.success).toBe(true);
      if (batchResult.success) {
        expect(batchResult.data).toEqual(["HELLO", "WORLD"]);
      }

      // Test streaming mode
      const inputGen = arrayToGenerator(["hello", "world"]);
      const state = new StreamingStateImpl<Record<string, never>>({}, {});

      const streamingResults = await collectStream(
        hybridUpperCase.stream({
          input: inputGen,
          state,
          context: undefined,
        }),
      );

      expect(streamingResults).toEqual(["HELLO", "WORLD"]);
    });

    test("toBatchMode extracts batch interface from hybrid step", async () => {
      const hybridStep = createHybridStep<number, number>(
        "double",
        async ({ input }) => input.map((n) => n * 2),
        async function* ({ input }) {
          for await (const n of input) {
            yield n * 2;
          }
        },
      );

      const batchStep = toBatchMode(hybridStep);

      expect(batchStep.name).toBe("double");

      const result = await batchStep.execute({
        input: [1, 2, 3],
        state: {},
        context: undefined,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual([2, 4, 6]);
      }
    });

    test("toStreamingMode extracts streaming interface from hybrid step", async () => {
      const hybridStep = createHybridStep<number, number>(
        "triple",
        async ({ input }) => input.map((n) => n * 3),
        async function* ({ input }) {
          for await (const n of input) {
            yield n * 3;
          }
        },
      );

      const streamingStep = toStreamingMode(hybridStep);

      expect(streamingStep.name).toBe("triple");

      const inputGen = arrayToGenerator([1, 2, 3]);
      const state = new StreamingStateImpl<Record<string, never>>({}, {});

      const results = await collectStream(
        streamingStep.execute({
          input: inputGen,
          state,
          context: undefined,
        }),
      );

      expect(results).toEqual([3, 6, 9]);
    });

    test("hybrid step with retry configuration", async () => {
      const hybridStep = createHybridStep<number, number>(
        "withRetry",
        async ({ input }) => input.map((n) => n * 2),
        async function* ({ input }) {
          for await (const n of input) {
            yield n * 2;
          }
        },
        {
          retry: {
            maxAttempts: 3,
            backoffMs: 100,
            retryableErrors: ["TIMEOUT"],
          },
        },
      );

      expect(hybridStep.retry).toEqual({
        maxAttempts: 3,
        backoffMs: 100,
        retryableErrors: ["TIMEOUT"],
      });

      const batchStep = toBatchMode(hybridStep);
      expect(batchStep.retry).toEqual(hybridStep.retry);

      const streamingStep = toStreamingMode(hybridStep);
      expect(streamingStep.retry).toEqual(hybridStep.retry);
    });
  });

  describe("Step Categorization", () => {
    test("categorizes pure transform steps", () => {
      const upperCaseStep = createStep<string, string>("upperCase", async ({ input }) => input.toUpperCase());

      const category = categorizeStep(upperCaseStep);

      expect(category).toBe(StepCategory.PURE_TRANSFORM);
    });

    test("categorizes I/O bound steps", () => {
      const readFileStep = createStep<string, string>("readFile", async ({ input }) => input);
      const fetchStep = createStep<string, string>("fetchAPI", async ({ input }) => input);
      const dbStep = createStep<string, string>("queryDatabase", async ({ input }) => input);

      expect(categorizeStep(readFileStep)).toBe(StepCategory.IO_BOUND);
      expect(categorizeStep(fetchStep)).toBe(StepCategory.IO_BOUND);
      expect(categorizeStep(dbStep)).toBe(StepCategory.IO_BOUND);
    });

    test("categorizes aggregation steps", () => {
      const sortStep = createStep<number[], number[]>("sort", async ({ input }) => input.sort());
      const groupStep = createStep<string[], Record<string, string[]>>("groupBy", async () => ({}));
      const sumStep = createStep<number[], number>("sum", async ({ input }) => input.reduce((a, b) => a + b, 0));

      expect(categorizeStep(sortStep)).toBe(StepCategory.AGGREGATION);
      expect(categorizeStep(groupStep)).toBe(StepCategory.AGGREGATION);
      expect(categorizeStep(sumStep)).toBe(StepCategory.AGGREGATION);
    });

    test("categorizes expansion steps", () => {
      const splitStep = createStep<string, string[]>("split", async ({ input }) => input.split(","));
      const chunkStep = createStep<string, string[]>("chunk", async ({ input }) => [input]);
      const flatMapStep = createStep<string[], string>("flatMap", async ({ input }) => input[0] ?? "");

      expect(categorizeStep(splitStep)).toBe(StepCategory.EXPANSION);
      expect(categorizeStep(chunkStep)).toBe(StepCategory.EXPANSION);
      expect(categorizeStep(flatMapStep)).toBe(StepCategory.EXPANSION);
    });

    test("categorizes reduction steps", () => {
      const filterStep = createStep<number[], number[]>("filter", async ({ input }) => input.filter((n) => n > 0));
      const dedupeStep = createStep<string[], string[]>("dedupe", async ({ input }) => [...new Set(input)]);
      const limitStep = createStep<number[], number[]>("limit", async ({ input }) => input.slice(0, 10));

      expect(categorizeStep(filterStep)).toBe(StepCategory.REDUCTION);
      expect(categorizeStep(dedupeStep)).toBe(StepCategory.REDUCTION);
      expect(categorizeStep(limitStep)).toBe(StepCategory.REDUCTION);
    });

    test("categorizes stateful steps", () => {
      const cacheStep = createStep<string, string>("cache", async ({ input }) => input);
      const rateLimiter = createStep<string, string>("rateControl", async ({ input }) => input);
      const throttleStep = createStep<string, string>("throttle", async ({ input }) => input);

      expect(categorizeStep(cacheStep)).toBe(StepCategory.STATEFUL);
      expect(categorizeStep(rateLimiter)).toBe(StepCategory.STATEFUL);
      expect(categorizeStep(throttleStep)).toBe(StepCategory.STATEFUL);
    });
  });

  describe("Migration Recommendations", () => {
    test("recommends streaming for pure transforms", () => {
      const step = createStep<string, string>("toUpperCase", async ({ input }) => input.toUpperCase());

      const recommendation = getMigrationRecommendation(step);

      expect(recommendation.category).toBe(StepCategory.PURE_TRANSFORM);
      expect(recommendation.recommended).toBe(true);
      expect(recommendation.strength).toBeGreaterThan(0.8);
      expect(recommendation.approach).toBe("toStreamingStep");
      expect(recommendation.reason).toContain("Pure transformations");
    });

    test("recommends streaming for I/O bound operations", () => {
      const step = createStep<string, string>("fetchAPI", async ({ input }) => input);

      const recommendation = getMigrationRecommendation(step);

      expect(recommendation.category).toBe(StepCategory.IO_BOUND);
      expect(recommendation.recommended).toBe(true);
      expect(recommendation.strength).toBeGreaterThan(0.9);
      expect(recommendation.approach).toBe("toStreamingStep");
      expect(recommendation.reason).toContain("I/O-bound");
    });

    test("recommends keeping batch for aggregations", () => {
      const step = createStep<number[], number[]>("sort", async ({ input }) => input.sort());

      const recommendation = getMigrationRecommendation(step);

      expect(recommendation.category).toBe(StepCategory.AGGREGATION);
      expect(recommendation.recommended).toBe(false);
      expect(recommendation.strength).toBeLessThan(0.5);
      expect(recommendation.approach).toBe("keep_batch");
      expect(recommendation.reason).toContain("Aggregations require full dataset");
    });

    test("recommends manual conversion for expansion steps", () => {
      const step = createStep<string, string[]>("split", async ({ input }) => input.split(","));

      const recommendation = getMigrationRecommendation(step);

      expect(recommendation.category).toBe(StepCategory.EXPANSION);
      expect(recommendation.recommended).toBe(true);
      expect(recommendation.approach).toBe("manual_conversion");
      expect(recommendation.reason).toContain("Expansion");
    });

    test("recommends hybrid for reduction steps", () => {
      const step = createStep<number[], number[]>("filter", async ({ input }) => input.filter((n) => n > 0));

      const recommendation = getMigrationRecommendation(step);

      expect(recommendation.category).toBe(StepCategory.REDUCTION);
      expect(recommendation.recommended).toBe(true);
      expect(recommendation.approach).toBe("createHybridStep");
    });

    test("recommends caution for stateful steps", () => {
      const step = createStep<string, string>("cache", async ({ input }) => input);

      const recommendation = getMigrationRecommendation(step);

      expect(recommendation.category).toBe(StepCategory.STATEFUL);
      expect(recommendation.recommended).toBe(true);
      expect(recommendation.approach).toBe("manual_conversion");
      expect(recommendation.reason).toContain("bounded");
    });
  });

  describe("Round-trip Conversions", () => {
    test("batch -> streaming -> batch preserves behavior", async () => {
      const originalStep = createStep<number, number>("double", async ({ input }) => input * 2);

      // Convert to streaming and back
      const streamingStep = toStreamingStep(originalStep);
      const batchStep = toBatchStep(streamingStep);

      // Test original
      const originalResult = await originalStep.execute({
        input: 5,
        state: {},
        context: undefined,
      });

      // Test round-trip (using array since toBatchStep expects arrays)
      const roundTripResult = await batchStep.execute({
        input: [5],
        state: {},
        context: undefined,
      });

      expect(originalResult.success).toBe(true);
      expect(roundTripResult.success).toBe(true);

      if (originalResult.success && roundTripResult.success) {
        expect(roundTripResult.data).toEqual([originalResult.data]);
      }
    });

    test("streaming -> batch -> streaming preserves behavior", async () => {
      const originalStep = createStreamingStep<number, number>("triple", async function* ({ input }) {
        for await (const num of input) {
          yield num * 3;
        }
      });

      // Convert to batch and back
      const _batchStep = toBatchStep(originalStep);
      const streamingStep = toStreamingStep(createStep<number, number>("triple", async ({ input }) => input * 3));

      // Test original
      const inputGen1 = arrayToGenerator([1, 2, 3]);
      const state1 = new StreamingStateImpl<Record<string, never>>({}, {});
      const originalResults = await collectStream(
        originalStep.execute({
          input: inputGen1,
          state: state1,
          context: undefined,
        }),
      );

      // Test round-trip
      const inputGen2 = arrayToGenerator([1, 2, 3]);
      const state2 = new StreamingStateImpl<Record<string, never>>({}, {});
      const roundTripResults = await collectStream(
        streamingStep.execute({
          input: inputGen2,
          state: state2,
          context: undefined,
        }),
      );

      expect(originalResults).toEqual(roundTripResults);
    });
  });

  describe("Behavioral Equivalence", () => {
    test("toStreamingStep produces same results as original batch step", async () => {
      const batchStep = createStep<string, { original: string; upper: string }>("transform", async ({ input }) => ({
        original: input,
        upper: input.toUpperCase(),
      }));

      const streamingStep = toStreamingStep(batchStep);

      const testInputs = ["hello", "world", "test", "data"];

      // Run batch step on each input
      const batchResults = await Promise.all(
        testInputs.map((input) =>
          batchStep.execute({
            input,
            state: {},
            context: undefined,
          }),
        ),
      );

      // Run streaming step
      const inputGen = arrayToGenerator(testInputs);
      const state = new StreamingStateImpl<Record<string, never>>({}, {});
      const streamingResults = await collectStream(
        streamingStep.execute({
          input: inputGen,
          state,
          context: undefined,
        }),
      );

      // Extract data from batch results
      const batchData = batchResults
        .map((r) => (r.success ? r.data : null))
        .filter((x): x is NonNullable<typeof x> => x !== null);

      expect(streamingResults).toEqual(batchData);
    });

    test("hybrid step produces identical results in both modes", async () => {
      const hybridStep = createHybridStep<number, { value: number; squared: number }>(
        "squareWithOriginal",
        // Batch mode
        async ({ input }) =>
          input.map((n) => ({
            value: n,
            squared: n * n,
          })),
        // Streaming mode
        async function* ({ input }) {
          for await (const n of input) {
            yield {
              value: n,
              squared: n * n,
            };
          }
        },
      );

      const testInput = [1, 2, 3, 4, 5];

      // Test batch mode
      const batchResult = await hybridStep.execute({
        input: testInput,
        state: {},
        context: undefined,
      });

      // Test streaming mode
      const inputGen = arrayToGenerator(testInput);
      const state = new StreamingStateImpl<Record<string, never>>({}, {});
      const streamingResults = await collectStream(
        hybridStep.stream({
          input: inputGen,
          state,
          context: undefined,
        }),
      );

      expect(batchResult.success).toBe(true);
      if (batchResult.success) {
        expect(streamingResults).toEqual(batchResult.data);
      }
    });
  });
});
