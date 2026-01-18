/**
 * Pipeline progress tracking module.
 *
 * This module provides a graphical progress indicator for streaming pipelines
 * with support for:
 * - Step-level progress tracking (items processed/yielded, timing, expansion ratios)
 * - Overall pipeline progress aggregation
 * - Terminal rendering with compact and verbose modes
 * - Event-based updates for reactive UI
 *
 * @example
 * ```typescript
 * import { createProgressTracker, createProgressRenderer } from './progress';
 *
 * // Create tracker and renderer
 * const tracker = createProgressTracker({ mode: 'verbose' });
 * const renderer = createProgressRenderer(tracker);
 *
 * // Start rendering
 * renderer.start();
 *
 * // Use with pipeline
 * const pipeline = StreamingPipeline.start<number>()
 *   .map('doubled', n => n * 2)
 *   .withProgress(tracker);
 *
 * for await (const item of pipeline.execute(input)) {
 *   // Progress is automatically tracked and rendered
 * }
 *
 * // Stop rendering and show summary
 * renderer.stop();
 * console.log(tracker.generateSummary());
 * ```
 *
 * @module progress
 */

// Formatting utilities
export {
  ansi,
  barChars,
  formatDuration,
  formatETA,
  formatNumber,
  formatRate,
  getSpinnerFrame,
  getTerminalWidth,
  padLeft,
  padRight,
  renderBar,
  renderColoredBar,
  spinnerFrames,
  statusColors,
  statusIcons,
  stripAnsi,
  truncate,
  visibleLength,
} from "./formatting";
export type { RendererOptions } from "./renderer";

// Renderer
export { createProgressRenderer, ProgressRenderer } from "./renderer";
// Tracker
export { createProgressTracker, ProgressTracker } from "./tracker";
// Types
export type {
  IProgressTracker,
  OverallProgress,
  ProgressEvent,
  ProgressEventType,
  ProgressListener,
  ProgressMode,
  ProgressOptions,
  StepMetrics,
  StepProgress,
  StepStatus,
  TimingWindow,
} from "./types";
