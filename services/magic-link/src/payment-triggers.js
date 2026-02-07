import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import https from "node:https";

import { decryptStoredSecret } from "./tenant-settings.js";

function nowIso() {
  return new Date().toISOString();
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function hmacSha256Hex(secret, message) {
  return crypto.createHmac("sha256", String(secret ?? "")).update(String(message ?? ""), "utf8").digest("hex");
}

function isPlainObject(v) {
  return Boolean(v && typeof v === "object" && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null));
}

function safeInt(value, fallback) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(n)) return fallback;
  return n;
}

function clampRetryConfig({ retryMaxAttempts, retryBackoffMs } = {}) {
  const maxAttempts = Math.max(1, Math.min(50, safeInt(retryMaxAttempts, 5)));
  const backoffMs = Math.max(0, Math.min(86_400_000, safeInt(retryBackoffMs, 5_000)));
  return { maxAttempts, backoffMs };
}

function statusFromPublicSummary(publicSummary) {
  const ok = Boolean(publicSummary?.verification?.ok);
  const verificationOk = Boolean(publicSummary?.verification?.verificationOk);
  const warnings = Array.isArray(publicSummary?.verification?.warningCodes) ? publicSummary.verification.warningCodes : [];
  if (!ok || !verificationOk) return "red";
  if (warnings.length) return "amber";
  return "green";
}

function triggerStatePath({ dataDir, tenantId, token }) {
  return path.join(dataDir, "payment_triggers", tenantId, `${token}.json`);
}

function retryPendingDir(dataDir) {
  return path.join(dataDir, "payment_trigger_retry", "pending");
}

function retryDeadLetterDir(dataDir) {
  return path.join(dataDir, "payment_trigger_retry", "dead-letter");
}

function retryAttemptsDir(dataDir) {
  return path.join(dataDir, "payment_trigger_retry", "attempts");
}

function retryJobId({ tenantId, token, idempotencyKey }) {
  const hash = sha256Hex(`${tenantId}\n${token}\n${idempotencyKey}`).slice(0, 24);
  return `${tenantId}_${token}_${hash}`;
}

function retryPendingPath({ dataDir, tenantId, token, idempotencyKey }) {
  return path.join(retryPendingDir(dataDir), `${retryJobId({ tenantId, token, idempotencyKey })}.json`);
}

function retryDeadLetterPath({ dataDir, tenantId, token, idempotencyKey }) {
  return path.join(retryDeadLetterDir(dataDir), `${retryJobId({ tenantId, token, idempotencyKey })}.json`);
}

function triggerOutboxPath({ dataDir, tenantId, token, idempotencyKey }) {
  return path.join(dataDir, "payment-trigger-outbox", `${retryJobId({ tenantId, token, idempotencyKey })}.json`);
}

async function loadStateBestEffort({ dataDir, tenantId, token }) {
  const fp = triggerStatePath({ dataDir, tenantId, token });
  try {
    return JSON.parse(await fs.readFile(fp, "utf8"));
  } catch {
    return null;
  }
}

async function writeState({ dataDir, tenantId, token, state }) {
  const fp = triggerStatePath({ dataDir, tenantId, token });
  await fs.mkdir(path.dirname(fp), { recursive: true });
  await fs.writeFile(fp, JSON.stringify(state, null, 2) + "\n", "utf8");
}

