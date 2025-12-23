/**
 * State Management in Streaming Pipelines Example
 *
 * Demonstrates state management patterns:
 * - Accessing accumulated state
 * - Stateful transformations
 * - Reduction points for materialization
 * - When to use batch vs streaming for state
 * - Cross-step state access
 *
 * Run with: bun run src/core/pipeline/examples/streaming/06-state-management.ts
 */

import { fromArray } from "../../streaming/generators";
import { StreamingPipeline } from "../../streaming-builder";

// =============================================================================
// Example 1: Stateful Counting
// =============================================================================

async function statefulCounting() {
  console.log("\n=== Example 1: Stateful Counting ===\n");

  const items = ["apple", "banana", "apple", "cherry", "banana", "apple", "date"];

  const counts: Record<string, number> = {};

  const pipeline = StreamingPipeline.start<string>()
    .map("withCount", (item) => {
      counts[item] = (counts[item] || 0) + 1;
      return { item, count: counts[item], total: Object.values(counts).reduce((a, b) => a + b, 0) };
    })
    .tap("logged", (result) => {
      console.log(`${result.item}: seen ${result.count} time(s) (total items: ${result.total})`);
    });

  await pipeline.executeToArray(fromArray(items));

  console.log("\nFinal counts:", counts);
  console.log("\nNote: State maintained across items in the stream");
}

// =============================================================================
// Example 2: Running Statistics
// =============================================================================

async function runningStatistics() {
  console.log("\n=== Example 2: Running Statistics ===\n");

  const measurements = [10, 12, 15, 11, 20, 18, 14, 16, 13, 19];

  let sum = 0;
  let count = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  const pipeline = StreamingPipeline.start<number>()
    .map("withStats", (value) => {
      sum += value;
      count += 1;
      min = Math.min(min, value);
      max = Math.max(max, value);

      return {
        value,
        runningAvg: (sum / count).toFixed(2),
        runningMin: min,
        runningMax: max,
        count,
      };
    })
    .tap("logged", (stats) => {
      console.log(
        `Value: ${stats.value}, Avg: ${stats.runningAvg}, Min: ${stats.runningMin}, Max: ${stats.runningMax}`,
      );
    });

  await pipeline.executeToArray(fromArray(measurements));

  console.log("\nNote: Statistics updated incrementally as stream progresses");
}

// =============================================================================
// Example 3: Deduplication with State
// =============================================================================

async function statefulDeduplication() {
  console.log("\n=== Example 3: Deduplication with State ===\n");

  const items = [1, 2, 3, 2, 4, 1, 5, 3, 6, 4, 7];

  const seen = new Set<number>();

  const pipeline = StreamingPipeline.start<number>()
    .filter("unique", (item) => {
      if (seen.has(item)) {
        console.log(`  Filtered duplicate: ${item}`);
        return false;
      }
      seen.add(item);
      return true;
    })
    .tap("passed", (item) => {
      console.log(`  Passed: ${item}`);
    });

  const results = await pipeline.executeToArray(fromArray(items));

  console.log(`\nUnique items: ${results.join(", ")}`);
  console.log(`Original: ${items.length}, Unique: ${results.length}`);
}

// =============================================================================
// Example 4: Accumulating Results for Later Use
// =============================================================================

async function accumulatingResults() {
  console.log("\n=== Example 4: Accumulating Results ===\n");

  interface Transaction {
    id: string;
    amount: number;
    type: "debit" | "credit";
  }

  const transactions: Transaction[] = [
    { id: "t1", amount: 100, type: "credit" },
    { id: "t2", amount: 50, type: "debit" },
    { id: "t3", amount: 75, type: "credit" },
    { id: "t4", amount: 30, type: "debit" },
    { id: "t5", amount: 200, type: "credit" },
  ];

  let balance = 0;
  const history: Array<{ id: string; balance: number }> = [];

  const pipeline = StreamingPipeline.start<Transaction>()
    .map("processed", (tx) => {
      const change = tx.type === "credit" ? tx.amount : -tx.amount;
      balance += change;

      const record = { id: tx.id, balance };
      history.push(record);

      return {
        ...tx,
        balance,
        change,
      };
    })
    .tap("logged", (result) => {
      console.log(`${result.id}: ${result.type} $${result.amount} → Balance: $${result.balance}`);
    });

  await pipeline.executeToArray(fromArray(transactions));

  console.log("\nFinal balance:", balance);
  console.log("History:", history);
}

// =============================================================================
// Example 5: Conditional State Updates
// =============================================================================

