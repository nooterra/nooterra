import { FEDERATION_ERROR_CODE } from "./error-codes.js";

function normalizeOptionalString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function normalizeDid(value) {
  const did = normalizeOptionalString(value);
  if (!did) return null;
  if (!/^did:[a-z0-9]+:[A-Za-z0-9._:-]{1,256}$/.test(did)) return null;
  return did;
}

function normalizeAbsoluteUrl(value, { fieldName = "url" } = {}) {
  const raw = normalizeOptionalString(value);
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new TypeError(`${fieldName} must be an absolute URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError(`${fieldName} must use http or https`);
  }
  parsed.hash = "";
  return parsed.toString().replace(/\/+$/, "");
}

function parseDelimitedDidList(raw) {
  const values = String(raw ?? "")
    .split(",")
    .map((entry) => normalizeDid(entry))
    .filter(Boolean);
  return [...new Set(values)].sort();
}

function parseNamespaceRoutes(raw) {
  const value = normalizeOptionalString(raw);
  if (!value) return new Map();

  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (err) {
    throw new TypeError(`PROXY_FEDERATION_NAMESPACE_ROUTES must be valid JSON: ${err?.message ?? String(err ?? "")}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("PROXY_FEDERATION_NAMESPACE_ROUTES must be a JSON object mapping coordinator DID -> absolute base URL");
  }

  const rows = [];
  for (const [didRaw, routeRaw] of Object.entries(parsed)) {
    const did = normalizeDid(didRaw);
    if (!did) {
      throw new TypeError(`PROXY_FEDERATION_NAMESPACE_ROUTES contains invalid coordinator DID: ${String(didRaw)}`);
    }
    const baseUrl = normalizeAbsoluteUrl(routeRaw, { fieldName: `PROXY_FEDERATION_NAMESPACE_ROUTES.${did}` });
    if (!baseUrl) {
      throw new TypeError(`PROXY_FEDERATION_NAMESPACE_ROUTES.${did} must be a non-empty absolute URL`);
    }
    rows.push([did, baseUrl]);
  }
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  return new Map(rows);
}

export function buildFederationProxyPolicy({ env = process.env, fallbackBaseUrl = null } = {}) {
  const localCoordinatorDid = normalizeDid(env?.COORDINATOR_DID) ?? normalizeDid(env?.PROXY_COORDINATOR_DID);
  const trustedCoordinatorDids = parseDelimitedDidList(env?.PROXY_FEDERATION_TRUSTED_COORDINATOR_DIDS);
  const namespaceRoutes = parseNamespaceRoutes(env?.PROXY_FEDERATION_NAMESPACE_ROUTES);
  const normalizedFallbackBaseUrl = normalizeAbsoluteUrl(fallbackBaseUrl, { fieldName: "FEDERATION_PROXY_BASE_URL" });

  return {
    localCoordinatorDid,
    trustedCoordinatorDids,
    trustedCoordinatorDidSet: new Set(trustedCoordinatorDids),
    namespaceRoutes,
    fallbackBaseUrl: normalizedFallbackBaseUrl
  };
}

function envelopeError(statusCode, code, message, details = null) {
  return { ok: false, statusCode, code, message, details };
}

