import crypto from "node:crypto";

import { canonicalJsonStringify } from "./internal/canonical-json.js";
import { keyIdFromPublicKeyPem, sha256Hex } from "./internal/crypto.js";
import { buildNooterraPayKeysetV1 } from "./internal/nooterra-keys.js";
import { computeNooterraPayRequestBindingSha256V1, verifyNooterraPayTokenV1 } from "./internal/nooterra-pay-token.js";
import { buildToolProviderQuotePayloadV1, signToolProviderQuoteSignatureV1 } from "./internal/provider-quote-signature.js";
import { signToolProviderSignatureV1 } from "./internal/tool-provider-signature.js";

function assertFn(value, name) {
  if (typeof value !== "function") throw new TypeError(`${name} must be a function`);
  return value;
}

function assertPositiveSafeInt(value, name) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new TypeError(`${name} must be a positive safe integer`);
  return n;
}

function assertNonNegativeSafeInt(value, name) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new TypeError(`${name} must be a non-negative safe integer`);
  return n;
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function sanitizeIdSegment(text, { maxLen = 96 } = {}) {
  const raw = String(text ?? "").trim();
  const safe = raw.replaceAll(/[^A-Za-z0-9:_-]/g, "_").slice(0, maxLen);
  return safe || "unknown";
}

const PROVIDER_QUOTE_HEADER = "x-nooterra-provider-quote";
const PROVIDER_QUOTE_SIGNATURE_HEADER = "x-nooterra-provider-quote-signature";
const DELEGATED_ACCOUNT_SESSION_HEADER = "x-nooterra-account-session-binding";
const DELEGATED_ACCOUNT_SESSION_BROWSER_PROFILE_HEADER = "x-nooterra-account-session-browser-profile";
const TASK_WALLET_HEADER = "x-nooterra-task-wallet";

function toBase64UrlJson(value) {
  return Buffer.from(canonicalJsonStringify(value), "utf8").toString("base64url");
}

function fromBase64UrlJson(value, { name = "value" } = {}) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) throw new TypeError(`${name} must be a non-empty base64url JSON string`);
  let parsed = null;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new TypeError(`${name} must be valid base64url JSON`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError(`${name} must decode to an object`);
  }
  return parsed;
}

function parseCacheControlMaxAgeMs(value, fallbackMs) {
  const raw = typeof value === "string" ? value : "";
  const m = raw.match(/max-age\s*=\s*(\d+)/i);
  if (!m) return fallbackMs;
  const sec = Number(m[1]);
  if (!Number.isSafeInteger(sec) || sec < 0) return fallbackMs;
  return sec * 1000;
}

function normalizeCurrency(value) {
  const raw = typeof value === "string" && value.trim() !== "" ? value : "USD";
  const out = raw.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{2,11}$/.test(out)) throw new TypeError("currency must match ^[A-Z][A-Z0-9_]{2,11}$");
  return out;
}

function normalizeRequestBindingMode(value, { fallback = "none" } = {}) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!raw) return fallback;
  if (raw === "none" || raw === "strict") return raw;
  throw new TypeError("requestBindingMode must be none|strict");
}

function normalizeBooleanLike(value, { fallback = false } = {}) {
  if (value === null || value === undefined || String(value).trim() === "") return fallback;
  const raw = String(value).trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  throw new TypeError("boolean-like value must be 1|0|true|false|yes|no|on|off");
}

function normalizeSpendAuthorizationMode(value, { fallback = "optional" } = {}) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!raw) return fallback;
  if (raw === "optional" || raw === "required") return raw;
  throw new TypeError("spendAuthorizationMode must be optional|required");
}

function parseVerificationCode(err) {
  const code = typeof err?.code === "string" && err.code.trim() !== "" ? err.code.trim() : "NOOTERRA_PAY_VERIFICATION_ERROR";
  return code;
}

function toHeaderObject(headers) {
  const out = {};
  if (!headers) return out;
  if (headers instanceof Headers) {
    for (const [k, v] of headers.entries()) out[k] = String(v);
    return out;
  }
  if (typeof headers === "object" && !Array.isArray(headers)) {
    for (const [k, v] of Object.entries(headers)) {
      if (v === undefined || v === null) continue;
      out[k] = String(v);
    }
  }
  return out;
}

function toBodyBuffer(body) {
  if (body === undefined || body === null) {
    return { bodyBuffer: Buffer.from("", "utf8"), contentType: "application/json; charset=utf-8" };
  }
  if (Buffer.isBuffer(body)) return { bodyBuffer: Buffer.from(body), contentType: "application/octet-stream" };
  if (body instanceof Uint8Array) return { bodyBuffer: Buffer.from(body), contentType: "application/octet-stream" };
  if (typeof body === "string") return { bodyBuffer: Buffer.from(body, "utf8"), contentType: "text/plain; charset=utf-8" };
  return {
    bodyBuffer: Buffer.from(canonicalJsonStringify(body), "utf8"),
    contentType: "application/json; charset=utf-8"
  };
}

function methodSupportsBody(method) {
  const m = String(method ?? "GET").toUpperCase();
  return m !== "GET" && m !== "HEAD";
}

async function readRequestBodyBuffer(req, { maxBytes = 1_000_000 } = {}) {
  const limit = assertPositiveSafeInt(maxBytes, "maxRequestBodyBytes");
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > limit) {
      const err = new Error(`request body exceeds maxRequestBodyBytes (${limit})`);
      err.code = "NOOTERRA_PAY_REQUEST_BODY_TOO_LARGE";
      throw err;
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

function computeRequestBindingSha256({ req, url, bodyBuffer }) {
  const method = String(req?.method ?? "GET").toUpperCase();
  const host = String(req?.headers?.host ?? url?.host ?? "").trim().toLowerCase();
  const pathWithQuery = `${url?.pathname ?? "/"}${url?.search ?? ""}`;
  const bodySha256 = sha256Hex(Buffer.isBuffer(bodyBuffer) ? bodyBuffer : Buffer.from("", "utf8"));
  return computeNooterraPayRequestBindingSha256V1({ method, host, pathWithQuery, bodySha256 });
}

function normalizeExecutionResult(raw) {
  const isEnvelope =
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    !Buffer.isBuffer(raw) &&
    !(raw instanceof Uint8Array) &&
    (Object.hasOwn(raw, "body") || Object.hasOwn(raw, "statusCode") || Object.hasOwn(raw, "headers") || Object.hasOwn(raw, "contentType"));
  if (!isEnvelope) {
    return {
      statusCode: 200,
      headers: {},
      body: raw,
      contentType: null
    };
  }

  return {
    statusCode: Number.isSafeInteger(Number(raw.statusCode)) ? Number(raw.statusCode) : 200,
    headers: toHeaderObject(raw.headers),
    body: raw.body,
    contentType: typeof raw.contentType === "string" && raw.contentType.trim() !== "" ? raw.contentType.trim() : null
  };
}

function resolveFetch(fetchImpl) {
  if (typeof fetchImpl === "function") return fetchImpl;
  if (typeof globalThis.fetch === "function") return globalThis.fetch.bind(globalThis);
  throw new TypeError("fetch implementation is required");
}

function sendJson(res, { statusCode = 200, headers = {}, payload }) {
  const h = {
    ...headers,
    "content-type": "application/json; charset=utf-8"
  };
  res.writeHead(statusCode, h);
  res.end(JSON.stringify(payload));
}

function defaultProviderIdForRequest(req) {
  const host = typeof req?.headers?.host === "string" && req.headers.host.trim() !== "" ? req.headers.host.trim() : "provider";
  return `provider_${sanitizeIdSegment(host)}`;
}

export function parseNooterraPayAuthorizationHeader(authorizationHeaderRaw) {
  const authorizationHeader = typeof authorizationHeaderRaw === "string" ? authorizationHeaderRaw.trim() : "";
  if (!authorizationHeader) return null;
  const lower = authorizationHeader.toLowerCase();
  if (!lower.startsWith("nooterrapay ")) return null;
  const token = authorizationHeader.slice("nooterrapay ".length).trim();
  return token || null;
}

export function buildDelegatedAccountSessionBindingHeaderValue(binding) {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
    throw new TypeError("binding must be an object");
  }
  const normalized = {
    sessionId: assertNonEmptyString(binding.sessionId, "binding.sessionId").trim(),
    sessionRef: assertNonEmptyString(binding.sessionRef, "binding.sessionRef").trim(),
    providerKey: assertNonEmptyString(binding.providerKey, "binding.providerKey").trim(),
    siteKey: assertNonEmptyString(binding.siteKey, "binding.siteKey").trim(),
    mode: assertNonEmptyString(binding.mode, "binding.mode").trim(),
    accountHandleMasked:
      typeof binding.accountHandleMasked === "string" && binding.accountHandleMasked.trim() !== "" ? binding.accountHandleMasked.trim() : null,
    maxSpendCents: Number.isSafeInteger(Number(binding.maxSpendCents)) ? Number(binding.maxSpendCents) : null,
    currency: typeof binding.currency === "string" && binding.currency.trim() !== "" ? binding.currency.trim().toUpperCase() : null
  };
  return toBase64UrlJson(normalized);
}

