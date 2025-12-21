import { z } from "zod";
import { Pipeline } from "../core/pipeline/builder";
import { createStep } from "../core/pipeline/steps";
import { generateEmbeddingsStep } from "../steps/ai/generate-embeddings";
import { discoverFilesStep } from "../steps/io/discover-files";
import { readFileStep } from "../steps/io/read-file";
import { cleanMarkdownStep } from "../steps/utilities/clean-markdown";
import { splitMarkdownStep } from "../steps/utilities/split-markdown";

/**
 * Embed Documents Workflow
 *
 * A complete workflow that:
 * 1. Discovers markdown files in a folder
 * 2. Reads each file's content
 * 3. Cleans markdown (removes headings, formatting)
 * 4. Splits into chunks
 * 5. Batches chunks for efficient API calls
 * 6. Adds end-of-text tokens
 * 7. Generates embeddings via API
 * 8. Returns documents with vectors
 */

// Configuration schema
export const EmbedDocumentsConfigSchema = z.object({
	folderPath: z
		.string()
		.describe("Path to the folder containing markdown files"),
	pattern: z
		.string()
		.optional()
		.default("**/*.md")
		.describe("Glob pattern for file matching"),
	batchSize: z
		.number()
		.int()
		.positive()
		.optional()
		.default(50)
		.describe("Number of chunks per embedding API batch"),
	embeddingEndpoint: z
		.string()
		.url()
		.optional()
		.default("https://llama.home.jeffutter.com/v1/embeddings")
		.describe("URL of the embedding API endpoint"),
	embeddingModel: z
		.string()
		.optional()
		.default("qwen3-embedding")
		.describe("Name of the embedding model to use"),
	minChunkSize: z
		.number()
		.int()
		.positive()
		.optional()
		.default(300)
		.describe("Minimum size for document chunks"),
	maxChunkSize: z
		.number()
		.int()
		.positive()
		.optional()
		.default(1000)
		.describe("Maximum size for document chunks"),
	chunkOverlap: z
		.number()
		.int()
		.nonnegative()
		.optional()
		.default(100)
		.describe("Number of characters to overlap between chunks"),
	headingsToRemove: z
		.array(z.string())
		.optional()
		.describe("List of heading texts to remove from markdown"),
	eotToken: z
		.string()
		.optional()
		.describe(
			"End-of-text token to append to each chunk (optional, only needed for certain embedding models like qwen3)",
		),
});

// Output schema - individual embedded document
export const EmbeddedDocumentSchema = z.object({
	id: z.string().uuid().describe("Unique identifier for the chunk"),
	content: z.string().describe("The text content of the chunk"),
	vector: z.array(z.number()).describe("The embedding vector"),
	metadata: z
		.record(z.string(), z.any())
		.describe("Additional metadata from the document"),
	tags: z.array(z.string()).describe("Tags extracted from frontmatter"),
});

// Output schema - workflow result
export const EmbedDocumentsOutputSchema = z.object({
	documents: z
		.array(EmbeddedDocumentSchema)
		.describe("Array of embedded document chunks"),
	totalFiles: z
		.number()
		.int()
		.nonnegative()
		.describe("Total number of files processed"),
	totalChunks: z
		.number()
		.int()
		.nonnegative()
		.describe("Total number of chunks created"),
});

export type EmbedDocumentsConfig = z.input<typeof EmbedDocumentsConfigSchema>;
export type EmbeddedDocument = z.infer<typeof EmbeddedDocumentSchema>;
export type EmbedDocumentsOutput = z.infer<typeof EmbedDocumentsOutputSchema>;

/**
 * Interface for chunk data before embedding.
 */
interface ChunkData {
	id: string;
	content: string;
	// biome-ignore lint/suspicious/noExplicitAny: Metadata structure is dynamic and unknown
	metadata: Record<string, any>;
	tags: string[];
	index: number;
}

/**
 * Execute the document embedding workflow.
 *
 * This is a standalone async function that orchestrates all the steps
 * because the workflow needs to loop over files and batches, which doesn't
 * fit the linear Pipeline model.
 */
