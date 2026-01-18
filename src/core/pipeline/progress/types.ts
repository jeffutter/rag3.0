/**
 * Type definitions for pipeline progress tracking.
 *
 * This module defines the interfaces and types for tracking progress across
 * streaming pipeline execution, including:
 * - Step-level progress metrics (items processed/yielded, timing, expansion ratios)
 * - Overall pipeline progress aggregation
 * - Progress events for reactive rendering
 * - Configuration options
 *
 * @module progress/types
 */

/**
 * Progress tracking options for configuring the progress tracker.
 */
export interface ProgressOptions {
  /** Enable progress tracking (default: true) */
  enabled?: boolean;

  /** Display mode for progress output */
  mode?: ProgressMode;

  /** Update interval in milliseconds (default: 200) */
  updateIntervalMs?: number;

  /** Sampling rate for large streams (1 = track all, 10 = track every 10th item) */
  samplingRate?: number;

  /** Show timing information (default: true) */
  showTimings?: boolean;

  /** Output stream for rendering (default: process.stderr) */
  output?: NodeJS.WritableStream;
}

/**
 * Display mode for progress output.
 */
export type ProgressMode = "compact" | "verbose" | "silent";

/**
 * Status of a pipeline step.
 */
export type StepStatus = "pending" | "running" | "completed" | "failed";

/**
 * Progress metrics for an individual pipeline step.
 */
export interface StepProgress {
  /** Step name/key */
  name: string;

  /** Step index in the pipeline (0-based) */
  index: number;

  /** Current status of the step */
  status: StepStatus;

  /** Number of items received as input */
  inputCount: number;

  /** Number of items yielded as output */
  outputCount: number;

  /** Expansion ratio (output/input) for flatMap operations */
  expansionRatio: number;

  /** Items processed per second (input rate) */
  inputRate: number;

  /** Items yielded per second (output rate) */
  outputRate: number;

  /** Number of items currently being processed (for parallel ops) */
  inFlightCount: number;

  /** Concurrency limit (for parallel ops) */
  concurrencyLimit: number;

  /** Start time of the step (ms since epoch) */
  startedAt?: number | undefined;

  /** End time of the step (ms since epoch) */
  completedAt?: number | undefined;

  /** Duration in milliseconds */
  durationMs: number;

  /** Number of errors encountered */
  errorCount: number;

  /** Last error message if any */
  lastError?: string | undefined;
}

/**
 * Overall pipeline progress aggregation.
 */
export interface OverallProgress {
  /** Total number of steps in the pipeline */
  totalSteps: number;

  /** Number of completed steps */
  completedSteps: number;

  /** Index of the currently active step (0-based) */
  currentStepIndex: number;

  /** Name of the currently active step */
  currentStepName: string;

  /** Overall progress ratio (0.0 to 1.0) */
  progressRatio: number;

  /** Estimated time remaining in milliseconds */
  estimatedRemainingMs: number;

  /** Total elapsed time in milliseconds */
  elapsedMs: number;

  /** Total items processed across all steps */
  totalItemsProcessed: number;

  /** Average throughput (items/sec) across the pipeline */
  averageThroughput: number;

  /** Pipeline start time (ms since epoch) */
  startedAt: number;

  /** Pipeline end time (ms since epoch, if completed) */
  completedAt?: number | undefined;

  /** Whether the pipeline has completed */
  isComplete: boolean;

  /** Whether the pipeline has failed */
  hasFailed: boolean;

  /** Total number of errors */
  totalErrors: number;
}

/**
 * Progress event types for reactive updates.
 */
export type ProgressEventType =
  | "pipeline:start"
  | "pipeline:complete"
  | "pipeline:error"
  | "step:start"
  | "step:progress"
  | "step:complete"
  | "step:error"
  | "item:processed"
  | "item:yielded";

/**
 * Progress event payload.
 */
export interface ProgressEvent {
  /** Event type */
  type: ProgressEventType;

  /** Timestamp of the event (ms since epoch) */
  timestamp: number;

  /** Step name (if applicable) */
  stepName?: string;

  /** Step index (if applicable) */
  stepIndex?: number;

  /** Item count (if applicable) */
  itemCount?: number;

  /** Error (if applicable) */
  error?: Error;

  /** Current step progress snapshot */
  stepProgress?: StepProgress;

  /** Overall progress snapshot */
  overallProgress?: OverallProgress;
}

/**
 * Progress event listener function.
 */
export type ProgressListener = (event: ProgressEvent) => void;

/**
 * Interface for the progress tracker.
 */
export interface IProgressTracker {
  // Lifecycle methods
  pipelineStarted(stepNames: string[]): void;
  pipelineCompleted(): void;
  pipelineError(error: Error): void;

  // Step lifecycle
  stepStarted(stepName: string, index: number): void;
  stepCompleted(stepName: string): void;
  stepError(stepName: string, error: Error): void;

  // Item tracking
  recordItemProcessed(stepName: string, count?: number): void;
  recordItemYielded(stepName: string, count?: number): void;

  // Parallel tracking
  recordInFlight(stepName: string, count: number, limit: number): void;

  // Queries
  getStepProgress(stepName: string): StepProgress | undefined;
  getOverallProgress(): OverallProgress;
  getAllStepProgress(): StepProgress[];

  // Events
  subscribe(listener: ProgressListener): () => void;

  // Summary
  generateSummary(): string;
}

/**
 * Internal timing window for calculating rates.
 */
export interface TimingWindow {
  /** Start of the window (ms since epoch) */
  startTime: number;

  /** Item count at window start */
  startCount: number;

  /** Current item count */
  currentCount: number;

  /** Calculated rate (items/sec) */
  rate: number;
}

/**
 * Internal step metrics storage.
 */
export interface StepMetrics {
  /** Step name */
  name: string;

  /** Step index */
  index: number;

  /** Current status */
  status: StepStatus;

  /** Input item count */
  inputCount: number;

  /** Output item count */
  outputCount: number;

  /** In-flight count (for parallel ops) */
  inFlightCount: number;

  /** Concurrency limit (for parallel ops) */
  concurrencyLimit: number;

  /** Start time */
  startedAt?: number;

  /** End time */
  completedAt?: number;

  /** Error count */
  errorCount: number;

  /** Last error */
  lastError?: string;

  /** Input rate window */
  inputWindow: TimingWindow;

  /** Output rate window */
  outputWindow: TimingWindow;
}