async function conditionalStateUpdates() {
  console.log("\n=== Example 5: Conditional State Updates ===\n");

  interface SensorReading {
    timestamp: number;
    temperature: number;
    humidity: number;
  }

  const readings: SensorReading[] = Array.from({ length: 20 }, (_, i) => ({
    timestamp: Date.now() + i * 1000,
    temperature: 20 + Math.random() * 10,
    humidity: 40 + Math.random() * 20,
  }));

  let highTempCount = 0;
  let lowHumidityCount = 0;
  let alertsSent = 0;

  const pipeline = StreamingPipeline.start<SensorReading>().map("analyzed", (reading) => {
    const tempHigh = reading.temperature > 25;
    const humidityLow = reading.humidity < 45;

    if (tempHigh) highTempCount++;
    if (humidityLow) lowHumidityCount++;

    const alert = tempHigh && humidityLow;
    if (alert) {
      alertsSent++;
      console.log(
        `  ALERT: High temp (${reading.temperature.toFixed(1)}°C) + Low humidity (${reading.humidity.toFixed(1)}%)`,
      );
    }

    return {
      ...reading,
      alert,
      stats: { highTempCount, lowHumidityCount, alertsSent },
    };
  });

  await pipeline.executeToArray(fromArray(readings));

  console.log(`\nSummary:`);
  console.log(`  High temperature readings: ${highTempCount}`);
  console.log(`  Low humidity readings: ${lowHumidityCount}`);
  console.log(`  Alerts sent: ${alertsSent}`);
}

// =============================================================================
// Example 6: State Reset and Partitioning
// =============================================================================

async function statePartitioning() {
  console.log("\n=== Example 6: State Reset and Partitioning ===\n");

  interface Event {
    userId: string;
    action: string;
    value: number;
  }

  const events: Event[] = [
    { userId: "user1", action: "click", value: 1 },
    { userId: "user1", action: "view", value: 2 },
    { userId: "user2", action: "click", value: 1 },
    { userId: "user1", action: "purchase", value: 100 },
    { userId: "user2", action: "view", value: 2 },
    { userId: "user2", action: "purchase", value: 150 },
  ];

  // Maintain separate state per user
  const userState: Record<string, { actionCount: number; totalValue: number }> = {};

  const pipeline = StreamingPipeline.start<Event>()
    .map("withUserState", (event) => {
      if (!userState[event.userId]) {
        userState[event.userId] = { actionCount: 0, totalValue: 0 };
      }

      const state = userState[event.userId];
      if (state) {
        state.actionCount++;
        state.totalValue += event.value;
      }

      return {
        ...event,
        userActionCount: state?.actionCount || 0,
        userTotalValue: state?.totalValue || 0,
      };
    })
    .tap("logged", (result) => {
      console.log(
        `${result.userId} - ${result.action}: action #${result.userActionCount}, total value: ${result.userTotalValue}`,
      );
    });

  await pipeline.executeToArray(fromArray(events));

  console.log("\nPer-user state:");
  Object.entries(userState).forEach(([userId, state]) => {
    console.log(`  ${userId}: ${state.actionCount} actions, $${state.totalValue} total`);
  });
}

// =============================================================================
// Example 7: Materialization at Checkpoints
// =============================================================================

async function materializationCheckpoints() {
  console.log("\n=== Example 7: Materialization at Checkpoints ===\n");

  const numbers = Array.from({ length: 20 }, (_, i) => i + 1);

  // Collect first batch for later comparison
  const firstBatch: number[] = [];

  const pipeline = StreamingPipeline.start<number>()
    .take("first10", 10)
    .tap("collect", (n) => {
      firstBatch.push(n);
    })
    .map("doubled", (n) => n * 2);

  // Process full stream
  const fullPipeline = StreamingPipeline.start<number>().map("doubled", (n) => n * 2);

  const partialResults = await pipeline.executeToArray(fromArray(numbers));
  const fullResults = await fullPipeline.executeToArray(fromArray(numbers));

  console.log(`First 10 collected: [${firstBatch.join(", ")}]`);
  console.log(`Partial results: ${partialResults.length} items`);
  console.log(`Full results: ${fullResults.length} items`);
  console.log("\nNote: Can materialize intermediate results at any point");
}

// =============================================================================
// Example 8: Stateful Pattern Matching
// =============================================================================

async function statefulPatternMatching() {
  console.log("\n=== Example 8: Stateful Pattern Matching ===\n");

  const sequence = [1, 2, 3, 1, 2, 3, 4, 1, 2, 1, 2, 3];
  const pattern = [1, 2, 3];

  let patternIndex = 0;
  let matchCount = 0;
  const matchPositions: number[] = [];

  const pipeline = StreamingPipeline.start<number>().map("checked", (value, index) => {
    const expected = pattern[patternIndex];
    const matches = value === expected;

    if (matches) {
      patternIndex++;
      if (patternIndex === pattern.length) {
        // Complete match
        matchCount++;
        matchPositions.push(index - pattern.length + 1);
        console.log(`  Pattern matched at position ${index - pattern.length + 1}`);
        patternIndex = 0; // Reset for next match
      }
    } else {
      patternIndex = value === pattern[0] ? 1 : 0; // Try starting new match
    }

    return {
      value,
      index,
      patternProgress: patternIndex,
      isMatch: matches,
    };
  });

  await pipeline.executeToArray(fromArray(sequence));

  console.log(`\nPattern [${pattern.join(", ")}] found ${matchCount} times`);
  console.log(`Positions: ${matchPositions.join(", ")}`);
}

