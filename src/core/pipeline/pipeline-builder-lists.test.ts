import { describe, expect, test } from "bun:test";
import { Pipeline } from "./builder";
import { ListErrorStrategy } from "./list-adapters";
import { createStep } from "./steps";

/**
 * Tests for Pipeline builder list operations (map, flatMap, batch, flatten, filter).
 */

describe("Pipeline.map()", () => {
	test("maps a step over an array with type safety", async () => {
		const pipeline = Pipeline.start<string[]>()
			.add(
				"input",
				createStep("input", async ({ input }) => input),
			)
			.map(
				"uppercased",
				createStep("uppercase", async ({ input }: { input: string }) =>
					input.toUpperCase(),
				),
			);

		const result = await pipeline.execute(["hello", "world"]);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toEqual(["HELLO", "WORLD"]);
		}
	});

	test("supports parallel execution", async () => {
		let executionCount = 0;

		const pipeline = Pipeline.start<number[]>()
			.add(
				"input",
				createStep("input", async ({ input }) => input),
			)
			.map(
				"doubled",
				createStep("delay", async ({ input }: { input: number }) => {
					executionCount++;
					await new Promise((resolve) => setTimeout(resolve, 10));
					return input * 2;
				}),
				{ parallel: true },
			);

		const startTime = Date.now();
		const result = await pipeline.execute([1, 2, 3, 4, 5]);
		const duration = Date.now() - startTime;

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toEqual([2, 4, 6, 8, 10]);
			expect(executionCount).toBe(5);
			// Parallel execution should complete faster than sequential (5 * 10ms)
			expect(duration).toBeLessThan(40);
		}
	});

	test("supports FAIL_FAST error strategy", async () => {
		const pipeline = Pipeline.start<number[]>()
			.add(
				"input",
				createStep("input", async ({ input }) => input),
			)
			.map(
				"result",
				createStep("divide", async ({ input }: { input: number }) => {
					if (input === 0) {
						throw new Error("Division by zero");
					}
					return 10 / input;
				}),
				{ errorStrategy: ListErrorStrategy.FAIL_FAST },
			);

		const result = await pipeline.execute([2, 5, 0, 10]);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.message).toContain("Division by zero");
		}
	});

	test("supports SKIP_FAILED error strategy", async () => {
		const pipeline = Pipeline.start<number[]>()
			.add(
				"input",
				createStep("input", async ({ input }) => input),
			)
			.map(
				"result",
				createStep("divide", async ({ input }: { input: number }) => {
					if (input === 0) {
						throw new Error("Division by zero");
					}
					return 10 / input;
				}),
				{ errorStrategy: ListErrorStrategy.SKIP_FAILED },
			);

		const result = await pipeline.execute([2, 0, 5, 0, 10]);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toEqual([5, 2, 1]); // 10/2, 10/5, 10/10
		}
	});

	test("accumulates state correctly", async () => {
		const pipeline = Pipeline.start<string[]>()
			.add(
				"words",
				createStep("words", async ({ input }) => input),
			)
			.map(
				"lengths",
				createStep(
					"length",
					async ({ input }: { input: string }) => input.length,
				),
			)
			.add(
				"total",
				createStep("total", async ({ input, state }) => {
					// Validate state is available and correctly typed
					expect(state.words).toBeDefined();
					expect(state.lengths).toBeDefined();
					return input.reduce((sum: number, n: number) => sum + n, 0);
				}),
			);

		const result = await pipeline.execute(["hi", "hello", "world"]);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toBe(12); // 2 + 5 + 5
		}
	});
});

describe("Pipeline.flatMap()", () => {
	test("flatMaps a step that returns arrays", async () => {
		const pipeline = Pipeline.start<string[]>()
			.add(
				"sentences",
				createStep("sentences", async ({ input }) => input),
			)
			.flatMap(
				"words",
				createStep("split", async ({ input }: { input: string }) =>
					input.split(" "),
				),
			);

		const result = await pipeline.execute(["hello world", "foo bar baz"]);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toEqual(["hello", "world", "foo", "bar", "baz"]);
		}
	});

	test("supports parallel execution", async () => {
		const pipeline = Pipeline.start<number[]>()
			.add(
				"nums",
				createStep("nums", async ({ input }) => input),
			)
			.flatMap(
				"exploded",
				createStep("explode", async ({ input }: { input: number }) => {
					await new Promise((resolve) => setTimeout(resolve, 5));
					return Array(input).fill(input);
				}),
				{ parallel: true },
			);

		const startTime = Date.now();
		const result = await pipeline.execute([2, 3, 1]);
		const duration = Date.now() - startTime;

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toEqual([2, 2, 3, 3, 3, 1]);
			// Parallel execution should be faster
			expect(duration).toBeLessThan(20);
		}
	});

	test("handles empty arrays from steps", async () => {
		const pipeline = Pipeline.start<string[]>()
			.add(
				"sentences",
				createStep("sentences", async ({ input }) => input),
			)
			.flatMap(
				"words",
				createStep("filterWords", async ({ input }: { input: string }) => {
					const words = input.split(" ");
					return words.filter((w) => w.length > 3);
				}),
			);

		const result = await pipeline.execute(["hi", "hello world", "a b c"]);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toEqual(["hello", "world"]);
		}
	});

	test("accumulates state correctly", async () => {
		const pipeline = Pipeline.start<string[]>()
			.add(
				"words",
				createStep("words", async ({ input }) => input),
			)
			.flatMap(
				"chars",
				createStep("chars", async ({ input }: { input: string }) =>
					input.split(""),
				),
			)
			.add(
				"count",
				createStep("count", async ({ input, state }) => {
					expect(state.words).toBeDefined();
					expect(state.chars).toBeDefined();
					return input.length;
				}),
			);

		const result = await pipeline.execute(["hi", "bye"]);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toBe(5); // h, i, b, y, e
		}
	});
});

