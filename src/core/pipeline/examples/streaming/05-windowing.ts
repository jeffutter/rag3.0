/**
 * Windowing Operations in Streaming Pipelines Example
 *
 * Demonstrates windowing and batching strategies:
 * - Fixed-size batches
 * - Sliding windows
 * - Time-based batching
 * - Custom windowing logic
 * - Use cases for different windowing strategies
 *
 * Run with: bun run src/core/pipeline/examples/streaming/05-windowing.ts
 */

import { fromArray } from "../../streaming/generators";
import { StreamingPipeline } from "../../streaming-builder";

// =============================================================================
// Example 1: Fixed-Size Batching
// =============================================================================

async function fixedSizeBatching() {
  console.log("\n=== Example 1: Fixed-Size Batching ===\n");

  const numbers = Array.from({ length: 25 }, (_, i) => i + 1);

  const pipeline = StreamingPipeline.start<number>()
    .batch("batches", 10)
    .tap("logged", (batch, index) => {
      console.log(`Batch ${index + 1}: [${batch.join(", ")}]`);
    });

  await pipeline.executeToArray(fromArray(numbers));

  console.log("\nNote: Last batch contains remaining items (5 items)");
}

// =============================================================================
// Example 2: Sliding Windows
// =============================================================================

async function slidingWindows() {
  console.log("\n=== Example 2: Sliding Windows ===\n");

  const data = Array.from({ length: 10 }, (_, i) => i + 1);

  // Tumbling windows (non-overlapping)
  console.log("Tumbling windows (size=3, slide=3):");
  const tumblingPipeline = StreamingPipeline.start<number>()
    .window("windows", 3, 3) // windowSize=3, slideSize=3
    .tap("logged", (window, index) => {
      console.log(`  Window ${index + 1}: [${window.join(", ")}]`);
    });

  await tumblingPipeline.executeToArray(fromArray(data));

  // Sliding windows (overlapping)
  console.log("\nSliding windows (size=3, slide=1):");
  const slidingPipeline = StreamingPipeline.start<number>()
    .window("windows", 3, 1) // windowSize=3, slideSize=1
    .tap("logged", (window, index) => {
      console.log(`  Window ${index + 1}: [${window.join(", ")}]`);
    });

  await slidingPipeline.executeToArray(fromArray(data));

  console.log("\nNote: Sliding windows overlap for computing moving averages, trends, etc.");
}

// =============================================================================
// Example 3: Time-Based Batching
// =============================================================================

async function timeBasedBatching() {
  console.log("\n=== Example 3: Time-Based Batching ===\n");

  // Simulate stream with variable timing
  async function* timeBasedStream() {
    for (let i = 1; i <= 20; i++) {
      yield i;
      // Variable delays to simulate real-world timing
      await Bun.sleep(50 + Math.random() * 100);
    }
  }

  console.log("Batching by time (500ms windows):\n");

  const pipeline = StreamingPipeline.start<number>()
    .bufferTime("batches", 500) // Collect items for 500ms
    .tap("logged", (batch, index) => {
      console.log(`Time batch ${index + 1}: [${batch.join(", ")}] (${batch.length} items)`);
    });

  const startTime = Date.now();

  for await (const _batch of pipeline.execute(timeBasedStream())) {
    const elapsed = Date.now() - startTime;
    console.log(`  Received at ${elapsed}ms`);
  }

  console.log("\nNote: Batches emitted at time intervals, not item count");
}

// =============================================================================
// Example 4: Time-Based with Max Size
// =============================================================================

async function timeBasedWithMaxSize() {
  console.log("\n=== Example 4: Time-Based with Max Size ===\n");

  // Fast stream that would overflow time-based batches
  async function* fastStream() {
    for (let i = 1; i <= 100; i++) {
      yield i;
      await Bun.sleep(10); // Fast items
    }
  }

  console.log("Batching: 1000ms window OR 20 items (whichever first):\n");

  const pipeline = StreamingPipeline.start<number>()
    .bufferTime("batches", 1000, 20) // 1000ms OR 20 items
    .tap("logged", (batch, index) => {
      console.log(`Batch ${index + 1}: ${batch.length} items (${batch[0]}-${batch[batch.length - 1]})`);
    });

  const startTime = Date.now();
  let batchCount = 0;

  for await (const _batch of pipeline.execute(fastStream())) {
    const elapsed = Date.now() - startTime;
    batchCount++;
    console.log(`  Emitted at ${elapsed}ms`);

    if (batchCount >= 3) {
      break; // Stop after a few batches for demo
    }
  }

  console.log("\nNote: Size limit prevents unbounded growth within time window");
}

// =============================================================================
// Example 5: Batch Processing with Aggregation
// =============================================================================

