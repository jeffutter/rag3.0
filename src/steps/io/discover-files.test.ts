import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverFilesStep } from "./discover-files";

// Test directory setup
let testDir: string;

beforeAll(async () => {
  // Create a unique temp directory for tests
  testDir = join(tmpdir(), `discover-files-test-${Date.now()}`);
  await mkdir(testDir, { recursive: true });

  // Create test file structure
  // testDir/
  //   file1.md
  //   file2.md
  //   file3.txt
  //   subdir/
  //     file4.md
  //     file5.txt
  //   subdir2/
  //     nested/
  //       file6.md

  await writeFile(join(testDir, "file1.md"), "# Test 1");
  await writeFile(join(testDir, "file2.md"), "# Test 2");
  await writeFile(join(testDir, "file3.txt"), "Not markdown");

  await mkdir(join(testDir, "subdir"));
  await writeFile(join(testDir, "subdir", "file4.md"), "# Test 4");
  await writeFile(join(testDir, "subdir", "file5.txt"), "Not markdown");

  await mkdir(join(testDir, "subdir2", "nested"), { recursive: true });
  await writeFile(join(testDir, "subdir2", "nested", "file6.md"), "# Test 6");
});

afterAll(async () => {
  // Clean up test directory
  await rm(testDir, { recursive: true, force: true });
});

test("discovers all markdown files with default pattern", async () => {
  const result = await discoverFilesStep.execute({
    input: { path: testDir },
    state: {},
    context: undefined,
  });

  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.files.length).toBe(4);

    const filenames = result.data.files.map((f) => f.name).sort();
    expect(filenames).toEqual(["file1.md", "file2.md", "file4.md", "file6.md"]);

    // Verify paths are absolute
    for (const file of result.data.files) {
      expect(file.path).toContain(testDir);
    }
  }
});

test("discovers files with custom pattern", async () => {
  const result = await discoverFilesStep.execute({
    input: {
      path: testDir,
      pattern: "**/*.txt",
    },
    state: {},
    context: undefined,
  });

  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.files.length).toBe(2);

    const filenames = result.data.files.map((f) => f.name).sort();
    expect(filenames).toEqual(["file3.txt", "file5.txt"]);
  }
});

test("discovers files in subdirectory only", async () => {
  const result = await discoverFilesStep.execute({
    input: {
      path: join(testDir, "subdir"),
      pattern: "*.md",
    },
    state: {},
    context: undefined,
  });

  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.files.length).toBe(1);
    expect(result.data.files[0]?.name).toBe("file4.md");
  }
});

test("returns empty array when no files match", async () => {
  const result = await discoverFilesStep.execute({
    input: {
      path: testDir,
      pattern: "**/*.pdf",
    },
    state: {},
    context: undefined,
  });

  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.files.length).toBe(0);
  }
});

test("handles non-existent directory gracefully", async () => {
  const result = await discoverFilesStep.execute({
    input: {
      path: "/non/existent/directory",
      pattern: "**/*.md",
    },
    state: {},
    context: undefined,
  });

  // Bun's Glob may throw an error for non-existent directories
  // or return an empty array, both are acceptable
  if (result.success) {
    expect(result.data.files.length).toBe(0);
  } else {
    expect(result.error.message).toBeTruthy();
  }
});

test("discovers nested markdown files recursively", async () => {
  const result = await discoverFilesStep.execute({
    input: {
      path: testDir,
      pattern: "**/nested/*.md",
    },
    state: {},
    context: undefined,
  });

  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.files.length).toBe(1);
    expect(result.data.files[0]?.name).toBe("file6.md");
    expect(result.data.files[0]?.path).toContain("nested");
  }
});

test("file names are correctly extracted from paths", async () => {
  const result = await discoverFilesStep.execute({
    input: { path: testDir },
    state: {},
    context: undefined,
  });

  expect(result.success).toBe(true);
  if (result.success) {
    for (const file of result.data.files) {
      // Name should not contain directory separators
      expect(file.name).not.toContain("/");
      expect(file.name).not.toContain("\\");

      // Name should end with .md
      expect(file.name).toMatch(/\.md$/);

      // Path should end with the name
      expect(file.path).toEndWith(file.name);
    }
  }
});