describe("Pipeline.batch()", () => {
	test("batches array into chunks", async () => {
		const pipeline = Pipeline.start<number[]>()
			.add(
				"nums",
				createStep("nums", async ({ input }) => input),
			)
			.batch("batches", 3);

		const result = await pipeline.execute([1, 2, 3, 4, 5, 6, 7, 8]);

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
		const pipeline = Pipeline.start<string[]>()
			.add(
				"items",
				createStep("items", async ({ input }) => input),
			)
			.batch("batches", 10);

		const result = await pipeline.execute(["a", "b", "c"]);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toEqual([["a", "b", "c"]]);
		}
	});

	test("handles empty arrays", async () => {
		const pipeline = Pipeline.start<number[]>()
			.add(
				"nums",
				createStep("nums", async ({ input }) => input),
			)
			.batch("batches", 5);

		const result = await pipeline.execute([]);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toEqual([]);
		}
	});

	test("accumulates state with correct nested array type", async () => {
		const pipeline = Pipeline.start<string[]>()
			.add(
				"items",
				createStep("items", async ({ input }) => input),
			)
			.batch("batches", 2)
			.add(
				"batchCount",
				createStep("batchCount", async ({ input, state }) => {
					expect(state.items).toBeDefined();
					expect(state.batches).toBeDefined();
					return input.length;
				}),
			);

		const result = await pipeline.execute(["a", "b", "c", "d", "e"]);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toBe(3); // 3 batches
		}
	});
});

describe("Pipeline.flatten()", () => {
	test("flattens nested arrays", async () => {
		const pipeline = Pipeline.start<string[][]>()
			.add(
				"batches",
				createStep("batches", async ({ input }) => input),
			)
			.flatten("items");

		const result = await pipeline.execute([["a", "b"], ["c", "d"], ["e"]]);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toEqual(["a", "b", "c", "d", "e"]);
		}
	});

	test("handles empty nested arrays", async () => {
		const pipeline = Pipeline.start<number[][]>()
			.add(
				"batches",
				createStep("batches", async ({ input }) => input),
			)
			.flatten("items");

		const result = await pipeline.execute([[], [1, 2], [], [3], []]);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toEqual([1, 2, 3]);
		}
	});

	test("handles completely empty input", async () => {
		const pipeline = Pipeline.start<string[][]>()
			.add(
				"batches",
				createStep("batches", async ({ input }) => input),
			)
			.flatten("items");

		const result = await pipeline.execute([]);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toEqual([]);
		}
	});

	test("accumulates state correctly", async () => {
		const pipeline = Pipeline.start<number[][]>()
			.add(
				"batches",
				createStep("batches", async ({ input }) => input),
			)
			.flatten("items")
			.add(
				"sum",
				createStep("sum", async ({ input, state }) => {
					expect(state.batches).toBeDefined();
					expect(state.items).toBeDefined();
					return input.reduce((sum: number, n: number) => sum + n, 0);
				}),
			);

		const result = await pipeline.execute([[1, 2], [3, 4], [5]]);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toBe(15);
		}
	});
});

