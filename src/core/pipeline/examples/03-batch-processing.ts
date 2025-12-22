/**
 * Example 3: Batch Processing Workflow
 *
 * This example demonstrates:
 * - batch(): Grouping items into chunks for efficient processing
 * - Processing batches in parallel
 * - flatten(): Recombining batch results into a single array
 * - Real-world use case: Embedding generation with API rate limits
 *
 * Use case: Generating embeddings for a large number of documents
 * while respecting API batch size limits and rate limits.
 */

import { Pipeline } from "../builder";
import { ListErrorStrategy } from "../list-adapters";
import { createStep } from "../steps";

// Types for our batch processing example
interface Document {
	id: string;
	content: string;
	metadata: {
		source: string;
		timestamp: Date;
	};
}

interface DocumentEmbedding {
	documentId: string;
	embedding: number[];
	model: string;
	dimensions: number;
}

interface BatchMetrics {
	batchId: string;
	itemCount: number;
	processingTimeMs: number;
	avgItemTimeMs: number;
}

interface ProcessingReport {
	totalDocuments: number;
	totalBatches: number;
	successfulEmbeddings: number;
	failedEmbeddings: number;
	totalProcessingTimeMs: number;
	batchMetrics: BatchMetrics[];
	avgEmbeddingDimensions: number;
}

// Context for our batch processing pipeline
interface EmbeddingContext {
	apiKey: string;
	baseURL: string;
	model: string;
	batchSize: number;
	rateLimitDelayMs: number;
}

/**
 * Example: Batch processing pipeline for embeddings
 *
 * This pipeline:
 * 1. Takes a large list of documents
 * 2. Batches them into chunks (e.g., 10 documents per batch)
 * 3. Processes each batch in parallel (respecting rate limits)
 * 4. Flattens the results back into a single array
 * 5. Generates a processing report
 */
export function createBatchProcessingPipeline(
	contextBuilder: () => EmbeddingContext,
) {
	return (
		Pipeline.start<Document[], EmbeddingContext>(contextBuilder)
			// Step 1: Batch documents into chunks
			.batch("batches", 10) // Group into batches of 10

			// Step 2: Process each batch
			// Each batch returns an array of embeddings
			.map(
				"batchResults",
				createStep<
					Document[],
					{ embeddings: DocumentEmbedding[]; metrics: BatchMetrics },
					{ batches: Document[][] },
					EmbeddingContext
				>("processBatch", async ({ input, context }) => {
					const batchId = crypto.randomUUID().slice(0, 8);
					const startTime = performance.now();

					// Simulate rate limiting delay
					if (context.rateLimitDelayMs > 0) {
						await Bun.sleep(context.rateLimitDelayMs);
					}

					// In a real scenario, this would call an actual embedding API
					// For this example, we'll simulate the API call
					const embeddings: DocumentEmbedding[] = [];

					for (const doc of input) {
						// Simulate embedding generation
						// In production, you'd batch these into a single API call
						const embedding = await generateMockEmbedding(
							doc.content,
							context.model,
						);

						embeddings.push({
							documentId: doc.id,
							embedding,
							model: context.model,
							dimensions: embedding.length,
						});
					}

					const endTime = performance.now();
					const processingTimeMs = endTime - startTime;

					const metrics: BatchMetrics = {
						batchId,
						itemCount: input.length,
						processingTimeMs,
						avgItemTimeMs: processingTimeMs / input.length,
					};

					return { embeddings, metrics };
				}),
				{
					parallel: true,
					concurrencyLimit: 3, // Process 3 batches at a time
					errorStrategy: ListErrorStrategy.SKIP_FAILED,
				},
			)

			// Step 3: Extract embeddings and flatten
			.map(
				"embeddingArrays",
				createStep<
					{ embeddings: DocumentEmbedding[]; metrics: BatchMetrics },
					DocumentEmbedding[],
					{
						batches: Document[][];
						batchResults: Array<{
							embeddings: DocumentEmbedding[];
							metrics: BatchMetrics;
						}>;
					}
				>("extractEmbeddings", async ({ input }) => {
					return input.embeddings;
				}),
			)
			.flatten("allEmbeddings")

			// Step 4: Generate processing report
			.add(
				"report",
				createStep<
					DocumentEmbedding[],
					ProcessingReport,
					{
						batches: Document[][];
						batchResults: Array<{
							embeddings: DocumentEmbedding[];
							metrics: BatchMetrics;
						}>;
						embeddingArrays: DocumentEmbedding[][];
						allEmbeddings: DocumentEmbedding[];
					},
					EmbeddingContext
				>("generateReport", async ({ input, state, context: _context }) => {
					const totalDocuments =
						state.batches.reduce((sum, batch) => sum + batch.length, 0) || 0;
					const totalBatches = state.batches.length;
					const successfulEmbeddings = input.length;
					const failedEmbeddings = totalDocuments - successfulEmbeddings;

					const batchMetrics = state.batchResults.map((r) => r.metrics);
					const totalProcessingTimeMs = batchMetrics.reduce(
						(sum, m) => sum + m.processingTimeMs,
						0,
					);

					const avgEmbeddingDimensions =
						input.length > 0
							? input.reduce((sum, e) => sum + e.dimensions, 0) / input.length
							: 0;

					return {
						totalDocuments,
						totalBatches,
						successfulEmbeddings,
						failedEmbeddings,
						totalProcessingTimeMs,
						batchMetrics,
						avgEmbeddingDimensions,
					};
				}),
			)
	);
}

