import { captureFrontendSentryException } from "../sentry.jsx";

export const DEFAULT_PUBLIC_API_BASE_URL = "https://api.nooterra.ai";

export function isManagedWebsiteHostname(hostname) {
  const normalized = String(hostname ?? "").trim().toLowerCase();
  return normalized === "www.nooterra.ai" || normalized === "nooterra.ai";
}

export function resolveDefaultApiBaseUrl({
  envBaseUrl = typeof import.meta !== "undefined" ? import.meta.env?.VITE_NOOTERRA_API_BASE_URL : ""
} = {}) {
  const normalizedEnvBaseUrl = String(envBaseUrl ?? "").trim();
  if (normalizedEnvBaseUrl) return normalizedEnvBaseUrl;
  return "/__nooterra";
}

export function resolveDefaultAuthBaseUrl({
  envBaseUrl = typeof import.meta !== "undefined" ? import.meta.env?.VITE_NOOTERRA_AUTH_BASE_URL : ""
} = {}) {
  const normalizedEnvBaseUrl = String(envBaseUrl ?? "").trim();
  if (normalizedEnvBaseUrl) return normalizedEnvBaseUrl;
  return "/__magic";
}

export const DEFAULT_BASE_URL = resolveDefaultApiBaseUrl();
export const DEFAULT_AUTH_BASE_URL = resolveDefaultAuthBaseUrl();

export const PRODUCT_RUNTIME_STORAGE_KEY = "nooterra_product_runtime_v2";
export const PRODUCT_BUYER_PASSKEY_STORAGE_KEY = "nooterra_product_buyer_passkeys_v1";

// Migrate passkeys from localStorage to sessionStorage (security hardening)
try {
  const legacyData = localStorage.getItem(PRODUCT_BUYER_PASSKEY_STORAGE_KEY);
  if (legacyData) {
    sessionStorage.setItem(PRODUCT_BUYER_PASSKEY_STORAGE_KEY, legacyData);
    localStorage.removeItem(PRODUCT_BUYER_PASSKEY_STORAGE_KEY);
  }
} catch {}

