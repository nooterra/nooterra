const SESSION_KEY = "settld_site_session_v1";
const SESSION_EVENT = "settld-site-session-updated";

export function readSession() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const email = typeof parsed.email === "string" ? parsed.email.trim() : "";
    if (!email) return null;
    return {
      email,
      role: typeof parsed.role === "string" ? parsed.role.trim() : "viewer",
      tenantId: typeof parsed.tenantId === "string" ? parsed.tenantId.trim() : "tenant_default",
      authMode: typeof parsed.authMode === "string" ? parsed.authMode.trim() : "buyer_otp",
      apiBaseUrl: typeof parsed.apiBaseUrl === "string" ? parsed.apiBaseUrl.trim() : "",
      fullName: typeof parsed.fullName === "string" ? parsed.fullName.trim() : "",
      company: typeof parsed.company === "string" ? parsed.company.trim() : "",
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString()
    };
  } catch {
    return null;
  }
}

export function writeSession({
  email,
  fullName = "",
  company = "",
  role = "viewer",
  tenantId = "tenant_default",
  authMode = "buyer_otp",
  apiBaseUrl = ""
} = {}) {
  if (typeof window === "undefined") return null;
  const emailNorm = String(email ?? "").trim().toLowerCase();
  if (!emailNorm) return null;
  const next = {
    email: emailNorm,
    role: String(role ?? "viewer").trim().toLowerCase() || "viewer",
    tenantId: String(tenantId ?? "tenant_default").trim() || "tenant_default",
    authMode: String(authMode ?? "buyer_otp").trim() || "buyer_otp",
    apiBaseUrl: String(apiBaseUrl ?? "").trim(),
    fullName: String(fullName ?? "").trim(),
    company: String(company ?? "").trim(),
    createdAt: new Date().toISOString()
  };
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(SESSION_EVENT, { detail: { session: next } }));
  return next;
}

export function clearSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SESSION_KEY);
  window.dispatchEvent(new CustomEvent(SESSION_EVENT, { detail: { session: null } }));
}

export function subscribeSession(listener) {
  if (typeof window === "undefined") return () => {};
  if (typeof listener !== "function") return () => {};
  const handleStorage = () => listener(readSession());
  const handleCustom = (event) => {
    const session = event?.detail?.session ?? null;
    listener(session);
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(SESSION_EVENT, handleCustom);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(SESSION_EVENT, handleCustom);
  };
}
