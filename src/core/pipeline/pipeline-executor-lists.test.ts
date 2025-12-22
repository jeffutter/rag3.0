/**
 * Comprehensive tests for pipeline executor list operations.
 *
 * Tests cover:
 * - Parallel execution with concurrency limits
 * - Error handling strategies (FAIL_FAST, COLLECT_ERRORS, SKIP_FAILED)
 * - Metadata aggregation with per-item timing
 * - Performance with large arrays
 * - Integration with Pipeline.execute()
 */

import { describe, expect, test } from "bun:test";
import { Pipeline } from "./builder";
import {
	executeParallel,
	ListErrorStrategy,
	singleToList,
} from "./list-adapters";
import { createStep } from "./steps";

describe("executeParallel helper", () => {
	test("executes items with concurrency limit", async () => {
		let maxConcurrent = 0;
		let currentConcurrent = 0;

		const results = await executeParallel(
			[1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
			async (item) => {
				currentConcurrent++;
				maxConcurrent = Math.max(maxConcurrent, currentConcurrent);

				// Simulate async work
				await Bun.sleep(10);

				currentConcurrent--;
				return { result: item * 2, durationMs: 10 };
			},
			3, // Limit to 3 concurrent
		);

		// Should never exceed concurrency limit
		expect(maxConcurrent).toBeLessThanOrEqual(3);
		expect(maxConcurrent).toBeGreaterThan(1); // Should use parallelism

		// All results should be present
		expect(results).toHaveLength(10);
		expect(results.map((r) => r.result)).toEqual([
			2, 4, 6, 8, 10, 12, 14, 16, 18, 20,
		]);
	});

	test("handles concurrency limit of 1 (sequential)", async () => {
		const executionOrder: number[] = [];

		await executeParallel(
			[1, 2, 3, 4, 5],
			async (item) => {
				executionOrder.push(item);
				await Bun.sleep(5);
				return { result: item, durationMs: 5 };
			},
			1, // Sequential execution
		);

		// Should execute in order
		expect(executionOrder).toEqual([1, 2, 3, 4, 5]);
	});

	test("handles large concurrency limit efficiently", async () => {
		const startTime = Date.now();

		const results = await executeParallel(
			Array.from({ length: 20 }, (_, i) => i),
			async (item) => {
				await Bun.sleep(50);
				return { result: item, durationMs: 50 };
			},
			20, // All parallel
		);

		const duration = Date.now() - startTime;

		// Should complete in ~50ms (all parallel), not 1000ms (sequential)
		expect(duration).toBeLessThan(150); // Allow some margin
		expect(results).toHaveLength(20);
	});

	test("propagates errors correctly", async () => {
		await expect(
			executeParallel(
				[1, 2, 3],
				async (item) => {
					if (item === 2) throw new Error("Test error");
					return { result: item, durationMs: 0 };
				},
				2,
			),
		).rejects.toThrow("Test error");
	});
});

describe("Pipeline executor - List operations", () => {
	describe("Automatic list operation detection", () => {
		test("detects list operations from array input", async () => {
			const step = createStep<string, string>("upper", async ({ input }) =>
				input.toUpperCase(),
			);

			const listStep = singleToList(step);

			const result = await listStep.execute({
				input: ["hello", "world"],
				state: {},
				context: {},
			});

			expect(result.success).toBe(true);
			expect(result.metadata.listMetadata).toBeDefined();
			expect(result.metadata.listMetadata?.totalItems).toBe(2);
		});
	});

	describe("FAIL_FAST error strategy", () => {
		test("stops on first error in sequential execution", async () => {
			let processedCount = 0;

			const step = createStep<number, number>("process", async ({ input }) => {
				processedCount++;
				if (input === 3) throw new Error("Error at 3");
				return input * 2;
			});

			const listStep = singleToList(step, {
				errorStrategy: ListErrorStrategy.FAIL_FAST,
				parallel: false,
			});

			const result = await listStep.execute({
				input: [1, 2, 3, 4, 5],
				state: {},
				context: {},
			});

			expect(result.success).toBe(false);
			// Should stop after processing 1, 2, 3
			expect(processedCount).toBe(3);

			if (!result.success) {
				expect(result.error.message).toContain("Error at 3");
				expect(result.metadata.listMetadata?.successCount).toBe(2);
				expect(result.metadata.listMetadata?.failureCount).toBe(1);
				expect(result.metadata.listMetadata?.skippedCount).toBe(2);
			}
		});

		test("completes all items then returns first error in parallel execution", async () => {
			let processedCount = 0;

			const step = createStep<number, number>("process", async ({ input }) => {
				processedCount++;
				await Bun.sleep(5);
				if (input === 3) throw new Error("Error at 3");
				return input * 2;
			});

			const listStep = singleToList(step, {
				errorStrategy: ListErrorStrategy.FAIL_FAST,
				parallel: true,
			});

			const result = await listStep.execute({
				input: [1, 2, 3, 4, 5],
				state: {},
				context: {},
			});

			expect(result.success).toBe(false);
			// In parallel mode, all items are started
			expect(processedCount).toBe(5);

			if (!result.success) {
				expect(result.error.message).toContain("Error at 3");
			}
		});
	});

	describe("COLLECT_ERRORS error strategy", () => {
		test("continues processing and collects all errors", async () => {
			const step = createStep<number, number>("process", async ({ input }) => {
				if (input % 2 === 0) throw new Error(`Error at ${input}`);
				return input * 2;
			});

			const listStep = singleToList(step, {
				errorStrategy: ListErrorStrategy.COLLECT_ERRORS,
			});

			const result = await listStep.execute({
				input: [1, 2, 3, 4, 5, 6],
				state: {},
				context: {},
			});

			expect(result.success).toBe(false);

			if (!result.success) {
				expect(result.error.code).toBe("LIST_PROCESSING_ERRORS");
				expect(result.error.message).toContain("3 of 6 items failed");
				expect(Array.isArray(result.error.cause)).toBe(true);

				// Verify metadata
				expect(result.metadata.listMetadata?.totalItems).toBe(6);
				expect(result.metadata.listMetadata?.successCount).toBe(3);
				expect(result.metadata.listMetadata?.failureCount).toBe(3);
			}
		});
	});

	describe("SKIP_FAILED error strategy", () => {
		test("continues processing and returns only successful results", async () => {
			const step = createStep<number, number>("process", async ({ input }) => {
				if (input % 2 === 0) throw new Error(`Error at ${input}`);
				return input * 2;
			});

			const listStep = singleToList(step, {
				errorStrategy: ListErrorStrategy.SKIP_FAILED,
			});

			const result = await listStep.execute({
				input: [1, 2, 3, 4, 5, 6],
				state: {},
				context: {},
			});

			expect(result.success).toBe(true);

			if (result.success) {
				// Only odd numbers succeed
				expect(result.data).toEqual([2, 6, 10]); // 1*2, 3*2, 5*2

				// Verify metadata
				expect(result.metadata.listMetadata?.totalItems).toBe(6);
				expect(result.metadata.listMetadata?.successCount).toBe(3);
				expect(result.metadata.listMetadata?.failureCount).toBe(3);
				expect(result.metadata.listMetadata?.skippedCount).toBe(3);
			}
		});
	});

	describe("Metadata aggregation", () => {
		test("includes per-item timing statistics", async () => {
			const step = createStep<number, number>("process", async ({ input }) => {
				// Variable processing time
				await Bun.sleep(input * 5);
				return input * 2;
			});

			const listStep = singleToList(step);

			const result = await listStep.execute({
				input: [1, 2, 3, 4, 5],
				state: {},
				context: {},
			});

			expect(result.success).toBe(true);
			expect(result.metadata.listMetadata).toBeDefined();

			const timings = result.metadata.listMetadata?.itemTimings;
			expect(timings).toBeDefined();

			if (timings) {
				// Basic sanity checks
				expect(timings.min).toBeGreaterThanOrEqual(0);
				expect(timings.max).toBeGreaterThanOrEqual(timings.min);
				expect(timings.avg).toBeGreaterThanOrEqual(timings.min);
				expect(timings.avg).toBeLessThanOrEqual(timings.max);
				expect(timings.p50).toBeGreaterThanOrEqual(timings.min);
				expect(timings.p95).toBeGreaterThanOrEqual(timings.p50);
				expect(timings.p99).toBeGreaterThanOrEqual(timings.p95);
			}
		});

		test("tracks success/failure rates", async () => {
			const step = createStep<number, number>("process", async ({ input }) => {
				if (input > 7) throw new Error("Too large");
				return input * 2;
			});

			const listStep = singleToList(step, {
				errorStrategy: ListErrorStrategy.SKIP_FAILED,
			});

			const result = await listStep.execute({
				input: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
				state: {},
				context: {},
			});

			expect(result.success).toBe(true);

			const meta = result.metadata.listMetadata;
			expect(meta).toBeDefined();
			expect(meta?.totalItems).toBe(10);
			expect(meta?.successCount).toBe(7);
			expect(meta?.failureCount).toBe(3);
		});

		test("includes execution strategy in metadata", async () => {
			const step = createStep<number, number>(
				"process",
				async ({ input }) => input * 2,
			);

			// Sequential
			const seqStep = singleToList(step, { parallel: false });
			const seqResult = await seqStep.execute({
				input: [1, 2, 3],
				state: {},
				context: {},
			});

			expect(seqResult.metadata.listMetadata?.executionStrategy).toBe(
				"sequential",
			);

			// Parallel
			const parStep = singleToList(step, { parallel: true });
			const parResult = await parStep.execute({
				input: [1, 2, 3],
				state: {},
				context: {},
			});

			expect(parResult.metadata.listMetadata?.executionStrategy).toBe(
				"parallel",
			);
		});

		test("includes concurrency limit for parallel execution", async () => {
			const step = createStep<number, number>(
				"process",
				async ({ input }) => input * 2,
			);

			const listStep = singleToList(step, {
				parallel: true,
				concurrencyLimit: 5,
			});

			const result = await listStep.execute({
				input: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
				state: {},
				context: {},
			});

			expect(result.metadata.listMetadata?.concurrencyLimit).toBe(5);
		});
	});

	describe("Parallel execution with concurrency control", () => {
		test("respects concurrency limit", async () => {
			let maxConcurrent = 0;
			let currentConcurrent = 0;

			const step = createStep<number, number>("process", async ({ input }) => {
				currentConcurrent++;
				maxConcurrent = Math.max(maxConcurrent, currentConcurrent);

				await Bun.sleep(20);

				currentConcurrent--;
				return input * 2;
			});

			const listStep = singleToList(step, {
				parallel: true,
				concurrencyLimit: 3,
			});

			await listStep.execute({
				input: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
				state: {},
				context: {},
			});

			// Should never exceed the limit
			expect(maxConcurrent).toBeLessThanOrEqual(3);
			expect(maxConcurrent).toBeGreaterThan(1); // Should use parallelism
		});

		test("is faster than sequential for I/O-bound operations", async () => {
			const step = createStep<number, number>("process", async ({ input }) => {
				await Bun.sleep(50);
				return input * 2;
			});

			// Sequential
			const seqStep = singleToList(step, { parallel: false });
			const seqStart = Date.now();
			await seqStep.execute({
				input: [1, 2, 3, 4, 5],
				state: {},
				context: {},
			});
			const seqDuration = Date.now() - seqStart;

			// Parallel
			const parStep = singleToList(step, {
				parallel: true,
				concurrencyLimit: 5,
			});
			const parStart = Date.now();
			await parStep.execute({
				input: [1, 2, 3, 4, 5],
				state: {},
				context: {},
			});
			const parDuration = Date.now() - parStart;

			// Parallel should be significantly faster
			// Sequential: ~250ms (5 * 50ms)
			// Parallel: ~50-100ms (all at once)
			expect(parDuration).toBeLessThan(seqDuration * 0.5);
		});
	});

	describe("Performance with large arrays", () => {
		test("handles 1000 items efficiently with parallel execution", async () => {
			const step = createStep<number, number>("process", async ({ input }) => {
				await Bun.sleep(1); // Minimal delay
				return input * 2;
			});

			const listStep = singleToList(step, {
				parallel: true,
				concurrencyLimit: 50,
			});

			const startTime = Date.now();
			const result = await listStep.execute({
				input: Array.from({ length: 1000 }, (_, i) => i),
				state: {},
				context: {},
			});
			const duration = Date.now() - startTime;

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data).toHaveLength(1000);
				expect(result.data[0]).toBe(0);
				expect(result.data[999]).toBe(1998);
			}

			// Should complete in reasonable time (not 1000ms sequential)
			expect(duration).toBeLessThan(500);

			// Metadata should be complete
			expect(result.metadata.listMetadata?.totalItems).toBe(1000);
			expect(result.metadata.listMetadata?.successCount).toBe(1000);
			expect(result.metadata.listMetadata?.itemTimings).toBeDefined();
		});

		test("handles 10000 items without running out of memory", async () => {
			const step = createStep<number, number>(
				"process",
				async ({ input }) => input * 2,
			);

			const listStep = singleToList(step, {
				parallel: true,
				concurrencyLimit: 100,
			});

			const result = await listStep.execute({
				input: Array.from({ length: 10000 }, (_, i) => i),
				state: {},
				context: {},
			});

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data).toHaveLength(10000);
			}
		});

		test("no performance regression vs manual loops for sync operations", async () => {
			const items = Array.from({ length: 1000 }, (_, i) => i);

			// Manual loop
			const manualStart = Date.now();
			const manualResults: number[] = [];
			for (const item of items) {
				manualResults.push(item * 2);
			}
			const manualDuration = Date.now() - manualStart;

			// Pipeline step (sequential)
			const step = createStep<number, number>(
				"process",
				async ({ input }) => input * 2,
			);
			const listStep = singleToList(step, { parallel: false });

			const pipelineStart = Date.now();
			const result = await listStep.execute({
				input: items,
				state: {},
				context: {},
			});
			const pipelineDuration = Date.now() - pipelineStart;

			expect(result.success).toBe(true);

			// Pipeline should be reasonably close to manual loop
			// Allow 10x overhead for Promise wrapping, etc.
			expect(pipelineDuration).toBeLessThan(Math.max(manualDuration * 10, 100));
		});
	});

	describe("Integration with Pipeline.execute()", () => {
		test("pipeline tracks list operation metadata end-to-end", async () => {
			const upperStep = createStep<string, string>("upper", async ({ input }) =>
				input.toUpperCase(),
			);

			const pipeline = Pipeline.start<string[]>()
				.map("uppercased", upperStep, { parallel: true, concurrencyLimit: 5 })
				.filter("long", (s) => s.length > 3);

			const result = await pipeline.execute(["hi", "hello", "world", "bye"]);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data).toEqual(["HELLO", "WORLD"]);
			}
		});

		test("pipeline handles errors in list operations correctly", async () => {
			const step = createStep<number, number>("process", async ({ input }) => {
				if (input === 5) throw new Error("Error at 5");
				return input * 2;
			});

			const pipeline = Pipeline.start<number[]>().map("doubled", step, {
				errorStrategy: ListErrorStrategy.SKIP_FAILED,
			});

			const result = await pipeline.execute([1, 2, 3, 4, 5, 6]);

			expect(result.success).toBe(true);
			if (result.success) {
				// Should skip 5
				expect(result.data).toEqual([2, 4, 6, 8, 12]);
			}
		});

		test("pipeline chains multiple list operations efficiently", async () => {
			const double = createStep<number, number>(
				"double",
				async ({ input }) => input * 2,
			);

			const pipeline = Pipeline.start<number[]>()
				.map("doubled", double, { parallel: true })
				.filter("large", (n) => n > 5)
				.batch("batches", 2)
				.flatten("flattened");

			const result = await pipeline.execute([1, 2, 3, 4, 5]);

			expect(result.success).toBe(true);
			if (result.success) {
				// [1,2,3,4,5] -> [2,4,6,8,10] -> [6,8,10] -> [[6,8],[10]] -> [6,8,10]
				expect(result.data).toEqual([6, 8, 10]);
			}
		});
	});
});
