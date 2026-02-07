import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { deliverTenantWebhooks } from "./webhooks.js";

function nowIso() {
  return new Date().toISOString();
}

function isPlainObject(v) {
  return Boolean(v && typeof v === "object" && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null));
}

function safeInt(value, fallback) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(n)) return fallback;
  return n;
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function webhookPayloadHashHex(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload ?? {}), "utf8").digest("hex");
}

function clampRetryConfig({ maxAttempts, backoffMs } = {}) {
  return {
    maxAttempts: Math.max(1, Math.min(50, safeInt(maxAttempts, 3))),
    backoffMs: Math.max(0, Math.min(86_400_000, safeInt(backoffMs, 250)))
  };
}

function nextRetryBackoffMs({ baseMs, attempt }) {
  const exp = Math.max(0, Math.min(16, Number(attempt ?? 1) - 1));
  return Math.min(86_400_000, Math.max(0, Number(baseMs ?? 0)) * (2 ** exp));
}

function retryPendingDir(dataDir) {
  return path.join(dataDir, "webhook_retry", "pending");
}

function retryDeadLetterDir(dataDir) {
  return path.join(dataDir, "webhook_retry", "dead-letter");
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

function normalizeRetryJobSummary({ job, state }) {
  if (!isPlainObject(job)) return null;
  const attempts = Array.isArray(job.attempts) ? job.attempts : [];
  const lastAttempt = attempts.length ? attempts[attempts.length - 1] : null;
  const webhook = isPlainObject(job.webhook) ? job.webhook : null;
  return {
    schemaVersion: "MagicLinkWebhookRetrySummary.v1",
    state,
    tenantId: typeof job.tenantId === "string" ? job.tenantId : null,
    token: typeof job.token === "string" ? job.token : null,
    event: typeof job.event === "string" ? job.event : null,
    idempotencyKey: typeof job.idempotencyKey === "string" ? job.idempotencyKey : null,
    webhookUrl: typeof webhook?.url === "string" ? webhook.url : null,
    attemptCount: Math.max(0, safeInt(job.attemptCount, 0)),
    maxAttempts: Math.max(1, safeInt(job.maxAttempts, 1)),
    nextAttemptAt: typeof job.nextAttemptAt === "string" ? job.nextAttemptAt : null,
    enqueuedAt: typeof job.enqueuedAt === "string" ? job.enqueuedAt : null,
    updatedAt: typeof job.updatedAt === "string" ? job.updatedAt : null,
    deadLetteredAt: typeof job.deadLetteredAt === "string" ? job.deadLetteredAt : null,
    replayCount: Math.max(0, safeInt(job.replayCount, 0)),
    lastError:
      typeof job.lastError === "string" && job.lastError
        ? job.lastError
        : typeof lastAttempt?.error === "string" && lastAttempt.error
          ? lastAttempt.error
          : null,
    lastStatusCode:
      Number.isFinite(Number(job.lastStatusCode))
        ? Number(job.lastStatusCode)
        : Number.isFinite(Number(lastAttempt?.statusCode))
          ? Number(lastAttempt.statusCode)
          : null
  };
}

function resolveWebhookByResult({ webhooks, result, event }) {
  const list = Array.isArray(webhooks) ? webhooks : [];
  const idx = safeInt(result?.webhookIndex, -1);
  if (idx >= 0 && idx < list.length && isPlainObject(list[idx])) return { webhook: list[idx], webhookIndex: idx };
  const url = typeof result?.url === "string" ? result.url.trim() : "";
  if (!url) return { webhook: null, webhookIndex: -1 };
  for (let i = 0; i < list.length; i += 1) {
    const w = list[i];
    if (!isPlainObject(w)) continue;
    if (!w.enabled) continue;
    const events = Array.isArray(w.events) ? w.events.map((x) => String(x ?? "").trim()) : [];
    const webhookUrl = typeof w.url === "string" ? w.url.trim() : "";
    if (!webhookUrl || webhookUrl !== url) continue;
    if (!events.includes(String(event ?? ""))) continue;
    return { webhook: w, webhookIndex: i };
  }
  return { webhook: null, webhookIndex: -1 };
}

export function webhookRetryIdempotencyKey({ tenantId, token, event, webhookUrl, payload }) {
  const payloadHash = webhookPayloadHashHex(payload);
  return sha256Hex(`${tenantId}\n${token}\n${event}\n${webhookUrl}\n${payloadHash}`);
}

export async function enqueueWebhookRetryJobs({
  dataDir,
  tenantId,
  token,
  event,
  payload,
  webhooks,
  deliveryResults,
  maxAttempts = 3,
  backoffMs = 250
} = {}) {
  const t = String(tenantId ?? "").trim();
  const tk = String(token ?? "").trim();
  const ev = String(event ?? "").trim();
  if (!t || !tk || !ev) {
    return { ok: false, enqueued: 0, deadLettered: 0, skipped: 0, error: "INVALID_INPUT" };
  }

  const retry = clampRetryConfig({ maxAttempts, backoffMs });
  const list = Array.isArray(deliveryResults) ? deliveryResults : [];
  const out = [];
  let enqueued = 0;
  let deadLettered = 0;
  let skipped = 0;

  for (const result of list) {
    if (!isPlainObject(result)) continue;
    if (result.ok) continue;
    const resolved = resolveWebhookByResult({ webhooks, result, event: ev });
    const webhook = resolved.webhook;
    if (!webhook) {
      skipped += 1;
      out.push({ ok: false, skipped: true, reason: "WEBHOOK_NOT_RESOLVED" });
      continue;
    }
    const webhookUrl = typeof webhook.url === "string" ? webhook.url.trim() : "";
    if (!webhookUrl) {
      skipped += 1;
      out.push({ ok: false, skipped: true, reason: "WEBHOOK_URL_EMPTY" });
      continue;
    }

    const idempotencyKey = webhookRetryIdempotencyKey({ tenantId: t, token: tk, event: ev, webhookUrl, payload });
    const pendingPath = retryPendingPath({ dataDir, tenantId: t, token: tk, idempotencyKey });
    const deadPath = retryDeadLetterPath({ dataDir, tenantId: t, token: tk, idempotencyKey });
    // Do not create duplicate retry jobs for the same delivery unit.
    // eslint-disable-next-line no-await-in-loop
    const pendingExists = await fileExists(pendingPath);
    // eslint-disable-next-line no-await-in-loop
    const deadExists = await fileExists(deadPath);
    if (pendingExists || deadExists) {
      skipped += 1;
      out.push({ ok: false, skipped: true, reason: pendingExists ? "PENDING_EXISTS" : "DEAD_LETTER_EXISTS", idempotencyKey });
      continue;
    }

    const initialAttemptNumber = Math.max(1, safeInt(result.attempts, 1));
    const initialAttempt = {
      at: nowIso(),
      ok: false,
      statusCode: Number.isFinite(Number(result.statusCode)) ? Number(result.statusCode) : null,
      error: typeof result.error === "string" && result.error ? result.error : "WEBHOOK_DELIVERY_FAILED",
      source: "inline",
      attemptNumber: initialAttemptNumber
    };

    const job = {
      schemaVersion: "MagicLinkWebhookRetryJob.v1",
      tenantId: t,
      token: tk,
      event: ev,
      idempotencyKey,
      payload,
      webhook: {
        url: webhookUrl,
        events: Array.isArray(webhook.events) ? webhook.events.map((x) => String(x ?? "").trim()).filter(Boolean) : [ev],
        enabled: true,
        secret: typeof webhook.secret === "string" && webhook.secret ? webhook.secret : null
      },
      maxAttempts: retry.maxAttempts,
      backoffMs: retry.backoffMs,
      attemptCount: initialAttemptNumber,
      nextAttemptAt: null,
      attempts: [initialAttempt],
      lastError: initialAttempt.error,
      lastStatusCode: initialAttempt.statusCode,
      enqueuedAt: nowIso(),
      updatedAt: nowIso(),
      replayCount: 0
    };

    if (initialAttemptNumber >= retry.maxAttempts) {
      const dead = { ...job, deadLetteredAt: nowIso(), updatedAt: nowIso() };
      // eslint-disable-next-line no-await-in-loop
      await fs.mkdir(path.dirname(deadPath), { recursive: true });
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(deadPath, JSON.stringify(dead, null, 2) + "\n", "utf8");
      deadLettered += 1;
      out.push({
        ok: false,
        queued: false,
        deadLettered: true,
        idempotencyKey,
        token: tk,
        event: ev,
        webhookUrl,
        attemptCount: initialAttemptNumber,
        maxAttempts: retry.maxAttempts,
        reason: "MAX_ATTEMPTS_EXHAUSTED_INLINE"
      });
      continue;
    }

    const nextMs = Date.now() + nextRetryBackoffMs({ baseMs: retry.backoffMs, attempt: initialAttemptNumber });
    job.nextAttemptAt = new Date(nextMs).toISOString();
    // eslint-disable-next-line no-await-in-loop
    await fs.mkdir(path.dirname(pendingPath), { recursive: true });
    // eslint-disable-next-line no-await-in-loop
    await fs.writeFile(pendingPath, JSON.stringify(job, null, 2) + "\n", "utf8");
    enqueued += 1;
    out.push({
      ok: true,
      queued: true,
      idempotencyKey,
      token: tk,
      event: ev,
      webhookUrl,
      attemptCount: initialAttemptNumber,
      maxAttempts: retry.maxAttempts,
      nextAttemptAt: job.nextAttemptAt
    });
  }

  return { ok: true, enqueued, deadLettered, skipped, rows: out };
}

export async function processWebhookRetryQueueOnce({
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

    const tenantId = typeof job.tenantId === "string" ? job.tenantId : "";
    if (tenantIdFilter && tenantId !== tenantIdFilter) {
      stats.skipped += 1;
      continue;
    }

    const nextAt = Date.parse(String(job.nextAttemptAt ?? ""));
    if (Number.isFinite(nextAt) && nextAt > nowMs) {
      stats.skipped += 1;
      continue;
    }

    const token = typeof job.token === "string" ? job.token : "";
    const event = typeof job.event === "string" ? job.event : "";
    const idempotencyKey = typeof job.idempotencyKey === "string" ? job.idempotencyKey : "";
    const payload = isPlainObject(job.payload) ? job.payload : null;
    const webhook = isPlainObject(job.webhook) ? job.webhook : null;
    if (!tenantId || !token || !event || !idempotencyKey || !payload || !webhook) {
      stats.failed += 1;
      continue;
    }

    const deliveryRows =
      // eslint-disable-next-line no-await-in-loop
      await deliverTenantWebhooks({
        dataDir,
        tenantId,
        token,
        event,
        payload,
        webhooks: [webhook],
        settingsKey,
        deliveryMode: "http",
        timeoutMs,
        maxAttempts: 1,
        retryBackoffMs: 0
      });
    const delivered = Array.isArray(deliveryRows) && deliveryRows.length ? deliveryRows[0] : { ok: false, statusCode: null, error: "WEBHOOK_RETRY_DELIVERY_SKIPPED" };

    const attemptCount = Math.max(0, safeInt(job.attemptCount, 0));
    const nextAttemptNumber = attemptCount + 1;
    const attempts = Array.isArray(job.attempts) ? [...job.attempts] : [];
    attempts.push({
      at: nowIso(),
      ok: Boolean(delivered.ok),
      statusCode: Number.isFinite(Number(delivered.statusCode)) ? Number(delivered.statusCode) : null,
      error: typeof delivered.error === "string" && delivered.error ? delivered.error : null,
      source: "retry_worker",
      attemptNumber: nextAttemptNumber
    });

    if (delivered.ok) {
      // eslint-disable-next-line no-await-in-loop
      await fs.rm(fp, { force: true });
      stats.delivered += 1;
      continue;
    }

    const maxAttempts = Math.max(1, safeInt(job.maxAttempts, 3));
    const backoffMs = Math.max(0, safeInt(job.backoffMs, 250));
    const updated = {
      ...job,
      attemptCount: nextAttemptNumber,
      attempts,
      lastError: typeof delivered.error === "string" && delivered.error ? delivered.error : null,
      lastStatusCode: Number.isFinite(Number(delivered.statusCode)) ? Number(delivered.statusCode) : null,
      updatedAt: nowIso()
    };

    if (nextAttemptNumber >= maxAttempts) {
      const deadPath = retryDeadLetterPath({ dataDir, tenantId, token, idempotencyKey });
      const dead = { ...updated, deadLetteredAt: nowIso(), updatedAt: nowIso() };
      // eslint-disable-next-line no-await-in-loop
      await fs.mkdir(path.dirname(deadPath), { recursive: true });
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(deadPath, JSON.stringify(dead, null, 2) + "\n", "utf8");
      // eslint-disable-next-line no-await-in-loop
      await fs.rm(fp, { force: true });
      stats.deadLettered += 1;
      continue;
    }

    const nextMs = nowMs + nextRetryBackoffMs({ baseMs: backoffMs, attempt: nextAttemptNumber });
    updated.nextAttemptAt = new Date(nextMs).toISOString();
    // eslint-disable-next-line no-await-in-loop
    await fs.writeFile(fp, JSON.stringify(updated, null, 2) + "\n", "utf8");
    stats.retried += 1;
  }

  return stats;
}

export function startWebhookRetryWorker({
  dataDir,
  settingsKey = null,
  timeoutMs = 5_000,
  intervalMs = 2_000,
  onRetry = null,
  onDeadLetter = null,
  onDelivered = null,
  onDepth = null
} = {}) {
  const cadence = Math.max(100, safeInt(intervalMs, 2_000));
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const stats = await processWebhookRetryQueueOnce({ dataDir, settingsKey, timeoutMs });
      if (typeof onRetry === "function" && stats.retried > 0) onRetry(stats.retried, stats);
      if (typeof onDeadLetter === "function" && stats.deadLettered > 0) onDeadLetter(stats.deadLettered, stats);
      if (typeof onDelivered === "function" && stats.delivered > 0) onDelivered(stats.delivered, stats);
      if (typeof onDepth === "function") onDepth(await webhookRetryQueueDepth({ dataDir }), stats);
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

export async function webhookRetryQueueDepth({ dataDir } = {}) {
  try {
    const names = (await fs.readdir(retryPendingDir(dataDir))).filter((name) => name.endsWith(".json"));
    return names.length;
  } catch {
    return 0;
  }
}

export async function listWebhookRetryJobs({
  dataDir,
  tenantId = null,
  state = "pending",
  limit = 100
} = {}) {
  const targetState = state === "dead-letter" ? "dead-letter" : "pending";
  const dir = targetState === "dead-letter" ? retryDeadLetterDir(dataDir) : retryPendingDir(dataDir);
  const capped = Math.max(1, Math.min(5_000, safeInt(limit, 100)));
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

export async function replayWebhookDeadLetterJob({
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
    replayCount: Math.max(0, safeInt(deadJob.replayCount, 0)) + 1,
    nextAttemptAt: now,
    updatedAt: now
  };

  if (resetAttempts) {
    next.attemptCount = 0;
    next.attempts = [];
    next.lastError = null;
    next.lastStatusCode = null;
  }

  if (useCurrentSettings && isPlainObject(tenantSettings)) {
    const webhooks = Array.isArray(tenantSettings.webhooks) ? tenantSettings.webhooks : [];
    const currentUrl = typeof next?.webhook?.url === "string" ? next.webhook.url : null;
    const currentEvent = typeof next.event === "string" ? next.event : null;
    const replacement = webhooks.find((w) => {
      if (!isPlainObject(w)) return false;
      if (!w.enabled) return false;
      const url = typeof w.url === "string" ? w.url.trim() : "";
      if (!url || (currentUrl && url !== currentUrl)) return false;
      const events = Array.isArray(w.events) ? w.events.map((x) => String(x ?? "").trim()) : [];
      return currentEvent ? events.includes(currentEvent) : true;
    });
    if (replacement) {
      next.webhook = {
        url: typeof replacement.url === "string" ? replacement.url.trim() : currentUrl,
        events: Array.isArray(replacement.events) ? replacement.events.map((x) => String(x ?? "").trim()).filter(Boolean) : next?.webhook?.events ?? [],
        enabled: true,
        secret: typeof replacement.secret === "string" && replacement.secret ? replacement.secret : next?.webhook?.secret ?? null
      };
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
    attemptCount: Math.max(0, safeInt(next.attemptCount, 0)),
    maxAttempts: Math.max(1, safeInt(next.maxAttempts, 1)),
    nextAttemptAt: typeof next.nextAttemptAt === "string" ? next.nextAttemptAt : now,
    replayCount: Math.max(1, safeInt(next.replayCount, 1))
  };
}
