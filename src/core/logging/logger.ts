import pino from "pino";
import { createFormatterStream, type LogFormat } from "./formatter.js";
import { getSanitizeOptionsFromEnv, sanitizeForLogging } from "./sanitizer.js";

/**
 * Structured logging with Pino.
 *
 * Design decisions:
 * - JSON output by default for machine parsing
 * - OpenTelemetry-compatible fields (traceId, spanId)
 * - Minimal overhead in production
 * - Compact, readable formats for development (via LOG_FORMAT)
 * - Smart truncation of large objects/arrays for readability
 */

const isDev = process.env.NODE_ENV !== "production";
const sanitizeEnabled = process.env.LOG_SANITIZE !== "false";
const sanitizeOptions = getSanitizeOptionsFromEnv();
const logFormat = (process.env.LOG_FORMAT || "compact") as LogFormat | "pretty";

// Base logger configuration
const baseConfig = {
  level: process.env.LOG_LEVEL || "info",

  // Use standard OpenTelemetry field names for future compatibility
  messageKey: "msg",
  timestamp: pino.stdTimeFunctions.isoTime,

  // Add service metadata (only in production JSON logs)
  base: isDev
    ? null
    : {
        service: "llm-orchestrator",
        version: process.env.npm_package_version || "0.0.0",
        pid: process.pid,
      },

  // Custom serializers for common objects
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },

  // Custom formatters for log sanitization
  formatters: {
    log(obj: Record<string, unknown>) {
      if (!sanitizeEnabled) return obj;
      return sanitizeForLogging(obj, sanitizeOptions) as Record<string, unknown>;
    },
  },
};

// Create logger with appropriate output format
const baseLogger = isDev
  ? logFormat === "pretty"
    ? // Use pino-pretty for traditional multi-line format
      pino({
        ...baseConfig,
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss.l",
            ignore: "pid,hostname",
          },
        },
      })
    : // Use custom formatter for compact/hybrid/minimal formats
      pino(baseConfig, createFormatterStream(logFormat as LogFormat))
  : // Production: JSON output
    pino(baseConfig);

// Type-safe child logger factory
export interface LogContext {
  traceId?: string;
  spanId?: string;
  userId?: string;
  [key: string]: unknown;
}

export type Logger = pino.Logger<never>;

export function createLogger(component: string, context?: LogContext): Logger {
  return baseLogger.child({
    component,
    ...context,
  });
}

// Re-export for convenience
export { baseLogger as logger };

// Utility for adding trace context
export function withTraceContext(logger: Logger, traceId: string, spanId?: string): Logger {
  return logger.child({ traceId, spanId });
}
