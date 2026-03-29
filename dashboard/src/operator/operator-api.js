/**
 * Shared HTTP client for the operator console.
 * This is intentionally separate from the product api.js — the operator
 * dashboard talks directly to the control plane with its own auth headers.
 */

export function looksLikeHtmlDocument(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized.startsWith("<!doctype html") || normalized.startsWith("<html");
}

export function createRequestContractError({ response, code, message, details = null } = {}) {
  const error = new Error(message);
  error.status = response?.status ?? null;
  error.code = code;
  error.details = details;
  return error;
}

export async function requestJson({ baseUrl, pathname, method = "GET", headers, body = null }) {
  const url = `${String(baseUrl).replace(/\/$/, "")}${pathname}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body === null ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (res.ok) {
    const contentType = String(res.headers.get("content-type") ?? "").toLowerCase();
    if (typeof parsed === "string" && parsed.trim()) {
      if (looksLikeHtmlDocument(parsed)) {
        throw createRequestContractError({
          response: res,
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
          response: res,
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
  if (!res.ok) {
    const message = typeof parsed === "object" && parsed !== null
      ? String(parsed?.message ?? parsed?.error ?? `HTTP ${res.status}`)
      : String(parsed ?? `HTTP ${res.status}`);
    throw new Error(message);
  }
  return parsed;
}
