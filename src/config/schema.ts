import { z } from "zod";

export const configSchema = z.object({
  server: z
    .object({
      port: z.number().default(3000),
      host: z.string().default("0.0.0.0"),
    })
    .default({ port: 3000, host: "0.0.0.0" }),

  llm: z.object({
    baseURL: z.string(),
    apiKey: z.string().optional(),
    model: z.string().default("qwen2.5:7b"),
    timeout: z.number().default(120000),
  }),

  embedding: z.object({
    baseURL: z.string(),
    model: z.string(),
    apiKey: z.string().optional(),
  }),

  sparseEmbedding: z
    .object({
      endpoint: z.string().optional(),
    })
    .optional()
    .default({}),

  reranker: z.object({
    baseURL: z.string(),
    model: z.string().optional(),
    apiKey: z.string().optional(),
    useInstructions: z.boolean().optional().default(false),
    instructions: z.string().optional(),
  }),

  qdrant: z.object({
    url: z.string(),
    apiKey: z.string().optional(),
    defaultCollection: z.string().default("rag_store"),
  }),

  vault: z.object({
    baseURL: z.string(),
  }),

  mcp: z
    .object({
      servers: z
        .array(
          z.object({
            url: z.string(),
            name: z.string().optional(),
          }),
        )
        .optional()
        .default([]),
    })
    .default({ servers: [] }),

  logging: z
    .object({
      level: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
      pretty: z.boolean().default(false),
      format: z.enum(["compact", "hybrid", "minimal", "pretty"]).default("compact"),
      sanitize: z.boolean().default(true),
      maxArrayLength: z.number().default(3),
      maxStringLength: z.number().default(500),
      maxDepth: z.number().default(3),
    })
    .default({
      level: "info",
      pretty: false,
      format: "compact",
      sanitize: true,
      maxArrayLength: 3,
      maxStringLength: 500,
      maxDepth: 3,
    }),
});

export type Config = z.infer<typeof configSchema>;

/**
 * Load configuration from file and environment variables.
 *
 * Priority (higher overrides lower):
 * 1. Environment variables (highest priority - always override)
 * 2. Config file specified by path parameter
 * 3. Config file at CONFIG_FILE env var
 * 4. ./config.json
 * 5. Schema defaults (lowest priority)
 */
