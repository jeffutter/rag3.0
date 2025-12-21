import { afterAll, beforeAll, expect, test } from "bun:test";
import { generateEmbeddingsStep } from "./generate-embeddings";

/**
 * Mock embedding server for testing.
 */
let mockServer: ReturnType<typeof Bun.serve> | null = null;
let mockPort: number;

beforeAll(async () => {
	// Start a mock embedding API server
	mockServer = Bun.serve({
		port: 0, // Random available port
		fetch(req) {
			const url = new URL(req.url);

			if (url.pathname === "/v1/embeddings" && req.method === "POST") {
				return handleEmbeddingRequest(req);
			}

			if (url.pathname === "/error" && req.method === "POST") {
				return new Response("Internal Server Error", { status: 500 });
			}

			if (url.pathname === "/invalid-response" && req.method === "POST") {
				return Response.json({ invalid: "format" });
			}

			if (url.pathname === "/wrong-count" && req.method === "POST") {
				// Return fewer embeddings than requested
				return Response.json({
					data: [{ embedding: Array(384).fill(0.1) }],
				});
			}

			return new Response("Not Found", { status: 404 });
		},
	});

	if (!mockServer.port) {
		throw new Error("Mock server port is not defined");
	}
	mockPort = mockServer.port;
});

afterAll(() => {
	if (mockServer) {
		mockServer.stop();
	}
});

async function handleEmbeddingRequest(req: Request): Promise<Response> {
	const body = await req.json();

	// Validate request format
	if (!body.input || !Array.isArray(body.input) || !body.model) {
		return new Response("Invalid request format", { status: 400 });
	}

	// Generate mock embeddings (384-dimensional vectors with random values)
	const embeddings = body.input.map((_text: string, index: number) => ({
		embedding: Array(384)
			.fill(0)
			.map(() => Math.random()),
		index,
	}));

	return Response.json({
		data: embeddings,
	});
}

test("generates embeddings for single text", async () => {
	const result = await generateEmbeddingsStep.execute({
		input: {
			contents: ["This is a test text"],
			endpoint: `http://localhost:${mockPort}/v1/embeddings`,
			model: "qwen3-embedding",
		},
		state: {},
		context: undefined,
	});

	expect(result.success).toBe(true);
	if (result.success) {
		expect(result.data.embeddings.length).toBe(1);
		expect(result.data.embeddings[0]?.embedding.length).toBe(384);
		expect(typeof result.data.embeddings[0]?.embedding[0]).toBe("number");
	}
});

test("generates embeddings for multiple texts", async () => {
	const contents = [
		"First text chunk",
		"Second text chunk",
		"Third text chunk",
	];

	const result = await generateEmbeddingsStep.execute({
		input: {
			contents,
			endpoint: `http://localhost:${mockPort}/v1/embeddings`,
			model: "qwen3-embedding",
		},
		state: {},
		context: undefined,
	});

	expect(result.success).toBe(true);
	if (result.success) {
		expect(result.data.embeddings.length).toBe(3);

		for (const embedding of result.data.embeddings) {
			expect(embedding.embedding.length).toBe(384);
			expect(Array.isArray(embedding.embedding)).toBe(true);
		}
	}
});

test("generates embeddings for batch of 50 texts", async () => {
	const contents = Array.from({ length: 50 }, (_, i) => `Chunk ${i + 1}`);

	const result = await generateEmbeddingsStep.execute({
		input: {
			contents,
			endpoint: `http://localhost:${mockPort}/v1/embeddings`,
			model: "qwen3-embedding",
		},
		state: {},
		context: undefined,
	});

	expect(result.success).toBe(true);
	if (result.success) {
		expect(result.data.embeddings.length).toBe(50);

		// Verify all embeddings are valid
		for (const embedding of result.data.embeddings) {
			expect(embedding.embedding.length).toBe(384);
			expect(
				embedding.embedding.every((n: number) => typeof n === "number"),
			).toBe(true);
		}
	}
});

test("handles texts with special characters", async () => {
	const contents = [
		"Text with \"quotes\" and 'apostrophes'",
		"Text with emoji 🚀🌟",
		"Text with newlines\nand\ttabs",
		"Text with UTF-8: 世界 こんにちは",
	];

	const result = await generateEmbeddingsStep.execute({
		input: {
			contents,
			endpoint: `http://localhost:${mockPort}/v1/embeddings`,
			model: "qwen3-embedding",
		},
		state: {},
		context: undefined,
	});

	expect(result.success).toBe(true);
	if (result.success) {
		expect(result.data.embeddings.length).toBe(4);
	}
});

