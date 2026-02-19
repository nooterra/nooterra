import { createPublicKey, verify as nodeVerify, sign as nodeSign } from "node:crypto";

import { canonicalJsonStringify, normalizeForCanonicalJson } from "./canonical-json.js";
import { checkUrlSafety } from "./url-safety.js";
import { keyIdFromPublicKeyPem, sha256Hex } from "./crypto.js";
import { keyMapFromSettldKeyset } from "./settld-keys.js";

export const PROVIDER_PUBLISH_PROOF_AUDIENCE = "settld.marketplace.publish";
export const PROVIDER_PUBLISH_PROOF_TYPE = "settld.marketplace.publish_proof.v1";
export const PROVIDER_PUBLISH_PROOF_SCHEMA_VERSION = "ProviderPublishProofPayload.v1";

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
  return String(value).trim();
}

function assertNonEmptyPem(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
  return String(value);
}

function normalizeUnixSeconds(value, name) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new TypeError(`${name} must be a positive safe integer unix timestamp`);
  return n;
}

function normalizeSha256Hex(value, name) {
  const out = assertNonEmptyString(value, name).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(out)) throw new TypeError(`${name} must be sha256 hex`);
  return out;
}

function normalizeOptionalText(value, name, { max = 256 } = {}) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const out = String(value).trim();
  if (out.length > max) throw new TypeError(`${name} must be <= ${max} chars`);
  return out;
}

function b64urlJson(value) {
  return Buffer.from(canonicalJsonStringify(normalizeForCanonicalJson(value, { path: "$" })), "utf8").toString("base64url");
}

function parseCompactJws(token) {
  const raw = assertNonEmptyString(token, "publishProof");
  const parts = raw.split(".");
  if (parts.length !== 3) throw new TypeError("publishProof must be compact JWS with 3 segments");
  const [headerB64, payloadB64, sigB64] = parts;
  if (!headerB64 || !payloadB64 || !sigB64) throw new TypeError("publishProof contains empty JWS segment");

  let header = null;
  let payload = null;
  let signature = null;
  try {
    header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
  } catch (err) {
    throw new TypeError(`publishProof header is invalid: ${err?.message ?? String(err ?? "")}`);
  }
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch (err) {
    throw new TypeError(`publishProof payload is invalid: ${err?.message ?? String(err ?? "")}`);
  }
  try {
    signature = Buffer.from(sigB64, "base64url");
  } catch (err) {
    throw new TypeError(`publishProof signature is invalid: ${err?.message ?? String(err ?? "")}`);
  }
  if (!header || typeof header !== "object" || Array.isArray(header)) throw new TypeError("publishProof header must be an object");
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new TypeError("publishProof payload must be an object");
  if (signature.length === 0) throw new TypeError("publishProof signature must be non-empty");
  return {
    token: raw,
    header,
    payload,
    signature,
    signingInput: `${headerB64}.${payloadB64}`
  };
}

function normalizeOkpEd25519Jwk(input, fieldPath = "jwk") {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError(`${fieldPath} must be an object`);
  const kty = assertNonEmptyString(input.kty, `${fieldPath}.kty`);
  const crv = assertNonEmptyString(input.crv, `${fieldPath}.crv`);
  const x = assertNonEmptyString(input.x, `${fieldPath}.x`);
  if (kty !== "OKP") throw new TypeError(`${fieldPath}.kty must be OKP`);
  if (crv !== "Ed25519") throw new TypeError(`${fieldPath}.crv must be Ed25519`);
  return normalizeForCanonicalJson({ kty: "OKP", crv: "Ed25519", x }, { path: "$" });
}

