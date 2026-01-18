/**
 * Terminal renderer for pipeline progress display.
 *
 * This module provides a reactive renderer that displays pipeline progress
 * in the terminal with support for:
 * - Compact single-line mode
 * - Verbose multi-line mode with step details
 * - Silent mode (no output, just tracking)
 * - Automatic refresh on progress updates
 * - Clean terminal output with proper line clearing
 *
 * @module progress/renderer
 */

import {
  ansi,
  formatDuration,
  formatETA,
  formatNumber,
  formatRate,
  getTerminalWidth,
  padRight,
  renderColoredBar,
  statusColors,
  statusIcons,
  truncate,
} from "./formatting";
import type { ProgressTracker } from "./tracker";
import type { OverallProgress, ProgressEvent, ProgressMode, StepProgress } from "./types";

/**
 * Options for the progress renderer.
 */
export interface RendererOptions {
  /** Display mode */
  mode?: ProgressMode;

  /** Output stream (default: process.stderr) */
  output?: NodeJS.WritableStream;

  /** Update interval in milliseconds (default: 200) */
  updateIntervalMs?: number;

  /** Width of the progress bar (default: 20) */
  barWidth?: number;

  /** Maximum step name width (default: 20) */
  maxStepNameWidth?: number;

  /** Show ETA (default: true) */
  showETA?: boolean;

  /** Show throughput (default: true) */
  showThroughput?: boolean;

  /** Show step details in compact mode (default: false) */
  showStepDetailsInCompact?: boolean;
}

/**
 * Default renderer options.
 */
const DEFAULT_OPTIONS: Required<RendererOptions> = {
  mode: "compact",
  output: process.stderr,
  updateIntervalMs: 200,
  barWidth: 20,
  maxStepNameWidth: 20,
  showETA: true,
  showThroughput: true,
  showStepDetailsInCompact: false,
};

/**
 * Progress renderer for terminal display.
 *
 * Subscribes to a ProgressTracker and renders updates to the terminal.
 * Handles cursor positioning and line clearing for smooth updates.
 */
export class ProgressRenderer {
  private options: Required<RendererOptions>;
  private tracker: ProgressTracker;
  private unsubscribe: (() => void) | undefined = undefined;
  private updateTimer: ReturnType<typeof setInterval> | undefined = undefined;
  private lastRenderTime = 0;
  private renderedLineCount = 0;
  private isRendering = false;
  private isTTY: boolean;

  constructor(tracker: ProgressTracker, options: RendererOptions = {}) {
    this.tracker = tracker;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.isTTY = this.checkTTY();
  }

  /**
   * Check if output is a TTY (supports cursor control).
   */
  private checkTTY(): boolean {
    const output = this.options.output;
    if ("isTTY" in output) {
      return (output as NodeJS.WriteStream).isTTY === true;
    }
    return false;
  }

  /**
   * Write text to the output stream.
   */
  private write(text: string): void {
    this.options.output.write(text);
  }

  /**
   * Clear previously rendered lines.
   */
  private clearPreviousRender(): void {
    if (!this.isTTY || this.renderedLineCount === 0) return;

    // Move cursor up and clear each line
    for (let i = 0; i < this.renderedLineCount; i++) {
      this.write(ansi.cursorUp(1) + ansi.clearLine);
    }
  }

  /**
   * Start rendering progress updates.
   */
  start(): void {
    if (this.options.mode === "silent") return;

    // Subscribe to progress events
    this.unsubscribe = this.tracker.subscribe((event) => {
      this.handleEvent(event);
    });

    // Set up periodic refresh for smooth animation
    if (this.isTTY) {
      this.updateTimer = setInterval(() => {
        this.render();
      }, this.options.updateIntervalMs);
    }

    // Hide cursor during rendering
    if (this.isTTY) {
      this.write(ansi.cursorHide);
    }
  }

  /**
   * Stop rendering and clean up.
   */
  stop(): void {
    // Unsubscribe from events
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }

