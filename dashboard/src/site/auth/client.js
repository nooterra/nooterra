const DEFAULT_AUTH_BASE_URL =
  typeof import.meta !== "undefined" && import.meta.env?.VITE_SETTLD_AUTH_BASE_URL
    ? String(import.meta.env.VITE_SETTLD_AUTH_BASE_URL).trim()
    : "/__magic";

const DEFAULT_TENANT_ID =
  typeof import.meta !== "undefined" && import.meta.env?.VITE_SETTLD_AUTH_TENANT_ID
    ? String(import.meta.env.VITE_SETTLD_AUTH_TENANT_ID).trim()
    : typeof import.meta !== "undefined" && import.meta.env?.VITE_SETTLD_TENANT_ID
      ? String(import.meta.env.VITE_SETTLD_TENANT_ID).trim()
    : "tenant_default";

function sanitizeBaseUrl(baseUrl = "") {
  const normalized = String(baseUrl ?? "").trim() || DEFAULT_AUTH_BASE_URL;
  return normalized.replace(/\/$/, "");
}

function normalizeTenantId(tenantId = "") {
  return String(tenantId ?? "").trim() || DEFAULT_TENANT_ID;
}

async function requestJson({ baseUrl, pathname, method = "GET", body } = {}) {
  const base = sanitizeBaseUrl(baseUrl);
  let res;
  try {
    res = await fetch(`${base}${pathname}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-settld-protocol": "1.0"
      },
      credentials: "include",
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    const error = new Error("Could not reach Settld API. Check API base URL and proxy/CORS setup.");
    error.status = 0;
    throw error;
  }
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const error = new Error(
      typeof parsed?.message === "string"
        ? parsed.message
        : typeof parsed?.error === "string"
          ? parsed.error
          : `HTTP ${res.status}`
    );
    error.status = res.status;
    error.payload = parsed;
    throw error;
  }
  return parsed ?? {};
}

export function getAuthDefaults() {
  return {
    apiBaseUrl: sanitizeBaseUrl(DEFAULT_AUTH_BASE_URL),
    tenantId: normalizeTenantId(DEFAULT_TENANT_ID)
  };
}

export async function createPublicWorkspace({ apiBaseUrl, company, email, fullName = "", tenantId = "" } = {}) {
  return requestJson({
    baseUrl: apiBaseUrl,
    pathname: "/v1/public/signup",
    method: "POST",
    body: {
      company: String(company ?? "").trim(),
      email: String(email ?? "").trim().toLowerCase(),
      fullName: String(fullName ?? "").trim(),
      tenantId: String(tenantId ?? "").trim() || undefined
    }
  });
}

export async function requestBuyerOtp({ apiBaseUrl, tenantId, email }) {
  const tenant = normalizeTenantId(tenantId);
  return requestJson({
    baseUrl: apiBaseUrl,
    pathname: `/v1/tenants/${encodeURIComponent(tenant)}/buyer/login/otp`,
    method: "POST",
    body: { email: String(email ?? "").trim().toLowerCase() }
  });
}

export async function verifyBuyerOtp({ apiBaseUrl, tenantId, email, code }) {
  const tenant = normalizeTenantId(tenantId);
  return requestJson({
    baseUrl: apiBaseUrl,
    pathname: `/v1/tenants/${encodeURIComponent(tenant)}/buyer/login`,
    method: "POST",
    body: {
      email: String(email ?? "").trim().toLowerCase(),
      code: String(code ?? "").trim()
    }
  });
}

export async function fetchBuyerMe({ apiBaseUrl } = {}) {
  return requestJson({
    baseUrl: apiBaseUrl,
    pathname: "/v1/buyer/me",
    method: "GET"
  });
}

export async function logoutBuyerSession({ apiBaseUrl } = {}) {
  return requestJson({
    baseUrl: apiBaseUrl,
    pathname: "/v1/buyer/logout",
    method: "POST",
    body: {}
  });
}