export function parseDelegatedAccountSessionBindingHeaderValue(value) {
  const parsed = fromBase64UrlJson(value, { name: DELEGATED_ACCOUNT_SESSION_HEADER });
  return {
    sessionId: assertNonEmptyString(parsed.sessionId, "binding.sessionId").trim(),
    sessionRef: assertNonEmptyString(parsed.sessionRef, "binding.sessionRef").trim(),
    providerKey: assertNonEmptyString(parsed.providerKey, "binding.providerKey").trim(),
    siteKey: assertNonEmptyString(parsed.siteKey, "binding.siteKey").trim(),
    mode: assertNonEmptyString(parsed.mode, "binding.mode").trim(),
    accountHandleMasked:
      typeof parsed.accountHandleMasked === "string" && parsed.accountHandleMasked.trim() !== "" ? parsed.accountHandleMasked.trim() : null,
    maxSpendCents: Number.isSafeInteger(Number(parsed.maxSpendCents)) ? Number(parsed.maxSpendCents) : null,
    currency: typeof parsed.currency === "string" && parsed.currency.trim() !== "" ? parsed.currency.trim().toUpperCase() : null
  };
}

function normalizeDelegatedBrowserProfileHostname(value, { fieldName = "hostname" } = {}) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) throw new TypeError(`${fieldName} is required`);
  if (normalized.length > 253) throw new TypeError(`${fieldName} must be <= 253 chars`);
  if (!/^[a-z0-9.-]+$/.test(normalized) || normalized.startsWith(".") || normalized.endsWith(".")) {
    throw new TypeError(`${fieldName} must be a valid hostname`);
  }
  return normalized;
}

function normalizeDelegatedBrowserProfileUrl(value, { fieldName = "url", allowNull = true } = {}) {
  if (value === undefined || value === null || String(value).trim() === "") {
    if (allowNull) return null;
    throw new TypeError(`${fieldName} is required`);
  }
  let parsed = null;
  try {
    parsed = new URL(String(value).trim());
  } catch {
    throw new TypeError(`${fieldName} must be a valid absolute URL`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new TypeError(`${fieldName} must use http or https`);
  }
  parsed.hash = "";
  return parsed.toString();
}

export function normalizeDelegatedBrowserProfileBinding(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("delegated browser profile binding must be an object");
  }
  const storageStateRef =
    typeof value.storageStateRef === "string" && value.storageStateRef.trim() !== "" ? value.storageStateRef.trim() : null;
  const loginOrigin = normalizeDelegatedBrowserProfileUrl(value.loginOrigin, { fieldName: "loginOrigin", allowNull: true });
  const startUrl = normalizeDelegatedBrowserProfileUrl(value.startUrl, { fieldName: "startUrl", allowNull: true });
  const reviewMode =
    typeof value.reviewMode === "string" && value.reviewMode.trim() !== "" ? value.reviewMode.trim().toLowerCase() : null;
  const allowedDomains = Array.isArray(value.allowedDomains)
    ? Array.from(
        new Set(
          value.allowedDomains.map((row, index) =>
            normalizeDelegatedBrowserProfileHostname(row, { fieldName: `allowedDomains[${index}]` })
          )
        )
      )
    : [];
  if (!storageStateRef && !loginOrigin && !startUrl && allowedDomains.length === 0 && !reviewMode) {
    throw new TypeError("delegated browser profile binding must include at least one browser profile field");
  }
  return {
    storageStateRef,
    loginOrigin,
    startUrl,
    allowedDomains,
    reviewMode
  };
}

export function buildDelegatedBrowserProfileHeaderValue(binding) {
  return toBase64UrlJson(normalizeDelegatedBrowserProfileBinding(binding));
}

export function parseDelegatedBrowserProfileHeaderValue(value) {
  return normalizeDelegatedBrowserProfileBinding(fromBase64UrlJson(value, { name: "delegatedBrowserProfileBinding" }));
}

function normalizeTaskWalletBinding(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("task wallet binding must be an object");
  }
  const schemaVersion = assertNonEmptyString(value.schemaVersion ?? "TaskWallet.v1", "taskWallet.schemaVersion").trim();
  const walletId = assertNonEmptyString(value.walletId, "taskWallet.walletId").trim();
  const tenantId = assertNonEmptyString(value.tenantId, "taskWallet.tenantId").trim();
  const currency =
    typeof value.currency === "string" && value.currency.trim() !== "" ? value.currency.trim().toUpperCase() : "USD";
  const categoryId = typeof value.categoryId === "string" && value.categoryId.trim() !== "" ? value.categoryId.trim() : null;
  const reviewMode = typeof value.reviewMode === "string" && value.reviewMode.trim() !== "" ? value.reviewMode.trim() : null;
  const maxSpendCents = Number.isSafeInteger(Number(value.maxSpendCents)) ? Number(value.maxSpendCents) : null;
  const allowedMerchantScopes = Array.isArray(value.allowedMerchantScopes)
    ? Array.from(new Set(value.allowedMerchantScopes.map((row) => assertNonEmptyString(row, "taskWallet.allowedMerchantScopes[]").trim())))
    : [];
  const allowedSpecialistProfileIds = Array.isArray(value.allowedSpecialistProfileIds)
    ? Array.from(new Set(value.allowedSpecialistProfileIds.map((row) => assertNonEmptyString(row, "taskWallet.allowedSpecialistProfileIds[]").trim())))
    : [];
  const allowedProviderIds = Array.isArray(value.allowedProviderIds)
    ? Array.from(new Set(value.allowedProviderIds.map((row) => assertNonEmptyString(row, "taskWallet.allowedProviderIds[]").trim())))
    : [];
  const evidenceRequirements = Array.isArray(value.evidenceRequirements)
    ? Array.from(new Set(value.evidenceRequirements.map((row) => assertNonEmptyString(row, "taskWallet.evidenceRequirements[]").trim())))
    : [];
  const settlementPolicy =
    value.settlementPolicy && typeof value.settlementPolicy === "object" && !Array.isArray(value.settlementPolicy)
      ? {
          settlementModel:
            typeof value.settlementPolicy.settlementModel === "string" && value.settlementPolicy.settlementModel.trim() !== ""
              ? value.settlementPolicy.settlementModel.trim()
              : null,
          requireEvidenceBeforeFinalize: value.settlementPolicy.requireEvidenceBeforeFinalize !== false,
          allowRefunds: value.settlementPolicy.allowRefunds !== false
        }
      : null;
  return {
    schemaVersion,
    walletId,
    tenantId,
    currency,
    categoryId,
    reviewMode,
    maxSpendCents,
    allowedMerchantScopes,
    allowedSpecialistProfileIds,
    allowedProviderIds,
    evidenceRequirements,
    settlementPolicy
  };
}