async function loadRetryJobBestEffort({ dataDir, tenantId, token, idempotencyKey }) {
  const fp = retryPendingPath({ dataDir, tenantId, token, idempotencyKey });
  try {
    const raw = await fs.readFile(fp, "utf8");
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function readJsonIfExists(fp) {
  try {
    const raw = await fs.readFile(fp, "utf8");
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function fileExists(fp) {
  try {
    await fs.access(fp);
    return true;
  } catch {
    return false;
  }
}

function absoluteUrl(baseUrl, relPath) {
  const rel = String(relPath ?? "");
  const base = typeof baseUrl === "string" && baseUrl.trim() ? baseUrl.trim().replace(/\/+$/, "") : "";
  if (!base) return rel;
  if (!rel.startsWith("/")) return rel;
  return `${base}${rel}`;
}

async function request({ url, method, headers, body, timeoutMs }) {
  const u = new URL(url);
  const lib = u.protocol === "https:" ? https : http;
  return await new Promise((resolve) => {
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80,
        path: u.pathname + u.search,
        method,
        headers,
        timeout: timeoutMs
      },
      (res) => {
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () => resolve({ ok: true, statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      }
    );
    req.on("timeout", () => {
      try {
        req.destroy(new Error("timeout"));
      } catch {
        // ignore
      }
    });
    req.on("error", (err) => resolve({ ok: false, error: err?.message ?? String(err ?? "request failed") }));
    req.end(body);
  });
}

function buildPayload({ tenantId, token, decisionReport, publicSummary, closePackZipUrl, publicBaseUrl, idempotencyKey }) {
  const decision = isPlainObject(decisionReport) ? decisionReport : {};
  const invoice = isPlainObject(publicSummary?.invoiceClaim) ? publicSummary.invoiceClaim : null;
  const magicLinkPath = `/r/${token}`;
  const decisionReportPath = `${magicLinkPath}/settlement_decision_report.json`;
  const status = statusFromPublicSummary(publicSummary);

  return {
    schemaVersion: "MagicLinkPaymentTrigger.v1",
    event: "payment.approval_ready",
    triggeredAt: nowIso(),
    tenantId,
    token,
    idempotencyKey,
    decision: {
      decision: typeof decision.decision === "string" ? decision.decision : null,
      decidedAt: typeof decision.decidedAt === "string" ? decision.decidedAt : null,
      reportHash: typeof decision.reportHash === "string" ? decision.reportHash : null,
      signerKeyId: typeof decision.signerKeyId === "string" ? decision.signerKeyId : null,
      actorEmail: typeof decision?.actor?.email === "string" ? decision.actor.email : null
    },
    verification: {
      status,
      ok: Boolean(publicSummary?.verification?.ok),
      verificationOk: Boolean(publicSummary?.verification?.verificationOk)
    },
    invoice: invoice
      ? {
          invoiceId: typeof invoice.invoiceId === "string" ? invoice.invoiceId : null,
          currency: typeof invoice.currency === "string" ? invoice.currency : null,
          totalCents: typeof invoice.totalCents === "string" ? invoice.totalCents : null
        }
      : null,
    artifacts: {
      magicLinkUrl: absoluteUrl(publicBaseUrl, magicLinkPath),
      decisionReportUrl: absoluteUrl(publicBaseUrl, decisionReportPath),
      closePackZipUrl:
        typeof closePackZipUrl === "string" && closePackZipUrl
          ? absoluteUrl(publicBaseUrl, closePackZipUrl)
          : absoluteUrl(publicBaseUrl, `${magicLinkPath}/closepack.zip`)
    }
  };
}

function nextRetryBackoffMs({ baseMs, attempt }) {
  const exp = Math.max(0, Math.min(16, Number(attempt ?? 1) - 1));
  return Math.min(86_400_000, Math.max(0, Number(baseMs ?? 0)) * (2 ** exp));
}

function buildAttemptResult({ statusCode = null, error = null } = {}) {
  const ok = Number.isInteger(statusCode) && statusCode >= 200 && statusCode < 300;
  return {
    at: nowIso(),
    ok,
    statusCode: Number.isInteger(statusCode) ? statusCode : null,
    error: typeof error === "string" && error ? error : null
  };
}

function buildWebhookHeaders({ body, idempotencyKey, webhookSecret }) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(body, "utf8")),
    "x-settld-event": "payment.approval_ready",
    "x-settld-idempotency-key": idempotencyKey
  };
  if (webhookSecret) {
    const ts = nowIso();
    const sig = hmacSha256Hex(webhookSecret, `${ts}.${body}`);
    headers["x-settld-timestamp"] = ts;
    headers["x-settld-signature"] = `v1=${sig}`;
  }
  return headers;
}

async function deliverWebhookAttempt({ webhookUrl, webhookSecret, payload, idempotencyKey, timeoutMs }) {
  const body = JSON.stringify(payload);
  const headers = buildWebhookHeaders({ body, idempotencyKey, webhookSecret });
  const httpRes = await request({ url: webhookUrl, method: "POST", headers, body, timeoutMs });
  if (!httpRes.ok) return buildAttemptResult({ error: httpRes.error ?? "PAYMENT_TRIGGER_WEBHOOK_FAILED" });
  if (httpRes.statusCode < 200 || httpRes.statusCode >= 300) return buildAttemptResult({ statusCode: httpRes.statusCode, error: "PAYMENT_TRIGGER_WEBHOOK_NON_2XX" });
  return buildAttemptResult({ statusCode: httpRes.statusCode });
}

async function appendAttemptLog({ dataDir, job, attempt }) {
  const id = retryJobId({ tenantId: job.tenantId, token: job.token, idempotencyKey: job.idempotencyKey });
  const fp = path.join(retryAttemptsDir(dataDir), `${id}.jsonl`);
  await fs.mkdir(path.dirname(fp), { recursive: true });
  await fs.appendFile(fp, JSON.stringify({ schemaVersion: "MagicLinkPaymentTriggerAttempt.v1", ...attempt }) + "\n", "utf8");
}

async function persistRetryJob({ dataDir, job }) {
  const fp = retryPendingPath({ dataDir, tenantId: job.tenantId, token: job.token, idempotencyKey: job.idempotencyKey });
  await fs.mkdir(path.dirname(fp), { recursive: true });
  await fs.writeFile(fp, JSON.stringify(job, null, 2) + "\n", "utf8");
  return fp;
}

async function enqueueRetryJob({
  dataDir,
  tenantId,
  token,
  payload,
  idempotencyKey,
  webhookUrl,
  webhookSecretStored,
  maxAttempts,
  backoffMs,
  firstAttempt
}) {
  const attemptCount = 1;
  const nextAttemptAtMs = Date.now() + nextRetryBackoffMs({ baseMs: backoffMs, attempt: 1 });
  const job = {
    schemaVersion: "MagicLinkPaymentTriggerRetryJob.v1",
    tenantId,
    token,
    idempotencyKey,
    payload,
    webhookUrl,
    webhookSecretStored: typeof webhookSecretStored === "string" && webhookSecretStored ? webhookSecretStored : null,
    maxAttempts,
    backoffMs,
    attemptCount,
    nextAttemptAt: new Date(nextAttemptAtMs).toISOString(),
    attempts: [firstAttempt],
    lastError: firstAttempt?.error ?? null,
    enqueuedAt: nowIso(),
    updatedAt: nowIso()
  };
  const fp = await persistRetryJob({ dataDir, job });
  return { job, path: fp };
}

async function moveToDeadLetter({ dataDir, job }) {
  const src = retryPendingPath({ dataDir, tenantId: job.tenantId, token: job.token, idempotencyKey: job.idempotencyKey });
  const dst = retryDeadLetterPath({ dataDir, tenantId: job.tenantId, token: job.token, idempotencyKey: job.idempotencyKey });
  await fs.mkdir(path.dirname(dst), { recursive: true });
  const dead = { ...job, deadLetteredAt: nowIso(), updatedAt: nowIso() };
  await fs.writeFile(dst, JSON.stringify(dead, null, 2) + "\n", "utf8");
  await fs.rm(src, { force: true });
  return dst;
}

export async function sendPaymentTriggerOnApproval({
  dataDir,
  tenantId,
  token,
  tenantSettings,
  decisionReport,
  publicSummary,
  closePackZipUrl = null,
  publicBaseUrl = null,
  settingsKey = null,
  timeoutMs = 5_000,
  retryMaxAttempts = 5,
  retryBackoffMs = 5_000
} = {}) {
  const cfg = isPlainObject(tenantSettings?.paymentTriggers) ? tenantSettings.paymentTriggers : null;
  if (!cfg || !cfg.enabled) return { ok: true, skipped: true, reason: "PAYMENT_TRIGGER_DISABLED" };

  const decision = typeof decisionReport?.decision === "string" ? decisionReport.decision : null;
  if (decision !== "approve") return { ok: true, skipped: true, reason: "PAYMENT_TRIGGER_NOT_APPROVED" };

  const deliveryMode = String(cfg.deliveryMode ?? "record").trim().toLowerCase();
  if (deliveryMode !== "record" && deliveryMode !== "webhook") {
    return { ok: false, skipped: true, reason: "PAYMENT_TRIGGER_INVALID_DELIVERY_MODE" };
  }

  const { maxAttempts, backoffMs } = clampRetryConfig({ retryMaxAttempts, retryBackoffMs });
  const idempotencyKey = typeof decisionReport?.reportHash === "string" ? decisionReport.reportHash : sha256Hex(JSON.stringify(decisionReport ?? {}));
  const previous = await loadStateBestEffort({ dataDir, tenantId, token });
  if (previous && previous.ok === true && previous.idempotencyKey === idempotencyKey && typeof previous.deliveredAt === "string" && previous.deliveredAt) {
    return {
      ok: true,
      skipped: true,
      reason: "PAYMENT_TRIGGER_ALREADY_DELIVERED",
      deliveredAt: previous.deliveredAt,
      idempotencyKey
    };
  }

  const payload = buildPayload({ tenantId, token, decisionReport, publicSummary, closePackZipUrl, publicBaseUrl, idempotencyKey });
  let result = null;

  if (deliveryMode === "record") {
    const fp = triggerOutboxPath({ dataDir, tenantId, token, idempotencyKey });
    await fs.mkdir(path.dirname(fp), { recursive: true });
    await fs.writeFile(fp, JSON.stringify(payload, null, 2) + "\n", "utf8");
    result = { ok: true, mode: "record", recorded: true, outboxPath: fp };
  } else {
    const webhookUrl = typeof cfg.webhookUrl === "string" ? cfg.webhookUrl.trim() : "";
    if (!webhookUrl) {
      result = { ok: false, mode: "webhook", error: "PAYMENT_TRIGGER_WEBHOOK_URL_MISSING" };
    } else {
      const existingJob = await loadRetryJobBestEffort({ dataDir, tenantId, token, idempotencyKey });
      if (existingJob) {
        result = {
          ok: false,
          mode: "webhook",
          queued: true,
          reason: "PAYMENT_TRIGGER_RETRY_ALREADY_ENQUEUED",
          idempotencyKey,
          attemptCount: safeInt(existingJob.attemptCount, 1),
          maxAttempts: safeInt(existingJob.maxAttempts, maxAttempts),
          nextAttemptAt: typeof existingJob.nextAttemptAt === "string" ? existingJob.nextAttemptAt : null
        };
      } else {
        const webhookSecret = decryptStoredSecret({ settingsKey, storedSecret: cfg.webhookSecret });
        const firstAttempt = await deliverWebhookAttempt({ webhookUrl, webhookSecret, payload, idempotencyKey, timeoutMs });
        await appendAttemptLog({
          dataDir,
          job: { tenantId, token, idempotencyKey },
          attempt: { ...firstAttempt, attemptNumber: 1, source: "inline" }
        });
        if (firstAttempt.ok) {
          result = { ok: true, mode: "webhook", statusCode: firstAttempt.statusCode };
        } else if (maxAttempts > 1) {
          const enq = await enqueueRetryJob({
            dataDir,
            tenantId,
            token,
            payload,
            idempotencyKey,
            webhookUrl,
            webhookSecretStored: cfg.webhookSecret,
            maxAttempts,
            backoffMs,
            firstAttempt
          });
          result = {
            ok: false,
            mode: "webhook",
            queued: true,
            reason: "PAYMENT_TRIGGER_RETRY_ENQUEUED",
            error: firstAttempt.error ?? null,
            attemptCount: 1,
            maxAttempts,
            nextAttemptAt: enq.job.nextAttemptAt
          };
        } else {
          result = { ok: false, mode: "webhook", error: firstAttempt.error ?? "PAYMENT_TRIGGER_WEBHOOK_FAILED", statusCode: firstAttempt.statusCode ?? null };
        }
      }
    }
  }

  const state = {
    schemaVersion: "MagicLinkPaymentTriggerState.v1",
    attemptedAt: nowIso(),
    deliveredAt: result && result.ok ? nowIso() : null,
    ok: Boolean(result && result.ok),
    tenantId,
    token,
    idempotencyKey,
    deliveryMode,
    result
  };
  await writeState({ dataDir, tenantId, token, state });
  if (result && result.ok) return { ok: true, skipped: false, idempotencyKey, ...result };
  return { ok: false, skipped: false, idempotencyKey, ...(result ?? { mode: deliveryMode, error: "PAYMENT_TRIGGER_FAILED" }) };
}

export async function processPaymentTriggerRetryQueueOnce({
  dataDir,
  settingsKey = null,
  timeoutMs = 5_000,
  nowMs = Date.now(),
  tenantIdFilter = null
} = {}) {
  const stats = { scanned: 0, skipped: 0, retried: 0, delivered: 0, deadLettered: 0, failed: 0 };
  let names = [];
  try {
    names = (await fs.readdir(retryPendingDir(dataDir))).filter((name) => name.endsWith(".json")).sort();
  } catch {
    return stats;
  }

  for (const name of names) {
    stats.scanned += 1;
    const fp = path.join(retryPendingDir(dataDir), name);
    let job = null;
    try {
      // eslint-disable-next-line no-await-in-loop
      job = JSON.parse(await fs.readFile(fp, "utf8"));
    } catch {
      stats.failed += 1;
      continue;
    }
    if (!isPlainObject(job)) {
      stats.failed += 1;
      continue;
    }

    const nextAt = Date.parse(String(job.nextAttemptAt ?? ""));
    if (Number.isFinite(nextAt) && nextAt > nowMs) {
      stats.skipped += 1;
      continue;
    }

    const tenantId = typeof job.tenantId === "string" ? job.tenantId : null;
    const token = typeof job.token === "string" ? job.token : null;
    const idempotencyKey = typeof job.idempotencyKey === "string" ? job.idempotencyKey : null;
    const webhookUrl = typeof job.webhookUrl === "string" ? job.webhookUrl : null;
    const payload = isPlainObject(job.payload) ? job.payload : null;
    if (!tenantId || !token || !idempotencyKey || !webhookUrl || !payload) {
      stats.failed += 1;
      continue;
    }
    if (tenantIdFilter && tenantId !== tenantIdFilter) {
      stats.skipped += 1;
      continue;
    }

    const maxAttempts = Math.max(1, safeInt(job.maxAttempts, 5));
    const backoffMs = Math.max(0, safeInt(job.backoffMs, 5_000));
    const attemptCount = Math.max(0, safeInt(job.attemptCount, 0));
    const nextAttemptNumber = attemptCount + 1;

    const webhookSecret = decryptStoredSecret({ settingsKey, storedSecret: job.webhookSecretStored });
    // eslint-disable-next-line no-await-in-loop
    const attempt = await deliverWebhookAttempt({ webhookUrl, webhookSecret, payload, idempotencyKey, timeoutMs });
    // eslint-disable-next-line no-await-in-loop
    await appendAttemptLog({
      dataDir,
      job: { tenantId, token, idempotencyKey },
      attempt: { ...attempt, attemptNumber: nextAttemptNumber, source: "retry_worker" }
    });

    if (attempt.ok) {
      // eslint-disable-next-line no-await-in-loop
      await fs.rm(fp, { force: true });
      // eslint-disable-next-line no-await-in-loop
      await writeState({
        dataDir,
        tenantId,
        token,
        state: {
          schemaVersion: "MagicLinkPaymentTriggerState.v1",
          attemptedAt: attempt.at,
          deliveredAt: attempt.at,
          ok: true,
          tenantId,
          token,
          idempotencyKey,
          deliveryMode: "webhook",
          result: {
            ok: true,
            mode: "webhook",
            retried: true,
            statusCode: attempt.statusCode,
            attemptCount: nextAttemptNumber
          }
        }
      });
      stats.delivered += 1;
      continue;
    }

    const attempts = Array.isArray(job.attempts) ? [...job.attempts] : [];
    attempts.push(attempt);
    if (nextAttemptNumber >= maxAttempts) {
      const deadJob = {
        ...job,
        attemptCount: nextAttemptNumber,
        attempts,
        lastError: attempt.error ?? null,
        updatedAt: nowIso()
      };
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(fp, JSON.stringify(deadJob, null, 2) + "\n", "utf8");
      // eslint-disable-next-line no-await-in-loop
      await moveToDeadLetter({ dataDir, job: deadJob });
      // eslint-disable-next-line no-await-in-loop
      await writeState({
        dataDir,
        tenantId,
        token,
        state: {
          schemaVersion: "MagicLinkPaymentTriggerState.v1",
          attemptedAt: attempt.at,
          deliveredAt: null,
          ok: false,
          tenantId,
          token,
          idempotencyKey,
          deliveryMode: "webhook",
          result: {
            ok: false,
            mode: "webhook",
            deadLetter: true,
            error: attempt.error ?? null,
            statusCode: attempt.statusCode ?? null,
            attemptCount: nextAttemptNumber,
            maxAttempts
          }
        }
      });
      stats.deadLettered += 1;
      continue;
    }

    const nextMs = nowMs + nextRetryBackoffMs({ baseMs: backoffMs, attempt: nextAttemptNumber });
    const updated = {
      ...job,
      attemptCount: nextAttemptNumber,
      nextAttemptAt: new Date(nextMs).toISOString(),
      attempts,
      lastError: attempt.error ?? null,
      updatedAt: nowIso()
    };
    // eslint-disable-next-line no-await-in-loop
    await fs.writeFile(fp, JSON.stringify(updated, null, 2) + "\n", "utf8");
    stats.retried += 1;
  }
  return stats;
}

export function startPaymentTriggerRetryWorker({
  dataDir,
  settingsKey = null,
  timeoutMs = 5_000,
  intervalMs = 2_000,
  onRetry = null,
  onDeadLetter = null,
  onDelivered = null
} = {}) {
  const cadence = Math.max(100, safeInt(intervalMs, 2_000));
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const stats = await processPaymentTriggerRetryQueueOnce({ dataDir, settingsKey, timeoutMs });
      if (typeof onRetry === "function" && stats.retried > 0) onRetry(stats.retried, stats);
      if (typeof onDeadLetter === "function" && stats.deadLettered > 0) onDeadLetter(stats.deadLettered, stats);
      if (typeof onDelivered === "function" && stats.delivered > 0) onDelivered(stats.delivered, stats);
    } finally {
      running = false;
    }
  }, cadence);
  if (typeof timer.unref === "function") timer.unref();
  return {
    stop() {
      clearInterval(timer);
    }
  };
}

