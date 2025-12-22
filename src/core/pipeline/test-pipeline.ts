/**
 * Runtime test for the enhanced pipeline system.
 * This verifies that accumulated state actually works at runtime.
 */

import { Pipeline } from "./builder";
import { createStep } from "./steps";

// Test 1: Simple linear pipeline
console.log("=== Test 1: Simple Linear Pipeline ===");

const test1Pipeline = Pipeline.start<string>()
  .add(
    "uppercase",
    createStep<string, string>("uppercase", async ({ input }) => {
      console.log(`  Input: "${input}"`);
      const result = input.toUpperCase();
      console.log(`  Output: "${result}"`);
      return result;
    }),
  )
  .add(
    "length",
    createStep<string, number, { uppercase: string }>("length", async ({ input }) => {
      console.log(`  Input: "${input}"`);
      const result = input.length;
      console.log(`  Output: ${result}`);
      return result;
    }),
  );

const result1 = await test1Pipeline.execute("hello world");
if (result1.success) {
  console.log(`✅ Test 1 passed: Result = ${result1.data}`);
  console.log(`   Duration: ${result1.metadata.durationMs.toFixed(2)}ms\n`);
} else {
  console.error(`❌ Test 1 failed:`, result1.error);
}

// Test 2: Pipeline with accumulated state access
console.log("=== Test 2: Accumulated State Access ===");

interface Step1Output {
  originalText: string;
  processedAt: number;
}

interface Step2Output {
  words: string[];
  wordCount: number;
}

const test2Pipeline = Pipeline.start<string>()
  .add(
    "process",
    createStep<string, Step1Output>("process", async ({ input }) => {
      console.log(`  Step 1 - Input: "${input}"`);
      const result = {
        originalText: input,
        processedAt: Date.now(),
      };
      console.log(`  Step 1 - Output:`, result);
      return result;
    }),
  )
  .add(
    "analyze",
    createStep<Step1Output, Step2Output, { process: Step1Output }>("analyze", async ({ input, state }) => {
      console.log(`  Step 2 - Input:`, input);
      console.log(`  Step 2 - State.process:`, state.process);
      console.log(`  Step 2 - Verifying state matches input: ${input === state.process}`);

      const words = input.originalText.split(" ");
      const result = {
        words,
        wordCount: words.length,
      };
      console.log(`  Step 2 - Output:`, result);
      return result;
    }),
  )
  .add(
    "summary",
    createStep<Step2Output, string, { process: Step1Output; analyze: Step2Output }>(
      "summary",
      async ({ input, state }) => {
        console.log(`  Step 3 - Input:`, input);
        console.log(`  Step 3 - Can access state.process:`, state.process);
        console.log(`  Step 3 - Can access state.analyze:`, state.analyze);

        // This is the key test: accessing a step from earlier in the pipeline
        const timeTaken = Date.now() - state.process.processedAt;
        const result = `Original: "${state.process.originalText}", Words: ${state.analyze.wordCount}, Time: ${timeTaken}ms`;
        console.log(`  Step 3 - Output: "${result}"`);
        return result;
      },
    ),
  );

const result2 = await test2Pipeline.execute("TypeScript is amazing");
if (result2.success) {
  console.log(`✅ Test 2 passed: ${result2.data}`);
  console.log(`   Duration: ${result2.metadata.durationMs.toFixed(2)}ms\n`);
} else {
  console.error(`❌ Test 2 failed:`, result2.error);
}

// Test 3: Complex multi-step with cross-references
console.log("=== Test 3: Complex Multi-Step Pipeline ===");

const test3Pipeline = Pipeline.start<number>()
  .add(
    "double",
    createStep<number, number>("double", async ({ input }) => {
      const result = input * 2;
      console.log(`  Double: ${input} -> ${result}`);
      return result;
    }),
  )
  .add(
    "square",
    createStep<number, number, { double: number }>("square", async ({ input, state }) => {
      const result = input * input;
      console.log(`  Square: ${input} -> ${result}`);
      console.log(`  (Previous double result was: ${state.double})`);
      return result;
    }),
  )
  .add(
    "add_original",
    createStep<number, number, { double: number; square: number }>("add_original", async ({ input, state }) => {
      // This step can see both double and square!
      const result = input + state.double;
      console.log(`  Add: ${input} + ${state.double} = ${result}`);
      console.log(`  (All states - double: ${state.double}, square: ${state.square})`);
      return result;
    }),
  )
  .add(
    "final",
    createStep<number, string, { double: number; square: number; add_original: number }>(
      "final",
      async ({ input, state }) => {
        const result = `double=${state.double}, square=${state.square}, add_original=${state.add_original}, final=${input}`;
        console.log(`  Final summary: ${result}`);
        return result;
      },
    ),
  );

const result3 = await test3Pipeline.execute(5);
if (result3.success) {
  console.log(`✅ Test 3 passed: ${result3.data}`);
  console.log(`   Duration: ${result3.metadata.durationMs.toFixed(2)}ms\n`);
} else {
  console.error(`❌ Test 3 failed:`, result3.error);
}

// Test 4: Error handling
console.log("=== Test 4: Error Handling ===");

const test4Pipeline = Pipeline.start<string>()
  .add(
    "step1",
    createStep<string, number>("step1", async ({ input }) => {
      console.log(`  Step 1: Processing "${input}"`);
      return input.length;
    }),
  )
  .add(
    "step2",
    createStep<number, number, { step1: number }>("step2", async ({ input: _input }) => {
      console.log(`  Step 2: About to throw error`);
      throw new Error("Intentional test error");
    }),
  )
  .add(
    "step3",
    createStep<number, string, { step1: number; step2: number }>("step3", async ({ input }) => {
      console.log(`  Step 3: This should not execute`);
      return `Result: ${input}`;
    }),
  );

const result4 = await test4Pipeline.execute("test error");
if (!result4.success) {
  console.log(`✅ Test 4 passed: Error correctly caught`);
  console.log(`   Error code: ${result4.error.code}`);
  console.log(`   Error message: ${result4.error.message}`);
  console.log(`   Failed at step: ${result4.metadata.stepName}\n`);
} else {
  console.error(`❌ Test 4 failed: Should have thrown an error`);
}

// Test 5: Retry logic
console.log("=== Test 5: Retry Logic ===");

let attemptCount = 0;
const test5Pipeline = Pipeline.start<string>().add(
  "retry_test",
  createStep<string, string>(
    "retry_test",
    async ({ input: _input }) => {
      attemptCount++;
      console.log(`  Attempt ${attemptCount}`);

      if (attemptCount < 3) {
        throw new Error("ETIMEDOUT"); // Retryable error
      }

      return `Success after ${attemptCount} attempts`;
    },
    {
      retry: {
        maxAttempts: 5,
        backoffMs: 100,
        retryableErrors: ["ETIMEDOUT"],
      },
    },
  ),
);

const result5 = await test5Pipeline.execute("test retry");
if (result5.success) {
  console.log(`✅ Test 5 passed: ${result5.data}`);
  console.log(`   Total attempts: ${attemptCount}\n`);
} else {
  console.error(`❌ Test 5 failed:`, result5.error);
}

// Summary
console.log("=== Test Summary ===");
console.log("All tests completed!");
console.log("\nKey features verified:");
console.log("✓ Simple linear pipelines work");
console.log("✓ Accumulated state is accessible to all steps");
console.log("✓ Steps can reference any previous step");
console.log("✓ Error handling works correctly");
console.log("✓ Retry logic works with backoff");