export function buildTaskWalletHeaderValue(binding) {
  return toBase64UrlJson(normalizeTaskWalletBinding(binding));
}

export function parseTaskWalletHeaderValue(value) {
  return normalizeTaskWalletBinding(fromBase64UrlJson(value, { name: TASK_WALLET_HEADER }));
}

function normalizeDelegatedBrowserHostname(value, { fieldName = "hostname" } = {}) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) throw new TypeError(`${fieldName} is required`);
  if (normalized.length > 253) throw new TypeError(`${fieldName} must be <= 253 chars`);
  if (!/^[a-z0-9.-]+$/.test(normalized) || normalized.startsWith(".") || normalized.endsWith(".")) {
    throw new TypeError(`${fieldName} must be a valid hostname`);
  }
  return normalized;
}

function normalizeDelegatedBrowserAllowedDomains(value, { fallback = [] } = {}) {
  if (value === undefined || value === null) return [...fallback];
  if (!Array.isArray(value)) throw new TypeError("allowedDomains must be an array");
  return Array.from(new Set(value.map((row, index) => normalizeDelegatedBrowserHostname(row, { fieldName: `allowedDomains[${index}]` }))));
}

function normalizeDelegatedBrowserUrl(value, { fieldName = "url", allowNull = true } = {}) {
  if (value === undefined || value === null || String(value).trim() === "") {
    if (allowNull) return null;
    throw new TypeError(`${fieldName} is required`);
  }
  let parsed = null;
  try {
    parsed = new URL(String(value).trim());
  } catch {
    throw new TypeError(`${fieldName} must be a valid absolute URL`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new TypeError(`${fieldName} must use http or https`);
  }
  parsed.hash = "";
  return parsed.toString();
}

function normalizeDelegatedBrowserSessionRuntimeConfig(raw, { delegatedAccountSession, delegatedBrowserProfile = null } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError("delegated browser session config must be an object");
  }
  const storageStatePath =
    typeof raw.storageStatePath === "string" && raw.storageStatePath.trim() !== "" ? raw.storageStatePath.trim() : null;
  const storageState =
    raw.storageState && typeof raw.storageState === "object" && !Array.isArray(raw.storageState) ? raw.storageState : null;
  const storageStateRef =
    typeof raw.storageStateRef === "string" && raw.storageStateRef.trim() !== "" ? raw.storageStateRef.trim() : null;
  if (!storageStatePath && !storageState && !storageStateRef) {
    throw new TypeError("delegated browser session config must provide storageState, storageStatePath, or storageStateRef");
  }
  const fallbackDomain = Array.isArray(delegatedBrowserProfile?.allowedDomains) && delegatedBrowserProfile.allowedDomains.length > 0
    ? delegatedBrowserProfile.allowedDomains
    : delegatedAccountSession?.siteKey && typeof delegatedAccountSession.siteKey === "string"
      ? [delegatedAccountSession.siteKey]
      : [];
  const allowedDomains = normalizeDelegatedBrowserAllowedDomains(raw.allowedDomains, { fallback: fallbackDomain });
  const loginOrigin = normalizeDelegatedBrowserUrl(raw.loginOrigin ?? delegatedBrowserProfile?.loginOrigin, { fieldName: "loginOrigin", allowNull: true });
  const startUrl = normalizeDelegatedBrowserUrl(raw.startUrl ?? delegatedBrowserProfile?.startUrl, { fieldName: "startUrl", allowNull: true });
  const headless = raw.headless === undefined ? true : Boolean(raw.headless);
  const contextOptions =
    raw.contextOptions && typeof raw.contextOptions === "object" && !Array.isArray(raw.contextOptions) ? { ...raw.contextOptions } : {};
  const launchOptions =
    raw.launchOptions && typeof raw.launchOptions === "object" && !Array.isArray(raw.launchOptions) ? { ...raw.launchOptions } : {};
  return {
    storageStatePath,
    storageState,
    storageStateRef,
    allowedDomains,
    loginOrigin,
    startUrl: startUrl ?? loginOrigin,
    headless,
    contextOptions,
    launchOptions
  };
}

