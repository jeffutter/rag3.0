/**
 * ANSI terminal formatting utilities for progress display.
 *
 * This module provides:
 * - ANSI escape codes for colors and cursor control
 * - Progress bar rendering
 * - Time and rate formatting
 * - Terminal width detection
 *
 * @module progress/formatting
 */

/**
 * ANSI escape codes for terminal colors and styles.
 */
export const ansi = {
  // Cursor control
  cursorUp: (n = 1) => `\x1b[${n}A`,
  cursorDown: (n = 1) => `\x1b[${n}B`,
  cursorForward: (n = 1) => `\x1b[${n}C`,
  cursorBack: (n = 1) => `\x1b[${n}D`,
  cursorTo: (x: number, y?: number) => (y === undefined ? `\x1b[${x}G` : `\x1b[${y};${x}H`),
  cursorSave: "\x1b[s",
  cursorRestore: "\x1b[u",
  cursorHide: "\x1b[?25l",
  cursorShow: "\x1b[?25h",

  // Line control
  clearLine: "\x1b[2K",
  clearLineEnd: "\x1b[0K",
  clearLineStart: "\x1b[1K",
  clearScreen: "\x1b[2J",
  clearDown: "\x1b[0J",

  // Colors
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",

  // Foreground colors
  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",

  // Bright foreground colors
  brightRed: "\x1b[91m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightBlue: "\x1b[94m",
  brightMagenta: "\x1b[95m",
  brightCyan: "\x1b[96m",
  brightWhite: "\x1b[97m",

  // Background colors
  bgBlack: "\x1b[40m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
  bgMagenta: "\x1b[45m",
  bgCyan: "\x1b[46m",
  bgWhite: "\x1b[47m",
} as const;

/**
 * Status colors for different step states.
 */
export const statusColors = {
  pending: ansi.gray,
  running: ansi.yellow,
  completed: ansi.green,
  failed: ansi.red,
} as const;

/**
 * Status icons for different step states.
 */
export const statusIcons = {
  pending: "o",
  running: ">",
  completed: "*",
  failed: "!",
} as const;

/**
 * Progress bar characters.
 */
export const barChars = {
  filled: "#",
  partial: ">",
  empty: "-",
  leftCap: "[",
  rightCap: "]",
} as const;

/**
 * Spinner frames for animated display.
 */
export const spinnerFrames = ["|", "/", "-", "\\"] as const;

/**
 * Get current spinner frame based on time.
 */
export function getSpinnerFrame(intervalMs = 100): string {
  const frameIndex = Math.floor(Date.now() / intervalMs) % spinnerFrames.length;
  return spinnerFrames[frameIndex] ?? "⠋";
}

/**
 * Render a progress bar.
 *
 * @param ratio - Progress ratio from 0 to 1
 * @param width - Total width of the bar (including caps)
 * @param showPercentage - Whether to append percentage
 * @returns Formatted progress bar string
 *
 * @example
 * ```typescript
 * renderBar(0.5, 20); // "[#######>------]"
 * renderBar(0.75, 20, true); // "[###########>---] 75%"
 * ```
 */
export function renderBar(ratio: number, width = 20, showPercentage = false): string {
  const clampedRatio = Math.max(0, Math.min(1, ratio));
  const innerWidth = width - 2; // Account for caps

  const filledCount = Math.floor(clampedRatio * innerWidth);
  const hasPartial = clampedRatio * innerWidth > filledCount && filledCount < innerWidth;

  const filled = barChars.filled.repeat(filledCount);
  const partial = hasPartial ? barChars.partial : "";
  const empty = barChars.empty.repeat(innerWidth - filledCount - (hasPartial ? 1 : 0));

  const bar = `${barChars.leftCap}${filled}${partial}${empty}${barChars.rightCap}`;

  if (showPercentage) {
    const percentage = Math.round(clampedRatio * 100);
    return `${bar} ${percentage}%`;
  }

  return bar;
}

/**
 * Render a colored progress bar.
 *
 * @param ratio - Progress ratio from 0 to 1
 * @param width - Total width of the bar (including caps)
 * @param showPercentage - Whether to append percentage
 * @returns Formatted progress bar string with ANSI colors
 */
export function renderColoredBar(ratio: number, width = 20, showPercentage = false): string {
  const clampedRatio = Math.max(0, Math.min(1, ratio));
  const innerWidth = width - 2;

  const filledCount = Math.floor(clampedRatio * innerWidth);
  const hasPartial = clampedRatio * innerWidth > filledCount && filledCount < innerWidth;

  const filled = barChars.filled.repeat(filledCount);
  const partial = hasPartial ? barChars.partial : "";
  const empty = barChars.empty.repeat(innerWidth - filledCount - (hasPartial ? 1 : 0));

  // Color the bar based on progress
  const color = clampedRatio >= 1 ? ansi.green : clampedRatio >= 0.5 ? ansi.yellow : ansi.cyan;

  const bar = `${ansi.dim}${barChars.leftCap}${ansi.reset}${color}${filled}${partial}${ansi.reset}${ansi.dim}${empty}${barChars.rightCap}${ansi.reset}`;

  if (showPercentage) {
    const percentage = Math.round(clampedRatio * 100);
    return `${bar} ${ansi.bold}${percentage}%${ansi.reset}`;
  }

  return bar;
}

/**
 * Format a duration in milliseconds to a human-readable string.
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted duration string
 *
 * @example
 * ```typescript
 * formatDuration(500); // "500ms"
 * formatDuration(2500); // "2.5s"
 * formatDuration(90000); // "1m 30s"
 * ```
 */
export function formatDuration(ms: number): string {
  if (ms < 0) return "0ms";

  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }

  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }

  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);

  if (minutes < 60) {
    return `${minutes}m ${seconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

/**
 * Format a rate (items/sec) to a human-readable string.
 *
 * @param rate - Rate in items per second
 * @returns Formatted rate string
 *
 * @example
 * ```typescript
 * formatRate(0.5); // "30.0/min"
 * formatRate(50); // "50.0/s"
 * formatRate(2500); // "2.5K/s"
 * ```
 */
export function formatRate(rate: number): string {
  if (rate <= 0) return "0/s";

  if (rate < 1) {
    return `${(rate * 60).toFixed(1)}/min`;
  }

  if (rate < 1000) {
    return `${rate.toFixed(1)}/s`;
  }

  if (rate < 1000000) {
    return `${(rate / 1000).toFixed(1)}K/s`;
  }

  return `${(rate / 1000000).toFixed(1)}M/s`;
}

/**
 * Format a large number with K/M/B suffixes.
 *
 * @param n - Number to format
 * @param decimals - Number of decimal places
 * @returns Formatted number string
 *
 * @example
 * ```typescript
 * formatNumber(500); // "500"
 * formatNumber(2500); // "2.5K"
 * formatNumber(1500000); // "1.5M"
 * ```
 */
export function formatNumber(n: number, decimals = 1): string {
  if (n < 0) return `-${formatNumber(-n, decimals)}`;

  if (n < 1000) {
    return n.toString();
  }

  if (n < 1000000) {
    return `${(n / 1000).toFixed(decimals)}K`;
  }

  if (n < 1000000000) {
    return `${(n / 1000000).toFixed(decimals)}M`;
  }

  return `${(n / 1000000000).toFixed(decimals)}B`;
}

/**
 * Format ETA (estimated time of arrival).
 *
 * @param ms - Remaining time in milliseconds
 * @returns Formatted ETA string
 */
export function formatETA(ms: number): string {
  if (ms <= 0) return "done";
  if (ms === Number.POSITIVE_INFINITY || Number.isNaN(ms)) return "calculating...";

  return `ETA ${formatDuration(ms)}`;
}

/**
 * Truncate a string to fit within a width, adding ellipsis if needed.
 *
 * @param str - String to truncate
 * @param maxWidth - Maximum width
 * @param ellipsis - Ellipsis characters to use
 * @returns Truncated string
 */
export function truncate(str: string, maxWidth: number, ellipsis = "..."): string {
  if (str.length <= maxWidth) return str;
  if (maxWidth <= ellipsis.length) return ellipsis.slice(0, maxWidth);
  return str.slice(0, maxWidth - ellipsis.length) + ellipsis;
}

/**
 * Pad a string to a fixed width (left-aligned).
 *
 * @param str - String to pad
 * @param width - Target width
 * @param char - Padding character
 * @returns Padded string
 */
export function padRight(str: string, width: number, char = " "): string {
  if (str.length >= width) return str;
  return str + char.repeat(width - str.length);
}

/**
 * Pad a string to a fixed width (right-aligned).
 *
 * @param str - String to pad
 * @param width - Target width
 * @param char - Padding character
 * @returns Padded string
 */
export function padLeft(str: string, width: number, char = " "): string {
  if (str.length >= width) return str;
  return char.repeat(width - str.length) + str;
}

/**
 * Get terminal width, with fallback.
 *
 * @param fallback - Fallback width if detection fails
 * @returns Terminal width in columns
 */
export function getTerminalWidth(fallback = 80): number {
  try {
    return process.stdout.columns || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Strip ANSI escape codes from a string.
 *
 * @param str - String with ANSI codes
 * @returns String without ANSI codes
 */
export function stripAnsi(str: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Intentional - stripping ANSI codes
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Get the visible length of a string (excluding ANSI codes).
 *
 * @param str - String to measure
 * @returns Visible character count
 */
export function visibleLength(str: string): number {
  return stripAnsi(str).length;
}