export function validateFederationEnvelope({ endpoint, body }) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return envelopeError(400, FEDERATION_ERROR_CODE.ENVELOPE_INVALID, "federation envelope must be a JSON object");
  }

  const expectedType = endpoint === "result" ? "coordinatorResult" : "coordinatorInvoke";
  const version = normalizeOptionalString(body?.version);
  if (version !== "1.0") {
    return envelopeError(400, FEDERATION_ERROR_CODE.PROTOCOL_VERSION_MISMATCH, "federation envelope version must be 1.0");
  }

  const type = normalizeOptionalString(body?.type);
  if (type !== expectedType) {
    return envelopeError(400, FEDERATION_ERROR_CODE.ENVELOPE_TYPE_MISMATCH, `federation envelope type must be ${expectedType}`);
  }

  const invocationId = normalizeOptionalString(body?.invocationId);
  if (!invocationId) {
    return envelopeError(400, FEDERATION_ERROR_CODE.INVOCATION_ID_REQUIRED, "invocationId is required");
  }

  const originDid = normalizeDid(body?.originDid);
  if (!originDid) {
    return envelopeError(400, FEDERATION_ERROR_CODE.ORIGIN_DID_INVALID, "originDid must be a DID");
  }

  const targetDid = normalizeDid(body?.targetDid);
  if (!targetDid) {
    return envelopeError(400, FEDERATION_ERROR_CODE.TARGET_DID_INVALID, "targetDid must be a DID");
  }

  if (endpoint === "invoke") {
    const capabilityId = normalizeOptionalString(body?.capabilityId);
    if (!capabilityId) {
      return envelopeError(400, FEDERATION_ERROR_CODE.CAPABILITY_ID_REQUIRED, "capabilityId is required");
    }
  } else {
    const status = normalizeOptionalString(body?.status);
    if (!["success", "error", "timeout", "denied"].includes(String(status ?? ""))) {
      return envelopeError(400, FEDERATION_ERROR_CODE.RESULT_STATUS_INVALID, "result status must be success|error|timeout|denied");
    }
  }

  return {
    ok: true,
    envelope: {
      version,
      type,
      invocationId,
      originDid,
      targetDid,
      capabilityId: normalizeOptionalString(body?.capabilityId),
      status: normalizeOptionalString(body?.status)
    }
  };
}

export function evaluateFederationTrustAndRoute({ endpoint, envelope, policy }) {
  const hasNamespaceRoutes = policy?.namespaceRoutes && policy.namespaceRoutes.size > 0;
  if (!hasNamespaceRoutes && !policy?.fallbackBaseUrl) {
    return envelopeError(503, FEDERATION_ERROR_CODE.NOT_CONFIGURED, "federation proxy is not configured on this API host", {
      env: "FEDERATION_PROXY_BASE_URL"
    });
  }

  const localDid = policy?.localCoordinatorDid ?? null;
  if (!localDid) {
    return envelopeError(503, FEDERATION_ERROR_CODE.IDENTITY_NOT_CONFIGURED, "local federation coordinator identity is not configured");
  }

  if (!Array.isArray(policy?.trustedCoordinatorDids) || policy.trustedCoordinatorDids.length === 0) {
    return envelopeError(503, FEDERATION_ERROR_CODE.TRUST_NOT_CONFIGURED, "trusted federation coordinators are not configured");
  }

  const originDid = envelope.originDid;
  const targetDid = envelope.targetDid;
  const localMatchesOrigin = originDid === localDid;
  const localMatchesTarget = targetDid === localDid;
  if (localMatchesOrigin === localMatchesTarget) {
    return envelopeError(
      403,
      FEDERATION_ERROR_CODE.IDENTITY_MISMATCH,
      "exactly one side of the federation envelope must match local coordinator identity",
      { localCoordinatorDid: localDid, originDid, targetDid }
    );
  }

  const peerDid = localMatchesOrigin ? targetDid : originDid;
  if (!policy.trustedCoordinatorDidSet?.has(peerDid)) {
    return envelopeError(403, FEDERATION_ERROR_CODE.UNTRUSTED_COORDINATOR, "federation peer coordinator is not trusted", { peerDid });
  }

  const namespaceDid = targetDid;
  const route = policy.namespaceRoutes?.get(namespaceDid) ?? null;
  if (hasNamespaceRoutes && !route) {
    return envelopeError(503, FEDERATION_ERROR_CODE.NAMESPACE_ROUTE_MISSING, "no namespace route configured for federation target DID", {
      namespaceDid
    });
  }

  const upstreamBaseUrl = route ?? policy.fallbackBaseUrl ?? null;
  if (!upstreamBaseUrl) {
    return envelopeError(503, FEDERATION_ERROR_CODE.NOT_CONFIGURED, "federation proxy is not configured on this API host", {
      env: "FEDERATION_PROXY_BASE_URL"
    });
  }

  return {
    ok: true,
    endpoint,
    originDid,
    targetDid,
    peerDid,
    namespaceDid,
    upstreamBaseUrl
  };
}