async function batchAggregation() {
  console.log("\n=== Example 5: Batch Processing with Aggregation ===\n");

  const measurements = Array.from({ length: 50 }, (_, i) => ({
    timestamp: Date.now() + i * 1000,
    value: 20 + Math.random() * 10,
    sensor: `sensor-${(i % 3) + 1}`,
  }));

  const pipeline = StreamingPipeline.start<(typeof measurements)[0]>()
    .batch("batches", 10)
    .map("aggregated", (batch) => {
      const sum = batch.reduce((acc, m) => acc + m.value, 0);
      const avg = sum / batch.length;
      const min = Math.min(...batch.map((m) => m.value));
      const max = Math.max(...batch.map((m) => m.value));

      return {
        batchSize: batch.length,
        average: avg.toFixed(2),
        min: min.toFixed(2),
        max: max.toFixed(2),
        sensors: new Set(batch.map((m) => m.sensor)).size,
      };
    })
    .tap("logged", (stats, index) => {
      console.log(`Batch ${index + 1}:`, stats);
    });

  await pipeline.executeToArray(fromArray(measurements));

  console.log("\nUse case: Aggregating sensor data in batches for analysis");
}

// =============================================================================
// Example 6: Moving Average with Sliding Windows
// =============================================================================

async function movingAverage() {
  console.log("\n=== Example 6: Moving Average (Sliding Windows) ===\n");

  const prices = [100, 102, 101, 105, 103, 107, 110, 108, 112, 115, 113, 118, 120];

  const windowSize = 5;

  const pipeline = StreamingPipeline.start<number>()
    .window("windows", windowSize, 1) // Slide by 1
    .map("movingAvg", (window) => {
      const sum = window.reduce((acc, n) => acc + n, 0);
      const avg = sum / window.length;
      const first = window[0];
      const last = window[window.length - 1];
      return {
        window: window,
        average: avg.toFixed(2),
        trend: last && first && last > first ? "↑" : "↓",
      };
    })
    .tap("logged", (result, index) => {
      console.log(`Window ${index + 1}: [${result.window.join(", ")}] → Avg: ${result.average} ${result.trend}`);
    });

  await pipeline.executeToArray(fromArray(prices));

  console.log("\nUse case: Computing moving averages for trend analysis");
}

// =============================================================================
// Example 7: Session Windows (Custom Logic)
// =============================================================================

async function sessionWindows() {
  console.log("\n=== Example 7: Session Windows (Custom Logic) ===\n");

  interface Event {
    userId: string;
    action: string;
    timestamp: number;
  }

  const events: Event[] = [
    { userId: "user1", action: "login", timestamp: 1000 },
    { userId: "user1", action: "view", timestamp: 2000 },
    { userId: "user1", action: "click", timestamp: 3000 },
    // Gap of 10 seconds - new session
    { userId: "user1", action: "login", timestamp: 13000 },
    { userId: "user1", action: "view", timestamp: 14000 },
    // Different user
    { userId: "user2", action: "login", timestamp: 1500 },
    { userId: "user2", action: "view", timestamp: 2500 },
  ];

  const sessionTimeout = 5000; // 5 seconds

  // Group events into sessions using custom logic
  const pipeline = StreamingPipeline.start<Event>().map("withSession", (event, _index) => {
    // In real implementation, would maintain session state
    // For demo, simple logic based on timestamp gaps
    const sessionId = Math.floor(event.timestamp / sessionTimeout);
    return { ...event, sessionId: `${event.userId}-${sessionId}` };
  });

  const results = await pipeline.executeToArray(fromArray(events));

  // Group by session
  const sessions = results.reduce(
    (acc, event) => {
      if (!acc[event.sessionId]) {
        acc[event.sessionId] = [];
      }
      const sessionEvents = acc[event.sessionId];
      if (sessionEvents) {
        sessionEvents.push(event);
      }
      return acc;
    },
    {} as Record<string, typeof results>,
  );

  console.log("Sessions detected:\n");
  Object.entries(sessions).forEach(([sessionId, events]) => {
    console.log(`${sessionId}:`);
    events.forEach((e) => {
      console.log(`  ${e.timestamp}ms - ${e.action}`);
    });
    console.log();
  });

  console.log("Use case: User session detection and analysis");
}

// =============================================================================
// Example 8: Batching for API Rate Limits
// =============================================================================

async function apiRateLimitBatching() {
  console.log("\n=== Example 8: Batching for API Rate Limits ===\n");

  const items = Array.from({ length: 50 }, (_, i) => `item-${i + 1}`);

  // Simulate batch API with rate limit
  async function processBatch(batch: string[]): Promise<string[]> {
    console.log(`  Calling API with batch of ${batch.length} items...`);
    await Bun.sleep(200); // API call delay
    return batch.map((item) => `processed-${item}`);
  }

  const maxBatchSize = 10; // API limit

  const pipeline = StreamingPipeline.start<string>()
    .batch("batches", maxBatchSize)
    .map("processed", async (batch) => await processBatch(batch), {
      parallel: false, // Respect rate limit - sequential
    })
    .flatMap("flattened", (batch) => batch);

  console.log("Processing with API rate limit batching:\n");

  const startTime = Date.now();
  const results = await pipeline.executeToArray(fromArray(items));
  const duration = Date.now() - startTime;

  console.log(`\nProcessed ${results.length} items in ${duration}ms`);
  console.log(`Average: ${(duration / (results.length / maxBatchSize)).toFixed(0)}ms per batch`);
}