/**
 * Mock function to simulate embedding generation
 * In production, this would call an actual embedding API
 */
async function generateMockEmbedding(
	text: string,
	model: string,
): Promise<number[]> {
	// Simulate API delay
	await Bun.sleep(Math.random() * 50 + 50);

	// Generate a mock embedding (in production, this comes from the API)
	const dimensions = model.includes("large") ? 1536 : 768;
	const embedding: number[] = [];

	// Simple deterministic embedding based on text hash
	let hash = 0;
	for (let i = 0; i < text.length; i++) {
		hash = (hash << 5) - hash + text.charCodeAt(i);
		hash = hash & hash; // Convert to 32bit integer
	}

	for (let i = 0; i < dimensions; i++) {
		// Use a pseudo-random value based on the hash
		const seed = hash + i;
		embedding.push((Math.sin(seed) + 1) / 2); // Normalize to [0, 1]
	}

	return embedding;
}

/**
 * Generate example documents for testing
 */
export function generateExampleDocuments(count: number): Document[] {
	const sources = ["docs", "blog", "wiki", "support"];
	const documents: Document[] = [];

	for (let i = 0; i < count; i++) {
		documents.push({
			id: `doc-${i + 1}`,
			content: `This is document ${i + 1}. It contains important information about topic ${Math.floor(i / 5) + 1}.`,
			metadata: {
				source: sources[i % sources.length] || "docs",
				timestamp: new Date(
					Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
				), // Random date in last 30 days
			},
		});
	}

	return documents;
}

/**
 * Run the example
 */
export async function runBatchProcessingExample() {
	console.log("=== Batch Processing Example ===\n");

	const context: EmbeddingContext = {
		apiKey: "mock-api-key",
		baseURL: "https://api.example.com",
		model: "text-embedding-large",
		batchSize: 10,
		rateLimitDelayMs: 100, // 100ms delay between batches
	};

	const documents = generateExampleDocuments(37); // Intentionally not a multiple of batch size

	console.log(`Processing ${documents.length} documents...`);

	const pipeline = createBatchProcessingPipeline(() => context);
	const result = await pipeline.execute(documents);

	if (result.success) {
		const report = result.data;

		console.log("\nProcessing Report:");
		console.log("  Total Documents:", report.totalDocuments);
		console.log("  Total Batches:", report.totalBatches);
		console.log("  Successful Embeddings:", report.successfulEmbeddings);
		console.log("  Failed Embeddings:", report.failedEmbeddings);
		console.log(
			"  Total Processing Time:",
			report.totalProcessingTimeMs.toFixed(2),
			"ms",
		);
		console.log(
			"  Avg Embedding Dimensions:",
			report.avgEmbeddingDimensions.toFixed(0),
		);

		console.log("\nBatch Metrics:");
		for (const batch of report.batchMetrics) {
			console.log(
				`  Batch ${batch.batchId}: ${batch.itemCount} items, ${batch.processingTimeMs.toFixed(2)}ms (${batch.avgItemTimeMs.toFixed(2)}ms/item)`,
			);
		}

		console.log("\nPipeline completed in:", result.metadata.durationMs, "ms");

		return report;
	}

	console.error("Pipeline failed:", result.error);
	return null;
}

// Export types for documentation
export type {
	Document,
	DocumentEmbedding,
	BatchMetrics,
	ProcessingReport,
	EmbeddingContext,
};
