import { authorize } from "./authz.js";

const HIGH_RISK_WRITE_ROUTES = Object.freeze([
  { id: "x402_wallet_authorize", method: "POST", path: /^\/x402\/wallets\/[^/]+\/authorize$/, requiredScopes: ["FINANCE_WRITE"] },
  { id: "x402_gate_create", method: "POST", path: /^\/x402\/gate\/create$/, requiredScopes: ["FINANCE_WRITE"] },
  { id: "x402_gate_quote", method: "POST", path: /^\/x402\/gate\/quote$/, requiredScopes: ["FINANCE_WRITE"] },
  { id: "x402_gate_authorize_payment", method: "POST", path: /^\/x402\/gate\/authorize-payment$/, requiredScopes: ["FINANCE_WRITE"] },
  { id: "x402_gate_verify", method: "POST", path: /^\/x402\/gate\/verify$/, requiredScopes: ["FINANCE_WRITE"] },
  { id: "x402_gate_reversal", method: "POST", path: /^\/x402\/gate\/reversal$/, requiredScopes: ["FINANCE_WRITE"] },
  {
    id: "x402_gate_escalation_resolve",
    method: "POST",
    path: /^\/x402\/gate\/escalations\/[^/]+\/resolve$/,
    requiredScopes: ["FINANCE_WRITE"]
  },
  { id: "x402_gate_wind_down", method: "POST", path: /^\/x402\/gate\/agents\/[^/]+\/wind-down$/, requiredScopes: ["OPS_WRITE"] }
]);

function normalizeMethod(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function normalizePath(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSha256(value) {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[0-9a-f]{64}$/.test(text) ? text : null;
}

function fail({ code, message, details = null, statusCode = 409 } = {}) {
  return { ok: false, code, message, details, statusCode };
}

export function resolveTrustKernelHighRiskWriteRoute({ method, path } = {}) {
  const normalizedMethod = normalizeMethod(method);
  const normalizedPath = normalizePath(path);
  for (const route of HIGH_RISK_WRITE_ROUTES) {
    if (route.method !== normalizedMethod) continue;
    if (!route.path.test(normalizedPath)) continue;
    return route;
  }
  return null;
}

export function guardHighRiskTrustKernelWrite({ method, path, auth, opsScopes } = {}) {
  const route = resolveTrustKernelHighRiskWriteRoute({ method, path });
  if (!route) return { ok: true, routeId: null };
  if (!auth || auth.ok !== true) {
    return fail({ statusCode: 403, code: "FORBIDDEN", message: "forbidden", details: { routeId: route.id } });
  }

  const requiredScopes = [];
  for (const scopeName of route.requiredScopes) {
    const scopeValue = opsScopes && typeof opsScopes === "object" ? opsScopes[scopeName] : null;
    if (typeof scopeValue === "string" && scopeValue.trim() !== "") requiredScopes.push(scopeValue.trim());
  }
  if (!requiredScopes.length) {
    return fail({ statusCode: 403, code: "FORBIDDEN", message: "forbidden", details: { routeId: route.id } });
  }

  const allowed = authorize({ scopes: auth.scopes, requiredScopes, mode: "any" });
  if (!allowed) {
    return fail({ statusCode: 403, code: "FORBIDDEN", message: "forbidden", details: { routeId: route.id } });
  }
  return { ok: true, routeId: route.id };
}

export function guardExecutionIntentRequestBindingConsistency({
  executionIntent,
  requestBindingMode,
  requestBindingSha256
} = {}) {
  if (!executionIntent || typeof executionIntent !== "object" || Array.isArray(executionIntent)) {
    return { ok: true, expectedRequestSha256: null };
  }

  const intentRequestSha256 = normalizeSha256(executionIntent?.requestFingerprint?.requestSha256);
  if (!intentRequestSha256) {
    return fail({
      code: "X402_EXECUTION_INTENT_REQUEST_MISMATCH",
      message: "execution intent request fingerprint does not match request binding",
      details: { expectedRequestSha256: null, requestBindingSha256: normalizeSha256(requestBindingSha256) }
    });
  }

  const mode = typeof requestBindingMode === "string" ? requestBindingMode.trim().toLowerCase() : null;
  if (mode !== "strict") {
    return fail({
      code: "X402_EXECUTION_INTENT_REQUEST_BINDING_REQUIRED",
      message: "execution intent requires strict request binding",
      details: { expectedRequestSha256: intentRequestSha256, requestBindingMode: mode }
    });
  }

  const normalizedBindingSha256 = normalizeSha256(requestBindingSha256);
  if (!normalizedBindingSha256) {
    return fail({
      code: "X402_EXECUTION_INTENT_REQUEST_BINDING_REQUIRED",
      message: "execution intent requires strict request binding",
      details: { expectedRequestSha256: intentRequestSha256, requestBindingMode: mode, requestBindingSha256: null }
    });
  }
  if (intentRequestSha256 !== normalizedBindingSha256) {
    return fail({
      code: "X402_EXECUTION_INTENT_REQUEST_MISMATCH",
      message: "execution intent request fingerprint does not match request binding",
      details: { expectedRequestSha256: intentRequestSha256, requestBindingSha256: normalizedBindingSha256 }
    });
  }

  return { ok: true, expectedRequestSha256: intentRequestSha256 };
}
