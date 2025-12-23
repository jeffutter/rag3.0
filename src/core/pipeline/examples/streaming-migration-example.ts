/**
 * Example demonstrating step categorization and migration recommendations.
 *
 * Shows how to:
 * - Categorize existing batch steps
 * - Get migration recommendations
 * - Apply different migration strategies
 * - Compare batch vs streaming performance
 *
 * Run with: bun run src/core/pipeline/examples/streaming-migration-example.ts
 */

import { Pipeline } from "../builder";
import { createStep } from "../steps";
import { fromArray } from "../streaming/generators";
import {
  categorizeStep,
  createHybridStep,
  getMigrationRecommendation,
  toBatchMode,
  toStreamingMode,
  toStreamingStep,
} from "../streaming-adapters";
import { StreamingPipeline } from "../streaming-builder";
import { createStreamingStep } from "../streaming-steps";

// =============================================================================
// Example Batch Steps (representing different categories)
// =============================================================================

// 1. Pure Transform - Excellent streaming candidate
const upperCaseStep = createStep<string, string>("upperCase", async ({ input }) => input.toUpperCase());

// 2. I/O Bound - Excellent streaming candidate
const fetchUserStep = createStep<string, { id: string; name: string }>("fetchUser", async ({ input }) => {
  // Simulate API call
  await Bun.sleep(10);
  return { id: input, name: `User ${input}` };
});

// 3. Expansion - Excellent streaming candidate (but needs manual conversion)
const splitWordsStep = createStep<string, string[]>("splitWords", async ({ input }) => input.split(/\s+/));

// 4. Reduction - Good streaming candidate
const filterLongWordsStep = createStep<string[], string[]>("filterLong", async ({ input }) =>
  input.filter((word) => word.length > 5),
);

// 5. Stateful - Good with caution
const dedupeStep = createStep<string, string>("dedupe", async ({ input }) => {
  // In real implementation, this would maintain a Set across items
  // For simplicity, just pass through here
  return input;
});

// 6. Aggregation - Poor streaming candidate
const sortStep = createStep<number[], number[]>("sort", async ({ input }) => [...input].sort((a, b) => a - b));

// =============================================================================
// Step Categorization Demo
// =============================================================================

function demonstrateCategorization() {
  console.log("\n=== Step Categorization Demo ===\n");

  const steps = [
    { step: upperCaseStep, description: "Pure Transform" },
    { step: fetchUserStep, description: "I/O Bound" },
    { step: splitWordsStep, description: "Expansion" },
    { step: filterLongWordsStep, description: "Reduction" },
    { step: dedupeStep, description: "Stateful" },
    { step: sortStep, description: "Aggregation" },
  ];

  for (const { step, description } of steps) {
    // biome-ignore lint/suspicious/noExplicitAny: Union type requires any for categorization
    const category = categorizeStep(step as any);
    // biome-ignore lint/suspicious/noExplicitAny: Union type requires any for categorization
    const recommendation = getMigrationRecommendation(step as any);

    console.log(`Step: ${step.name} (${description})`);
    console.log(`  Category: ${category}`);
    console.log(`  Recommended: ${recommendation.recommended ? "Yes" : "No"}`);
    console.log(`  Strength: ${(recommendation.strength * 100).toFixed(0)}%`);
    console.log(`  Approach: ${recommendation.approach}`);
    console.log(`  Reason: ${recommendation.reason}`);
    console.log();
  }
}

// =============================================================================
// Migration Approach 1: Automatic Wrapper (toStreamingStep)
// =============================================================================

async function demonstrateAutomaticWrapper() {
  console.log("\n=== Approach 1: Automatic Wrapper ===\n");

  // Wrap existing batch step as streaming
  const streamingUpperCase = toStreamingStep(upperCaseStep);

  const testData = ["hello", "world", "streaming", "pipeline"];

  // Batch version
  const batchPipeline = Pipeline.start<string[]>().map("upper", upperCaseStep, { parallel: false });

  const batchStart = performance.now();
  const batchResult = await batchPipeline.execute(testData);
  const batchDuration = performance.now() - batchStart;

  // Streaming version
  const streamingPipeline = StreamingPipeline.start<string>().add("upper", streamingUpperCase);

  const streamingStart = performance.now();
  const streamingResult = await streamingPipeline.executeToArray(fromArray(testData));
  const streamingDuration = performance.now() - streamingStart;

  console.log("Batch result:", batchResult.success ? batchResult.data : "error");
  console.log("Streaming result:", streamingResult);
  console.log(`Batch duration: ${batchDuration.toFixed(2)}ms`);
  console.log(`Streaming duration: ${streamingDuration.toFixed(2)}ms`);
  console.log(
    "Results match:",
    JSON.stringify(streamingResult) === JSON.stringify(batchResult.success ? batchResult.data : null),
  );
}

