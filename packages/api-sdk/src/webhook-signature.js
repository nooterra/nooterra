import crypto from "node:crypto";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function toBodyBuffer(rawBody) {
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(rawBody)) return rawBody;
  if (typeof rawBody === "string") return Buffer.from(rawBody, "utf8");
  if (rawBody instanceof ArrayBuffer) return Buffer.from(rawBody);
  if (rawBody instanceof Uint8Array) return Buffer.from(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength);
  throw new TypeError("rawBody must be a string, Buffer, Uint8Array, or ArrayBuffer");
}

function parseTimestampToMs(timestamp) {
  const raw = String(timestamp ?? "").trim();
  if (!raw) return Number.NaN;
  if (/^\d+$/.test(raw)) {
    const asSeconds = Number(raw);
    if (!Number.isSafeInteger(asSeconds) || asSeconds <= 0) return Number.NaN;
    return asSeconds * 1000;
  }
  const asMs = Date.parse(raw);
  if (!Number.isFinite(asMs)) return Number.NaN;
  return asMs;
}

function normalizeHex(value) {
  const candidate = String(value ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(candidate)) return null;
  return candidate;
}

function timingSafeEqualHex(leftHex, rightHex) {
  const left = normalizeHex(leftHex);
  const right = normalizeHex(rightHex);
  if (!left || !right) return false;
  const leftBuf = Buffer.from(left, "hex");
  const rightBuf = Buffer.from(right, "hex");
  if (leftBuf.length !== rightBuf.length) return false;
  return crypto.timingSafeEqual(leftBuf, rightBuf);
}

function parseSignatureHeader(signatureHeader) {
  if (!isNonEmptyString(signatureHeader)) {
    throw new SettldWebhookSignatureHeaderError("x-settld-signature header is required");
  }
  const parts = signatureHeader
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    throw new SettldWebhookSignatureHeaderError("x-settld-signature header is empty");
  }

  let timestamp = null;
  const signatures = [];
  for (const part of parts) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex <= 0) {
      signatures.push(part);
      continue;
    }
    const key = part.slice(0, separatorIndex).trim().toLowerCase();
    const value = part.slice(separatorIndex + 1).trim();
    if (!value) continue;
    if (key === "t") {
      timestamp = value;
      continue;
    }
    if (key === "v1") {
      signatures.push(value);
    }
  }

  if (signatures.length === 0) {
    throw new SettldWebhookSignatureHeaderError("x-settld-signature header did not include any signatures");
  }
  return { timestamp, signatures };
}

function parseVerifyOptions(optionsOrTolerance) {
  if (optionsOrTolerance === null || optionsOrTolerance === undefined) {
    return { toleranceSeconds: 300, timestamp: null, nowMs: Date.now() };
  }
  if (typeof optionsOrTolerance === "number") {
    return { toleranceSeconds: optionsOrTolerance, timestamp: null, nowMs: Date.now() };
  }
  if (!optionsOrTolerance || typeof optionsOrTolerance !== "object" || Array.isArray(optionsOrTolerance)) {
    throw new TypeError("options must be a number or plain object");
  }
  return {
    toleranceSeconds:
      optionsOrTolerance.toleranceSeconds === undefined || optionsOrTolerance.toleranceSeconds === null
        ? 300
        : Number(optionsOrTolerance.toleranceSeconds),
    timestamp: optionsOrTolerance.timestamp ?? null,
    nowMs:
      optionsOrTolerance.nowMs === undefined || optionsOrTolerance.nowMs === null
        ? Date.now()
        : Number(optionsOrTolerance.nowMs)
  };
}

export class SettldWebhookSignatureError extends Error {
  constructor(message, { code = "SETTLD_WEBHOOK_SIGNATURE_ERROR" } = {}) {
    super(message);
    this.name = "SettldWebhookSignatureError";
    this.code = code;
  }
}

export class SettldWebhookSignatureHeaderError extends SettldWebhookSignatureError {
  constructor(message) {
    super(message, { code: "SETTLD_WEBHOOK_SIGNATURE_HEADER_INVALID" });
    this.name = "SettldWebhookSignatureHeaderError";
  }
}

export class SettldWebhookTimestampToleranceError extends SettldWebhookSignatureError {
  constructor(message, { timestamp = null, toleranceSeconds = null, nowMs = null } = {}) {
    super(message, { code: "SETTLD_WEBHOOK_TIMESTAMP_OUTSIDE_TOLERANCE" });
    this.name = "SettldWebhookTimestampToleranceError";
    this.timestamp = timestamp;
    this.toleranceSeconds = toleranceSeconds;
    this.nowMs = nowMs;
  }
}

export class SettldWebhookNoMatchingSignatureError extends SettldWebhookSignatureError {
  constructor(message) {
    super(message, { code: "SETTLD_WEBHOOK_SIGNATURE_NO_MATCH" });
    this.name = "SettldWebhookNoMatchingSignatureError";
  }
}

export function verifySettldWebhookSignature(rawBody, signatureHeader, secret, optionsOrTolerance = 300) {
  if (!isNonEmptyString(secret)) throw new TypeError("secret is required");
  const bodyBuffer = toBodyBuffer(rawBody);
  const parsed = parseSignatureHeader(signatureHeader);
  const options = parseVerifyOptions(optionsOrTolerance);

  if (!Number.isFinite(options.toleranceSeconds) || options.toleranceSeconds <= 0) {
    throw new TypeError("toleranceSeconds must be a positive number");
  }
  if (!Number.isFinite(options.nowMs)) {
    throw new TypeError("nowMs must be a finite number");
  }

  const timestamp = isNonEmptyString(parsed.timestamp)
    ? parsed.timestamp.trim()
    : isNonEmptyString(options.timestamp)
      ? String(options.timestamp).trim()
      : null;
  if (!timestamp) {
    throw new SettldWebhookSignatureHeaderError("timestamp is required (use t=... in signature header or options.timestamp)");
  }

  const timestampMs = parseTimestampToMs(timestamp);
  if (!Number.isFinite(timestampMs)) {
    throw new SettldWebhookSignatureHeaderError("timestamp is invalid");
  }
  const ageSeconds = Math.abs(options.nowMs - timestampMs) / 1000;
  if (ageSeconds > options.toleranceSeconds) {
    throw new SettldWebhookTimestampToleranceError("signature timestamp is outside tolerance", {
      timestamp,
      toleranceSeconds: options.toleranceSeconds,
      nowMs: options.nowMs
    });
  }

  const hmac = crypto.createHmac("sha256", String(secret));
  hmac.update(`${timestamp}.`, "utf8");
  hmac.update(bodyBuffer);
  const expected = hmac.digest("hex");
  for (const provided of parsed.signatures) {
    if (timingSafeEqualHex(provided, expected)) {
      return true;
    }
  }
  throw new SettldWebhookNoMatchingSignatureError("no matching signature in x-settld-signature header");
}
