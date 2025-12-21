import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileStep } from "./read-file";

// Test directory setup
let testDir: string;
let testFilePath: string;
let emptyFilePath: string;
let largeFilePath: string;

beforeAll(async () => {
	// Create a unique temp directory for tests
	testDir = join(tmpdir(), `read-file-test-${Date.now()}`);
	await mkdir(testDir, { recursive: true });

	// Create test files
	testFilePath = join(testDir, "test.md");
	await writeFile(
		testFilePath,
		"# Test Document\n\nThis is a test document with some content.",
	);

	emptyFilePath = join(testDir, "empty.md");
	await writeFile(emptyFilePath, "");

	largeFilePath = join(testDir, "large.md");
	const largeContent = `# Large Document\n\n${"A".repeat(10000)}`;
	await writeFile(largeFilePath, largeContent);
});

afterAll(async () => {
	// Clean up test directory
	await rm(testDir, { recursive: true, force: true });
});

test("reads a file successfully", async () => {
	const result = await readFileStep.execute({
		input: { path: testFilePath },
		state: {},
		context: undefined,
	});

	expect(result.success).toBe(true);
	if (result.success) {
		expect(result.data.content).toContain("# Test Document");
		expect(result.data.content).toContain("This is a test document");
		expect(result.data.source).toBe(testFilePath);
	}
});

test("reads empty file", async () => {
	const result = await readFileStep.execute({
		input: { path: emptyFilePath },
		state: {},
		context: undefined,
	});

	expect(result.success).toBe(true);
	if (result.success) {
		expect(result.data.content).toBe("");
		expect(result.data.source).toBe(emptyFilePath);
	}
});

test("reads large file", async () => {
	const result = await readFileStep.execute({
		input: { path: largeFilePath },
		state: {},
		context: undefined,
	});

	expect(result.success).toBe(true);
	if (result.success) {
		expect(result.data.content.length).toBeGreaterThan(10000);
		expect(result.data.content).toContain("# Large Document");
		expect(result.data.content).toContain("AAA");
		expect(result.data.source).toBe(largeFilePath);
	}
});

test("fails when file does not exist", async () => {
	const nonExistentPath = join(testDir, "does-not-exist.md");

	const result = await readFileStep.execute({
		input: { path: nonExistentPath },
		state: {},
		context: undefined,
	});

	expect(result.success).toBe(false);
	if (!result.success) {
		expect(result.error.message).toContain("File not found");
		expect(result.error.message).toContain(nonExistentPath);
	}
});

test("preserves file content exactly", async () => {
	const specialContent =
		"# Special Content\n\n```javascript\nconst x = 1;\n```\n\n- Item 1\n- Item 2\n\n**Bold** and *italic*";
	const specialFilePath = join(testDir, "special.md");
	await writeFile(specialFilePath, specialContent);

	const result = await readFileStep.execute({
		input: { path: specialFilePath },
		state: {},
		context: undefined,
	});

	expect(result.success).toBe(true);
	if (result.success) {
		expect(result.data.content).toBe(specialContent);
	}
});

test("handles UTF-8 content correctly", async () => {
	const utf8Content = "# UTF-8 Test\n\n世界 🌍 こんにちは";
	const utf8FilePath = join(testDir, "utf8.md");
	await writeFile(utf8FilePath, utf8Content);

	const result = await readFileStep.execute({
		input: { path: utf8FilePath },
		state: {},
		context: undefined,
	});

	expect(result.success).toBe(true);
	if (result.success) {
		expect(result.data.content).toContain("世界");
		expect(result.data.content).toContain("🌍");
		expect(result.data.content).toContain("こんにちは");
	}
});

test("source path matches input path", async () => {
	const result = await readFileStep.execute({
		input: { path: testFilePath },
		state: {},
		context: undefined,
	});

	expect(result.success).toBe(true);
	if (result.success) {
		expect(result.data.source).toBe(testFilePath);
	}
});

test("handles files with newlines", async () => {
	const multilineContent = "Line 1\nLine 2\r\nLine 3\n\nLine 5";
	const multilineFilePath = join(testDir, "multiline.md");
	await writeFile(multilineFilePath, multilineContent);

	const result = await readFileStep.execute({
		input: { path: multilineFilePath },
		state: {},
		context: undefined,
	});

	expect(result.success).toBe(true);
	if (result.success) {
		expect(result.data.content).toContain("Line 1");
		expect(result.data.content).toContain("Line 2");
		expect(result.data.content).toContain("Line 3");
		expect(result.data.content).toContain("Line 5");
	}
});
