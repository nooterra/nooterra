import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";

import { processPaymentTriggerRetryQueueOnce, sendPaymentTriggerOnApproval } from "../services/magic-link/src/payment-triggers.js";
import { listenOnEphemeralLoopback } from "./lib/listen.js";

function sampleDecisionReport({ decision = "approve", reportHash = "hash_report_1", token = "ml_test", tenantId = "tenant_test" } = {}) {
  return {
    schemaVersion: "SettlementDecisionReport.v1",
    decision,
    decidedAt: "2026-02-05T00:00:00.000Z",
    reportHash,
    signerKeyId: "key_test",
    actor: { email: "buyer@example.com" },
    hosted: { token, tenantId, zipSha256: "ziphash" }
  };
}

function samplePublicSummary({ verificationOk = true, ok = true } = {}) {
  return {
    schemaVersion: "MagicLinkPublicSummary.v1",
    verification: { ok, verificationOk, warningCodes: [] },
    invoiceClaim: { invoiceId: "inv_1", currency: "USD", totalCents: "1234" }
  };
}

async function readJson(fp) {
  return JSON.parse(await fs.readFile(fp, "utf8"));
}

test("payment trigger retry: dead-letters after max attempts", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-payment-trigger-test-"));
  await t.after(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const tenantId = "tenant_dead_letter";
  const token = "ml_dead_letter";
  const reportHash = "report_hash_dead_letter";
  const tenantSettings = {
    paymentTriggers: {
      enabled: true,
      deliveryMode: "webhook",
      webhookUrl: "http://127.0.0.1:1/payment-trigger",
      webhookSecret: "pt_secret"
    }
  };

  const sent = await sendPaymentTriggerOnApproval({
    dataDir,
    tenantId,
    token,
    tenantSettings,
    decisionReport: sampleDecisionReport({ token, tenantId, reportHash }),
    publicSummary: samplePublicSummary(),
    retryMaxAttempts: 3,
    retryBackoffMs: 10,
    timeoutMs: 200
  });
  assert.equal(sent.ok, false);
  assert.equal(sent.queued, true);
  assert.equal(sent.idempotencyKey, reportHash);

  const run1 = await processPaymentTriggerRetryQueueOnce({ dataDir, timeoutMs: 200, nowMs: Date.now() + 60_000 });
  assert.equal(run1.retried, 1);
  assert.equal(run1.deadLettered, 0);

  const run2 = await processPaymentTriggerRetryQueueOnce({ dataDir, timeoutMs: 200, nowMs: Date.now() + 120_000 });
  assert.equal(run2.deadLettered, 1);

  const state = await readJson(path.join(dataDir, "payment_triggers", tenantId, `${token}.json`));
  assert.equal(state.ok, false);
  assert.equal(state.result?.deadLetter, true);
  assert.equal(state.result?.attemptCount, 3);
  assert.equal(state.result?.maxAttempts, 3);

  const deadDir = path.join(dataDir, "payment_trigger_retry", "dead-letter");
  const deadNames = await fs.readdir(deadDir);
  assert.equal(deadNames.length, 1);
});

test("payment trigger retry: succeeds on retry delivery", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "nooterra-payment-trigger-test-"));
  await t.after(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  let calls = 0;
  const server = http.createServer((req, res) => {
    calls += 1;
    if (calls === 1) {
      res.statusCode = 500;
      res.end("retry");
      return;
    }
    res.statusCode = 204;
    res.end("");
  });
  let port = null;
  try {
    ({ port } = await listenOnEphemeralLoopback(server, { hosts: ["127.0.0.1"] }));
  } catch (err) {
    const cause = err?.cause ?? err;
    if (cause?.code === "EPERM" || cause?.code === "EACCES") {
      t.skip(`loopback listen not permitted (${cause.code})`);
      try {
        if (server.listening) await new Promise((resolve) => server.close(resolve));
      } catch {
        // ignore
      }
      return;
    }
    throw err;
  }
  await t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const tenantId = "tenant_retry_success";
  const token = "ml_retry_success";
  const reportHash = "report_hash_retry_success";
  const tenantSettings = {
    paymentTriggers: {
      enabled: true,
      deliveryMode: "webhook",
      webhookUrl: `http://127.0.0.1:${port}/payment-trigger`,
      webhookSecret: "pt_secret"
    }
  };

  const sent = await sendPaymentTriggerOnApproval({
    dataDir,
    tenantId,
    token,
    tenantSettings,
    decisionReport: sampleDecisionReport({ token, tenantId, reportHash }),
    publicSummary: samplePublicSummary(),
    retryMaxAttempts: 4,
    retryBackoffMs: 10,
    timeoutMs: 500
  });
  assert.equal(sent.ok, false);
  assert.equal(sent.queued, true);

  const processed = await processPaymentTriggerRetryQueueOnce({ dataDir, timeoutMs: 500, nowMs: Date.now() + 60_000 });
  assert.equal(processed.delivered, 1);

  const state = await readJson(path.join(dataDir, "payment_triggers", tenantId, `${token}.json`));
  assert.equal(state.ok, true);
  assert.equal(state.result?.retried, true);
  assert.equal(state.result?.attemptCount, 2);
  assert.equal(calls, 2);

  const pendingDir = path.join(dataDir, "payment_trigger_retry", "pending");
  const pending = await fs.readdir(pendingDir).catch(() => []);
  assert.equal(pending.length, 0);
});
