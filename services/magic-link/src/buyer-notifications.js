import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import https from "node:https";

import { sendSmtpMail } from "./smtp.js";
import { decryptStoredSecret } from "./tenant-settings.js";

function nowIso() {
  return new Date().toISOString();
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function normalizeEmailLower(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw || raw.length > 320) return null;
  if (/\s/.test(raw)) return null;
  const parts = raw.split("@");
  if (parts.length !== 2) return null;
  if (!parts[0] || !parts[1]) return null;
  return raw;
}

function normalizeRunId(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw.length > 128) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(raw)) return null;
  return raw;
}

function statusFromCliOut(cliOut) {
  const ok = Boolean(cliOut?.ok);
  const verificationOk = Boolean(cliOut?.verificationOk);
  const warnings = Array.isArray(cliOut?.warnings) ? cliOut.warnings : [];
  if (!ok || !verificationOk) return "red";
  if (warnings.length) return "amber";
  return "green";
}

function statusLabel(status) {
  if (status === "green") return "Verified - Payable";
  if (status === "amber") return "Review Required";
  return "Failed - See Details";
}

function formatMoney({ currency, totalCents }) {
  const cur = String(currency ?? "").trim() || "USD";
  const cents = String(totalCents ?? "").trim();
  if (!/^[0-9]+$/.test(cents)) return `${cur} ${cents || "0"}`;
  if (cur === "USD") {
    const padded = cents.padStart(3, "0");
    const dollars = padded.slice(0, -2);
    const tail = padded.slice(-2);
    return `$${dollars}.${tail}`;
  }
  return `${cur} ${cents} cents`;
}

function evidenceCountFromSummary(publicSummary) {
  const closePackCount = publicSummary?.closePackSummaryV1?.evidenceIndex?.itemCount;
  if (Number.isInteger(closePackCount) && closePackCount >= 0) return closePackCount;
  const meteringCount = publicSummary?.metering?.evidenceRefsCount;
  if (Number.isInteger(meteringCount) && meteringCount >= 0) return meteringCount;
  return null;
}

function notificationStatePath({ dataDir, tenantId, token }) {
  return path.join(dataDir, "notifications", "verification", tenantId, `${token}.json`);
}

function runNotificationStatePath({ dataDir, tenantId, runId }) {
  const key = sha256Hex(`${tenantId}\n${runId}`);
  return path.join(dataDir, "notifications", "verification-run", tenantId, `${key}.json`);
}

function outboxPath({ dataDir, tenantId, token, recipient }) {
  const hash = sha256Hex(`${tenantId}\n${token}\n${recipient}`).slice(0, 24);
  return path.join(dataDir, "buyer-notification-outbox", `${tenantId}_${token}_${hash}.json`);
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
        res.on("end", () => {
          resolve({ ok: true, statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") });
        });
      }
    );
    req.on("timeout", () => {
      try {
        req.destroy(new Error("timeout"));
      } catch {
        // ignore
      }
    });
    req.on("error", (err) => resolve({ ok: false, error: err?.message ?? String(err ?? "error") }));
    req.end(body);
  });
}

async function loadStateBestEffort({ dataDir, tenantId, token }) {
  const fp = notificationStatePath({ dataDir, tenantId, token });
  try {
    return JSON.parse(await fs.readFile(fp, "utf8"));
  } catch {
    return null;
  }
}

async function writeState({ dataDir, tenantId, token, state }) {
  const fp = notificationStatePath({ dataDir, tenantId, token });
  await fs.mkdir(path.dirname(fp), { recursive: true });
  await fs.writeFile(fp, JSON.stringify(state, null, 2) + "\n", "utf8");
}

async function loadRunStateBestEffort({ dataDir, tenantId, runId }) {
  const fp = runNotificationStatePath({ dataDir, tenantId, runId });
  try {
    return JSON.parse(await fs.readFile(fp, "utf8"));
  } catch {
    return null;
  }
}

