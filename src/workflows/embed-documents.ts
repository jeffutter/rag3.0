import { z } from "zod";
import { Pipeline } from "../core/pipeline/builder";
import { createStep } from "../core/pipeline/steps";
import { createGenerateEmbeddingsForBatchStep } from "../steps/ai/generate-embeddings-for-batch";
import { discoverFilesStep } from "../steps/io/discover-files";
import { readFileForEmbedStep } from "../steps/io/read-file-for-embed";
import { createAddEOTToChunkStep } from "../steps/utilities/add-eot-to-chunk";
import { createCleanMarkdownForEmbedStep } from "../steps/utilities/clean-markdown-for-embed";
import { extractFilesStep } from "../steps/utilities/extract-files";
import type { EmbeddedDocument } from "../steps/utilities/format-embed-output-final";
import { formatEmbedOutputFinalStep } from "../steps/utilities/format-embed-output-final";
import { createSplitMarkdownForEmbedStep } from "../steps/utilities/split-markdown-for-embed";

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

// Output schema - individual embedded document (re-export from step)
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
export type EmbedDocumentsOutput = z.infer<typeof EmbedDocumentsOutputSchema>;
// Re-export EmbeddedDocument type from the step module
export type { EmbeddedDocument };

// Interfaces are now imported from step modules

/**
 * Execute the document embedding workflow using a fully declarative pipeline.
 *
 * This implementation composes base steps directly in the pipeline without
 * creating intermediate adapter steps that call other steps.
 */
export async function embedDocuments(config: EmbedDocumentsConfig): Promise<EmbedDocumentsOutput> {
  // Validate configuration
  const validated = EmbedDocumentsConfigSchema.parse(config);

  // Create configured steps
  const cleanMarkdownStep = createCleanMarkdownForEmbedStep(validated.headingsToRemove);
  const splitMarkdownStep = createSplitMarkdownForEmbedStep({
    minChunkSize: validated.minChunkSize,
    maxChunkSize: validated.maxChunkSize,
    chunkOverlap: validated.chunkOverlap,
  });
  const addEOTStep = createAddEOTToChunkStep(validated.eotToken);
  const generateEmbeddingsStep = createGenerateEmbeddingsForBatchStep({
    endpoint: validated.embeddingEndpoint,
    model: validated.embeddingModel,
  });

  // Build the declarative pipeline
  const pipeline = Pipeline.start<{
    path: string;
    pattern?: string;
  }>()
    // Step 1: Discover all markdown files
    .add("discover", discoverFilesStep)

    // Step 2: Extract files array from discover result
    .add("files", extractFilesStep)

    // Step 3: Read each file
    .flatMap("readFiles", readFileForEmbedStep, { parallel: true })

    // Step 4: Clean markdown
    .flatMap("cleanedFiles", cleanMarkdownStep, { parallel: true })

    // Step 5: Split into chunks
    .flatMap("chunks", splitMarkdownStep, { parallel: true })

    // Step 6: Add EOT tokens to each chunk
    .map("chunksWithEOT", addEOTStep, { parallel: false })

    // Step 7: Batch chunks for API calls
    .batch("batches", validated.batchSize)

    // Step 8: Generate embeddings for each batch
    .map("embeddedBatches", generateEmbeddingsStep, { parallel: false })

    // Step 9: Flatten batches back to a single array
    .flatten("embedded")

    // Step 10: Format the final output
    .add("output", formatEmbedOutputFinalStep);

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