export async function paymentTriggerRetryQueueDepth({ dataDir } = {}) {
  try {
    const names = (await fs.readdir(retryPendingDir(dataDir))).filter((name) => name.endsWith(".json"));
    return names.length;
  } catch {
    return 0;
  }
}

export async function paymentTriggerDeadLetterExists({ dataDir, tenantId, token, idempotencyKey } = {}) {
  const fp = retryDeadLetterPath({ dataDir, tenantId, token, idempotencyKey });
  return await fileExists(fp);
}

function normalizeRetryJobSummary({ job, state }) {
  if (!isPlainObject(job)) return null;
  const attempts = Array.isArray(job.attempts) ? job.attempts : [];
  const lastAttempt = attempts.length ? attempts[attempts.length - 1] : null;
  return {
    schemaVersion: "MagicLinkPaymentTriggerRetrySummary.v1",
    state,
    tenantId: typeof job.tenantId === "string" ? job.tenantId : null,
    token: typeof job.token === "string" ? job.token : null,
    idempotencyKey: typeof job.idempotencyKey === "string" ? job.idempotencyKey : null,
    attemptCount: safeInt(job.attemptCount, 0),
    maxAttempts: safeInt(job.maxAttempts, 0),
    nextAttemptAt: typeof job.nextAttemptAt === "string" ? job.nextAttemptAt : null,
    enqueuedAt: typeof job.enqueuedAt === "string" ? job.enqueuedAt : null,
    updatedAt: typeof job.updatedAt === "string" ? job.updatedAt : null,
    deadLetteredAt: typeof job.deadLetteredAt === "string" ? job.deadLetteredAt : null,
    lastError: typeof job.lastError === "string" && job.lastError ? job.lastError : typeof lastAttempt?.error === "string" ? lastAttempt.error : null
  };
}