async function writeRunState({ dataDir, tenantId, runId, state }) {
  const fp = runNotificationStatePath({ dataDir, tenantId, runId });
  await fs.mkdir(path.dirname(fp), { recursive: true });
  await fs.writeFile(fp, JSON.stringify(state, null, 2) + "\n", "utf8");
}

function buildEmailText({ recipient, summary }) {
  const lines = [];
  lines.push(`Verification update for ${summary.vendorName}: ${summary.statusLabel}`);
  lines.push("");
  lines.push(`Artifact ID: ${summary.token}`);
  if (summary.runId) lines.push(`Run ID: ${summary.runId}`);
  if (summary.invoiceId) lines.push(`Invoice ID: ${summary.invoiceId}`);
  if (summary.evidenceCount !== null) lines.push(`Evidence count: ${summary.evidenceCount}`);
  if (summary.netPayable) lines.push(`Net payable: ${summary.netPayable}`);
  lines.push(`Magic Link: ${summary.magicLinkUrl}`);
  lines.push("");
  lines.push(`Recipient: ${recipient}`);
  lines.push("This message is generated from artifact-derived verification data.");
  return lines.join("\n");
}

function buildInboxTestText({ recipient, summary }) {
  const lines = [];
  lines.push("Nooterra inbox delivery test");
  lines.push("");
  lines.push(`Tenant: ${summary.tenantId}`);
  lines.push(`Token: ${summary.token}`);
  lines.push(`Recipient: ${recipient}`);
  lines.push(`Status: ${summary.statusLabel}`);
  if (summary.magicLinkUrl) lines.push(`Open inbox: ${summary.magicLinkUrl}`);
  lines.push("");
  lines.push("This is a delivery test generated from the buyer notification settings page.");
  return lines.join("\n");
}

const PRODUCT_NOTIFICATION_EVENT_LABELS = {
  "approval.required": "Approval required",
  "information.required": "Information required",
  "receipt.ready": "Receipt ready",
  "run.update": "Run update",
  "dispute.update": "Dispute update"
};

