import crypto from "node:crypto";

const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;
const DEFAULT_SIGNATURE_TOLERANCE_SECONDS = 300;
export const DEFAULT_WEBHOOK_ANOMALY_THRESHOLDS = Object.freeze({
  signatureFailuresPerProvider: 3,
  deadLettersPerProvider: 3,
  replayedDeliveriesPerProvider: 2,
  replayCountPerProvider: 3,
});
export const DEFAULT_WEBHOOK_ENFORCEMENT_POLICY = Object.freeze({
  cooldownMinutes: 15,
});
const EMAIL_STYLE_PROVIDERS = new Set([
  "email",
  "resend",
  "sendgrid",
  "mailgun",
  "postmark",
  "ses",
  "smtp",
]);
const SECRET_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "x-webhook-secret",
]);

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function trimPreview(value, maxLength = 4000) {
  const normalized = normalizeString(value);
  if (!normalized) return "";
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...[truncated]` : normalized;
}

function toPositiveSafeInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function readHeader(headers = {}, name) {
  const target = String(name || "").toLowerCase();
  if (!target) return "";
  if (typeof headers[target] === "string") return headers[target];
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() === target) {
      if (Array.isArray(value)) return value.join(", ");
      return typeof value === "string" ? value : String(value ?? "");
    }
  }
  return "";
}

function timingSafeEqualString(left, right) {
  const a = String(left ?? "");
  const b = String(right ?? "");
  if (!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

function parseStructuredSignatureHeader(headerValue) {
  return String(headerValue || "")
    .split(",")
    .map((part) => part.trim())
    .reduce((acc, part) => {
      const [key, value] = part.split("=");
      if (key && value) acc[key.trim()] = value.trim();
      return acc;
    }, {});
}

function parseJsonField(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
}

export class WorkerWebhookIngressError extends Error {
  constructor(statusCode, message, { code = null, details = null } = {}) {
    super(message);
    this.name = "WorkerWebhookIngressError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export async function readWorkerWebhookRequest(req, { maxBytes = MAX_WEBHOOK_BODY_BYTES } = {}) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > maxBytes) {
      throw new WorkerWebhookIngressError(413, "request body too large", {
        code: "WEBHOOK_BODY_TOO_LARGE",
      });
    }
    chunks.push(buf);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  const contentType = normalizeString(readHeader(req.headers, "content-type")).toLowerCase();
  return {
    rawBody,
    contentType,
  };
}

export function parseWorkerWebhookPayload(rawBody, contentType = "") {
  const normalizedContentType = String(contentType || "").toLowerCase();
  const body = String(rawBody || "");
  if (!body.trim()) return null;

  if (normalizedContentType.includes("application/json") || normalizedContentType.includes("+json")) {
    try {
      return JSON.parse(body);
    } catch (err) {
      throw new WorkerWebhookIngressError(400, "invalid webhook payload", {
        code: "WEBHOOK_INVALID_JSON",
        details: { message: err?.message || "invalid JSON" },
      });
    }
  }

  if (normalizedContentType.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(body);
    const payload = {};
    for (const [key, value] of params.entries()) {
      if (Object.prototype.hasOwnProperty.call(payload, key)) {
        if (Array.isArray(payload[key])) payload[key].push(value);
        else payload[key] = [payload[key], value];
      } else {
        payload[key] = value;
      }
    }
    return payload;
  }

  if (normalizedContentType.startsWith("text/")) {
    return { text: body };
  }

  return { raw: body };
}

export function normalizeWorkerWebhookConfig(triggers = {}) {
  const root = triggers && typeof triggers === "object" && !Array.isArray(triggers) ? triggers : {};
  const webhook =
    root.webhook && typeof root.webhook === "object" && !Array.isArray(root.webhook) ? root.webhook : {};

  const provider = normalizeString(webhook.provider || root.webhookProvider).toLowerCase() || "generic";
  const explicitMode = normalizeString(webhook.signatureMode || root.webhookSignatureMode).toLowerCase();
  const signatureMode = explicitMode || (provider === "twilio" ? "twilio" : "none");

  return {
    provider,
    sharedSecret: normalizeString(
      webhook.secret ?? webhook.webhookSecret ?? root.webhookSecret
    ),
    signatureMode,
    signatureSecret: normalizeString(
      webhook.signatureSecret
      ?? root.webhookSignatureSecret
      ?? webhook.authToken
      ?? webhook.twilioAuthToken
      ?? root.twilioAuthToken
      ?? (provider === "twilio" ? process.env.TWILIO_AUTH_TOKEN : "")
    ),
    signatureHeader:
      normalizeString(webhook.signatureHeader || root.webhookSignatureHeader)
      || (provider === "twilio" ? "x-twilio-signature" : "x-nooterra-signature"),
    timestampHeader:
      normalizeString(webhook.timestampHeader || root.webhookTimestampHeader)
      || "x-nooterra-timestamp",
    signatureToleranceSeconds: toPositiveSafeInteger(
      webhook.signatureToleranceSeconds ?? root.webhookSignatureToleranceSeconds,
      DEFAULT_SIGNATURE_TOLERANCE_SECONDS
    ),
    publicUrl: normalizeString(webhook.publicUrl || root.webhookPublicUrl || webhook.url || root.webhookUrl),
    dedupeKeyField: normalizeString(webhook.dedupeKeyField || root.webhookDedupeKeyField),
  };
}

function findNestedRawValue(payload, path) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const parts = String(path || "")
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  let current = payload;
  for (const part of parts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = current[part];
  }
  return current;
}

function collectPayloadCandidates(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const candidates = [];
  const pushCandidate = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    if (!candidates.includes(value)) candidates.push(value);
  };

  pushCandidate(payload);
  pushCandidate(payload.payload);
  pushCandidate(payload.data);
  pushCandidate(payload.event);
  pushCandidate(payload.event?.data);
  return candidates;
}

function firstNestedRawValue(payload, paths = []) {
  for (const candidate of collectPayloadCandidates(payload)) {
    for (const path of paths) {
      const value = findNestedRawValue(candidate, path);
      if (value != null && value !== "") return value;
    }
  }
  return null;
}

function firstNestedString(payload, paths = []) {
  const value = firstNestedRawValue(payload, paths);
  if (Array.isArray(value)) return normalizeString(value[0]);
  return normalizeString(value);
}

function splitDelimitedValues(value) {
  if (Array.isArray(value)) return value.flatMap((entry) => splitDelimitedValues(entry));
  const text = normalizeString(value);
  if (!text) return [];
  return text
    .split(/,(?![^<]*>)/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseEmailAddress(value) {
  if (!value) return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const parsed = parseEmailAddress(entry);
      if (parsed) return parsed;
    }
    return null;
  }
  if (typeof value === "object") {
    const address = normalizeString(value.email || value.address || value.value || value.raw);
    if (!address) return null;
    const name = normalizeString(value.name || value.displayName || value.display_name);
    return {
      address: address.toLowerCase(),
      name: name || null,
      raw: value.raw ? normalizeString(value.raw) : address,
    };
  }

  const raw = normalizeString(value);
  if (!raw) return null;
  const match = raw.match(/^(?:"?([^"]*)"?\s*)?<([^<>]+)>$/);
  if (match) {
    return {
      address: normalizeString(match[2]).toLowerCase(),
      name: normalizeString(match[1]) || null,
      raw,
    };
  }
  return {
    address: raw.toLowerCase(),
    name: null,
    raw,
  };
}

function normalizeEmailAddressList(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => normalizeEmailAddressList(entry));
  }
  if (typeof value === "object") {
    const parsed = parseEmailAddress(value);
    return parsed ? [parsed] : [];
  }
  return splitDelimitedValues(value)
    .map((entry) => parseEmailAddress(entry))
    .filter(Boolean);
}

function normalizePhoneAddress(value) {
  const raw = normalizeString(value);
  if (!raw) return null;
  const normalized = raw.replace(/[^\d+]/g, "");
  return {
    address: raw,
    normalized: normalized || raw,
  };
}

function normalizePhoneList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((entry) => normalizePhoneAddress(entry)).filter(Boolean);
  const parsed = normalizePhoneAddress(value);
  return parsed ? [parsed] : [];
}

function looksLikeEmailPayload(payload) {
  const subject = firstNestedString(payload, ["subject", "headers.subject", "Subject"]);
  const from = firstNestedRawValue(payload, ["from", "sender", "headers.from", "envelope.sender", "From"]);
  const to = firstNestedRawValue(payload, ["to", "recipient", "recipients", "headers.to", "envelope.to", "To"]);
  const text = firstNestedString(payload, ["text", "plain", "body-plain", "stripped-text", "TextBody"]);
  const html = firstNestedString(payload, ["html", "body-html", "stripped-html", "HtmlBody"]);
  return Boolean(subject || from || to || text || html);
}

function normalizeTwilioWebhookEvent(payload) {
  const messageSid = firstNestedString(payload, ["MessageSid", "SmsSid"]);
  const callSid = firstNestedString(payload, ["CallSid"]);
  const messageBody = firstNestedString(payload, ["Body"]);
  const from = normalizePhoneAddress(firstNestedString(payload, ["From", "Caller"]));
  const to = normalizePhoneList(firstNestedString(payload, ["To", "Called"]));

  if (messageSid || messageBody || from || to.length > 0) {
    return {
      provider: "twilio",
      channel: "sms",
      eventType: "sms_received",
      id: messageSid || null,
      from,
      to,
      subject: null,
      text: trimPreview(messageBody) || null,
      html: null,
      receivedAt: firstNestedString(payload, ["Timestamp", "MessageTimestamp"]) || null,
      metadata: {
        messageSid: messageSid || null,
        accountSid: firstNestedString(payload, ["AccountSid"]) || null,
        messageStatus: firstNestedString(payload, ["SmsStatus", "MessageStatus"]) || null,
        profileName: firstNestedString(payload, ["ProfileName"]) || null,
        numMedia: firstNestedString(payload, ["NumMedia"]) || null,
      },
    };
  }

  if (callSid || firstNestedString(payload, ["CallStatus", "Direction", "SpeechResult"])) {
    return {
      provider: "twilio",
      channel: "voice",
      eventType: "call_received",
      id: callSid || null,
      from,
      to,
      subject: null,
      text: trimPreview(firstNestedString(payload, ["SpeechResult", "TranscriptionText"])) || null,
      html: null,
      receivedAt: firstNestedString(payload, ["Timestamp"]) || null,
      metadata: {
        callSid: callSid || null,
        accountSid: firstNestedString(payload, ["AccountSid"]) || null,
        callStatus: firstNestedString(payload, ["CallStatus"]) || null,
        direction: firstNestedString(payload, ["Direction"]) || null,
        recordingUrl: firstNestedString(payload, ["RecordingUrl"]) || null,
      },
    };
  }

  return null;
}

function normalizeEmailWebhookEvent(payload, provider) {
  const from = parseEmailAddress(
    firstNestedRawValue(payload, ["from", "sender", "headers.from", "envelope.sender", "From"])
  );
  const to = normalizeEmailAddressList(
    firstNestedRawValue(payload, ["to", "recipient", "recipients", "headers.to", "envelope.to", "To"])
  );
  const cc = normalizeEmailAddressList(
    firstNestedRawValue(payload, ["cc", "headers.cc", "Cc"])
  );
  const bcc = normalizeEmailAddressList(
    firstNestedRawValue(payload, ["bcc", "headers.bcc", "Bcc"])
  );
  const subject = firstNestedString(payload, ["subject", "headers.subject", "Subject"]);
  const text = trimPreview(firstNestedString(payload, [
    "text",
    "plain",
    "body-plain",
    "stripped-text",
    "TextBody",
    "textBody",
  ]));
  const html = trimPreview(firstNestedString(payload, [
    "html",
    "body-html",
    "stripped-html",
    "HtmlBody",
    "htmlBody",
  ]));
  const messageId = firstNestedString(payload, [
    "messageId",
    "message_id",
    "message-id",
    "Message-Id",
    "headers.message-id",
    "emailId",
    "email_id",
    "id",
  ]);
  const eventType = firstNestedString(payload, ["type", "eventType", "event", "event.type"]) || "email_received";

  if (!from && to.length === 0 && !subject && !text && !html && !messageId) return null;

  return {
    provider,
    channel: "email",
    eventType,
    id: messageId || null,
    from,
    to,
    cc,
    bcc,
    subject: subject || null,
    text: text || null,
    html: html || null,
    receivedAt: firstNestedString(payload, ["receivedAt", "received_at", "createdAt", "created_at", "timestamp"]) || null,
    metadata: {
      messageId: messageId || null,
      replyTo: normalizeEmailAddressList(firstNestedRawValue(payload, ["reply_to", "replyTo", "headers.reply-to"])),
    },
  };
}

function normalizeGenericWebhookEvent(payload, provider, headers = {}, contentType = "") {
  const bodyText =
    trimPreview(firstNestedString(payload, ["text", "body", "message", "detail", "details"]))
    || (typeof payload === "string" ? trimPreview(payload) : "");
  return {
    provider,
    channel: "generic",
    eventType:
      firstNestedString(payload, ["type", "eventType", "event.type", "event"])
      || (provider && provider !== "generic" ? `${provider}_webhook_received` : "webhook_received"),
    id:
      firstNestedString(payload, ["event.id", "id", "eventId", "event_id", "messageId", "message_id"])
      || normalizeString(readHeader(headers, "x-webhook-id"))
      || normalizeString(readHeader(headers, "x-event-id"))
      || null,
    from: null,
    to: [],
    subject: firstNestedString(payload, ["subject"]) || null,
    text: bodyText || null,
    html: null,
    receivedAt:
      firstNestedString(payload, ["receivedAt", "received_at", "createdAt", "created_at", "timestamp"])
      || null,
    metadata: {
      contentType: normalizeString(contentType) || null,
    },
  };
}

export function normalizeWorkerWebhookEvent({ payload, headers = {}, contentType = "", config = {} } = {}) {
  const effectiveConfig = normalizeWorkerWebhookConfig(config);
  const provider = effectiveConfig.provider || "generic";
  const parsedPayload = parseJsonField(payload, payload);

  if (provider === "twilio") {
    const normalizedTwilio = normalizeTwilioWebhookEvent(parsedPayload);
    if (normalizedTwilio) return normalizedTwilio;
  }

  if (EMAIL_STYLE_PROVIDERS.has(provider) || looksLikeEmailPayload(parsedPayload)) {
    const normalizedEmail = normalizeEmailWebhookEvent(parsedPayload, provider);
    if (normalizedEmail) return normalizedEmail;
  }

  return normalizeGenericWebhookEvent(parsedPayload, provider, headers, contentType);
}

function isSignatureFailureIngress(ingress = {}) {
  const reason = normalizeString(ingress?.dead_letter_reason || ingress?.deadLetterReason).toLowerCase();
  const signatureStatus = normalizeString(ingress?.signature_status || ingress?.signatureStatus).toLowerCase();
  const signatureError = normalizeString(ingress?.signature_error || ingress?.signatureError).toLowerCase();
  return reason === "signature_invalid" || signatureStatus === "rejected" || signatureError.includes("signature");
}

export function summarizeWebhookAnomalies(webhookIngress = [], thresholds = {}) {
  const effectiveThresholds = {
    ...DEFAULT_WEBHOOK_ANOMALY_THRESHOLDS,
    ...(thresholds && typeof thresholds === "object" ? thresholds : {}),
  };
  const byProvider = new Map();

  for (const ingress of webhookIngress) {
    const provider = normalizeString(ingress?.provider || ingress?.providerName).toLowerCase() || "generic";
    if (!byProvider.has(provider)) {
      byProvider.set(provider, {
        provider,
        deadLetters: 0,
        signatureFailures: 0,
        replayedDeliveries: 0,
        replayCount: 0,
        latestAt: null,
      });
    }
    const summary = byProvider.get(provider);
    const status = normalizeString(ingress?.status).toLowerCase();
    const replayCount = Number(ingress?.replay_count ?? ingress?.replayCount ?? 0);
    const updatedAt = ingress?.updated_at || ingress?.updatedAt || ingress?.last_replayed_at || ingress?.lastReplayedAt || ingress?.created_at || ingress?.createdAt || null;

    if (status === "dead_letter") {
      summary.deadLetters += 1;
      if (isSignatureFailureIngress(ingress)) summary.signatureFailures += 1;
    }
    if (replayCount > 0) {
      summary.replayedDeliveries += 1;
      summary.replayCount += replayCount;
    }
    if (updatedAt && (!summary.latestAt || Date.parse(updatedAt) > Date.parse(summary.latestAt))) {
      summary.latestAt = updatedAt;
    }
  }

  const anomalies = [];
  for (const summary of byProvider.values()) {
    if (summary.signatureFailures >= effectiveThresholds.signatureFailuresPerProvider) {
      anomalies.push({
        kind: "repeated_signature_failures",
        severity: "high",
        provider: summary.provider,
        count: summary.signatureFailures,
        threshold: effectiveThresholds.signatureFailuresPerProvider,
        latestAt: summary.latestAt,
        reason: `${summary.provider} signature failures reached ${summary.signatureFailures}`,
      });
    }
    if (summary.deadLetters >= effectiveThresholds.deadLettersPerProvider) {
      anomalies.push({
        kind: "dead_letter_burst",
        severity: "high",
        provider: summary.provider,
        count: summary.deadLetters,
        threshold: effectiveThresholds.deadLettersPerProvider,
        latestAt: summary.latestAt,
        reason: `${summary.provider} dead letters reached ${summary.deadLetters}`,
      });
    }
    if (
      summary.replayedDeliveries >= effectiveThresholds.replayedDeliveriesPerProvider
      || summary.replayCount >= effectiveThresholds.replayCountPerProvider
    ) {
      anomalies.push({
        kind: "replay_spike",
        severity: "medium",
        provider: summary.provider,
        count: summary.replayCount,
        replayedDeliveries: summary.replayedDeliveries,
        threshold: Math.max(
          effectiveThresholds.replayedDeliveriesPerProvider,
          effectiveThresholds.replayCountPerProvider
        ),
        latestAt: summary.latestAt,
        reason: `${summary.provider} replay volume reached ${summary.replayCount} across ${summary.replayedDeliveries} deliveries`,
      });
    }
  }

  const severityRank = { high: 2, medium: 1, low: 0 };
  anomalies.sort((left, right) =>
    (severityRank[right.severity] || 0) - (severityRank[left.severity] || 0)
    || Date.parse(right.latestAt || "") - Date.parse(left.latestAt || "")
    || right.count - left.count
    || left.provider.localeCompare(right.provider)
  );
  return anomalies;
}

export function resolveWebhookEnforcementDecision(webhookIngress = [], { now = Date.now(), policy = {}, thresholds = {} } = {}) {
  const policyObject = policy && typeof policy === 'object' ? policy : {};
  const effectiveThresholds = policyObject.thresholds && typeof policyObject.thresholds === 'object'
    ? policyObject.thresholds
    : thresholds;
  const effectivePolicy = {
    ...DEFAULT_WEBHOOK_ENFORCEMENT_POLICY,
    ...(policyObject.enforcement && typeof policyObject.enforcement === 'object' ? policyObject.enforcement : policyObject),
  };
  const anomalies = summarizeWebhookAnomalies(webhookIngress, effectiveThresholds);
  const signatureFailures = anomalies.filter((anomaly) => anomaly.kind === 'repeated_signature_failures');
  const deadLetterBursts = anomalies.filter((anomaly) => anomaly.kind === 'dead_letter_burst');
  const replaySpikes = anomalies.filter((anomaly) => anomaly.kind === 'replay_spike');

  if (signatureFailures.length > 0 || deadLetterBursts.length > 0) {
    const matchedAnomalies = [...signatureFailures, ...deadLetterBursts];
    return {
      action: 'auto_pause',
      code: signatureFailures.length > 0 ? 'webhook_signature_failure_burst' : 'webhook_dead_letter_burst',
      statusCode: 423,
      reason: matchedAnomalies.map((anomaly) => anomaly.reason).join('; '),
      anomalies: matchedAnomalies,
      forceApprovalReentry: false,
      cooldownUntil: null,
    };
  }

  if (replaySpikes.length > 0) {
    const replaySpike = replaySpikes[0];
    const latestAtMs = Date.parse(replaySpike.latestAt || '');
    const cooldownUntil = Number.isFinite(latestAtMs)
      ? new Date(latestAtMs + effectivePolicy.cooldownMinutes * 60 * 1000).toISOString()
      : null;
    if (cooldownUntil && now < Date.parse(cooldownUntil)) {
      return {
        action: 'cooldown',
        code: 'webhook_provider_cooldown',
        statusCode: 429,
        reason: `${replaySpike.reason}; cooldown active until ${cooldownUntil}`,
        anomalies: [replaySpike],
        forceApprovalReentry: true,
        cooldownUntil,
      };
    }
    return {
      action: 'force_approval',
      code: 'webhook_force_approval_reentry',
      statusCode: 200,
      reason: replaySpike.reason,
      anomalies: [replaySpike],
      forceApprovalReentry: true,
      cooldownUntil: cooldownUntil || null,
    };
  }

  return {
    action: 'allow',
    code: null,
    statusCode: 200,
    reason: null,
    anomalies: [],
    forceApprovalReentry: false,
    cooldownUntil: null,
  };
}

function resolveWorkerWebhookUrl({ config, req }) {
  const configured = normalizeString(config?.publicUrl);
  if (configured) return configured;

  const proto = normalizeString(readHeader(req?.headers, "x-forwarded-proto")) || "https";
  const host =
    normalizeString(readHeader(req?.headers, "x-forwarded-host"))
    || normalizeString(readHeader(req?.headers, "host"));
  const url = normalizeString(readHeader(req?.headers, "x-original-uri")) || normalizeString(req?.url);

  return host ? `${proto}://${host}${url}` : url;
}

