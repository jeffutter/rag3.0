import { createLogger } from "../core/logging/logger";
import type { PipelineRegistry } from "../core/pipeline/registry";

const logger = createLogger("webhook-server");

/**
 * Webhook server that exposes pipelines as HTTP endpoints.
 *
 * Features:
 * - POST /webhook/:pipelineName to trigger a pipeline
 * - GET /webhook/list to list available pipelines
 * - Bearer token authentication
 * - JSON request/response
 */

export interface WebhookServerOptions {
	pipelineRegistry: PipelineRegistry;
	port?: number;
	host?: string;
	apiKey?: string;
}

export interface WebhookExecutionResult {
	success: boolean;
	pipelineName: string;
	data?: unknown;
	error?: string;
	executionTime?: number;
}

export function createWebhookServer(options: WebhookServerOptions) {
	const { pipelineRegistry, port = 3000, host = "0.0.0.0", apiKey } = options;

	// Authentication middleware
	function authenticate(req: Request): boolean {
		if (!apiKey) {
			// No API key configured, allow all requests
			return true;
		}

		const authHeader = req.headers.get("authorization");
		if (!authHeader) {
			return false;
		}

		// Support both "Bearer <token>" and just "<token>"
		const token = authHeader.startsWith("Bearer ")
			? authHeader.slice(7)
			: authHeader;

		return token === apiKey;
	}

	const server = Bun.serve({
		port,
		hostname: host,

		async fetch(req) {
			const url = new URL(req.url);
			const path = url.pathname;

			// Health check
			if (path === "/health") {
				return Response.json({ status: "ok" });
			}

			// Require authentication for all other endpoints
			if (!authenticate(req)) {
				logger.warn({
					event: "unauthorized_request",
					path,
					method: req.method,
					ip: req.headers.get("x-forwarded-for") || "unknown",
				});

				return Response.json({ error: "Unauthorized" }, { status: 401 });
			}

			// List available pipelines
			if (path === "/webhook/list" && req.method === "GET") {
				const pipelines = pipelineRegistry.getAll().map((p) => ({
					name: p.name,
					description: p.description,
					tags: p.tags,
					examples: p.examples,
				}));

				logger.info({
					event: "list_pipelines",
					count: pipelines.length,
				});

				return Response.json({ pipelines });
			}

			// Execute pipeline via webhook
			if (path.startsWith("/webhook/") && req.method === "POST") {
				const pipelineName = path.slice("/webhook/".length);

				if (!pipelineName) {
					return Response.json(
						{ error: "Pipeline name required" },
						{ status: 400 },
					);
				}

				try {
					const input = await req.json();
					const startTime = performance.now();

					logger.info({
						event: "webhook_execution_start",
						pipelineName,
						input,
					});

					const result = await pipelineRegistry.execute(pipelineName, input);
					const executionTime = performance.now() - startTime;

					const response: WebhookExecutionResult = result.success
						? {
								success: true,
								pipelineName,
								executionTime,
								data: result.data,
							}
						: {
								success: false,
								pipelineName,
								executionTime,
								// biome-ignore lint/style/noNonNullAssertion: result.error is guaranteed to exist when success is false
								error: result.error!,
							};

					logger.info({
						event: "webhook_execution_complete",
						pipelineName,
						success: result.success,
						executionTime,
					});

					return Response.json(response, {
						status: result.success ? 200 : 500,
					});
				} catch (error) {
					logger.error({
						event: "webhook_execution_error",
						pipelineName,
						error: error instanceof Error ? error.message : String(error),
						stack: error instanceof Error ? error.stack : undefined,
					});

					return Response.json(
						{
							success: false,
							pipelineName,
							error: error instanceof Error ? error.message : "Invalid request",
						},
						{ status: 400 },
					);
				}
			}

			// Not found
			return Response.json({ error: "Not found" }, { status: 404 });
		},
	});

	logger.info({
		event: "webhook_server_started",
		port,
		host,
		hasAuthentication: !!apiKey,
	});

	return server;
}

/**
 * Run the webhook server.
 */
export async function runWebhookServer(options: WebhookServerOptions) {
	logger.info({
		event: "webhook_server_starting",
		port: options.port || 3000,
		host: options.host || "0.0.0.0",
		pipelineCount: options.pipelineRegistry.getAll().length,
		authenticationEnabled: !!options.apiKey,
	});

	const server = createWebhookServer(options);

	// Handle shutdown
	process.on("SIGINT", () => {
		logger.info({ event: "webhook_server_shutting_down" });
		server.stop();
		process.exit(0);
	});

	process.on("SIGTERM", () => {
		logger.info({ event: "webhook_server_shutting_down" });
		server.stop();
		process.exit(0);
	});

	return server;
}