export async function embedDocuments(
	config: EmbedDocumentsConfig,
): Promise<EmbedDocumentsOutput> {
	// Validate configuration
	const validated = EmbedDocumentsConfigSchema.parse(config);

	// Step 1: Discover files
	const discoverPipeline = Pipeline.start<{
		path: string;
		pattern?: string;
	}>().add("discover", discoverFilesStep);

	const discoverResult = await discoverPipeline.execute({
		path: validated.folderPath,
		pattern: validated.pattern,
	});

	if (!discoverResult.success) {
		throw new Error(
			`Failed to discover files: ${discoverResult.error.message}`,
		);
	}

	const files = discoverResult.data.files;

	if (files.length === 0) {
		return {
			documents: [],
			totalFiles: 0,
			totalChunks: 0,
		};
	}

	// Step 2-4: Process each file (read, clean, split)
	const allChunks: ChunkData[] = [];

	for (const file of files) {
		try {
			// Read file
			const readPipeline = Pipeline.start<{ path: string }>().add(
				"read",
				readFileStep,
			);

			const readResult = await readPipeline.execute({ path: file.path });

			if (!readResult.success) {
				console.warn(
					`Failed to read file ${file.path}: ${readResult.error.message}`,
				);
				continue;
			}

			const { content, source } = readResult.data;

			// Clean markdown
			const cleanPipeline = Pipeline.start<{
				content: string;
				headingsToRemove?: string[];
			}>().add("clean", cleanMarkdownStep);

			const cleanResult = await cleanPipeline.execute({
				content,
				...(validated.headingsToRemove
					? { headingsToRemove: validated.headingsToRemove }
					: {}),
			});

			if (!cleanResult.success) {
				console.warn(
					`Failed to clean file ${file.path}: ${cleanResult.error.message}`,
				);
				continue;
			}

			const { content: cleanedContent, tags } = cleanResult.data;

			// Split into chunks
			const splitPipeline = Pipeline.start<{
				content: string;
				source: string;
				// biome-ignore lint/suspicious/noExplicitAny: Metadata structure is dynamic and unknown
				metadata: Record<string, any>;
				minChunkSize: number;
				maxChunkSize: number;
				chunkOverlap: number;
			}>().add("split", splitMarkdownStep);

			const splitResult = await splitPipeline.execute({
				content: cleanedContent,
				source,
				metadata: { source, tags },
				minChunkSize: validated.minChunkSize,
				maxChunkSize: validated.maxChunkSize,
				chunkOverlap: validated.chunkOverlap,
			});

			if (!splitResult.success) {
				console.warn(
					`Failed to split file ${file.path}: ${splitResult.error.message}`,
				);
				continue;
			}

			// Add chunks to collection
			for (const chunk of splitResult.data.chunks) {
				allChunks.push({
					id: chunk.id,
					content: chunk.content,
					metadata: chunk.metadata,
					tags: chunk.metadata.tags || [],
					index: chunk.index,
				});
			}
		} catch (error) {
			console.warn(`Error processing file ${file.path}:`, error);
		}
	}

	if (allChunks.length === 0) {
		return {
			documents: [],
			totalFiles: files.length,
			totalChunks: 0,
		};
	}

	// Step 5: Add end-of-text tokens to each chunk (if provided)
	const chunksWithEOT = allChunks.map((chunk) => ({
		...chunk,
		content: validated.eotToken
			? chunk.content + validated.eotToken
			: chunk.content,
	}));

	// Step 6: Batch chunks for API calls
	const batches: ChunkData[][] = [];
	for (let i = 0; i < chunksWithEOT.length; i += validated.batchSize) {
		batches.push(chunksWithEOT.slice(i, i + validated.batchSize));
	}

	// Step 7: Generate embeddings for each batch
	const embeddedDocuments: EmbeddedDocument[] = [];

	for (const batch of batches) {
		try {
			const contents = batch.map((chunk) => chunk.content);

			const embedPipeline = Pipeline.start<{
				contents: string[];
				endpoint: string;
				model: string;
			}>().add("embed", generateEmbeddingsStep);

			const embedResult = await embedPipeline.execute({
				contents,
				endpoint: validated.embeddingEndpoint,
				model: validated.embeddingModel,
			});

			if (!embedResult.success) {
				console.error(
					`Failed to generate embeddings for batch: ${embedResult.error.message}`,
				);
				continue;
			}

			const { embeddings } = embedResult.data;

			// Merge chunks with their embeddings
			for (let i = 0; i < batch.length; i++) {
				const chunk = batch[i];
				const embedding = embeddings[i];

				if (!chunk || !embedding) {
					console.error(`Missing chunk or embedding at index ${i}`);
					continue;
				}

				embeddedDocuments.push({
					id: chunk.id,
					content: chunk.content,
					vector: embedding.embedding,
					metadata: chunk.metadata,
					tags: chunk.tags,
				});
			}
		} catch (error) {
			console.error("Error generating embeddings for batch:", error);
		}
	}

	return {
		documents: embeddedDocuments,
		totalFiles: files.length,
		totalChunks: allChunks.length,
	};
}

/**
 * Create a pipeline-based wrapper for the embed documents workflow.
 * This allows it to be used in a pipeline chain if needed.
 */
export function createEmbedDocumentsPipeline() {
	const embedStep = createStep<EmbedDocumentsConfig, EmbedDocumentsOutput>(
		"embed_documents",
		async ({ input }) => {
			return await embedDocuments(input);
		},
	);

	return Pipeline.start<EmbedDocumentsConfig>().add("embed", embedStep);
}