    // Clear update timer
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = undefined;
    }

    // Show cursor
    if (this.isTTY) {
      this.write(ansi.cursorShow);
    }

    // Final render
    this.render(true);
  }

  /**
   * Handle a progress event.
   */
  private handleEvent(event: ProgressEvent): void {
    // Throttle rendering to avoid excessive updates
    const now = Date.now();
    if (now - this.lastRenderTime < this.options.updateIntervalMs) {
      return;
    }

    // Render on significant events
    if (
      event.type === "pipeline:start" ||
      event.type === "pipeline:complete" ||
      event.type === "pipeline:error" ||
      event.type === "step:start" ||
      event.type === "step:complete" ||
      event.type === "step:error"
    ) {
      this.render();
    }
  }

  /**
   * Render the current progress state.
   */
  render(final = false): void {
    if (this.options.mode === "silent") return;
    if (this.isRendering) return;

    this.isRendering = true;
    this.lastRenderTime = Date.now();

    try {
      const overall = this.tracker.getOverallProgress();
      const steps = this.tracker.getAllStepProgress();

      // Clear previous output
      this.clearPreviousRender();

      // Render based on mode
      let lines: string[];
      if (this.options.mode === "verbose") {
        lines = this.renderVerbose(overall, steps);
      } else {
        lines = this.renderCompact(overall, steps);
      }

      // Write new output
      for (const line of lines) {
        this.write(`${line}\n`);
      }

      this.renderedLineCount = lines.length;

      // On final render, add newline and summary
      if (final && overall.isComplete) {
        this.renderedLineCount = 0; // Don't clear the final output
        this.write("\n");
      }
    } finally {
      this.isRendering = false;
    }
  }

  /**
   * Render compact mode (single line for pipeline, optional step details).
   */
  private renderCompact(overall: OverallProgress, steps: StepProgress[]): string[] {
    const lines: string[] = [];
    const width = getTerminalWidth(80);

    // Main progress line
    const bar = renderColoredBar(overall.progressRatio, this.options.barWidth, true);
    const throughput = this.options.showThroughput ? ` ${formatRate(overall.averageThroughput)}` : "";
    const eta =
      this.options.showETA && !overall.isComplete && overall.estimatedRemainingMs > 0
        ? ` ${formatETA(overall.estimatedRemainingMs)}`
        : "";

    const status = overall.hasFailed
      ? `${ansi.red}FAILED${ansi.reset}`
      : overall.isComplete
        ? `${ansi.green}DONE${ansi.reset}`
        : `${ansi.cyan}${overall.currentStepName}${ansi.reset}`;

    const mainLine = `Pipeline: ${bar}${throughput}${eta} ${status}`;
    lines.push(truncate(mainLine, width));

    // Optionally show step details
    if (this.options.showStepDetailsInCompact) {
      for (const step of steps) {
        if (step.status === "running" || step.status === "completed") {
          const stepLine = this.renderStepLine(step, width - 2);
          lines.push(`  ${stepLine}`);
        }
      }
    }

    return lines;
  }

  /**
   * Render verbose mode (full details for all steps).
   */
  private renderVerbose(overall: OverallProgress, steps: StepProgress[]): string[] {
    const lines: string[] = [];
    const width = getTerminalWidth(80);

    // Header
    const bar = renderColoredBar(overall.progressRatio, this.options.barWidth, true);
    const elapsed = formatDuration(overall.elapsedMs);
    const throughput = this.options.showThroughput ? ` | ${formatRate(overall.averageThroughput)}` : "";
    const eta =
      this.options.showETA && !overall.isComplete && overall.estimatedRemainingMs > 0
        ? ` | ${formatETA(overall.estimatedRemainingMs)}`
        : "";

    lines.push(`Pipeline: ${bar} [${elapsed}]${throughput}${eta}`);
    lines.push("");

    // Step details
    for (const step of steps) {
      const stepLine = this.renderStepLine(step, width - 4);
      const icon = statusIcons[step.status];
      const color = statusColors[step.status];

      lines.push(`  ${color}${icon}${ansi.reset} ${stepLine}`);

      // Show additional details for running or completed steps
      if (step.status === "running" || step.status === "completed") {
        const details = this.renderStepDetails(step);
        if (details) {
          lines.push(`      ${ansi.dim}${details}${ansi.reset}`);
        }
      }
    }

    // Footer with error count if any
    if (overall.totalErrors > 0) {
      lines.push("");
      lines.push(`${ansi.red}Errors: ${overall.totalErrors}${ansi.reset}`);
    }

    return lines;
  }

  /**
   * Render a single step line.
   */
  private renderStepLine(step: StepProgress, maxWidth: number): string {
    const name = truncate(step.name, this.options.maxStepNameWidth);
    const paddedName = padRight(name, this.options.maxStepNameWidth);

    const color = statusColors[step.status];
    const counts = `${formatNumber(step.inputCount)} -> ${formatNumber(step.outputCount)}`;

    let line = `${color}${paddedName}${ansi.reset} ${counts}`;

    // Add rate for running steps
    if (step.status === "running" && step.outputRate > 0) {
      line += ` ${ansi.dim}(${formatRate(step.outputRate)})${ansi.reset}`;
    }

    // Add duration for completed steps
    if (step.status === "completed") {
      line += ` ${ansi.dim}[${formatDuration(step.durationMs)}]${ansi.reset}`;
    }

    // Add error indicator
    if (step.errorCount > 0) {
      line += ` ${ansi.red}[${step.errorCount} errors]${ansi.reset}`;
    }

    return truncate(line, maxWidth);
  }

  /**
   * Render additional details for a step.
   */
  private renderStepDetails(step: StepProgress): string {
    const parts: string[] = [];

    // Expansion ratio (only if significant)
    if (step.expansionRatio !== 1 && step.inputCount > 0) {
      const sign = step.expansionRatio > 1 ? "+" : "";
      parts.push(`${sign}${step.expansionRatio.toFixed(2)}x`);
    }

    // Parallel info
    if (step.concurrencyLimit > 1) {
      parts.push(`${step.inFlightCount}/${step.concurrencyLimit} parallel`);
    }

    // Input/output rates
    if (step.inputRate > 0) {
      parts.push(`in: ${formatRate(step.inputRate)}`);
    }
    if (step.outputRate > 0 && step.outputRate !== step.inputRate) {
      parts.push(`out: ${formatRate(step.outputRate)}`);
    }

    return parts.join(" | ");
  }
}

/**
 * Create a progress renderer attached to a tracker.
 *
 * @param tracker - The progress tracker to render
 * @param options - Renderer options
 * @returns A new ProgressRenderer instance
 *
 * @example
 * ```typescript
 * const tracker = createProgressTracker();
 * const renderer = createProgressRenderer(tracker, { mode: 'verbose' });
 *
 * renderer.start();
 * // ... run pipeline ...
 * renderer.stop();
 * ```
 */
export function createProgressRenderer(tracker: ProgressTracker, options?: RendererOptions): ProgressRenderer {
  return new ProgressRenderer(tracker, options);
}
