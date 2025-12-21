import { expect, test } from "bun:test";
import type {
	AddToState,
	ArrayElement,
	BatchTransform,
	FlatMapTransform,
	FlattenTransform,
	IsArray,
	ListStep,
	SingleToListTransform,
} from "./list-types";
import type { Step } from "./types";

/**
 * Compile-time type validation tests for list operations.
 */

test("ArrayElement extracts element type from arrays", () => {
	type StringArray = string[];
	type Element = ArrayElement<StringArray>;
	const _typeCheck: Element = "test";
	expect(true).toBe(true);

	type NumberArray = number[];
	type NumElement = ArrayElement<NumberArray>;
	const _numCheck: NumElement = 42;
	expect(true).toBe(true);
});

test("IsArray identifies array types at compile-time", () => {
	type StringArrayCheck = IsArray<string[]>;
	const _stringArrayCheck: StringArrayCheck = true;
	expect(true).toBe(true);

	type StringCheck = IsArray<string>;
	const _stringCheck: StringCheck = false;
	expect(true).toBe(true);
});

test("ListStep properly extends Step with array semantics", () => {
	// biome-ignore lint/complexity/noBannedTypes: Empty state for initial pipeline
	type StringToNumberListStep = ListStep<string, number, {}, unknown>;

	const _step: StringToNumberListStep = {
		name: "test-list-step",
		execute: async ({ input }) => ({
			success: true,
			data: input.map((s) => s.length),
			metadata: {
				stepName: "test",
				startTime: 0,
				endTime: 0,
				durationMs: 0,
			},
		}),
	};

	// biome-ignore lint/complexity/noBannedTypes: Empty state for test compatibility
	const _regularStep: Step<string[], number[], {}, unknown> = _step;
	expect(true).toBe(true);
});

test("SingleToListTransform wraps single-item steps", () => {
	// biome-ignore lint/complexity/noBannedTypes: Empty state for test
	type SingleStep = Step<string, number, {}, unknown>;
	type ArrayStep = SingleToListTransform<SingleStep>;

	const _step: ArrayStep = {
		name: "array-step",
		execute: async ({ input }) => ({
			success: true,
			data: input.map((s) => s.length),
			metadata: {
				stepName: "test",
				startTime: 0,
				endTime: 0,
				durationMs: 0,
			},
		}),
	};

	// biome-ignore lint/complexity/noBannedTypes: Empty state for test
	const _check: Step<string[], number[], {}, unknown> = _step;
	expect(true).toBe(true);
});

test("FlatMapTransform handles steps that return arrays", () => {
	// biome-ignore lint/complexity/noBannedTypes: Empty state for test
	type SplitStep = Step<string, string[], {}, unknown>;
	type FlatMappedStep = FlatMapTransform<SplitStep>;

	const _step: FlatMappedStep = {
		name: "flatmap-step",
		execute: async ({ input }) => ({
			success: true,
			data: input.flatMap((s) => s.split(" ")),
			metadata: {
				stepName: "test",
				startTime: 0,
				endTime: 0,
				durationMs: 0,
			},
		}),
	};

	// biome-ignore lint/complexity/noBannedTypes: Empty state for test
	const _check: Step<string[], string[], {}, unknown> = _step;
	expect(true).toBe(true);
});

test("BatchTransform creates batched array type", () => {
	type Items = string[];
	type Batched = BatchTransform<Items>;

	const _batches: Batched = [
		["a", "b"],
		["c", "d"],
	];
	expect(true).toBe(true);
});

test("FlattenTransform flattens nested arrays", () => {
	type Nested = string[][];
	type Flat = FlattenTransform<Nested>;

	const _flat: Flat = ["a", "b", "c"];
	expect(true).toBe(true);
});

test("AddToState handles array types in accumulated state", () => {
	// biome-ignore lint/complexity/noBannedTypes: Empty object represents initial empty pipeline state
	type State1 = {};
	type State2 = AddToState<State1, "items", string[]>;

	const _state2: State2 = { items: ["a", "b", "c"] };
	expect(true).toBe(true);

	type State3 = AddToState<State2, "counts", number[]>;

	const _state3: State3 = {
		items: ["a", "b"],
		counts: [1, 2],
	};
	expect(true).toBe(true);
});