// =============================================================================
// Migration Approach 2: Manual Conversion (createStreamingStep)
// =============================================================================

async function demonstrateManualConversion() {
  console.log("\n=== Approach 2: Manual Conversion ===\n");

  // Manual streaming version of splitWords (with flatMap semantics)
  const streamingSplitWords = createStreamingStep<string, string>("splitWords", async function* ({ input }) {
    for await (const text of input) {
      const words = text.split(/\s+/);
      for (const word of words) {
        yield word; // Yield each word individually (expansion)
      }
    }
  });

  const testData = ["hello world", "streaming is awesome", "pipeline processing"];

  // Batch version (flattened)
  const batchPipeline = Pipeline.start<string[]>()
    .map("split", splitWordsStep, { parallel: false })
    .add(
      "flatten",
      createStep("flatten", async ({ input }) => input.flat()),
    );

  const batchResult = await batchPipeline.execute(testData);

  // Streaming version
  const streamingPipeline = StreamingPipeline.start<string>().add("split", streamingSplitWords);

  const streamingResult = await streamingPipeline.executeToArray(fromArray(testData));

  console.log("Batch result:", batchResult.success ? batchResult.data : "error");
  console.log("Streaming result:", streamingResult);
  console.log(
    "Results match:",
    JSON.stringify(streamingResult) === JSON.stringify(batchResult.success ? batchResult.data : null),
  );
}

// =============================================================================
// Migration Approach 3: Hybrid Step (createHybridStep)
// =============================================================================

async function demonstrateHybridStep() {
  console.log("\n=== Approach 3: Hybrid Step ===\n");

  // Create hybrid step that works in both modes
  const hybridTrim = createHybridStep<string, string>(
    "trim",
    // Batch mode
    async ({ input }) => input.map((s) => s.trim()),
    // Streaming mode
    async function* ({ input }) {
      for await (const s of input) {
        yield s.trim();
      }
    },
  );

  const testData = ["  hello  ", "  world  ", "  test  "];

  // Use in batch pipeline
  const batchPipeline = Pipeline.start<string[]>().add("trim", toBatchMode(hybridTrim));

  const batchResult = await batchPipeline.execute(testData);

  // Use in streaming pipeline
  const streamingPipeline = StreamingPipeline.start<string>().add("trim", toStreamingMode(hybridTrim));

  const streamingResult = await streamingPipeline.executeToArray(fromArray(testData));

  console.log("Batch result:", batchResult.success ? batchResult.data : "error");
  console.log("Streaming result:", streamingResult);
  console.log("Same step used in both pipelines!");
  console.log(
    "Results match:",
    JSON.stringify(streamingResult) === JSON.stringify(batchResult.success ? batchResult.data : null),
  );
}

// =============================================================================
// Early Termination Demo
// =============================================================================

async function demonstrateEarlyTermination() {
  console.log("\n=== Early Termination Demo ===\n");

  let batchItemsProcessed = 0;
  let streamingItemsProcessed = 0;

  const batchStep = createStep<number, number>("process", async ({ input }) => {
    batchItemsProcessed++;
    return input * 2;
  });

  const streamingStep = createStreamingStep<number, number>("process", async function* ({ input }) {
    for await (const num of input) {
      streamingItemsProcessed++;
      yield num * 2;
    }
  });

  const largeDataset = Array.from({ length: 1000 }, (_, i) => i + 1);
  const itemsNeeded = 10;

  // Batch - must process everything
  const batchPipeline = Pipeline.start<number[]>().map("result", batchStep, { parallel: false });

  const batchResult = await batchPipeline.execute(largeDataset);
  const batchTaken = batchResult.success ? batchResult.data.slice(0, itemsNeeded) : [];

  // Streaming - early termination
  const streamingPipeline = StreamingPipeline.start<number>().add("result", streamingStep);

  const streamingResults: number[] = [];
  const generator = streamingPipeline.execute(fromArray(largeDataset));

  for await (const item of generator) {
    streamingResults.push(item);
    if (streamingResults.length >= itemsNeeded) {
      break; // Stop early!
    }
  }

  console.log(`Total items in dataset: ${largeDataset.length}`);
  console.log(`Items needed: ${itemsNeeded}`);
  console.log(`Batch items processed: ${batchItemsProcessed} (100%)`);
  console.log(
    `Streaming items processed: ${streamingItemsProcessed} (${((streamingItemsProcessed / largeDataset.length) * 100).toFixed(1)}%)`,
  );
  console.log(
    `Streaming efficiency: ${((1 - streamingItemsProcessed / batchItemsProcessed) * 100).toFixed(1)}% less work`,
  );
  console.log("Results match:", JSON.stringify(streamingResults) === JSON.stringify(batchTaken));
}

