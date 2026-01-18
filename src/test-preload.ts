/**
 * Test preload script - runs before each test file.
 * Suppresses logging output during tests to reduce noise.
 *
 * Environment variables:
 * - LOG_LEVEL: Set to override logger level (default: "silent" in tests)
 * - TEST_VERBOSE: Set to "1" to see all console output
 */

// Mark that we're in a test environment
(globalThis as { __BUN_TEST__?: boolean }).__BUN_TEST__ = true;

// Set env var for any modules that haven't loaded yet
// Unconditionally set to "silent" unless TEST_VERBOSE is enabled
// This overrides any LOG_LEVEL from .env or .envrc files
if (process.env.TEST_VERBOSE !== "1") {
  process.env.LOG_LEVEL = "silent";
}

// For modules already loaded, we need to silence them directly.
// Import and silence the logger synchronously.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import { logger } from "./core/logging/logger.js";

if (process.env.TEST_VERBOSE !== "1") {
  logger.level = "silent";
}

// Optionally suppress console output too
if (process.env.TEST_VERBOSE !== "1") {
  const noop = () => {};
  const originalConsole = {
    log: console.log,
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    table: console.table,
    // Keep console.error visible - often important for debugging failures
  };

  console.log = noop;
  console.debug = noop;
  console.info = noop;
  console.warn = noop;
  console.table = noop;

  // Expose original console for tests that explicitly need it
  (globalThis as unknown as { __originalConsole: typeof originalConsole }).__originalConsole = originalConsole;
}