export async function listPaymentTriggerRetryJobs({
  dataDir,
  tenantId = null,
  state = "pending",
  limit = 100
} = {}) {
  const targetState = state === "dead-letter" ? "dead-letter" : "pending";
  const dir = targetState === "dead-letter" ? retryDeadLetterDir(dataDir) : retryPendingDir(dataDir);
  const capped = Math.max(1, Math.min(500, safeInt(limit, 100)));
  let names = [];
  try {
    names = (await fs.readdir(dir)).filter((name) => name.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const rows = [];
  for (const name of names) {
    const fp = path.join(dir, name);
    // eslint-disable-next-line no-await-in-loop
    const job = await readJsonIfExists(fp);
    if (!isPlainObject(job)) continue;
    if (tenantId && String(job.tenantId ?? "") !== tenantId) continue;
    const row = normalizeRetryJobSummary({ job, state: targetState });
    if (!row) continue;
    rows.push(row);
  }
  rows.sort((a, b) => Date.parse(String(b.updatedAt ?? "")) - Date.parse(String(a.updatedAt ?? "")));
  return rows.slice(0, capped);
}

export async function replayPaymentTriggerDeadLetterJob({
  dataDir,
  tenantId,
  token,
  idempotencyKey,
  resetAttempts = false,
  tenantSettings = null,
  useCurrentSettings = true
} = {}) {
  const deadPath = retryDeadLetterPath({ dataDir, tenantId, token, idempotencyKey });
  const pendingPath = retryPendingPath({ dataDir, tenantId, token, idempotencyKey });
  const deadJob = await readJsonIfExists(deadPath);
  if (!deadJob) return { ok: false, code: "NOT_FOUND", message: "dead-letter job not found" };

  const pendingExists = await fileExists(pendingPath);
  if (pendingExists) return { ok: false, code: "PENDING_EXISTS", message: "pending retry job already exists" };

  const now = nowIso();
  const next = {
    ...deadJob,
    deadLetteredAt: null,
    replayedAt: now,
    replayCount: safeInt(deadJob.replayCount, 0) + 1,
    nextAttemptAt: now,
    updatedAt: now
  };

  if (resetAttempts) {
    next.attemptCount = 0;
    next.attempts = [];
    next.lastError = null;
  }

  if (useCurrentSettings && isPlainObject(tenantSettings?.paymentTriggers)) {
    const cfg = tenantSettings.paymentTriggers;
    const webhookUrl = typeof cfg.webhookUrl === "string" ? cfg.webhookUrl.trim() : "";
    if (webhookUrl) next.webhookUrl = webhookUrl;
    if (cfg.webhookSecret === null || cfg.webhookSecret === undefined || typeof cfg.webhookSecret === "string") {
      next.webhookSecretStored = cfg.webhookSecret ?? null;
    }
  }

  await fs.mkdir(path.dirname(pendingPath), { recursive: true });
  await fs.writeFile(pendingPath, JSON.stringify(next, null, 2) + "\n", "utf8");
  await fs.rm(deadPath, { force: true });

  return {
    ok: true,
    state: "pending",
    tenantId,
    token,
    idempotencyKey,
    attemptCount: safeInt(next.attemptCount, 0),
    maxAttempts: safeInt(next.maxAttempts, 0),
    nextAttemptAt: typeof next.nextAttemptAt === "string" ? next.nextAttemptAt : now,
    replayCount: safeInt(next.replayCount, 1)
  };
}