function normalizeBuyerProductDeepLinkPath(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw.length > 2000 || !raw.startsWith("/")) return null;
  if (/^\/approvals(?:[/?#]|$)/.test(raw)) return raw;
  if (/^\/receipts(?:[/?#]|$)/.test(raw)) return raw;
  if (/^\/runs\/[a-zA-Z0-9_-]+(?:[/?#]|$)/.test(raw)) return raw;
  if (/^\/disputes(?:[/?#]|$)/.test(raw)) return raw;
  return null;
}

function normalizeBuyerProductNotificationPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "payload must be an object" };
  }
  const eventTypeRaw = String(payload.eventType ?? "").trim().toLowerCase().replaceAll("_", ".");
  if (!PRODUCT_NOTIFICATION_EVENT_LABELS[eventTypeRaw]) {
    return { ok: false, error: "eventType must be approval.required, information.required, receipt.ready, run.update, or dispute.update" };
  }
  const title = String(payload.title ?? "").trim();
  if (!title || title.length > 160) return { ok: false, error: "title must be 1-160 chars" };
  const detail = String(payload.detail ?? "").trim();
  if (!detail || detail.length > 1000) return { ok: false, error: "detail must be 1-1000 chars" };
  const deepLinkPath = normalizeBuyerProductDeepLinkPath(payload.deepLinkPath);
  if (!deepLinkPath) return { ok: false, error: "deepLinkPath must be a supported internal route" };
  const itemRef = payload.itemRef && typeof payload.itemRef === "object" && !Array.isArray(payload.itemRef) ? payload.itemRef : {};
  const requestId = typeof itemRef.requestId === "string" ? itemRef.requestId.trim() : "";
  const receiptId = typeof itemRef.receiptId === "string" ? itemRef.receiptId.trim() : "";
  const runId = typeof itemRef.runId === "string" ? itemRef.runId.trim() : "";
  const disputeId = typeof itemRef.disputeId === "string" ? itemRef.disputeId.trim() : "";
  const caseId = typeof itemRef.caseId === "string" ? itemRef.caseId.trim() : "";
  if (eventTypeRaw === "approval.required" && !requestId) return { ok: false, error: "approval.required requires itemRef.requestId" };
  if (eventTypeRaw === "information.required" && !runId) return { ok: false, error: "information.required requires itemRef.runId" };
  if (eventTypeRaw === "receipt.ready" && !receiptId) return { ok: false, error: "receipt.ready requires itemRef.receiptId" };
  if (eventTypeRaw === "run.update" && !runId) return { ok: false, error: "run.update requires itemRef.runId" };
  if (eventTypeRaw === "dispute.update" && !disputeId) return { ok: false, error: "dispute.update requires itemRef.disputeId" };
  return {
    ok: true,
    payload: {
      eventType: eventTypeRaw,
      title,
      detail,
      deepLinkPath,
      itemRef: {
        ...(requestId ? { requestId } : {}),
        ...(receiptId ? { receiptId } : {}),
        ...(runId ? { runId } : {}),
        ...(disputeId ? { disputeId } : {}),
        ...(caseId ? { caseId } : {})
      }
    }
  };
}

function buildBuyerProductNotificationText({ recipient, message }) {
  const lines = [];
  lines.push(`Nooterra ${PRODUCT_NOTIFICATION_EVENT_LABELS[message.payload.eventType]}`);
  lines.push("");
  lines.push(`Title: ${message.payload.title}`);
  lines.push(`Summary: ${message.payload.detail}`);
  if (message.payload.itemRef.requestId) lines.push(`Approval request: ${message.payload.itemRef.requestId}`);
  if (message.payload.itemRef.receiptId) lines.push(`Receipt: ${message.payload.itemRef.receiptId}`);
  if (message.payload.itemRef.runId) lines.push(`Run: ${message.payload.itemRef.runId}`);
  if (message.payload.itemRef.disputeId) lines.push(`Dispute: ${message.payload.itemRef.disputeId}`);
  if (message.payload.itemRef.caseId) lines.push(`Case: ${message.payload.itemRef.caseId}`);
  lines.push(`Open: ${message.summary.magicLinkUrl}`);
  lines.push(`Recipient: ${recipient}`);
  lines.push("");
  lines.push("This notification was generated from a live Nooterra product event.");
  return lines.join("\n");
}

function createNotificationSummary({ tenantId, token, runId, publicSummary, cliOut, magicLinkUrl }) {
  const status = statusFromCliOut(cliOut);
  const vendorName =
    typeof publicSummary?.vendorName === "string" && publicSummary.vendorName.trim()
      ? publicSummary.vendorName.trim()
      : typeof publicSummary?.vendorId === "string" && publicSummary.vendorId.trim()
        ? publicSummary.vendorId.trim()
        : "Vendor";
  const invoiceId = typeof publicSummary?.invoiceClaim?.invoiceId === "string" ? publicSummary.invoiceClaim.invoiceId : null;
  const currency = typeof publicSummary?.invoiceClaim?.currency === "string" ? publicSummary.invoiceClaim.currency : "USD";
  const totalCents = typeof publicSummary?.invoiceClaim?.totalCents === "string" ? publicSummary.invoiceClaim.totalCents : null;
  const evidenceCount = evidenceCountFromSummary(publicSummary);

  return {
    tenantId,
    token,
    runId: runId ?? null,
    status,
    statusLabel: statusLabel(status),
    vendorName,
    invoiceId,
    evidenceCount,
    netPayable: totalCents ? formatMoney({ currency, totalCents }) : null,
    magicLinkUrl
  };
}

function notificationRecipients(tenantSettings) {
  const rows = Array.isArray(tenantSettings?.buyerNotifications?.emails) ? tenantSettings.buyerNotifications.emails : [];
  const out = [];
  for (const raw of rows) {
    const email = normalizeEmailLower(raw);
    if (!email) continue;
    out.push(email);
  }
  return [...new Set(out)].sort();
}

function normalizeDeliveryMode(tenantSettings) {
  const modeRaw = tenantSettings?.buyerNotifications?.deliveryMode;
  return String(modeRaw ?? "smtp").trim().toLowerCase();
}

function createBuyerInboxTestMessage({ tenantId, publicBaseUrl, token = null } = {}) {
  const normalizedTenantId = String(tenantId ?? "").trim() || "tenant_default";
  const normalizedToken =
    typeof token === "string" && token.trim()
      ? token.trim()
      : `notif_test_${sha256Hex(`${normalizedTenantId}\n${nowIso()}`).slice(0, 24)}`;
  const base = String(publicBaseUrl ?? "").trim().replace(/\/+$/, "");
  const magicLinkUrl = base ? `${base}/inbox?notification=test` : "/inbox?notification=test";
  const summary = {
    tenantId: normalizedTenantId,
    token: normalizedToken,
    runId: null,
    status: "green",
    statusLabel: "Inbox Test Ready",
    vendorName: "Nooterra Inbox",
    invoiceId: null,
    evidenceCount: 1,
    netPayable: null,
    magicLinkUrl
  };
  return {
    token: normalizedToken,
    subject: "Nooterra inbox delivery test",
    summary,
    renderText(recipient) {
      return buildInboxTestText({ recipient, summary });
    }
  };
}

function createBuyerProductNotificationMessage({ tenantId, publicBaseUrl, payload, token = null } = {}) {
  const normalized = normalizeBuyerProductNotificationPayload(payload);
  if (!normalized.ok) return normalized;
  const normalizedTenantId = String(tenantId ?? "").trim() || "tenant_default";
  const issuedAt = nowIso();
  const eventRef =
    normalized.payload.itemRef.requestId ??
    normalized.payload.itemRef.receiptId ??
    normalized.payload.itemRef.runId ??
    normalized.payload.itemRef.disputeId ??
    normalized.payload.itemRef.caseId ??
    normalized.payload.title;
  const normalizedToken =
    typeof token === "string" && token.trim()
      ? token.trim()
      : `notif_product_${sha256Hex(`${normalizedTenantId}\n${normalized.payload.eventType}\n${eventRef}\n${issuedAt}`).slice(0, 24)}`;
  const base = String(publicBaseUrl ?? "").trim().replace(/\/+$/, "");
  const magicLinkUrl = base ? `${base}${normalized.payload.deepLinkPath}` : normalized.payload.deepLinkPath;
  const summary = {
    tenantId: normalizedTenantId,
    token: normalizedToken,
    runId: normalized.payload.itemRef.runId || null,
    status: "green",
    statusLabel: PRODUCT_NOTIFICATION_EVENT_LABELS[normalized.payload.eventType],
    vendorName: "Nooterra",
    invoiceId: null,
    evidenceCount: null,
    netPayable: null,
    magicLinkUrl
  };
  return {
    ok: true,
    token: normalizedToken,
    payload: normalized.payload,
    subject: `Nooterra ${PRODUCT_NOTIFICATION_EVENT_LABELS[normalized.payload.eventType]}: ${normalized.payload.title}`,
    summary,
    renderText(recipient) {
      return buildBuyerProductNotificationText({ recipient, message: { payload: normalized.payload, summary } });
    }
  };
}

export function buildBuyerNotificationPreview({
  tenantSettings,
  subject,
  summary,
  renderText,
  deliveryEvent = "verification.email"
} = {}) {
  const recipients = notificationRecipients(tenantSettings);
  const deliveryMode = normalizeDeliveryMode(tenantSettings);
  const webhookUrl = typeof tenantSettings?.buyerNotifications?.webhookUrl === "string" ? tenantSettings.buyerNotifications.webhookUrl.trim() : "";
  const webhookSecretPresent = Boolean(tenantSettings?.buyerNotifications?.webhookSecret);
  const sampleRecipient = recipients[0] ?? "buyer@example.com";
  const text = typeof renderText === "function" ? renderText(sampleRecipient) : "";
  return {
    schemaVersion: "MagicLinkBuyerNotificationPreview.v1",
    deliveryEvent,
    deliveryMode,
    recipients,
    subject: String(subject ?? "").trim(),
    sampleRecipient,
    summary,
    text,
    webhookUrl: webhookUrl || null,
    webhookSecretConfigured: webhookSecretPresent
  };
}

async function deliverBuyerNotification({
  dataDir,
  tenantId,
  token,
  runId = null,
  tenantSettings,
  subject,
  summary,
  deliveryEvent = "verification.email",
  renderText,
  smtpConfig,
  settingsKey,
  timeoutMs = 5_000
} = {}) {
  const recipients = notificationRecipients(tenantSettings);
  if (!recipients.length) return { ok: false, skipped: true, reason: "NO_RECIPIENTS", recipients: [] };

  const runIdNorm = normalizeRunId(runId);

  const previous = await loadStateBestEffort({ dataDir, tenantId, token });
  if (previous && previous.ok && typeof previous.sentAt === "string" && previous.sentAt) {
    return { ok: true, skipped: true, reason: "ALREADY_SENT", sentAt: previous.sentAt, recipients };
  }

  if (runIdNorm) {
    const priorRun = await loadRunStateBestEffort({ dataDir, tenantId, runId: runIdNorm });
    if (priorRun && typeof priorRun.sentAt === "string" && priorRun.sentAt) {
      return {
        ok: true,
        skipped: true,
        reason: "ALREADY_SENT_RUN",
        sentAt: priorRun.sentAt,
        token: typeof priorRun.token === "string" ? priorRun.token : null,
        runId: runIdNorm,
        recipients
      };
    }
  }

  const deliveryMode = normalizeDeliveryMode(tenantSettings);
  if (deliveryMode !== "smtp" && deliveryMode !== "webhook" && deliveryMode !== "record") {
    return { ok: false, skipped: true, reason: "INVALID_DELIVERY_MODE", deliveryMode };
  }

  const webhookUrl = typeof tenantSettings?.buyerNotifications?.webhookUrl === "string" ? tenantSettings.buyerNotifications.webhookUrl.trim() : "";
  const webhookSecret = decryptStoredSecret({ settingsKey, storedSecret: tenantSettings?.buyerNotifications?.webhookSecret });
  const results = [];

  for (const recipient of recipients) {
    const text = typeof renderText === "function" ? renderText(recipient) : "";
    if (deliveryMode === "record") {
      const out = {
        schemaVersion: "MagicLinkBuyerNotificationOutbox.v1",
        eventType: deliveryEvent,
        createdAt: nowIso(),
        tenantId,
        token,
        recipient,
        subject,
        summary,
        text
      };
      const fp = outboxPath({ dataDir, tenantId, token, recipient });
      await fs.mkdir(path.dirname(fp), { recursive: true });
      await fs.writeFile(fp, JSON.stringify(out, null, 2) + "\n", "utf8");
      results.push({ ok: true, recipient, mode: deliveryMode, recorded: true });
      continue;
    }

    if (deliveryMode === "smtp") {
      try {
        const from = typeof smtpConfig?.from === "string" ? smtpConfig.from.trim() : "";
        if (!from) throw new Error("SMTP_NOT_CONFIGURED");
        await sendSmtpMail({
          host: smtpConfig?.host,
          port: smtpConfig?.port,
          secure: Boolean(smtpConfig?.secure),
          starttls: smtpConfig?.starttls === undefined ? true : Boolean(smtpConfig?.starttls),
          auth: smtpConfig?.user && smtpConfig?.pass ? { user: smtpConfig.user, pass: smtpConfig.pass } : null,
          from,
          to: recipient,
          subject,
          text,
          timeoutMs
        });
        results.push({ ok: true, recipient, mode: deliveryMode });
      } catch (err) {
        results.push({ ok: false, recipient, mode: deliveryMode, error: err?.message ?? String(err ?? "smtp failed") });
      }
      continue;
    }

    if (!webhookUrl) {
      results.push({ ok: false, recipient, mode: deliveryMode, error: "WEBHOOK_URL_MISSING" });
      continue;
    }
    const payload = {
      schemaVersion: "MagicLinkBuyerNotificationWebhook.v1",
      eventType: deliveryEvent,
      sentAt: nowIso(),
      tenantId,
      token,
      recipient,
      subject,
      summary,
      text
    };
    const body = JSON.stringify(payload);
    const headers = {
      "content-type": "application/json; charset=utf-8",
      "content-length": String(Buffer.byteLength(body, "utf8")),
      "x-nooterra-notification-event": deliveryEvent
    };
    if (webhookSecret) {
      const ts = new Date().toISOString();
      const sig = crypto.createHmac("sha256", webhookSecret).update(`${ts}.${body}`, "utf8").digest("hex");
      headers["x-nooterra-timestamp"] = ts;
      headers["x-nooterra-signature"] = `v1=${sig}`;
    }
    const res = await request({ url: webhookUrl, method: "POST", headers, body, timeoutMs });
    if (res.ok && res.statusCode >= 200 && res.statusCode < 300) {
      results.push({ ok: true, recipient, mode: deliveryMode, statusCode: res.statusCode });
    } else if (res.ok) {
      results.push({ ok: false, recipient, mode: deliveryMode, statusCode: res.statusCode, error: "WEBHOOK_NON_2XX" });
    } else {
      results.push({ ok: false, recipient, mode: deliveryMode, error: res.error ?? "WEBHOOK_FAILED" });
    }
  }

  const state = {
    schemaVersion: "MagicLinkBuyerNotificationState.v1",
    eventType: deliveryEvent,
    tenantId,
    token,
    runId: runIdNorm,
    attemptedAt: nowIso(),
    sentAt: results.every((r) => r.ok) ? nowIso() : null,
    ok: results.every((r) => r.ok),
    deliveryMode,
    recipients,
    summary,
    results
  };
  await writeState({ dataDir, tenantId, token, state });
  if (state.ok && state.sentAt && runIdNorm) {
    await writeRunState({
      dataDir,
      tenantId,
      runId: runIdNorm,
      state: {
        schemaVersion: "MagicLinkBuyerNotificationRunState.v1",
        tenantId,
        runId: runIdNorm,
        token,
        ok: true,
        sentAt: state.sentAt,
        deliveryMode,
        recipients
      }
    });
  }
  return state;
}

export async function sendBuyerVerificationNotifications({
  dataDir,
  tenantId,
  token,
  runId = null,
  tenantSettings,
  publicSummary,
  cliOut,
  magicLinkUrl,
  smtpConfig,
  settingsKey,
  timeoutMs = 5_000
} = {}) {
  const runIdNorm = normalizeRunId(runId);
  const summary = createNotificationSummary({ tenantId, token, runId: runIdNorm, publicSummary, cliOut, magicLinkUrl });
  return await deliverBuyerNotification({
    dataDir,
    tenantId,
    token,
    runId: runIdNorm,
    tenantSettings,
    subject: `Nooterra verification ready: ${summary.statusLabel}`,
    summary,
    deliveryEvent: "verification.email",
    renderText: (recipient) => buildEmailText({ recipient, summary }),
    smtpConfig,
    settingsKey,
    timeoutMs
  });
}

export function buildBuyerNotificationTestPreview({
  tenantId,
  tenantSettings,
  publicBaseUrl
} = {}) {
  const message = createBuyerInboxTestMessage({ tenantId, publicBaseUrl, token: `notif_test_preview_${sha256Hex(String(tenantId ?? "")).slice(0, 12)}` });
  return buildBuyerNotificationPreview({
    tenantSettings,
    subject: message.subject,
    summary: message.summary,
    deliveryEvent: "buyer.notification.test",
    renderText: message.renderText
  });
}

export function buildBuyerProductNotificationPreview({
  tenantId,
  tenantSettings,
  publicBaseUrl,
  payload
} = {}) {
  const message = createBuyerProductNotificationMessage({
    tenantId,
    publicBaseUrl,
    payload,
    token: `notif_product_preview_${sha256Hex(`${tenantId ?? "tenant_default"}\n${JSON.stringify(payload ?? {})}`).slice(0, 12)}`
  });
  if (!message.ok) return message;
  return {
    ok: true,
    preview: buildBuyerNotificationPreview({
      tenantSettings,
      subject: message.subject,
      summary: message.summary,
      deliveryEvent: message.payload.eventType,
      renderText: message.renderText
    })
  };
}

export async function sendBuyerNotificationTest({
  dataDir,
  tenantId,
  tenantSettings,
  publicBaseUrl,
  smtpConfig,
  settingsKey,
  timeoutMs = 5_000
} = {}) {
  const message = createBuyerInboxTestMessage({ tenantId, publicBaseUrl });
  return await deliverBuyerNotification({
    dataDir,
    tenantId,
    token: message.token,
    runId: null,
    tenantSettings,
    subject: message.subject,
    summary: message.summary,
    deliveryEvent: "buyer.notification.test",
    renderText: message.renderText,
    smtpConfig,
    settingsKey,
    timeoutMs
  });
}

export async function sendBuyerProductNotification({
  dataDir,
  tenantId,
  tenantSettings,
  publicBaseUrl,
  token = null,
  payload,
  smtpConfig,
  settingsKey,
  timeoutMs = 5_000
} = {}) {
  const message = createBuyerProductNotificationMessage({ tenantId, publicBaseUrl, payload, token });
  if (!message.ok) return { ok: false, skipped: true, reason: "INVALID_PRODUCT_EVENT", error: message.error ?? "invalid payload" };
  return await deliverBuyerNotification({
    dataDir,
    tenantId,
    token: message.token,
    runId: message.payload.itemRef.runId || null,
    tenantSettings,
    subject: message.subject,
    summary: message.summary,
    deliveryEvent: message.payload.eventType,
    renderText: message.renderText,
    smtpConfig,
    settingsKey,
    timeoutMs
  });
}

export async function loadLatestBuyerNotificationStatusBestEffort({ dataDir, tenantId } = {}) {
  const dir = path.join(dataDir, "notifications", "verification", tenantId);
  let names = [];
  try {
    names = (await fs.readdir(dir)).filter((n) => n.endsWith(".json"));
  } catch {
    return null;
  }
  let latest = null;
  let latestAt = 0;
  for (const name of names) {
    const fp = path.join(dir, name);
    let row = null;
    try {
      // eslint-disable-next-line no-await-in-loop
      row = JSON.parse(await fs.readFile(fp, "utf8"));
    } catch {
      row = null;
    }
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const atRaw = typeof row.sentAt === "string" && row.sentAt ? row.sentAt : typeof row.attemptedAt === "string" ? row.attemptedAt : null;
    const at = atRaw ? Date.parse(atRaw) : NaN;
    const ts = Number.isFinite(at) ? at : 0;
    if (ts >= latestAt) {
      latestAt = ts;
      latest = {
        token: typeof row.token === "string" ? row.token : null,
        ok: Boolean(row.ok),
        attemptedAt: typeof row.attemptedAt === "string" ? row.attemptedAt : null,
        sentAt: typeof row.sentAt === "string" ? row.sentAt : null,
        deliveryMode: typeof row.deliveryMode === "string" ? row.deliveryMode : null,
        recipients: Array.isArray(row.recipients) ? row.recipients : [],
        failures: Array.isArray(row.results) ? row.results.filter((x) => !x?.ok).map((x) => ({ recipient: x?.recipient ?? null, error: x?.error ?? null })) : []
      };
    }
  }
  return latest;
}
