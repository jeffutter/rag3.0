import { expect, test } from "bun:test";
import { batchItemsStep } from "./batch-items";

test("batches items into equal-sized groups", async () => {
	const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
	const batchSize = 3;

	const result = await batchItemsStep.execute({
		input: { items, batchSize },
		state: {},
		context: undefined,
	});

	expect(result.success).toBe(true);
	if (result.success) {
		expect(result.data.batches).toEqual([
			[1, 2, 3],
			[4, 5, 6],
			[7, 8, 9],
			[10],
		]);
	}
});

test("handles batch size larger than array", async () => {
	const items = [1, 2, 3];
	const batchSize = 10;

	const result = await batchItemsStep.execute({
		input: { items, batchSize },
		state: {},
		context: undefined,
	});

	expect(result.success).toBe(true);
	if (result.success) {
		expect(result.data.batches).toEqual([[1, 2, 3]]);
	}
});

test("handles batch size of 1", async () => {
	const items = ["a", "b", "c"];
	const batchSize = 1;

	const result = await batchItemsStep.execute({
		input: { items, batchSize },
		state: {},
		context: undefined,
	});

	expect(result.success).toBe(true);
	if (result.success) {
		expect(result.data.batches).toEqual([["a"], ["b"], ["c"]]);
	}
});

test("handles empty array", async () => {
	const items: number[] = [];
	const batchSize = 5;

	const result = await batchItemsStep.execute({
		input: { items, batchSize },
		state: {},
		context: undefined,
	});

	expect(result.success).toBe(true);
	if (result.success) {
		expect(result.data.batches).toEqual([]);
	}
});

test("batches objects correctly", async () => {
	const items = [
		{ id: 1, name: "Alice" },
		{ id: 2, name: "Bob" },
		{ id: 3, name: "Charlie" },
		{ id: 4, name: "David" },
		{ id: 5, name: "Eve" },
	];
	const batchSize = 2;

	const result = await batchItemsStep.execute({
		input: { items, batchSize },
		state: {},
		context: undefined,
	});

	expect(result.success).toBe(true);
	if (result.success) {
		expect(result.data.batches).toEqual([
			[
				{ id: 1, name: "Alice" },
				{ id: 2, name: "Bob" },
			],
			[
				{ id: 3, name: "Charlie" },
				{ id: 4, name: "David" },
			],
			[{ id: 5, name: "Eve" }],
		]);
	}
});

test("batches strings correctly", async () => {
	const items = ["chunk1", "chunk2", "chunk3", "chunk4", "chunk5"];
	const batchSize = 2;

	const result = await batchItemsStep.execute({
		input: { items, batchSize },
		state: {},
		context: undefined,
	});

	expect(result.success).toBe(true);
	if (result.success) {
		expect(result.data.batches).toEqual([
			["chunk1", "chunk2"],
			["chunk3", "chunk4"],
			["chunk5"],
		]);
	}
});

test("batch size of 50 for embedding use case", async () => {
	const items = Array.from({ length: 150 }, (_, i) => `chunk-${i + 1}`);
	const batchSize = 50;

	const result = await batchItemsStep.execute({
		input: { items, batchSize },
		state: {},
		context: undefined,
	});

	expect(result.success).toBe(true);
	if (result.success) {
		expect(result.data.batches.length).toBe(3);
		expect(result.data.batches[0]?.length).toBe(50);
		expect(result.data.batches[1]?.length).toBe(50);
		expect(result.data.batches[2]?.length).toBe(50);
		expect(result.data.batches[0]?.[0]).toBe("chunk-1");
		expect(result.data.batches[0]?.[49]).toBe("chunk-50");
		expect(result.data.batches[1]?.[0]).toBe("chunk-51");
		expect(result.data.batches[2]?.[49]).toBe("chunk-150");
	}
});

test("validates positive batch size", async () => {
	const items = [1, 2, 3];

	// Batch size of 0 should fail validation
	const result = await batchItemsStep.execute({
		input: { items, batchSize: 0 },
		state: {},
		context: undefined,
	});

	expect(result.success).toBe(false);
	if (!result.success) {
		expect(result.error.message).toContain("Too small");
	}
});

test("validates integer batch size", async () => {
	const items = [1, 2, 3];

	// Batch size of 2.5 should fail validation
	const result = await batchItemsStep.execute({
		input: { items, batchSize: 2.5 },
		state: {},
		context: undefined,
	});

	expect(result.success).toBe(false);
	if (!result.success) {
		expect(result.error.message).toContain("Invalid input");
	}
});

test("batches preserve order", async () => {
	const items = ["first", "second", "third", "fourth", "fifth"];
	const batchSize = 2;

	const result = await batchItemsStep.execute({
		input: { items, batchSize },
		state: {},
		context: undefined,
	});

	expect(result.success).toBe(true);
	if (result.success) {
		const flattened = result.data.batches.flat();
		expect(flattened).toEqual(items);
	}
});

test("batches with mixed types", async () => {
	const items = [1, "two", { three: 3 }, [4], null, true];
	const batchSize = 2;

	const result = await batchItemsStep.execute({
		input: { items, batchSize },
		state: {},
		context: undefined,
	});

	expect(result.success).toBe(true);
	if (result.success) {
		expect(result.data.batches).toEqual([
			[1, "two"],
			[{ three: 3 }, [4]],
			[null, true],
		]);
	}
});
