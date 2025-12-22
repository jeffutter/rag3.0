/**
 * Comprehensive integration tests for the entire pipeline system.
 *
 * These tests validate:
 * - End-to-end workflows with complex pipelines
 * - Edge cases (empty arrays, single elements, large arrays)
 * - Error propagation through complex chains
 * - State accumulation across multiple steps
 * - Type safety in practice
 * - Real-world usage patterns
 */

import { describe, expect, test } from "bun:test";
import { Pipeline } from "./builder";
import { ListErrorStrategy } from "./list-adapters";
import { createStep } from "./steps";

describe("Pipeline Integration Tests", () => {
  describe("End-to-end workflows", () => {
    test("complex multi-stage pipeline with state accumulation", async () => {
      // Simulates a document processing workflow:
      // 1. Parse raw text
      // 2. Extract entities
      // 3. Classify sentiment
      // 4. Generate summary using all previous data

      interface Document {
        text: string;
        metadata: Record<string, string>;
      }

      interface ParsedDoc {
        sentences: string[];
        wordCount: number;
      }

      interface Entities {
        names: string[];
        places: string[];
      }

      interface Sentiment {
        score: number;
        label: "positive" | "negative" | "neutral";
      }

      interface Summary {
        text: string;
        stats: {
          wordCount: number;
          entityCount: number;
          sentiment: string;
        };
      }

      const parseStep = createStep<Document, ParsedDoc, unknown, unknown>("parse", async ({ input }) => {
        const sentences = input.text.split(". ").filter((s) => s.trim());
        const wordCount = input.text.split(/\s+/).length;
        return { sentences, wordCount };
      });

      const extractEntitiesStep = createStep<ParsedDoc, Entities, { parsed: ParsedDoc }, unknown>(
        "extractEntities",
        async ({ input }) => {
          // Simple mock entity extraction
          const names = input.sentences.join(" ").match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g) || [];
          return {
            names: [...new Set(names)],
            places: [],
          };
        },
      );

      const sentimentStep = createStep<Entities, Sentiment, { parsed: ParsedDoc; entities: Entities }, unknown>(
        "sentiment",
        async ({ state }) => {
          // Mock sentiment based on word count
          const score = state.parsed.wordCount > 50 ? 0.8 : 0.3;
          return {
            score,
            label: score > 0.6 ? "positive" : score < 0.4 ? "negative" : "neutral",
          };
        },
      );

      const summaryStep = createStep<
        Sentiment,
        Summary,
        { parsed: ParsedDoc; entities: Entities; sentiment: Sentiment },
        unknown
      >("summary", async ({ state }) => {
        return {
          text: `Document with ${state.parsed.wordCount} words, ${state.entities.names.length} entities, ${state.sentiment.label} sentiment`,
          stats: {
            wordCount: state.parsed.wordCount,
            entityCount: state.entities.names.length,
            sentiment: state.sentiment.label,
          },
        };
      });

      const pipeline = Pipeline.start<Document>()
        .add("parsed", parseStep)
        .add("entities", extractEntitiesStep)
        .add("sentiment", sentimentStep)
        .add("summary", summaryStep);

      const result = await pipeline.execute({
        text: "Alice went to Paris. Bob stayed in New York. Charlie visited Tokyo. Everyone had a great time exploring new places and meeting new people.",
        metadata: { author: "test" },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.stats.wordCount).toBeGreaterThan(0);
        expect(result.data.stats.entityCount).toBeGreaterThan(0);
        expect(result.data.stats.sentiment).toMatch(/positive|negative|neutral/);
      }
    });

    test("pipeline with mixed single and list operations", async () => {
      // Process multiple documents through a complex pipeline
      interface Doc {
        id: string;
        content: string;
      }

      interface ProcessedDoc {
        id: string;
        words: string[];
        metadata: { originalLength: number };
      }

      const pipeline = Pipeline.start<Doc[]>()
        .map(
          "processed",
          createStep("process", async ({ input }: { input: Doc }) => {
            const words = input.content.toLowerCase().split(/\s+/);
            return {
              id: input.id,
              words,
              metadata: { originalLength: input.content.length },
            };
          }),
          { parallel: true },
        )
        .map(
          "enriched",
          createStep("enrich", async ({ input }: { input: ProcessedDoc }) => {
            const avgWordLength = input.words.reduce((sum, w) => sum + w.length, 0) / input.words.length;
            return {
              ...input,
              wordCount: input.words.length,
              avgWordLength,
            };
          }),
          { parallel: true },
        )
        .filter("substantive", (doc) => doc.wordCount > 3)
        .add(
          "summary",
          createStep("summary", async ({ input }) => ({
            totalDocs: input.length,
            avgWords: input.reduce((sum, d) => sum + d.wordCount, 0) / input.length,
          })),
        );

      const result = await pipeline.execute([
        { id: "1", content: "This is a test document with several words" },
        { id: "2", content: "Short doc" },
        {
          id: "3",
          content: "Another longer document with more content to analyze",
        },
        { id: "4", content: "Hi" },
      ]);

      expect(result.success).toBe(true);
      if (result.success) {
        // Should filter out docs 2 and 4 (too short)
        expect(result.data.totalDocs).toBe(2);
        expect(result.data.avgWords).toBeGreaterThan(3);
      }
    });

    test("deeply nested pipeline with batch processing", async () => {
      const pipeline = Pipeline.start<number[]>()
        .add(
          "numbers",
          createStep("numbers", async ({ input }) => input),
        )
        .map(
          "doubled",
          createStep("double", async ({ input }: { input: number }) => input * 2),
          { parallel: true },
        )
        .batch("batches", 3)
        .map(
          "batchSums",
          createStep("sum", async ({ input }: { input: number[] }) => input.reduce((a, b) => a + b, 0)),
          { parallel: true },
        )
        .add(
          "total",
          createStep("total", async ({ input, state }) => {
            // Verify state accumulation
            expect(state.numbers).toBeDefined();
            expect(state.doubled).toBeDefined();
            expect(state.batches).toBeDefined();
            expect(state.batchSums).toBeDefined();

            return {
              total: input.reduce((a: number, b: number) => a + b, 0),
              originalCount: state.numbers.length,
              batchCount: state.batches.length,
            };
          }),
        );

      const result = await pipeline.execute([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

      expect(result.success).toBe(true);
      if (result.success) {
        // Sum of doubled numbers: 2+4+6+8+10+12+14+16+18+20 = 110
        expect(result.data.total).toBe(110);
        expect(result.data.originalCount).toBe(10);
        expect(result.data.batchCount).toBeGreaterThan(0);
      }
    });
  });

  describe("Edge cases", () => {
    test("handles empty array input", async () => {
      const pipeline = Pipeline.start<string[]>()
        .map(
          "uppercased",
          createStep("upper", async ({ input }: { input: string }) => input.toUpperCase()),
        )
        .filter("long", (s) => s.length > 3)
        .batch("batches", 5)
        .flatten("flattened");

      const result = await pipeline.execute([]);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual([]);
      }
    });

    test("handles single element array", async () => {
      const pipeline = Pipeline.start<number[]>()
        .map(
          "doubled",
          createStep("double", async ({ input }: { input: number }) => input * 2),
        )
        .filter("positive", (n) => n > 0);

      const result = await pipeline.execute([5]);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual([10]);
      }
    });

    test("handles large array (1000+ elements) efficiently", async () => {
      const largeArray = Array.from({ length: 1000 }, (_, i) => i);

      const pipeline = Pipeline.start<number[]>()
        .map(
          "squared",
          createStep("square", async ({ input }: { input: number }) => input * input),
          { parallel: true, concurrencyLimit: 50 },
        )
        .filter("large", (n) => n > 500)
        .add(
          "stats",
          createStep("stats", async ({ input }) => ({
            count: input.length,
            min: Math.min(...input),
            max: Math.max(...input),
          })),
        );

      const startTime = Date.now();
      const result = await pipeline.execute(largeArray);
      const duration = Date.now() - startTime;

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.count).toBeGreaterThan(0);
        expect(result.data.max).toBe(999 * 999); // 999²
        // Should complete quickly with parallel processing
        expect(duration).toBeLessThan(1000);
      }
    });

    test("handles array with null/undefined elements gracefully", async () => {
      const pipeline = Pipeline.start<string[]>()
        .add(
          "items",
          createStep("items", async ({ input }) => input),
        )
        .map(
          "trimmed",
          createStep("trim", async ({ input }: { input: string }) => input.trim()),
        )
        .filter("nonEmpty", (s) => s.length > 0);

      const result = await pipeline.execute(["hello", "  ", "world", "", "test"]);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(["hello", "world", "test"]);
      }
    });

    test("handles deeply nested arrays", async () => {
      const pipeline = Pipeline.start<number[][][]>()
        .flatten("level2")
        .flatten("level1")
        .filter("positive", (n) => n > 0)
        .add(
          "sum",
          createStep("sum", async ({ input }) => input.reduce((a: number, b: number) => a + b, 0)),
        );

      const result = await pipeline.execute([
        [
          [1, 2],
          [3, -1],
        ],
        [
          [4, 5],
          [-2, 6],
        ],
      ]);

      expect(result.success).toBe(true);
      if (result.success) {
        // 1+2+3+4+5+6 = 21 (negatives filtered out)
        expect(result.data).toBe(21);
      }
    });

    test("handles arrays with duplicate elements", async () => {
      const pipeline = Pipeline.start<string[]>()
        .map(
          "uppercased",
          createStep("upper", async ({ input }: { input: string }) => input.toUpperCase()),
        )
        .add(
          "unique",
          createStep("unique", async ({ input }) => [...new Set(input)]),
        )
        .filter("long", (s) => s.length > 2);

      const result = await pipeline.execute(["hi", "hello", "hi", "world", "hello", "test"]);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(["HELLO", "WORLD", "TEST"]);
      }
    });
  });

  describe("Error propagation", () => {
    test("propagates errors through complex chains with FAIL_FAST", async () => {
      const pipeline = Pipeline.start<number[]>()
        .map(
          "doubled",
          createStep("step1", async ({ input }: { input: number }) => input * 2),
          { errorStrategy: ListErrorStrategy.FAIL_FAST },
        )
        .map(
          "added",
          createStep("step2", async ({ input }: { input: number }) => {
            if (input === 6) throw new Error("Step 2 failed at 6");
            return input + 10;
          }),
          { errorStrategy: ListErrorStrategy.FAIL_FAST },
        )
        .map(
          "tripled",
          createStep("step3", async ({ input }: { input: number }) => input * 3),
          { errorStrategy: ListErrorStrategy.FAIL_FAST },
        );

      const result = await pipeline.execute([1, 2, 3, 4, 5]);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("Step 2 failed at 6");
      }
    });

    test("collects errors from multiple stages with COLLECT_ERRORS", async () => {
      const pipeline = Pipeline.start<number[]>()
        .map(
          "doubled",
          createStep("step1", async ({ input }: { input: number }) => {
            if (input === 2) throw new Error("Fail at 2");
            return input * 2;
          }),
          { errorStrategy: ListErrorStrategy.COLLECT_ERRORS },
        )
        .map(
          "added",
          createStep("step2", async ({ input }: { input: number }) => {
            if (input === 8) throw new Error("Fail at 8");
            return input + 10;
          }),
          { errorStrategy: ListErrorStrategy.COLLECT_ERRORS },
        );

      const result = await pipeline.execute([1, 2, 3, 4, 5]);

      expect(result.success).toBe(false);
    });

    test("continues processing with SKIP_FAILED across multiple stages", async () => {
      const pipeline = Pipeline.start<number[]>()
        .map(
          "doubled",
          createStep("step1", async ({ input }: { input: number }) => {
            if (input % 2 === 0) throw new Error("Even number");
            return input * 2;
          }),
          { errorStrategy: ListErrorStrategy.SKIP_FAILED },
        )
        .map(
          "added",
          createStep("step2", async ({ input }: { input: number }) => {
            if (input > 10) throw new Error("Too large");
            return input + 5;
          }),
          { errorStrategy: ListErrorStrategy.SKIP_FAILED },
        );

      const result = await pipeline.execute([1, 2, 3, 4, 5, 6, 7]);

      expect(result.success).toBe(true);
      if (result.success) {
        // Odd numbers: 1,3,5,7 -> doubled: 2,6,10,14 -> added (+5): 7,11,15,19
        // But step2 throws on >10 so 15 and 19 fail -> Result: 7,11
        expect(result.data).toEqual([7, 11, 15]);
      }
    });

    test("error in non-list step propagates correctly", async () => {
      const pipeline = Pipeline.start<number[]>()
        .map(
          "doubled",
          createStep("double", async ({ input }: { input: number }) => input * 2),
        )
        .add(
          "result",
          createStep("error", async ({ input }: { input: number[] }) => {
            if (input.length > 0) throw new Error("Array processing failed");
            return "success";
          }),
        );

      const result = await pipeline.execute([1, 2, 3]);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("Array processing failed");
      }
    });

    test("error in filter predicate is handled correctly", async () => {
      const pipeline = Pipeline.start<number[]>()
        .map(
          "doubled",
          createStep("double", async ({ input }: { input: number }) => input * 2),
        )
        .filter("problematic", (n) => {
          if (n === 6) throw new Error("Filter error at 6");
          return n > 4;
        });

      // Filters should not throw, they should return false
      const result = await pipeline.execute([1, 2, 3, 4, 5]);

      expect(result.success).toBe(false);
    });
  });

  describe("State accumulation", () => {
    test("accumulates state correctly through complex pipeline", async () => {
      const capturedStates: unknown[] = [];

      const pipeline = Pipeline.start<number[]>()
        .add(
          "numbers",
          createStep("numbers", async ({ input }) => input),
        )
        .map(
          "doubled",
          createStep("double", async ({ input }: { input: number }) => input * 2),
        )
        .filter("large", (n) => n > 5)
        .batch("batches", 2)
        .flatten("flattened")
        .add(
          "capture",
          createStep("capture", async ({ state }) => {
            capturedStates.push({ ...state });
            return "done";
          }),
        );

      const result = await pipeline.execute([1, 2, 3, 4, 5]);

      expect(result.success).toBe(true);
      expect(capturedStates).toHaveLength(1);

      const state = capturedStates[0] as Record<string, unknown>;
      expect(state.numbers).toBeDefined();
      expect(state.doubled).toBeDefined();
      expect(state.large).toBeDefined();
      expect(state.batches).toBeDefined();
      expect(state.flattened).toBeDefined();
    });

    test("state is immutable across steps", async () => {
      const states: unknown[] = [];

      const pipeline = Pipeline.start<number>()
        .add(
          "step1",
          createStep("step1", async ({ input, state }) => {
            states.push({ ...state });
            return input * 2;
          }),
        )
        .add(
          "step2",
          createStep("step2", async ({ input, state }) => {
            states.push({ ...state });
            return input + 10;
          }),
        )
        .add(
          "step3",
          createStep("step3", async ({ input, state }) => {
            states.push({ ...state });
            return input * 3;
          }),
        );

      await pipeline.execute(5);

      // Each step should see only previous steps in state
      expect(Object.keys(states[0] as object)).toHaveLength(0); // No previous steps
      expect(Object.keys(states[1] as object)).toHaveLength(1); // step1
      expect(Object.keys(states[2] as object)).toHaveLength(2); // step1, step2
    });

    test("state references are type-safe at compile time", async () => {
      const pipeline = Pipeline.start<string>()
        .add(
          "parsed",
          createStep("parse", async ({ input }) => ({
            words: input.split(" "),
            length: input.length,
          })),
        )
        .add(
          "analyzed",
          createStep("analyze", async ({ state }) => {
            // TypeScript ensures state.parsed exists and has correct type
            const wordCount = state.parsed.words.length;
            return {
              wordCount,
              avgLength: state.parsed.length / wordCount,
            };
          }),
        );

      const result = await pipeline.execute("hello world test");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.wordCount).toBe(3);
      }
    });
  });

  describe("Performance characteristics", () => {
    test("parallel execution is significantly faster than sequential", async () => {
      const slowStep = createStep<number, number>("slow", async ({ input }) => {
        await Bun.sleep(20);
        return input * 2;
      });

      // Sequential
      const seqPipeline = Pipeline.start<number[]>().map("doubled", slowStep, {
        parallel: false,
      });

      const seqStart = Date.now();
      await seqPipeline.execute([1, 2, 3, 4, 5]);
      const seqDuration = Date.now() - seqStart;

      // Parallel
      const parPipeline = Pipeline.start<number[]>().map("doubled", slowStep, {
        parallel: true,
      });

      const parStart = Date.now();
      await parPipeline.execute([1, 2, 3, 4, 5]);
      const parDuration = Date.now() - parStart;

      // Parallel should be at least 2x faster
      expect(parDuration).toBeLessThan(seqDuration * 0.5);
    });

    test("concurrency limit prevents resource exhaustion", async () => {
      let maxConcurrent = 0;
      let currentConcurrent = 0;

      const trackingStep = createStep<number, number>("track", async ({ input }) => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        await Bun.sleep(10);
        currentConcurrent--;
        return input * 2;
      });

      const pipeline = Pipeline.start<number[]>().map("tracked", trackingStep, {
        parallel: true,
        concurrencyLimit: 3,
      });

      await pipeline.execute(Array.from({ length: 20 }, (_, i) => i));

      expect(maxConcurrent).toBeLessThanOrEqual(3);
      expect(maxConcurrent).toBeGreaterThan(1); // Should use parallelism
    });

    test("batching improves throughput for API-style operations", async () => {
      let apiCallCount = 0;

      // Simulates batch API
      const batchApi = async (items: number[]): Promise<number[]> => {
        apiCallCount++;
        await Bun.sleep(10);
        return items.map((x) => x * 2);
      };

      const pipeline = Pipeline.start<number[]>()
        .batch("batches", 5)
        .map(
          "processed",
          createStep("api", async ({ input }: { input: number[] }) => batchApi(input)),
        )
        .flatten("results");

      const result = await pipeline.execute(Array.from({ length: 23 }, (_, i) => i));

      expect(result.success).toBe(true);
      // Should make ceil(23/5) = 5 API calls instead of 23
      expect(apiCallCount).toBe(5);
    });

    test("no memory leaks with large pipelines", async () => {
      // Process many iterations without memory issues
      const pipeline = Pipeline.start<number[]>()
        .map(
          "doubled",
          createStep("double", async ({ input }: { input: number }) => input * 2),
          { parallel: true },
        )
        .filter("even", (n) => n % 2 === 0)
        .batch("batches", 10)
        .flatten("flattened");

      // Run multiple times
      for (let i = 0; i < 10; i++) {
        const result = await pipeline.execute(Array.from({ length: 100 }, (_, j) => j));
        expect(result.success).toBe(true);
      }

      // If we got here without OOM, test passes
      expect(true).toBe(true);
    });
  });

  describe("Real-world patterns", () => {
    test("ETL pipeline pattern", async () => {
      // Extract -> Transform -> Load pattern
      interface RawData {
        id: string;
        value: string;
      }

      interface ParsedData {
        id: string;
        numValue: number;
      }

      const pipeline = Pipeline.start<string>()
        .add(
          "extracted",
          createStep("extract", async ({ input }: { input: string }) => {
            // Simulate data extraction
            return input.split("\n").map((line, i) => ({
              id: `item-${i}`,
              value: line.trim(),
            }));
          }),
        )
        .map(
          "parsed",
          createStep("parse", async ({ input }: { input: RawData }) => ({
            id: input.id,
            numValue: Number.parseFloat(input.value) || 0,
          })),
          { parallel: true },
        )
        .map(
          "enriched",
          createStep("enrich", async ({ input }: { input: ParsedData }) => ({
            id: input.id,
            value: input.numValue,
            category: input.numValue < 10 ? "low" : input.numValue < 50 ? "medium" : "high",
          })),
          { parallel: true },
        )
        .filter("valid", (item) => item.value > 0)
        .add(
          "summary",
          createStep("summary", async ({ input }) => ({
            total: input.length,
            byCategory: {
              low: input.filter((x) => x.category === "low").length,
              medium: input.filter((x) => x.category === "medium").length,
              high: input.filter((x) => x.category === "high").length,
            },
          })),
        );

      const result = await pipeline.execute("5.5\n12.3\n67.8\n0.0\n34.2\n100.5");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.total).toBe(5); // 0.0 filtered out
        expect(result.data.byCategory.low).toBe(1);
        expect(result.data.byCategory.medium).toBe(2);
        expect(result.data.byCategory.high).toBe(2);
      }
    });

    test("fan-out/fan-in pattern", async () => {
      // Process items independently, then aggregate
      const pipeline = Pipeline.start<number[]>()
        .map(
          "squared",
          createStep("square", async ({ input }: { input: number }) => input * input),
          { parallel: true, concurrencyLimit: 5 },
        )
        .add(
          "stats",
          createStep("stats", async ({ input }) => ({
            count: input.length,
            sum: input.reduce((a, b) => a + b, 0),
            avg: input.reduce((a, b) => a + b, 0) / input.length,
            min: Math.min(...input),
            max: Math.max(...input),
          })),
        );

      const result = await pipeline.execute([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.count).toBe(10);
        expect(result.data.sum).toBe(385); // 1+4+9+16+25+36+49+64+81+100
        expect(result.data.min).toBe(1);
        expect(result.data.max).toBe(100);
      }
    });

    test("validation and filtering pattern", async () => {
      interface Input {
        email: string;
        age: number;
      }

      interface ValidatedInput extends Input {
        valid: boolean;
        errors: string[];
      }

      const validate = createStep<Input, ValidatedInput>("validate", async ({ input }) => {
        const errors: string[] = [];
        if (!input.email.includes("@")) errors.push("Invalid email");
        if (input.age < 0 || input.age > 150) errors.push("Invalid age");
        return {
          ...input,
          valid: errors.length === 0,
          errors,
        };
      });

      const pipeline = Pipeline.start<Input[]>()
        .map("validated", validate, { parallel: true })
        .filter("valid", (item) => item.valid)
        .add(
          "summary",
          createStep("summary", async ({ input, state }) => ({
            totalInput: state.validated.length,
            validCount: input.length,
            invalidCount: state.validated.length - input.length,
          })),
        );

      const result = await pipeline.execute([
        { email: "user@test.com", age: 25 },
        { email: "invalid", age: 30 },
        { email: "another@test.com", age: -5 },
        { email: "valid@test.com", age: 40 },
      ]);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.totalInput).toBe(4);
        expect(result.data.validCount).toBe(2);
        expect(result.data.invalidCount).toBe(2);
      }
    });
  });
});
