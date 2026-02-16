import http from "node:http";
import crypto from "node:crypto";
import { URL } from "node:url";

import { canonicalJsonStringify } from "../../../src/core/canonical-json.js";
import { computeSettldPayTokenSha256, verifySettldPayTokenV1 } from "../../../src/core/settld-pay-token.js";
import { keyIdFromPublicKeyPem, sha256Hex } from "../../../src/core/crypto.js";
import { signToolProviderSignatureV1 } from "../../../src/core/tool-provider-signature.js";

function readBoolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const value = String(raw).trim().toLowerCase();
  if (value === "1" || value === "true" || value === "yes" || value === "on") return true;
  if (value === "0" || value === "false" || value === "no" || value === "off") return false;
  throw new Error(`${name} must be a boolean (1/0/true/false)`);
}

function readIntEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isSafeInteger(n)) throw new Error(`${name} must be an integer`);
  return n;
}

function sanitizeIdSegment(text, { maxLen = 96 } = {}) {
  const raw = String(text ?? "").trim();
  const safe = raw.replaceAll(/[^A-Za-z0-9:_-]/g, "_").slice(0, maxLen);
  return safe || "unknown";
}

function parseCacheControlMaxAgeMs(value, fallbackMs) {
  const raw = typeof value === "string" ? value : "";
  const m = raw.match(/max-age\s*=\s*(\d+)/i);
  if (!m) return fallbackMs;
  const sec = Number(m[1]);
  if (!Number.isSafeInteger(sec) || sec < 0) return fallbackMs;
  return sec * 1000;
}

const PORT = Number(process.env.PORT ?? 9402);
if (!Number.isSafeInteger(PORT) || PORT <= 0) throw new Error("PORT must be a positive integer");
const BIND_HOST =
  typeof process.env.BIND_HOST === "string" && process.env.BIND_HOST.trim() !== "" ? process.env.BIND_HOST.trim() : null;

const PRICE_AMOUNT_CENTS = readIntEnv("SETTLD_PRICE_AMOUNT_CENTS", 500);
if (!Number.isSafeInteger(PRICE_AMOUNT_CENTS) || PRICE_AMOUNT_CENTS <= 0) {
  throw new Error("SETTLD_PRICE_AMOUNT_CENTS must be a positive integer");
}
const PRICE_CURRENCY =
  typeof process.env.SETTLD_PRICE_CURRENCY === "string" && process.env.SETTLD_PRICE_CURRENCY.trim() !== ""
    ? process.env.SETTLD_PRICE_CURRENCY.trim().toUpperCase()
    : "USD";
const PROVIDER_ID_CONFIG =
  typeof process.env.SETTLD_PROVIDER_ID === "string" && process.env.SETTLD_PROVIDER_ID.trim() !== ""
    ? process.env.SETTLD_PROVIDER_ID.trim()
    : null;
const PAYMENT_ADDRESS =
  typeof process.env.SETTLD_PAYMENT_ADDRESS === "string" && process.env.SETTLD_PAYMENT_ADDRESS.trim() !== ""
    ? process.env.SETTLD_PAYMENT_ADDRESS.trim()
    : "mock:payee";
const PAYMENT_NETWORK =
  typeof process.env.SETTLD_PAYMENT_NETWORK === "string" && process.env.SETTLD_PAYMENT_NETWORK.trim() !== ""
    ? process.env.SETTLD_PAYMENT_NETWORK.trim()
    : "mocknet";

const SETTLD_PAY_KEYSET_URL =
  typeof process.env.SETTLD_PAY_KEYSET_URL === "string" && process.env.SETTLD_PAY_KEYSET_URL.trim() !== ""
    ? process.env.SETTLD_PAY_KEYSET_URL.trim()
    : "http://127.0.0.1:3000/.well-known/settld-keys.json";