describe("Pipeline.filter()", () => {
	test("filters array based on predicate", async () => {
		const pipeline = Pipeline.start<number[]>()
			.add(
				"nums",
				createStep("nums", async ({ input }) => input),
			)
			.filter("evens", (n) => n % 2 === 0);

		const result = await pipeline.execute([1, 2, 3, 4, 5, 6]);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toEqual([2, 4, 6]);
		}
	});

	test("supports async predicates", async () => {
		const pipeline = Pipeline.start<string[]>()
			.add(
				"words",
				createStep("words", async ({ input }) => input),
			)
			.filter("long", async (word) => {
				await new Promise((resolve) => setTimeout(resolve, 1));
				return word.length > 3;
			});

		const result = await pipeline.execute(["hi", "hello", "world", "a"]);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toEqual(["hello", "world"]);
		}
	});

	test("provides index to predicate", async () => {
		const pipeline = Pipeline.start<string[]>()
			.add(
				"items",
				createStep("items", async ({ input }) => input),
			)
			.filter("oddIndexes", (_, index) => index % 2 === 1);

		const result = await pipeline.execute(["a", "b", "c", "d", "e"]);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toEqual(["b", "d"]);
		}
	});

	test("handles empty arrays", async () => {
		const pipeline = Pipeline.start<number[]>()
			.add(
				"nums",
				createStep("nums", async ({ input }) => input),
			)
			.filter("positive", (n) => n > 0);

		const result = await pipeline.execute([]);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toEqual([]);
		}
	});

	test("returns empty array when nothing matches", async () => {
		const pipeline = Pipeline.start<number[]>()
			.add(
				"nums",
				createStep("nums", async ({ input }) => input),
			)
			.filter("large", (n) => n > 100);

		const result = await pipeline.execute([1, 2, 3, 4, 5]);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toEqual([]);
		}
	});

	test("accumulates state correctly", async () => {
		const pipeline = Pipeline.start<number[]>()
			.add(
				"nums",
				createStep("nums", async ({ input }) => input),
			)
			.filter("evens", (n) => n % 2 === 0)
			.add(
				"count",
				createStep("count", async ({ input, state }) => {
					expect(state.nums).toBeDefined();
					expect(state.evens).toBeDefined();
					return input.length;
				}),
			);

		const result = await pipeline.execute([1, 2, 3, 4, 5, 6]);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toBe(3); // 3 even numbers
		}
	});
});

describe("Complex pipeline chains", () => {
	test("chains multiple list operations together", async () => {
		const pipeline = Pipeline.start<string[]>()
			.add(
				"words",
				createStep("words", async ({ input }) => input),
			)
			.map(
				"uppercased",
				createStep("uppercase", async ({ input }: { input: string }) =>
					input.toUpperCase(),
				),
			)
			.filter("long", (s) => s.length > 3)
			.batch("batches", 2)
			.flatten("flattened");

		const result = await pipeline.execute([
			"hi",
			"hello",
			"world",
			"a",
			"test",
		]);

		expect(result.success).toBe(true);
		if (result.success) {
			// Uppercased: ["HI", "HELLO", "WORLD", "A", "TEST"]
			// Filtered (length > 3): ["HELLO", "WORLD", "TEST"]
			// Batched (size 2): [["HELLO", "WORLD"], ["TEST"]]
			// Flattened: ["HELLO", "WORLD", "TEST"]
			expect(result.data).toEqual(["HELLO", "WORLD", "TEST"]);
		}
	});

	test("combines map and flatMap", async () => {
		const pipeline = Pipeline.start<string[]>()
			.add(
				"words",
				createStep("words", async ({ input }) => input),
			)
			.flatMap(
				"duplicated",
				createStep("duplicate", async ({ input }: { input: string }) => [
					input,
					input,
				]),
			)
			.map(
				"uppercased",
				createStep("uppercase", async ({ input }: { input: string }) =>
					input.toUpperCase(),
				),
			);

		const result = await pipeline.execute(["hi", "bye"]);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toEqual(["HI", "HI", "BYE", "BYE"]);
		}
	});

	test("uses accumulated state across multiple list operations", async () => {
		const pipeline = Pipeline.start<number[]>()
			.add(
				"original",
				createStep("original", async ({ input }) => input),
			)
			.map(
				"doubled",
				createStep("double", async ({ input }: { input: number }) => input * 2),
			)
			.filter("large", (n) => n > 5)
			.add(
				"summary",
				createStep("summary", async ({ state }) => ({
					original: state.original,
					doubled: state.doubled,
					large: state.large,
				})),
			);

		const result = await pipeline.execute([1, 2, 3, 4, 5]);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toEqual({
				original: [1, 2, 3, 4, 5],
				doubled: [2, 4, 6, 8, 10],
				large: [6, 8, 10],
			});
		}
	});

	test("batch -> map -> flatten pattern", async () => {
		const pipeline = Pipeline.start<number[]>()
			.add(
				"nums",
				createStep("nums", async ({ input }) => input),
			)
			.batch("batches", 3)
			.map(
				"sums",
				createStep("sum", async ({ input }: { input: number[] }) =>
					input.reduce((a, b) => a + b, 0),
				),
			);

		const result = await pipeline.execute([1, 2, 3, 4, 5, 6, 7]);

		expect(result.success).toBe(true);
		if (result.success) {
			// Batches: [[1,2,3], [4,5,6], [7]]
			// Sums: [6, 15, 7]
			expect(result.data).toEqual([6, 15, 7]);
		}
	});
});

describe("Type safety validation", () => {
	test("maintains type safety through method chaining", async () => {
		const pipeline = Pipeline.start<string[]>()
			.add(
				"words",
				createStep("words", async ({ input }) => input),
			)
			.map(
				"lengths",
				createStep(
					"length",
					async ({ input }: { input: string }) => input.length,
				),
			)
			.filter("positive", (n) => n > 0)
			.batch("batches", 2)
			.flatten("flattened");

		const result = await pipeline.execute(["hi", "hello", "a"]);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toEqual([2, 5, 1]);
		}
	});
});