// =============================================================================
// Performance Comparison
// =============================================================================

async function demonstratePerformanceComparison() {
  console.log("\n=== Performance Comparison ===\n");

  const streamingFetch = toStreamingStep(fetchUserStep);

  const userIds = Array.from({ length: 50 }, (_, i) => `user-${i + 1}`);

  // Sequential batch
  const seqBatchPipeline = Pipeline.start<string[]>().map("fetched", fetchUserStep, { parallel: false });

  const seqStart = performance.now();
  await seqBatchPipeline.execute(userIds);
  const seqDuration = performance.now() - seqStart;

  // Parallel batch
  const parBatchPipeline = Pipeline.start<string[]>().map("fetched", fetchUserStep, {
    parallel: true,
    concurrencyLimit: 10,
  });

  const parStart = performance.now();
  await parBatchPipeline.execute(userIds);
  const parDuration = performance.now() - parStart;

  // Streaming (sequential)
  const streamingPipeline = StreamingPipeline.start<string>().add("fetched", streamingFetch);

  const streamingStart = performance.now();
  await streamingPipeline.executeToArray(fromArray(userIds));
  const streamingDuration = performance.now() - streamingStart;

  console.log(`Sequential batch: ${seqDuration.toFixed(2)}ms`);
  console.log(
    `Parallel batch (limit=10): ${parDuration.toFixed(2)}ms (${(seqDuration / parDuration).toFixed(1)}x faster)`,
  );
  console.log(`Streaming (sequential): ${streamingDuration.toFixed(2)}ms`);
  console.log("\nNote: Use .map() with parallel option for I/O-bound streaming operations");
}

// =============================================================================
// Migration Decision Tree
// =============================================================================

function displayMigrationDecisionTree() {
  console.log("\n=== Migration Decision Tree ===\n");
  console.log("1. Categorize your step:");
  console.log("   const category = categorizeStep(myStep);");
  console.log("   const recommendation = getMigrationRecommendation(myStep);");
  console.log();
  console.log("2. Choose approach based on recommendation:");
  console.log();
  console.log("   IF approach === 'toStreamingStep':");
  console.log("     → Use automatic wrapper (Approach 1)");
  console.log("     → Best for: Pure transforms, I/O bound");
  console.log("     → Code: toStreamingStep(myStep)");
  console.log();
  console.log("   IF approach === 'manual_conversion':");
  console.log("     → Write native streaming step (Approach 2)");
  console.log("     → Best for: Expansions, stateful, performance-critical");
  console.log("     → Code: createStreamingStep(name, async function* ({ input }) { ... })");
  console.log();
  console.log("   IF approach === 'createHybridStep':");
  console.log("     → Create hybrid step (Approach 3)");
  console.log("     → Best for: Reductions, library code");
  console.log("     → Code: createHybridStep(name, batchFn, streamFn)");
  console.log();
  console.log("   IF approach === 'keep_batch':");
  console.log("     → Don't migrate, keep as batch");
  console.log("     → Best for: Aggregations requiring full dataset");
  console.log();
  console.log("3. Test behavioral equivalence and performance");
  console.log();
}

// =============================================================================
// Main: Run All Examples
// =============================================================================

async function runAllExamples() {
  console.log("=".repeat(70));
  console.log("STREAMING MIGRATION EXAMPLES");
  console.log("=".repeat(70));

  demonstrateCategorization();
  displayMigrationDecisionTree();
  await demonstrateAutomaticWrapper();
  await demonstrateManualConversion();
  await demonstrateHybridStep();
  await demonstrateEarlyTermination();
  await demonstratePerformanceComparison();

  console.log("=".repeat(70));
  console.log("All examples completed!");
  console.log("=".repeat(70));
}

// Run examples if executed directly
if (import.meta.main) {
  runAllExamples().catch(console.error);
}

export {
  demonstrateAutomaticWrapper,
  demonstrateCategorization,
  demonstrateEarlyTermination,
  demonstrateHybridStep,
  demonstrateManualConversion,
  demonstratePerformanceComparison,
};
