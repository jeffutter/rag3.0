import matter from "gray-matter";
import type { Delete, Emphasis, Heading, Root, Strong } from "mdast";
import { remark } from "remark";
import remarkGfm from "remark-gfm";
import { SKIP, visit } from "unist-util-visit";
import { z } from "zod";
import { createStep } from "../../core/pipeline/steps";

/**
 * Default headings to remove from markdown documents.
 * These are typically task management and workflow-related sections
 * that don't add value in LLM context or embeddings.
 */
const DEFAULT_HEADINGS_TO_REMOVE = [
	"Project List",
	"Due Today",
	"Todoist Tasks",
	"Daily Reading",
	"Completed Today",
	"Habit",
	"Jira Tickets",
	"Task",
	"Bullet",
	"File",
] as const;

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
const CleanMarkdownInputSchema = CleanMarkdownInputBaseSchema.transform(
	(data) => ({
		content: data.content,
		headingsToRemove: data.headingsToRemove ?? [...DEFAULT_HEADINGS_TO_REMOVE],
	}),
);

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
 * Interface for sections to be removed from the markdown tree.
 */
interface RemovalRange {
	startIndex: number;
	endIndex: number;
}

/**
 * Remark plugin to remove specified heading sections from the markdown tree.
 *
 * This plugin removes both the heading AND all content until the next heading
 * of the same or higher level (lower depth value).
 *
 * @param headingsToRemove - Array of heading text strings to remove
 */
function removeHeadings(headingsToRemove: string[]) {
	return (tree: Root) => {
		const indicesToRemove: RemovalRange[] = [];

		visit(tree, "heading", (node: Heading, index, parent) => {
			if (index === null || index === undefined || !parent) {
				return;
			}

			// Get the heading text by concatenating all text children
			const headingText = node.children
				.filter((child) => child.type === "text")
				.map((child) => ("value" in child ? child.value : ""))
				.join("");

			// Check if this heading should be removed
			if (headingsToRemove.includes(headingText)) {
				// Find the range to remove (heading + all content until next heading of same/higher level)
				const startIndex = index;
				let endIndex = index;

				// Look for the next heading at the same or higher level (lower or equal depth)
				for (let i = index + 1; i < parent.children.length; i++) {
					const nextNode = parent.children[i];
					if (
						nextNode &&
						nextNode.type === "heading" &&
						(nextNode as Heading).depth <= node.depth
					) {
						break;
					}
					endIndex = i;
				}

				indicesToRemove.push({ startIndex, endIndex });
			}
		});

		// Remove sections in reverse order to maintain correct indices
		indicesToRemove.reverse().forEach(({ startIndex, endIndex }) => {
			tree.children.splice(startIndex, endIndex - startIndex + 1);
		});
	};
}

/**
 * Remark plugin to remove text formatting while preserving content.
 *
 * This plugin removes:
 * - Emphasis (italic) nodes
 * - Strong (bold) nodes
 * - Delete (strikethrough) nodes
 *
 * It does NOT remove:
 * - Links (preserves both link and text)
 * - Inline code (preserves formatting)
 */
function removeFormatting() {
	return (tree: Root) => {
		visit(tree, (node, index, parent) => {
			// Remove emphasis (italic), strong (bold), delete (strikethrough)
			if (
				node.type === "emphasis" ||
				node.type === "strong" ||
				node.type === "delete"
			) {
				if (parent && index !== null && index !== undefined) {
					const formattingNode = node as Emphasis | Strong | Delete;
					// Replace the formatting node with its children (the text content)
					parent.children.splice(index, 1, ...formattingNode.children);
					// Return SKIP and index to avoid re-processing the newly inserted children
					return [SKIP, index];
				}
			}
			return undefined;

			// The following were intentionally excluded in the reference implementation:

			// Convert links to just their text content (removes the URL)
			// if (node.type === 'link') {
			//   if (parent && index !== null) {
			//     parent.children.splice(index, 1, ...node.children);
			//     return [SKIP, index];
			//   }
			// }

			// Remove inline code formatting but keep the text
			// if (node.type === 'inlineCode') {
			//   if (parent && index !== null) {
			//     parent.children.splice(index, 1, {
			//       type: 'text',
			//       value: node.value
			//     });
			//     return [SKIP, index];
			//   }
			// }
		});
	};
}

/**
 * Parse tags from frontmatter data.
 *
 * Handles three formats:
 * 1. Empty string -> []
 * 2. Comma-separated string -> split and trim
 * 3. Array -> use as-is
 *
 * @param frontmatterData - The parsed frontmatter object
 * @returns Array of tag strings
 */
// biome-ignore lint/suspicious/noExplicitAny: Frontmatter data structure is dynamic and unknown
function parseTags(frontmatterData: Record<string, any>): string[] {
	const tags = frontmatterData.tags;

	if (!tags) {
		return [];
	}

	if (typeof tags === "string") {
		if (tags === "") {
			return [];
		}
		return tags.split(",").map((tag) => tag.trim());
	}

	if (Array.isArray(tags)) {
		return tags;
	}

	return [];
}

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
export const cleanMarkdownStep = createStep<
	CleanMarkdownInput,
	CleanMarkdownOutput
>("cleanMarkdown", async ({ input }) => {
	// Validate input
	const validated = CleanMarkdownInputSchema.parse(input);

	// Parse frontmatter from the markdown content
	const parsed = matter(validated.content);

	// Process the markdown content through remark plugins
	const modified = await remark()
		.use(remarkGfm) // Enable GFM syntax including strikethrough
		.use(removeHeadings, validated.headingsToRemove)
		.use(removeFormatting)
		.process(parsed.content);

	// Parse tags from frontmatter
	const tags = parseTags(parsed.data);

	return {
		content: String(modified.value),
		tags,
		frontmatter: parsed.data,
	};
});

// Export schemas for testing and validation
export { CleanMarkdownInputSchema, CleanMarkdownOutputSchema };
export type { CleanMarkdownInput, CleanMarkdownOutput };
