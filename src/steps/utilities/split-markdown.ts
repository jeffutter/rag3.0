import { z } from "zod";
import { createStep } from "../../core/pipeline/steps";
import { splitMarkdown } from "../../lib/markdown";

/**
 * Input schema for the Split Markdown step.
 */
const SplitMarkdownInputSchema = z.object({
  content: z.string(),
  source: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional().default({}),
  minChunkSize: z.number().optional().default(300),
  maxChunkSize: z.number().optional().default(1000),
  chunkOverlap: z.number().optional().default(100),
});

/**
 * Schema for individual chunks.
 */
const ChunkSchema = z.object({
  id: z.string().uuid(),
  content: z.string(),
  metadata: z.record(z.string(), z.any()),
  index: z.number(),
  length: z.number(),
});

/**
 * Output schema for the Split Markdown step.
 */
const SplitMarkdownOutputSchema = z.object({
  chunks: z.array(ChunkSchema),
});

type SplitMarkdownInput = z.input<typeof SplitMarkdownInputSchema>;
type SplitMarkdownOutput = z.infer<typeof SplitMarkdownOutputSchema>;

/**
 * Split Markdown utility step for pipeline.
 *
 * This step intelligently splits markdown files into chunks suitable for embeddings by:
 * - Using a two-stage splitting approach (markdown-aware, then character-based)
 * - Respecting markdown document structure
 * - Generating stable, deterministic UUIDs for chunks
 * - Filtering out invalid content (empty, fences, punctuation-only, standalone headings)
 * - Preserving metadata through the splitting process
 *
 * The step uses LangChain's RecursiveCharacterTextSplitter to handle:
 * - Markdown-specific separators (headers, lists, code blocks)
 * - Configurable chunk sizes and overlap
 * - Metadata preservation
 *
 * @example
 * ```typescript
 * const pipeline = createPipeline()
 *   .pipe(splitMarkdownStep, {
 *     content: markdownText,
 *     source: 'document-id',
 *     minChunkSize: 300,
 *     maxChunkSize: 1000,
 *     chunkOverlap: 100,
 *     metadata: { filename: 'example.md' }
 *   });
 * ```
 */
export const splitMarkdownStep = createStep<SplitMarkdownInput, SplitMarkdownOutput>(
  "splitMarkdown",
  async ({ input }) => {
    // Validate and apply defaults
    const validated = SplitMarkdownInputSchema.parse(input);

    // Use the markdown utility function
    const chunks = await splitMarkdown(validated.content, validated.source, validated.metadata, {
      minChunkSize: validated.minChunkSize,
      maxChunkSize: validated.maxChunkSize,
      chunkOverlap: validated.chunkOverlap,
    });

    return { chunks };
  },
);

// Export schemas for testing and validation
export { SplitMarkdownInputSchema, SplitMarkdownOutputSchema };
export type { SplitMarkdownInput, SplitMarkdownOutput };
