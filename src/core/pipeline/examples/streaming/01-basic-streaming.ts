/**
 * Basic Streaming Pipeline Example
 *
 * Demonstrates fundamental streaming operations:
 * - Creating streams from arrays
 * - map, filter, and tap operations
 * - Lazy evaluation and pull-based execution
 * - Consuming with for-await-of
 * - Benefits over eager evaluation
 *
 * Run with: bun run src/core/pipeline/examples/streaming/01-basic-streaming.ts
 */

import { fromArray } from "../../streaming/generators";
import { StreamingPipeline } from "../../streaming-builder";

// =============================================================================
// Example 1: Basic Transformations (map, filter, tap)
// =============================================================================

async function basicTransformations() {
  console.log("\n=== Example 1: Basic Transformations ===\n");

  const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  const pipeline = StreamingPipeline.start<number>()
    .map("doubled", (n) => n * 2)
    .filter("evens", (n) => n % 4 === 0) // After doubling: 4, 8, 12, 16, 20
    .tap("logged", (n) => console.log(`Processing: ${n}`))
    .map("stringified", (n) => `Number: ${n}`);

  console.log("Pipeline defined (not yet executed)\n");

  // Execute lazily using for-await-of
  console.log("Consuming results:");
  const results: string[] = [];
  for await (const item of pipeline.execute(fromArray(numbers))) {
    results.push(item);
  }

  console.log("\nFinal results:", results);
  console.log("Expected: ['Number: 4', 'Number: 8', 'Number: 12', 'Number: 16', 'Number: 20']");
}

// =============================================================================
// Example 2: Lazy Evaluation Benefits
// =============================================================================

async function lazyEvaluation() {
  console.log("\n=== Example 2: Lazy Evaluation ===\n");

  let transformCount = 0;

  const pipeline = StreamingPipeline.start<number>()
    .map("expensive", (n) => {
      transformCount++;
      console.log(`Transform called for: ${n}`);
      return n * 2;
    })
    .filter("large", (n) => n > 5);

  console.log("Pipeline defined, but no transforms executed yet");
  console.log(`Transform count: ${transformCount}\n`);

  // Take only first 3 items
  console.log("Taking first 3 items:");
  let count = 0;
  for await (const item of pipeline.execute(fromArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))) {
    console.log(`Got: ${item}`);
    count++;
    if (count >= 3) {
      break; // Stop early - remaining items never processed!
    }
  }

  console.log(`\nTotal transforms executed: ${transformCount}`);
  console.log("Notice: Only items needed were processed (lazy evaluation)");
}

// =============================================================================
// Example 3: Async Transformations
// =============================================================================

async function asyncTransformations() {
  console.log("\n=== Example 3: Async Transformations ===\n");

  const userIds = ["user-1", "user-2", "user-3"];

  // Simulate async API call
  async function fetchUser(id: string) {
    await Bun.sleep(50); // Simulate network delay
    return { id, name: `User ${id}`, active: Math.random() > 0.3 };
  }

  const pipeline = StreamingPipeline.start<string>()
    .map("fetched", async (id) => {
      console.log(`Fetching ${id}...`);
      return await fetchUser(id);
    })
    .filter("active", (user) => user.active)
    .tap("logged", (user) => console.log(`Active user: ${user.name}`))
    .map("names", (user) => user.name);

  console.log("Starting async pipeline...\n");
  const startTime = Date.now();

  const results = await pipeline.executeToArray(fromArray(userIds));

  const duration = Date.now() - startTime;
  console.log(`\nResults: ${results.join(", ")}`);
  console.log(`Duration: ${duration}ms (sequential processing)`);
}

// =============================================================================
// Example 4: FlatMap for Expansion
// =============================================================================

async function flatMapExample() {
  console.log("\n=== Example 4: FlatMap for Expansion ===\n");

  const sentences = ["Hello world", "Streaming pipelines are great", "Lazy evaluation rocks"];

  const pipeline = StreamingPipeline.start<string>()
    .tap("sentence", (s) => console.log(`Sentence: "${s}"`))
    .flatMap("words", (sentence) => sentence.split(" "))
    .filter("long", (word) => word.length > 5)
    .map("upper", (word) => word.toUpperCase());

  console.log("Extracting long words:\n");
  const results = await pipeline.executeToArray(fromArray(sentences));

  console.log(`\nLong words: ${results.join(", ")}`);
}

// =============================================================================
// Example 5: Chaining Operations
// =============================================================================

async function chainingOperations() {
  console.log("\n=== Example 5: Chaining Operations ===\n");

  const data = Array.from({ length: 20 }, (_, i) => i + 1);

  const pipeline = StreamingPipeline.start<number>()
    .filter("odds", (n) => n % 2 === 1) // 1, 3, 5, 7, 9, 11, 13, 15, 17, 19
    .map("squared", (n) => n * n) // 1, 9, 25, 49, 81, 121, 169, 225, 289, 361
    .filter("under200", (n) => n < 200) // 1, 9, 25, 49, 81, 121, 169
    .take("first5", 5) // 1, 9, 25, 49, 81
    .map("formatted", (n) => `Square: ${n}`);

  console.log("Processing with multiple operations:\n");
  for await (const item of pipeline.execute(fromArray(data))) {
    console.log(item);
  }
}

