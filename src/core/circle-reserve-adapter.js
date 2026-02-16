import crypto from "node:crypto";

import { sha256Hex } from "./crypto.js";

export const CIRCLE_RESERVE_STATUS = Object.freeze({
  RESERVED: "reserved",
  VOIDED: "voided"
});

export const CIRCLE_TRANSACTION_STATE = Object.freeze({
  CANCELLED: "CANCELLED",
  CONFIRMED: "CONFIRMED",
  COMPLETE: "COMPLETE",
  DENIED: "DENIED",
  FAILED: "FAILED",
  INITIATED: "INITIATED",
  CLEARED: "CLEARED",
  QUEUED: "QUEUED",
  SENT: "SENT",
  STUCK: "STUCK"
});

const RESERVE_OK_STATES = new Set([
  CIRCLE_TRANSACTION_STATE.INITIATED,
  CIRCLE_TRANSACTION_STATE.QUEUED,
  CIRCLE_TRANSACTION_STATE.SENT,
  CIRCLE_TRANSACTION_STATE.CONFIRMED,
  CIRCLE_TRANSACTION_STATE.COMPLETE,
  CIRCLE_TRANSACTION_STATE.CLEARED
]);

const RESERVE_FAIL_STATES = new Set([
  CIRCLE_TRANSACTION_STATE.DENIED,
  CIRCLE_TRANSACTION_STATE.FAILED,
  CIRCLE_TRANSACTION_STATE.CANCELLED
]);

const CANCELLABLE_STATES = new Set([
  CIRCLE_TRANSACTION_STATE.INITIATED,
  CIRCLE_TRANSACTION_STATE.QUEUED,
  CIRCLE_TRANSACTION_STATE.SENT
]);

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
  return String(value).trim();
}

function normalizePositiveSafeInt(value, name) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new TypeError(`${name} must be a positive safe integer`);
  return n;
}

function normalizeCurrency(value, name) {
  const out = assertNonEmptyString(String(value ?? "USD"), name).toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{2,11}$/.test(out)) throw new TypeError(`${name} must match ^[A-Z][A-Z0-9_]{2,11}$`);
  return out;
}

