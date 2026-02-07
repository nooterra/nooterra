import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import https from "node:https";

import { decryptWebhookSecret } from "./tenant-settings.js";

function isPlainObject(v) {
  return Boolean(v && typeof v === "object" && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null));
}

function hmacSha256Hex(secret, message) {
  return crypto.createHmac("sha256", String(secret ?? "")).update(String(message ?? ""), "utf8").digest("hex");
}

function isHttpSuccessStatus(statusCode) {
  const code = Number(statusCode);
  return Number.isFinite(code) && code >= 200 && code < 300;
}

async function waitMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, n));
}

function buildSignatureHeader({ secret, timestamp, body }) {
  // Simple, stable scheme: v1 = HMAC_SHA256(secret, `${timestamp}.${body}`)
  const ts = String(timestamp ?? "");
  const msg = `${ts}.${String(body ?? "")}`;
  const sig = hmacSha256Hex(secret, msg);
  return { timestamp: ts, signature: `v1=${sig}` };
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
      try { req.destroy(new Error("timeout")); } catch { /* ignore */ }
    });
    req.on("error", (err) => resolve({ ok: false, error: err?.message ?? String(err ?? "error") }));
    req.end(body);
  });
}

export function buildWebhookPayload({ event, tenantId, token, zipSha256, zipBytes, modeResolved, modeRequested, cliOut, publicBaseUrl, decisionReport = null, publicSummary = null, closePackZipUrl = null }) {
  const base = publicBaseUrl ? String(publicBaseUrl).replace(/\/+$/, "") : "";
  const rel = `/r/${token}`;
  const url = base ? `${base}${rel}` : rel;

  const errorCodes = Array.isArray(cliOut?.errors) ? cliOut.errors.map((e) => String(e?.code ?? "")).filter(Boolean) : [];
  const warningCodes = Array.isArray(cliOut?.warnings) ? cliOut.warnings.map((w) => String(w?.code ?? "")).filter(Boolean) : [];

  const payload = {
    schemaVersion: "MagicLinkWebhookPayload.v1",
    event: String(event ?? ""),
    sentAt: new Date().toISOString(),
    tenantId,
    token,
    magicLinkUrl: url,
    zipSha256,
    zipBytes,
    modeRequested,
    modeResolved,
    verification: {
      ok: Boolean(cliOut?.ok),
      verificationOk: Boolean(cliOut?.verificationOk),
      errorCodes,
      warningCodes
    },
    artifacts: {
      verifyJsonUrl: base ? `${base}${rel}/verify.json` : `${rel}/verify.json`,
      bundleZipUrl: base ? `${base}${rel}/bundle.zip` : `${rel}/bundle.zip`,
      receiptJsonUrl: base ? `${base}${rel}/receipt.json` : `${rel}/receipt.json`,
      auditPacketUrl: base ? `${base}${rel}/audit-packet.zip` : `${rel}/audit-packet.zip`
    }
  };
  if (closePackZipUrl) payload.artifacts.closePackZipUrl = base && String(closePackZipUrl).startsWith("/") ? `${base}${closePackZipUrl}` : closePackZipUrl;
  if (decisionReport && typeof decisionReport === "object" && !Array.isArray(decisionReport)) {
    payload.decision = {
      decision: typeof decisionReport.decision === "string" ? decisionReport.decision : null,
      decidedAt: typeof decisionReport.decidedAt === "string" ? decisionReport.decidedAt : null,
      signerKeyId: typeof decisionReport.signerKeyId === "string" ? decisionReport.signerKeyId : null,
      actorEmail: typeof decisionReport?.actor?.email === "string" ? decisionReport.actor.email : null
    };
    payload.artifacts.decisionReportUrl = base ? `${base}${rel}/settlement_decision_report.json` : `${rel}/settlement_decision_report.json`;
  }
  if (publicSummary && typeof publicSummary === "object" && !Array.isArray(publicSummary)) {
    payload.invoice = publicSummary.invoiceClaim && typeof publicSummary.invoiceClaim === "object" && !Array.isArray(publicSummary.invoiceClaim)
      ? {
          invoiceId: typeof publicSummary.invoiceClaim.invoiceId === "string" ? publicSummary.invoiceClaim.invoiceId : null,
          currency: typeof publicSummary.invoiceClaim.currency === "string" ? publicSummary.invoiceClaim.currency : null,
          totalCents: typeof publicSummary.invoiceClaim.totalCents === "string" ? publicSummary.invoiceClaim.totalCents : null
        }
      : null;
    if (publicSummary.closePackSummaryV1 && typeof publicSummary.closePackSummaryV1 === "object" && !Array.isArray(publicSummary.closePackSummaryV1)) {
      payload.closePack = publicSummary.closePackSummaryV1;
    }
  }
  return payload;
}

