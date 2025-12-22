import { z } from "zod";
import { Pipeline } from "../core/pipeline/builder";
import { createStep } from "../core/pipeline/steps";
import { generateEmbeddingsStep } from "../steps/ai/generate-embeddings";
import { discoverFilesStep } from "../steps/io/discover-files";
import { readFileStep } from "../steps/io/read-file";
import { addEOTStep } from "../steps/utilities/add-eot";
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
 * Interface for file entries from discovery.
 */
interface FileEntry {
	path: string;
	name: string;
}

/**
 * Interface for chunk data with all necessary metadata.
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
 * Interface for chunk with embedding attached.
 */
interface ChunkWithEmbedding extends ChunkData {
	embedding: number[];
}

/**
 * Adapter step: Read and process a single file.
 * Takes a file entry and returns processed chunks with metadata.
 */
const processFileStep = createStep<
	FileEntry & {
		headingsToRemove?: string[] | undefined;
		minChunkSize: number;
		maxChunkSize: number;
		chunkOverlap: number;
	},
	ChunkData[]
>("processFile", async ({ input }) => {
	try {
		// Read file
		const readResult = await readFileStep.execute({
			input: { path: input.path },
			state: {},
			context: undefined,
		});

		if (!readResult.success) {
			console.warn(
				`Failed to read file ${input.path}: ${readResult.error.message}`,
			);
			return [];
		}

		const { content, source } = readResult.data;

		// Clean markdown
		const cleanResult = await cleanMarkdownStep.execute({
			input: {
				content,
				...(input.headingsToRemove
					? { headingsToRemove: input.headingsToRemove }
					: {}),
			},
			state: {},
			context: undefined,
		});

		if (!cleanResult.success) {
			console.warn(
				`Failed to clean file ${input.path}: ${cleanResult.error.message}`,
			);
			return [];
		}

		const { content: cleanedContent, tags } = cleanResult.data;

		// Split into chunks
		const splitResult = await splitMarkdownStep.execute({
			input: {
				content: cleanedContent,
				source,
				metadata: { source, tags },
				minChunkSize: input.minChunkSize,
				maxChunkSize: input.maxChunkSize,
				chunkOverlap: input.chunkOverlap,
			},
			state: {},
			context: undefined,
		});

		if (!splitResult.success) {
			console.warn(
				`Failed to split file ${input.path}: ${splitResult.error.message}`,
			);
			return [];
		}

		// Map chunks to ChunkData format
		return splitResult.data.chunks.map((chunk) => ({
			id: chunk.id,
			content: chunk.content,
			metadata: chunk.metadata,
			tags: chunk.metadata.tags || [],
			index: chunk.index,
		}));
	} catch (error) {
		console.warn(`Error processing file ${input.path}:`, error);
		return [];
	}
});

/**
 * Adapter step: Add EOT token to a chunk.
 */
const addEOTToChunkStep = createStep<
	ChunkData & { eotToken?: string | undefined },
	ChunkData
>("addEOTToChunk", async ({ input }) => {
	if (!input.eotToken) {
		return {
			id: input.id,
			content: input.content,
			metadata: input.metadata,
			tags: input.tags,
			index: input.index,
		};
	}

	const eotResult = await addEOTStep.execute({
		input: {
			content: input.content,
			eotToken: input.eotToken,
		},
		state: {},
		context: undefined,
	});

	if (!eotResult.success) {
		// If EOT fails, just return the original content
		return {
			id: input.id,
			content: input.content,
			metadata: input.metadata,
			tags: input.tags,
			index: input.index,
		};
	}

	return {
		id: input.id,
		content: eotResult.data.content,
		metadata: input.metadata,
		tags: input.tags,
		index: input.index,
	};
});

/**
 * Adapter step: Generate embeddings for a batch of chunks.
 */
const embedBatchStep = createStep<
	{
		chunks: ChunkData[];
		endpoint: string;
		model: string;
	},
	ChunkWithEmbedding[]
>("embedBatch", async ({ input }) => {
	try {
		const contents = input.chunks.map((chunk) => chunk.content);

		const embedResult = await generateEmbeddingsStep.execute({
			input: {
				contents,
				endpoint: input.endpoint,
				model: input.model,
			},
			state: {},
			context: undefined,
		});

		if (!embedResult.success) {
			console.error(
				`Failed to generate embeddings for batch: ${embedResult.error.message}`,
			);
			return [];
		}

		const { embeddings } = embedResult.data;

		// Merge chunks with their embeddings
		return input.chunks
			.map((chunk, i) => {
				const embedding = embeddings[i];
				if (!embedding) {
					console.error(`Missing embedding at index ${i}`);
					return null;
				}

				return {
					id: chunk.id,
					content: chunk.content,
					metadata: chunk.metadata,
					tags: chunk.tags,
					index: chunk.index,
					embedding: embedding.embedding,
				};
			})
			.filter((chunk): chunk is ChunkWithEmbedding => chunk !== null);
	} catch (error) {
		console.error("Error generating embeddings for batch:", error);
		return [];
	}
});