function hostAllowedForDelegatedBrowser(urlText, allowedDomains) {
  if (!Array.isArray(allowedDomains) || allowedDomains.length === 0) return true;
  let parsed = null;
  try {
    parsed = new URL(String(urlText));
  } catch {
    return false;
  }
  const host = String(parsed.hostname ?? "").trim().toLowerCase();
  if (!host) return false;
  return allowedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

export function createPlaywrightDelegatedAccountRuntime({
  resolveSessionRuntime,
  importPlaywright = null,
  launchOptions = {}
} = {}) {
  const resolveSessionRuntimeFn = assertFn(resolveSessionRuntime, "resolveSessionRuntime");
  const importPlaywrightFn =
    typeof importPlaywright === "function"
      ? importPlaywright
      : async () => {
          try {
            return await import("playwright");
          } catch (err) {
            const wrapped = new Error("playwright is required for delegated browser runtime");
            wrapped.code = "DELEGATED_BROWSER_RUNTIME_UNAVAILABLE";
            wrapped.cause = err;
            throw wrapped;
          }
        };

  return async function delegatedAccountRuntimeFactory({
    delegatedAccountSession,
    delegatedBrowserProfile = null,
    req,
    url,
    offer,
    verification
  } = {}) {
    if (!delegatedAccountSession) return null;
    const rawConfig = await resolveSessionRuntimeFn({ delegatedAccountSession, delegatedBrowserProfile, req, url, offer, verification });
    const config = normalizeDelegatedBrowserSessionRuntimeConfig(rawConfig, { delegatedAccountSession, delegatedBrowserProfile });
    return {
      kind: "playwright_delegated_browser_session",
      session: delegatedAccountSession,
      config,
      async withBrowserSession({
        expectedProviderKey = null,
        expectedSiteKey = null,
        allowedModes = ["browser_delegated", "approval_at_boundary", "operator_supervised"],
        action
      } = {}) {
        const actionFn = assertFn(action, "action");
        if (expectedProviderKey && String(delegatedAccountSession.providerKey).trim() !== String(expectedProviderKey).trim()) {
          const err = new Error("delegated account session provider does not match this browser action");
          err.code = "DELEGATED_BROWSER_SESSION_PROVIDER_MISMATCH";
          throw err;
        }
        if (expectedSiteKey && String(delegatedAccountSession.siteKey).trim() !== String(expectedSiteKey).trim()) {
          const err = new Error("delegated account session site does not match this browser action");
          err.code = "DELEGATED_BROWSER_SESSION_SITE_MISMATCH";
          throw err;
        }
        if (Array.isArray(allowedModes) && allowedModes.length > 0 && !allowedModes.includes(delegatedAccountSession.mode)) {
          const err = new Error("delegated account session mode is not allowed for this browser action");
          err.code = "DELEGATED_BROWSER_SESSION_MODE_NOT_ALLOWED";
          throw err;
        }
        const playwright = await importPlaywrightFn();
        const chromium = playwright?.chromium;
        if (!chromium || typeof chromium.launch !== "function") {
          const err = new Error("playwright chromium launcher is unavailable");
          err.code = "DELEGATED_BROWSER_RUNTIME_UNAVAILABLE";
          throw err;
        }
        const browser = await chromium.launch({ headless: config.headless, ...launchOptions, ...config.launchOptions });
        const context = await browser.newContext({
          ...config.contextOptions,
          ...(config.storageState ? { storageState: config.storageState } : {}),
          ...(config.storageStatePath ? { storageState: config.storageStatePath } : {})
        });
        if (Array.isArray(config.allowedDomains) && config.allowedDomains.length > 0 && typeof context.route === "function") {
          await context.route("**/*", async (route) => {
            const requestUrl = typeof route?.request === "function" ? route.request().url() : "";
            if (hostAllowedForDelegatedBrowser(requestUrl, config.allowedDomains)) {
              await route.continue();
              return;
            }
            await route.abort("blockedbyclient");
          });
        }
        const page = typeof context.newPage === "function" ? await context.newPage() : null;
        if (page && config.startUrl && typeof page.goto === "function") {
          await page.goto(config.startUrl);
        }
        try {
          return await actionFn({
            browser,
            context,
            page,
            delegatedAccountSession,
            config,
            offer,
            verification,
            req,
            url
          });
        } finally {
          if (context && typeof context.close === "function") {
            await context.close();
          }
          if (browser && typeof browser.close === "function") {
            await browser.close();
          }
        }
      }
    };
  };
}

function parseWalletBrowserStateRef(value) {
  const normalized = String(value ?? "").trim();
  const match = /^state:\/\/wallet\/([^/]+)\/([A-Za-z0-9_-]{1,64})$/.exec(normalized);
  if (!match) {
    throw new TypeError("storageStateRef must be state://wallet/<tenantId>/<stateId>");
  }
  return {
    tenantId: String(match[1]).trim(),
    stateId: String(match[2]).trim(),
    stateRef: normalized
  };
}

export function createNooterraAuthDelegatedSessionRuntimeResolver({
  authBaseUrl,
  opsToken,
  fetchImpl = null,
  defaultHeadless = true
} = {}) {
  const normalizedAuthBaseUrl = assertNonEmptyString(String(authBaseUrl ?? "").trim(), "authBaseUrl").replace(/\/+$/, "");
  const normalizedOpsToken = assertNonEmptyString(opsToken, "opsToken").trim();
  const upstreamFetch = typeof fetchImpl === "function" ? fetchImpl : globalThis.fetch;
  if (typeof upstreamFetch !== "function") throw new TypeError("fetchImpl must be available");

  return async function resolveDelegatedSessionRuntime({
    delegatedAccountSession,
    delegatedBrowserProfile
  } = {}) {
    const binding = delegatedBrowserProfile ? normalizeDelegatedBrowserProfileBinding(delegatedBrowserProfile) : null;
    if (!binding?.storageStateRef) {
      const err = new Error("delegated browser profile storageStateRef is required");
      err.code = "DELEGATED_BROWSER_PROFILE_STORAGE_STATE_REQUIRED";
      throw err;
    }
    const parsedRef = parseWalletBrowserStateRef(binding.storageStateRef);
    const resolveUrl = new URL(
      `/v1/tenants/${encodeURIComponent(parsedRef.tenantId)}/browser-states/resolve?ref=${encodeURIComponent(parsedRef.stateRef)}`,
      `${normalizedAuthBaseUrl}/`
    );
    let response = null;
    let text = "";
    try {
      response = await upstreamFetch(resolveUrl, {
        method: "GET",
        headers: {
          "x-proxy-tenant-id": parsedRef.tenantId,
          "x-proxy-ops-token": normalizedOpsToken
        },
        redirect: "error"
      });
      text = await response.text();
    } catch (cause) {
      const err = new Error("delegated browser state resolver is unreachable");
      err.code = "DELEGATED_BROWSER_STATE_RESOLVER_UNREACHABLE";
      err.cause = cause;
      throw err;
    }
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!response.ok) {
      const err = new Error(json?.message ?? text ?? "delegated browser state resolver failed");
      err.code = json?.code ?? "DELEGATED_BROWSER_STATE_RESOLVER_ERROR";
      err.statusCode = response.status;
      throw err;
    }
    const browserState =
      json?.browserState && typeof json.browserState === "object" && !Array.isArray(json.browserState) ? json.browserState : null;
    if (!browserState || browserState.stateRef !== parsedRef.stateRef || browserState.revokedAt) {
      const err = new Error("delegated browser state is invalid or revoked");
      err.code = "DELEGATED_BROWSER_STATE_INVALID";
      throw err;
    }
    return {
      storageStateRef: parsedRef.stateRef,
      storageState: browserState.storageState,
      allowedDomains: binding.allowedDomains,
      loginOrigin: binding.loginOrigin,
      startUrl: binding.startUrl,
      headless: defaultHeadless,
      contextOptions: {
        extraHTTPHeaders: {
          "x-nooterra-account-session-provider": delegatedAccountSession?.providerKey ?? "",
          "x-nooterra-account-session-site": delegatedAccountSession?.siteKey ?? ""
        }
      }
    };
  };
}

export function buildPaymentRequiredHeaderValue(offer) {
  const fields = [
    `amountCents=${offer.amountCents}`,
    `currency=${offer.currency}`,
    `providerId=${offer.providerId}`,
    `toolId=${offer.toolId}`,
    `address=${offer.address}`,
    `network=${offer.network}`,
    `requestBindingMode=${offer.requestBindingMode ?? "none"}`
  ];
  if (offer.quoteRequired === true) fields.push("quoteRequired=1");
  if (typeof offer.quoteId === "string" && offer.quoteId.trim() !== "") fields.push(`quoteId=${offer.quoteId.trim()}`);
  if (offer.spendAuthorizationMode === "required") fields.push("spendAuthorizationMode=required");
  return fields.join("; ");
}

export function createInMemoryReplayStore({ maxKeys = 10_000 } = {}) {
  const cap = assertPositiveSafeInt(maxKeys, "maxKeys");
  const rows = new Map();

  function prune(nowMs = Date.now()) {
    for (const [k, row] of rows.entries()) {
      if (!row || !Number.isFinite(row.expiresAtMs) || row.expiresAtMs <= nowMs) rows.delete(k);
    }
    while (rows.size > cap) {
      const oldest = rows.keys().next().value;
      if (!oldest) break;
      rows.delete(oldest);
    }
  }

  return {
    get(key, nowMs = Date.now()) {
      prune(nowMs);
      const row = rows.get(key);
      if (!row || !Number.isFinite(row.expiresAtMs) || row.expiresAtMs <= nowMs) {
        rows.delete(key);
        return null;
      }
      return row;
    },
    set(key, row, nowMs = Date.now()) {
      prune(nowMs);
      rows.set(key, row);
      prune(nowMs);
    },
    prune,
    size() {
      return rows.size;
    }
  };
}

