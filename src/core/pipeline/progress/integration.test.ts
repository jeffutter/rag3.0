/**
 * Integration tests for progress tracking with StreamingPipeline.
 */

import { describe, expect, test } from "bun:test";
import { fromArray, toArray } from "../streaming/generators";
import { StreamingPipeline } from "../streaming-builder";
import { createProgressTracker } from "./tracker";
import type { ProgressEvent } from "./types";

describe("StreamingPipeline with Progress Tracking", () => {
  test("tracks progress through a simple pipeline", async () => {
    const tracker = createProgressTracker();
    const events: ProgressEvent[] = [];
    tracker.subscribe((event) => events.push(event));

    const pipeline = StreamingPipeline.start<number>()
      .map("doubled", (n) => n * 2)
      .filter("evens", (n) => n % 4 === 0);

    const input = fromArray([1, 2, 3, 4, 5]);
    const results = await toArray(pipeline.executeWithProgress(input, tracker));

    // Check results are correct
    expect(results).toEqual([4, 8]);

    // Check progress tracking
    const progress = tracker.getOverallProgress();
    expect(progress.isComplete).toBe(true);
    expect(progress.hasFailed).toBe(false);
    expect(progress.completedSteps).toBe(2);
    expect(progress.totalSteps).toBe(2);

    // Check step progress
    const doubledProgress = tracker.getStepProgress("doubled");
    expect(doubledProgress).toBeDefined();
    expect(doubledProgress?.status).toBe("completed");
    expect(doubledProgress?.inputCount).toBe(5);
    expect(doubledProgress?.outputCount).toBe(5);

    const evensProgress = tracker.getStepProgress("evens");
    expect(evensProgress).toBeDefined();
    expect(evensProgress?.status).toBe("completed");
    expect(evensProgress?.inputCount).toBe(5);
    expect(evensProgress?.outputCount).toBe(2); // Only 4 and 8 pass filter
  });

  test("tracks progress through flatMap (expansion)", async () => {
    const tracker = createProgressTracker();

    const pipeline = StreamingPipeline.start<string>().flatMap("words", (line) => line.split(" "));

    const input = fromArray(["hello world", "foo bar baz"]);
    const results = await toArray(pipeline.executeWithProgress(input, tracker));

    expect(results).toEqual(["hello", "world", "foo", "bar", "baz"]);

    const wordsProgress = tracker.getStepProgress("words");
    expect(wordsProgress).toBeDefined();
    expect(wordsProgress?.inputCount).toBe(2);
    expect(wordsProgress?.outputCount).toBe(5);
    expect(wordsProgress?.expansionRatio).toBe(2.5); // 5/2 = 2.5x expansion
  });

  test("tracks progress through batch operations", async () => {
    const tracker = createProgressTracker();

    const pipeline = StreamingPipeline.start<number>().batch("batched", 3);

    const input = fromArray([1, 2, 3, 4, 5, 6, 7]);
    const results = await toArray(pipeline.executeWithProgress(input, tracker));

    expect(results).toEqual([[1, 2, 3], [4, 5, 6], [7]]);

    const batchProgress = tracker.getStepProgress("batched");
    expect(batchProgress).toBeDefined();
    expect(batchProgress?.inputCount).toBe(7);
    expect(batchProgress?.outputCount).toBe(3); // 3 batches
    expect(batchProgress?.expansionRatio).toBeCloseTo(3 / 7, 2); // Contraction
  });

  test("tracks errors in pipeline", async () => {
    const tracker = createProgressTracker();

    const pipeline = StreamingPipeline.start<number>().map("failing", (n) => {
      if (n === 3) throw new Error("Failed on 3");
      return n * 2;
    });

    const input = fromArray([1, 2, 3, 4, 5]);

    try {
      await toArray(pipeline.executeWithProgress(input, tracker));
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect((error as Error).message).toBe("Failed on 3");
    }

    const progress = tracker.getOverallProgress();
    expect(progress.hasFailed).toBe(true);

    const stepProgress = tracker.getStepProgress("failing");
    expect(stepProgress?.status).toBe("failed");
    expect(stepProgress?.errorCount).toBe(1);
    expect(stepProgress?.lastError).toBe("Failed on 3");
  });

  test("emits events at key lifecycle points", async () => {
    const tracker = createProgressTracker();
    const eventTypes: string[] = [];

    tracker.subscribe((event) => {
      eventTypes.push(event.type);
    });

    const pipeline = StreamingPipeline.start<number>().map("doubled", (n) => n * 2);

    const input = fromArray([1, 2, 3]);
    await toArray(pipeline.executeWithProgress(input, tracker));

    // Check key events were emitted
    expect(eventTypes).toContain("pipeline:start");
    expect(eventTypes).toContain("step:start");
    expect(eventTypes).toContain("item:processed");
    expect(eventTypes).toContain("item:yielded");
    expect(eventTypes).toContain("step:complete");
    expect(eventTypes).toContain("pipeline:complete");
  });

  test("generates readable summary", async () => {
    const tracker = createProgressTracker();

    const pipeline = StreamingPipeline.start<number>()
      .map("doubled", (n) => n * 2)
      .filter("positive", (n) => n > 0)
      .batch("batched", 2);

    const input = fromArray([1, 2, 3, 4, 5]);
    await toArray(pipeline.executeWithProgress(input, tracker));

    const summary = tracker.generateSummary();

    expect(summary).toContain("Pipeline Summary");
    expect(summary).toContain("COMPLETED");
    expect(summary).toContain("doubled");
    expect(summary).toContain("positive");
    expect(summary).toContain("batched");
  });

  test("getStageNames returns step names in order", () => {
    const pipeline = StreamingPipeline.start<number>()
      .map("step1", (n) => n)
      .filter("step2", () => true)
      .flatMap("step3", (n) => [n]);

    const names = pipeline.getStageNames();
    expect(names).toEqual(["step1", "step2", "step3"]);
  });

  test("handles async operations", async () => {
    const tracker = createProgressTracker();

    const pipeline = StreamingPipeline.start<number>().map("delayed", async (n) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return n * 2;
    });

    const input = fromArray([1, 2, 3]);
    const results = await toArray(pipeline.executeWithProgress(input, tracker));

    expect(results).toEqual([2, 4, 6]);

    const progress = tracker.getOverallProgress();
    expect(progress.isComplete).toBe(true);
    expect(progress.elapsedMs).toBeGreaterThan(20); // At least some time passed
  });

  test("handles empty input", async () => {
    const tracker = createProgressTracker();

    const pipeline = StreamingPipeline.start<number>().map("doubled", (n) => n * 2);

    const input = fromArray<number>([]);
    const results = await toArray(pipeline.executeWithProgress(input, tracker));

    expect(results).toEqual([]);

    const progress = tracker.getOverallProgress();
    expect(progress.isComplete).toBe(true);
    expect(progress.totalItemsProcessed).toBe(0);
  });

  test("tracks multiple steps with different item counts", async () => {
    const tracker = createProgressTracker();

    const pipeline = StreamingPipeline.start<number>()
      .flatMap("expanded", (n) => [n, n, n]) // 3x expansion
      .filter("filtered", (n) => n > 2); // Keeps ~half

    const input = fromArray([1, 2, 3]);
    const results = await toArray(pipeline.executeWithProgress(input, tracker));

    // Input: [1, 2, 3]
    // After expanded: [1, 1, 1, 2, 2, 2, 3, 3, 3]
    // After filtered (n > 2): [3, 3, 3]
    expect(results).toEqual([3, 3, 3]);

    const expandedProgress = tracker.getStepProgress("expanded");
    expect(expandedProgress?.inputCount).toBe(3);
    expect(expandedProgress?.outputCount).toBe(9);
    expect(expandedProgress?.expansionRatio).toBe(3);

    const filteredProgress = tracker.getStepProgress("filtered");
    expect(filteredProgress?.inputCount).toBe(9);
    expect(filteredProgress?.outputCount).toBe(3);
  });
});