export async function loadConfig(path?: string): Promise<Config> {
  const configPath = path || process.env.CONFIG_FILE || "./config.json";

  // Load base config from file if it exists
  let fileConfig: unknown = {};
  try {
    const file = Bun.file(configPath);
    const exists = await file.exists();

    if (exists) {
      fileConfig = await file.json();
    }
  } catch (_error) {
    // File doesn't exist or is invalid, use empty object
    fileConfig = {};
  }

  // Build env config object (only including values that are actually set)
  const envConfig: Record<string, unknown> = {};

  // Server overrides
  if (process.env.SERVER_PORT || process.env.SERVER_HOST) {
    envConfig.server = {
      ...(typeof fileConfig === "object" && fileConfig !== null && "server" in fileConfig
        ? (fileConfig.server as Record<string, unknown>)
        : {}),
      ...(process.env.SERVER_PORT ? { port: Number.parseInt(process.env.SERVER_PORT, 10) } : {}),
      ...(process.env.SERVER_HOST ? { host: process.env.SERVER_HOST } : {}),
    };
  }

  // LLM overrides
  if (process.env.LLM_BASE_URL || process.env.LLM_API_KEY || process.env.LLM_MODEL || process.env.LLM_TIMEOUT) {
    envConfig.llm = {
      ...(typeof fileConfig === "object" && fileConfig !== null && "llm" in fileConfig
        ? (fileConfig.llm as Record<string, unknown>)
        : {}),
      ...(process.env.LLM_BASE_URL ? { baseURL: process.env.LLM_BASE_URL } : {}),
      ...(process.env.LLM_API_KEY ? { apiKey: process.env.LLM_API_KEY } : {}),
      ...(process.env.LLM_MODEL ? { model: process.env.LLM_MODEL } : {}),
      ...(process.env.LLM_TIMEOUT ? { timeout: Number.parseInt(process.env.LLM_TIMEOUT, 10) } : {}),
    };
  }

  // Embedding overrides
  if (process.env.EMBEDDING_BASE_URL || process.env.EMBEDDING_MODEL || process.env.EMBEDDING_API_KEY) {
    envConfig.embedding = {
      ...(typeof fileConfig === "object" && fileConfig !== null && "embedding" in fileConfig
        ? (fileConfig.embedding as Record<string, unknown>)
        : {}),
      ...(process.env.EMBEDDING_BASE_URL ? { baseURL: process.env.EMBEDDING_BASE_URL } : {}),
      ...(process.env.EMBEDDING_MODEL ? { model: process.env.EMBEDDING_MODEL } : {}),
      ...(process.env.EMBEDDING_API_KEY ? { apiKey: process.env.EMBEDDING_API_KEY } : {}),
    };
  }

  // Sparse Embedding overrides
  if (process.env.SPARSE_EMBEDDING_ENDPOINT) {
    envConfig.sparseEmbedding = {
      ...(typeof fileConfig === "object" && fileConfig !== null && "sparseEmbedding" in fileConfig
        ? (fileConfig.sparseEmbedding as Record<string, unknown>)
        : {}),
      endpoint: process.env.SPARSE_EMBEDDING_ENDPOINT,
    };
  }

  // Reranker overrides
  if (
    process.env.RERANKER_BASE_URL ||
    process.env.RERANKER_MODEL ||
    process.env.RERANKER_API_KEY ||
    process.env.RERANKER_USE_INSTRUCTIONS ||
    process.env.RERANKER_INSTRUCTIONS
  ) {
    envConfig.reranker = {
      ...(typeof fileConfig === "object" && fileConfig !== null && "reranker" in fileConfig
        ? (fileConfig.reranker as Record<string, unknown>)
        : {}),
      ...(process.env.RERANKER_BASE_URL ? { baseURL: process.env.RERANKER_BASE_URL } : {}),
      ...(process.env.RERANKER_MODEL ? { model: process.env.RERANKER_MODEL } : {}),
      ...(process.env.RERANKER_API_KEY ? { apiKey: process.env.RERANKER_API_KEY } : {}),
      ...(process.env.RERANKER_USE_INSTRUCTIONS
        ? { useInstructions: process.env.RERANKER_USE_INSTRUCTIONS === "true" }
        : {}),
      ...(process.env.RERANKER_INSTRUCTIONS ? { instructions: process.env.RERANKER_INSTRUCTIONS } : {}),
    };
  }

  // Qdrant overrides
  if (process.env.QDRANT_URL || process.env.QDRANT_API_KEY || process.env.QDRANT_COLLECTION) {
    envConfig.qdrant = {
      ...(typeof fileConfig === "object" && fileConfig !== null && "qdrant" in fileConfig
        ? (fileConfig.qdrant as Record<string, unknown>)
        : {}),
      ...(process.env.QDRANT_URL ? { url: process.env.QDRANT_URL } : {}),
      ...(process.env.QDRANT_API_KEY ? { apiKey: process.env.QDRANT_API_KEY } : {}),
      ...(process.env.QDRANT_COLLECTION ? { defaultCollection: process.env.QDRANT_COLLECTION } : {}),
    };
  }

  // Vault overrides
  if (process.env.VAULT_BASE_URL) {
    envConfig.vault = {
      ...(typeof fileConfig === "object" && fileConfig !== null && "vault" in fileConfig
        ? (fileConfig.vault as Record<string, unknown>)
        : {}),
      baseURL: process.env.VAULT_BASE_URL,
    };
  }

  // MCP overrides
  if (process.env.MCP_SERVERS) {
    try {
      const servers = JSON.parse(process.env.MCP_SERVERS);
      envConfig.mcp = {
        servers: Array.isArray(servers) ? servers : [],
      };
    } catch (_error) {
      // Invalid JSON, ignore
    }
  }

  // Logging overrides
  if (
    process.env.LOG_LEVEL ||
    process.env.NODE_ENV ||
    process.env.LOG_FORMAT ||
    process.env.LOG_SANITIZE ||
    process.env.LOG_MAX_ARRAY_LENGTH ||
    process.env.LOG_MAX_STRING_LENGTH ||
    process.env.LOG_MAX_DEPTH
  ) {
    envConfig.logging = {
      ...(typeof fileConfig === "object" && fileConfig !== null && "logging" in fileConfig
        ? (fileConfig.logging as Record<string, unknown>)
        : {}),
      ...(process.env.LOG_LEVEL ? { level: process.env.LOG_LEVEL } : {}),
      ...(process.env.NODE_ENV ? { pretty: process.env.NODE_ENV !== "production" } : {}),
      ...(process.env.LOG_FORMAT ? { format: process.env.LOG_FORMAT } : {}),
      ...(process.env.LOG_SANITIZE ? { sanitize: process.env.LOG_SANITIZE !== "false" } : {}),
      ...(process.env.LOG_MAX_ARRAY_LENGTH
        ? { maxArrayLength: Number.parseInt(process.env.LOG_MAX_ARRAY_LENGTH, 10) }
        : {}),
      ...(process.env.LOG_MAX_STRING_LENGTH
        ? { maxStringLength: Number.parseInt(process.env.LOG_MAX_STRING_LENGTH, 10) }
        : {}),
      ...(process.env.LOG_MAX_DEPTH ? { maxDepth: Number.parseInt(process.env.LOG_MAX_DEPTH, 10) } : {}),
    };
  }

  // Merge file config with env config (env config takes precedence)
  const mergedConfig = {
    ...(typeof fileConfig === "object" && fileConfig !== null ? fileConfig : {}),
    ...envConfig,
  };

  try {
    return configSchema.parse(mergedConfig);
  } catch (error) {
    throw new Error(`Failed to load configuration: ${error instanceof Error ? error.message : String(error)}`);
  }
}
