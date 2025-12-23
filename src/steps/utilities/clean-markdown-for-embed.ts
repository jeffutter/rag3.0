import { createStep } from "../../core/pipeline/steps";
import { cleanMarkdown } from "../../lib/markdown";
import type { FileEntry } from "./extract-files";

/**
 * Create a Clean Markdown For Embed step for pipeline.
 *
 * This step cleans markdown content while preserving source, tags, and path fields
 * for downstream processing. Returns an empty array on error to gracefully handle
 * cleaning failures. Used specifically in the embed-documents workflow.
 *
 * @param headingsToRemove - Optional list of heading texts to remove from markdown
 *
 * @example
 * ```typescript
 * const cleanStep = createCleanMarkdownForEmbedStep(['Project List', 'Tasks']);
 * const pipeline = Pipeline.start()
 *   .flatMap('cleanedFiles', cleanStep, { parallel: true });
 * ```
 */
export function createCleanMarkdownForEmbedStep(headingsToRemove?: string[]) {
  return createStep<
    { content: string; source: string; path: string },
    { content: string; source: string; tags: string[]; path: string }[],
    {
      discover: { files: FileEntry[] };
      files: FileEntry[];
      readFiles: { content: string; source: string; path: string }[];
    }
  >("cleanMarkdown", async ({ input }) => {
    try {
      const result = await cleanMarkdown(input.content, headingsToRemove);

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
  });
}
