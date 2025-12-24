import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./schema";

let tempDir: string;
let configPath: string;

// Store original env vars to restore after tests
const originalEnv: Record<string, string | undefined> = {};

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "config-test-"));
  configPath = join(tempDir, "test-config.json");

  // Save and clear env vars that might interfere with tests
  const envVarsToSave = [
    "LLM_MODEL",
    "LLM_BASE_URL",
    "LLM_API_KEY",
    "LLM_TIMEOUT",
    "SERVER_PORT",
    "SERVER_HOST",
    "EMBEDDING_BASE_URL",
    "EMBEDDING_MODEL",
    "EMBEDDING_API_KEY",
    "QDRANT_URL",
    "QDRANT_API_KEY",
    "QDRANT_COLLECTION",
    "VAULT_BASE_URL",
    "LOG_LEVEL",
  ];

  for (const key of envVarsToSave) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });

  // Restore original env vars
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

test("loads config from file", async () => {
  const configData = {
    llm: {
      baseURL: "http://localhost:11434",
      model: "qwen2.5:7b",
    },
    embedding: {
      baseURL: "http://localhost:11434",
      model: "nomic-embed-text",
    },
    qdrant: {
      url: "http://localhost:6333",
    },
    vault: {
      baseURL: "http://localhost:27124",
    },
  };

  await Bun.write(configPath, JSON.stringify(configData));
  const config = await loadConfig(configPath);

  expect(config.llm.model).toBe("qwen2.5:7b");
  expect(config.llm.baseURL).toBe("http://localhost:11434");
});

test("environment variables override config file", async () => {
  const configData = {
    llm: {
      baseURL: "http://localhost:11434",
      model: "qwen2.5:7b",
    },
    embedding: {
      baseURL: "http://localhost:11434",
      model: "nomic-embed-text",
    },
    qdrant: {
      url: "http://localhost:6333",
    },
    vault: {
      baseURL: "http://localhost:27124",
    },
  };

  await Bun.write(configPath, JSON.stringify(configData));

  // Set env var to override
  process.env.LLM_MODEL = "llama2:13b";

  const config = await loadConfig(configPath);

  // Env var should override file value
  expect(config.llm.model).toBe("llama2:13b");
  // Other values from file should remain
  expect(config.llm.baseURL).toBe("http://localhost:11434");
});

test("environment variables override only specific fields", async () => {
  const configData = {
    llm: {
      baseURL: "http://localhost:11434",
      model: "qwen2.5:7b",
      apiKey: "file-api-key",
    },
    embedding: {
      baseURL: "http://localhost:11434",
      model: "nomic-embed-text",
    },
    qdrant: {
      url: "http://localhost:6333",
    },
    vault: {
      baseURL: "http://localhost:27124",
    },
  };

  await Bun.write(configPath, JSON.stringify(configData));

  // Set only one env var
  process.env.LLM_MODEL = "llama2:13b";

  const config = await loadConfig(configPath);

  // Only the overridden field changes
  expect(config.llm.model).toBe("llama2:13b");
  // Other fields from the same section remain from file
  expect(config.llm.baseURL).toBe("http://localhost:11434");
  expect(config.llm.apiKey).toBe("file-api-key");
});

test("can override multiple env vars independently", async () => {
  const configData = {
    llm: {
      baseURL: "http://localhost:11434",
      model: "qwen2.5:7b",
    },
    embedding: {
      baseURL: "http://localhost:11434",
      model: "nomic-embed-text",
    },
    qdrant: {
      url: "http://localhost:6333",
    },
    vault: {
      baseURL: "http://localhost:27124",
    },
    server: {
      port: 3000,
      host: "0.0.0.0",
    },
  };

  await Bun.write(configPath, JSON.stringify(configData));

  // Override multiple different sections
  process.env.LLM_MODEL = "llama2:13b";
  process.env.SERVER_PORT = "8080";

  const config = await loadConfig(configPath);

  expect(config.llm.model).toBe("llama2:13b");
  expect(config.server.port).toBe(8080);
  // Unmodified values remain
  expect(config.llm.baseURL).toBe("http://localhost:11434");
  expect(config.server.host).toBe("0.0.0.0");
});

test("works with no config file, only env vars", async () => {
  process.env.LLM_BASE_URL = "http://localhost:11434";
  process.env.LLM_MODEL = "qwen2.5:7b";
  process.env.EMBEDDING_BASE_URL = "http://localhost:11434";
  process.env.EMBEDDING_MODEL = "nomic-embed-text";
  process.env.QDRANT_URL = "http://localhost:6333";
  process.env.VAULT_BASE_URL = "http://localhost:27124";

  const config = await loadConfig("/nonexistent/path.json");

  expect(config.llm.model).toBe("qwen2.5:7b");
  expect(config.llm.baseURL).toBe("http://localhost:11434");
  expect(config.embedding.model).toBe("nomic-embed-text");

  // Clean up
  delete process.env.EMBEDDING_BASE_URL;
  delete process.env.EMBEDDING_MODEL;
  delete process.env.QDRANT_URL;
  delete process.env.VAULT_BASE_URL;
});
