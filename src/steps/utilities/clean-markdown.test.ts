import { describe, expect, test } from "bun:test";
import { cleanMarkdownStep } from "./clean-markdown";

describe("Clean Markdown Step", () => {
	test("should remove specified heading sections with their content", async () => {
		const input = {
			content: `# Main Heading

This is the main content.

## Project List

- Project 1
- Project 2

## Keep This

This content should remain.

## Task

Do something

## Another Section

More content to keep.
`,
		};

		const result = await cleanMarkdownStep.execute({
			input,
			state: {},
			context: {},
		});

		expect(result.success).toBe(true);
		if (result.success) {
			// Should remove "Project List" and "Task" sections
			expect(result.data.content).not.toContain("Project List");
			expect(result.data.content).not.toContain("Project 1");
			expect(result.data.content).not.toContain("Task");
			expect(result.data.content).not.toContain("Do something");

			// Should keep other sections
			expect(result.data.content).toContain("Main Heading");
			expect(result.data.content).toContain("Keep This");
			expect(result.data.content).toContain("Another Section");
		}
	});

	test("should remove heading AND all content until next heading of same/higher level", async () => {
		const input = {
			content: `# Title

## Task

This should be removed.

### Subtask

This should also be removed (under Task).

More content under Task.

## Next Section

This should be kept.
`,
		};

		const result = await cleanMarkdownStep.execute({
			input,
			state: {},
			context: {},
		});

		expect(result.success).toBe(true);
		if (result.success) {
			// Should remove Task heading and everything until Next Section
			expect(result.data.content).not.toContain("Task");
			expect(result.data.content).not.toContain("This should be removed");
			expect(result.data.content).not.toContain("Subtask");
			expect(result.data.content).not.toContain("This should also be removed");

			// Should keep content after the removed section
			expect(result.data.content).toContain("Next Section");
			expect(result.data.content).toContain("This should be kept");
		}
	});

	test("should use default headings to remove", async () => {
		const input = {
			content: `# Document

## Due Today

Task 1

## Todoist Tasks

Task 2

## Regular Section

Keep this
`,
		};

		const result = await cleanMarkdownStep.execute({
			input,
			state: {},
			context: {},
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.content).not.toContain("Due Today");
			expect(result.data.content).not.toContain("Todoist Tasks");
			expect(result.data.content).toContain("Regular Section");
		}
	});

	test("should allow custom headings to remove", async () => {
		const input = {
			content: `# Document

## Custom Heading

Remove this

## Task

Keep this (not in custom list)

## Another Custom

Remove this too
`,
			headingsToRemove: ["Custom Heading", "Another Custom"],
		};

		const result = await cleanMarkdownStep.execute({
			input,
			state: {},
			context: {},
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.content).not.toContain("Custom Heading");
			expect(result.data.content).not.toContain("Another Custom");
			expect(result.data.content).toContain("Task"); // Not removed because custom list
			expect(result.data.content).toContain("Keep this");
		}
	});

	test("should remove text formatting (bold, italic, strikethrough)", async () => {
		const input = {
			content: `# Document

This is **bold text** and *italic text* and ~~strikethrough~~.

**Multiple** *different* ~~formats~~ in one line.
`,
		};

		const result = await cleanMarkdownStep.execute({
			input,
			state: {},
			context: {},
		});

		expect(result.success).toBe(true);
		if (result.success) {
			// Should preserve text content but remove formatting
			expect(result.data.content).toContain("bold text");
			expect(result.data.content).toContain("italic text");
			expect(result.data.content).toContain("strikethrough");

			// Should not contain formatting markers
			expect(result.data.content).not.toContain("**");
			expect(result.data.content).not.toContain("~~");
		}
	});

	test("should preserve links and inline code", async () => {
		const input = {
			content: `# Document

Here is a [link](https://example.com) and some \`inline code\`.

More \`code\` and [another link](https://test.com).
`,
		};

		const result = await cleanMarkdownStep.execute({
			input,
			state: {},
			context: {},
		});

		expect(result.success).toBe(true);
		if (result.success) {
			// Links should be preserved
			expect(result.data.content).toContain("[link](https://example.com)");
			expect(result.data.content).toContain("[another link](https://test.com)");

			// Inline code should be preserved
			expect(result.data.content).toContain("`inline code`");
			expect(result.data.content).toContain("`code`");
		}
	});

	test("should parse tags from frontmatter - comma-separated string", async () => {
		const input = {
			content: `---
tags: tag1, tag2, tag3
title: Test Document
---

# Content
`,
		};

		const result = await cleanMarkdownStep.execute({
			input,
			state: {},
			context: {},
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.tags).toEqual(["tag1", "tag2", "tag3"]);
			expect(result.data.frontmatter).toHaveProperty("title", "Test Document");
		}
	});

	test("should parse tags from frontmatter - array format", async () => {
		const input = {
			content: `---
tags:
  - tag1
  - tag2
  - tag3
---

# Content
`,
		};

		const result = await cleanMarkdownStep.execute({
			input,
			state: {},
			context: {},
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.tags).toEqual(["tag1", "tag2", "tag3"]);
		}
	});

	test("should parse tags from frontmatter - empty string", async () => {
		const input = {
			content: `---
tags: ""
---

# Content
`,
		};

		const result = await cleanMarkdownStep.execute({
			input,
			state: {},
			context: {},
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.tags).toEqual([]);
		}
	});

	test("should handle missing tags in frontmatter", async () => {
		const input = {
			content: `---
title: Test
---

# Content
`,
		};

		const result = await cleanMarkdownStep.execute({
			input,
			state: {},
			context: {},
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.tags).toEqual([]);
		}
	});

	test("should handle markdown without frontmatter", async () => {
		const input = {
			content: `# Just a heading

Some content without frontmatter.
`,
		};

		const result = await cleanMarkdownStep.execute({
			input,
			state: {},
			context: {},
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.tags).toEqual([]);
			expect(result.data.content).toContain("Just a heading");
		}
	});

	test("should handle empty markdown content", async () => {
		const input = {
			content: "",
		};

		const result = await cleanMarkdownStep.execute({
			input,
			state: {},
			context: {},
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.tags).toEqual([]);
			expect(result.data.content).toBe("");
		}
	});

	test("should verify all default headings match reference implementation", async () => {
		const expectedDefaults = [
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
		];

		// Create content with all default headings
		const content =
			`# Main\n\n` +
			expectedDefaults.map((h) => `## ${h}\n\nContent to remove\n\n`).join("") +
			`## Keep This\n\nFinal content`;

		const input = { content };

		const result = await cleanMarkdownStep.execute({
			input,
			state: {},
			context: {},
		});

		expect(result.success).toBe(true);
		if (result.success) {
			// None of the default headings should remain
			for (const heading of expectedDefaults) {
				expect(result.data.content).not.toContain(heading);
			}

			// The non-default heading should remain
			expect(result.data.content).toContain("Keep This");
		}
	});

	test("comprehensive integration test", async () => {
		const input = {
			content: `---
tags: markdown, test, integration
title: Comprehensive Test
author: Test Author
---

# Main Document

This is the **main** content with *formatting*.

## Project List

- Project A
- Project B

### Subproject

This should be removed too.

## Important Section

This has a [link](https://example.com) and \`code\`.

**Bold text** and *italic text* should lose formatting.

## Task

Remove this section.

## Final Section

Keep this content with **formatting** removed but [links](https://test.com) preserved.
`,
			headingsToRemove: ["Project List", "Task"],
		};

		const result = await cleanMarkdownStep.execute({
			input,
			state: {},
			context: {},
		});

		expect(result.success).toBe(true);
		if (result.success) {
			// Check tags parsing
			expect(result.data.tags).toEqual(["markdown", "test", "integration"]);

			// Check frontmatter
			expect(result.data.frontmatter).toHaveProperty(
				"title",
				"Comprehensive Test",
			);
			expect(result.data.frontmatter).toHaveProperty("author", "Test Author");

			// Check heading removal
			expect(result.data.content).not.toContain("Project List");
			expect(result.data.content).not.toContain("Project A");
			expect(result.data.content).not.toContain("Subproject");
			expect(result.data.content).not.toContain("Task");

			// Check kept content
			expect(result.data.content).toContain("Main Document");
			expect(result.data.content).toContain("Important Section");
			expect(result.data.content).toContain("Final Section");

			// Check formatting removal
			expect(result.data.content).not.toContain("**");
			expect(result.data.content).not.toContain("*italic*");
			expect(result.data.content).toContain("main");
			expect(result.data.content).toContain("formatting");

			// Check link preservation
			expect(result.data.content).toContain("[link](https://example.com)");
			expect(result.data.content).toContain("[links](https://test.com)");

			// Check code preservation
			expect(result.data.content).toContain("`code`");
		}
	});
});