function verifyTimestampedHmacSignature({ rawBody, headers, config }) {
  const signatureHeader = readHeader(headers, config.signatureHeader);
  const structured = parseStructuredSignatureHeader(signatureHeader);
  const headerTimestamp = normalizeString(readHeader(headers, config.timestampHeader));
  const timestamp = structured.t || headerTimestamp;
  const signature = structured.v1 || signatureHeader;

  if (!timestamp || !signature) {
    throw new WorkerWebhookIngressError(403, "invalid webhook signature", {
      code: "WEBHOOK_SIGNATURE_MISSING",
    });
  }

  const unixTimestamp = Number.parseInt(timestamp, 10);
  if (!Number.isSafeInteger(unixTimestamp) || unixTimestamp <= 0) {
    throw new WorkerWebhookIngressError(403, "invalid webhook signature", {
      code: "WEBHOOK_SIGNATURE_TIMESTAMP_INVALID",
    });
  }

  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - unixTimestamp);
  if (ageSeconds > config.signatureToleranceSeconds) {
    throw new WorkerWebhookIngressError(403, "invalid webhook signature", {
      code: "WEBHOOK_SIGNATURE_STALE",
      details: { ageSeconds, toleranceSeconds: config.signatureToleranceSeconds },
    });
  }

  if (!config.signatureSecret) {
    throw new WorkerWebhookIngressError(503, "worker webhook signature configuration is invalid", {
      code: "WEBHOOK_SIGNATURE_CONFIGURATION_INVALID",
    });
  }

  const expected = crypto
    .createHmac("sha256", config.signatureSecret)
    .update(`${unixTimestamp}.${rawBody}`)
    .digest("hex");

  if (!timingSafeEqualString(signature.toLowerCase(), expected.toLowerCase())) {
    throw new WorkerWebhookIngressError(403, "invalid webhook signature", {
      code: "WEBHOOK_SIGNATURE_INVALID",
    });
  }

  return {
    scheme: "hmac-sha256",
    status: "verified",
  };
}

