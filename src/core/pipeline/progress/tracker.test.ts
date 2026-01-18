/**
 * Tests for the ProgressTracker class.
 */

import { describe, expect, test } from "bun:test";
import { createProgressTracker, ProgressTracker } from "./tracker";
import type { ProgressEvent } from "./types";

describe("ProgressTracker", () => {
  describe("createProgressTracker", () => {
    test("creates a tracker with default options", () => {
      const tracker = createProgressTracker();
      expect(tracker).toBeInstanceOf(ProgressTracker);
    });

    test("creates a tracker with custom options", () => {
      const tracker = createProgressTracker({
        mode: "verbose",
        updateIntervalMs: 100,
        samplingRate: 2,
      });
      expect(tracker).toBeInstanceOf(ProgressTracker);
    });
  });

  describe("pipeline lifecycle", () => {
    test("tracks pipeline start", () => {
      const tracker = createProgressTracker();
      const events: ProgressEvent[] = [];

      tracker.subscribe((event) => events.push(event));
      tracker.pipelineStarted(["step1", "step2", "step3"]);

      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("pipeline:start");

      const progress = tracker.getOverallProgress();
      expect(progress.totalSteps).toBe(3);
      expect(progress.completedSteps).toBe(0);
      expect(progress.isComplete).toBe(false);
    });

    test("tracks pipeline completion", () => {
      const tracker = createProgressTracker();
      const events: ProgressEvent[] = [];

      tracker.subscribe((event) => events.push(event));
      tracker.pipelineStarted(["step1"]);
      tracker.stepStarted("step1", 0);
      tracker.stepCompleted("step1");
      tracker.pipelineCompleted();

      const completeEvent = events.find((e) => e.type === "pipeline:complete");
      expect(completeEvent).toBeDefined();

      const progress = tracker.getOverallProgress();
      expect(progress.isComplete).toBe(true);
      expect(progress.hasFailed).toBe(false);
    });

    test("tracks pipeline error", () => {
      const tracker = createProgressTracker();
      const events: ProgressEvent[] = [];

      tracker.subscribe((event) => events.push(event));
      tracker.pipelineStarted(["step1"]);
      tracker.pipelineError(new Error("Test error"));

      const errorEvent = events.find((e) => e.type === "pipeline:error");
      expect(errorEvent).toBeDefined();
      expect(errorEvent?.error?.message).toBe("Test error");

      const progress = tracker.getOverallProgress();
      expect(progress.isComplete).toBe(true);
      expect(progress.hasFailed).toBe(true);
    });
  });

  describe("step lifecycle", () => {
    test("tracks step start", () => {
      const tracker = createProgressTracker();
      const events: ProgressEvent[] = [];

      tracker.subscribe((event) => events.push(event));
      tracker.pipelineStarted(["step1", "step2"]);
      tracker.stepStarted("step1", 0);

      const stepEvent = events.find((e) => e.type === "step:start");
      expect(stepEvent).toBeDefined();
      expect(stepEvent?.stepName).toBe("step1");
      expect(stepEvent?.stepIndex).toBe(0);

      const stepProgress = tracker.getStepProgress("step1");
      expect(stepProgress).toBeDefined();
      expect(stepProgress?.status).toBe("running");
      expect(stepProgress?.index).toBe(0);
    });

    test("tracks step completion", () => {
      const tracker = createProgressTracker();
      tracker.pipelineStarted(["step1"]);
      tracker.stepStarted("step1", 0);
      tracker.recordItemProcessed("step1", 10);
      tracker.recordItemYielded("step1", 10);
      tracker.stepCompleted("step1");

      const stepProgress = tracker.getStepProgress("step1");
      expect(stepProgress).toBeDefined();
      expect(stepProgress?.status).toBe("completed");
      expect(stepProgress?.completedAt).toBeDefined();
    });

    test("tracks step error", () => {
      const tracker = createProgressTracker();
      tracker.pipelineStarted(["step1"]);
      tracker.stepStarted("step1", 0);
      tracker.stepError("step1", new Error("Step failed"));

      const stepProgress = tracker.getStepProgress("step1");
      expect(stepProgress).toBeDefined();
      expect(stepProgress?.status).toBe("failed");
      expect(stepProgress?.errorCount).toBe(1);
      expect(stepProgress?.lastError).toBe("Step failed");
    });
  });

  describe("item tracking", () => {
    test("tracks items processed", () => {
      const tracker = createProgressTracker();
      tracker.pipelineStarted(["step1"]);
      tracker.stepStarted("step1", 0);

      tracker.recordItemProcessed("step1", 5);
      tracker.recordItemProcessed("step1", 3);

      const stepProgress = tracker.getStepProgress("step1");
      expect(stepProgress?.inputCount).toBe(8);
    });

    test("tracks items yielded", () => {
      const tracker = createProgressTracker();
      tracker.pipelineStarted(["step1"]);
      tracker.stepStarted("step1", 0);

      tracker.recordItemYielded("step1", 10);
      tracker.recordItemYielded("step1", 5);

      const stepProgress = tracker.getStepProgress("step1");
      expect(stepProgress?.outputCount).toBe(15);
    });

    test("calculates expansion ratio", () => {
      const tracker = createProgressTracker();
      tracker.pipelineStarted(["step1"]);
      tracker.stepStarted("step1", 0);

      tracker.recordItemProcessed("step1", 10);
      tracker.recordItemYielded("step1", 30);

      const stepProgress = tracker.getStepProgress("step1");
      expect(stepProgress?.expansionRatio).toBe(3); // 30/10 = 3x expansion
    });

    test("respects sampling rate", () => {
      const tracker = createProgressTracker({ samplingRate: 2 });
      tracker.pipelineStarted(["step1"]);
      tracker.stepStarted("step1", 0);

      // With samplingRate=2, every 2nd call is recorded
      // But recorded values are multiplied by samplingRate
      for (let i = 0; i < 10; i++) {
        tracker.recordItemProcessed("step1", 1);
      }

      const stepProgress = tracker.getStepProgress("step1");
      // 5 samples recorded (calls 2,4,6,8,10), each multiplied by 2
      expect(stepProgress?.inputCount).toBe(10);
    });
  });

  describe("parallel tracking", () => {
    test("tracks in-flight operations", () => {
      const tracker = createProgressTracker();
      tracker.pipelineStarted(["step1"]);
      tracker.stepStarted("step1", 0);

      tracker.recordInFlight("step1", 5, 10);

      const stepProgress = tracker.getStepProgress("step1");
      expect(stepProgress?.inFlightCount).toBe(5);
      expect(stepProgress?.concurrencyLimit).toBe(10);
    });
  });

  describe("overall progress", () => {
    test("calculates overall progress ratio", () => {
      const tracker = createProgressTracker();
      tracker.pipelineStarted(["step1", "step2", "step3"]);

      tracker.stepStarted("step1", 0);
      tracker.stepCompleted("step1");

      const progress = tracker.getOverallProgress();
      // 1 of 3 steps completed = ~33%
      expect(progress.completedSteps).toBe(1);
      expect(progress.totalSteps).toBe(3);
      expect(progress.progressRatio).toBeGreaterThan(0.3);
    });

    test("calculates total items processed", () => {
      const tracker = createProgressTracker();
      tracker.pipelineStarted(["step1", "step2"]);

      tracker.stepStarted("step1", 0);
      tracker.recordItemProcessed("step1", 100);
      tracker.stepCompleted("step1");

      tracker.stepStarted("step2", 1);
      tracker.recordItemProcessed("step2", 50);

      const progress = tracker.getOverallProgress();
      expect(progress.totalItemsProcessed).toBe(150);
    });

    test("tracks elapsed time", async () => {
      const tracker = createProgressTracker();
      tracker.pipelineStarted(["step1"]);

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 50));

      const progress = tracker.getOverallProgress();
      expect(progress.elapsedMs).toBeGreaterThan(40);
    });
  });

  describe("event subscription", () => {
    test("subscribes to progress events", () => {
      const tracker = createProgressTracker();
      const events: ProgressEvent[] = [];

      tracker.subscribe((event) => events.push(event));

      tracker.pipelineStarted(["step1"]);
      tracker.stepStarted("step1", 0);
      tracker.recordItemProcessed("step1", 1);
      tracker.recordItemYielded("step1", 1);
      tracker.stepCompleted("step1");
      tracker.pipelineCompleted();

      expect(events.length).toBeGreaterThan(0);
      expect(events.some((e) => e.type === "pipeline:start")).toBe(true);
      expect(events.some((e) => e.type === "step:start")).toBe(true);
      expect(events.some((e) => e.type === "step:complete")).toBe(true);
      expect(events.some((e) => e.type === "pipeline:complete")).toBe(true);
    });

    test("unsubscribes from progress events", () => {
      const tracker = createProgressTracker();
      const events: ProgressEvent[] = [];

      const unsubscribe = tracker.subscribe((event) => events.push(event));

      tracker.pipelineStarted(["step1"]);
      expect(events).toHaveLength(1);

      unsubscribe();

      tracker.stepStarted("step1", 0);
      // No new events after unsubscribe
      expect(events).toHaveLength(1);
    });

    test("handles listener errors gracefully", () => {
      const tracker = createProgressTracker();
      const goodEvents: ProgressEvent[] = [];

      // Bad listener that throws
      tracker.subscribe(() => {
        throw new Error("Listener error");
      });

      // Good listener
      tracker.subscribe((event) => goodEvents.push(event));

      // Should not throw
      tracker.pipelineStarted(["step1"]);

      // Good listener should still receive events
      expect(goodEvents).toHaveLength(1);
    });
  });

  describe("getAllStepProgress", () => {
    test("returns progress for all steps in order", () => {
      const tracker = createProgressTracker();
      tracker.pipelineStarted(["step1", "step2", "step3"]);

      tracker.stepStarted("step1", 0);
      tracker.stepCompleted("step1");
      tracker.stepStarted("step2", 1);

      const allProgress = tracker.getAllStepProgress();
      expect(allProgress).toHaveLength(3);
      expect(allProgress[0]?.name).toBe("step1");
      expect(allProgress[0]?.status).toBe("completed");
      expect(allProgress[1]?.name).toBe("step2");
      expect(allProgress[1]?.status).toBe("running");
      expect(allProgress[2]?.name).toBe("step3");
      expect(allProgress[2]?.status).toBe("pending");
    });
  });

  describe("generateSummary", () => {
    test("generates a readable summary", () => {
      const tracker = createProgressTracker();
      tracker.pipelineStarted(["step1", "step2"]);

      tracker.stepStarted("step1", 0);
      tracker.recordItemProcessed("step1", 100);
      tracker.recordItemYielded("step1", 100);
      tracker.stepCompleted("step1");

      tracker.stepStarted("step2", 1);
      tracker.recordItemProcessed("step2", 100);
      tracker.recordItemYielded("step2", 200); // 2x expansion
      tracker.stepCompleted("step2");

      tracker.pipelineCompleted();

      const summary = tracker.generateSummary();

      expect(summary).toContain("Pipeline Summary");
      expect(summary).toContain("COMPLETED");
      expect(summary).toContain("step1");
      expect(summary).toContain("step2");
      expect(summary).toContain("100");
      expect(summary).toContain("200");
    });

    test("shows errors in summary", () => {
      const tracker = createProgressTracker();
      tracker.pipelineStarted(["step1"]);

      tracker.stepStarted("step1", 0);
      tracker.stepError("step1", new Error("Something went wrong"));

      const summary = tracker.generateSummary();

      expect(summary).toContain("Errors");
      expect(summary).toContain("Something went wrong");
    });
  });

  describe("disabled tracker", () => {
    test("does not emit events when disabled", () => {
      const tracker = createProgressTracker({ enabled: false });
      const events: ProgressEvent[] = [];

      tracker.subscribe((event) => events.push(event));

      tracker.pipelineStarted(["step1"]);
      tracker.stepStarted("step1", 0);
      tracker.recordItemProcessed("step1", 100);

      // No events should be emitted
      expect(events).toHaveLength(0);
    });
  });
});