const SETTLD_PAY_KEYSET_DEFAULT_MAX_AGE_MS = readIntEnv("SETTLD_PAY_KEYSET_DEFAULT_MAX_AGE_MS", 300_000);
if (!Number.isSafeInteger(SETTLD_PAY_KEYSET_DEFAULT_MAX_AGE_MS) || SETTLD_PAY_KEYSET_DEFAULT_MAX_AGE_MS <= 0) {
  throw new Error("SETTLD_PAY_KEYSET_DEFAULT_MAX_AGE_MS must be a positive integer");
}
const SETTLD_PAY_KEYSET_FETCH_TIMEOUT_MS = readIntEnv("SETTLD_PAY_KEYSET_FETCH_TIMEOUT_MS", 3000);
if (!Number.isSafeInteger(SETTLD_PAY_KEYSET_FETCH_TIMEOUT_MS) || SETTLD_PAY_KEYSET_FETCH_TIMEOUT_MS <= 0) {
  throw new Error("SETTLD_PAY_KEYSET_FETCH_TIMEOUT_MS must be a positive integer");
}
const SETTLD_PAY_REPLAY_TTL_BUFFER_MS = readIntEnv("SETTLD_PAY_REPLAY_TTL_BUFFER_MS", 60_000);
if (!Number.isSafeInteger(SETTLD_PAY_REPLAY_TTL_BUFFER_MS) || SETTLD_PAY_REPLAY_TTL_BUFFER_MS < 0) {
  throw new Error("SETTLD_PAY_REPLAY_TTL_BUFFER_MS must be a non-negative integer");
}
const SETTLD_PAY_REPLAY_MAX_KEYS = readIntEnv("SETTLD_PAY_REPLAY_MAX_KEYS", 10_000);
if (!Number.isSafeInteger(SETTLD_PAY_REPLAY_MAX_KEYS) || SETTLD_PAY_REPLAY_MAX_KEYS <= 0) {
  throw new Error("SETTLD_PAY_REPLAY_MAX_KEYS must be a positive integer");
}
const SETTLD_PAY_PINNED_KID =
  typeof process.env.SETTLD_PAY_PINNED_KID === "string" && process.env.SETTLD_PAY_PINNED_KID.trim() !== ""
    ? process.env.SETTLD_PAY_PINNED_KID.trim()
    : null;
const SETTLD_PAY_PINNED_PUBLIC_KEY_PEM =
  typeof process.env.SETTLD_PAY_PINNED_PUBLIC_KEY_PEM === "string" && process.env.SETTLD_PAY_PINNED_PUBLIC_KEY_PEM.trim() !== ""
    ? process.env.SETTLD_PAY_PINNED_PUBLIC_KEY_PEM.trim()
    : null;
const SETTLD_PAY_PINNED_ONLY = readBoolEnv("SETTLD_PAY_PINNED_ONLY", false);
const SETTLD_PAY_PINNED_MAX_AGE_MS = readIntEnv("SETTLD_PAY_PINNED_MAX_AGE_MS", 3_600_000);
if (!Number.isSafeInteger(SETTLD_PAY_PINNED_MAX_AGE_MS) || SETTLD_PAY_PINNED_MAX_AGE_MS <= 0) {
  throw new Error("SETTLD_PAY_PINNED_MAX_AGE_MS must be a positive integer");
}

// Dev-only demo key. Do not reuse this key for any real workloads.
const PROVIDER_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA7zJ+oQLAO6F4Xewe7yJB1mv5TxsLo5bGZI7ZJPuFB6s=
-----END PUBLIC KEY-----\n`;
const PROVIDER_PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIJzGRPeTwBQESqFfShXcFhPhq7tUm1V9X92FU7ucZ+H4
-----END PRIVATE KEY-----\n`;
const PROVIDER_KEY_ID = keyIdFromPublicKeyPem(PROVIDER_PUBLIC_KEY_PEM);

const PINNED_KEYSET = (() => {
  if (!SETTLD_PAY_PINNED_PUBLIC_KEY_PEM) return null;
  const derivedKid = keyIdFromPublicKeyPem(SETTLD_PAY_PINNED_PUBLIC_KEY_PEM);
  const kid = SETTLD_PAY_PINNED_KID ?? derivedKid;
  if (kid !== derivedKid) throw new Error("SETTLD_PAY_PINNED_KID does not match SETTLD_PAY_PINNED_PUBLIC_KEY_PEM");
  return {
    keys: [{ kid, publicKeyPem: SETTLD_PAY_PINNED_PUBLIC_KEY_PEM }],
    refreshedAt: new Date().toISOString()
  };
})();

const keysetCache = {
  value: null,
  expiresAtMs: 0,
  source: "none"
};

const replayCache = new Map(); // authorizationRef|gateId -> { expiresAtMs, statusCode, body, headers }

function providerIdForRequest(req) {
  if (PROVIDER_ID_CONFIG) return PROVIDER_ID_CONFIG;
  const host = typeof req.headers.host === "string" && req.headers.host.trim() !== "" ? req.headers.host.trim() : `127.0.0.1:${PORT}`;
  return `agt_x402_payee_${sanitizeIdSegment(host)}`;
}