function verifyTwilioSignature({ rawBody, payload, headers, config, req }) {
  const provided = normalizeString(readHeader(headers, config.signatureHeader || "x-twilio-signature"));
  if (!provided) {
    throw new WorkerWebhookIngressError(403, "invalid webhook signature", {
      code: "WEBHOOK_SIGNATURE_MISSING",
    });
  }
  if (!config.signatureSecret) {
    throw new WorkerWebhookIngressError(503, "worker webhook signature configuration is invalid", {
      code: "WEBHOOK_SIGNATURE_CONFIGURATION_INVALID",
    });
  }

  const url = resolveWorkerWebhookUrl({ config, req });
  if (!url) {
    throw new WorkerWebhookIngressError(503, "worker webhook signature configuration is invalid", {
      code: "WEBHOOK_SIGNATURE_URL_MISSING",
    });
  }

  const params =
    payload && typeof payload === "object" && !Array.isArray(payload) ? payload : parseWorkerWebhookPayload(rawBody, "application/x-www-form-urlencoded");

  const pairs = [];
  for (const [key, value] of Object.entries(params || {})) {
    if (Array.isArray(value)) {
      for (const entry of value) pairs.push([key, entry]);
    } else {
      pairs.push([key, value]);
    }
  }
  pairs.sort((left, right) => {
    const byKey = String(left[0]).localeCompare(String(right[0]));
    if (byKey !== 0) return byKey;
    return String(left[1]).localeCompare(String(right[1]));
  });

  const signaturePayload = `${url}${pairs.map(([key, value]) => `${key}${value ?? ""}`).join("")}`;
  const expected = crypto
    .createHmac("sha1", config.signatureSecret)
    .update(signaturePayload)
    .digest("base64");

  if (!timingSafeEqualString(provided, expected)) {
    throw new WorkerWebhookIngressError(403, "invalid webhook signature", {
      code: "WEBHOOK_SIGNATURE_INVALID",
    });
  }

  return {
    scheme: "twilio",
    status: "verified",
  };
}