function toBase64(bytes) {
  let binary = "";
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const chunkSize = 0x8000;
  for (let index = 0; index < view.length; index += chunkSize) {
    const chunk = view.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function toBase64Url(bytes) {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64(value) {
  const raw = atob(String(value ?? ""));
  const out = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) out[index] = raw.charCodeAt(index);
  return out;
}

function wrapPemBody(base64) {
  return String(base64).replace(/(.{64})/g, "$1\n").trim();
}

function arrayBufferToPem(buffer, label) {
  const base64 = toBase64(new Uint8Array(buffer));
  return `-----BEGIN ${label}-----\n${wrapPemBody(base64)}\n-----END ${label}-----\n`;
}

function pemToArrayBuffer(pem) {
  const normalized = String(pem ?? "")
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  return fromBase64(normalized).buffer;
}

function canonicalize(value) {
  if (value === null) return null;
  const valueType = typeof value;
  if (valueType === "string" || valueType === "boolean") return value;
  if (valueType === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Unsupported number for canonical JSON: non-finite");
    if (Object.is(value, -0)) throw new TypeError("Unsupported number for canonical JSON: -0");
    return value;
  }
  if (valueType === "undefined") throw new TypeError("Unsupported value for canonical JSON: undefined");
  if (valueType === "bigint" || valueType === "function" || valueType === "symbol") {
    throw new TypeError(`Unsupported type for canonical JSON: ${valueType}`);
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (valueType === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new TypeError("Unsupported object for canonical JSON: non-plain object");
    }
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  throw new TypeError(`Unsupported value for canonical JSON: ${String(value)}`);
}

function normalizeForCanonicalJson(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const valueType = typeof value;
  if (valueType === "string" || valueType === "boolean") return value;
  if (valueType === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Unsupported number for canonical JSON: non-finite");
    if (Object.is(value, -0)) throw new TypeError("Unsupported number for canonical JSON: -0");
    return value;
  }
  if (valueType === "bigint" || valueType === "function" || valueType === "symbol") {
    throw new TypeError(`Unsupported type for canonical JSON: ${valueType}`);
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((row) => normalizeForCanonicalJson(row));
  if (valueType === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new TypeError("Unsupported object for canonical JSON: non-plain object");
    }
    const out = {};
    for (const key of Object.keys(value)) {
      const normalized = normalizeForCanonicalJson(value[key]);
      if (normalized !== undefined) out[key] = normalized;
    }
    return out;
  }
  throw new TypeError(`Unsupported value for canonical JSON: ${String(value)}`);
}

function hexToUint8Array(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new TypeError("value must be sha256 hex");
  const out = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < normalized.length; index += 2) {
    out[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16);
  }
  return out;
}

export function loadRuntimeConfig() {
  if (typeof window === "undefined") {
    return {
      baseUrl: DEFAULT_BASE_URL,
      authBaseUrl: DEFAULT_AUTH_BASE_URL,
      apiKey: "",
      tenantId: "tenant_default",
      protocol: "1.0"
    };
  }
  try {
    const raw = localStorage.getItem(PRODUCT_RUNTIME_STORAGE_KEY);
    if (!raw) throw new Error("missing");
    const parsed = JSON.parse(raw);
    return {
      baseUrl: typeof parsed?.baseUrl === "string" && parsed.baseUrl.trim() ? parsed.baseUrl.trim() : DEFAULT_BASE_URL,
      authBaseUrl:
        typeof parsed?.authBaseUrl === "string" && parsed.authBaseUrl.trim()
          ? parsed.authBaseUrl.trim()
          : DEFAULT_AUTH_BASE_URL,
      apiKey: typeof parsed?.apiKey === "string" ? parsed.apiKey : "",
      tenantId: typeof parsed?.tenantId === "string" && parsed.tenantId.trim() ? parsed.tenantId.trim() : "tenant_default",
      protocol: typeof parsed?.protocol === "string" && parsed.protocol.trim() ? parsed.protocol.trim() : "1.0"
    };
  } catch {
    return {
      baseUrl: DEFAULT_BASE_URL,
      authBaseUrl: DEFAULT_AUTH_BASE_URL,
      apiKey: "",
      tenantId: "tenant_default",
      protocol: "1.0"
    };
  }
}

function normalizeBuyerPasskeyStorageId({ tenantId, email }) {
  const normalizedTenantId = typeof tenantId === "string" && tenantId.trim() ? tenantId.trim() : "";
  const normalizedEmail = typeof email === "string" && email.trim() ? email.trim().toLowerCase() : "";
  if (!normalizedTenantId || !normalizedEmail) return "";
  return `${normalizedTenantId}\n${normalizedEmail}`;
}

function normalizeStoredBuyerPasskeyBundle(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const tenantId = typeof value.tenantId === "string" && value.tenantId.trim() ? value.tenantId.trim() : "";
  const email = typeof value.email === "string" && value.email.trim() ? value.email.trim().toLowerCase() : "";
  const credentialId = typeof value.credentialId === "string" && value.credentialId.trim() ? value.credentialId.trim() : "";
  const publicKeyPem = typeof value.publicKeyPem === "string" && value.publicKeyPem.trim() ? value.publicKeyPem.trim() : "";
  const privateKeyPem = typeof value.privateKeyPem === "string" && value.privateKeyPem.trim() ? value.privateKeyPem.trim() : "";
  if (!tenantId || !email || !credentialId || !publicKeyPem || !privateKeyPem) return null;
  return {
    tenantId,
    email,
    credentialId,
    publicKeyPem,
    privateKeyPem,
    keyId: typeof value.keyId === "string" && value.keyId.trim() ? value.keyId.trim() : "",
    label: typeof value.label === "string" ? value.label.trim() : "",
    createdAt: typeof value.createdAt === "string" && value.createdAt.trim() ? value.createdAt : new Date().toISOString(),
    lastUsedAt: typeof value.lastUsedAt === "string" && value.lastUsedAt.trim() ? value.lastUsedAt : null
  };
}

function readStoredBuyerPasskeyMap() {
  if (typeof window === "undefined" || !globalThis.sessionStorage) return {};
  try {
    const raw = sessionStorage.getItem(PRODUCT_BUYER_PASSKEY_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

function writeStoredBuyerPasskeyMap(value) {
  if (typeof window === "undefined" || !globalThis.sessionStorage) return;
  try {
    sessionStorage.setItem(PRODUCT_BUYER_PASSKEY_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export function loadStoredBuyerPasskeyBundle({ tenantId, email } = {}) {
  const id = normalizeBuyerPasskeyStorageId({ tenantId, email });
  if (!id) return null;
  const map = readStoredBuyerPasskeyMap();
  return normalizeStoredBuyerPasskeyBundle(map[id] ?? null);
}

export function saveStoredBuyerPasskeyBundle(bundle) {
  const normalized = normalizeStoredBuyerPasskeyBundle(bundle);
  if (!normalized) return null;
  const id = normalizeBuyerPasskeyStorageId(normalized);
  if (!id) return null;
  const map = readStoredBuyerPasskeyMap();
  map[id] = normalized;
  writeStoredBuyerPasskeyMap(map);
  return normalized;
}

export function touchStoredBuyerPasskeyBundle({ tenantId, email } = {}) {
  const current = loadStoredBuyerPasskeyBundle({ tenantId, email });
  if (!current) return null;
  return saveStoredBuyerPasskeyBundle({
    ...current,
    lastUsedAt: new Date().toISOString()
  });
}

export function removeStoredBuyerPasskeyBundle({ tenantId, email } = {}) {
  const id = normalizeBuyerPasskeyStorageId({ tenantId, email });
  if (!id || typeof window === "undefined" || !globalThis.localStorage) return false;
  try {
    const map = readStoredBuyerPasskeyMap();
    if (!Object.prototype.hasOwnProperty.call(map, id)) return false;
    delete map[id];
    writeStoredBuyerPasskeyMap(map);
    return true;
  } catch {
    return false;
  }
}

export function buildHeaders({ tenantId, protocol, apiKey, write = false, idempotencyKey = null } = {}) {
  const headers = {
    "content-type": "application/json",
    "x-proxy-tenant-id": tenantId,
    "x-nooterra-protocol": protocol
  };
  if (write) headers["x-request-id"] = createClientId("req");
  if (apiKey && String(apiKey).trim()) headers.authorization = `Bearer ${String(apiKey).trim()}`;
  if (idempotencyKey) headers["x-idempotency-key"] = idempotencyKey;
  return headers;
}

function looksLikeHtmlDocument(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized.startsWith("<!doctype html") || normalized.startsWith("<html");
}

function createRequestContractError({ response, code, message, details = null } = {}) {
  const error = new Error(message);
  error.status = response?.status ?? null;
  error.code = code;
  error.details = details;
  return error;
}

async function fetchWithRetry(url, options, { maxRetries = 2, baseDelayMs = 500 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      // Only retry on 502, 503, 504 (server errors that may be transient)
      if (response.status >= 502 && response.status <= 504 && attempt < maxRetries) {
        await new Promise(r => setTimeout(r, baseDelayMs * Math.pow(2, attempt)));
        continue;
      }
      return response;
    } catch (err) {
      lastError = err;
      // Retry on network errors (fetch throws on network failure)
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, baseDelayMs * Math.pow(2, attempt)));
        continue;
      }
    }
  }
  throw lastError;
}

export async function requestJson({
  baseUrl,
  pathname,
  method = "GET",
  headers,
  body = null,
  credentials,
  retry = null,
} = {}) {
  const url = `${String(baseUrl).replace(/\/$/, "")}${pathname}`;
  // By default, only retry GET requests to avoid double-mutations.
  // Non-GET requests can opt in by passing retry: true.
  const shouldRetry = retry !== null ? retry : method === "GET";
  const retryOpts = shouldRetry ? { maxRetries: 2, baseDelayMs: 500 } : { maxRetries: 0 };
  try {
    const response = await fetchWithRetry(url, {
      method,
      headers,
      body: body === null ? undefined : JSON.stringify(body),
      ...(credentials ? { credentials } : {})
    }, retryOpts);
    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    if (response.ok) {
      const contentType = String(response.headers.get("content-type") ?? "").toLowerCase();
      if (typeof parsed === "string" && parsed.trim()) {
        if (looksLikeHtmlDocument(parsed)) {
          throw createRequestContractError({
            response,
            code: "CONTROL_PLANE_ROUTE_MISCONFIGURED",
            message: "control plane returned HTML instead of JSON",
            details: {
              baseUrl: String(baseUrl ?? ""),
              pathname: String(pathname ?? ""),
              contentType
            }
          });
        }
        if (!contentType.includes("json")) {
          throw createRequestContractError({
            response,
            code: "CONTROL_PLANE_RESPONSE_NOT_JSON",
            message: "control plane returned a non-JSON success response",
            details: {
              baseUrl: String(baseUrl ?? ""),
              pathname: String(pathname ?? ""),
              contentType
            }
          });
        }
      }
    }
    if (!response.ok) {
      const message =
        parsed && typeof parsed === "object"
          ? String(parsed?.message ?? parsed?.error ?? `HTTP ${response.status}`)
          : String(parsed ?? `HTTP ${response.status}`);
      const error = new Error(message);
      error.status = response.status;
      error.code = parsed && typeof parsed === "object" ? parsed?.code ?? null : null;
      error.details = parsed && typeof parsed === "object" ? parsed?.details ?? null : null;
      throw error;
    }
    return parsed;
  } catch (err) {
    captureFrontendSentryException(err, {
      routePath: typeof window !== "undefined" ? window.location.pathname : null,
      requestUrl: url,
      requestMethod: method
    });
    throw err;
  }
}

export async function requestBinaryJson({
  baseUrl,
  pathname,
  method = "POST",
  headers,
  body,
  credentials
} = {}) {
  const url = `${String(baseUrl).replace(/\/$/, "")}${pathname}`;
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body ?? undefined,
      ...(credentials ? { credentials } : {})
    });
    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    if (!response.ok) {
      const message =
        parsed && typeof parsed === "object"
          ? String(parsed?.message ?? parsed?.error ?? `HTTP ${response.status}`)
          : String(parsed ?? `HTTP ${response.status}`);
      const error = new Error(message);
      error.status = response.status;
      error.code = parsed && typeof parsed === "object" ? parsed?.code ?? null : null;
      error.details = parsed && typeof parsed === "object" ? parsed?.details ?? null : null;
      throw error;
    }
    return parsed;
  } catch (err) {
    captureFrontendSentryException(err, {
      routePath: typeof window !== "undefined" ? window.location.pathname : null,
      requestUrl: url,
      requestMethod: method
    });
    throw err;
  }
}

export function createClientId(prefix = "ui") {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function parseCapabilityList(rawValue) {
  const seen = new Set();
  const out = [];
  for (const raw of String(rawValue ?? "").split(/\r?\n|,/)) {
    const value = raw.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function formatDateTime(value) {
  const ms = Date.parse(String(value ?? ""));
  if (!Number.isFinite(ms)) return "n/a";
  return new Date(ms).toLocaleString();
}

export function formatCurrency(amountCents, currency = "USD") {
  const amount = Number(amountCents ?? 0);
  if (!Number.isFinite(amount)) return "n/a";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: String(currency || "USD").toUpperCase(),
      maximumFractionDigits: 2
    }).format(amount / 100);
  } catch {
    return `${String(currency || "USD").toUpperCase()} ${(amount / 100).toFixed(2)}`;
  }
}

export function abbreviateHash(value, length = 12) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "n/a";
  return normalized.length <= length ? normalized : `${normalized.slice(0, length)}…`;
}