function keyEntryToKeyEvidence(keyEntry, expectedKid) {
  if (!keyEntry || typeof keyEntry !== "object" || Array.isArray(keyEntry)) {
    throw new TypeError("keyEntry must be an object");
  }
  const publicKeyPem = assertNonEmptyPem(keyEntry.publicKeyPem, "keyEntry.publicKeyPem");
  const derivedKid = keyIdFromPublicKeyPem(publicKeyPem);
  const kid = expectedKid ? assertNonEmptyString(expectedKid, "kid") : derivedKid;
  if (kid !== derivedKid) throw new TypeError("publish proof kid does not match resolved public key");

  let jwk = null;
  if (keyEntry.kty || keyEntry.crv || keyEntry.x) {
    jwk = normalizeOkpEd25519Jwk(keyEntry, "jwks.keys[]");
  } else {
    const exported = createPublicKey(publicKeyPem).export({ format: "jwk" });
    jwk = normalizeOkpEd25519Jwk(exported, "publicKeyPem.jwk");
  }
  const jwkThumbprintSha256 = sha256Hex(canonicalJsonStringify(jwk));
  return normalizeForCanonicalJson(
    {
      schemaVersion: "VerificationKeyEvidence.v1",
      keyId: kid,
      publicKeyPem,
      jwk,
      jwkThumbprintSha256
    },
    { path: "$" }
  );
}

export function computeProviderRefFromPublishProofJwk(jwkInput) {
  const jwk = normalizeOkpEd25519Jwk(jwkInput, "jwk");
  const thumbprint = sha256Hex(canonicalJsonStringify(jwk));
  return `jwk:${thumbprint}`;
}

export function buildProviderPublishProofPayloadV1({
  aud = PROVIDER_PUBLISH_PROOF_AUDIENCE,
  typ = PROVIDER_PUBLISH_PROOF_TYPE,
  manifestHash,
  providerId,
  iat,
  exp,
  nonce = null
} = {}) {
  const normalizedIat = normalizeUnixSeconds(iat, "iat");
  const normalizedExp = normalizeUnixSeconds(exp, "exp");
  if (normalizedExp <= normalizedIat) throw new TypeError("exp must be greater than iat");
  return normalizeForCanonicalJson(
    {
      schemaVersion: PROVIDER_PUBLISH_PROOF_SCHEMA_VERSION,
      aud: assertNonEmptyString(aud, "aud"),
      typ: assertNonEmptyString(typ, "typ"),
      manifestHash: normalizeSha256Hex(manifestHash, "manifestHash"),
      providerId: assertNonEmptyString(providerId, "providerId"),
      iat: normalizedIat,
      exp: normalizedExp,
      ...(normalizeOptionalText(nonce, "nonce", { max: 256 }) ? { nonce: normalizeOptionalText(nonce, "nonce", { max: 256 }) } : {})
    },
    { path: "$" }
  );
}

export function mintProviderPublishProofTokenV1({ payload, keyId = null, publicKeyPem = null, privateKeyPem } = {}) {
  const normalizedPayload = buildProviderPublishProofPayloadV1(payload ?? {});
  const privatePem = assertNonEmptyPem(privateKeyPem, "privateKeyPem");
  const normalizedPublicKeyPem =
    publicKeyPem === null || publicKeyPem === undefined ? null : assertNonEmptyPem(publicKeyPem, "publicKeyPem");
  const derivedKid = normalizedPublicKeyPem ? keyIdFromPublicKeyPem(normalizedPublicKeyPem) : null;
  const normalizedKid = keyId === null || keyId === undefined || String(keyId).trim() === "" ? derivedKid : String(keyId).trim();
  if (!normalizedKid) throw new TypeError("keyId is required (or provide publicKeyPem)");
  if (derivedKid && normalizedKid !== derivedKid) throw new TypeError("keyId does not match publicKeyPem");

  const header = normalizeForCanonicalJson(
    {
      alg: "EdDSA",
      kid: normalizedKid,
      typ: "JWT"
    },
    { path: "$" }
  );
  const headerB64 = b64urlJson(header);
  const payloadB64 = b64urlJson(normalizedPayload);
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = nodeSign(null, Buffer.from(signingInput, "utf8"), privatePem);
  const token = `${signingInput}.${signature.toString("base64url")}`;

  return {
    token,
    tokenSha256: sha256Hex(token),
    header,
    payload: normalizedPayload,
    kid: normalizedKid
  };
}