function sanitizeQuery(raw) {
  const text = String(raw ?? "").trim();
  return text || "empty-query";
}

function clampNumResults(raw) {
  const n = Number(raw ?? 5);
  if (!Number.isSafeInteger(n)) return 5;
  return Math.max(1, Math.min(10, n));
}

function toolIdForRequest(req, url) {
  if (req.method === "GET" && url.pathname === "/exa/search") return "exa.search";
  return `${String(req.method ?? "GET").toUpperCase()}:${String(url.pathname ?? "/")}`;
}

function pricingForRequest(req, url) {
  return {
    amountCents: PRICE_AMOUNT_CENTS,
    currency: PRICE_CURRENCY,
    providerId: providerIdForRequest(req),
    toolId: toolIdForRequest(req, url)
  };
}

function buildPaymentRequiredValue(offer) {
  return [
    `amountCents=${offer.amountCents}`,
    `currency=${offer.currency}`,
    `providerId=${offer.providerId}`,
    `toolId=${offer.toolId}`,
    `address=${PAYMENT_ADDRESS}`,
    `network=${PAYMENT_NETWORK}`
  ].join("; ");
}

function sendPaymentRequired(res, { offer, code = "PAYMENT_REQUIRED", message = "payment required", details = null } = {}) {
  const headerValue = buildPaymentRequiredValue(offer);
  res.statusCode = 402;
  res.setHeader("x-payment-required", headerValue);
  res.setHeader("PAYMENT-REQUIRED", headerValue);
  res.setHeader("x-settld-payment-error", String(code));
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(
    JSON.stringify({
      ok: false,
      error: "payment_required",
      code,
      message,
      offer,
      ...(details ? { details } : {})
    })
  );
}

function buildExaLikeResults({ query, numResults }) {
  const safeQuery = sanitizeQuery(query);
  const count = clampNumResults(numResults);
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    rows.push({
      rank: i + 1,
      title: `${safeQuery} result ${i + 1}`,
      url: `https://exa.mock/search/${encodeURIComponent(safeQuery)}/${i + 1}`,
      snippet: `Mock search result ${i + 1} for query: ${safeQuery}`
    });
  }
  return rows;
}

function parseSettldPayToken(authorizationHeaderRaw) {
  const authorizationHeader = typeof authorizationHeaderRaw === "string" ? authorizationHeaderRaw.trim() : "";
  if (!authorizationHeader) return null;
  const lower = authorizationHeader.toLowerCase();
  if (!lower.startsWith("settldpay ")) return null;
  const token = authorizationHeader.slice("settldpay ".length).trim();
  return token || null;
}

function pruneReplayCache(nowMs) {
  for (const [key, row] of replayCache.entries()) {
    if (!row || !Number.isFinite(row.expiresAtMs) || row.expiresAtMs <= nowMs) replayCache.delete(key);
  }
  while (replayCache.size > SETTLD_PAY_REPLAY_MAX_KEYS) {
    const first = replayCache.keys().next().value;
    if (!first) break;
    replayCache.delete(first);
  }
}

function parseVerificationCode(err) {
  const code = typeof err?.code === "string" && err.code.trim() !== "" ? err.code.trim() : "SETTLD_PAY_VERIFICATION_ERROR";
  return code;
}

async function fetchSettldKeysetFromUrl() {
  const signal = typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(SETTLD_PAY_KEYSET_FETCH_TIMEOUT_MS) : undefined;
  const res = await fetch(SETTLD_PAY_KEYSET_URL, { method: "GET", ...(signal ? { signal } : {}) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`keyset fetch failed (${res.status}): ${text || "unknown"}`);
  }
  const keyset = await res.json();
  if (!keyset || typeof keyset !== "object" || Array.isArray(keyset) || !Array.isArray(keyset.keys) || keyset.keys.length === 0) {
    throw new Error("keyset response is invalid");
  }
  const maxAgeMs = parseCacheControlMaxAgeMs(res.headers.get("cache-control"), SETTLD_PAY_KEYSET_DEFAULT_MAX_AGE_MS);
  return { keyset, maxAgeMs };
}

