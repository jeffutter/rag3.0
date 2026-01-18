/**
 * Example: Progress Tracking with Streaming Pipelines
 *
 * This example demonstrates how to use the progress tracking feature
 * to monitor pipeline execution with a graphical terminal indicator.
 *
 * Run with: bun src/core/pipeline/examples/streaming/07-progress-tracking.ts
 */

import { createProgressRenderer, createProgressTracker } from "../../progress";
import { fromArray, toArray } from "../../streaming/generators";
import { StreamingPipeline } from "../../streaming-builder";

/**
 * Simulate a document processing pipeline similar to embed-documents.
 */
async function main() {
  console.log("Progress Tracking Example");
  console.log("=========================\n");

  // Create sample documents
  const documents = Array.from({ length: 20 }, (_, i) => ({
    id: `doc-${i + 1}`,
    content: `This is the content of document ${i + 1}. It has some text that will be processed.`,
    metadata: { index: i },
  }));

  // Create progress tracker and renderer
  const tracker = createProgressTracker();
  const renderer = createProgressRenderer(tracker, {
    mode: "verbose",
    showETA: true,
    showThroughput: true,
  });

  // Build a pipeline that simulates document processing
  const pipeline = StreamingPipeline.start<{ id: string; content: string; metadata: { index: number } }>()
    // Step 1: Parse documents (simulated)
    .map("parse", async (doc) => {
      await delay(50); // Simulate parsing time
      return {
        ...doc,
        parsed: true,
        words: doc.content.split(" "),
      };
    })
    // Step 2: Split into chunks (expansion)
    .flatMap("chunk", (doc) => {
      // Split content into chunks of ~5 words
      const chunks: Array<{ docId: string; chunkIndex: number; text: string }> = [];
      const words = doc.words;
      for (let i = 0; i < words.length; i += 5) {
        chunks.push({
          docId: doc.id,
          chunkIndex: Math.floor(i / 5),
          text: words.slice(i, i + 5).join(" "),
        });
      }
      return chunks;
    })
    // Step 3: Batch chunks for processing
    .batch("batch", 10)
    // Step 4: Process each batch (simulated embedding)
    .map("embed", async (batch) => {
      await delay(100); // Simulate API call
      return batch.map((chunk) => ({
        ...chunk,
        embedding: Array(8).fill(0.1), // Fake embedding vector
      }));
    })
    // Step 5: Flatten back to individual chunks
    .flatMap("flatten", (batch) => batch)
    // Step 6: Filter out short chunks
    .filter("filter", (chunk) => chunk.text.length > 10);

  // Start the renderer
  renderer.start();

  try {
    // Execute the pipeline with progress tracking
    const input = fromArray(documents);
    const results = await toArray(pipeline.executeWithProgress(input, tracker));

    // Stop the renderer
    renderer.stop();

    // Print summary
    console.log(tracker.generateSummary());

    console.log(`\nProcessed ${documents.length} documents into ${results.length} embedded chunks.`);
  } catch (error) {
    renderer.stop();
    console.error("Pipeline failed:", error);
  }
}

/**
 * Helper to create a delay.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Run the example
main().catch(console.error);
