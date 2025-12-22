/**
 * Performance benchmarks for pipeline system.
 *
 * Validates:
 * - No performance regression vs manual code
 * - Parallel execution speedup
 * - Memory efficiency
 * - Scalability with large datasets
 */

import { describe, expect, test } from "bun:test";
import { Pipeline } from "./builder";
import { createStep } from "./steps";

describe("Pipeline Performance Benchmarks", () => {
	describe("Sequential vs Parallel Performance", () => {
		test("parallel execution provides significant speedup for I/O operations", async () => {
			const ioDelay = 20; // Simulate I/O delay
			const itemCount = 10;

			const ioStep = createStep<number, number>("io", async ({ input }) => {
				await Bun.sleep(ioDelay);
				return input * 2;
			});

			// Sequential baseline
			const seqPipeline = Pipeline.start<number[]>().map("result", ioStep, {
				parallel: false,
			});

			const seqStart = Date.now();
			await seqPipeline.execute(Array.from({ length: itemCount }, (_, i) => i));
			const seqDuration = Date.now() - seqStart;

			// Parallel version
			const parPipeline = Pipeline.start<number[]>().map("result", ioStep, {
				parallel: true,
			});

			const parStart = Date.now();
			await parPipeline.execute(Array.from({ length: itemCount }, (_, i) => i));
			const parDuration = Date.now() - parStart;

			// Sequential should take ~ioDelay * itemCount
			// Parallel should take ~ioDelay
			const expectedSeqDuration = ioDelay * itemCount;
			const speedup = seqDuration / parDuration;

			console.log({
				sequential: `${seqDuration}ms`,
				parallel: `${parDuration}ms`,
				speedup: `${speedup.toFixed(2)}x`,
				expectedSeq: `${expectedSeqDuration}ms`,
			});

			// Parallel should be at least 3x faster
			expect(speedup).toBeGreaterThan(3);
			// Sequential should be close to expected
			expect(seqDuration).toBeGreaterThan(expectedSeqDuration * 0.8);
			expect(seqDuration).toBeLessThan(expectedSeqDuration * 1.5);
		});

		test("concurrency limiting prevents resource exhaustion", async () => {
			let maxConcurrent = 0;
			let currentConcurrent = 0;
			const concurrencyLimit = 5;

			const trackingStep = createStep<number, number>(
				"track",
				async ({ input }) => {
					currentConcurrent++;
					maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
					await Bun.sleep(10);
					currentConcurrent--;
					return input * 2;
				},
			);

			const pipeline = Pipeline.start<number[]>().map("result", trackingStep, {
				parallel: true,
				concurrencyLimit,
			});

			await pipeline.execute(Array.from({ length: 50 }, (_, i) => i));

			console.log({
				maxConcurrent,
				concurrencyLimit,
				withinLimit: maxConcurrent <= concurrencyLimit,
			});

			expect(maxConcurrent).toBeLessThanOrEqual(concurrencyLimit);
			expect(maxConcurrent).toBeGreaterThan(1); // Should use parallelism
		});
	});

	describe("Scalability", () => {
		test("handles 1000 items efficiently", async () => {
			const itemCount = 1000;

			const pipeline = Pipeline.start<number[]>()
				.map(
					"squared",
					createStep(
						"square",
						async ({ input }: { input: number }) => input * input,
					),
					{ parallel: true, concurrencyLimit: 50 },
				)
				.filter("large", (n) => n > 100)
				.add(
					"sum",
					createStep("sum", async ({ input }: { input: number[] }) =>
						input.reduce((a, b) => a + b, 0),
					),
				);

			const start = Date.now();
			const result = await pipeline.execute(
				Array.from({ length: itemCount }, (_, i) => i),
			);
			const duration = Date.now() - start;

			expect(result.success).toBe(true);
			console.log({
				itemCount,
				duration: `${duration}ms`,
				itemsPerMs: (itemCount / duration).toFixed(2),
			});

			// Should complete within reasonable time
			expect(duration).toBeLessThan(500);
		});

		test("handles 10000 items without memory issues", async () => {
			const itemCount = 10000;

			const pipeline = Pipeline.start<number[]>()
				.map(
					"doubled",
					createStep(
						"double",
						async ({ input }: { input: number }) => input * 2,
					),
					{ parallel: true, concurrencyLimit: 100 },
				)
				.filter("even", (n) => n % 4 === 0)
				.batch("batches", 100)
				.flatten("flattened");

			const memBefore = process.memoryUsage();
			const start = Date.now();

			const result = await pipeline.execute(
				Array.from({ length: itemCount }, (_, i) => i),
			);

			const duration = Date.now() - start;
			const memAfter = process.memoryUsage();
			const memIncrease =
				(memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024;

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.length).toBeGreaterThan(0);
			}

			console.log({
				itemCount,
				duration: `${duration}ms`,
				memIncrease: `${memIncrease.toFixed(2)} MB`,
			});

			// Memory increase should be reasonable (< 50MB for 10k items)
			expect(memIncrease).toBeLessThan(50);
			// Should complete in reasonable time
			expect(duration).toBeLessThan(2000);
		});

		test("repeated execution doesn't leak memory", async () => {
			const pipeline = Pipeline.start<number[]>()
				.map(
					"processed",
					createStep(
						"process",
						async ({ input }: { input: number }) => input * 2,
					),
					{ parallel: true },
				)
				.filter("large", (n) => n > 50);

			const memBefore = process.memoryUsage();

			// Run 100 iterations
			for (let i = 0; i < 100; i++) {
				const result = await pipeline.execute(
					Array.from({ length: 100 }, (_, j) => j),
				);
				expect(result.success).toBe(true);
			}

			const memAfter = process.memoryUsage();
			const memIncrease =
				(memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024;

			console.log({
				iterations: 100,
				itemsPerIteration: 100,
				totalItems: 10000,
				memIncrease: `${memIncrease.toFixed(2)} MB`,
			});

			// Should not leak significant memory (< 10MB for 100 iterations)
			expect(memIncrease).toBeLessThan(10);
		});
	});

	describe("Overhead vs Manual Code", () => {
		test("minimal overhead for sync operations", async () => {
			const itemCount = 1000;
			const items = Array.from({ length: itemCount }, (_, i) => i);

			// Manual version
			const manualStart = Date.now();
			const manualResult = items.map((x) => x * 2).filter((x) => x > 500);
			const manualDuration = Date.now() - manualStart;

			// Pipeline version
			const pipeline = Pipeline.start<number[]>()
				.map(
					"doubled",
					createStep(
						"double",
						async ({ input }: { input: number }) => input * 2,
					),
					{ parallel: false }, // Sequential for fair comparison
				)
				.filter("large", (n) => n > 500);

			const pipelineStart = Date.now();
			const pipelineResult = await pipeline.execute(items);
			const pipelineDuration = Date.now() - pipelineStart;

			expect(pipelineResult.success).toBe(true);
			if (pipelineResult.success) {
				expect(pipelineResult.data).toEqual(manualResult);
			}

			const overhead = pipelineDuration - manualDuration;
			const overheadPct = (overhead / manualDuration) * 100;

			console.log({
				manual: `${manualDuration}ms`,
				pipeline: `${pipelineDuration}ms`,
				overhead: `${overhead}ms (${overheadPct.toFixed(1)}%)`,
			});

			// Overhead should be reasonable (< 20x or < 100ms, whichever is larger)
			expect(pipelineDuration).toBeLessThan(Math.max(manualDuration * 20, 100));
		});

		test("batching improves API-style operations", async () => {
			let apiCallCount = 0;
			const itemsPerBatch = 10;
			const totalItems = 100;

			// Simulated batch API
			const batchApi = async (items: number[]): Promise<number[]> => {
				apiCallCount++;
				await Bun.sleep(10); // Simulate network latency
				return items.map((x) => x * 2);
			};

			// Without batching (one call per item)
			apiCallCount = 0;
			const noBatchStart = Date.now();
			const noBatchResults: number[] = [];
			for (const item of Array.from({ length: totalItems }, (_, i) => i)) {
				const results = await batchApi([item]);
				if (results[0] !== undefined) {
					noBatchResults.push(results[0]);
				}
			}
			const noBatchDuration = Date.now() - noBatchStart;
			const noBatchCalls = apiCallCount;

			// With batching
			apiCallCount = 0;
			const pipeline = Pipeline.start<number[]>()
				.batch("batches", itemsPerBatch)
				.map(
					"processed",
					createStep("api", async ({ input }: { input: number[] }) =>
						batchApi(input),
					),
					{ parallel: true },
				)
				.flatten("results");

			const batchStart = Date.now();
			const batchResult = await pipeline.execute(
				Array.from({ length: totalItems }, (_, i) => i),
			);
			const batchDuration = Date.now() - batchStart;
			const batchCalls = apiCallCount;

			expect(batchResult.success).toBe(true);
			if (batchResult.success) {
				expect(batchResult.data).toEqual(noBatchResults);
			}

			console.log({
				noBatch: {
					duration: `${noBatchDuration}ms`,
					calls: noBatchCalls,
				},
				withBatch: {
					duration: `${batchDuration}ms`,
					calls: batchCalls,
					speedup: `${(noBatchDuration / batchDuration).toFixed(2)}x`,
				},
			});

			// Should make significantly fewer API calls
			expect(batchCalls).toBe(Math.ceil(totalItems / itemsPerBatch));
			expect(batchCalls).toBeLessThan(noBatchCalls / 5);

			// Should be significantly faster
			expect(batchDuration).toBeLessThan(noBatchDuration / 3);
		});
	});

	describe("Performance Characteristics", () => {
		test("documents execution time scaling", async () => {
			const sizes = [10, 50, 100, 500, 1000];
			const results: Array<{ size: number; duration: number }> = [];

			for (const size of sizes) {
				const pipeline = Pipeline.start<number[]>().map(
					"processed",
					createStep("process", async ({ input }: { input: number }) => {
						await Bun.sleep(1);
						return input * 2;
					}),
					{ parallel: true, concurrencyLimit: 50 },
				);

				const start = Date.now();
				await pipeline.execute(Array.from({ length: size }, (_, i) => i));
				const duration = Date.now() - start;

				results.push({ size, duration });
			}

			console.log("Scaling characteristics:");
			console.table(results);

			// Verify sub-linear scaling with parallel execution
			// With concurrency=50 and 1ms per item:
			// - 10 items: ~1-10ms
			// - 1000 items: ~20-50ms (not 1000ms)
			const size10 = results.find((r) => r.size === 10);
			const size1000 = results.find((r) => r.size === 1000);

			if (size10 && size1000) {
				const scalingRatio = size1000.duration / size10.duration;
				console.log(`Scaling ratio (1000/10): ${scalingRatio.toFixed(2)}x`);

				// Should not scale linearly (would be 100x)
				expect(scalingRatio).toBeLessThan(50);
			}
		});

		test("documents memory usage scaling", async () => {
			const sizes = [100, 500, 1000, 5000];
			const results: Array<{ size: number; memMB: number }> = [];

			for (const size of sizes) {
				const memBefore = process.memoryUsage();

				const pipeline = Pipeline.start<number[]>().map(
					"processed",
					createStep("process", async ({ input }: { input: number }) => ({
						value: input,
						squared: input * input,
					})),
					{ parallel: true, concurrencyLimit: 50 },
				);

				await pipeline.execute(Array.from({ length: size }, (_, i) => i));

				const memAfter = process.memoryUsage();
				const memIncrease =
					(memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024;

				results.push({
					size,
					memMB: Number.parseFloat(memIncrease.toFixed(2)),
				});
			}

			console.log("Memory usage characteristics:");
			console.table(results);

			// Verify memory usage is reasonable and roughly linear
			const size1000 = results.find((r) => r.size === 1000);
			if (size1000 && size1000.memMB !== undefined) {
				// Should be less than 5MB for 1000 items
				expect(size1000.memMB).toBeLessThan(5);
			}
		});
	});
});