export function createNooterraPayKeysetResolver({
  keysetUrl,
  fetch: fetchImpl = null,
  defaultMaxAgeMs = 300_000,
  fetchTimeoutMs = 3_000,
  pinnedPublicKeyPem = null,
  pinnedKeyId = null,
  pinnedOnly = false,
  pinnedMaxAgeMs = 3_600_000
} = {}) {
  const resolveFetchImpl = resolveFetch(fetchImpl);
  const cache = {
    keyset: null,
    expiresAtMs: 0,
    source: "none"
  };

  const normalizedDefaultMaxAgeMs = assertPositiveSafeInt(defaultMaxAgeMs, "defaultMaxAgeMs");
  const normalizedFetchTimeoutMs = assertPositiveSafeInt(fetchTimeoutMs, "fetchTimeoutMs");
  const normalizedPinnedMaxAgeMs = assertPositiveSafeInt(pinnedMaxAgeMs, "pinnedMaxAgeMs");

  const pinnedKeyset = (() => {
    if (typeof pinnedPublicKeyPem !== "string" || pinnedPublicKeyPem.trim() === "") return null;
    const derivedKid = keyIdFromPublicKeyPem(pinnedPublicKeyPem);
    const kid = typeof pinnedKeyId === "string" && pinnedKeyId.trim() !== "" ? pinnedKeyId.trim() : derivedKid;
    if (kid !== derivedKid) throw new TypeError("pinnedKeyId does not match pinnedPublicKeyPem");
    return buildNooterraPayKeysetV1({
      activeKey: { keyId: kid, publicKeyPem: pinnedPublicKeyPem },
      fallbackKeys: [],
      refreshedAt: new Date().toISOString()
    });
  })();

  async function fetchNooterraKeysetFromUrl() {
    if (typeof keysetUrl !== "string" || keysetUrl.trim() === "") {
      throw new TypeError("keysetUrl is required when pinnedOnly=false");
    }
    const signal = typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(normalizedFetchTimeoutMs) : undefined;
    const res = await resolveFetchImpl(keysetUrl, { method: "GET", ...(signal ? { signal } : {}) });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`keyset fetch failed (${res.status}): ${text || "unknown"}`);
    }
    const keyset = await res.json();
    if (!keyset || typeof keyset !== "object" || Array.isArray(keyset) || !Array.isArray(keyset.keys) || keyset.keys.length === 0) {
      throw new Error("keyset response is invalid");
    }
    const maxAgeMs = parseCacheControlMaxAgeMs(res.headers.get("cache-control"), normalizedDefaultMaxAgeMs);
    return { keyset, maxAgeMs };
  }

  return {
    clearCache() {
      cache.keyset = null;
      cache.expiresAtMs = 0;
      cache.source = "none";
    },
    getSource() {
      return cache.source;
    },
    async getKeyset() {
      const nowMs = Date.now();
      if (cache.keyset && cache.expiresAtMs > nowMs) {
        return { keyset: cache.keyset, source: cache.source };
      }

      if (pinnedOnly) {
        if (!pinnedKeyset) throw new Error("pinnedOnly=true requires pinnedPublicKeyPem");
        cache.keyset = pinnedKeyset;
        cache.expiresAtMs = nowMs + normalizedPinnedMaxAgeMs;
        cache.source = "pinned-only";
        return { keyset: cache.keyset, source: cache.source };
      }

      try {
        const fetched = await fetchNooterraKeysetFromUrl();
        cache.keyset = fetched.keyset;
        cache.expiresAtMs = nowMs + fetched.maxAgeMs;
        cache.source = "well-known";
        return { keyset: cache.keyset, source: cache.source };
      } catch (err) {
        if (!pinnedKeyset) throw err;
        cache.keyset = pinnedKeyset;
        cache.expiresAtMs = nowMs + normalizedPinnedMaxAgeMs;
        cache.source = "pinned-fallback";
        return { keyset: cache.keyset, source: cache.source };
      }
    }
  };
}

function normalizeOffer({ offer, req, url, providerId, providerIdForRequest, paymentAddress, paymentNetwork }) {
  const raw = offer && typeof offer === "object" && !Array.isArray(offer) ? offer : {};
  const amountCents = assertPositiveSafeInt(raw.amountCents, "priceFor().amountCents");
  const currency = normalizeCurrency(raw.currency);
  const idempotency =
    typeof raw.idempotency === "string" && raw.idempotency.trim() !== "" ? raw.idempotency.trim().toLowerCase() : null;
  const implicitBindingMode =
    idempotency === "non_idempotent" || idempotency === "side_effecting"
      ? "strict"
      : "none";
  const requestBindingMode = normalizeRequestBindingMode(raw.requestBindingMode, { fallback: implicitBindingMode });
  const quoteRequired = normalizeBooleanLike(raw.quoteRequired, { fallback: false });
  const quoteId =
    typeof raw.quoteId === "string" && raw.quoteId.trim() !== "" ? raw.quoteId.trim() : null;
  if (quoteId && !/^[A-Za-z0-9:_-]+$/.test(quoteId)) {
    throw new TypeError("priceFor().quoteId must match ^[A-Za-z0-9:_-]+$");
  }
  const spendAuthorizationMode = normalizeSpendAuthorizationMode(raw.spendAuthorizationMode, {
    fallback: quoteRequired ? "required" : "optional"
  });
  const rawProviderId = typeof raw.providerId === "string" && raw.providerId.trim() !== "" ? raw.providerId.trim() : null;
  const configuredProviderId = typeof providerId === "string" && providerId.trim() !== "" ? providerId.trim() : null;
  const providerFromFn =
    typeof providerIdForRequest === "function" ? String(providerIdForRequest({ req, url, offer: raw }) ?? "").trim() || null : null;
  const resolvedProviderId =
    rawProviderId ??
    configuredProviderId ??
    providerFromFn ??
    defaultProviderIdForRequest(req);
  if (!resolvedProviderId) throw new TypeError("providerId is required (option/providerIdForRequest/priceFor().providerId)");
  const toolId =
    typeof raw.toolId === "string" && raw.toolId.trim() !== ""
      ? raw.toolId.trim()
      : `${String(req?.method ?? "GET").toUpperCase()}:${String(url?.pathname ?? "/")}`;

  const address =
    typeof raw.address === "string" && raw.address.trim() !== ""
      ? raw.address.trim()
      : typeof paymentAddress === "string" && paymentAddress.trim() !== ""
        ? paymentAddress.trim()
        : "nooterra:provider";
  const network =
    typeof raw.network === "string" && raw.network.trim() !== ""
      ? raw.network.trim()
      : typeof paymentNetwork === "string" && paymentNetwork.trim() !== ""
        ? paymentNetwork.trim()
        : "nooterra";

  return {
    amountCents,
    currency,
    providerId: resolvedProviderId,
    toolId,
    address,
    network,
    requestBindingMode,
    quoteRequired,
    quoteId,
    spendAuthorizationMode
  };
}

function deriveQuoteId({ offer, req, url, requestBindingSha256 = null } = {}) {
  const seed = canonicalJsonStringify({
    providerId: offer.providerId,
    toolId: offer.toolId,
    amountCents: offer.amountCents,
    currency: offer.currency,
    requestBindingMode: offer.requestBindingMode ?? "none",
    requestBindingSha256: requestBindingSha256 ?? "",
    method: String(req?.method ?? "GET").toUpperCase(),
    pathWithQuery: `${url?.pathname ?? "/"}${url?.search ?? ""}`
  });
  return `pquote_${sha256Hex(seed).slice(0, 32)}`;
}

