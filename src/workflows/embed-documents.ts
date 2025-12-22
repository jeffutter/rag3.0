import { z } from "zod";
import { Pipeline } from "../core/pipeline/builder";
import { createStep } from "../core/pipeline/steps";
import { generateEmbeddings } from "../lib/embeddings";
import { readFile } from "../lib/file-io";
import { cleanMarkdown, splitMarkdown } from "../lib/markdown";
import { addEOT } from "../lib/text-processing";
import { discoverFilesStep } from "../steps/io/discover-files";

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
  folderPath: z.string().describe("Path to the folder containing markdown files"),
  pattern: z.string().optional().default("**/*.md").describe("Glob pattern for file matching"),
  batchSize: z.number().int().positive().optional().default(50).describe("Number of chunks per embedding API batch"),
  embeddingEndpoint: z
    .string()
    .url()
    .optional()
    .default("https://llama.home.jeffutter.com/v1/embeddings")
    .describe("URL of the embedding API endpoint"),
  embeddingModel: z.string().optional().default("qwen3-embedding").describe("Name of the embedding model to use"),
  minChunkSize: z.number().int().positive().optional().default(300).describe("Minimum size for document chunks"),
  maxChunkSize: z.number().int().positive().optional().default(1000).describe("Maximum size for document chunks"),
  chunkOverlap: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .default(100)
    .describe("Number of characters to overlap between chunks"),
  headingsToRemove: z.array(z.string()).optional().describe("List of heading texts to remove from markdown"),
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
  metadata: z.record(z.string(), z.any()).describe("Additional metadata from the document"),
  tags: z.array(z.string()).describe("Tags extracted from frontmatter"),
});

