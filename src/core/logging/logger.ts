import pino from "pino";

/**
 * Structured logging with Pino.
 *
 * Design decisions:
 * - JSON output by default for machine parsing
 * - OpenTelemetry-compatible fields (traceId, spanId)
 * - Minimal overhead in production
 * - Pretty printing available for development
 */

const isDev = process.env.NODE_ENV !== "production";

// Base logger configuration
const baseConfig = {
  level: process.env.LOG_LEVEL || "info",

  // Use standard OpenTelemetry field names for future compatibility
  messageKey: "msg",
  timestamp: () => `,"time":"${new Date().toISOString()}"`,

  // Add service metadata
  base: {
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
} as const;

const baseLogger = isDev
  ? pino({
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
  : pino(baseConfig);

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
