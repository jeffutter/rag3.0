/**
 * Example 2: Parallel Web Scraping Workflow
 *
 * This example demonstrates:
 * - Parallel fetching of web pages
 * - Error handling strategies (SKIP_FAILED)
 * - flatMap() for transforming and flattening results
 * - Context usage for shared configuration
 *
 * Use case: Scraping multiple websites to extract links and metadata.
 */

import { Pipeline } from "../builder";
import { ListErrorStrategy } from "../list-adapters";
import { createStep } from "../steps";

// Types for our web scraping example
interface WebPage {
	url: string;
	priority: number;
}

interface PageContent {
	url: string;
	html: string;
	statusCode: number;
	fetchedAt: Date;
}

interface ExtractedLink {
	sourceUrl: string;
	targetUrl: string;
	text: string;
	isExternal: boolean;
}

interface ScrapingStats {
	totalPages: number;
	successfulFetches: number;
	totalLinks: number;
	internalLinks: number;
	externalLinks: number;
	domains: Set<string>;
}

// Context for our scraping pipeline
interface ScrapingContext {
	userAgent: string;
	timeout: number;
	baseDomain: string;
}

/**
 * Example: Web scraping pipeline
 *
 * This pipeline:
 * 1. Takes a list of URLs to scrape
 * 2. Fetches all pages in parallel (with error handling)
 * 3. Extracts links from each page using flatMap
 * 4. Generates statistics about the scraped data
 */
export function createWebScrapingPipeline(
	contextBuilder: () => ScrapingContext,
) {
	return (
		Pipeline.start<WebPage[], ScrapingContext>(contextBuilder)
			// Step 1: Fetch all pages in parallel
			// Use SKIP_FAILED to continue even if some pages fail to load
			.map(
				"fetchedPages",
				createStep<
					WebPage,
					PageContent,
					// biome-ignore lint/complexity/noBannedTypes: Empty state for first step
					{},
					ScrapingContext
				>("fetchPage", async ({ input, context }) => {
					const controller = new AbortController();
					const timeoutId = setTimeout(
						() => controller.abort(),
						context.timeout,
					);

					try {
						const response = await fetch(input.url, {
							signal: controller.signal,
							headers: {
								"User-Agent": context.userAgent,
							},
						});

						const html = await response.text();

						return {
							url: input.url,
							html,
							statusCode: response.status,
							fetchedAt: new Date(),
						};
					} finally {
						clearTimeout(timeoutId);
					}
				}),
				{
					parallel: true,
					concurrencyLimit: 10, // Fetch 10 pages at a time
					errorStrategy: ListErrorStrategy.SKIP_FAILED, // Continue even if some pages fail
				},
			)

			// Step 2: Extract links from each page
			// flatMap returns an array for each page and flattens them into a single array
			.flatMap(
				"extractedLinks",
				createStep<
					PageContent,
					ExtractedLink[],
					{ fetchedPages: PageContent[] },
					ScrapingContext
				>("extractLinks", async ({ input, context }) => {
					const links: ExtractedLink[] = [];

					// Simple regex-based link extraction (in production, use a proper HTML parser)
					const linkRegex =
						/<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>(.*?)<\/a>/gi;
					let match: RegExpExecArray | null;

					// biome-ignore lint/suspicious/noAssignInExpressions: Standard regex pattern matching
					while ((match = linkRegex.exec(input.html)) !== null) {
						const [, href, text] = match;
						if (!href || !text) continue;

						// Resolve relative URLs
						let targetUrl: string;
						try {
							targetUrl = new URL(href, input.url).href;
						} catch {
							continue; // Skip invalid URLs
						}

						// Determine if link is external
						const targetDomain = new URL(targetUrl).hostname;
						const isExternal = !targetDomain.includes(context.baseDomain);

						links.push({
							sourceUrl: input.url,
							targetUrl,
							text: text.trim(),
							isExternal,
						});
					}

					return links;
				}),
				{
					parallel: true,
					concurrencyLimit: 5,
					errorStrategy: ListErrorStrategy.SKIP_FAILED,
				},
			)

			// Step 3: Generate statistics
			.add(
				"stats",
				createStep<
					ExtractedLink[],
					ScrapingStats,
					{
						fetchedPages: PageContent[];
						extractedLinks: ExtractedLink[];
					}
				>("generateStats", async ({ input, state }) => {
					const domains = new Set<string>();

					let internalLinks = 0;
					let externalLinks = 0;

					for (const link of input) {
						if (link.isExternal) {
							externalLinks++;
						} else {
							internalLinks++;
						}

						try {
							const domain = new URL(link.targetUrl).hostname;
							domains.add(domain);
						} catch {
							// Skip invalid URLs
						}
					}

					return {
						totalPages: state.fetchedPages.length,
						successfulFetches: state.fetchedPages.filter(
							(p) => p.statusCode === 200,
						).length,
						totalLinks: input.length,
						internalLinks,
						externalLinks,
						domains,
					};
				}),
			)
	);
}

/**
 * Example URLs for testing
 */
export const examplePages: WebPage[] = [
	{ url: "https://example.com", priority: 1 },
	{ url: "https://example.com/about", priority: 2 },
	{ url: "https://example.com/contact", priority: 2 },
	{ url: "https://example.com/blog", priority: 3 },
	{ url: "https://example.com/products", priority: 1 },
];

/**
 * Run the example
 */
export async function runWebScrapingExample() {
	console.log("=== Web Scraping Example ===\n");

	const context: ScrapingContext = {
		userAgent: "Mozilla/5.0 (compatible; ExampleBot/1.0)",
		timeout: 5000, // 5 second timeout
		baseDomain: "example.com",
	};

	const pipeline = createWebScrapingPipeline(() => context);
	const result = await pipeline.execute(examplePages);

	if (result.success) {
		console.log("Scraping Stats:", {
			...result.data,
			domains: Array.from(result.data.domains),
		});
		console.log("\nPipeline completed in:", result.metadata.durationMs, "ms");

		return result.data;
	}

	console.error("Pipeline failed:", result.error);
	return null;
}

// Export types for documentation
export type {
	WebPage,
	PageContent,
	ExtractedLink,
	ScrapingStats,
	ScrapingContext,
};
