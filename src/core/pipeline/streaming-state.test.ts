/**
 * Tests for streaming state management.
 *
 * Validates the hybrid state management approach:
 * - Snapshot access for checkpointed steps
 * - Streaming access for non-checkpointed steps
 * - Lazy materialization
 */

import { describe, expect, test } from "bun:test";
import {
  arrayToGenerator,
  collectStream,
  createEmptyStreamingState,
  replayableGenerator,
  StreamingStateImpl,
} from "./streaming-state";

describe("StreamingState", () => {
  describe("createEmptyStreamingState", () => {
    test("creates an empty state", () => {
      const state = createEmptyStreamingState();
      expect(state.accumulated).toEqual({});
    });

    test("hasSnapshot returns false for non-existent keys", () => {
      const state = createEmptyStreamingState();
      // biome-ignore lint/suspicious/noExplicitAny: Testing with invalid key type
      expect(state.hasSnapshot("nonexistent" as any)).toBe(false);
    });
  });

  describe("snapshot access", () => {
    test("stores and retrieves snapshots", () => {
      const state = new StreamingStateImpl({ step1: [1, 2, 3] }, {});

      expect(state.accumulated).toEqual({ step1: [1, 2, 3] });
      expect(state.hasSnapshot("step1")).toBe(true);
    });

    test("accumulated property caches result", () => {
      const state = new StreamingStateImpl({ step1: [1, 2, 3], step2: ["a", "b"] }, {});

      const first = state.accumulated;
      const second = state.accumulated;

      expect(first).toBe(second); // Same reference
    });

    test("invalidates cache when snapshot added", () => {
      const state = new StreamingStateImpl({ step1: [1, 2, 3] }, {});

      const first = state.accumulated;
      state.addSnapshot("step2", ["a", "b"]);
      const second = state.accumulated;

      expect(first).not.toBe(second); // Different reference
      expect(second).toEqual({ step1: [1, 2, 3], step2: ["a", "b"] });
    });
  });

  describe("stream access", () => {
    test("streams from snapshot", async () => {
      const state = new StreamingStateImpl({ step1: [1, 2, 3] }, {});

      const items = await collectStream(state.stream("step1"));

      expect(items).toEqual([1, 2, 3]);
    });

    test("streams from generator", async () => {
      async function* gen() {
        yield 1;
        yield 2;
        yield 3;
      }

      const state = new StreamingStateImpl({}, { step1: gen() });

      const items = await collectStream(state.stream("step1"));

      expect(items).toEqual([1, 2, 3]);
    });

    test("throws error for non-existent key", async () => {
      const state = createEmptyStreamingState();

      try {
        // biome-ignore lint/suspicious/noExplicitAny: Testing error handling with invalid key type
        await collectStream(state.stream("nonexistent" as any));
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("not found");
      }
    });
  });

  describe("materialize", () => {
    test("returns snapshot as array", async () => {
      const state = new StreamingStateImpl({ step1: [1, 2, 3] }, {});

      const items = await state.materialize("step1");

      expect(items).toEqual([1, 2, 3]);
    });

    test("consumes generator and caches result", async () => {
      async function* gen() {
        yield 1;
        yield 2;
        yield 3;
      }

      const state = new StreamingStateImpl({}, { step1: gen() });

      expect(state.hasSnapshot("step1")).toBe(false);

      const items = await state.materialize("step1");

      expect(items).toEqual([1, 2, 3]);
      expect(state.hasSnapshot("step1")).toBe(true);

      // Second call should return cached snapshot
      const items2 = await state.materialize("step1");
      expect(items2).toEqual([1, 2, 3]);
    });

    test("removes generator after materialization", async () => {
      async function* gen() {
        yield 1;
        yield 2;
      }

      const state = new StreamingStateImpl({}, { step1: gen() });

      await state.materialize("step1");

      // Generator should be consumed and removed
      // Next materialize should use snapshot
      const items = await state.materialize("step1");
      expect(items).toEqual([1, 2]);
    });

    test("throws error for non-existent key", async () => {
      const state = createEmptyStreamingState();

      try {
        // biome-ignore lint/suspicious/noExplicitAny: Testing error handling with invalid key type
        await state.materialize("nonexistent" as any);
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("not found");
      }
    });
  });

  describe("addSnapshot", () => {
    test("adds snapshot and updates hasSnapshot", () => {
      const state = new StreamingStateImpl<{ step1: number[] }>({}, {});

      expect(state.hasSnapshot("step1")).toBe(false);

      // @ts-expect-error - Type mismatch between element type and array type (known limitation)
      state.addSnapshot("step1", [1, 2, 3]);

      expect(state.hasSnapshot("step1")).toBe(true);
      expect(state.accumulated).toEqual({ step1: [1, 2, 3] });
    });

    test("replaces generator with snapshot", async () => {
      async function* gen(): AsyncGenerator<number> {
        yield 1;
      }

      const state = new StreamingStateImpl<{ step1: number[] }>({}, { step1: gen() });

      // @ts-expect-error - Type mismatch between element type and array type (known limitation)
      state.addSnapshot("step1", [1, 2, 3]);

      expect(state.hasSnapshot("step1")).toBe(true);

      const items = await collectStream(state.stream("step1"));
      // @ts-expect-error - Type mismatch in test expectations (known limitation)
      expect(items).toEqual([1, 2, 3]); // From snapshot, not generator
    });
  });

  describe("addGenerator", () => {
    test("adds generator for streaming access", async () => {
      async function* gen(): AsyncGenerator<number> {
        yield 1;
        yield 2;
      }

      const state = new StreamingStateImpl<{ step1: number[] }>({}, {});

      // @ts-expect-error - Type mismatch between element type and array type (known limitation)
      state.addGenerator("step1", gen());

      expect(state.hasSnapshot("step1")).toBe(false);

      const items = await collectStream(state.stream("step1"));
      // @ts-expect-error - Type mismatch in test expectations (known limitation)
      expect(items).toEqual([1, 2]);
    });
  });

  describe("clone", () => {
    test("creates independent copy", () => {
      const original = new StreamingStateImpl({ step1: [1, 2] }, {});

      const cloned = original.clone();

      cloned.addSnapshot("step2", [3, 4]);

      expect(original.hasSnapshot("step2")).toBe(false);
      expect(cloned.hasSnapshot("step2")).toBe(true);
    });
  });

  describe("withKey", () => {
    test("creates new state with added generator", async () => {
      async function* gen1(): AsyncGenerator<number> {
        yield 1;
      }
      async function* gen2(): AsyncGenerator<number> {
        yield 2;
      }

      const state1 = createEmptyStreamingState();
      const state2 = state1.withKey("step1", gen1());
      const state3 = state2.withKey("step2", gen2());

      const items1 = await collectStream(state3.stream("step1"));
      const items2 = await collectStream(state3.stream("step2"));

      expect(items1).toEqual([1]);
      expect(items2).toEqual([2]);
    });
  });

  describe("withCheckpoint", () => {
    test("materializes generator and stores as snapshot", async () => {
      async function* gen(): AsyncGenerator<number> {
        yield 1;
        yield 2;
        yield 3;
      }

      const state1 = createEmptyStreamingState();
      const state2 = await state1.withCheckpoint("step1", gen());

      expect(state2.hasSnapshot("step1")).toBe(true);
      const accumulated: Record<string, unknown> = state2.accumulated;
      expect(accumulated).toEqual({ step1: [1, 2, 3] });
    });
  });
});

