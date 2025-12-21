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

	qdrant: z.object({
		url: z.string(),
		apiKey: z.string().optional(),
		defaultCollection: z.string().default("rag_store"),
	}),

	logging: z
		.object({
			level: z
				.enum(["trace", "debug", "info", "warn", "error", "fatal"])
				.default("info"),
			pretty: z.boolean().default(false),
		})
		.default({ level: "info", pretty: false }),
});

export type Config = z.infer<typeof configSchema>;

/**
 * Load configuration from file or environment variables.
 *
 * Priority:
 * 1. Config file specified by path parameter
 * 2. Config file at CONFIG_FILE env var
 * 3. ./config.json
 * 4. Environment variables fallback
 */
export async function loadConfig(path?: string): Promise<Config> {
	const configPath = path || process.env.CONFIG_FILE || "./config.json";

	try {
		const file = Bun.file(configPath);
		const exists = await file.exists();

		if (exists) {
			const raw = await file.json();
			return configSchema.parse(raw);
		}
	} catch (_error) {
		// File doesn't exist or is invalid, fall through to env vars
	}

	// Try environment variables as fallback
	try {
		return configSchema.parse({
			llm: {
				baseURL: process.env.LLM_BASE_URL,
				apiKey: process.env.LLM_API_KEY,
				model: process.env.LLM_MODEL,
			},
			embedding: {
				baseURL: process.env.EMBEDDING_BASE_URL || process.env.LLM_BASE_URL,
				model: process.env.EMBEDDING_MODEL,
				apiKey: process.env.EMBEDDING_API_KEY || process.env.LLM_API_KEY,
			},
			qdrant: {
				url: process.env.QDRANT_URL,
				apiKey: process.env.QDRANT_API_KEY,
				defaultCollection: process.env.QDRANT_COLLECTION,
			},
			logging: {
				level:
					(process.env.LOG_LEVEL as
						| "trace"
						| "debug"
						| "info"
						| "warn"
						| "error"
						| "fatal"
						| undefined) || "info",
				pretty: process.env.NODE_ENV !== "production",
			},
		});
	} catch (error) {
		throw new Error(
			`Failed to load configuration: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}