// =============================================================================
// Example 6: Memory Efficiency Comparison
// =============================================================================

async function memoryEfficiency() {
  console.log("\n=== Example 6: Memory Efficiency ===\n");

  const DATASET_SIZE = 1000;

  // Eager approach (arrays)
  console.log("Eager approach (arrays):");
  const eagerStart = Date.now();

  const step1 = Array.from({ length: DATASET_SIZE }, (_, i) => i + 1);
  console.log(`After step 1: ${step1.length} items in memory`);

  const step2 = step1.map((n) => n * 2);
  console.log(`After step 2: ${step2.length} items in memory (2 arrays exist)`);

  const step3 = step2.filter((n) => n % 4 === 0);
  console.log(`After step 3: ${step3.length} items in memory (3 arrays exist)`);

  const eagerDuration = Date.now() - eagerStart;
  console.log(`Eager duration: ${eagerDuration}ms`);
  console.log(`Eager result count: ${step3.length}\n`);

  // Lazy approach (streaming)
  console.log("Lazy approach (streaming):");
  const lazyStart = Date.now();

  const pipeline = StreamingPipeline.start<number>()
    .map("doubled", (n) => n * 2)
    .filter("divisibleBy4", (n) => n % 4 === 0);

  const results: number[] = [];
  for await (const item of pipeline.execute(fromArray(Array.from({ length: DATASET_SIZE }, (_, i) => i + 1)))) {
    results.push(item);
  }

  const lazyDuration = Date.now() - lazyStart;
  console.log(`Lazy duration: ${lazyDuration}ms`);
  console.log(`Lazy result count: ${results.length}`);
  console.log("\nNote: Streaming processes one item at a time - lower memory footprint");
}

// =============================================================================
// Example 7: Skip and Take Operations
// =============================================================================

async function skipAndTake() {
  console.log("\n=== Example 7: Skip and Take ===\n");

  const data = Array.from({ length: 100 }, (_, i) => i + 1);

  // Pagination with skip and take
  const page = 3;
  const pageSize = 10;

  const pipeline = StreamingPipeline.start<number>()
    .skip("skipToPage", (page - 1) * pageSize)
    .take("pageItems", pageSize)
    .map("formatted", (n) => `Item ${n}`);

  console.log(`Getting page ${page} (items ${(page - 1) * pageSize + 1}-${page * pageSize}):\n`);

  for await (const item of pipeline.execute(fromArray(data))) {
    console.log(item);
  }

  console.log("\nNote: Only needed items were processed due to lazy evaluation");
}

// =============================================================================
// Example 8: Conditional Processing
// =============================================================================

async function conditionalProcessing() {
  console.log("\n=== Example 8: Conditional Processing ===\n");

  const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  const pipeline = StreamingPipeline.start<number>()
    .takeWhile("lessThan7", (n) => n < 7)
    .map("squared", (n) => n * n);

  console.log("Taking while less than 7, then squaring:\n");

  for await (const item of pipeline.execute(fromArray(data))) {
    console.log(`Result: ${item}`);
  }

  console.log("\nNote: Processing stopped at 7, items 7-10 were never processed");
}

// =============================================================================
// Example 9: Reduce Operation
// =============================================================================

async function reduceExample() {
  console.log("\n=== Example 9: Reduce Operation ===\n");

  const data = [1, 2, 3, 4, 5];

  const pipeline = StreamingPipeline.start<number>()
    .map("squared", (n) => n * n)
    .tap("logged", (n) => console.log(`Squared: ${n}`));

  const sum = await pipeline.reduce(fromArray(data), (acc, n) => acc + n, 0);

  console.log(`\nSum of squares: ${sum}`);
  console.log("Expected: 1 + 4 + 9 + 16 + 25 = 55");
}

// =============================================================================
// Main: Run All Examples
// =============================================================================

async function runAllExamples() {
  console.log("=".repeat(70));
  console.log("BASIC STREAMING PIPELINE EXAMPLES");
  console.log("=".repeat(70));

  await basicTransformations();
  await lazyEvaluation();
  await asyncTransformations();
  await flatMapExample();
  await chainingOperations();
  await memoryEfficiency();
  await skipAndTake();
  await conditionalProcessing();
  await reduceExample();

  console.log(`\n${"=".repeat(70)}`);
  console.log("All basic examples completed!");
  console.log("=".repeat(70));
}

// Run examples if executed directly
if (import.meta.main) {
  runAllExamples().catch(console.error);
}

export {
  basicTransformations,
  lazyEvaluation,
  asyncTransformations,
  flatMapExample,
  chainingOperations,
  memoryEfficiency,
  skipAndTake,
  conditionalProcessing,
  reduceExample,
};