describe("Helper functions", () => {
  describe("collectStream", () => {
    test("collects all items from async generator", async () => {
      async function* gen() {
        yield 1;
        yield 2;
        yield 3;
      }

      const items = await collectStream(gen());

      expect(items).toEqual([1, 2, 3]);
    });

    test("handles empty generator", async () => {
      async function* gen() {
        // Empty
      }

      const items = await collectStream(gen());

      expect(items).toEqual([]);
    });
  });

  describe("arrayToGenerator", () => {
    test("converts array to async generator", async () => {
      const items = await collectStream(arrayToGenerator([1, 2, 3]));

      expect(items).toEqual([1, 2, 3]);
    });

    test("handles empty array", async () => {
      const items = await collectStream(arrayToGenerator([]));

      expect(items).toEqual([]);
    });
  });

  describe("replayableGenerator", () => {
    test("allows multiple iterations", async () => {
      async function* gen() {
        yield 1;
        yield 2;
        yield 3;
      }

      const replay = await replayableGenerator(gen());

      const items1 = await collectStream(replay());
      const items2 = await collectStream(replay());

      expect(items1).toEqual([1, 2, 3]);
      expect(items2).toEqual([1, 2, 3]);
    });

    test("caches items in memory", async () => {
      let callCount = 0;

      async function* gen() {
        callCount++;
        yield 1;
        yield 2;
      }

      const replay = await replayableGenerator(gen());

      expect(callCount).toBe(1); // Generator consumed once

      await collectStream(replay());
      await collectStream(replay());

      expect(callCount).toBe(1); // Still only called once
    });
  });
});