/**
 * Execute the document embedding workflow using a fully declarative pipeline.
 *
 * This implementation uses zero manual loops - all iteration is handled
 * declaratively through map, flatMap, batch, and flatten operations.
 */
export async function embedDocuments(
	config: EmbedDocumentsConfig,
): Promise<EmbedDocumentsOutput> {
	// Validate configuration
	const validated = EmbedDocumentsConfigSchema.parse(config);

	// Build the declarative pipeline
	const pipeline = Pipeline.start<{
		path: string;
		pattern?: string;
	}>()
		// Step 1: Discover all markdown files
		.add("discover", discoverFilesStep)

		// Step 2: Extract files array from discover result
		.add(
			"files",
			createStep<
				{ files: FileEntry[] },
				FileEntry[],
				{ discover: { files: FileEntry[] } }
			>("extractFiles", async ({ input }) => {
				return input.files;
			}),
		)

		// Step 3: Process each file in parallel (read, clean, split)
		.flatMap(
			"chunks",
			createStep<
				FileEntry,
				ChunkData[],
				{ discover: { files: FileEntry[] }; files: FileEntry[] }
			>("processFileAdapter", async ({ input }) => {
				return await processFileStep
					.execute({
						input: {
							...input,
							headingsToRemove: validated.headingsToRemove,
							minChunkSize: validated.minChunkSize,
							maxChunkSize: validated.maxChunkSize,
							chunkOverlap: validated.chunkOverlap,
						},
						state: {},
						context: undefined,
					})
					.then((r) => (r.success ? r.data : []));
			}),
			{ parallel: true },
		)

		// Step 4: Add EOT tokens to each chunk
		.map(
			"chunksWithEOT",
			createStep<
				ChunkData,
				ChunkData,
				{
					discover: { files: FileEntry[] };
					files: FileEntry[];
					chunks: ChunkData[];
				}
			>("addEOTAdapter", async ({ input }) => {
				return await addEOTToChunkStep
					.execute({
						input: {
							...input,
							eotToken: validated.eotToken,
						},
						state: {},
						context: undefined,
					})
					.then((r) => (r.success ? r.data : input));
			}),
			{ parallel: false },
		)

		// Step 5: Batch chunks for API calls
		.batch("batches", validated.batchSize)

		// Step 6: Generate embeddings for each batch
		.map(
			"embeddedBatches",
			createStep<
				ChunkData[],
				ChunkWithEmbedding[],
				{
					discover: { files: FileEntry[] };
					files: FileEntry[];
					chunks: ChunkData[];
					chunksWithEOT: ChunkData[];
					batches: ChunkData[][];
				}
			>("embedBatchAdapter", async ({ input }) => {
				return await embedBatchStep
					.execute({
						input: {
							chunks: input,
							endpoint: validated.embeddingEndpoint,
							model: validated.embeddingModel,
						},
						state: {},
						context: undefined,
					})
					.then((r) => (r.success ? r.data : []));
			}),
			{ parallel: false },
		)

		// Step 7: Flatten batches back to a single array
		.flatten("embedded")

		// Step 8: Format the final output
		.add(
			"output",
			createStep<
				ChunkWithEmbedding[],
				{
					documents: EmbeddedDocument[];
					totalFiles: number;
					totalChunks: number;
				},
				{
					discover: { files: FileEntry[] };
					files: FileEntry[];
					chunks: ChunkData[];
					chunksWithEOT: ChunkData[];
					batches: ChunkData[][];
					embeddedBatches: ChunkWithEmbedding[][];
					embedded: ChunkWithEmbedding[];
				}
			>("formatOutput", async ({ input, state }) => {
				// Get total files from the files step
				const files = state.files;

				// Convert chunks with embeddings to embedded documents
				const documents: EmbeddedDocument[] = input.map((chunk) => ({
					id: chunk.id,
					content: chunk.content,
					vector: chunk.embedding,
					metadata: chunk.metadata,
					tags: chunk.tags,
				}));

				// Get total chunks from the chunks step (before EOT)
				const allChunks = state.chunks;

				return {
					documents,
					totalFiles: files.length,
					totalChunks: allChunks.length,
				};
			}),
		);

	// Execute the pipeline
	const result = await pipeline.execute({
		path: validated.folderPath,
		pattern: validated.pattern,
	});

	if (!result.success) {
		throw new Error(`Pipeline failed: ${result.error.message}`);
	}

	return result.data;
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