export function verifyWorkerWebhookRequest({ rawBody, payload, headers = {}, config, req, isTest = false }) {
  const effectiveConfig = normalizeWorkerWebhookConfig(config);
  const sharedSecret = effectiveConfig.sharedSecret;

  if (!isTest && sharedSecret) {
    const providedSecret = normalizeString(readHeader(headers, "x-webhook-secret"));
    if (!timingSafeEqualString(providedSecret, sharedSecret)) {
      throw new WorkerWebhookIngressError(403, "invalid or missing webhook secret", {
        code: "WEBHOOK_SECRET_INVALID",
      });
    }
  }

  if (isTest || effectiveConfig.signatureMode === "none") {
    return {
      provider: effectiveConfig.provider,
      scheme: sharedSecret && !isTest ? "shared_secret" : "none",
      status: sharedSecret && !isTest ? "verified" : "not_required",
    };
  }

  const verification =
    effectiveConfig.signatureMode === "twilio"
      ? verifyTwilioSignature({ rawBody, payload, headers, config: effectiveConfig, req })
      : verifyTimestampedHmacSignature({ rawBody, headers, config: effectiveConfig });

  return {
    provider: effectiveConfig.provider,
    ...verification,
  };
}

function findNestedValue(payload, path) {
  const current = findNestedRawValue(payload, path);
  if (current == null) return "";
  if (Array.isArray(current)) return normalizeString(current[0]);
  return normalizeString(current);
}

