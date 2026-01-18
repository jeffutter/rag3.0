/**
 * Custom log formatters for compact, readable output.
 *
 * Three formats available:
 * - compact: Single line with all info, good for multi-component systems
 * - hybrid: Event name on first line, details indented below (2 lines per log)
 * - minimal: Ultra-compact with minimal metadata
 */

export type LogFormat = "compact" | "hybrid" | "minimal";

interface LogObject {
  level: number;
  time: number | string;
  msg?: string;
  component?: string;
  event?: string;
  [key: string]: unknown;
}

// ANSI color codes
const colors = {
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  red: "\x1b[31m",
  reset: "\x1b[0m",
};

const levelNames: Record<number, string> = {
  10: "TRACE",
  20: "DEBUG",
  30: "INFO",
  40: "WARN",
  50: "ERROR",
  60: "FATAL",
};

// Reserved for future use - will be used for level-specific coloring
const _levelColors: Record<number, string> = {
  10: colors.dim,
  20: colors.blue,
  30: colors.green,
  40: colors.yellow,
  50: colors.red,
  60: colors.red,
};

function formatTime(time: number | string): string {
  const date = typeof time === "number" ? new Date(time) : new Date(time);
  return date.toISOString().substring(11, 23); // HH:MM:SS.mmm
}

function formatTimeMinimal(time: number | string): string {
  const date = typeof time === "number" ? new Date(time) : new Date(time);
  return date.toISOString().substring(14, 23); // SS.mmm
}

function formatValue(value: unknown): string {
  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Format log in compact single-line style.
 * Format: [dim]TIME LEVEL [component][/dim] [cyan]event[/cyan] [yellow]key[/yellow]=[green]value[/green] ...
 */
export function formatCompact(log: LogObject): string {
  const time = formatTime(log.time);
  const level = levelNames[log.level] || "UNKNOWN";
  const component = log.component || "app";

  // Extract standard fields
  const { level: _, time: __, msg: _msg, component: _c, event, ...data } = log;

  // Build key=value pairs
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    pairs.push(`${colors.yellow}${key}${colors.reset}=${colors.green}${formatValue(value)}${colors.reset}`);
  }

  const eventStr = event ? `${colors.cyan}${event}${colors.reset}` : "";
  const details = pairs.length > 0 ? ` ${pairs.join(" ")}` : "";

  return `${colors.dim}${time} ${level.padEnd(5)} [${component}]${colors.reset} ${eventStr}${details}`;
}

/**
 * Format log in hybrid style (event on first line, details below).
 * Line 1: [dim]TIME LEVEL [component][/dim] [cyan]event[/cyan]
 * Line 2:   [yellow]key[/yellow]=[green]value[/green] ...
 */
export function formatHybrid(log: LogObject): string {
  const time = formatTime(log.time);
  const level = levelNames[log.level] || "UNKNOWN";
  const component = log.component || "app";

  // Extract standard fields
  const { level: _, time: __, msg: _msg, component: _c, event, ...data } = log;

  const eventStr = event || _msg || "";
  const firstLine = `${colors.dim}${time} ${level.padEnd(5)} [${component}]${colors.reset} ${colors.cyan}${eventStr}${colors.reset}`;

  // Build key=value pairs for second line
  if (Object.keys(data).length === 0) {
    return firstLine;
  }

  const pairs: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    pairs.push(`${colors.yellow}${key}${colors.reset}=${colors.green}${formatValue(value)}${colors.reset}`);
  }

  const secondLine = `  ${pairs.join(" ")}`;

  return `${firstLine}\n${secondLine}`;
}

/**
 * Format log in minimal style (ultra-compact).
 * Format: [dim]SS.mmm[/dim] [cyan]event[/cyan] [yellow]key[/yellow]=[green]value[/green] ...
 */
export function formatMinimal(log: LogObject): string {
  const time = formatTimeMinimal(log.time);

  // Extract standard fields
  const { level: _, time: __, msg: _msg, component: _c, event, ...data } = log;

  // Build key=value pairs
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    pairs.push(`${colors.yellow}${key}${colors.reset}=${colors.green}${formatValue(value)}${colors.reset}`);
  }

  const eventStr = event ? `${colors.cyan}${event}${colors.reset}` : "";
  const details = pairs.length > 0 ? ` ${pairs.join(" ")}` : "";

  return `${colors.dim}${time}${colors.reset} ${eventStr}${details}`;
}

/**
 * Get the appropriate formatter based on format type.
 */
export function getFormatter(format: LogFormat): (log: LogObject) => string {
  switch (format) {
    case "compact":
      return formatCompact;
    case "hybrid":
      return formatHybrid;
    case "minimal":
      return formatMinimal;
    default:
      return formatCompact;
  }
}

// Pino log levels (same as defined in pino)
const pinoLevels: Record<string, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: Number.POSITIVE_INFINITY,
};

/**
 * Create a Pino write stream that formats logs using custom formatters.
 * Respects the LOG_LEVEL environment variable to suppress logs during tests.
 */
export function createFormatterStream(format: LogFormat) {
  const formatter = getFormatter(format);

  return {
    write(chunk: string) {
      try {
        const log = JSON.parse(chunk) as LogObject;

        // Check if we should suppress this log based on LOG_LEVEL
        const configuredLevel = process.env.LOG_LEVEL || "info";
        const configuredLevelNum = pinoLevels[configuredLevel] ?? 30;

        // If the log level is below our threshold, don't output
        if (log.level < configuredLevelNum) {
          return;
        }

        // If level is silent, suppress all logs
        if (configuredLevel === "silent") {
          return;
        }

        const formatted = formatter(log);
        process.stdout.write(`${formatted}\n`);
      } catch {
        // If parsing fails, just write the raw chunk
        process.stdout.write(chunk);
      }
    },
  };
}