export function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

export async function sha256HexUtf8(text) {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text ?? "")));
  return Array.from(new Uint8Array(buffer), (value) => value.toString(16).padStart(2, "0")).join("");
}

export function canonicalJsonStringify(value) {
  return JSON.stringify(canonicalize(value));
}

export async function generateBrowserEd25519KeypairPem() {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto is not available in this browser");
  const keypair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKeyPem = arrayBufferToPem(await crypto.subtle.exportKey("spki", keypair.publicKey), "PUBLIC KEY");
  const privateKeyPem = arrayBufferToPem(await crypto.subtle.exportKey("pkcs8", keypair.privateKey), "PRIVATE KEY");
  const keyId = `key_${(await sha256HexUtf8(publicKeyPem)).slice(0, 24)}`;
  return { publicKeyPem, privateKeyPem, keyId };
}

export async function signBrowserPasskeyChallengeBase64Url({ privateKeyPem, challenge } = {}) {
  const normalizedPrivateKeyPem = String(privateKeyPem ?? "").trim();
  const normalizedChallenge = String(challenge ?? "").trim();
  if (!normalizedPrivateKeyPem) throw new Error("privateKeyPem is required");
  if (!normalizedChallenge) throw new Error("challenge is required");
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto is not available in this browser");
  const importedKey = await crypto.subtle.importKey("pkcs8", pemToArrayBuffer(normalizedPrivateKeyPem), { name: "Ed25519" }, false, ["sign"]);
  const signatureBytes = await crypto.subtle.sign("Ed25519", importedKey, new TextEncoder().encode(normalizedChallenge));
  return toBase64Url(new Uint8Array(signatureBytes));
}

export async function buildAgentCardPublishSignature({
  tenantId,
  requestBody,
  signerKeyId,
  privateKeyPem,
  signedAt = new Date().toISOString()
} = {}) {
  const normalizedBody = normalizeForCanonicalJson({
    schemaVersion: "AgentCardPublishPayload.v1",
    tenantId: String(tenantId ?? "").trim(),
    agentId: String(requestBody?.agentId ?? "").trim(),
    displayName: requestBody?.displayName ?? null,
    description: requestBody?.description ?? null,
    capabilities: requestBody?.capabilities ?? null,
    visibility: requestBody?.visibility ?? null,
    executionCoordinatorDid: requestBody?.executionCoordinatorDid ?? null,
    host: requestBody?.host ?? null,
    priceHint: requestBody?.priceHint ?? null,
    attestations: requestBody?.attestations ?? null,
    tools: requestBody?.tools ?? null,
    policyCompatibility: requestBody?.policyCompatibility ?? null,
    tags: requestBody?.tags ?? null,
    metadata: requestBody?.metadata ?? null
  });
  const payloadHash = await sha256HexUtf8(canonicalJsonStringify(normalizedBody));
  const importedKey = await crypto.subtle.importKey("pkcs8", pemToArrayBuffer(privateKeyPem), { name: "Ed25519" }, false, ["sign"]);
  const signatureBytes = await crypto.subtle.sign("Ed25519", importedKey, hexToUint8Array(payloadHash));
  return {
    schemaVersion: "AgentCardPublish.v1",
    algorithm: "ed25519",
    signerKeyId: String(signerKeyId ?? "").trim(),
    signedAt: new Date(Date.parse(signedAt)).toISOString(),
    payloadHash,
    signature: toBase64(new Uint8Array(signatureBytes))
  };
}

export async function buildEd25519JwksFromPublicKeyPem(publicKeyPem) {
  const pem = String(publicKeyPem ?? "").trim();
  if (!pem) throw new Error("publicKeyPem is required");
  const importedKey = await crypto.subtle.importKey("spki", pemToArrayBuffer(pem), { name: "Ed25519" }, true, ["verify"]);
  const exported = await crypto.subtle.exportKey("jwk", importedKey);
  const jwk = canonicalize({
    kty: "OKP",
    crv: "Ed25519",
    x: String(exported?.x ?? "")
  });
  const keyId = `key_${(await sha256HexUtf8(pem)).slice(0, 24)}`;
  const thumbprintSha256 = await sha256HexUtf8(canonicalJsonStringify(jwk));
  return {
    schemaVersion: "NooterraBuilderJwks.v1",
    keyId,
    providerRef: `jwk:${thumbprintSha256}`,
    jwks: {
      keys: [
        {
          ...jwk,
          kid: keyId,
          use: "sig",
          alg: "EdDSA"
        }
      ]
    }
  };
}