export function verifyProviderPublishProofTokenV1({
  token,
  jwks,
  expectedManifestHash,
  expectedProviderId,
  expectedAudience = PROVIDER_PUBLISH_PROOF_AUDIENCE,
  expectedType = PROVIDER_PUBLISH_PROOF_TYPE,
  nowUnixSeconds = Math.floor(Date.now() / 1000)
} = {}) {
  try {
    const parsed = parseCompactJws(token);
    const alg = assertNonEmptyString(parsed.header.alg, "publishProof.header.alg");
    if (alg !== "EdDSA") {
      return { ok: false, code: "PROVIDER_PUBLISH_PROOF_ALG_INVALID", message: "publishProof.header.alg must be EdDSA" };
    }
    const kid = assertNonEmptyString(parsed.header.kid, "publishProof.header.kid");
    if (!Number.isSafeInteger(nowUnixSeconds) || nowUnixSeconds <= 0) {
      throw new TypeError("nowUnixSeconds must be a positive safe integer");
    }

    const payload = buildProviderPublishProofPayloadV1(parsed.payload);
    if (payload.aud !== expectedAudience) {
      return {
        ok: false,
        code: "PROVIDER_PUBLISH_PROOF_AUD_MISMATCH",
        message: "publish proof aud mismatch",
        expected: expectedAudience,
        actual: payload.aud
      };
    }
    if (payload.typ !== expectedType) {
      return {
        ok: false,
        code: "PROVIDER_PUBLISH_PROOF_TYPE_MISMATCH",
        message: "publish proof typ mismatch",
        expected: expectedType,
        actual: payload.typ
      };
    }

    const expectedManifest = normalizeSha256Hex(expectedManifestHash, "expectedManifestHash");
    if (payload.manifestHash !== expectedManifest) {
      return {
        ok: false,
        code: "PROVIDER_PUBLISH_PROOF_MANIFEST_HASH_MISMATCH",
        message: "publish proof manifest hash mismatch",
        expected: expectedManifest,
        actual: payload.manifestHash
      };
    }

    const expectedProvider = assertNonEmptyString(expectedProviderId, "expectedProviderId");
    if (payload.providerId !== expectedProvider) {
      return {
        ok: false,
        code: "PROVIDER_PUBLISH_PROOF_PROVIDER_MISMATCH",
        message: "publish proof providerId mismatch",
        expected: expectedProvider,
        actual: payload.providerId
      };
    }

    if (payload.exp <= nowUnixSeconds) {
      return { ok: false, code: "PROVIDER_PUBLISH_PROOF_EXPIRED", message: "publish proof is expired" };
    }
    if (payload.iat > nowUnixSeconds + 300) {
      return { ok: false, code: "PROVIDER_PUBLISH_PROOF_IAT_FUTURE", message: "publish proof iat is too far in the future" };
    }

    const keyMap = keyMapFromSettldKeyset(jwks);
    const keyEntry = keyMap.get(kid) ?? null;
    if (!keyEntry?.publicKeyPem) {
      return { ok: false, code: "PROVIDER_PUBLISH_PROOF_UNKNOWN_KID", message: "publish proof kid not found in jwks", kid };
    }
    if (keyEntry.alg && String(keyEntry.alg).trim() !== "" && String(keyEntry.alg).trim() !== "EdDSA") {
      return {
        ok: false,
        code: "PROVIDER_PUBLISH_PROOF_KEY_ALG_INVALID",
        message: "jwks key alg must be EdDSA when provided",
        kid
      };
    }

    const signatureValid = nodeVerify(
      null,
      Buffer.from(parsed.signingInput, "utf8"),
      keyEntry.publicKeyPem,
      parsed.signature
    );
    if (!signatureValid) {
      return { ok: false, code: "PROVIDER_PUBLISH_PROOF_SIGNATURE_INVALID", message: "publish proof signature verification failed", kid };
    }

    const keyEvidence = keyEntryToKeyEvidence(keyEntry, kid);
    const providerRef = computeProviderRefFromPublishProofJwk(keyEvidence.jwk);
    return {
      ok: true,
      code: null,
      header: parsed.header,
      payload,
      kid,
      keyEvidence,
      providerRef,
      tokenSha256: sha256Hex(assertNonEmptyString(token, "token"))
    };
  } catch (err) {
    return {
      ok: false,
      code: "PROVIDER_PUBLISH_PROOF_INVALID",
      message: err?.message ?? String(err ?? "")
    };
  }
}