function buildSignedQuoteChallenge({
  offer,
  req,
  url,
  requestBindingSha256 = null,
  quoteTtlSeconds,
  publicKeyPem,
  privateKeyPem
} = {}) {
  const nowMs = Date.now();
  const quotedAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + quoteTtlSeconds * 1000).toISOString();
  const quoteId =
    typeof offer.quoteId === "string" && offer.quoteId.trim() !== "" ? offer.quoteId.trim() : deriveQuoteId({ offer, req, url, requestBindingSha256 });
  const quote = buildToolProviderQuotePayloadV1({
    providerId: offer.providerId,
    toolId: offer.toolId,
    amountCents: offer.amountCents,
    currency: offer.currency,
    address: offer.address,
    network: offer.network,
    requestBindingMode: offer.requestBindingMode ?? "none",
    requestBindingSha256,
    quoteRequired: offer.quoteRequired === true,
    quoteId,
    spendAuthorizationMode: offer.spendAuthorizationMode ?? "optional",
    quotedAt,
    expiresAt
  });
  const signature = signToolProviderQuoteSignatureV1({
    quote,
    nonce: crypto.randomBytes(16).toString("hex"),
    signedAt: quotedAt,
    publicKeyPem,
    privateKeyPem
  });
  return {
    offer,
    quote,
    signature
  };
}

function sendPaymentRequired(res, { offer, quoteAttestation = null, code = "PAYMENT_REQUIRED", message = "payment required", details = null }) {
  const headerValue = buildPaymentRequiredHeaderValue(offer);
  const quoteHeaders =
    quoteAttestation && quoteAttestation.quote && quoteAttestation.signature
      ? {
          [PROVIDER_QUOTE_HEADER]: toBase64UrlJson(quoteAttestation.quote),
          [PROVIDER_QUOTE_SIGNATURE_HEADER]: toBase64UrlJson(quoteAttestation.signature)
        }
      : {};
  sendJson(res, {
    statusCode: 402,
    headers: {
      "x-payment-required": headerValue,
      "PAYMENT-REQUIRED": headerValue,
      "x-nooterra-payment-error": String(code),
      ...quoteHeaders
    },
    payload: {
      ok: false,
      error: "payment_required",
      code,
      message,
      offer,
      ...(quoteAttestation ? { quote: quoteAttestation.quote } : {}),
      ...(details ? { details } : {})
    }
  });
}

async function verifyNooterraPaymentToken({ token, offer, keysetResolver, expectedRequestBindingSha256 = null }) {
  let keysetResult;
  try {
    keysetResult = await keysetResolver.getKeyset();
  } catch (err) {
    return { ok: false, code: "NOOTERRA_PAY_KEYSET_UNAVAILABLE", message: err?.message ?? String(err ?? "") };
  }
  const keyset = keysetResult?.keyset ?? keysetResult;
  const keysetSource = typeof keysetResult?.source === "string" && keysetResult.source.trim() !== "" ? keysetResult.source : "unknown";

  let verified;
  try {
    verified = verifyNooterraPayTokenV1({ token, keyset, expectedRequestBindingSha256 });
  } catch (err) {
    return { ok: false, code: parseVerificationCode(err), message: err?.message ?? String(err ?? "") };
  }
  if (!verified?.ok) {
    return {
      ok: false,
      code: String(verified?.code ?? "NOOTERRA_PAY_VERIFICATION_ERROR"),
      message: verified?.message ?? "token verification failed",
      details: verified?.payload ? { payload: verified.payload } : null
    };
  }

  const payload = verified.payload ?? {};
  const payloadAud = String(payload.aud ?? "");
  const payloadPayeeProviderId = String(payload.payeeProviderId ?? "");
  if (payloadAud !== offer.providerId || payloadPayeeProviderId !== offer.providerId) {
    return {
      ok: false,
      code: "NOOTERRA_PAY_PROVIDER_MISMATCH",
      message: "token does not match provider offer",
      details: {
        expectedProviderId: offer.providerId,
        aud: payloadAud,
        payeeProviderId: payloadPayeeProviderId
      }
    };
  }

  const payloadAmountCents = Number(payload.amountCents ?? 0);
  if (!Number.isSafeInteger(payloadAmountCents) || payloadAmountCents !== offer.amountCents) {
    return {
      ok: false,
      code: "NOOTERRA_PAY_AMOUNT_MISMATCH",
      message: "token does not match provider offer",
      details: {
        expectedAmountCents: offer.amountCents,
        tokenAmountCents: payloadAmountCents
      }
    };
  }

  const payloadCurrency = String(payload.currency ?? "").toUpperCase();
  if (payloadCurrency !== offer.currency) {
    return {
      ok: false,
      code: "NOOTERRA_PAY_CURRENCY_MISMATCH",
      message: "token does not match provider offer",
      details: {
        expectedCurrency: offer.currency,
        tokenCurrency: payloadCurrency
      }
    };
  }

  const payloadQuoteId = typeof payload.quoteId === "string" ? payload.quoteId.trim() : "";
  if (offer.quoteRequired === true && !payloadQuoteId) {
    return {
      ok: false,
      code: "NOOTERRA_PAY_QUOTE_REQUIRED",
      message: "token is missing required quoteId"
    };
  }
  if (offer.quoteId && payloadQuoteId !== offer.quoteId) {
    return {
      ok: false,
      code: "NOOTERRA_PAY_QUOTE_MISMATCH",
      message: "token quoteId does not match provider offer",
      details: {
        expectedQuoteId: offer.quoteId,
        tokenQuoteId: payloadQuoteId || null
      }
    };
  }

  if (offer.spendAuthorizationMode === "required") {
    const payloadPolicyFingerprint =
      typeof payload.policyFingerprint === "string" ? payload.policyFingerprint.trim().toLowerCase() : "";
    const requiredClaims = [
      ["quoteId", payloadQuoteId],
      ["idempotencyKey", typeof payload.idempotencyKey === "string" ? payload.idempotencyKey.trim() : ""],
      ["nonce", typeof payload.nonce === "string" ? payload.nonce.trim() : ""],
      ["sponsorRef", typeof payload.sponsorRef === "string" ? payload.sponsorRef.trim() : ""],
      ["agentKeyId", typeof payload.agentKeyId === "string" ? payload.agentKeyId.trim() : ""],
      ["policyFingerprint", /^[0-9a-f]{64}$/.test(payloadPolicyFingerprint) ? payloadPolicyFingerprint : ""]
    ];
    const missingClaims = requiredClaims.filter(([, v]) => !v).map(([name]) => name);
    if (missingClaims.length > 0) {
      return {
        ok: false,
        code: "NOOTERRA_PAY_SPEND_AUTH_REQUIRED",
        message: "token is missing required spend-authorization claims",
        details: { missingClaims }
      };
    }
  }

  return {
    ok: true,
    verification: verified,
    keysetSource
  };
}

