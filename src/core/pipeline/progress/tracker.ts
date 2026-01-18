/**
 * Progress tracker implementation for streaming pipelines.
 *
 * Tracks progress at both step and pipeline level, calculates throughput rates
 * using exponential moving averages, and emits events for reactive rendering.
 *
 * Key features:
 * - Step-level tracking (items processed/yielded, timing, expansion ratios)
 * - Overall pipeline progress aggregation
 * - Throughput calculation with exponential moving averages
 * - Event-based updates for reactive rendering
 * - Summary generation for final output
 *
 * @module progress/tracker
 */

import type {
  IProgressTracker,
  OverallProgress,
  ProgressEvent,
  ProgressEventType,
  ProgressListener,
  ProgressOptions,
  StepMetrics,
  StepProgress,
  StepStatus,
  TimingWindow,
} from "./types";

/**
 * Default options for the progress tracker.
 */
const DEFAULT_OPTIONS: Required<ProgressOptions> = {
  enabled: true,
  mode: "compact",
  updateIntervalMs: 200,
  samplingRate: 1,
  showTimings: true,
  output: process.stderr,
};

/**
 * EMA smoothing factor for rate calculations.
 * 0.3 gives more weight to recent data while smoothing out spikes.
 */
const EMA_ALPHA = 0.3;

/**
 * Window size for rate calculations in milliseconds.
 */
const RATE_WINDOW_MS = 1000;

/**
 * Create a new timing window starting now.
 */
function createTimingWindow(): TimingWindow {
  return {
    startTime: Date.now(),
    startCount: 0,
    currentCount: 0,
    rate: 0,
  };
}

/**
 * Update a timing window with a new count and calculate rate.
 */
function updateTimingWindow(window: TimingWindow, newCount: number): void {
  const now = Date.now();
  const elapsed = now - window.startTime;

  window.currentCount = newCount;

  // Calculate instantaneous rate over the window
  if (elapsed >= RATE_WINDOW_MS) {
    const countDelta = newCount - window.startCount;
    const instantRate = (countDelta / elapsed) * 1000; // items per second

    // Apply EMA smoothing
    if (window.rate === 0) {
      window.rate = instantRate;
    } else {
      window.rate = EMA_ALPHA * instantRate + (1 - EMA_ALPHA) * window.rate;
    }

    // Reset window
    window.startTime = now;
    window.startCount = newCount;
  }
}

/**
 * Progress tracker implementation.
 *
 * Tracks pipeline execution progress and emits events for UI updates.
 */
export class ProgressTracker implements IProgressTracker {
  private options: Required<ProgressOptions>;
  private stepMetrics: Map<string, StepMetrics> = new Map();
  private stepOrder: string[] = [];
  private listeners: Set<ProgressListener> = new Set();
  private pipelineStartedAt?: number;
  private pipelineCompletedAt?: number;
  private hasFailed = false;
  private sampleCounter = 0;