describe("Integration scenarios", () => {
  test("per-item state access pattern", async () => {
    // Simulate a pipeline where each item needs access to config
    async function* configGen(): AsyncGenerator<{ apiKey: string }> {
      yield { apiKey: "secret123" };
    }

    async function* itemsGen(): AsyncGenerator<{ id: number; value: string }> {
      yield { id: 1, value: "a" };
      yield { id: 2, value: "b" };
    }

    // Create state with checkpointed config
    const state = await createEmptyStreamingState().withCheckpoint("config", configGen());

    // @ts-expect-error - Type inference limitation with empty state
    state.addGenerator("items", itemsGen());

    // Access config snapshot (fast) - accumulated state holds arrays
    const accumulated: Record<string, unknown> = state.accumulated;
    const configArray = accumulated.config as Array<{ apiKey: string }>;
    const config = configArray[0];
    expect(config).toEqual({ apiKey: "secret123" });

    // Stream items
    const items = await collectStream(state.stream("items"));
    expect(items).toHaveLength(2);
  });

  test("aggregated state access pattern", async () => {
    // Simulate a pipeline that needs to aggregate statistics
    async function* numbersGen(): AsyncGenerator<number> {
      yield 1;
      yield 2;
      yield 3;
      yield 4;
      yield 5;
    }

    const state = new StreamingStateImpl<{ numbers: number[] }>({}, {});
    // @ts-expect-error - Type mismatch between element type and array type (known limitation)
    state.addGenerator("numbers", numbersGen());

    // Materialize to compute statistics
    const numbers = await state.materialize("numbers");

    // @ts-expect-error - Type mismatch in reduce operation (known limitation)
    const sum = numbers.reduce((a, b) => a + b, 0);
    const avg = sum / numbers.length;

    expect(sum).toBe(15);
    expect(avg).toBe(3);

    // After materialization, can stream again from snapshot
    const numbers2 = await collectStream(state.stream("numbers"));
    // @ts-expect-error - Type mismatch in test expectations (known limitation)
    expect(numbers2).toEqual([1, 2, 3, 4, 5]);
  });

  test("mixed streaming and snapshot access", async () => {
    async function* gen1(): AsyncGenerator<string> {
      yield "a";
      yield "b";
    }
    async function* gen2(): AsyncGenerator<number> {
      yield 1;
      yield 2;
    }

    // Start with one checkpointed step
    const state = await createEmptyStreamingState().withCheckpoint("step1", gen1());

    // Add streaming step
    // @ts-expect-error - Type inference limitation with empty state
    state.addGenerator("step2", gen2());

    // Access snapshot directly - accumulated state holds arrays
    const accumulated: Record<string, unknown> = state.accumulated;
    const step1Data = accumulated.step1 as string[];
    expect(step1Data).toEqual(["a", "b"]);

    // Stream from non-checkpointed step
    const items = await collectStream(state.stream("step2"));
    // @ts-expect-error - Type inference limitation with empty state
    expect(items).toEqual([1, 2]);
  });
});