// =============================================================================
// Example 9: Adaptive Batching Based on Load
// =============================================================================

async function adaptiveBatching() {
  console.log("\n=== Example 9: Adaptive Batching ===\n");

  const items = Array.from({ length: 100 }, (_, i) => i + 1);

  let _currentLoad = 0;

  async function processAdaptiveBatch(batch: number[]): Promise<number[]> {
    const batchSize = batch.length;
    _currentLoad = batchSize;

    const processingTime = 50 + batchSize * 10; // Larger batches take longer
    await Bun.sleep(processingTime);

    console.log(`  Processed batch of ${batchSize} in ${processingTime}ms`);

    return batch.map((n) => n * 2);
  }

  // Start with small batches, increase based on success
  const batchSizes = [5, 10, 20, 20, 10]; // Simulate adaptive sizing

  console.log("Simulating adaptive batch sizing:\n");

  let position = 0;

  for (const batchSize of batchSizes) {
    const batch = items.slice(position, position + batchSize);
    if (batch.length === 0) break;

    await processAdaptiveBatch(batch);
    position += batchSize;

    if (position >= items.length) break;
  }

  console.log("\nNote: Batch size adapts to system load and performance");
}

// =============================================================================
// Example 10: Windowing for Event Pattern Detection
// =============================================================================

async function eventPatternDetection() {
  console.log("\n=== Example 10: Event Pattern Detection ===\n");

  interface LogEvent {
    level: "INFO" | "WARN" | "ERROR";
    message: string;
    timestamp: number;
  }

  const logs: LogEvent[] = [
    { level: "INFO", message: "Service started", timestamp: 1000 },
    { level: "INFO", message: "Request received", timestamp: 2000 },
    { level: "WARN", message: "Slow query", timestamp: 3000 },
    { level: "ERROR", message: "Connection failed", timestamp: 3500 },
    { level: "ERROR", message: "Retry failed", timestamp: 4000 },
    { level: "ERROR", message: "Circuit breaker open", timestamp: 4500 },
    { level: "INFO", message: "Recovery started", timestamp: 10000 },
  ];

  const pipeline = StreamingPipeline.start<LogEvent>()
    .window("windows", 3, 1) // Look at 3-event windows
    .map("analyzed", (window) => {
      const errorCount = window.filter((e) => e.level === "ERROR").length;
      const warnCount = window.filter((e) => e.level === "WARN").length;

      let pattern = "normal";
      if (errorCount >= 2) {
        pattern = "error-spike";
      } else if (errorCount + warnCount >= 2) {
        pattern = "degraded";
      }

      const first = window[0];
      const last = window[window.length - 1];
      return {
        timeRange: first && last ? `${first.timestamp}-${last.timestamp}ms` : "unknown",
        errors: errorCount,
        warnings: warnCount,
        pattern,
      };
    })
    .filter("alerts", (analysis) => analysis.pattern !== "normal")
    .tap("logged", (alert) => {
      console.log(`ALERT: ${alert.pattern} detected in ${alert.timeRange}`);
      console.log(`  Errors: ${alert.errors}, Warnings: ${alert.warnings}`);
    });

  await pipeline.executeToArray(fromArray(logs));

  console.log("\nUse case: Detecting error patterns in log streams");
}

// =============================================================================
// Main: Run All Examples
// =============================================================================

async function runAllExamples() {
  console.log("=".repeat(70));
  console.log("WINDOWING OPERATIONS IN STREAMING PIPELINES");
  console.log("=".repeat(70));

  await fixedSizeBatching();
  await slidingWindows();
  await timeBasedBatching();
  await timeBasedWithMaxSize();
  await batchAggregation();
  await movingAverage();
  await sessionWindows();
  await apiRateLimitBatching();
  await adaptiveBatching();
  await eventPatternDetection();

  console.log(`\n${"=".repeat(70)}`);
  console.log("All windowing examples completed!");
  console.log("=".repeat(70));
}

// Run examples if executed directly
if (import.meta.main) {
  runAllExamples().catch(console.error);
}

export {
  fixedSizeBatching,
  slidingWindows,
  timeBasedBatching,
  timeBasedWithMaxSize,
  batchAggregation,
  movingAverage,
  sessionWindows,
  apiRateLimitBatching,
  adaptiveBatching,
  eventPatternDetection,
};