// Output schema - workflow result
export const EmbedDocumentsOutputSchema = z.object({
  documents: z.array(EmbeddedDocumentSchema).describe("Array of embedded document chunks"),
  totalFiles: z.number().int().nonnegative().describe("Total number of files processed"),
  totalChunks: z.number().int().nonnegative().describe("Total number of chunks created"),
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
 * Interface for chunk data from split markdown step.
 */
interface ChunkData {
  id: string;
  content: string;
  // biome-ignore lint/suspicious/noExplicitAny: Metadata structure is dynamic and unknown
  metadata: Record<string, any>;
  index: number;
  length: number;
}

/**
 * Interface for chunk with embedding attached.
 */
interface ChunkWithEmbedding {
  id: string;
  content: string;
  // biome-ignore lint/suspicious/noExplicitAny: Metadata structure is dynamic and unknown
  metadata: Record<string, any>;
  embedding: number[];
}

/**
 * Execute the document embedding workflow using a fully declarative pipeline.
 *
 * This implementation composes base steps directly in the pipeline without
 * creating intermediate adapter steps that call other steps.
 */
export async function embedDocuments(config: EmbedDocumentsConfig): Promise<EmbedDocumentsOutput> {
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
      createStep<{ files: FileEntry[] }, FileEntry[], { discover: { files: FileEntry[] } }>(
        "extractFiles",
        async ({ input }) => {
          return input.files;
        },
      ),
    )

    // Step 3: Read each file
    .flatMap(
      "readFiles",
      createStep<
        FileEntry,
        { content: string; source: string; path: string }[],
        { discover: { files: FileEntry[] }; files: FileEntry[] }
      >("readFile", async ({ input }) => {
        try {
          const result = await readFile(input.path);
          return [{ ...result, path: input.path }];
        } catch (error) {
          console.warn(`Error reading file ${input.path}:`, error);
          return [];
        }
      }),
      { parallel: true },
    )

    // Step 4: Clean markdown
    .flatMap(
      "cleanedFiles",
      createStep<
        { content: string; source: string; path: string },
        { content: string; source: string; tags: string[]; path: string }[],
        {
          discover: { files: FileEntry[] };
          files: FileEntry[];
          readFiles: { content: string; source: string; path: string }[];
        }
      >("cleanMarkdown", async ({ input }) => {
        try {
          const result = await cleanMarkdown(input.content, validated.headingsToRemove);

          return [
            {
              content: result.content,
              source: input.source,
              tags: result.tags,
              path: input.path,
            },
          ];
        } catch (error) {
          console.warn(`Error cleaning file ${input.path}:`, error);
          return [];
        }
      }),
      { parallel: true },
    )

    // Step 5: Split into chunks
    .flatMap(
      "chunks",
      createStep<
        { content: string; source: string; tags: string[]; path: string },
        ChunkData[],
        {
          discover: { files: FileEntry[] };
          files: FileEntry[];
          readFiles: { content: string; source: string; path: string }[];
          cleanedFiles: { content: string; source: string; tags: string[]; path: string }[];
        }
      >("splitMarkdown", async ({ input }) => {
        try {
          const chunks = await splitMarkdown(
            input.content,
            input.source,
            { source: input.source, tags: input.tags },
            {
              minChunkSize: validated.minChunkSize,
              maxChunkSize: validated.maxChunkSize,
              chunkOverlap: validated.chunkOverlap,
            },
          );

          return chunks;
        } catch (error) {
          console.warn(`Error splitting file ${input.path}:`, error);
          return [];
        }
      }),
      { parallel: true },
    )

    // Step 6: Add EOT tokens to each chunk
    .map(
      "chunksWithEOT",
      createStep<
        ChunkData,
        ChunkData,
        {
          discover: { files: FileEntry[] };
          files: FileEntry[];
          readFiles: { content: string; source: string; path: string }[];
          cleanedFiles: { content: string; source: string; tags: string[]; path: string }[];
          chunks: ChunkData[];
        }
      >("addEOT", async ({ input }) => {
        // If no EOT token configured, return chunk as-is
        if (!validated.eotToken) {
          return input;
        }

        try {
          const content = addEOT(input.content, validated.eotToken);

          return {
            ...input,
            content,
          };
        } catch (error) {
          console.warn(`Error adding EOT to chunk ${input.id}:`, error);
          return input;
        }
      }),
      { parallel: false },
    )

    // Step 7: Batch chunks for API calls
    .batch("batches", validated.batchSize)

    // Step 8: Generate embeddings for each batch
    .map(
      "embeddedBatches",
      createStep<
        ChunkData[],
        ChunkWithEmbedding[],
        {
          discover: { files: FileEntry[] };
          files: FileEntry[];
          readFiles: { content: string; source: string; path: string }[];
          cleanedFiles: { content: string; source: string; tags: string[]; path: string }[];
          chunks: ChunkData[];
          chunksWithEOT: ChunkData[];
          batches: ChunkData[][];
        }
      >("generateEmbeddings", async ({ input }) => {
        try {
          const contents = input.map((chunk) => chunk.content);

          const embeddings = await generateEmbeddings(contents, validated.embeddingEndpoint, validated.embeddingModel);

          // Merge chunks with their embeddings
          return input
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
                embedding: embedding.embedding,
              };
            })
            .filter((chunk): chunk is ChunkWithEmbedding => chunk !== null);
        } catch (error) {
          console.error("Error generating embeddings for batch:", error);
          return [];
        }
      }),
      { parallel: false },
    )

    // Step 9: Flatten batches back to a single array
    .flatten("embedded")

    // Step 10: Format the final output
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
          readFiles: { content: string; source: string; path: string }[];
          cleanedFiles: { content: string; source: string; tags: string[]; path: string }[];
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
          tags: (chunk.metadata.tags as string[]) || [],
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
  const embedStep = createStep<EmbedDocumentsConfig, EmbedDocumentsOutput>("embed_documents", async ({ input }) => {
    return await embedDocuments(input);
  });

  return Pipeline.start<EmbedDocumentsConfig>().add("embed", embedStep);
}