async function getSettldPayKeyset() {
  const nowMs = Date.now();
  if (keysetCache.value && keysetCache.expiresAtMs > nowMs) return keysetCache.value;

  if (SETTLD_PAY_PINNED_ONLY) {
    if (!PINNED_KEYSET) throw new Error("SETTLD_PAY_PINNED_ONLY=1 requires SETTLD_PAY_PINNED_PUBLIC_KEY_PEM");
    keysetCache.value = PINNED_KEYSET;
    keysetCache.expiresAtMs = nowMs + SETTLD_PAY_PINNED_MAX_AGE_MS;
    keysetCache.source = "pinned-only";
    return keysetCache.value;
  }

  try {
    const fetched = await fetchSettldKeysetFromUrl();
    keysetCache.value = fetched.keyset;
    keysetCache.expiresAtMs = nowMs + fetched.maxAgeMs;
    keysetCache.source = "well-known";
    return keysetCache.value;
  } catch (err) {
    if (PINNED_KEYSET) {
      keysetCache.value = PINNED_KEYSET;
      keysetCache.expiresAtMs = nowMs + SETTLD_PAY_PINNED_MAX_AGE_MS;
      keysetCache.source = "pinned-fallback";
      return keysetCache.value;
    }
    throw err;
  }
}

function verifyProviderBinding({ payload, offer }) {
  const payloadAud = String(payload?.aud ?? "");
  const payloadPayeeProviderId = String(payload?.payeeProviderId ?? "");
  if (payloadAud !== offer.providerId || payloadPayeeProviderId !== offer.providerId) {
    return { ok: false, code: "SETTLD_PAY_PROVIDER_MISMATCH", details: { expectedProviderId: offer.providerId, aud: payloadAud, payeeProviderId: payloadPayeeProviderId } };
  }
  const payloadAmountCents = Number(payload?.amountCents ?? 0);
  if (!Number.isSafeInteger(payloadAmountCents) || payloadAmountCents !== offer.amountCents) {
    return { ok: false, code: "SETTLD_PAY_AMOUNT_MISMATCH", details: { expectedAmountCents: offer.amountCents, tokenAmountCents: payloadAmountCents } };
  }
  const payloadCurrency = String(payload?.currency ?? "").toUpperCase();
  if (payloadCurrency !== offer.currency) {
    return { ok: false, code: "SETTLD_PAY_CURRENCY_MISMATCH", details: { expectedCurrency: offer.currency, tokenCurrency: payloadCurrency } };
  }
  return { ok: true };
}

async function verifySettldPaymentToken({ token, offer }) {
  let keyset;
  try {
    keyset = await getSettldPayKeyset();
  } catch (err) {
    return { ok: false, code: "SETTLD_PAY_KEYSET_UNAVAILABLE", message: err?.message ?? String(err ?? "") };
  }

  let verified;
  try {
    verified = verifySettldPayTokenV1({ token, keyset });
  } catch (err) {
    return { ok: false, code: parseVerificationCode(err), message: err?.message ?? String(err ?? "") };
  }
  if (!verified?.ok) {
    return {
      ok: false,
      code: String(verified?.code ?? "SETTLD_PAY_VERIFICATION_ERROR"),
      message: verified?.message ?? "token verification failed",
      details: verified?.payload ? { payload: verified.payload } : null
    };
  }

  const providerBinding = verifyProviderBinding({ payload: verified.payload, offer });
  if (!providerBinding.ok) {
    return {
      ok: false,
      code: providerBinding.code,
      message: "token does not match provider offer",
      details: providerBinding.details
    };
  }

  return {
    ok: true,
    verification: verified,
    keysetSource: keysetCache.source
  };
}

function buildResponseObject(req, url) {
  if (req.method === "GET" && url.pathname === "/exa/search") {
    return {
      ok: true,
      provider: "exa-mock",
      query: sanitizeQuery(url.searchParams.get("q")),
      numResults: clampNumResults(url.searchParams.get("numResults")),
      results: buildExaLikeResults({
        query: url.searchParams.get("q"),
        numResults: url.searchParams.get("numResults")
      })
    };
  }
  return {
    ok: true,
    resource: url.pathname,
    note: "this is a mock upstream response"
  };
}

