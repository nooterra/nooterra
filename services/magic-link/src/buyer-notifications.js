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
  const recipients = notificationRecipients(tenantSettings);
  if (!recipients.length) return { ok: true, skipped: true, reason: "NO_RECIPIENTS", recipients: [] };

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

  const modeRaw = tenantSettings?.buyerNotifications?.deliveryMode;
  const deliveryMode = String(modeRaw ?? "smtp").trim().toLowerCase();
  if (deliveryMode !== "smtp" && deliveryMode !== "webhook" && deliveryMode !== "record") {
    return { ok: false, skipped: true, reason: "INVALID_DELIVERY_MODE", deliveryMode };
  }

  const summary = createNotificationSummary({ tenantId, token, runId: runIdNorm, publicSummary, cliOut, magicLinkUrl });
  const subject = `Settld verification ready: ${summary.statusLabel}`;
  const webhookUrl = typeof tenantSettings?.buyerNotifications?.webhookUrl === "string" ? tenantSettings.buyerNotifications.webhookUrl.trim() : "";
  const webhookSecret = decryptStoredSecret({ settingsKey, storedSecret: tenantSettings?.buyerNotifications?.webhookSecret });
  const results = [];

  for (const recipient of recipients) {
    if (deliveryMode === "record") {
      const out = {
        schemaVersion: "MagicLinkBuyerNotificationOutbox.v1",
        createdAt: nowIso(),
        tenantId,
        token,
        recipient,
        subject,
        summary,
        text: buildEmailText({ recipient, summary })
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
          text: buildEmailText({ recipient, summary }),
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
      sentAt: nowIso(),
      tenantId,
      token,
      recipient,
      subject,
      summary,
      text: buildEmailText({ recipient, summary })
    };
    const body = JSON.stringify(payload);
    const headers = {
      "content-type": "application/json; charset=utf-8",
      "content-length": String(Buffer.byteLength(body, "utf8")),
      "x-settld-notification-event": "verification.email"
    };
    if (webhookSecret) {
      const ts = new Date().toISOString();
      const sig = crypto.createHmac("sha256", webhookSecret).update(`${ts}.${body}`, "utf8").digest("hex");
      headers["x-settld-timestamp"] = ts;
      headers["x-settld-signature"] = `v1=${sig}`;
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