export function createNooterraPaidNodeHttpHandler({
  providerId = null,
  providerIdForRequest = null,
  priceFor,
  execute,
  providerPublicKeyPem,
  providerPrivateKeyPem,
  paymentAddress = "nooterra:provider",
  paymentNetwork = "nooterra",
  replayStore = null,
  replayTtlBufferMs = 60_000,
  replayMaxKeys = 10_000,
  quoteTtlSeconds = 300,
  keysetResolver = null,
  nooterraPay = {},
  mutateSignature = null
} = {}) {
  const priceForFn = assertFn(priceFor, "priceFor");
  const executeFn = assertFn(execute, "execute");
  const publicKeyPem = assertNonEmptyString(providerPublicKeyPem, "providerPublicKeyPem");
  const privateKeyPem = assertNonEmptyString(providerPrivateKeyPem, "providerPrivateKeyPem");
  const normalizedReplayTtlBufferMs = assertNonNegativeSafeInt(replayTtlBufferMs, "replayTtlBufferMs");
  const normalizedQuoteTtlSeconds = assertPositiveSafeInt(quoteTtlSeconds, "quoteTtlSeconds");
  const signerKeyId = keyIdFromPublicKeyPem(publicKeyPem);
  const maxRequestBodyBytes = (() => {
    if (nooterraPay && typeof nooterraPay === "object" && !Array.isArray(nooterraPay) && nooterraPay.maxRequestBodyBytes !== undefined) {
      return assertPositiveSafeInt(nooterraPay.maxRequestBodyBytes, "nooterraPay.maxRequestBodyBytes");
    }
    return 1_000_000;
  })();
  const replay = replayStore ?? createInMemoryReplayStore({ maxKeys: replayMaxKeys });
  if (!replay || typeof replay.get !== "function" || typeof replay.set !== "function") {
    throw new TypeError("replayStore must implement get(key, nowMs) and set(key, row, nowMs)");
  }

  const resolver =
    keysetResolver && typeof keysetResolver.getKeyset === "function" ? keysetResolver : createNooterraPayKeysetResolver(nooterraPay);
  const requireDelegatedAccountSession =
    nooterraPay && typeof nooterraPay === "object" && !Array.isArray(nooterraPay) && nooterraPay.requireDelegatedAccountSession === true;
  const requireTaskWallet =
    nooterraPay && typeof nooterraPay === "object" && !Array.isArray(nooterraPay) && nooterraPay.requireTaskWallet === true;
  const delegatedAccountRuntimeFactory =
    nooterraPay && typeof nooterraPay === "object" && !Array.isArray(nooterraPay) && typeof nooterraPay.delegatedAccountRuntime === "function"
      ? nooterraPay.delegatedAccountRuntime
      : null;

  async function paidHandler(req, res) {
    const url = new URL(req.url ?? "/", "http://localhost");
    let offer;
    try {
      const rawOffer = await priceForFn({ req, url });
      offer = normalizeOffer({
        offer: rawOffer,
        req,
        url,
        providerId,
        providerIdForRequest,
        paymentAddress,
        paymentNetwork
      });
    } catch (err) {
      sendJson(res, {
        statusCode: 500,
        payload: {
          ok: false,
          error: "pricing_error",
          message: err?.message ?? String(err ?? "")
        }
      });
      return;
    }

    const strictRequestBinding = offer.requestBindingMode === "strict";
    let requestBodyBuffer = null;
    let requestBindingSha256 = null;
    if (strictRequestBinding) {
      try {
        requestBodyBuffer = methodSupportsBody(req?.method) ? await readRequestBodyBuffer(req, { maxBytes: maxRequestBodyBytes }) : Buffer.from("", "utf8");
        requestBindingSha256 = computeRequestBindingSha256({ req, url, bodyBuffer: requestBodyBuffer });
      } catch (err) {
        sendPaymentRequired(res, {
          offer,
          code: typeof err?.code === "string" && err.code.trim() !== "" ? err.code.trim() : "NOOTERRA_PAY_REQUEST_BINDING_INPUT_INVALID",
          message: err?.message ?? "request binding input invalid"
        });
        return;
      }
    }
    const quoteAttestation = buildSignedQuoteChallenge({
      offer,
      req,
      url,
      requestBindingSha256,
      quoteTtlSeconds: normalizedQuoteTtlSeconds,
      publicKeyPem,
      privateKeyPem
    });
    offer = quoteAttestation.offer;

    const token = parseNooterraPayAuthorizationHeader(req.headers?.authorization);
    if (!token) {
      sendPaymentRequired(res, {
        offer,
        quoteAttestation,
        code: "PAYMENT_REQUIRED",
        message: "missing or invalid NooterraPay authorization"
      });
      return;
    }

    const verified = await verifyNooterraPaymentToken({
      token,
      offer,
      keysetResolver: resolver,
      expectedRequestBindingSha256: requestBindingSha256
    });
    if (!verified.ok) {
      sendPaymentRequired(res, {
        offer,
        quoteAttestation,
        code: verified.code,
        message: verified.message ?? "payment token rejected",
        details: verified.details ?? null
      });
      return;
    }

    const verification = verified.verification;
    const payload = verification.payload ?? {};
    let delegatedAccountSession = null;
    const delegatedAccountSessionHeader = typeof req?.headers?.[DELEGATED_ACCOUNT_SESSION_HEADER] === "string"
      ? req.headers[DELEGATED_ACCOUNT_SESSION_HEADER]
      : Array.isArray(req?.headers?.[DELEGATED_ACCOUNT_SESSION_HEADER])
        ? req.headers[DELEGATED_ACCOUNT_SESSION_HEADER][0]
        : "";
    if (delegatedAccountSessionHeader) {
      try {
        delegatedAccountSession = parseDelegatedAccountSessionBindingHeaderValue(delegatedAccountSessionHeader);
      } catch (err) {
        sendJson(res, {
          statusCode: 409,
          payload: {
            ok: false,
            error: "delegated_account_session_invalid",
            message: err?.message ?? "delegated account session binding header is invalid"
          }
        });
        return;
      }
    } else if (requireDelegatedAccountSession) {
      sendJson(res, {
        statusCode: 409,
        payload: {
          ok: false,
          error: "delegated_account_session_required",
          message: "delegated account session binding is required for this provider"
        }
      });
      return;
    }
    let taskWallet = null;
    const taskWalletHeader = typeof req?.headers?.[TASK_WALLET_HEADER] === "string"
      ? req.headers[TASK_WALLET_HEADER]
      : Array.isArray(req?.headers?.[TASK_WALLET_HEADER])
        ? req.headers[TASK_WALLET_HEADER][0]
        : "";
    if (taskWalletHeader) {
      try {
        taskWallet = parseTaskWalletHeaderValue(taskWalletHeader);
      } catch (err) {
        sendJson(res, {
          statusCode: 409,
          payload: {
            ok: false,
            error: "task_wallet_invalid",
            message: err?.message ?? "task wallet binding header is invalid"
          }
        });
        return;
      }
    } else if (requireTaskWallet) {
      sendJson(res, {
        statusCode: 409,
        payload: {
          ok: false,
          error: "task_wallet_required",
          message: "task wallet binding is required for this provider"
        }
      });
      return;
    }
    let delegatedBrowserProfile = null;
    const delegatedBrowserProfileHeader = typeof req?.headers?.[DELEGATED_ACCOUNT_SESSION_BROWSER_PROFILE_HEADER] === "string"
      ? req.headers[DELEGATED_ACCOUNT_SESSION_BROWSER_PROFILE_HEADER]
      : Array.isArray(req?.headers?.[DELEGATED_ACCOUNT_SESSION_BROWSER_PROFILE_HEADER])
        ? req.headers[DELEGATED_ACCOUNT_SESSION_BROWSER_PROFILE_HEADER][0]
        : "";
    if (delegatedBrowserProfileHeader) {
      try {
        delegatedBrowserProfile = parseDelegatedBrowserProfileHeaderValue(delegatedBrowserProfileHeader);
      } catch (err) {
        sendJson(res, {
          statusCode: 409,
          payload: {
            ok: false,
            error: "delegated_browser_profile_invalid",
            message: err?.message ?? "delegated browser profile binding header is invalid"
          }
        });
        return;
      }
    }
    let delegatedAccountRuntime = null;
    if (delegatedAccountSession && delegatedAccountRuntimeFactory) {
      try {
        delegatedAccountRuntime = await delegatedAccountRuntimeFactory({
          delegatedAccountSession,
          delegatedBrowserProfile,
          req,
          url,
          offer,
          verification
        });
      } catch (err) {
        sendJson(res, {
          statusCode: 409,
          payload: {
            ok: false,
            error: "delegated_account_runtime_unavailable",
            message: err?.message ?? "delegated account runtime is unavailable"
          }
        });
        return;
      }
    }
    const replayKey = (() => {
      const authorizationRef = typeof payload.authorizationRef === "string" ? payload.authorizationRef.trim() : "";
      if (authorizationRef) return authorizationRef;
      const gateId = typeof payload.gateId === "string" ? payload.gateId.trim() : "";
      return gateId || verification.tokenSha256;
    })();
    const nowMs = Date.now();
    const replayExisting = replay.get(replayKey, nowMs);
    if (replayExisting) {
      const replayHeaders = {
        ...(replayExisting.headers ?? {}),
        "x-nooterra-provider-key-id": replayExisting.signature?.keyId ?? signerKeyId,
        "x-nooterra-provider-signed-at": replayExisting.signature?.signedAt ?? "",
        "x-nooterra-provider-nonce": replayExisting.signature?.nonce ?? "",
        "x-nooterra-provider-response-sha256": replayExisting.signature?.responseHash ?? "",
        "x-nooterra-provider-signature": replayExisting.signature?.signatureBase64 ?? "",
        "x-nooterra-provider-authorization-ref": String(payload.authorizationRef ?? ""),
        "x-nooterra-provider-gate-id": String(payload.gateId ?? ""),
        "x-nooterra-provider-quote-id": String(payload.quoteId ?? ""),
        "x-nooterra-provider-token-sha256": String(verification.tokenSha256 ?? ""),
        "x-nooterra-keyset-source": verified.keysetSource,
        "x-nooterra-provider-replay": "duplicate",
        "x-nooterra-request-binding-mode": replayExisting.requestBindingMode ?? offer.requestBindingMode ?? "none",
        "x-nooterra-request-binding-sha256": replayExisting.requestBindingSha256 ?? requestBindingSha256 ?? "",
        "x-nooterra-task-wallet-id": replayExisting.taskWalletId ?? taskWallet?.walletId ?? "",
        "x-nooterra-task-wallet-review-mode": replayExisting.taskWalletReviewMode ?? taskWallet?.reviewMode ?? "",
        "x-nooterra-account-session-mode": replayExisting.accountSessionMode ?? delegatedAccountSession?.mode ?? "",
        "x-nooterra-account-session-provider": replayExisting.accountSessionProvider ?? delegatedAccountSession?.providerKey ?? "",
        "x-nooterra-account-session-site": replayExisting.accountSessionSite ?? delegatedAccountSession?.siteKey ?? ""
      };
      if (!replayHeaders["content-type"]) replayHeaders["content-type"] = replayExisting.contentType ?? "application/json; charset=utf-8";
      res.writeHead(replayExisting.statusCode ?? 200, replayHeaders);
      res.end(replayExisting.bodyBuffer ?? Buffer.from("", "utf8"));
      return;
    }

    let execRaw;
    try {
      execRaw = await executeFn({
        req,
        url,
        offer,
        verification,
        requestBodyBuffer,
        requestBindingSha256,
        delegatedAccountSession,
        delegatedAccountRuntime,
        taskWallet
      });
    } catch (err) {
      if (typeof err?.code === "string" && err.code.startsWith("TASK_WALLET_")) {
        sendJson(res, {
          statusCode: 409,
          payload: {
            ok: false,
            error: "task_wallet_violation",
            code: err.code,
            message: err?.message ?? "task wallet enforcement blocked execution"
          }
        });
        return;
      }
      sendJson(res, {
        statusCode: 500,
        payload: {
          ok: false,
          error: "provider_execution_error",
          message: err?.message ?? String(err ?? "")
        }
      });
      return;
    }
    const execResult = normalizeExecutionResult(execRaw);
    const body = toBodyBuffer(execResult.body);
    const contentType = execResult.contentType ?? execResult.headers["content-type"] ?? body.contentType;
    const responseHash = sha256Hex(body.bodyBuffer);
    const signedAt = new Date().toISOString();
    const nonce = crypto.randomBytes(16).toString("hex");
    let signature = signToolProviderSignatureV1({
      responseHash,
      nonce,
      signedAt,
      publicKeyPem,
      privateKeyPem
    });
    if (typeof mutateSignature === "function") {
      const maybeMutated = mutateSignature({
        signature,
        req,
        url,
        offer,
        verification,
        bodyBuffer: body.bodyBuffer
      });
      if (maybeMutated && typeof maybeMutated === "object") signature = maybeMutated;
    }

    const responseHeaders = {
      ...execResult.headers,
      "content-type": contentType,
      "x-nooterra-provider-key-id": signature.keyId ?? signerKeyId,
      "x-nooterra-provider-signed-at": signature.signedAt ?? signedAt,
      "x-nooterra-provider-nonce": signature.nonce ?? nonce,
      "x-nooterra-provider-response-sha256": signature.responseHash ?? responseHash,
      "x-nooterra-provider-signature": signature.signatureBase64 ?? "",
      "x-nooterra-provider-authorization-ref": String(payload.authorizationRef ?? ""),
      "x-nooterra-provider-gate-id": String(payload.gateId ?? ""),
      "x-nooterra-provider-quote-id": String(payload.quoteId ?? ""),
      "x-nooterra-provider-token-sha256": String(verification.tokenSha256 ?? ""),
      "x-nooterra-keyset-source": verified.keysetSource,
      "x-nooterra-request-binding-mode": offer.requestBindingMode ?? "none",
      "x-nooterra-request-binding-sha256": requestBindingSha256 ?? "",
      "x-nooterra-task-wallet-id": taskWallet?.walletId ?? "",
      "x-nooterra-task-wallet-review-mode": taskWallet?.reviewMode ?? "",
      "x-nooterra-account-session-mode": delegatedAccountSession?.mode ?? "",
      "x-nooterra-account-session-provider": delegatedAccountSession?.providerKey ?? "",
      "x-nooterra-account-session-site": delegatedAccountSession?.siteKey ?? ""
    };
    res.writeHead(execResult.statusCode, responseHeaders);
    res.end(body.bodyBuffer);

    const replayExpiresAtMs = Number(payload.exp) * 1000 + normalizedReplayTtlBufferMs;
    replay.set(
      replayKey,
      {
        expiresAtMs: Number.isFinite(replayExpiresAtMs) ? replayExpiresAtMs : nowMs + 5 * 60_000,
        statusCode: execResult.statusCode,
        headers: execResult.headers,
        contentType,
        bodyBuffer: body.bodyBuffer,
        signature,
        requestBindingMode: offer.requestBindingMode ?? "none",
        requestBindingSha256: requestBindingSha256 ?? null,
        taskWalletId: taskWallet?.walletId ?? null,
        taskWalletReviewMode: taskWallet?.reviewMode ?? null,
        accountSessionMode: delegatedAccountSession?.mode ?? null,
        accountSessionProvider: delegatedAccountSession?.providerKey ?? null,
        accountSessionSite: delegatedAccountSession?.siteKey ?? null
      },
      nowMs
    );
  }

  return paidHandler;
}