function signResponse({ responseCanonical, fraud }) {
  const responseHash = sha256Hex(responseCanonical);
  const signedAt = new Date().toISOString();
  const nonce = crypto.randomBytes(16).toString("hex");
  const signature = signToolProviderSignatureV1({
    responseHash,
    nonce,
    signedAt,
    publicKeyPem: PROVIDER_PUBLIC_KEY_PEM,
    privateKeyPem: PROVIDER_PRIVATE_KEY_PEM
  });
  const signatureBase64 = (() => {
    const b64 = String(signature.signatureBase64);
    if (!fraud) return b64;
    // Flip one bit so the signature is guaranteed to be invalid while still valid base64.
    const sigBytes = Buffer.from(b64, "base64");
    sigBytes[0] = (sigBytes[0] ?? 0) ^ 0x01;
    return sigBytes.toString("base64");
  })();

  return {
    responseHash,
    signedAt,
    nonce,
    signatureBase64
  };
}

function sendSignedResponse(res, { responseCanonical, signature, verification, replay = false }) {
  res.statusCode = 200;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("x-settld-provider-key-id", PROVIDER_KEY_ID);
  res.setHeader("x-settld-provider-signed-at", signature.signedAt);
  res.setHeader("x-settld-provider-nonce", signature.nonce);
  res.setHeader("x-settld-provider-response-sha256", signature.responseHash);
  res.setHeader("x-settld-provider-signature", signature.signatureBase64);
  res.setHeader("x-settld-provider-authorization-ref", String(verification?.payload?.authorizationRef ?? ""));
  res.setHeader("x-settld-provider-gate-id", String(verification?.payload?.gateId ?? ""));
  res.setHeader("x-settld-provider-token-sha256", String(verification?.tokenSha256 ?? ""));
  res.setHeader("x-settld-keyset-source", keysetCache.source || "none");
  if (replay) res.setHeader("x-settld-provider-replay", "duplicate");
  res.end(responseCanonical);
}

async function handleRequest(req, res) {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "GET" && url.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/settld/provider-key") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        ok: true,
        algorithm: "ed25519",
        keyId: PROVIDER_KEY_ID,
        publicKeyPem: PROVIDER_PUBLIC_KEY_PEM
      })
    );
    return;
  }

  const offer = pricingForRequest(req, url);
  const token = parseSettldPayToken(req.headers.authorization);
  if (!token) {
    sendPaymentRequired(res, { offer, code: "PAYMENT_REQUIRED", message: "missing or invalid SettldPay authorization" });
    return;
  }

  const verified = await verifySettldPaymentToken({ token, offer });
  if (!verified.ok) {
    sendPaymentRequired(res, {
      offer,
      code: verified.code,
      message: verified.message ?? "payment token rejected",
      details: verified.details ?? null
    });
    return;
  }

  const verification = verified.verification;
  const payload = verification.payload;
  const replayKey = (() => {
    const authorizationRef = typeof payload?.authorizationRef === "string" ? payload.authorizationRef.trim() : "";
    if (authorizationRef) return authorizationRef;
    const gateId = typeof payload?.gateId === "string" ? payload.gateId.trim() : "";
    return gateId || verification.tokenSha256;
  })();

  const nowMs = Date.now();
  pruneReplayCache(nowMs);
  const replayExisting = replayCache.get(replayKey);
  if (replayExisting && replayExisting.expiresAtMs > nowMs) {
    sendSignedResponse(res, {
      responseCanonical: replayExisting.body,
      signature: replayExisting.signature,
      verification,
      replay: true
    });
    return;
  }

  const responseObj = buildResponseObject(req, url);
  const responseCanonical = canonicalJsonStringify(responseObj);
  const fraud = ["1", "true", "yes", "on"].includes(String(url.searchParams.get("fraud") ?? "").trim().toLowerCase());
  const signature = signResponse({ responseCanonical, fraud });

  const replayExpiresAtMs = Number(payload.exp) * 1000 + SETTLD_PAY_REPLAY_TTL_BUFFER_MS;
  replayCache.set(replayKey, {
    expiresAtMs: Number.isFinite(replayExpiresAtMs) ? replayExpiresAtMs : nowMs + 5 * 60_000,
    statusCode: 200,
    body: responseCanonical,
    signature
  });
  pruneReplayCache(nowMs);

  sendSignedResponse(res, { responseCanonical, signature, verification, replay: false });
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        ok: false,
        error: "upstream_error",
        message: err?.message ?? String(err ?? "")
      })
    );
  });
});

if (BIND_HOST) {
  server.listen(PORT, BIND_HOST, () => {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: true, service: "x402-upstream-mock", host: BIND_HOST, port: PORT }));
  });
} else {
  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: true, service: "x402-upstream-mock", port: PORT }));
  });
}
