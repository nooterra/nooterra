import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createLaunchStructuredLoggingReviewReport,
  main as runLaunchStructuredLoggingReview,
  parseArgs
} from "../scripts/ops/run-launch-structured-logging-review.mjs";

async function withTempRoot(files, fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "launch-structured-logging-review-"));
  try {
    await Promise.all(
      Object.entries(files).map(async ([relativePath, content]) => {
        const absolutePath = path.join(root, relativePath);
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, content, "utf8");
      })
    );
    await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

const PASS_FIXTURES = {
  "src/core/log.js": `
    const LEVELS = Object.freeze({});
    function redactPayload(payload) { return payload; }
    process.stdout.write(\`\${JSON.stringify(safe)}\\n\`);
    export const logger = Object.freeze({});
  `,
  "src/api/app.js": `
    logger.info("action_wallet_intent_transition", {});
    logger.warn("x402.webhook.secret_decrypt_failed", {});
    logger.warn("billing.event.emit_failed", {});
    logger.error("tickX402Holdbacks.release_failed", {});
  `,
  "services/magic-link/src/server.js": `
    import { logger } from "../../../src/core/log.js";
    logger.warn("magic_link.data_dir_ephemeral", {
      eventId: "magic_link_data_dir_ephemeral",
      reasonCode: "DATA_DIR_LIKELY_EPHEMERAL"
    });
    logger.info("magic_link.listen", {
      eventId: "magic_link_listen",
      reasonCode: "SERVICE_READY"
    });
  `,
  "services/x402-gateway/src/server.js": `
    import { logger } from "../../../src/core/log.js";
    logger.info("x402_gateway.listen", {
      eventId: "x402_gateway_listen",
      reasonCode: "SERVICE_READY"
    });
  `,
  "scripts/mcp/nooterra-mcp-server.mjs": `
    function writeStderrEvent(level, msg, fields = {}) {}
    writeStderrEvent("info", "mcp.ready", { eventId: "mcp_ready", reasonCode: "SERVICE_READY" });
    writeStderrEvent("error", "mcp.stream_error", { eventId: "mcp_stream_error" });
    writeStderrEvent("warn", "mcp.invalid_json", { eventId: "mcp_invalid_json", reasonCode: "INVALID_JSON" });
    writeStderrEvent("warn", "mcp.tool_failed", { eventId: "mcp_tool_failed" });
    writeStderrEvent("error", "mcp.fatal", { eventId: "mcp_fatal", reasonCode: "PROCESS_FATAL" });
    process.stderr.write(\`\${JSON.stringify(redactSecrets(payload))}\\n\`);
  `
};

test("createLaunchStructuredLoggingReviewReport fails closed on missing evidence", () => {
  const report = createLaunchStructuredLoggingReviewReport({
    rootDir: "/tmp/nooterra",
    capturedAt: "2026-03-11T23:40:00.000Z",
    checks: [{ id: "mcp_host_pack_logging", title: "MCP logs", ok: false, evidence: [], missing: [{ file: "/tmp/x", pattern: "foo" }] }]
  });
  assert.equal(report.schemaVersion, "LaunchStructuredLoggingReviewReport.v1");
  assert.equal(report.status, "fail");
  assert.equal(report.blockingIssues.length, 1);
});

test("CLI reports pass when structured logging evidence is present", async () => {
  await withTempRoot(PASS_FIXTURES, async (root) => {
    const stdout = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => {
      stdout.push(typeof chunk === "string" ? chunk : String(chunk));
      return true;
    };
    try {
      await runLaunchStructuredLoggingReview(["--root", root, "--captured-at", "2026-03-11T23:45:00.000Z"]);
    } finally {
      process.stdout.write = originalWrite;
    }
    const report = JSON.parse(stdout.join(""));
    assert.equal(report.status, "pass");
    assert.equal(report.checks.length, 5);
  });
});

test("CLI fails closed when structured logging evidence is missing", async () => {
  const failingFixtures = {
    ...PASS_FIXTURES,
    "services/x402-gateway/src/server.js": `import { logger } from "../../../src/core/log.js";`
  };
  await withTempRoot(failingFixtures, async (root) => {
    const stdout = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => {
      stdout.push(typeof chunk === "string" ? chunk : String(chunk));
      return true;
    };
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      await runLaunchStructuredLoggingReview(["--root", root]);
      assert.equal(process.exitCode, 1);
    } finally {
      process.stdout.write = originalWrite;
      process.exitCode = previousExitCode;
    }
    const report = JSON.parse(stdout.join(""));
    assert.equal(report.status, "fail");
    assert.ok(report.blockingIssues.length >= 1);
  });
});

test("parseArgs rejects unknown arguments", () => {
  assert.throws(() => parseArgs(["--wat"]), /Unknown argument/);
});