function parseBooleanLike(value, fallback = false) {
  if (value === null || value === undefined || String(value).trim() === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") return true;
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") return false;
  return fallback;
}

function normalizeMode(value) {
  const normalized = String(value ?? "stub").trim().toLowerCase();
  if (normalized === "stub" || normalized === "test") return "stub";
  if (normalized === "fail") return "fail";
  if (normalized === "sandbox") return "sandbox";
  if (normalized === "production" || normalized === "prod") return "production";
  throw new TypeError("mode must be stub|fail|sandbox|production");
}

function normalizeIsoDate(value, name) {
  const out = assertNonEmptyString(value, name);
  if (!Number.isFinite(Date.parse(out))) throw new TypeError(`${name} must be an ISO date-time`);
  return out;
}

function normalizeCircleState(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const normalized = String(value).trim().toUpperCase();
  if (Object.values(CIRCLE_TRANSACTION_STATE).includes(normalized)) return normalized;
  return normalized;
}

function classifyCircleReserveState(state) {
  if (!state) return "unknown";
  if (RESERVE_OK_STATES.has(state)) return "reserved";
  if (RESERVE_FAIL_STATES.has(state)) return "failed";
  if (state === CIRCLE_TRANSACTION_STATE.STUCK) return "uncertain";
  return "unknown";
}

function centsToAssetAmountString(amountCents) {
  const cents = normalizePositiveSafeInt(amountCents, "amountCents");
  const whole = Math.floor(cents / 100);
  const fraction = String(cents % 100).padStart(2, "0");
  return `${whole}.${fraction}`;
}

function isUuidV4(value) {
  if (typeof value !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

function stableUuidV4FromString(input) {
  const text = assertNonEmptyString(input, "idempotencyKeySource");
  const buf = Buffer.from(sha256Hex(text).slice(0, 32), "hex");
  buf[6] = (buf[6] & 0x0f) | 0x40;
  buf[8] = (buf[8] & 0x3f) | 0x80;
  const hex = buf.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function normalizeCircleIdempotencyKey(value) {
  const source = assertNonEmptyString(value, "idempotencyKey");
  if (isUuidV4(source)) return source.toLowerCase();
  return stableUuidV4FromString(source);
}

function makeAdapterError(code, message, details = null) {
  const err = new Error(message);
  err.code = code;
  if (details && typeof details === "object") err.details = details;
  return err;
}

function pickFirstObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (Array.isArray(value) && value.length > 0) {
    const first = value[0];
    if (first && typeof first === "object" && !Array.isArray(first)) return first;
  }
  return null;
}

function extractCircleTransaction(payload) {
  const root = pickFirstObject(payload);
  if (!root) return { id: null, state: null, raw: null };

  const candidates = [];
  candidates.push(root);
  if (root.data) {
    const data = pickFirstObject(root.data);
    if (data) candidates.push(data);
  }
  if (root.transaction) {
    const tx = pickFirstObject(root.transaction);
    if (tx) candidates.push(tx);
  }
  if (root.transactions) {
    const tx = pickFirstObject(root.transactions);
    if (tx) candidates.push(tx);
  }

  for (const row of candidates) {
    const id =
      (typeof row.id === "string" && row.id.trim() !== "" ? row.id.trim() : null) ??
      (typeof row.transactionId === "string" && row.transactionId.trim() !== "" ? row.transactionId.trim() : null);
    const state = normalizeCircleState(row.state ?? row.status ?? null);
    if (id || state) return { id, state, raw: row };
  }
  return { id: null, state: null, raw: null };
}

async function parseErrorBody(response) {
  const text = await response.text();
  if (!text) return { text: "", json: null };
  try {
    return { text, json: JSON.parse(text) };
  } catch {
    return { text, json: null };
  }
}

function errorIncludes(codeOrMessage, needle) {
  const hay = String(codeOrMessage ?? "").toLowerCase();
  return hay.includes(String(needle ?? "").toLowerCase());
}

async function fetchWithTimeout(fetchFn, url, init, timeoutMs) {
  const ms = Number(timeoutMs);
  if (!Number.isFinite(ms) || ms <= 0) throw new TypeError("timeoutMs must be a positive number");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), ms);
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeEntitySecretProvider({
  entitySecretCiphertextProvider = null,
  entitySecretCiphertext = null,
  entitySecretTemplate = null,
  allowStatic = false
} = {}) {
  if (typeof entitySecretCiphertextProvider === "function") {
    return { mode: "function", get: entitySecretCiphertextProvider };
  }
  if (typeof entitySecretTemplate === "string" && entitySecretTemplate.trim() !== "") {
    const template = entitySecretTemplate.trim();
    return {
      mode: "template",
      get: () => template.replaceAll("{{uuid}}", crypto.randomUUID())
    };
  }
  if (typeof entitySecretCiphertext === "string" && entitySecretCiphertext.trim() !== "") {
    const value = entitySecretCiphertext.trim();
    if (!allowStatic) {
      throw makeAdapterError(
        "CIRCLE_CONFIG_INVALID",
        "entitySecretCiphertext must be unique per request; provide CIRCLE_ENTITY_SECRET_CIPHERTEXT_TEMPLATE with {{uuid}} or a provider function"
      );
    }
    return { mode: "static", get: () => value };
  }
  return { mode: "missing", get: null };
}

function normalizeEntitySecretHex(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw makeAdapterError("CIRCLE_CONFIG_INVALID", "ENTITY_SECRET must be a 64-character hex string");
  }
  return raw.toLowerCase();
}

function normalizePublicKeyPem(raw) {
  const text = assertNonEmptyString(raw, "entityPublicKey");
  if (text.includes("BEGIN PUBLIC KEY")) return text.replace(/\\n/g, "\n");
  const chunks = text.match(/.{1,64}/g) ?? [];
  return `-----BEGIN PUBLIC KEY-----\n${chunks.join("\n")}\n-----END PUBLIC KEY-----\n`;
}

function createEntitySecretCiphertextProvider({
  apiKey,
  baseUrl,
  fetchFn,
  timeoutMs,
  requestId,
  entitySecretHex
} = {}) {
  let cachedPublicKeyPem = null;
  const secret = normalizeEntitySecretHex(entitySecretHex);
  if (!secret) return null;
  return async () => {
    if (!cachedPublicKeyPem) {
      const requestUrl = new URL("/v1/w3s/config/entity/publicKey", baseUrl).toString();
      const response = await fetchWithTimeout(
        fetchFn,
        requestUrl,
        {
          method: "GET",
          headers: {
            authorization: `Bearer ${apiKey}`,
            accept: "application/json",
            "x-request-id": requestId()
          }
        },
        timeoutMs
      );
      const { json, text } = await parseErrorBody(response);
      if (response.status < 200 || response.status >= 300) {
        const detail = json?.message ?? json?.error ?? text ?? `HTTP ${response.status}`;
        throw makeAdapterError("CIRCLE_HTTP_ERROR", `GET /v1/w3s/config/entity/publicKey failed: ${detail}`, {
          status: response.status,
          body: json ?? text
        });
      }
      cachedPublicKeyPem = normalizePublicKeyPem(json?.data?.publicKey);
    }
    return crypto
      .publicEncrypt(
        {
          key: cachedPublicKeyPem,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: "sha256"
        },
        Buffer.from(secret, "hex")
      )
      .toString("base64");
  };
}

function normalizeTransferAmountField(value) {
  const normalized = String(value ?? "amounts").trim().toLowerCase();
  if (normalized === "amounts" || normalized === "amount") return normalized;
  throw new TypeError("transferAmountField must be amounts|amount");
}

function normalizeFeeLevel(value) {
  const normalized = String(value ?? "MEDIUM").trim().toUpperCase();
  if (!normalized) return "MEDIUM";
  return normalized;
}

function buildTransferBody({
  sourceWalletId,
  destinationAddress,
  destinationWalletId = null,
  amountString,
  tokenId,
  blockchain,
  entitySecretCiphertext,
  idempotencyKey,
  transferAmountField = "amounts",
  feeLevel = null
} = {}) {
  const body = {
    idempotencyKey,
    walletId: sourceWalletId,
    destinationAddress,
    tokenId,
    blockchain,
    entitySecretCiphertext
  };
  if (destinationWalletId) body.destinationWalletId = destinationWalletId;
  if (typeof feeLevel === "string" && feeLevel.trim() !== "") body.feeLevel = feeLevel.trim().toUpperCase();
  if (transferAmountField === "amounts") body.amounts = [amountString];
  else body.amount = amountString;
  return body;
}

function normalizeBaseUrl(baseUrl, mode) {
  const fallback = mode === "production" ? "https://api.circle.com" : "https://api-sandbox.circle.com";
  const out = String(baseUrl ?? fallback).trim();
  try {
    const u = new URL(out);
    return u.toString().replace(/\/+$/, "");
  } catch (err) {
    throw new TypeError(`invalid Circle baseUrl: ${err?.message ?? String(err ?? "")}`);
  }
}

function readCircleRuntimeConfig({
  mode,
  config = null,
  fetchFn = null,
  now = () => new Date().toISOString(),
  entitySecretCiphertextProvider = null
} = {}) {
  const cfg = config && typeof config === "object" && !Array.isArray(config) ? config : {};
  const env = typeof process !== "undefined" && process?.env ? process.env : {};

  const normalizedMode = normalizeMode(mode);
  const nowIso = () => normalizeIsoDate(typeof now === "function" ? now() : new Date().toISOString(), "now()");
  const effectiveFetch = fetchFn ?? (typeof fetch === "function" ? fetch : null);

  if (normalizedMode === "stub" || normalizedMode === "fail") {
    return {
      mode: normalizedMode,
      nowIso,
      fetchFn: effectiveFetch,
      baseUrl: null,
      apiKey: null,
      timeoutMs: 0,
      blockchain: null,
      spendWalletId: null,
      escrowWalletId: null,
      spendAddress: null,
      escrowAddress: null,
      tokenId: null,
      transferAmountField: "amounts",
      entitySecret: { mode: "missing", get: null },
      requestId: () => crypto.randomUUID()
    };
  }

  if (!effectiveFetch) throw makeAdapterError("CIRCLE_CONFIG_INVALID", "fetchFn is required in sandbox/production mode");

  const apiKey = assertNonEmptyString(cfg.apiKey ?? env.CIRCLE_API_KEY ?? "", "CIRCLE_API_KEY");
  const baseUrl = normalizeBaseUrl(cfg.baseUrl ?? env.CIRCLE_BASE_URL ?? null, normalizedMode);
  const timeoutMsRaw = cfg.timeoutMs ?? env.CIRCLE_TIMEOUT_MS ?? 20_000;
  const timeoutMs = Number(timeoutMsRaw);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError("CIRCLE_TIMEOUT_MS must be a positive number");

  const blockchain = assertNonEmptyString(cfg.blockchain ?? env.CIRCLE_BLOCKCHAIN ?? (normalizedMode === "production" ? "BASE" : "BASE-SEPOLIA"), "CIRCLE_BLOCKCHAIN");
  const spendWalletId = assertNonEmptyString(cfg.spendWalletId ?? env.CIRCLE_WALLET_ID_SPEND ?? "", "CIRCLE_WALLET_ID_SPEND");
  const escrowWalletId = assertNonEmptyString(cfg.escrowWalletId ?? env.CIRCLE_WALLET_ID_ESCROW ?? "", "CIRCLE_WALLET_ID_ESCROW");
  const spendAddress = cfg.spendAddress ?? env.CIRCLE_SPEND_ADDRESS ?? null;
  const escrowAddress = cfg.escrowAddress ?? env.CIRCLE_ESCROW_ADDRESS ?? null;
  const tokenId = assertNonEmptyString(cfg.tokenId ?? env.CIRCLE_TOKEN_ID_USDC ?? "", "CIRCLE_TOKEN_ID_USDC");
  const transferAmountField = normalizeTransferAmountField(cfg.transferAmountField ?? env.CIRCLE_TRANSFER_AMOUNT_FIELD ?? "amounts");
  const feeLevel = normalizeFeeLevel(cfg.feeLevel ?? env.CIRCLE_FEE_LEVEL ?? "MEDIUM");

  const entitySecret = normalizeEntitySecretProvider({
    entitySecretCiphertextProvider: cfg.entitySecretCiphertextProvider ?? entitySecretCiphertextProvider,
    entitySecretCiphertext: cfg.entitySecretCiphertext ?? env.CIRCLE_ENTITY_SECRET_CIPHERTEXT ?? null,
    entitySecretTemplate: cfg.entitySecretTemplate ?? env.CIRCLE_ENTITY_SECRET_CIPHERTEXT_TEMPLATE ?? null,
    allowStatic: parseBooleanLike(cfg.allowStaticEntitySecretCiphertext ?? env.CIRCLE_ALLOW_STATIC_ENTITY_SECRET, false)
  });
  if (typeof entitySecret.get !== "function") {
    throw makeAdapterError(
      "CIRCLE_CONFIG_INVALID",
      "entitySecretCiphertext provider is required in sandbox/production mode (set CIRCLE_ENTITY_SECRET_CIPHERTEXT_TEMPLATE='...{{uuid}}...')"
    );
  }

  const requestId =
    typeof cfg.requestId === "function"
      ? cfg.requestId
      : () => {
          return crypto.randomUUID();
        };

  const entitySecretHex = normalizeEntitySecretHex(cfg.entitySecretHex ?? env.CIRCLE_ENTITY_SECRET_HEX ?? env.ENTITY_SECRET ?? null);
  const dynamicEntitySecretProvider =
    typeof cfg.entitySecretCiphertextProvider === "function"
      ? null
      : createEntitySecretCiphertextProvider({
          apiKey,
          baseUrl,
          fetchFn: effectiveFetch,
          timeoutMs,
          requestId,
          entitySecretHex
        });

  return {
    mode: normalizedMode,
    nowIso,
    fetchFn: effectiveFetch,
    baseUrl,
    apiKey,
    timeoutMs,
    blockchain,
    spendWalletId,
    escrowWalletId,
    spendAddress: typeof spendAddress === "string" && spendAddress.trim() !== "" ? spendAddress.trim() : null,
    escrowAddress: typeof escrowAddress === "string" && escrowAddress.trim() !== "" ? escrowAddress.trim() : null,
    tokenId,
    feeLevel,
    transferAmountField,
    entitySecret:
      dynamicEntitySecretProvider === null ? entitySecret : { mode: "derived", get: dynamicEntitySecretProvider },
    requestId
  };
}

function resolveResponseJsonOrThrow({ status, json, text, request }) {
  if (status >= 200 && status < 300) return json;
  const baseDetail = json?.message ?? json?.error ?? text ?? `HTTP ${status}`;
  const validationErrors = Array.isArray(json?.errors) ? json.errors : null;
  const detail = validationErrors ? `${baseDetail} ${JSON.stringify(validationErrors)}` : baseDetail;
  throw makeAdapterError("CIRCLE_HTTP_ERROR", `${request} failed: ${detail}`, { status, body: json ?? text });
}

async function fetchCircleJson({ runtime, method, path, body = null } = {}) {
  const requestUrl = new URL(path, runtime.baseUrl).toString();
  const headers = {
    authorization: `Bearer ${runtime.apiKey}`,
    "content-type": "application/json; charset=utf-8",
    "x-request-id": runtime.requestId()
  };
  const response = await fetchWithTimeout(
    runtime.fetchFn,
    requestUrl,
    {
      method,
      headers,
      body: body === null ? undefined : JSON.stringify(body)
    },
    runtime.timeoutMs
  );
  const { json, text } = await parseErrorBody(response);
  return resolveResponseJsonOrThrow({
    status: response.status,
    json,
    text,
    request: `${method} ${path}`
  });
}

function normalizeTransferError(error, { operation, details } = {}) {
  const raw = error?.details?.body ?? error?.details ?? null;
  const rawText = raw && typeof raw === "object" ? JSON.stringify(raw) : String(raw ?? error?.message ?? "");
  if (errorIncludes(error?.code, "CIRCLE_HTTP_ERROR") && errorIncludes(rawText, "amounts")) {
    return makeAdapterError("CIRCLE_RESERVE_FAILED", `${operation} failed: invalid transfer amount field`, details ?? null);
  }
  const code = error?.code ?? "CIRCLE_RESERVE_FAILED";
  return makeAdapterError(code, `${operation} failed: ${error?.message ?? String(error ?? "")}`, details ?? null);
}

async function fetchCircleTransactionById({ runtime, transactionId } = {}) {
  const txId = assertNonEmptyString(transactionId, "transactionId");
  const candidatePaths = [`/v1/w3s/transactions/${encodeURIComponent(txId)}`, `/v1/w3s/developer/transactions/${encodeURIComponent(txId)}`];
  let lastError = null;
  for (const path of candidatePaths) {
    try {
      const payload = await fetchCircleJson({ runtime, method: "GET", path });
      const extracted = extractCircleTransaction(payload);
      const state = normalizeCircleState(extracted.state);
      return {
        transactionId: extracted.id ?? txId,
        state,
        raw: extracted.raw ?? payload
      };
    } catch (err) {
      lastError = err;
      if (String(err?.code ?? "") !== "CIRCLE_HTTP_ERROR") throw err;
    }
  }
  throw lastError ?? makeAdapterError("CIRCLE_HTTP_ERROR", `unable to fetch Circle transaction ${txId}`);
}

async function transferWithShape({
  runtime,
  sourceWalletId,
  destinationAddress,
  destinationWalletId = null,
  amountCents,
  idempotencyKey,
  transferAmountField
} = {}) {
  const amountString = centsToAssetAmountString(amountCents);
  const entitySecretCiphertext = assertNonEmptyString(await runtime.entitySecret.get(), "entitySecretCiphertext");
  const body = buildTransferBody({
    sourceWalletId,
    destinationAddress,
    destinationWalletId,
    amountString,
    tokenId: runtime.tokenId,
    blockchain: runtime.blockchain,
    entitySecretCiphertext,
    idempotencyKey,
    transferAmountField,
    feeLevel: runtime.feeLevel
  });

  const payload = await fetchCircleJson({
    runtime,
    method: "POST",
    path: "/v1/w3s/developer/transactions/transfer",
    body
  });

  const extracted = extractCircleTransaction(payload);
  const transactionId = extracted.id;
  const initialState = normalizeCircleState(extracted.state);
  if (!transactionId) {
    throw makeAdapterError("CIRCLE_RESERVE_FAILED", "Circle transfer response missing transaction id");
  }

  const state = initialState ?? (await fetchCircleTransactionById({ runtime, transactionId })).state;
  return {
    transactionId,
    state
  };
}

async function tryCircleCancel({ runtime, reserveId } = {}) {
  const txId = assertNonEmptyString(reserveId, "reserveId");
  try {
    const payload = await fetchCircleJson({
      runtime,
      method: "POST",
      path: `/v1/w3s/developer/transactions/${encodeURIComponent(txId)}/cancel`,
      body: {}
    });
    const extracted = extractCircleTransaction(payload);
    const state = normalizeCircleState(extracted.state);
    return {
      cancelled: state === CIRCLE_TRANSACTION_STATE.CANCELLED,
      state,
      transactionId: extracted.id ?? txId
    };
  } catch (err) {
    if (String(err?.code ?? "") === "CIRCLE_HTTP_ERROR") {
      const msg = JSON.stringify(err?.details?.body ?? {});
      if (errorIncludes(msg, "cannot cancel") || errorIncludes(msg, "not cancellable") || errorIncludes(msg, "already")) {
        return { cancelled: false, state: null, transactionId: txId };
      }
    }
    throw err;
  }
}

export function createCircleReserveAdapter({
  mode = "stub",
  now = () => new Date().toISOString(),
  fetchFn = null,
  config = null,
  entitySecretCiphertextProvider = null
} = {}) {
  const runtime = readCircleRuntimeConfig({ mode, config, fetchFn, now, entitySecretCiphertextProvider });
  const normalizedMode = runtime.mode;

  const walletAddressCache = new Map();
  async function resolveWalletAddress(walletId, { fallbackAddress = null } = {}) {
    const normalizedWalletId = assertNonEmptyString(walletId, "walletId");
    if (typeof fallbackAddress === "string" && fallbackAddress.trim() !== "") return fallbackAddress.trim();
    if (walletAddressCache.has(normalizedWalletId)) return walletAddressCache.get(normalizedWalletId);
    const payload = await fetchCircleJson({
      runtime,
      method: "GET",
      path: `/v1/w3s/wallets/${encodeURIComponent(normalizedWalletId)}`
    });
    const root = pickFirstObject(payload);
    const candidates = [];
    if (root) candidates.push(root);
    if (root?.wallet) candidates.push(root.wallet);
    if (root?.data) candidates.push(root.data);
    if (root?.data?.wallet) candidates.push(root.data.wallet);
    if (Array.isArray(root?.data?.wallets)) {
      for (const row of root.data.wallets) {
        if (row && typeof row === "object" && !Array.isArray(row)) candidates.push(row);
      }
    }
    let address = null;
    for (const candidate of candidates) {
      const row = pickFirstObject(candidate);
      if (!row) continue;
      if (typeof row.address === "string" && row.address.trim() !== "") {
        address = row.address.trim();
        break;
      }
      if (row.blockchainAddress && typeof row.blockchainAddress === "string" && row.blockchainAddress.trim() !== "") {
        address = row.blockchainAddress.trim();
        break;
      }
      if (Array.isArray(row.addresses) && row.addresses.length > 0) {
        const first = pickFirstObject(row.addresses[0]);
        if (first && typeof first.address === "string" && first.address.trim() !== "") {
          address = first.address.trim();
          break;
        }
      }
    }
    if (!address) throw makeAdapterError("CIRCLE_CONFIG_INVALID", `unable to resolve wallet address for ${normalizedWalletId}`);
    walletAddressCache.set(normalizedWalletId, address);
    return address;
  }

  const nowIso = runtime.nowIso;

  async function reserve({
    tenantId,
    gateId,
    amountCents,
    currency = "USD",
    idempotencyKey = null,
    payerAgentId = null,
    payeeAgentId = null
  } = {}) {
    const normalizedTenantId = assertNonEmptyString(tenantId, "tenantId");
    const normalizedGateId = assertNonEmptyString(gateId, "gateId");
    const normalizedAmountCents = normalizePositiveSafeInt(amountCents, "amountCents");
    const normalizedCurrency = normalizeCurrency(currency, "currency");
    const normalizedIdempotencyKey =
      idempotencyKey === null || idempotencyKey === undefined || String(idempotencyKey).trim() === ""
        ? normalizedGateId
        : String(idempotencyKey).trim();

    if (normalizedMode === "fail") {
      throw makeAdapterError("CIRCLE_RESERVE_UNAVAILABLE", "circle reserve unavailable");
    }

    if (normalizedMode === "stub") {
      const reserveId = `circle_transfer_${sha256Hex(
        `${normalizedTenantId}\n${normalizedGateId}\n${normalizedAmountCents}\n${normalizedCurrency}\n${normalizedIdempotencyKey}\n${String(
          payerAgentId ?? ""
        )}\n${String(payeeAgentId ?? "")}`
      ).slice(0, 32)}`;
      return {
        reserveId,
        status: CIRCLE_RESERVE_STATUS.RESERVED,
        adapter: "circle",
        mode: "transfer",
        amountCents: normalizedAmountCents,
        currency: normalizedCurrency,
        createdAt: nowIso(),
        metadata: {
          idempotencyKey: normalizedIdempotencyKey
        }
      };
    }

    const circleIdempotencyKey = normalizeCircleIdempotencyKey(normalizedIdempotencyKey);
    const destinationAddress = await resolveWalletAddress(runtime.escrowWalletId, { fallbackAddress: runtime.escrowAddress });
    let transferred = null;
    try {
      transferred = await transferWithShape({
        runtime,
        sourceWalletId: runtime.spendWalletId,
        destinationAddress,
        destinationWalletId: runtime.escrowWalletId,
        amountCents: normalizedAmountCents,
        idempotencyKey: circleIdempotencyKey,
        transferAmountField: runtime.transferAmountField
      });
    } catch (err) {
      throw normalizeTransferError(err, {
        operation: "reserve transfer",
        details: { gateId: normalizedGateId, idempotencyKey: normalizedIdempotencyKey }
      });
    }

    const circleState = normalizeCircleState(transferred.state);
    const classification = classifyCircleReserveState(circleState);
    if (classification !== "reserved") {
      const errCode = classification === "uncertain" ? "CIRCLE_RESERVE_UNCERTAIN" : "CIRCLE_RESERVE_FAILED";
      throw makeAdapterError(errCode, `Circle reserve not safe to authorize (state=${circleState ?? "unknown"})`, {
        circleTransactionId: transferred.transactionId,
        circleState
      });
    }

    return {
      reserveId: transferred.transactionId,
      status: CIRCLE_RESERVE_STATUS.RESERVED,
      adapter: "circle",
      mode: "transfer",
      amountCents: normalizedAmountCents,
      currency: normalizedCurrency,
      createdAt: nowIso(),
      circleState,
      metadata: {
        idempotencyKey: normalizedIdempotencyKey,
        circleIdempotencyKey
      }
    };
  }

  async function voidReserve({
    reserveId,
    idempotencyKey = null,
    amountCents = null,
    currency = "USD"
  } = {}) {
    const normalizedReserveId = assertNonEmptyString(reserveId, "reserveId");
    const normalizedCurrency = normalizeCurrency(currency, "currency");
    const nowAt = nowIso();

    if (normalizedMode === "stub") {
      return {
        reserveId: normalizedReserveId,
        status: CIRCLE_RESERVE_STATUS.VOIDED,
        voidedAt: nowAt,
        method: "stub"
      };
    }
    if (normalizedMode === "fail") {
      throw makeAdapterError("CIRCLE_RESERVE_UNAVAILABLE", "circle reserve unavailable");
    }

    const tx = await fetchCircleTransactionById({ runtime, transactionId: normalizedReserveId });
    const state = normalizeCircleState(tx.state);
    if (state === CIRCLE_TRANSACTION_STATE.CANCELLED || state === CIRCLE_TRANSACTION_STATE.DENIED || state === CIRCLE_TRANSACTION_STATE.FAILED) {
      return {
        reserveId: normalizedReserveId,
        status: CIRCLE_RESERVE_STATUS.VOIDED,
        voidedAt: nowAt,
        method: "already_terminal",
        circleState: state
      };
    }

    if (CANCELLABLE_STATES.has(state)) {
      const cancelled = await tryCircleCancel({ runtime, reserveId: normalizedReserveId });
      if (cancelled.cancelled) {
        return {
          reserveId: normalizedReserveId,
          status: CIRCLE_RESERVE_STATUS.VOIDED,
          voidedAt: nowAt,
          method: "cancel",
          circleState: cancelled.state ?? CIRCLE_TRANSACTION_STATE.CANCELLED
        };
      }
    }

    const normalizedAmountCents = normalizePositiveSafeInt(amountCents, "amountCents");
    const compensateSourceWalletId = runtime.escrowWalletId;
    const spendAddress = await resolveWalletAddress(runtime.spendWalletId, { fallbackAddress: runtime.spendAddress });
    const compensationIdempotencySource =
      idempotencyKey === null || idempotencyKey === undefined || String(idempotencyKey).trim() === ""
        ? `${normalizedReserveId}:void`
        : String(idempotencyKey).trim();
    const compensationIdempotencyKey = normalizeCircleIdempotencyKey(compensationIdempotencySource);

    let compensation = null;
    try {
      compensation = await transferWithShape({
        runtime,
        sourceWalletId: compensateSourceWalletId,
        destinationAddress: spendAddress,
        destinationWalletId: runtime.spendWalletId,
        amountCents: normalizedAmountCents,
        idempotencyKey: compensationIdempotencyKey,
        transferAmountField: runtime.transferAmountField
      });
    } catch (err) {
      throw normalizeTransferError(err, { operation: "compensating transfer", details: { reserveId: normalizedReserveId } });
    }

    const compensationState = normalizeCircleState(compensation.state);
    const compensationClass = classifyCircleReserveState(compensationState);
    if (compensationClass !== "reserved") {
      throw makeAdapterError("CIRCLE_RESERVE_VOID_FAILED", `compensating transfer failed (state=${compensationState ?? "unknown"})`, {
        reserveId: normalizedReserveId,
        compensationReserveId: compensation.transactionId
      });
    }

    return {
      reserveId: normalizedReserveId,
      status: CIRCLE_RESERVE_STATUS.VOIDED,
      voidedAt: nowAt,
      method: "compensate",
      circleState: compensationState,
      compensationReserveId: compensation.transactionId,
      amountCents: normalizedAmountCents,
      currency: normalizedCurrency
    };
  }

  return {
    providerId: "circle",
    mode: normalizedMode,
    reserve,
    void: voidReserve
  };
}