export function computeWorkerWebhookDedupeKey({ rawBody, payload, headers = {}, config = {} }) {
  const effectiveConfig = normalizeWorkerWebhookConfig(config);

  const explicitField = normalizeString(effectiveConfig.dedupeKeyField);
  const payloadCandidates = explicitField
    ? [explicitField]
    : effectiveConfig.provider === "twilio"
      ? ["MessageSid", "SmsSid", "CallSid"]
      : ["id", "event.id", "eventId", "event_id", "messageId", "message_id", "emailId", "email_id", "notificationId", "notification_id"];

  const headerCandidates = [
    "x-webhook-id",
    "x-event-id",
    "x-message-id",
    "x-idempotency-key",
    "idempotency-key",
  ];

  for (const headerName of headerCandidates) {
    const value = normalizeString(readHeader(headers, headerName));
    if (value) return `${effectiveConfig.provider}:header:${value}`;
  }

  for (const candidate of payloadCandidates) {
    const value = findNestedValue(payload, candidate);
    if (value) return `${effectiveConfig.provider}:payload:${value}`;
  }

  return `${effectiveConfig.provider}:body:${sha256Hex(rawBody)}`;
}

export function sanitizeWorkerWebhookHeaders(headers = {}) {
  const sanitized = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const normalizedKey = String(key).toLowerCase();
    if (SECRET_HEADER_NAMES.has(normalizedKey)) {
      sanitized[normalizedKey] = "[redacted]";
      continue;
    }
    if (/^x-webhook-secret$/i.test(normalizedKey)) {
      sanitized[normalizedKey] = "[redacted]";
      continue;
    }
    sanitized[normalizedKey] = Array.isArray(value) ? value.map(String) : String(value ?? "");
  }
  return sanitized;
}

export function buildWorkerWebhookDeadLetterCode(message = "") {
  const normalized = String(message || "").trim().toLowerCase();
  if (normalized.includes("signature")) return "signature_invalid";
  if (normalized.includes("secret")) return "secret_invalid";
  if (normalized.includes("payload")) return "payload_invalid";
  if (normalized.includes("paused") || normalized.includes("cannot trigger")) return "worker_unavailable";
  return normalized.replace(/[^a-z0-9_]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "") || "ingress_rejected";
}
