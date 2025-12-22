import { Glob } from "bun";
import { z } from "zod";
import { createStep } from "../../core/pipeline/steps";

/**
 * Input schema for the Discover Files step.
 */
const DiscoverFilesInputSchema = z.object({
  path: z.string(),
  pattern: z.string().default("**/*.md"),
});

/**
 * Schema for individual file entries.
 */
const FileEntrySchema = z.object({
  path: z.string(),
  name: z.string(),
});

/**
 * Output schema for the Discover Files step.
 */
const DiscoverFilesOutputSchema = z.object({
  files: z.array(FileEntrySchema),
});

type DiscoverFilesInput = z.input<typeof DiscoverFilesInputSchema>;
type DiscoverFilesOutput = z.infer<typeof DiscoverFilesOutputSchema>;

/**
 * Discover Files step for pipeline.
 *
 * This step discovers files matching a glob pattern in a specified directory.
 * Supports recursive directory traversal and flexible pattern matching.
 *
 * @example
 * ```typescript
 * const pipeline = Pipeline.start<DiscoverFilesInput>()
 *   .add('discover', discoverFilesStep);
 *
 * const result = await pipeline.execute({
 *   path: './docs',
 *   pattern: '**\/*.md'
 * });
 * ```
 */
export const discoverFilesStep = createStep<DiscoverFilesInput, DiscoverFilesOutput>(
  "discoverFiles",
  async ({ input }) => {
    // Validate input
    const validated = DiscoverFilesInputSchema.parse(input);

    // Use Bun's Glob API to find files matching pattern
    const glob = new Glob(validated.pattern);
    const files: Array<{ path: string; name: string }> = [];

    // Scan the directory
    for await (const file of glob.scan({
      cwd: validated.path,
      absolute: false,
    })) {
      // Get the absolute path
      const absolutePath = `${validated.path}/${file}`;

      // Extract filename from path
      const name = file.split("/").pop() || file;

      files.push({
        path: absolutePath,
        name,
      });
    }

    return { files };
  },
);

// Export schemas for testing and validation
export { DiscoverFilesInputSchema, DiscoverFilesOutputSchema };
export type { DiscoverFilesInput, DiscoverFilesOutput };