export async function mintProviderPublishProofTokenV1({
  providerId,
  manifestHash,
  signerKeyId,
  privateKeyPem,
  publicKeyPem = null,
  nonce = null,
  iat = Math.floor(Date.now() / 1000),
  exp = Math.floor(Date.now() / 1000) + 600
} = {}) {
  const normalizedProviderId = String(providerId ?? "").trim();
  const normalizedManifestHash = String(manifestHash ?? "").trim().toLowerCase();
  if (!normalizedProviderId) throw new Error("providerId is required");
  if (!/^[0-9a-f]{64}$/.test(normalizedManifestHash)) throw new Error("manifestHash must be sha256 hex");
  const normalizedPrivateKeyPem = String(privateKeyPem ?? "").trim();
  if (!normalizedPrivateKeyPem) throw new Error("privateKeyPem is required");
  const derivedKeyId = publicKeyPem ? `key_${(await sha256HexUtf8(String(publicKeyPem).trim())).slice(0, 24)}` : "";
  const normalizedSignerKeyId = String(signerKeyId ?? "").trim() || derivedKeyId;
  if (!normalizedSignerKeyId) throw new Error("signerKeyId is required");
  if (derivedKeyId && normalizedSignerKeyId !== derivedKeyId) throw new Error("signerKeyId does not match publicKeyPem");
  const normalizedIat = Number(iat);
  const normalizedExp = Number(exp);
  if (!Number.isSafeInteger(normalizedIat) || normalizedIat <= 0) throw new Error("iat must be a positive safe integer");
  if (!Number.isSafeInteger(normalizedExp) || normalizedExp <= normalizedIat) throw new Error("exp must be greater than iat");

  const payload = canonicalize({
    schemaVersion: "ProviderPublishProofPayload.v1",
    aud: "nooterra.marketplace.publish",
    typ: "nooterra.marketplace.publish_proof.v1",
    manifestHash: normalizedManifestHash,
    providerId: normalizedProviderId,
    iat: normalizedIat,
    exp: normalizedExp,
    ...(String(nonce ?? "").trim() ? { nonce: String(nonce).trim() } : {})
  });
  const header = canonicalize({
    alg: "EdDSA",
    kid: normalizedSignerKeyId,
    typ: "JWT"
  });
  const headerB64 = toBase64Url(new TextEncoder().encode(canonicalJsonStringify(header)));
  const payloadB64 = toBase64Url(new TextEncoder().encode(canonicalJsonStringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const importedKey = await crypto.subtle.importKey("pkcs8", pemToArrayBuffer(normalizedPrivateKeyPem), { name: "Ed25519" }, false, ["sign"]);
  const signatureBytes = await crypto.subtle.sign("Ed25519", importedKey, new TextEncoder().encode(signingInput));
  const token = `${signingInput}.${toBase64Url(new Uint8Array(signatureBytes))}`;
  return {
    token,
    tokenSha256: await sha256HexUtf8(token),
    header,
    payload,
    kid: normalizedSignerKeyId
  };
}

function resolveRuntimeConfig(runtime) {
  const fallback = loadRuntimeConfig();
  if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) return fallback;
  return {
    ...fallback,
    ...runtime,
    baseUrl: typeof runtime.baseUrl === "string" && runtime.baseUrl.trim() ? runtime.baseUrl.trim() : fallback.baseUrl,
    authBaseUrl:
      typeof runtime.authBaseUrl === "string" && runtime.authBaseUrl.trim() ? runtime.authBaseUrl.trim() : fallback.authBaseUrl,
    apiKey: typeof runtime.apiKey === "string" ? runtime.apiKey : fallback.apiKey,
    tenantId: typeof runtime.tenantId === "string" && runtime.tenantId.trim() ? runtime.tenantId.trim() : fallback.tenantId,
    protocol: typeof runtime.protocol === "string" && runtime.protocol.trim() ? runtime.protocol.trim() : fallback.protocol
  };
}

function resolveAndValidateRuntime(runtime) {
  const resolved = resolveRuntimeConfig(runtime);
  const tenantId = String(resolved.tenantId ?? "").trim();
  if (!tenantId) throw new Error("tenantId is required");
  return resolved;
}

export async function fetchApprovalInbox(runtime, { status = "pending" } = {}) {
  const resolvedRuntime = resolveRuntimeConfig(runtime);
  const query = new URLSearchParams();
  if (status) query.set("status", String(status).trim());
  return requestJson({
    baseUrl: resolvedRuntime.baseUrl,
    pathname: `/approval-inbox${query.size ? `?${query.toString()}` : ""}`,
    method: "GET",
    headers: buildHeaders(resolvedRuntime)
  });
}

export async function decideApprovalInboxItem(runtime, requestId, { approved, note = "", evidenceRefs = [], metadata = null } = {}) {
  const resolvedRuntime = resolveRuntimeConfig(runtime);
  const normalizedRequestId = String(requestId ?? "").trim();
  const normalizedNote = String(note ?? "").trim();
  const normalizedMetadata =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? { ...metadata }
      : { source: "dashboard.approvals" };
  if (normalizedNote) {
    normalizedMetadata.note = normalizedNote;
    normalizedMetadata.rationale = normalizedNote;
  }
  return requestJson({
    baseUrl: resolvedRuntime.baseUrl,
    pathname: `/approval-inbox/${encodeURIComponent(normalizedRequestId)}/decide`,
    method: "POST",
    headers: buildHeaders({
      ...resolvedRuntime,
      write: true,
      idempotencyKey: createClientId(approved ? "approval_approve" : "approval_deny")
    }),
    body: {
      requestId: normalizedRequestId,
      approved: Boolean(approved),
      decision: approved ? "approved" : "denied",
      note: normalizedNote || null,
      rationale: normalizedNote || null,
      decidedBy: resolvedRuntime.tenantId || "tenant_default",
      evidenceRefs: Array.isArray(evidenceRefs)
        ? evidenceRefs.map((value) => String(value ?? "").trim()).filter(Boolean)
        : [],
      metadata: normalizedMetadata
    }
  });
}

export async function fetchApprovalPolicies(runtime) {
  const resolvedRuntime = resolveRuntimeConfig(runtime);
  return requestJson({
    baseUrl: resolvedRuntime.baseUrl,
    pathname: "/approval-policies",
    method: "GET",
    headers: buildHeaders(resolvedRuntime)
  });
}

export async function upsertApprovalPolicy(runtime, policy) {
  const resolvedRuntime = resolveRuntimeConfig(runtime);
  return requestJson({
    baseUrl: resolvedRuntime.baseUrl,
    pathname: "/approval-policies",
    method: "POST",
    headers: buildHeaders({
      ...resolvedRuntime,
      write: true,
      idempotencyKey: createClientId("approval_policy")
    }),
    body: policy
  });
}

export async function fetchTenantSettings(runtime) {
  const resolvedRuntime = resolveAndValidateRuntime(runtime);
  return requestJson({
    baseUrl: resolvedRuntime.authBaseUrl,
    pathname: `/v1/tenants/${encodeURIComponent(resolvedRuntime.tenantId)}/settings`,
    method: "GET",
    credentials: "include"
  });
}

export async function updateTenantSettings(runtime, patch) {
  const resolvedRuntime = resolveAndValidateRuntime(runtime);
  return requestJson({
    baseUrl: resolvedRuntime.authBaseUrl,
    pathname: `/v1/tenants/${encodeURIComponent(resolvedRuntime.tenantId)}/settings`,
    method: "PUT",
    credentials: "include",
    body: patch
  });
}

export async function fetchTenantConsumerInboxState(runtime) {
  const resolvedRuntime = resolveAndValidateRuntime(runtime);
  return requestJson({
    baseUrl: resolvedRuntime.authBaseUrl,
    pathname: `/v1/tenants/${encodeURIComponent(resolvedRuntime.tenantId)}/settings/consumer-inbox`,
    method: "GET",
    credentials: "include"
  });
}

export async function updateTenantConsumerInboxState(runtime, state) {
  const resolvedRuntime = resolveAndValidateRuntime(runtime);
  return requestJson({
    baseUrl: resolvedRuntime.authBaseUrl,
    pathname: `/v1/tenants/${encodeURIComponent(resolvedRuntime.tenantId)}/settings/consumer-inbox`,
    method: "PUT",
    credentials: "include",
    body: state
  });
}

export async function fetchTenantIntegrationsState(runtime) {
  const resolvedRuntime = resolveAndValidateRuntime(runtime);
  return requestJson({
    baseUrl: resolvedRuntime.authBaseUrl,
    pathname: `/v1/tenants/${encodeURIComponent(resolvedRuntime.tenantId)}/integrations/state`,
    method: "GET",
    credentials: "include"
  });
}

export async function disconnectTenantIntegration(runtime, provider) {
  const resolvedRuntime = resolveAndValidateRuntime(runtime);
  const normalizedProvider = String(provider ?? "").trim().toLowerCase();
  if (!normalizedProvider) throw new Error("provider is required");
  return requestJson({
    baseUrl: resolvedRuntime.authBaseUrl,
    pathname: `/v1/tenants/${encodeURIComponent(resolvedRuntime.tenantId)}/integrations/${encodeURIComponent(normalizedProvider)}/disconnect`,
    method: "POST",
    credentials: "include",
    body: {}
  });
}

export async function fetchTenantDocuments(runtime, { includeRevoked = false, limit = 50 } = {}) {
  const resolvedRuntime = resolveAndValidateRuntime(runtime);
  const query = new URLSearchParams();
  if (includeRevoked) query.set("includeRevoked", "true");
  if (Number.isSafeInteger(Number(limit)) && Number(limit) > 0) query.set("limit", String(Math.min(Number(limit), 200)));
  return requestJson({
    baseUrl: resolvedRuntime.authBaseUrl,
    pathname: `/v1/tenants/${encodeURIComponent(resolvedRuntime.tenantId)}/documents${query.size ? `?${query.toString()}` : ""}`,
    method: "GET",
    credentials: "include"
  });
}

export async function uploadTenantDocument(
  runtime,
  file,
  {
    purpose = "",
    label = ""
  } = {}
) {
  const resolvedRuntime = resolveAndValidateRuntime(runtime);
  if (!(file instanceof Blob)) throw new Error("file is required");
  const headers = {};
  const contentType = typeof file.type === "string" && file.type.trim() ? file.type.trim() : "application/octet-stream";
  headers["content-type"] = contentType;
  if (typeof file.name === "string" && file.name.trim()) headers["x-upload-filename"] = file.name.trim();
  if (String(purpose).trim()) headers["x-upload-purpose"] = String(purpose).trim();
  if (String(label).trim()) headers["x-upload-label"] = String(label).trim();
  return requestBinaryJson({
    baseUrl: resolvedRuntime.authBaseUrl,
    pathname: `/v1/tenants/${encodeURIComponent(resolvedRuntime.tenantId)}/documents`,
    method: "POST",
    headers,
    body: file,
    credentials: "include"
  });
}

export async function revokeTenantDocument(runtime, documentId, { reason = "USER_REVOKED_DOCUMENT" } = {}) {
  const resolvedRuntime = resolveAndValidateRuntime(runtime);
  const normalizedDocumentId = String(documentId ?? "").trim();
  if (!normalizedDocumentId) throw new Error("documentId is required");
  return requestJson({
    baseUrl: resolvedRuntime.authBaseUrl,
    pathname: `/v1/tenants/${encodeURIComponent(resolvedRuntime.tenantId)}/documents/${encodeURIComponent(normalizedDocumentId)}/revoke`,
    method: "POST",
    credentials: "include",
    body: {
      reason: String(reason ?? "").trim() || "USER_REVOKED_DOCUMENT"
    }
  });
}

export async function fetchTenantBrowserStates(runtime, { includeRevoked = false, limit = 50 } = {}) {
  const resolvedRuntime = resolveAndValidateRuntime(runtime);
  const query = new URLSearchParams();
  if (includeRevoked) query.set("includeRevoked", "true");
  if (Number.isSafeInteger(Number(limit)) && Number(limit) > 0) query.set("limit", String(Math.min(Number(limit), 200)));
  return requestJson({
    baseUrl: resolvedRuntime.authBaseUrl,
    pathname: `/v1/tenants/${encodeURIComponent(resolvedRuntime.tenantId)}/browser-states${query.size ? `?${query.toString()}` : ""}`,
    method: "GET",
    credentials: "include"
  });
}

export async function createTenantBrowserState(runtime, browserState) {
  const resolvedRuntime = resolveAndValidateRuntime(runtime);
  return requestJson({
    baseUrl: resolvedRuntime.authBaseUrl,
    pathname: `/v1/tenants/${encodeURIComponent(resolvedRuntime.tenantId)}/browser-states`,
    method: "POST",
    credentials: "include",
    body: browserState
  });
}

export async function revokeTenantBrowserState(runtime, stateId, { reason = "USER_WALLET_REVOKE_BROWSER_STATE" } = {}) {
  const resolvedRuntime = resolveAndValidateRuntime(runtime);
  const normalizedStateId = String(stateId ?? "").trim();
  if (!normalizedStateId) throw new Error("stateId is required");
  return requestJson({
    baseUrl: resolvedRuntime.authBaseUrl,
    pathname: `/v1/tenants/${encodeURIComponent(resolvedRuntime.tenantId)}/browser-states/${encodeURIComponent(normalizedStateId)}/revoke`,
    method: "POST",
    credentials: "include",
    body: {
      reason: String(reason ?? "").trim() || "USER_WALLET_REVOKE_BROWSER_STATE"
    }
  });
}

export async function fetchTenantConsumerConnectors(runtime, { kind = null, includeRevoked = false, limit = 50 } = {}) {
  const resolvedRuntime = resolveAndValidateRuntime(runtime);
  const query = new URLSearchParams();
  if (kind && String(kind).trim()) query.set("kind", String(kind).trim());
  if (includeRevoked) query.set("includeRevoked", "true");
  if (Number.isSafeInteger(Number(limit)) && Number(limit) > 0) query.set("limit", String(Math.min(Number(limit), 200)));
  return requestJson({
    baseUrl: resolvedRuntime.authBaseUrl,
    pathname: `/v1/tenants/${encodeURIComponent(resolvedRuntime.tenantId)}/consumer-connectors${query.size ? `?${query.toString()}` : ""}`,
    method: "GET",
    credentials: "include"
  });
}

export async function createTenantConsumerConnector(runtime, connector) {
  const resolvedRuntime = resolveAndValidateRuntime(runtime);
  return requestJson({
    baseUrl: resolvedRuntime.authBaseUrl,
    pathname: `/v1/tenants/${encodeURIComponent(resolvedRuntime.tenantId)}/consumer-connectors`,
    method: "POST",
    credentials: "include",
    body: connector
  });
}

export async function revokeTenantConsumerConnector(runtime, connectorId, { reason = "USER_WALLET_REVOKE_CONNECTOR" } = {}) {
  const resolvedRuntime = resolveAndValidateRuntime(runtime);
  const normalizedConnectorId = String(connectorId ?? "").trim();
  if (!normalizedConnectorId) throw new Error("connectorId is required");
  return requestJson({
    baseUrl: resolvedRuntime.authBaseUrl,
    pathname: `/v1/tenants/${encodeURIComponent(resolvedRuntime.tenantId)}/consumer-connectors/${encodeURIComponent(normalizedConnectorId)}/revoke`,
    method: "POST",
    credentials: "include",
    body: {
      reason: String(reason ?? "").trim() || "USER_WALLET_REVOKE_CONNECTOR"
    }
  });
}

export function buildTenantConsumerConnectorOauthStartUrl(
  runtime,
  { kind, provider, returnTo = null, accountAddressHint = null, accountLabelHint = null, timezone = null } = {}
) {
  const resolvedRuntime = resolveAndValidateRuntime(runtime);
  const normalizedKind = String(kind ?? "").trim().toLowerCase();
  const normalizedProvider = String(provider ?? "").trim().toLowerCase();
  if (!normalizedKind) throw new Error("kind is required");
  if (!normalizedProvider) throw new Error("provider is required");
  const query = new URLSearchParams();
  if (returnTo && String(returnTo).trim()) query.set("returnTo", String(returnTo).trim());
  if (accountAddressHint && String(accountAddressHint).trim()) query.set("accountAddressHint", String(accountAddressHint).trim());
  if (accountLabelHint && String(accountLabelHint).trim()) query.set("accountLabelHint", String(accountLabelHint).trim());
  if (timezone && String(timezone).trim()) query.set("timezone", String(timezone).trim());
  const path = `/v1/tenants/${encodeURIComponent(resolvedRuntime.tenantId)}/consumer-connectors/${encodeURIComponent(normalizedKind)}/${encodeURIComponent(normalizedProvider)}/oauth/start`;
  return `${String(resolvedRuntime.authBaseUrl).replace(/\/$/, "")}${path}${query.size ? `?${query.toString()}` : ""}`;
}

export async function fetchTenantAccountSessions(runtime, { includeRevoked = false, limit = 50 } = {}) {
  const resolvedRuntime = resolveAndValidateRuntime(runtime);
  const query = new URLSearchParams();
  if (includeRevoked) query.set("includeRevoked", "true");
  if (Number.isSafeInteger(Number(limit)) && Number(limit) > 0) query.set("limit", String(Math.min(Number(limit), 200)));
  return requestJson({
    baseUrl: resolvedRuntime.authBaseUrl,
    pathname: `/v1/tenants/${encodeURIComponent(resolvedRuntime.tenantId)}/account-sessions${query.size ? `?${query.toString()}` : ""}`,
    method: "GET",
    credentials: "include"
  });
}

export async function createTenantAccountSession(runtime, session) {
  const resolvedRuntime = resolveAndValidateRuntime(runtime);
  return requestJson({
    baseUrl: resolvedRuntime.authBaseUrl,
    pathname: `/v1/tenants/${encodeURIComponent(resolvedRuntime.tenantId)}/account-sessions`,
    method: "POST",
    credentials: "include",
    body: session
  });
}

export async function revokeTenantAccountSession(runtime, sessionId, { reason = "USER_REVOKED_ACCOUNT_SESSION" } = {}) {
  const resolvedRuntime = resolveAndValidateRuntime(runtime);
  const normalizedSessionId = String(sessionId ?? "").trim();
  if (!normalizedSessionId) throw new Error("sessionId is required");
  return requestJson({
    baseUrl: resolvedRuntime.authBaseUrl,
    pathname: `/v1/tenants/${encodeURIComponent(resolvedRuntime.tenantId)}/account-sessions/${encodeURIComponent(normalizedSessionId)}/revoke`,
    method: "POST",
    credentials: "include",
    body: {
      reason: String(reason ?? "").trim() || "USER_REVOKED_ACCOUNT_SESSION"
    }
  });
}

export async function fetchTenantBuyerNotificationPreview(runtime) {
  const resolvedRuntime = resolveAndValidateRuntime(runtime);
  return requestJson({
    baseUrl: resolvedRuntime.authBaseUrl,
    pathname: `/v1/tenants/${encodeURIComponent(resolvedRuntime.tenantId)}/settings/buyer-notifications/preview`,
    method: "GET",
    credentials: "include"
  });
}

export async function sendTenantBuyerNotificationTest(runtime) {
  const resolvedRuntime = resolveAndValidateRuntime(runtime);
  return requestJson({
    baseUrl: resolvedRuntime.authBaseUrl,
    pathname: `/v1/tenants/${encodeURIComponent(resolvedRuntime.tenantId)}/settings/buyer-notifications/test`,
    method: "POST",
    credentials: "include"
  });
}

export async function previewTenantBuyerProductNotification(runtime, payload) {
  const resolvedRuntime = resolveAndValidateRuntime(runtime);
  return requestJson({
    baseUrl: resolvedRuntime.authBaseUrl,
    pathname: `/v1/tenants/${encodeURIComponent(resolvedRuntime.tenantId)}/settings/buyer-notifications/product-event/preview`,
    method: "POST",
    credentials: "include",
    body: payload
  });
}

export async function sendTenantBuyerProductNotification(runtime, payload) {
  const resolvedRuntime = resolveAndValidateRuntime(runtime);
  return requestJson({
    baseUrl: resolvedRuntime.authBaseUrl,
    pathname: `/v1/tenants/${encodeURIComponent(resolvedRuntime.tenantId)}/settings/buyer-notifications/product-event/send`,
    method: "POST",
    credentials: "include",
    body: payload
  });
}

export async function fetchWorkOrderReceipts(
  runtime,
  {
    receiptId = "",
    workOrderId = "",
    principalAgentId = "",
    subAgentId = "",
    status = "",
    limit = 100,
    offset = 0
  } = {}
) {
  const resolvedRuntime = resolveRuntimeConfig(runtime);
  const query = new URLSearchParams();
  if (String(receiptId).trim()) query.set("receiptId", String(receiptId).trim());
  if (String(workOrderId).trim()) query.set("workOrderId", String(workOrderId).trim());
  if (String(principalAgentId).trim()) query.set("principalAgentId", String(principalAgentId).trim());
  if (String(subAgentId).trim()) query.set("subAgentId", String(subAgentId).trim());
  if (String(status).trim()) query.set("status", String(status).trim());
  if (Number.isSafeInteger(Number(limit)) && Number(limit) > 0) query.set("limit", String(limit));
  if (Number.isSafeInteger(Number(offset)) && Number(offset) >= 0) query.set("offset", String(offset));
  return requestJson({
    baseUrl: resolvedRuntime.baseUrl,
    pathname: `/work-orders/receipts${query.size ? `?${query.toString()}` : ""}`,
    method: "GET",
    headers: buildHeaders(resolvedRuntime)
  });
}

export async function fetchWorkOrderReceiptDetail(runtime, receiptId) {
  const resolvedRuntime = resolveRuntimeConfig(runtime);
  const normalizedReceiptId = String(receiptId ?? "").trim();
  if (!normalizedReceiptId) throw new Error("receiptId is required");
  return requestJson({
    baseUrl: resolvedRuntime.baseUrl,
    pathname: `/work-orders/receipts/${encodeURIComponent(normalizedReceiptId)}`,
    method: "GET",
    headers: buildHeaders(resolvedRuntime)
  });
}

export async function fetchRouterLaunchStatus(runtime, launchId) {
  const resolvedRuntime = resolveRuntimeConfig(runtime);
  const normalizedLaunchId = String(launchId ?? "").trim();
  if (!normalizedLaunchId) throw new Error("launchId is required");
  return requestJson({
    baseUrl: resolvedRuntime.baseUrl,
    pathname: `/router/launches/${encodeURIComponent(normalizedLaunchId)}/status`,
    method: "GET",
    headers: buildHeaders(resolvedRuntime)
  });
}

export async function fetchRunDetail(runtime, runId) {
  const resolvedRuntime = resolveRuntimeConfig(runtime);
  const normalizedRunId = String(runId ?? "").trim();
  if (!normalizedRunId) throw new Error("runId is required");
  return requestJson({
    baseUrl: resolvedRuntime.baseUrl,
    pathname: `/runs/${encodeURIComponent(normalizedRunId)}`,
    method: "GET",
    headers: buildHeaders(resolvedRuntime)
  });
}

export async function respondToRunActionRequired(
  runtime,
  runId,
  {
    providedFields = {},
    providedEvidenceKinds = [],
    evidenceRefs = [],
    note = "",
    respondedAt = null
  } = {}
) {
  const resolvedRuntime = resolveRuntimeConfig(runtime);
  const normalizedRunId = String(runId ?? "").trim();
  if (!normalizedRunId) throw new Error("runId is required");
  return requestJson({
    baseUrl: resolvedRuntime.baseUrl,
    pathname: `/runs/${encodeURIComponent(normalizedRunId)}/action-required/respond`,
    method: "POST",
    headers: buildHeaders({
      ...resolvedRuntime,
      write: true,
      idempotencyKey: createClientId("run_action_response")
    }),
    body: {
      providedFields:
        providedFields && typeof providedFields === "object" && !Array.isArray(providedFields)
          ? { ...providedFields }
          : {},
      providedEvidenceKinds: Array.isArray(providedEvidenceKinds)
        ? providedEvidenceKinds.map((value) => String(value ?? "").trim()).filter(Boolean)
        : [],
      evidenceRefs: Array.isArray(evidenceRefs)
        ? evidenceRefs.map((value) => String(value ?? "").trim()).filter(Boolean)
        : [],
      note: String(note ?? "").trim() || null,
      respondedAt: respondedAt ? String(respondedAt).trim() : null
    }
  });
}

export async function runMarketplaceProviderConformance(
  runtime,
  {
    providerId,
    manifest,
    baseUrl,
    toolId = "",
    providerSigningPublicKeyPem = ""
  } = {}
) {
  const resolvedRuntime = resolveRuntimeConfig(runtime);
  return requestJson({
    baseUrl: resolvedRuntime.baseUrl,
    pathname: "/marketplace/providers/conformance/run",
    method: "POST",
    headers: buildHeaders({
      ...resolvedRuntime,
      write: true,
      idempotencyKey: createClientId("provider_conformance")
    }),
    body: {
      providerId,
      manifest,
      baseUrl,
      ...(String(toolId).trim() ? { toolId: String(toolId).trim() } : {}),
      ...(String(providerSigningPublicKeyPem).trim() ? { providerSigningPublicKeyPem: String(providerSigningPublicKeyPem).trim() } : {})
    }
  });
}

export async function publishMarketplaceProvider(
  runtime,
  {
    providerId,
    manifest,
    baseUrl,
    runConformance = true,
    toolId = "",
    providerSigningPublicKeyPem = "",
    tags = [],
    description = "",
    contactUrl = "",
    termsUrl = "",
    publishProof,
    publishProofJwksUrl
  } = {}
) {
  const resolvedRuntime = resolveRuntimeConfig(runtime);
  return requestJson({
    baseUrl: resolvedRuntime.baseUrl,
    pathname: "/marketplace/providers/publish",
    method: "POST",
    headers: buildHeaders({
      ...resolvedRuntime,
      write: true,
      idempotencyKey: createClientId("provider_publish")
    }),
    body: {
      providerId,
      manifest,
      baseUrl,
      runConformance: runConformance !== false,
      ...(String(toolId).trim() ? { toolId: String(toolId).trim() } : {}),
      ...(String(providerSigningPublicKeyPem).trim() ? { providerSigningPublicKeyPem: String(providerSigningPublicKeyPem).trim() } : {}),
      ...(Array.isArray(tags) ? { tags: tags.map((value) => String(value ?? "").trim()).filter(Boolean) } : {}),
      ...(String(description).trim() ? { description: String(description).trim() } : {}),
      ...(String(contactUrl).trim() ? { contactUrl: String(contactUrl).trim() } : {}),
      ...(String(termsUrl).trim() ? { termsUrl: String(termsUrl).trim() } : {}),
      publishProof: String(publishProof ?? "").trim(),
      publishProofJwksUrl: String(publishProofJwksUrl ?? "").trim()
    }
  });
}

export async function fetchMarketplaceProviderPublications(
  runtime,
  {
    status = "all",
    providerId = "",
    providerRef = "",
    q = "",
    toolId = "",
    limit = 20,
    offset = 0
  } = {}
) {
  const resolvedRuntime = resolveRuntimeConfig(runtime);
  const query = new URLSearchParams();
  if (String(status).trim()) query.set("status", String(status).trim());
  if (String(providerId).trim()) query.set("providerId", String(providerId).trim());
  if (String(providerRef).trim()) query.set("providerRef", String(providerRef).trim());
  if (String(q).trim()) query.set("q", String(q).trim());
  if (String(toolId).trim()) query.set("toolId", String(toolId).trim());
  if (Number.isSafeInteger(Number(limit)) && Number(limit) > 0) query.set("limit", String(limit));
  if (Number.isSafeInteger(Number(offset)) && Number(offset) >= 0) query.set("offset", String(offset));
  return requestJson({
    baseUrl: resolvedRuntime.baseUrl,
    pathname: `/marketplace/providers${query.size ? `?${query.toString()}` : ""}`,
    method: "GET",
    headers: buildHeaders(resolvedRuntime)
  });
}

export async function fetchMarketplaceProviderPublication(runtime, providerRefOrId) {
  const resolvedRuntime = resolveRuntimeConfig(runtime);
  const normalizedProvider = String(providerRefOrId ?? "").trim();
  if (!normalizedProvider) throw new Error("providerRefOrId is required");
  return requestJson({
    baseUrl: resolvedRuntime.baseUrl,
    pathname: `/marketplace/providers/${encodeURIComponent(normalizedProvider)}`,
    method: "GET",
    headers: buildHeaders(resolvedRuntime)
  });
}

export async function fetchTenantX402WalletPolicies(
  runtime,
  {
    sponsorWalletRef = "",
    sponsorRef = "",
    policyRef = "",
    status = "",
    limit = 200,
    offset = 0
  } = {}
) {
  const resolvedRuntime = resolveRuntimeConfig(runtime);
  const query = new URLSearchParams();
  if (String(sponsorWalletRef).trim()) query.set("sponsorWalletRef", String(sponsorWalletRef).trim());
  if (String(sponsorRef).trim()) query.set("sponsorRef", String(sponsorRef).trim());
  if (String(policyRef).trim()) query.set("policyRef", String(policyRef).trim());
  if (String(status).trim()) query.set("status", String(status).trim());
  if (Number.isSafeInteger(Number(limit)) && Number(limit) > 0) query.set("limit", String(limit));
  if (Number.isSafeInteger(Number(offset)) && Number(offset) >= 0) query.set("offset", String(offset));
  return requestJson({
    baseUrl: resolvedRuntime.baseUrl,
    pathname: `/ops/x402/wallet-policies${query.size ? `?${query.toString()}` : ""}`,
    method: "GET",
    headers: buildHeaders(resolvedRuntime)
  });
}

export async function fetchX402WalletPolicies(
  runtime,
  sponsorWalletRef,
  {
    policyRef = "",
    policyVersion = "",
    status = "",
    limit = 20,
    offset = 0
  } = {}
) {
  const resolvedRuntime = resolveRuntimeConfig(runtime);
  const normalizedWalletRef = String(sponsorWalletRef ?? "").trim();
  if (!normalizedWalletRef) throw new Error("sponsorWalletRef is required");
  const query = new URLSearchParams();
  if (String(policyRef).trim()) query.set("policyRef", String(policyRef).trim());
  if (String(policyVersion).trim()) query.set("policyVersion", String(policyVersion).trim());
  if (String(status).trim()) query.set("status", String(status).trim());
  if (Number.isSafeInteger(Number(limit)) && Number(limit) > 0) query.set("limit", String(limit));
  if (Number.isSafeInteger(Number(offset)) && Number(offset) >= 0) query.set("offset", String(offset));
  return requestJson({
    baseUrl: resolvedRuntime.baseUrl,
    pathname: `/x402/wallets/${encodeURIComponent(normalizedWalletRef)}/policy${query.size ? `?${query.toString()}` : ""}`,
    method: "GET",
    headers: buildHeaders(resolvedRuntime)
  });
}

export async function fetchArbitrationQueue(
  runtime,
  {
    status = "",
    openedSince = "",
    runId = "",
    caseId = "",
    priority = "",
    assignedArbiter = null,
    slaHours = "",
    limit = 50,
    offset = 0
  } = {}
) {
  const resolvedRuntime = resolveRuntimeConfig(runtime);
  const query = new URLSearchParams();
  if (String(status).trim()) query.set("status", String(status).trim());
  if (String(openedSince).trim()) query.set("openedSince", String(openedSince).trim());
  if (String(runId).trim()) query.set("runId", String(runId).trim());
  if (String(caseId).trim()) query.set("caseId", String(caseId).trim());
  if (String(priority).trim()) query.set("priority", String(priority).trim());
  if (assignedArbiter === true) query.set("assignedArbiter", "true");
  if (assignedArbiter === false) query.set("assignedArbiter", "false");
  if (String(slaHours).trim()) query.set("slaHours", String(slaHours).trim());
  if (Number.isSafeInteger(Number(limit)) && Number(limit) > 0) query.set("limit", String(limit));
  if (Number.isSafeInteger(Number(offset)) && Number(offset) >= 0) query.set("offset", String(offset));
  return requestJson({
    baseUrl: resolvedRuntime.baseUrl,
    pathname: `/ops/arbitration/queue${query.size ? `?${query.toString()}` : ""}`,
    method: "GET",
    headers: buildHeaders(resolvedRuntime)
  });
}

export async function fetchDisputeInbox(
  runtime,
  {
    runId = "",
    disputeId = "",
    disputeStatus = "",
    settlementStatus = "",
    limit = 100,
    offset = 0
  } = {}
) {
  const resolvedRuntime = resolveRuntimeConfig(runtime);
  const query = new URLSearchParams();
  if (String(runId).trim()) query.set("runId", String(runId).trim());
  if (String(disputeId).trim()) query.set("disputeId", String(disputeId).trim());
  if (String(disputeStatus).trim()) query.set("disputeStatus", String(disputeStatus).trim());
  if (String(settlementStatus).trim()) query.set("settlementStatus", String(settlementStatus).trim());
  if (Number.isSafeInteger(Number(limit)) && Number(limit) > 0) query.set("limit", String(limit));
  if (Number.isSafeInteger(Number(offset)) && Number(offset) >= 0) query.set("offset", String(offset));
  return requestJson({
    baseUrl: resolvedRuntime.baseUrl,
    pathname: `/disputes${query.size ? `?${query.toString()}` : ""}`,
    method: "GET",
    headers: buildHeaders(resolvedRuntime)
  });
}

export async function fetchDisputeDetail(runtime, disputeId, { caseId = "" } = {}) {
  const resolvedRuntime = resolveRuntimeConfig(runtime);
  const normalizedDisputeId = String(disputeId ?? "").trim();
  if (!normalizedDisputeId) throw new Error("disputeId is required");
  const query = new URLSearchParams();
  if (String(caseId).trim()) query.set("caseId", String(caseId).trim());
  return requestJson({
    baseUrl: resolvedRuntime.baseUrl,
    pathname: `/disputes/${encodeURIComponent(normalizedDisputeId)}${query.size ? `?${query.toString()}` : ""}`,
    method: "GET",
    headers: buildHeaders(resolvedRuntime)
  });
}

export async function fetchAuthorityGrants(
  runtime,
  {
    grantId = "",
    grantHash = "",
    principalId = "",
    granteeAgentId = "",
    includeRevoked = false,
    limit = 100,
    offset = 0
  } = {}
) {
  const resolvedRuntime = resolveRuntimeConfig(runtime);
  const query = new URLSearchParams();
  if (String(grantId).trim()) query.set("grantId", String(grantId).trim());
  if (String(grantHash).trim()) query.set("grantHash", String(grantHash).trim());
  if (String(principalId).trim()) query.set("principalId", String(principalId).trim());
  if (String(granteeAgentId).trim()) query.set("granteeAgentId", String(granteeAgentId).trim());
  query.set("includeRevoked", includeRevoked === true ? "true" : "false");
  if (Number.isSafeInteger(Number(limit)) && Number(limit) > 0) query.set("limit", String(limit));
  if (Number.isSafeInteger(Number(offset)) && Number(offset) >= 0) query.set("offset", String(offset));
  return requestJson({
    baseUrl: resolvedRuntime.baseUrl,
    pathname: `/authority-grants${query.size ? `?${query.toString()}` : ""}`,
    method: "GET",
    headers: buildHeaders(resolvedRuntime)
  });
}

export async function revokeAuthorityGrant(runtime, grantId, { revocationReasonCode = "USER_WALLET_REVOKE" } = {}) {
  const resolvedRuntime = resolveRuntimeConfig(runtime);
  const normalizedGrantId = String(grantId ?? "").trim();
  if (!normalizedGrantId) throw new Error("grantId is required");
  return requestJson({
    baseUrl: resolvedRuntime.baseUrl,
    pathname: `/authority-grants/${encodeURIComponent(normalizedGrantId)}/revoke`,
    method: "POST",
    headers: buildHeaders({
      ...resolvedRuntime,
      write: true,
      idempotencyKey: createClientId("wallet_authority_revoke")
    }),
    body: { revocationReasonCode }
  });
}

export async function fetchDelegationGrants(
  runtime,
  {
    grantId = "",
    grantHash = "",
    delegatorAgentId = "",
    delegateeAgentId = "",
    includeRevoked = false,
    limit = 100,
    offset = 0
  } = {}
) {
  const resolvedRuntime = resolveRuntimeConfig(runtime);
  const query = new URLSearchParams();
  if (String(grantId).trim()) query.set("grantId", String(grantId).trim());
  if (String(grantHash).trim()) query.set("grantHash", String(grantHash).trim());
  if (String(delegatorAgentId).trim()) query.set("delegatorAgentId", String(delegatorAgentId).trim());
  if (String(delegateeAgentId).trim()) query.set("delegateeAgentId", String(delegateeAgentId).trim());
  query.set("includeRevoked", includeRevoked === true ? "true" : "false");
  if (Number.isSafeInteger(Number(limit)) && Number(limit) > 0) query.set("limit", String(limit));
  if (Number.isSafeInteger(Number(offset)) && Number(offset) >= 0) query.set("offset", String(offset));
  return requestJson({
    baseUrl: resolvedRuntime.baseUrl,
    pathname: `/delegation-grants${query.size ? `?${query.toString()}` : ""}`,
    method: "GET",
    headers: buildHeaders(resolvedRuntime)
  });
}

export async function revokeDelegationGrant(runtime, grantId, { reasonCode = "USER_WALLET_REVOKE" } = {}) {
  const resolvedRuntime = resolveRuntimeConfig(runtime);
  const normalizedGrantId = String(grantId ?? "").trim();
  if (!normalizedGrantId) throw new Error("grantId is required");
  return requestJson({
    baseUrl: resolvedRuntime.baseUrl,
    pathname: `/delegation-grants/${encodeURIComponent(normalizedGrantId)}/revoke`,
    method: "POST",
    headers: buildHeaders({
      ...resolvedRuntime,
      write: true,
      idempotencyKey: createClientId("wallet_delegation_revoke")
    }),
    body: { reasonCode }
  });
}

export async function fetchArbitrationWorkspace(runtime, caseId, { slaHours = "" } = {}) {
  const resolvedRuntime = resolveRuntimeConfig(runtime);
  const normalizedCaseId = String(caseId ?? "").trim();
  if (!normalizedCaseId) throw new Error("caseId is required");
  const query = new URLSearchParams();
  if (String(slaHours).trim()) query.set("slaHours", String(slaHours).trim());
  return requestJson({
    baseUrl: resolvedRuntime.baseUrl,
    pathname: `/ops/arbitration/cases/${encodeURIComponent(normalizedCaseId)}/workspace${query.size ? `?${query.toString()}` : ""}`,
    method: "GET",
    headers: buildHeaders(resolvedRuntime)
  });
}

export async function fetchX402WalletBudgets(
  runtime,
  sponsorWalletRef,
  {
    policyRef = "",
    policyVersion = "",
    at = ""
  } = {}
) {
  const resolvedRuntime = resolveRuntimeConfig(runtime);
  const normalizedWalletRef = String(sponsorWalletRef ?? "").trim();
  if (!normalizedWalletRef) throw new Error("sponsorWalletRef is required");
  const query = new URLSearchParams();
  if (String(policyRef).trim()) query.set("policyRef", String(policyRef).trim());
  if (String(policyVersion).trim()) query.set("policyVersion", String(policyVersion).trim());
  if (String(at).trim()) query.set("at", String(at).trim());
  return requestJson({
    baseUrl: resolvedRuntime.baseUrl,
    pathname: `/x402/wallets/${encodeURIComponent(normalizedWalletRef)}/budgets${query.size ? `?${query.toString()}` : ""}`,
    method: "GET",
    headers: buildHeaders(resolvedRuntime)
  });
}

export async function fetchX402WalletLedger(
  runtime,
  sponsorWalletRef,
  {
    agentId = "",
    toolId = "",
    state = "",
    from = "",
    to = "",
    cursor = "",
    limit = 50,
    offset = 0
  } = {}
) {
  const resolvedRuntime = resolveRuntimeConfig(runtime);
  const normalizedWalletRef = String(sponsorWalletRef ?? "").trim();
  if (!normalizedWalletRef) throw new Error("sponsorWalletRef is required");
  const query = new URLSearchParams();
  if (String(agentId).trim()) query.set("agentId", String(agentId).trim());
  if (String(toolId).trim()) query.set("toolId", String(toolId).trim());
  if (String(state).trim()) query.set("state", String(state).trim());
  if (String(from).trim()) query.set("from", String(from).trim());
  if (String(to).trim()) query.set("to", String(to).trim());
  if (String(cursor).trim()) query.set("cursor", String(cursor).trim());
  if (Number.isSafeInteger(Number(limit)) && Number(limit) > 0) query.set("limit", String(limit));
  if (Number.isSafeInteger(Number(offset)) && Number(offset) >= 0) query.set("offset", String(offset));
  return requestJson({
    baseUrl: resolvedRuntime.baseUrl,
    pathname: `/x402/wallets/${encodeURIComponent(normalizedWalletRef)}/ledger${query.size ? `?${query.toString()}` : ""}`,
    method: "GET",
    headers: buildHeaders(resolvedRuntime)
  });
}
