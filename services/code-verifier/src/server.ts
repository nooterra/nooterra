/**
 * @nooterra/code-verifier
 *
 * Sandboxed code verification service for the Nooterra protocol.
 * Executes user-provided code + tests in a restricted environment.
 *
 * Security features:
 * - Container-level isolation (Dockerfile)
 * - Process-level sandboxing (Node VM)
 * - Strict resource limits (CPU, memory, time)
 * - No network access
 * - Read-only filesystem
 * - Non-root user
 */

import Fastify from "fastify";
import pino from "pino";
import { z } from "zod";
import { nanoid } from "nanoid";
import { runInSandbox, SandboxResult } from "./sandbox.js";
import { config } from "./config.js";
import type { VerificationResult } from "@nooterra/types";

const logger = pino({
  level: config.logLevel,
  transport:
    config.nodeEnv === "production"
      ? undefined
      : { target: "pino-pretty" },
});

const app = Fastify({
  logger,
  bodyLimit: config.maxCodeBytes * 2, // Code + tests
  requestTimeout: config.execTimeoutMs + 5000, // Add buffer
});

// Request validation schema
const VerifyRequestSchema = z.object({
  language: z
    .enum(["javascript", "typescript", "js", "ts"])
    .default("javascript"),
  code: z.string().min(1).max(config.maxCodeBytes),
  tests: z.string().max(config.maxCodeBytes).optional(),
  context: z.record(z.unknown()).optional(),
});

type VerifyRequest = z.infer<typeof VerifyRequestSchema>;

// Response type
interface VerifyResponse extends VerificationResult {
  verifier: string;
  executionId: string;
  context?: Record<string, unknown>;
}

/**
 * Convert sandbox result to verification result
 */
function toVerificationResult(
  result: SandboxResult,
  executionId: string,
  context?: Record<string, unknown>
): VerifyResponse {
  const ok = result.exitCode === 0 && !result.error;
  const issues: string[] = [];

  if (result.error) {
    issues.push(result.error);
  }
  if (result.stderr && result.stderr.trim()) {
    issues.push(result.stderr);
  }
  if (result.timedOut) {
    issues.push(`Execution timed out after ${config.execTimeoutMs}ms`);
  }

  return {
    ok,
    status: result.timedOut ? "timeout" : ok ? "passed" : "failed",
    issues: issues.length > 0 ? issues : undefined,
    metrics: {
      latencyMs: result.durationMs,
      memoryUsedBytes: result.memoryUsed,
    },
    data: {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    },
    verifier: "cap.verify.code.tests.v1",
    executionId,
    context,
  };
}

/**
 * POST /verify
 * Execute code with optional tests in a sandboxed environment
 */
app.post<{ Body: VerifyRequest }>("/verify", async (request, reply) => {
  const executionId = nanoid(12);

  // Validate request
  const parseResult = VerifyRequestSchema.safeParse(request.body);
  if (!parseResult.success) {
    return reply.status(400).send({
      ok: false,
      status: "error",
      issues: parseResult.error.errors.map((e) => e.message),
      verifier: "cap.verify.code.tests.v1",
      executionId,
    });
  }

  const { language, code, tests, context } = parseResult.data;

  // Check code size
  if (code.length > config.maxCodeBytes) {
    return reply.status(413).send({
      ok: false,
      status: "error",
      issues: [`Code exceeds maximum size of ${config.maxCodeBytes} bytes`],
      verifier: "cap.verify.code.tests.v1",
      executionId,
    });
  }

  logger.info({ executionId, language, codeLength: code.length }, "Executing verification");

  try {
    const result = await runInSandbox({
      code,
      tests,
      language,
      timeoutMs: config.execTimeoutMs,
      memoryLimitMb: config.memoryLimitMb,
    });

    const response = toVerificationResult(result, executionId, context);

    logger.info(
      {
        executionId,
        ok: response.ok,
        status: response.status,
        durationMs: result.durationMs,
      },
      "Verification complete"
    );

    return reply.send(response);
  } catch (err) {
    logger.error({ err, executionId }, "Verification failed");
    return reply.status(500).send({
      ok: false,
      status: "error",
      issues: ["Internal verification error"],
      verifier: "cap.verify.code.tests.v1",
      executionId,
    });
  }
});

/**
 * GET /health
 * Health check endpoint
 */
app.get("/health", async () => ({
  ok: true,
  service: "code-verifier",
  version: "0.1.0",
  mode: config.sandboxMode,
  limits: {
    timeoutMs: config.execTimeoutMs,
    memoryMb: config.memoryLimitMb,
    maxCodeBytes: config.maxCodeBytes,
  },
}));

/**
 * GET /
 * Service info
 */
app.get("/", async () => ({
  service: "@nooterra/code-verifier",
  capability: "cap.verify.code.tests.v1",
  description: "Sandboxed code verification for TypeScript/JavaScript",
  supportedLanguages: ["javascript", "typescript"],
}));

// Start server
async function start() {
  try {
    await app.listen({
      port: config.port,
      host: "0.0.0.0",
    });
    logger.info(
      {
        port: config.port,
        mode: config.sandboxMode,
        limits: {
          timeoutMs: config.execTimeoutMs,
          memoryMb: config.memoryLimitMb,
        },
      },
      "Code verifier started"
    );
  } catch (err) {
    logger.fatal(err, "Failed to start server");
    process.exit(1);
  }
}

start();
