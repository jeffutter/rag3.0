/**
 * Pipeline Examples Index
 *
 * This directory contains example workflows demonstrating the pipeline API.
 * Each example showcases different features and patterns.
 */

// Example 1: Data Transformation
export {
	createDataTransformationPipeline,
	type EnrichedUser,
	exampleUsers,
	type RawUser,
	runDataTransformationExample,
	type UserSummary,
} from "./01-data-transformation";

// Example 2: Web Scraping
export {
	createWebScrapingPipeline,
	type ExtractedLink,
	examplePages,
	type PageContent,
	runWebScrapingExample,
	type ScrapingContext,
	type ScrapingStats,
	type WebPage,
} from "./02-web-scraping";

// Example 3: Batch Processing
export {
	type BatchMetrics,
	createBatchProcessingPipeline,
	type Document,
	type DocumentEmbedding,
	type EmbeddingContext,
	generateExampleDocuments,
	type ProcessingReport,
	runBatchProcessingExample,
} from "./03-batch-processing";

/**
 * Run all examples
 */
export async function runAllExamples() {
	const { runDataTransformationExample } = await import(
		"./01-data-transformation"
	);
	const { runWebScrapingExample } = await import("./02-web-scraping");
	const { runBatchProcessingExample } = await import("./03-batch-processing");

	console.log(`\n${"=".repeat(60)}`);
	console.log("Running Pipeline Examples");
	console.log(`${"=".repeat(60)}\n`);

	await runDataTransformationExample();
	console.log(`\n${"=".repeat(60)}\n`);

	await runWebScrapingExample();
	console.log(`\n${"=".repeat(60)}\n`);

	await runBatchProcessingExample();
	console.log(`\n${"=".repeat(60)}\n`);

	console.log("All examples completed!");
}