function makeProofError(code, message, details = null, { statusCode = 400 } = {}) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  if (details !== null && details !== undefined) err.details = details;
  return err;
}

export async function fetchProviderPublishProofJwks({
  jwksUrl,
  fetchFn = globalThis.fetch,
  timeoutMs = 8_000,
  maxBytes = 256 * 1024,
  allowHttp = false,
  allowPrivate = false,
  allowLoopback = false
} = {}) {
  const urlText = assertNonEmptyString(jwksUrl, "publishProofJwksUrl");
  const safe = await checkUrlSafety(urlText, {
    allowHttp,
    allowPrivate,
    allowLoopback,
    allowedSchemes: ["https"]
  });
  if (!safe.ok) {
    throw makeProofError(
      "PROVIDER_PUBLISH_PROOF_JWKS_URL_UNSAFE",
      "publish proof jwks url is unsafe",
      { code: safe.code, message: safe.message, hostname: safe.hostname ?? null }
    );
  }

  if (typeof fetchFn !== "function") {
    throw makeProofError("PROVIDER_PUBLISH_PROOF_FETCH_UNAVAILABLE", "fetch is unavailable in this runtime");
  }

  const timeout = Number(timeoutMs);
  const controller = new AbortController();
  const timer = Number.isFinite(timeout) && timeout > 0 ? setTimeout(() => controller.abort(), timeout) : null;
  let response = null;
  try {
    response = await fetchFn(urlText, {
      method: "GET",
      headers: {
        accept: "application/json"
      },
      redirect: "error",
      signal: controller.signal
    });
  } catch (err) {
    throw makeProofError(
      "PROVIDER_PUBLISH_PROOF_JWKS_FETCH_FAILED",
      `publish proof jwks fetch failed: ${err?.message ?? String(err ?? "")}`,
      null,
      { statusCode: 502 }
    );
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (!response?.ok) {
    throw makeProofError(
      "PROVIDER_PUBLISH_PROOF_JWKS_FETCH_FAILED",
      `publish proof jwks fetch returned ${Number(response?.status ?? 0)}`,
      { statusCode: Number(response?.status ?? 0) || null },
      { statusCode: 502 }
    );
  }

  let text = "";
  try {
    text = await response.text();
  } catch (err) {
    throw makeProofError(
      "PROVIDER_PUBLISH_PROOF_JWKS_BODY_INVALID",
      `publish proof jwks body read failed: ${err?.message ?? String(err ?? "")}`
    );
  }
  if (Buffer.byteLength(text, "utf8") > Number(maxBytes)) {
    throw makeProofError("PROVIDER_PUBLISH_PROOF_JWKS_BODY_TOO_LARGE", `publish proof jwks body must be <= ${Number(maxBytes)} bytes`);
  }

  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw makeProofError("PROVIDER_PUBLISH_PROOF_JWKS_JSON_INVALID", `publish proof jwks must be valid JSON: ${err?.message ?? String(err ?? "")}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw makeProofError("PROVIDER_PUBLISH_PROOF_JWKS_JSON_INVALID", "publish proof jwks must be an object");
  }
  if (!Array.isArray(parsed.keys) || parsed.keys.length === 0) {
    throw makeProofError("PROVIDER_PUBLISH_PROOF_JWKS_KEYS_MISSING", "publish proof jwks.keys must be a non-empty array");
  }
  return normalizeForCanonicalJson(parsed, { path: "$" });
}