export async function deliverTenantWebhooks({
  dataDir,
  tenantId,
  token,
  event,
  payload,
  webhooks,
  settingsKey,
  deliveryMode = "http",
  timeoutMs = 5_000,
  maxAttempts = 1,
  retryBackoffMs = 0
}) {
  const list = Array.isArray(webhooks) ? webhooks : [];
  const body = JSON.stringify(payload ?? {});
  const maxAttemptsSafe = Number.isInteger(maxAttempts) && maxAttempts > 0 ? maxAttempts : 1;
  const retryBackoffSafe = Number.isInteger(retryBackoffMs) && retryBackoffMs >= 0 ? retryBackoffMs : 0;

  const results = [];
  for (let i = 0; i < list.length; i += 1) {
    const w = list[i];
    if (!isPlainObject(w)) continue;
    if (!w.enabled) continue;
    const events = Array.isArray(w.events) ? w.events.map(String) : [];
    if (!events.includes(event)) continue;
    const url = typeof w.url === "string" ? w.url.trim() : "";
    if (!url) continue;

    const secret = decryptWebhookSecret({ settingsKey, storedSecret: w.secret });
    if (!secret) {
      results.push({ ok: false, url, error: "WEBHOOK_SECRET_MISSING" });
      continue;
    }

    const ts = new Date().toISOString();
    const sig = buildSignatureHeader({ secret, timestamp: ts, body });
    const headers = {
      "content-type": "application/json; charset=utf-8",
      "content-length": String(Buffer.byteLength(body, "utf8")),
      "user-agent": "settld-magic-link/0",
      "x-settld-event": String(event),
      "x-settld-timestamp": sig.timestamp,
      "x-settld-signature": sig.signature
    };

    const attempt = {
      schemaVersion: "MagicLinkWebhookAttempt.v1",
      tenantId,
      token,
      event,
      url,
      headers,
      bodySha256: crypto.createHash("sha256").update(body, "utf8").digest("hex"),
      sentAt: ts,
      deliveryMode
    };

    const outDir = path.join(dataDir, "webhooks", deliveryMode === "record" ? "record" : "attempts");
    await fs.mkdir(outDir, { recursive: true });
    if (deliveryMode === "record") {
      const id = `${token}_${Date.now()}_${i}`;
      const fp = path.join(outDir, `${id}.json`);
      await fs.writeFile(fp, JSON.stringify({ ...attempt, body, attempt: 1, maxAttempts: 1 }, null, 2) + "\n", "utf8");
      results.push({ ok: true, url, recorded: true, attempts: 1 });
      continue;
    }

    let finalResult = { ok: false, error: "request failed", statusCode: null };
    let attemptsUsed = 0;
    for (let attemptIndex = 1; attemptIndex <= maxAttemptsSafe; attemptIndex += 1) {
      const id = `${token}_${Date.now()}_${i}_${attemptIndex}`;
      const fp = path.join(outDir, `${id}.json`);

      const res = await request({ url, method: "POST", headers, body, timeoutMs });
      const delivered = Boolean(res.ok) && isHttpSuccessStatus(res.statusCode);
      finalResult = delivered
        ? { ok: true, statusCode: res.statusCode ?? 200, error: null }
        : {
            ok: false,
            statusCode: Number.isFinite(Number(res.statusCode)) ? Number(res.statusCode) : null,
            error: res.ok ? `HTTP_${res.statusCode ?? "UNKNOWN"}` : res.error ?? "request failed"
          };
      attemptsUsed = attemptIndex;
      await fs.writeFile(fp, JSON.stringify({ ...attempt, attempt: attemptIndex, maxAttempts: maxAttemptsSafe, result: finalResult }, null, 2) + "\n", "utf8");

      if (finalResult.ok) break;
      if (attemptIndex < maxAttemptsSafe) {
        const waitFor = retryBackoffSafe * (2 ** (attemptIndex - 1));
        // Exponential backoff for transient webhook failures.
        await waitMs(waitFor);
      }
    }
    results.push({ url, ...finalResult, attempts: attemptsUsed });
  }
  return results;
}