  constructor(options: ProgressOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Check if this item should be tracked based on sampling rate.
   */
  private shouldSample(): boolean {
    this.sampleCounter++;
    return this.sampleCounter % this.options.samplingRate === 0;
  }

  /**
   * Emit a progress event to all listeners.
   */
  private emit(type: ProgressEventType, data: Partial<ProgressEvent> = {}): void {
    if (!this.options.enabled) return;

    const event: ProgressEvent = {
      type,
      timestamp: Date.now(),
      overallProgress: this.getOverallProgress(),
      ...data,
    };

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener errors to prevent breaking the pipeline
      }
    }
  }

  /**
   * Get or create metrics for a step.
   */
  private getOrCreateMetrics(stepName: string): StepMetrics {
    let metrics = this.stepMetrics.get(stepName);
    if (!metrics) {
      const index = this.stepOrder.indexOf(stepName);
      metrics = {
        name: stepName,
        index: index >= 0 ? index : this.stepMetrics.size,
        status: "pending",
        inputCount: 0,
        outputCount: 0,
        inFlightCount: 0,
        concurrencyLimit: 1,
        errorCount: 0,
        inputWindow: createTimingWindow(),
        outputWindow: createTimingWindow(),
      };
      this.stepMetrics.set(stepName, metrics);
    }
    return metrics;
  }

  /**
   * Convert internal metrics to StepProgress for external use.
   */
  private metricsToProgress(metrics: StepMetrics): StepProgress {
    const now = Date.now();
    const startedAt = metrics.startedAt ?? now;
    const completedAt = metrics.completedAt;
    const durationMs = (completedAt ?? now) - startedAt;

    const expansionRatio = metrics.inputCount > 0 ? metrics.outputCount / metrics.inputCount : 1;

    return {
      name: metrics.name,
      index: metrics.index,
      status: metrics.status,
      inputCount: metrics.inputCount,
      outputCount: metrics.outputCount,
      expansionRatio,
      inputRate: metrics.inputWindow.rate,
      outputRate: metrics.outputWindow.rate,
      inFlightCount: metrics.inFlightCount,
      concurrencyLimit: metrics.concurrencyLimit,
      startedAt: metrics.startedAt,
      completedAt: metrics.completedAt,
      durationMs,
      errorCount: metrics.errorCount,
      lastError: metrics.lastError,
    };
  }

  // ============ Lifecycle Methods ============

  /**
   * Called when the pipeline starts execution.
   */
  pipelineStarted(stepNames: string[]): void {
    this.pipelineStartedAt = Date.now();
    this.stepOrder = [...stepNames];

    // Initialize metrics for all steps
    for (const [i, name] of stepNames.entries()) {
      const metrics = this.getOrCreateMetrics(name);
      metrics.index = i;
      metrics.status = "pending";
    }

    this.emit("pipeline:start");
  }

  /**
   * Called when the pipeline completes successfully.
   */
  pipelineCompleted(): void {
    this.pipelineCompletedAt = Date.now();
    this.emit("pipeline:complete");
  }

  /**
   * Called when the pipeline fails with an error.
   */
  pipelineError(error: Error): void {
    this.hasFailed = true;
    this.pipelineCompletedAt = Date.now();
    this.emit("pipeline:error", { error });
  }

  // ============ Step Lifecycle ============

  /**
   * Called when a step starts processing.
   */
  stepStarted(stepName: string, index: number): void {
    const metrics = this.getOrCreateMetrics(stepName);
    metrics.index = index;
    metrics.status = "running";
    metrics.startedAt = Date.now();
    metrics.inputWindow = createTimingWindow();
    metrics.outputWindow = createTimingWindow();

    this.emit("step:start", {
      stepName,
      stepIndex: index,
      stepProgress: this.metricsToProgress(metrics),
    });
  }

  /**
   * Called when a step completes successfully.
   */
  stepCompleted(stepName: string): void {
    const metrics = this.stepMetrics.get(stepName);
    if (!metrics) return;

    metrics.status = "completed";
    metrics.completedAt = Date.now();
    metrics.inFlightCount = 0;

    this.emit("step:complete", {
      stepName,
      stepIndex: metrics.index,
      stepProgress: this.metricsToProgress(metrics),
    });
  }

  /**
   * Called when a step fails with an error.
   */
  stepError(stepName: string, error: Error): void {
    const metrics = this.getOrCreateMetrics(stepName);
    metrics.status = "failed";
    metrics.errorCount++;
    metrics.lastError = error.message;
    metrics.completedAt = Date.now();

    this.emit("step:error", {
      stepName,
      stepIndex: metrics.index,
      error,
      stepProgress: this.metricsToProgress(metrics),
    });
  }

  // ============ Item Tracking ============

  /**
   * Record items processed by a step (input side).
   */
  recordItemProcessed(stepName: string, count = 1): void {
    if (!this.shouldSample()) return;

    const metrics = this.getOrCreateMetrics(stepName);
    metrics.inputCount += count * this.options.samplingRate;
    updateTimingWindow(metrics.inputWindow, metrics.inputCount);

    this.emit("item:processed", {
      stepName,
      stepIndex: metrics.index,
      itemCount: count,
      stepProgress: this.metricsToProgress(metrics),
    });
  }

  /**
   * Record items yielded by a step (output side).
   */
  recordItemYielded(stepName: string, count = 1): void {
    if (!this.shouldSample()) return;

    const metrics = this.getOrCreateMetrics(stepName);
    metrics.outputCount += count * this.options.samplingRate;
    updateTimingWindow(metrics.outputWindow, metrics.outputCount);

    this.emit("item:yielded", {
      stepName,
      stepIndex: metrics.index,
      itemCount: count,
      stepProgress: this.metricsToProgress(metrics),
    });
  }

  // ============ Parallel Tracking ============

  /**
   * Record in-flight operations for parallel steps.
   */
  recordInFlight(stepName: string, count: number, limit: number): void {
    const metrics = this.getOrCreateMetrics(stepName);
    metrics.inFlightCount = count;
    metrics.concurrencyLimit = limit;
  }

  // ============ Queries ============

  /**
   * Get progress for a specific step.
   */
  getStepProgress(stepName: string): StepProgress | undefined {
    const metrics = this.stepMetrics.get(stepName);
    if (!metrics) return undefined;
    return this.metricsToProgress(metrics);
  }

  /**
   * Get progress for all steps.
   */
  getAllStepProgress(): StepProgress[] {
    return this.stepOrder
      .map((name) => this.stepMetrics.get(name))
      .filter((m): m is StepMetrics => m !== undefined)
      .map((m) => this.metricsToProgress(m));
  }

  /**
   * Get overall pipeline progress.
   */
  getOverallProgress(): OverallProgress {
    const now = Date.now();
    const startedAt = this.pipelineStartedAt ?? now;
    const elapsedMs = (this.pipelineCompletedAt ?? now) - startedAt;

    const allProgress = this.getAllStepProgress();
    const completedSteps = allProgress.filter((p) => p.status === "completed").length;
    const totalSteps = this.stepOrder.length || 1;

    // Find current step (first non-completed step)
    const currentStep = allProgress.find((p) => p.status === "running" || p.status === "pending") ?? allProgress[0];
    const currentStepIndex = currentStep?.index ?? 0;
    const currentStepName = currentStep?.name ?? "";

    // Calculate overall progress ratio
    // Include partial progress from the current step
    let progressRatio = completedSteps / totalSteps;
    if (currentStep && currentStep.status === "running") {
      // Estimate current step progress based on rate
      // This is a simple heuristic - more sophisticated estimation could be added
      const stepContribution = 1 / totalSteps;
      // Assume we're partway through based on items processed
      // Without knowing total, we estimate based on time
      const stepElapsed = (now - (currentStep.startedAt ?? now)) / 1000;
      // Cap at 90% of step to avoid false "almost done" signals
      const stepProgress = Math.min(0.9, stepElapsed / 10); // Assume 10s per step as baseline
      progressRatio += stepProgress * stepContribution;
    }
    progressRatio = Math.min(1, Math.max(0, progressRatio));

    // Calculate total items and throughput
    const totalItemsProcessed = allProgress.reduce((sum, p) => sum + p.inputCount, 0);
    const averageThroughput = elapsedMs > 0 ? (totalItemsProcessed / elapsedMs) * 1000 : 0;

    // Estimate remaining time
    let estimatedRemainingMs = 0;
    if (!this.pipelineCompletedAt && averageThroughput > 0 && progressRatio > 0) {
      const estimatedTotalTime = elapsedMs / progressRatio;
      estimatedRemainingMs = Math.max(0, estimatedTotalTime - elapsedMs);
    }

    const totalErrors = allProgress.reduce((sum, p) => sum + p.errorCount, 0);

    return {
      totalSteps,
      completedSteps,
      currentStepIndex,
      currentStepName,
      progressRatio,
      estimatedRemainingMs,
      elapsedMs,
      totalItemsProcessed,
      averageThroughput,
      startedAt,
      completedAt: this.pipelineCompletedAt,
      isComplete: this.pipelineCompletedAt !== undefined,
      hasFailed: this.hasFailed,
      totalErrors,
    };
  }

  // ============ Events ============

  /**
   * Subscribe to progress events.
   * @returns Unsubscribe function
   */
  subscribe(listener: ProgressListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ============ Summary ============

  /**
   * Generate a summary of the pipeline execution.
   */
  generateSummary(): string {
    const overall = this.getOverallProgress();
    const steps = this.getAllStepProgress();

    const lines: string[] = [];
    lines.push("");
    lines.push("Pipeline Summary");
    lines.push("================");
    lines.push("");

    // Overall stats
    const statusIcon = overall.hasFailed ? "FAILED" : overall.isComplete ? "COMPLETED" : "IN PROGRESS";
    lines.push(`Status: ${statusIcon}`);
    lines.push(`Duration: ${formatDuration(overall.elapsedMs)}`);
    lines.push(`Steps: ${overall.completedSteps}/${overall.totalSteps}`);
    lines.push(`Items Processed: ${formatNumber(overall.totalItemsProcessed)}`);
    lines.push(`Average Throughput: ${formatRate(overall.averageThroughput)}`);

    if (overall.totalErrors > 0) {
      lines.push(`Errors: ${overall.totalErrors}`);
    }

    lines.push("");
    lines.push("Steps:");
    lines.push("------");

    // Per-step stats
    for (const step of steps) {
      const statusChar = getStatusChar(step.status);
      const duration = formatDuration(step.durationMs);
      const expansionStr =
        step.expansionRatio !== 1 ? ` (${step.expansionRatio > 1 ? "+" : ""}${step.expansionRatio.toFixed(2)}x)` : "";

      lines.push(`  ${statusChar} ${step.name}`);
      lines.push(
        `      ${formatNumber(step.inputCount)} in -> ${formatNumber(step.outputCount)} out${expansionStr}  [${duration}]`,
      );

      if (step.inputRate > 0 || step.outputRate > 0) {
        lines.push(`      Rate: ${formatRate(step.inputRate)} in, ${formatRate(step.outputRate)} out`);
      }

      if (step.errorCount > 0) {
        lines.push(`      Errors: ${step.errorCount}${step.lastError ? ` (${step.lastError})` : ""}`);
      }
    }

    lines.push("");

    return lines.join("\n");
  }
}

// ============ Formatting Helpers ============

/**
 * Get status character for display.
 */
function getStatusChar(status: StepStatus): string {
  switch (status) {
    case "pending":
      return "o";
    case "running":
      return ">";
    case "completed":
      return "*";
    case "failed":
      return "!";
    default:
      return "?";
  }
}

/**
 * Format a duration in milliseconds to a human-readable string.
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms.toFixed(0)}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}m ${seconds}s`;
}

/**
 * Format a rate (items/sec) to a human-readable string.
 */
function formatRate(rate: number): string {
  if (rate < 1) {
    return `${(rate * 60).toFixed(1)}/min`;
  }
  if (rate < 1000) {
    return `${rate.toFixed(1)}/s`;
  }
  return `${(rate / 1000).toFixed(1)}K/s`;
}

/**
 * Format a large number with K/M suffixes.
 */
function formatNumber(n: number): string {
  if (n < 1000) {
    return n.toString();
  }
  if (n < 1000000) {
    return `${(n / 1000).toFixed(1)}K`;
  }
  return `${(n / 1000000).toFixed(1)}M`;
}

/**
 * Create a new progress tracker with the given options.
 */
export function createProgressTracker(options?: ProgressOptions): ProgressTracker {
  return new ProgressTracker(options);
}
