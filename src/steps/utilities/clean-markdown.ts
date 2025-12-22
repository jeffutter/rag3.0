import { z } from "zod";
import { createStep } from "../../core/pipeline/steps";
import { cleanMarkdown, DEFAULT_HEADINGS_TO_REMOVE } from "../../lib/markdown";

/**
 * Base input schema (what users provide).
 */
const CleanMarkdownInputBaseSchema = z.object({
  content: z.string(),
  headingsToRemove: z.array(z.string()).optional(),
});

/**
 * Processed input schema (after applying defaults).
 */
const CleanMarkdownInputSchema = CleanMarkdownInputBaseSchema.transform((data) => ({
  content: data.content,
  headingsToRemove: data.headingsToRemove ?? [...DEFAULT_HEADINGS_TO_REMOVE],
}));

/**
 * Output schema for the Clean Markdown step.
 */
const CleanMarkdownOutputSchema = z.object({
  content: z.string(),
  tags: z.array(z.string()),
  frontmatter: z.record(z.string(), z.any()).optional(),
});

// Type for what users provide (before transform)
type CleanMarkdownInput = z.input<typeof CleanMarkdownInputSchema>;
type CleanMarkdownOutput = z.infer<typeof CleanMarkdownOutputSchema>;

/**
 * Clean Markdown utility step for pipeline.
 *
 * This step cleans up markdown files for use in LLM context or embeddings by:
 * - Removing specified heading sections and their content
 * - Removing text formatting (bold, italic, strikethrough) while preserving text
 * - Parsing frontmatter to extract tags
 * - Processing the markdown through remark plugins
 *
 * @example
 * ```typescript
 * const pipeline = createPipeline()
 *   .pipe(cleanMarkdownStep, {
 *     content: markdownText,
 *     headingsToRemove: ['Project List', 'Tasks']
 *   });
 * ```
 */
export const cleanMarkdownStep = createStep<CleanMarkdownInput, CleanMarkdownOutput>(
  "cleanMarkdown",
  async ({ input }) => {
    // Validate input
    const validated = CleanMarkdownInputSchema.parse(input);

    // Use the markdown utility function
    const result = await cleanMarkdown(validated.content, validated.headingsToRemove);

    return result;
  },
);

// Export schemas for testing and validation
export { CleanMarkdownInputSchema, CleanMarkdownOutputSchema };
export type { CleanMarkdownInput, CleanMarkdownOutput };