// =============================================================================
// Example 9: Rate Limiting with State
// =============================================================================

async function statefulRateLimiting() {
  console.log("\n=== Example 9: Rate Limiting with State ===\n");

  const requests = Array.from({ length: 25 }, (_, i) => `request-${i + 1}`);

  const windowMs = 1000; // 1 second window
  const maxRequests = 5; // Max 5 requests per window

  let windowStart = Date.now();
  let requestsInWindow = 0;

  const pipeline = StreamingPipeline.start<string>().map("rateLimited", async (request) => {
    const now = Date.now();

    // Reset window if expired
    if (now - windowStart >= windowMs) {
      windowStart = now;
      requestsInWindow = 0;
    }

    // Check rate limit
    if (requestsInWindow >= maxRequests) {
      const waitTime = windowMs - (now - windowStart);
      console.log(`  Rate limit hit, waiting ${waitTime}ms...`);
      await Bun.sleep(waitTime);

      // Reset window
      windowStart = Date.now();
      requestsInWindow = 0;
    }

    requestsInWindow++;
    console.log(`  Processing ${request} (${requestsInWindow}/${maxRequests} in window)`);

    return { request, processed: true };
  });

  const startTime = Date.now();
  await pipeline.executeToArray(fromArray(requests));
  const duration = Date.now() - startTime;

  console.log(`\nProcessed ${requests.length} requests in ${duration}ms`);
  console.log(`Rate limit: ${maxRequests} per ${windowMs}ms`);
}

// =============================================================================
// Example 10: When to Use Batch vs Streaming for State
// =============================================================================

async function batchVsStreamingState() {
  console.log("\n=== Example 10: Batch vs Streaming for State ===\n");

  const numbers = Array.from({ length: 100 }, (_, i) => i + 1);

  console.log("Scenario 1: Global aggregation (better with batch)\n");

  // Need full dataset for correct result
  const sum = numbers.reduce((acc, n) => acc + n, 0);
  const avg = sum / numbers.length;
  console.log(`  Sum: ${sum}, Average: ${avg.toFixed(2)}`);
  console.log("  → Use batch: Need complete dataset\n");

  console.log("Scenario 2: Running total (perfect for streaming)\n");

  let runningTotal = 0;
  const pipeline = StreamingPipeline.start<number>()
    .map("withTotal", (n) => {
      runningTotal += n;
      return { value: n, runningTotal };
    })
    .filter("milestones", (result) => result.runningTotal % 500 === 0 || result.runningTotal > 5000)
    .tap("logged", (result) => {
      console.log(`  Milestone: ${result.value} → Running total: ${result.runningTotal}`);
    });

  await pipeline.executeToArray(fromArray(numbers));
  console.log("  → Use streaming: Progressive state updates\n");

  console.log("Guidelines:");
  console.log("  - Use BATCH when:");
  console.log("    • Need complete dataset (sorting, median, percentiles)");
  console.log("    • State depends on all items");
  console.log("    • Dataset fits in memory");
  console.log("  - Use STREAMING when:");
  console.log("    • Progressive/running calculations");
  console.log("    • Stateful transformations per item");
  console.log("    • Large datasets that don't fit in memory");
  console.log("    • Early termination possible");
}

// =============================================================================
// Main: Run All Examples
// =============================================================================

async function runAllExamples() {
  console.log("=".repeat(70));
  console.log("STATE MANAGEMENT IN STREAMING PIPELINES");
  console.log("=".repeat(70));

  await statefulCounting();
  await runningStatistics();
  await statefulDeduplication();
  await accumulatingResults();
  await conditionalStateUpdates();
  await statePartitioning();
  await materializationCheckpoints();
  await statefulPatternMatching();
  await statefulRateLimiting();
  await batchVsStreamingState();

  console.log(`\n${"=".repeat(70)}`);
  console.log("All state management examples completed!");
  console.log("=".repeat(70));
}

// Run examples if executed directly
if (import.meta.main) {
  runAllExamples().catch(console.error);
}

export {
  statefulCounting,
  runningStatistics,
  statefulDeduplication,
  accumulatingResults,
  conditionalStateUpdates,
  statePartitioning,
  materializationCheckpoints,
  statefulPatternMatching,
  statefulRateLimiting,
  batchVsStreamingState,
};