test("fails when endpoint returns error", async () => {
	const result = await generateEmbeddingsStep.execute({
		input: {
			contents: ["Test text"],
			endpoint: `http://localhost:${mockPort}/error`,
			model: "qwen3-embedding",
		},
		state: {},
		context: undefined,
	});

	expect(result.success).toBe(false);
	if (!result.success) {
		expect(result.error.message).toContain("Embedding API error");
		expect(result.error.message).toContain("500");
	}
});

test("fails when endpoint returns invalid response", async () => {
	const result = await generateEmbeddingsStep.execute({
		input: {
			contents: ["Test text"],
			endpoint: `http://localhost:${mockPort}/invalid-response`,
			model: "qwen3-embedding",
		},
		state: {},
		context: undefined,
	});

	expect(result.success).toBe(false);
	if (!result.success) {
		expect(result.error.message).toBeTruthy();
	}
});

test("fails when endpoint returns wrong number of embeddings", async () => {
	const result = await generateEmbeddingsStep.execute({
		input: {
			contents: ["Text 1", "Text 2", "Text 3"],
			endpoint: `http://localhost:${mockPort}/wrong-count`,
			model: "qwen3-embedding",
		},
		state: {},
		context: undefined,
	});

	expect(result.success).toBe(false);
	if (!result.success) {
		expect(result.error.message).toContain(
			"Expected 3 embeddings but received 1",
		);
	}
});

test("fails when endpoint is unreachable", async () => {
	const result = await generateEmbeddingsStep.execute({
		input: {
			contents: ["Test text"],
			endpoint: "http://localhost:99999/v1/embeddings",
			model: "qwen3-embedding",
		},
		state: {},
		context: undefined,
	});

	expect(result.success).toBe(false);
	if (!result.success) {
		expect(result.error.message).toBeTruthy();
	}
});

test("sends correct request format", async () => {
	// biome-ignore lint/suspicious/noExplicitAny: Test captures request with unknown structure
	let capturedRequest: any = null;

	// Create a temporary server to capture the request
	const captureServer = Bun.serve({
		port: 0,
		async fetch(req) {
			capturedRequest = await req.json();
			return Response.json({
				data: [{ embedding: Array(384).fill(0.1), index: 0 }],
			});
		},
	});

	await generateEmbeddingsStep.execute({
		input: {
			contents: ["Test text"],
			endpoint: `http://localhost:${captureServer.port}/`,
			model: "test-model",
		},
		state: {},
		context: undefined,
	});

	captureServer.stop();

	expect(capturedRequest).toBeTruthy();
	expect(capturedRequest.input).toEqual(["Test text"]);
	expect(capturedRequest.model).toBe("test-model");
});

test("handles empty contents array validation", async () => {
	const result = await generateEmbeddingsStep.execute({
		input: {
			contents: [],
			endpoint: `http://localhost:${mockPort}/v1/embeddings`,
			model: "qwen3-embedding",
		},
		state: {},
		context: undefined,
	});

	expect(result.success).toBe(false);
	if (!result.success) {
		expect(result.error.message).toContain("Too small");
	}
});

test("validates endpoint URL format", async () => {
	const result = await generateEmbeddingsStep.execute({
		input: {
			contents: ["Test text"],
			endpoint: "not-a-valid-url",
			model: "qwen3-embedding",
		},
		state: {},
		context: undefined,
	});

	expect(result.success).toBe(false);
	if (!result.success) {
		expect(result.error.message).toContain("url");
	}
});

test("embeddings maintain order", async () => {
	// Create a server that returns embeddings with distinct values
	const orderServer = Bun.serve({
		port: 0,
		async fetch(req) {
			const body = await req.json();
			const embeddings = body.input.map((_text: string, index: number) => ({
				embedding: Array(384).fill(index),
				index,
			}));

			return Response.json({ data: embeddings });
		},
	});

	const result = await generateEmbeddingsStep.execute({
		input: {
			contents: ["First", "Second", "Third"],
			endpoint: `http://localhost:${orderServer.port}/`,
			model: "test-model",
		},
		state: {},
		context: undefined,
	});

	orderServer.stop();

	expect(result.success).toBe(true);
	if (result.success) {
		// Verify embeddings are in correct order
		expect(result.data.embeddings[0]?.embedding[0]).toBe(0);
		expect(result.data.embeddings[1]?.embedding[0]).toBe(1);
		expect(result.data.embeddings[2]?.embedding[0]).toBe(2);
	}
});
