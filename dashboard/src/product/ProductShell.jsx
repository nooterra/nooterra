import { useEffect, useRef, useState, useCallback } from "react";
import {
  decideApprovalInboxItem,
  DEFAULT_AUTH_BASE_URL,
  fetchApprovalInbox,
  fetchTenantSettings,
  fetchWorkOrderReceipts,
  fetchWorkOrderReceiptDetail,
  formatDateTime,
  formatCurrency,
  generateBrowserEd25519KeypairPem,
  loadRuntimeConfig,
  loadStoredBuyerPasskeyBundle,
  PRODUCT_RUNTIME_STORAGE_KEY,
  requestJson,
  saveStoredBuyerPasskeyBundle,
  signBrowserPasskeyChallengeBase64Url,
  touchStoredBuyerPasskeyBundle,
  updateTenantSettings,
} from "./api.js";
import "./product.css";

/* ═══════════════════════════════════════════════════════════
   Constants & helpers
   ═══════════════════════════════════════════════════════════ */

const ONBOARDING_STORAGE_KEY = "nooterra_product_onboarding_v1";
const THEME_STORAGE_KEY = "nooterra_theme";
const AUTH_BASE = "/__magic";
const WORKER_API_BASE = "/__nooterra";

const RECOMMENDED_MODELS = [
  { id: "google/gemini-3-flash", name: "Gemini 3 Flash", inputPer1M: 0.50, outputPer1M: 3.00, tag: "Fast & cheap" },
  { id: "google/gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", inputPer1M: 2.00, outputPer1M: 12.00, tag: "Smartest" },
  { id: "openai/gpt-5.4", name: "GPT-5.4", inputPer1M: 2.50, outputPer1M: 15.00, tag: "Best for agents" },
  { id: "anthropic/claude-sonnet-4.6", name: "Claude Sonnet 4.6", inputPer1M: 3.00, outputPer1M: 15.00, tag: "Best for writing" },
  { id: "anthropic/claude-haiku-4.5", name: "Claude Haiku 4.5", inputPer1M: 1.00, outputPer1M: 5.00, tag: "Budget" },
  { id: "openai/gpt-5.4-mini", name: "GPT-5.4 Mini", inputPer1M: 0.75, outputPer1M: 4.50, tag: "High volume" },
];

const STARTER_TEMPLATES = [
  {
    id: "support-monitor",
    name: "Support Monitor",
    description: "Watch your inbox and draft replies for common questions.",
    charter: {
      canDo: ["Read incoming emails", "Categorize by topic", "Draft reply templates", "Search knowledge base"],
      askFirst: ["Send replies to customers", "Forward to team members", "Issue refunds"],
      neverDo: ["Delete emails", "Share customer data", "Make commitments about features"],
    },
    schedule: { type: "continuous" },
    model: "google/gemini-3-flash",
  },
  {
    id: "price-tracker",
    name: "Price Tracker",
    description: "Monitor competitor pricing pages daily and alert you on changes.",
    charter: {
      canDo: ["Check competitor websites", "Compare current vs previous prices", "Send alerts to Slack"],
      askFirst: ["Adjust your prices", "Send alerts to customers"],
      neverDo: ["Access payment systems", "Share competitor data externally"],
    },
    schedule: { type: "cron", value: "0 9 * * *" },
    model: "google/gemini-3-flash",
  },
  {
    id: "inbox-summary",
    name: "Inbox Summary",
    description: "Summarize your emails every morning and send a digest.",
    charter: {
      canDo: ["Read all emails from the last 24 hours", "Categorize by priority", "Generate summary"],
      askFirst: ["Send digest to Slack or email", "Archive processed emails"],
      neverDo: ["Delete emails", "Reply on your behalf", "Forward to external contacts"],
    },
    schedule: { type: "cron", value: "0 8 * * 1-5" },
    model: "google/gemini-3-flash",
  },
];

function cls(...args) { return args.filter(Boolean).join(" "); }

function timeAgo(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function saveRuntime(config) {
  try { localStorage.setItem(PRODUCT_RUNTIME_STORAGE_KEY, JSON.stringify(config)); } catch { /* ignore */ }
}

function loadOnboardingState() {
  try { return JSON.parse(localStorage.getItem(ONBOARDING_STORAGE_KEY) || "null") || null; } catch { return null; }
}

function saveOnboardingState(state) {
  try { localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

function loadTheme() {
  try { return localStorage.getItem(THEME_STORAGE_KEY) || "dark"; } catch { return "dark"; }
}

function saveTheme(theme) {
  try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* ignore */ }
  applyTheme(theme);
}

function applyTheme(theme) { document.documentElement.setAttribute("data-theme", theme); }

function navigate(path) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/* ── Worker API helpers ──────────────────────────────────── */

async function workerApiRequest({ pathname, method = "GET", body = null }) {
  const runtime = loadRuntimeConfig();
  return requestJson({
    baseUrl: WORKER_API_BASE,
    pathname,
    method,
    headers: { "x-tenant-id": runtime.tenantId, "content-type": "application/json" },
    body,
    credentials: "include",
  });
}

/* ── Auth helpers ────────────────────────────────────────── */

async function authRequest({ pathname, method = "POST", body = null }) {
  return requestJson({
    baseUrl: AUTH_BASE,
    pathname,
    method,
    headers: { "content-type": "application/json" },
    body,
    credentials: "include",
  });
}

async function fetchSessionPrincipal() {
  return authRequest({ pathname: "/v1/buyer/me", method: "GET" });
}

async function logoutSession() {
  try { await authRequest({ pathname: "/v1/buyer/logout", method: "POST" }); } catch { /* ignore */ }
}

/* ── Template deploy helper ──────────────────────────────── */

function templateScheduleToApiValue(schedule) {
  if (!schedule) return "daily";
  if (schedule.type === "continuous") return "continuous";
  if (schedule.type === "interval") return schedule.value || "1h";
  if (schedule.type === "cron") return schedule.value || "0 9 * * *";
  return "on_demand";
}

/* ═══════════════════════════════════════════════════════════
   Shared inline styles
   ═══════════════════════════════════════════════════════════ */

const S = {
  shell: { minHeight: "100vh", background: "var(--bg-primary)", color: "var(--text-primary)", fontFamily: "var(--font-body)", WebkitFontSmoothing: "antialiased" },
  authWrap: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" },
  authBox: { width: "100%", maxWidth: 400 },
  authTitle: { fontSize: "clamp(1.6rem, 4vw, 2rem)", fontWeight: 700, color: "var(--text-primary)", marginBottom: "0.5rem", lineHeight: 1.15 },
  authSub: { fontSize: "0.95rem", color: "var(--text-secondary)", marginBottom: "2.5rem", lineHeight: 1.5 },
  label: { display: "block", fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", marginBottom: "0.4rem", letterSpacing: "0.05em", textTransform: "uppercase" },
  input: { display: "block", width: "100%", padding: "0.75rem 1rem", fontSize: "15px", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-primary)", outline: "none", marginBottom: "1.25rem", fontFamily: "inherit", transition: "border-color 0.15s", boxSizing: "border-box" },
  inputFocus: { borderColor: "var(--gold)" },
  btnPrimary: { display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0.75rem 1.75rem", fontSize: "0.9rem", fontWeight: 600, background: "var(--gold)", color: "#1a1a1a", border: "none", borderRadius: 8, cursor: "pointer", letterSpacing: "0.01em", transition: "background 0.15s, opacity 0.15s", width: "100%", fontFamily: "inherit" },
  btnSecondary: { display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0.6rem 1.25rem", fontSize: "0.85rem", fontWeight: 600, background: "transparent", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", transition: "border-color 0.15s", fontFamily: "inherit" },
  btnGhost: { background: "none", border: "none", color: "var(--gold)", cursor: "pointer", fontSize: "0.85rem", fontWeight: 500, padding: 0, fontFamily: "inherit" },
  link: { color: "var(--gold)", textDecoration: "none", fontSize: "0.85rem", fontWeight: 500 },
  error: { fontSize: "0.85rem", color: "#c97055", marginBottom: "1rem" },
  success: { fontSize: "0.85rem", color: "#5bb98c", marginBottom: "1rem" },
  appLayout: { display: "flex", minHeight: "100vh" },
  main: { flex: 1, padding: "2.5rem 3rem", maxWidth: 960 },
  pageTitle: { fontSize: "clamp(1.4rem, 3vw, 1.75rem)", fontWeight: 700, color: "var(--text-primary)", marginBottom: "0.3rem" },
  pageSub: { fontSize: "0.9rem", color: "var(--text-secondary)", marginBottom: "2rem" },
  workerRow: { display: "grid", gridTemplateColumns: "1fr auto auto auto auto", alignItems: "center", gap: "1.5rem", padding: "1rem 0", borderBottom: "1px solid var(--border)", cursor: "pointer", transition: "background 0.1s" },
  workerName: { fontSize: "15px", fontWeight: 600, color: "var(--text-primary)" },
  workerMeta: { fontSize: "13px", color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" },
  statusDot: (color) => ({ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: color, marginRight: 6, verticalAlign: "middle", flexShrink: 0 }),
  charterSection: { marginBottom: "1.5rem" },
  charterLabel: { fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.5rem" },
  charterItem: { fontSize: "14px", color: "var(--text-secondary)", padding: "0.3rem 0", lineHeight: 1.6 },
  approvalRow: { padding: "1.25rem 0", borderBottom: "1px solid var(--border)" },
  textarea: { display: "block", width: "100%", padding: "0.75rem 1rem", fontSize: "15px", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-primary)", outline: "none", fontFamily: "inherit", resize: "vertical", minHeight: 120, lineHeight: 1.6, marginBottom: "1.25rem", boxSizing: "border-box" },
  logEntry: { padding: "0.75rem 0", borderBottom: "1px solid var(--border)" },
  logTime: { fontSize: "13px", color: "var(--text-tertiary)", fontVariantNumeric: "tabular-nums" },
  logSummary: { fontSize: "14px", color: "var(--text-secondary)", marginTop: "0.2rem", lineHeight: 1.6 },
  logDetail: { fontSize: "13px", color: "var(--text-tertiary)", marginTop: "0.4rem", lineHeight: 1.6, whiteSpace: "pre-wrap", padding: "0.75rem 1rem", background: "var(--bg-surface)", borderRadius: 6 },
  backLink: { display: "inline-block", fontSize: "13px", fontWeight: 500, color: "var(--text-secondary)", marginBottom: "2rem", cursor: "pointer", background: "none", border: "none", padding: 0, fontFamily: "inherit" },
  otpInput: { display: "block", width: "100%", padding: "0.75rem 1rem", fontSize: "1.5rem", fontWeight: 700, letterSpacing: "0.5em", textAlign: "center", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-primary)", outline: "none", marginBottom: "1.25rem", fontFamily: "inherit", transition: "border-color 0.15s", boxSizing: "border-box" },
  pricingWrap: { minHeight: "100vh", padding: "6rem 2rem 4rem", maxWidth: 1100, margin: "0 auto" },
  pricingTitle: { fontSize: "clamp(2rem, 5vw, 3rem)", fontWeight: 700, color: "var(--text-primary)", marginBottom: "0.75rem", lineHeight: 1.1 },
  tier: { padding: "2.5rem 0", borderBottom: "1px solid var(--border)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3rem", alignItems: "start" },
  tierName: { fontSize: "1.25rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: "0.3rem" },
  tierPrice: { fontSize: "15px", color: "var(--text-secondary)", marginBottom: "1rem" },
  tierFeature: { fontSize: "14px", color: "var(--text-secondary)", padding: "0.25rem 0", lineHeight: 1.6 },
};

const STATUS_COLORS = {
  running: "#5bb98c",
  paused: "var(--gold)",
  ready: "var(--text-tertiary)",
  error: "#c97055",
};

/* ═══════════════════════════════════════════════════════════
   FocusInput
   ═══════════════════════════════════════════════════════════ */

function FocusInput({ style, ...props }) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      {...props}
      style={{ ...S.input, ...style, ...(focused ? S.inputFocus : {}) }}
      onFocus={(e) => { setFocused(true); props.onFocus?.(e); }}
      onBlur={(e) => { setFocused(false); props.onBlur?.(e); }}
    />
  );
}

/* ═══════════════════════════════════════════════════════════
   Inline SVG icons
   ═══════════════════════════════════════════════════════════ */

function HamburgerIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" style={{ display: "block" }}>
      <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SendArrow({ disabled, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 32, height: 32, borderRadius: "50%",
        background: disabled ? "var(--bg-hover)" : "var(--text-primary)",
        border: "none", cursor: disabled ? "default" : "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0, transition: "opacity 150ms",
        opacity: disabled ? 0.3 : 1,
      }}
      aria-label="Send"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ display: "block" }}>
        <path d="M8 12V4M4 8l4-4 4 4" stroke={disabled ? "var(--text-tertiary)" : "var(--bg-primary)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════
   AUTH: SignUpView
   ═══════════════════════════════════════════════════════════ */

function SignUpView({ onAuth }) {
  const [step, setStep] = useState("form");
  const [email, setEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [signupResult, setSignupResult] = useState(null);

  async function handleSubmitForm(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      let passkeySuccess = false;
      try {
        const optionsResp = await authRequest({ pathname: "/v1/public/signup/passkey/options", body: { email: email.trim(), company: email.trim().split("@")[0] } });
        if (optionsResp?.challenge && optionsResp?.challengeId) {
          const keypair = await generateBrowserEd25519KeypairPem();
          const signature = await signBrowserPasskeyChallengeBase64Url({ privateKeyPem: keypair.privateKeyPem, challenge: optionsResp.challenge });
          const passkeyResp = await authRequest({
            pathname: "/v1/public/signup/passkey",
            body: { tenantId: optionsResp.tenantId, challengeId: optionsResp.challengeId, challenge: optionsResp.challenge, credentialId: keypair.keyId, publicKeyPem: keypair.publicKeyPem, signature, label: `${navigator.userAgent.split(" ").slice(-1)[0] || "Browser"} passkey` },
          });
          saveStoredBuyerPasskeyBundle({ tenantId: optionsResp.tenantId || passkeyResp?.tenantId, email: email.trim(), credentialId: keypair.keyId, publicKeyPem: keypair.publicKeyPem, privateKeyPem: keypair.privateKeyPem, keyId: keypair.keyId, label: "Browser passkey", createdAt: new Date().toISOString() });
          const principal = await fetchSessionPrincipal();
          const runtime = loadRuntimeConfig();
          const tenantId = optionsResp.tenantId || passkeyResp?.tenantId || principal?.tenantId || runtime.tenantId;
          saveRuntime({ ...runtime, tenantId });
          saveOnboardingState({ buyer: principal, sessionExpected: true, completed: true });
          passkeySuccess = true;
          onAuth?.("builder");
        }
      } catch { /* Passkey not supported -- fall through to OTP */ }
      if (!passkeySuccess) {
        const result = await authRequest({ pathname: "/v1/public/signup", body: { email: email.trim(), company: email.trim().split("@")[0] } });
        setSignupResult(result);
        setStep("otp");
      }
    } catch (err) {
      setError(err?.message || "Sign up failed. Please try again.");
    } finally { setLoading(false); }
  }

  async function handleSubmitOtp(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const tenantId = signupResult?.tenantId;
      if (tenantId) {
        await authRequest({ pathname: `/v1/tenants/${encodeURIComponent(tenantId)}/buyer/login`, body: { email: email.trim(), code: otpCode.trim() } });
      }
      const principal = await fetchSessionPrincipal();
      const runtime = loadRuntimeConfig();
      saveRuntime({ ...runtime, tenantId: tenantId || principal?.tenantId || runtime.tenantId });
      saveOnboardingState({ buyer: principal, sessionExpected: true, completed: true });
      try {
        const keypair = await generateBrowserEd25519KeypairPem();
        const optionsResp = await authRequest({ pathname: `/v1/tenants/${encodeURIComponent(tenantId)}/buyer/login/passkey/options`, body: { email: email.trim(), company: email.trim().split("@")[0] } });
        if (optionsResp?.challenge && optionsResp?.challengeId) {
          const signature = await signBrowserPasskeyChallengeBase64Url({ privateKeyPem: keypair.privateKeyPem, challenge: optionsResp.challenge });
          await authRequest({ pathname: `/v1/tenants/${encodeURIComponent(tenantId)}/buyer/login/passkey`, body: { challengeId: optionsResp.challengeId, challenge: optionsResp.challenge, credentialId: keypair.keyId, publicKeyPem: keypair.publicKeyPem, signature, label: "Browser passkey" } });
          saveStoredBuyerPasskeyBundle({ tenantId, email: email.trim(), credentialId: keypair.keyId, publicKeyPem: keypair.publicKeyPem, privateKeyPem: keypair.privateKeyPem, keyId: keypair.keyId, label: "Browser passkey", createdAt: new Date().toISOString() });
        }
      } catch { /* Passkey registration is optional */ }
      onAuth?.("builder");
    } catch (err) {
      setError(err?.message || "Invalid code. Please try again.");
    } finally { setLoading(false); }
  }

  if (step === "otp") {
    return (
      <div style={S.authWrap}>
        <div style={S.authBox} className="lovable-fade">
          <h1 style={S.authTitle}>Check your email</h1>
          <p style={S.authSub}>We sent a 6-digit code to <strong style={{ color: "var(--text-primary)" }}>{email}</strong>. Enter it below to verify your account.</p>
          {error && <div style={S.error}>{error}</div>}
          <form onSubmit={handleSubmitOtp}>
            <label style={S.label}>Verification code</label>
            <input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otpCode} onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" required autoFocus style={{ ...S.otpInput, ...(otpCode.length === 6 ? { borderColor: "var(--gold)" } : {}) }} />
            <button type="submit" style={{ ...S.btnPrimary, opacity: loading || otpCode.length < 6 ? 0.5 : 1 }} disabled={loading || otpCode.length < 6}>{loading ? "Verifying..." : "Verify and continue"}</button>
          </form>
          <p style={{ ...S.authSub, marginTop: "1.5rem", marginBottom: 0, fontSize: "13px" }}>
            Didn't receive a code?{" "}
            <button style={S.btnGhost} onClick={async () => { setError(""); try { await authRequest({ pathname: "/v1/public/signup", body: { email: email.trim(), company: email.trim().split("@")[0] } }); } catch { /* ignore */ } }}>Resend</button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={S.authWrap}>
      <div style={S.authBox} className="lovable-fade">
        <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: "2rem", letterSpacing: "-0.01em" }}>nooterra</div>
        <h1 style={S.authTitle}>Get started</h1>
        <p style={S.authSub}>We'll send a verification code to your email. No password needed.</p>
        {error && <div style={S.error}>{error}</div>}
        <form onSubmit={handleSubmitForm}>
          <label style={S.label}>Email</label>
          <FocusInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required autoFocus />
          <button type="submit" style={{ ...S.btnPrimary, opacity: loading ? 0.6 : 1 }} disabled={loading || !email.trim()}>{loading ? "One moment..." : "Continue \u2192"}</button>
        </form>
        <p style={{ ...S.authSub, marginTop: "1.5rem", marginBottom: 0 }}>
          Already have an account?{" "}
          <a href="/login" style={S.link} onClick={(e) => { e.preventDefault(); navigate("/login"); }}>Sign in</a>
        </p>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   AUTH: SignInView
   ═══════════════════════════════════════════════════════════ */

function SignInView({ onAuth }) {
  const [step, setStep] = useState("form");
  const [tenantId, setTenantId] = useState("");
  const [email, setEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasStoredPasskey, setHasStoredPasskey] = useState(false);

  useEffect(() => {
    try {
      const stored = loadStoredBuyerPasskeyBundle({});
      if (stored && stored.tenantId && stored.email) {
        setTenantId(stored.tenantId);
        setEmail(stored.email);
        setHasStoredPasskey(true);
      }
    } catch { /* ignore */ }
  }, []);

  async function handlePasskeyLogin() {
    setError(""); setLoading(true);
    const tid = tenantId.trim(); const em = email.trim();
    try {
      const storedPasskey = loadStoredBuyerPasskeyBundle({ tenantId: tid, email: em });
      if (!storedPasskey) { setError("No stored passkey found. Please use email sign-in."); setLoading(false); return; }
      const optionsResp = await authRequest({ pathname: `/v1/tenants/${encodeURIComponent(tid)}/buyer/login/passkey/options`, body: { email: em } });
      if (optionsResp?.challenge && optionsResp?.challengeId) {
        const signature = await signBrowserPasskeyChallengeBase64Url({ privateKeyPem: storedPasskey.privateKeyPem, challenge: optionsResp.challenge });
        await authRequest({ pathname: `/v1/tenants/${encodeURIComponent(tid)}/buyer/login/passkey`, body: { challengeId: optionsResp.challengeId, challenge: optionsResp.challenge, credentialId: storedPasskey.credentialId, publicKeyPem: storedPasskey.publicKeyPem, signature } });
        touchStoredBuyerPasskeyBundle({ tenantId: tid, email: em });
        const principal = await fetchSessionPrincipal();
        const runtime = loadRuntimeConfig();
        saveRuntime({ ...runtime, tenantId: tid });
        saveOnboardingState({ buyer: principal, sessionExpected: true, completed: true });
        onAuth?.("dashboard");
        return;
      }
      setError("Passkey authentication failed. Try email sign-in instead.");
    } catch (err) { setError(err?.message || "Passkey sign-in failed. Try email sign-in instead."); }
    finally { setLoading(false); }
  }

  async function handleSubmit(e) {
    e.preventDefault(); setError(""); setLoading(true);
    const tid = tenantId.trim(); const em = email.trim();
    try {
      const storedPasskey = loadStoredBuyerPasskeyBundle({ tenantId: tid, email: em });
      if (storedPasskey) {
        const optionsResp = await authRequest({ pathname: `/v1/tenants/${encodeURIComponent(tid)}/buyer/login/passkey/options`, body: { email: em } });
        if (optionsResp?.challenge && optionsResp?.challengeId) {
          const signature = await signBrowserPasskeyChallengeBase64Url({ privateKeyPem: storedPasskey.privateKeyPem, challenge: optionsResp.challenge });
          await authRequest({ pathname: `/v1/tenants/${encodeURIComponent(tid)}/buyer/login/passkey`, body: { challengeId: optionsResp.challengeId, challenge: optionsResp.challenge, credentialId: storedPasskey.credentialId, publicKeyPem: storedPasskey.publicKeyPem, signature } });
          touchStoredBuyerPasskeyBundle({ tenantId: tid, email: em });
          const principal = await fetchSessionPrincipal();
          const runtime = loadRuntimeConfig();
          saveRuntime({ ...runtime, tenantId: tid });
          saveOnboardingState({ buyer: principal, sessionExpected: true, completed: true });
          onAuth?.("dashboard");
          return;
        }
      }
      await authRequest({ pathname: `/v1/tenants/${encodeURIComponent(tid)}/buyer/login/otp`, body: { email: em } });
      setStep("otp");
    } catch (err) { setError(err?.message || "Sign in failed. Check your credentials."); }
    finally { setLoading(false); }
  }

  async function handleSubmitOtp(e) {
    e.preventDefault(); setError(""); setLoading(true);
    const tid = tenantId.trim(); const em = email.trim();
    try {
      await authRequest({ pathname: `/v1/tenants/${encodeURIComponent(tid)}/buyer/login`, body: { email: em, code: otpCode.trim() } });
      const principal = await fetchSessionPrincipal();
      const runtime = loadRuntimeConfig();
      saveRuntime({ ...runtime, tenantId: tid });
      saveOnboardingState({ buyer: principal, sessionExpected: true, completed: true });
      onAuth?.("dashboard");
    } catch (err) { setError(err?.message || "Invalid code. Please try again."); }
    finally { setLoading(false); }
  }

  if (step === "otp") {
    return (
      <div style={S.authWrap}>
        <div style={S.authBox} className="lovable-fade">
          <h1 style={S.authTitle}>Check your email</h1>
          <p style={S.authSub}>We sent a 6-digit code to <strong style={{ color: "var(--text-primary)" }}>{email}</strong>.</p>
          {error && <div style={S.error}>{error}</div>}
          <form onSubmit={handleSubmitOtp}>
            <label style={S.label}>Verification code</label>
            <input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otpCode} onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" required autoFocus style={{ ...S.otpInput, ...(otpCode.length === 6 ? { borderColor: "var(--gold)" } : {}) }} />
            <button type="submit" style={{ ...S.btnPrimary, opacity: loading || otpCode.length < 6 ? 0.5 : 1 }} disabled={loading || otpCode.length < 6}>{loading ? "Verifying..." : "Sign in"}</button>
          </form>
          <p style={{ ...S.authSub, marginTop: "1.5rem", marginBottom: 0, fontSize: "13px" }}>
            <button style={S.btnGhost} onClick={() => { setStep("form"); setOtpCode(""); setError(""); }}>Back to login</button>
          </p>
        </div>
      </div>
    );
  }

  if (hasStoredPasskey) {
    return (
      <div style={S.authWrap}>
        <div style={S.authBox} className="lovable-fade">
          <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: "2rem", letterSpacing: "-0.01em" }}>nooterra</div>
          <h1 style={S.authTitle}>Welcome back</h1>
          <p style={S.authSub}>Signing in as <strong style={{ color: "var(--text-primary)" }}>{email}</strong></p>
          {error && <div style={S.error}>{error}</div>}
          <button style={{ ...S.btnPrimary, opacity: loading ? 0.6 : 1, marginBottom: "1rem" }} disabled={loading} onClick={handlePasskeyLogin}>{loading ? "Signing in..." : "Sign in with passkey"}</button>
          <p style={{ ...S.authSub, marginTop: "1rem", marginBottom: 0, fontSize: "13px" }}>
            Not you?{" "}
            <button style={S.btnGhost} onClick={() => { setHasStoredPasskey(false); setTenantId(""); setEmail(""); setError(""); }}>Use a different account</button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={S.authWrap}>
      <div style={S.authBox} className="lovable-fade">
        <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: "2rem", letterSpacing: "-0.01em" }}>nooterra</div>
        <h1 style={S.authTitle}>Welcome back</h1>
        <p style={S.authSub}>Sign in to your account.</p>
        {error && <div style={S.error}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label style={S.label}>Email</label>
          <FocusInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required autoFocus />
          <label style={S.label}>Your account ID</label>
          <FocusInput type="text" value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="tenant_abc123" required />
          <p style={{ fontSize: "12px", color: "var(--text-tertiary)", marginTop: "-0.75rem", marginBottom: "1.25rem", lineHeight: 1.4 }}>Check your signup email for this.</p>
          <button type="submit" style={{ ...S.btnPrimary, opacity: loading ? 0.6 : 1 }} disabled={loading}>{loading ? "Signing in..." : "Sign in"}</button>
        </form>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "1.5rem" }}>
          <a href="/signup" style={S.link} onClick={(e) => { e.preventDefault(); navigate("/signup"); }}>Create account</a>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   BUILDER: Inference logic
   ═══════════════════════════════════════════════════════════ */

const CAPABILITY_CATALOG = {
  browser:    { id: "browser",    name: "Web Browser",    category: "browsing",      requiredAuth: null,             label: "Browse websites and extract content" },
  slack:      { id: "slack",      name: "Slack",          category: "communication", requiredAuth: "oauth_or_token", label: "Send and read Slack messages" },
  email:      { id: "email",      name: "Email (Gmail)",  category: "communication", requiredAuth: "oauth",          label: "Read and send emails" },
  github:     { id: "github",     name: "GitHub",         category: "development",   requiredAuth: "oauth_or_token", label: "Repos, issues, pull requests" },
  filesystem: { id: "filesystem", name: "File System",    category: "development",   requiredAuth: null,             label: "Read and write local files" },
  webSearch:  { id: "webSearch",  name: "Web Search",     category: "search",        requiredAuth: null,             label: "Search the web" },
  memory:     { id: "memory",     name: "Worker Memory",  category: "core",          requiredAuth: null,             label: "Persistent memory across runs" },
};

function inferCapabilities(taskDescription) {
  const desc = taskDescription.toLowerCase();
  const ids = [];
  if (/browse|website|web page|scrape|url|http|click|form|screenshot|price|competitor|amazon|ebay|linkedin|twitter|reddit|news|blog|article|review/.test(desc)) ids.push("browser");
  if (/slack|channel|message|dm|thread/.test(desc)) ids.push("slack");
  if (/email|inbox|gmail|outlook|send mail|mail/.test(desc)) ids.push("email");
  if (/github|\brepo(?:sitory)?\b|issue|pull request|pull_request|\bpr\b|commit|branch|merge/.test(desc)) ids.push("github");
  if (/file|folder|directory|read file|write file|local/.test(desc)) ids.push("filesystem");
  if (/search|google|find|lookup|research/.test(desc)) ids.push("webSearch");
  if (/remember|track|history|previous|last time|context/.test(desc)) ids.push("memory");
  return [...new Set(ids)].map(id => CAPABILITY_CATALOG[id]).filter(Boolean);
}

function inferCharterRules(taskDescription, capabilities) {
  const rules = { canDo: [], askFirst: [], neverDo: [] };
  const desc = taskDescription.toLowerCase();
  for (const cap of capabilities) {
    switch (cap.id) {
      case "browser": rules.canDo.push("Browse websites and fetch web pages"); rules.canDo.push("Extract content from pages"); rules.askFirst.push("Fill forms or submit data on websites"); break;
      case "slack": rules.canDo.push("Read messages from allowed channels"); rules.canDo.push("Send messages to allowed channels"); rules.askFirst.push("Send direct messages to individuals"); rules.neverDo.push("Post to channels not in the allowed list"); break;
      case "email": rules.canDo.push("Read emails matching search criteria"); if (/send|reply|forward/.test(desc)) rules.askFirst.push("Send emails"); rules.neverDo.push("Delete emails permanently"); break;
      case "github": rules.canDo.push("Read repository contents"); rules.canDo.push("Create and update issues"); rules.askFirst.push("Create or merge pull requests"); rules.neverDo.push("Delete branches or repositories"); break;
      case "filesystem": rules.canDo.push("Read files in allowed directories"); if (/write|create|save/.test(desc)) rules.canDo.push("Write files in allowed directories"); rules.neverDo.push("Access files outside allowed directories"); break;
      case "webSearch": rules.canDo.push("Search the web for information"); break;
      default: break;
    }
  }
  if (/monitor|watch|track|alert/.test(desc)) { rules.canDo.push("Monitor specified data sources continuously"); rules.canDo.push("Send alerts when conditions are met"); }
  if (/write|draft|create|generate/.test(desc)) { rules.canDo.push("Draft content based on instructions"); rules.askFirst.push("Publish or send drafted content"); rules.neverDo.push("Publish without human approval"); }
  if (/price|cost|budget|spend/.test(desc)) { rules.askFirst.push("Make purchases above threshold"); rules.neverDo.push("Exceed budget limits"); }
  rules.neverDo.push("Spend money without approval");
  rules.neverDo.push("Access credentials or keys directly");
  rules.canDo = [...new Set(rules.canDo)]; rules.askFirst = [...new Set(rules.askFirst)]; rules.neverDo = [...new Set(rules.neverDo)];
  return rules;
}

function inferSchedule(taskDescription) {
  const desc = taskDescription.toLowerCase();
  if (/continuous|always|24\/7|constantly/.test(desc)) return { type: "continuous", value: null, label: "Continuously" };
  const hourMatch = desc.match(/every\s+(\d+)\s*hours?/);
  if (hourMatch) return { type: "interval", value: `${hourMatch[1]}h`, label: `Every ${hourMatch[1]}h` };
  const minMatch = desc.match(/every\s+(\d+)\s*min(ute)?s?/);
  if (minMatch) return { type: "interval", value: `${minMatch[1]}m`, label: `Every ${minMatch[1]}m` };
  if (/hourly|every hour/.test(desc)) return { type: "interval", value: "1h", label: "Every hour" };
  if (/daily|every day|once a day/.test(desc)) return { type: "cron", value: "0 9 * * *", label: "Daily at 9 AM" };
  if (/weekly|every week/.test(desc)) return { type: "cron", value: "0 9 * * 1", label: "Weekly on Monday" };
  if (/monitor|watch|track|alert|check|scan/.test(desc)) return { type: "interval", value: "1h", label: "Every hour" };
  if (/morning|every morning/.test(desc)) return { type: "cron", value: "0 8 * * *", label: "Every morning at 8 AM" };
  return { type: "trigger", value: "on_demand", label: "On demand" };
}

function inferWorkerName(description) {
  const patterns = [
    /(?:monitor|check|watch|track)\s+(?:my\s+|our\s+|the\s+)?(.{3,30}?)(?:\s+and|\s+every|\s+daily|\s+hourly|$)/i,
    /(?:draft|write|create|generate)\s+(?:my\s+|our\s+|the\s+)?(.{3,30}?)(?:\s+and|\s+every|\s+daily|\s+hourly|$)/i,
    /(?:send|forward|post)\s+(?:my\s+|our\s+|the\s+)?(.{3,30}?)(?:\s+to|\s+and|\s+every|$)/i,
  ];
  for (const pat of patterns) {
    const m = description.match(pat);
    if (m && m[1]) {
      const words = m[1].trim().split(/\s+/).slice(0, 3);
      return words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ") + " Worker";
    }
  }
  const words = description.trim().split(/\s+/).filter(w => !["a", "an", "the", "my", "our", "to", "and", "or", "for", "in", "on", "at", "i", "we"].includes(w.toLowerCase())).slice(0, 3);
  if (words.length === 0) return "New Worker";
  return words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ") + " Worker";
}

function scheduleToApiValue(schedule) {
  if (!schedule) return "daily";
  if (schedule.type === "continuous") return "continuous";
  if (schedule.type === "interval") return schedule.value || "1h";
  if (schedule.type === "cron") return schedule.value || "0 9 * * *";
  return "on_demand";
}

/* ═══════════════════════════════════════════════════════════
   BUILDER: Worker definition parser
   ═══════════════════════════════════════════════════════════ */

const WORKER_DEF_REGEX = /\[WORKER_DEFINITION\]([\s\S]*?)\[\/WORKER_DEFINITION\]/;

function parseWorkerDefinition(text) {
  const match = text.match(WORKER_DEF_REGEX);
  if (!match) return null;
  const block = match[1];
  const lines = block.split("\n").map(l => l.trim()).filter(Boolean);
  const def = {};
  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const val = line.slice(colonIdx + 1).trim();
    if (key === "name") def.name = val;
    else if (key === "cando") def.canDo = val.split(",").map(s => s.trim()).filter(Boolean);
    else if (key === "askfirst") def.askFirst = val.split(",").map(s => s.trim()).filter(Boolean);
    else if (key === "neverdo") def.neverDo = val.split(",").map(s => s.trim()).filter(Boolean);
    else if (key === "schedule") def.schedule = val;
    else if (key === "model") def.model = val;
  }
  if (def.name && (def.canDo || def.askFirst || def.neverDo)) return def;
  return null;
}

function stripWorkerDefinitionBlock(text) {
  return text.replace(WORKER_DEF_REGEX, "").trim();
}

/* ═══════════════════════════════════════════════════════════
   CharterDisplay
   ═══════════════════════════════════════════════════════════ */

function CharterDisplay({ charter, compact = false }) {
  if (!charter) return null;
  const sections = [
    { key: "canDo", label: "Can do", color: "#5bb98c", items: charter.canDo || [] },
    { key: "askFirst", label: "Ask first", color: "var(--gold)", items: charter.askFirst || [] },
    { key: "neverDo", label: "Never do", color: "#c97055", items: charter.neverDo || [] },
  ];
  return (
    <div>
      {sections.map((sec) => sec.items.length > 0 ? (
        <div key={sec.key} style={{ marginBottom: compact ? "0.75rem" : "1.25rem" }}>
          <div style={{ ...S.charterLabel, color: sec.color, fontSize: compact ? "10px" : "11px" }}>{sec.label}</div>
          {sec.items.map((item, i) => (
            <div key={i} style={{ ...S.charterItem, fontSize: compact ? "13px" : "14px" }}>
              <span style={S.statusDot(sec.color)} />{item}
            </div>
          ))}
        </div>
      ) : null)}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   BuilderMessage -- single message in the chat
   ═══════════════════════════════════════════════════════════ */

function BuilderMessage({ msg, isStreaming, onDeployWorker }) {
  const isUser = msg.role === "user";

  if (isUser) {
    return (
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.75rem" }} className="lovable-fade">
        <div style={{
          maxWidth: "85%", padding: "12px 16px", borderRadius: 18,
          fontSize: "15px", lineHeight: 1.6, color: "var(--text-primary)",
          background: "var(--bg-surface)", wordBreak: "break-word",
        }}>{msg.content}</div>
      </div>
    );
  }

  // Parse worker definition if present
  const workerDef = msg.content ? parseWorkerDefinition(msg.content) : null;
  const displayContent = workerDef ? stripWorkerDefinitionBlock(msg.content) : msg.content;

  return (
    <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: "0.75rem" }} className="lovable-fade">
      <div style={{ maxWidth: "85%", fontSize: "15px", lineHeight: 1.6, color: "var(--text-primary)", wordBreak: "break-word", whiteSpace: "pre-wrap" }}>
        {displayContent}
        {isStreaming && <span style={{ display: "inline-block", width: 2, height: "1.1em", background: "var(--text-primary)", marginLeft: 1, verticalAlign: "text-bottom", animation: "blink 1s step-end infinite" }} />}

        {workerDef && !isStreaming && (
          <div style={{ marginTop: "1rem", padding: "1rem", borderRadius: 10, borderLeft: "2px solid var(--gold)" }}>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "0.75rem" }}>{workerDef.name}</div>
            <CharterDisplay charter={{ canDo: workerDef.canDo || [], askFirst: workerDef.askFirst || [], neverDo: workerDef.neverDo || [] }} compact />
            {workerDef.schedule && <div style={{ fontSize: "12px", color: "var(--text-tertiary)", marginBottom: "0.5rem" }}>Schedule: {workerDef.schedule}</div>}
            <button
              style={{ padding: "0.6rem 1.5rem", fontSize: "14px", fontWeight: 600, background: "var(--gold)", color: "#1a1a1a", border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", marginTop: "0.5rem" }}
              onClick={() => onDeployWorker?.(workerDef)}
            >Deploy this worker</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   AutoTextarea -- grows with content
   ═══════════════════════════════════════════════════════════ */

function AutoTextarea({ value, onChange, onKeyDown, placeholder, disabled, autoFocus }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = Math.min(ref.current.scrollHeight, 160) + "px";
    }
  }, [value]);

  return (
    <textarea ref={ref} value={value} onChange={onChange} onKeyDown={onKeyDown} placeholder={placeholder} disabled={disabled} autoFocus={autoFocus} rows={1}
      style={{
        width: "100%", padding: "14px 16px", paddingBottom: "2.75rem",
        fontSize: "15px", background: "transparent", border: "none",
        color: "var(--text-primary)", outline: "none", fontFamily: "inherit",
        resize: "none", lineHeight: "24px", overflow: "auto", boxSizing: "border-box",
      }}
    />
  );
}

/* ═══════════════════════════════════════════════════════════
   ModelDropdown -- popover dropdown for model selection
   ═══════════════════════════════════════════════════════════ */

function ModelDropdown({ model, onModelChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selectedModel = RECOMMENDED_MODELS.find(m => m.id === model);

  useEffect(() => {
    if (!open) return;
    function handleClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => setOpen(!open)} style={{
        background: "transparent", border: "none", color: "var(--text-secondary)",
        fontSize: "13px", padding: "4px 8px", cursor: "pointer", fontFamily: "inherit",
        display: "flex", alignItems: "center", gap: 4, borderRadius: 6,
      }}>
        {selectedModel?.name || "Select model"}
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" /></svg>
      </button>
      {open && (
        <div className="popover-animate" style={{
          position: "absolute", bottom: "100%", left: 0, marginBottom: 4,
          background: "var(--bg-surface)", border: "1px solid var(--border)",
          borderRadius: 12, boxShadow: "0 4px 24px rgba(0,0,0,0.15)",
          padding: "4px 0", zIndex: 50, minWidth: 300, maxWidth: 380,
        }}>
          {RECOMMENDED_MODELS.map(m => (
            <button key={m.id} onClick={() => { onModelChange(m.id); setOpen(false); }} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              width: "100%", padding: "8px 12px", fontSize: "14px",
              background: m.id === model ? "var(--bg-hover)" : "transparent",
              color: m.id === model ? "var(--text-primary)" : "var(--text-secondary)",
              border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left",
              transition: "background 150ms",
            }}
              onMouseEnter={e => { if (m.id !== model) e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={e => { if (m.id !== model) e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{ fontWeight: m.id === model ? 600 : 400 }}>{m.name}</span>
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)", fontVariantNumeric: "tabular-nums" }}>
                ${m.inputPer1M.toFixed(2)}/${m.outputPer1M.toFixed(2)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   BuilderInputBox -- ChatGPT-style input with model selector + send
   ═══════════════════════════════════════════════════════════ */

function BuilderInputBox({ value, onChange, onSend, disabled, model, onModelChange, placeholder }) {
  const [focused, setFocused] = useState(false);

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend?.(); }
  }

  return (
    <div
      style={{
        background: "var(--bg-surface)", border: "1px solid var(--border)",
        borderRadius: 24, transition: "border-color 150ms", position: "relative",
        maxWidth: 680, width: "100%",
        boxShadow: "0 1px 6px rgba(0,0,0,0.08)",
        ...(focused ? { borderColor: "var(--border)" } : {}),
      }}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    >
      <AutoTextarea value={value} onChange={onChange} onKeyDown={handleKeyDown} placeholder={placeholder || "Describe what you need..."} disabled={disabled} autoFocus />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 12px 10px" }}>
        <ModelDropdown model={model} onModelChange={onModelChange} />
        <SendArrow disabled={disabled || !value.trim()} onClick={onSend} />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   TemplateCard -- small suggestion card
   ═══════════════════════════════════════════════════════════ */

function TemplateCard({ template, onClick }) {
  return (
    <div
      style={{
        padding: "14px 16px", border: "1px solid var(--border)", borderRadius: 12,
        background: "var(--bg-surface)", cursor: "pointer", transition: "border-color 150ms",
        display: "flex", flexDirection: "column", gap: "0.4rem",
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--text-tertiary)"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; }}
      onClick={onClick}
    >
      <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>{template.name}</div>
      <div style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.5, flex: 1 }}>{template.description}</div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   TemplateCharterReview
   ═══════════════════════════════════════════════════════════ */

function TemplateCharterReview({ template, onDeploy, onCustomize, deploying }) {
  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "2rem" }} className="lovable-fade">
      <button style={S.backLink} onClick={onCustomize}>← Back</button>
      <h2 style={{ ...S.pageTitle, marginBottom: "0.5rem" }}>{template.name}</h2>
      <p style={{ ...S.pageSub, marginBottom: "1.5rem" }}>{template.description}</p>
      <div style={{ padding: "1.25rem", borderRadius: 10, borderLeft: "2px solid var(--gold)", marginBottom: "2rem" }}>
        <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "1rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>What this worker can do</div>
        <CharterDisplay charter={template.charter} compact />
      </div>
      <div style={{ display: "flex", gap: "0.75rem" }}>
        <button style={{ ...S.btnPrimary, width: "auto", opacity: deploying ? 0.5 : 1 }} disabled={deploying} onClick={onDeploy}>{deploying ? "Deploying..." : "Deploy"}</button>
        <button style={S.btnSecondary} onClick={onCustomize}>Customize</button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   BuilderView -- main AI chat
   ═══════════════════════════════════════════════════════════ */

function BuilderView({ onComplete, onViewWorker, userName, isFirstTime }) {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [selectedModel, setSelectedModel] = useState("google/gemini-3-flash");
  const [streaming, setStreaming] = useState(false);
  const [deployingWorker, setDeployingWorker] = useState(false);
  const messagesEndRef = useRef(null);
  const [templateReview, setTemplateReview] = useState(null);
  const [templateDeploying, setTemplateDeploying] = useState(false);
  const [templateError, setTemplateError] = useState("");
  const streamAbortRef = useRef(null);

  const hasMessages = messages.length > 0;

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function sendChatMessage(userContent) {
    const newMessages = [...messages, { role: "user", content: userContent }];
    setMessages(newMessages);
    setStreaming(true);

    const runtime = loadRuntimeConfig();
    const abortController = new AbortController();
    streamAbortRef.current = abortController;

    try {
      const res = await fetch("/__nooterra/v1/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-tenant-id": runtime.tenantId },
        credentials: "include",
        body: JSON.stringify({ messages: newMessages, model: selectedModel }),
        signal: abortController.signal,
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: "Chat request failed" }));
        setMessages([...newMessages, { role: "assistant", content: errBody.error || "Something went wrong. Please try again." }]);
        setStreaming(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantContent = "";

      setMessages([...newMessages, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") break;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content || "";
            if (delta) {
              assistantContent += delta;
              const captured = assistantContent;
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: "assistant", content: captured };
                return updated;
              });
            }
          } catch { /* skip malformed SSE */ }
        }
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        setMessages(prev => {
          if (prev.length > 0 && prev[prev.length - 1].role === "assistant" && !prev[prev.length - 1].content) {
            const updated = [...prev];
            updated[updated.length - 1] = { role: "assistant", content: "Something went wrong. Please try again." };
            return updated;
          }
          return [...prev, { role: "assistant", content: "Something went wrong. Please try again." }];
        });
      }
    }
    setStreaming(false);
    streamAbortRef.current = null;
  }

  function handleSend() {
    const text = inputValue.trim();
    if (!text || streaming) return;
    setInputValue("");
    sendChatMessage(text);
  }

  async function handleDeployWorker(workerDef) {
    setDeployingWorker(true);
    try {
      const charter = { canDo: workerDef.canDo || [], askFirst: workerDef.askFirst || [], neverDo: workerDef.neverDo || [] };
      const scheduleVal = workerDef.schedule || "on_demand";
      const result = await workerApiRequest({
        pathname: "/v1/workers", method: "POST",
        body: {
          name: workerDef.name || "New Worker",
          description: "",
          charter: JSON.stringify(charter),
          schedule: scheduleVal,
          model: workerDef.model || selectedModel,
        },
      });
      saveOnboardingState({ buyer: loadOnboardingState()?.buyer || null, sessionExpected: true, completed: true });
      if (result?.id) onViewWorker?.(result); else onComplete?.();
    } catch (err) {
      setMessages(prev => [...prev, { role: "assistant", content: `Deploy failed: ${err?.message || "Unknown error"}. Try again?` }]);
    }
    setDeployingWorker(false);
  }

  async function handleTemplateDeploy(template) {
    setTemplateDeploying(true); setTemplateError("");
    try {
      const result = await workerApiRequest({ pathname: "/v1/workers", method: "POST", body: { name: template.name, description: template.description, charter: JSON.stringify(template.charter), schedule: templateScheduleToApiValue(template.schedule), model: template.model } });
      saveOnboardingState({ buyer: loadOnboardingState()?.buyer || null, sessionExpected: true, completed: true });
      if (result?.id) onViewWorker?.(result); else onComplete?.();
    } catch (err) { setTemplateError(err?.message || "Failed to deploy worker."); }
    setTemplateDeploying(false);
  }

  function handleTemplateClick(template) {
    setInputValue(template.description);
  }

  function handleReset() { setMessages([]); }

  // Template charter review screen
  if (templateReview) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", minHeight: "calc(100vh - 1px)", padding: "2rem" }}>
        {templateError && <div style={{ ...S.error, textAlign: "center", marginBottom: "1rem" }}>{templateError}</div>}
        <TemplateCharterReview template={templateReview} onDeploy={() => handleTemplateDeploy(templateReview)} onCustomize={() => { setTemplateReview(null); setTemplateError(""); }} deploying={templateDeploying} />
      </div>
    );
  }

  // Greeting screen (no messages)
  if (!hasMessages) {
    const greeting = getGreeting();
    const displayName = userName ? userName.split("@")[0] : null;
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", minHeight: "calc(100vh - 1px)", padding: "2rem" }}>
        <div style={{ flex: 1 }} />
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <h1 style={{ fontSize: 28, fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.2, marginBottom: "0.25rem" }}>
            {displayName ? `${greeting}, ${displayName}.` : "What do you need done?"}
          </h1>
          <p style={{ fontSize: 16, color: "var(--text-secondary)", marginTop: "0.5rem" }}>
            {isFirstTime ? "Deploy your first worker in 30 seconds." : "Ask me anything, or describe a worker you need."}
          </p>
        </div>
        <BuilderInputBox value={inputValue} onChange={(e) => setInputValue(e.target.value)} onSend={handleSend} disabled={false} model={selectedModel} onModelChange={setSelectedModel} />

        {/* Template suggestions below input */}
        {isFirstTime && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem", width: "100%", maxWidth: 680, marginTop: "1.5rem" }}>
            {STARTER_TEMPLATES.map(t => (
              <TemplateCard key={t.id} template={t} onClick={() => handleTemplateClick(t)} />
            ))}
          </div>
        )}
        <div style={{ flex: 1.5 }} />
      </div>
    );
  }

  // Conversation view
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <div style={{ flex: 1, overflowY: "auto", padding: "2rem 0", display: "flex", flexDirection: "column" }}>
        <div style={{ maxWidth: 680, width: "100%", margin: "0 auto", padding: "0 1.5rem", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          {messages.map((msg, i) => (
            <BuilderMessage
              key={`msg_${i}`}
              msg={msg}
              isStreaming={streaming && i === messages.length - 1 && msg.role === "assistant"}
              onDeployWorker={handleDeployWorker}
            />
          ))}
          {streaming && messages.length > 0 && messages[messages.length - 1].role === "assistant" && !messages[messages.length - 1].content && (
            <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: "0.5rem" }} className="lovable-fade">
              <div style={{ fontSize: "13px", color: "var(--text-tertiary)" }}>Thinking...</div>
            </div>
          )}
          {deployingWorker && (
            <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: "0.5rem" }} className="lovable-fade">
              <div style={{ fontSize: "15px", color: "var(--text-secondary)" }}>Deploying...</div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div style={{ flexShrink: 0, padding: "1rem 1.5rem 1.5rem", display: "flex", justifyContent: "center", background: "var(--bg-primary)" }}>
        <BuilderInputBox value={inputValue} onChange={(e) => setInputValue(e.target.value)} onSend={handleSend} disabled={streaming || deployingWorker} model={selectedModel} onModelChange={setSelectedModel} placeholder="Type a message..." />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   UserMenu -- popover above email in sidebar
   ═══════════════════════════════════════════════════════════ */

function UserMenu({ onClose, onNavigate, onOpenSettings }) {
  const itemStyle = {
    display: "block", width: "100%", padding: "8px 12px", fontSize: "14px",
    color: "var(--text-secondary)", background: "none", border: "none",
    cursor: "pointer", fontFamily: "inherit", textAlign: "left", transition: "background 150ms",
  };
  const hover = (e) => { e.currentTarget.style.background = "var(--bg-hover)"; };
  const unhover = (e) => { e.currentTarget.style.background = "none"; };
  const sep = <div style={{ borderTop: "1px solid var(--border)", margin: "4px 0" }} />;

  return (
    <div className="popover-animate" style={{
      position: "absolute", bottom: "100%", left: "12px", right: "12px",
      background: "var(--bg-surface)", border: "1px solid var(--border)",
      borderRadius: 12, boxShadow: "0 4px 24px rgba(0,0,0,0.15)",
      padding: "4px 0", zIndex: 100, marginBottom: 4,
    }}>
      <button style={itemStyle} onMouseEnter={hover} onMouseLeave={unhover} onClick={() => { onClose(); onOpenSettings(); }}>Settings</button>
      <a href="https://docs.nooterra.ai" target="_blank" rel="noopener noreferrer" style={{ ...itemStyle, textDecoration: "none" }} onMouseEnter={hover} onMouseLeave={unhover} onClick={onClose}>Help & docs</a>
      {sep}
      <a href="/pricing" style={{ ...itemStyle, textDecoration: "none" }} onMouseEnter={hover} onMouseLeave={unhover} onClick={(e) => { e.preventDefault(); onClose(); navigate("/pricing"); }}>Upgrade to Pro</a>
      {sep}
      <button style={itemStyle} onMouseEnter={hover} onMouseLeave={unhover} onClick={async () => {
        onClose();
        await logoutSession();
        try { localStorage.removeItem(PRODUCT_RUNTIME_STORAGE_KEY); } catch { /* ignore */ }
        try { localStorage.removeItem(ONBOARDING_STORAGE_KEY); } catch { /* ignore */ }
        navigate("/login");
      }}>Log out</button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   AppSidebar -- collapsible sidebar (260px)
   ═══════════════════════════════════════════════════════════ */

function AppSidebar({ activeView, onNavigate, workers, pendingApprovals, userEmail, creditBalance, onNewWorker, collapsed, onToggle, onOpenSettings }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(e) { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  const navBtn = (key, label, extra) => (
    <button
      style={{
        display: "flex", alignItems: "center",
        padding: "8px 12px", margin: "0 12px", borderRadius: 8,
        fontSize: "14px", fontWeight: 500,
        color: activeView === key ? "var(--text-primary)" : "var(--text-secondary)",
        background: activeView === key ? "var(--bg-hover)" : "transparent",
        cursor: "pointer", border: "none", fontFamily: "inherit", textAlign: "left",
        transition: "background 150ms, color 150ms",
        boxSizing: "border-box", width: "calc(100% - 24px)",
      }}
      onMouseEnter={e => { if (activeView !== key) e.currentTarget.style.background = "var(--bg-hover)"; }}
      onMouseLeave={e => { if (activeView !== key) e.currentTarget.style.background = "transparent"; }}
      onClick={() => onNavigate(key)}
    >
      {label}{extra}
    </button>
  );

  return (
    <div className="sidebar-wrap" style={{ width: collapsed ? 0 : 260, flexShrink: 0 }}>
      <nav style={{
        width: 260, height: "100vh", position: "sticky", top: 0,
        display: "flex", flexDirection: "column",
        background: "var(--bg-sidebar)", borderRight: "1px solid var(--border)",
        overflow: "hidden",
      }}>
        {/* Header: toggle + logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "16px 16px 12px", height: 56, boxSizing: "border-box" }}>
          <button onClick={onToggle} style={{
            background: "none", border: "none", cursor: "pointer",
            color: "var(--text-secondary)", padding: 4, borderRadius: 6,
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "background 150ms",
          }}
            onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-hover)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "none"; }}
          >
            <HamburgerIcon />
          </button>
          <span style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.01em" }}>nooterra</span>
        </div>

        {/* New worker button */}
        <div style={{ padding: "0 12px 12px" }}>
          <button onClick={onNewWorker} style={{
            display: "block", width: "100%", padding: "8px 12px",
            fontSize: "14px", fontWeight: 600, background: "var(--gold)",
            color: "#1a1a1a", border: "none", borderRadius: 8,
            cursor: "pointer", fontFamily: "inherit", transition: "opacity 150ms",
          }}>+ New worker</button>
        </div>

        {/* Section: Workers */}
        <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", padding: "12px 24px 6px", letterSpacing: "0.05em", textTransform: "uppercase" }}>Workers</div>
        {workers && workers.length > 0 ? (
          <div className="sidebar-inner" style={{ overflowY: "auto", minHeight: 0, flex: 0 }}>
            {workers.map(w => (
              <button key={w.id} style={{
                display: "flex", alignItems: "center", gap: 8, width: "calc(100% - 24px)",
                padding: "8px 12px", margin: "0 12px", borderRadius: 8,
                fontSize: "14px", fontWeight: 400, color: "var(--text-secondary)",
                background: "transparent", cursor: "pointer", border: "none",
                fontFamily: "inherit", textAlign: "left", transition: "background 150ms",
              }}
                onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                onClick={() => onNavigate("workerDetail", w.id)}
              >
                <span style={S.statusDot(STATUS_COLORS[w.status] || STATUS_COLORS.ready)} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.name}</span>
              </button>
            ))}
          </div>
        ) : (
          <div style={{ padding: "4px 24px", fontSize: "13px", color: "var(--text-tertiary)" }}>No workers yet</div>
        )}

        {/* Divider */}
        <div style={{ borderTop: "1px solid var(--border)", margin: "16px 16px" }} />

        {/* Nav items */}
        {navBtn("approvals", "Approvals", pendingApprovals > 0 && <span style={{ marginLeft: 8, fontSize: "12px", fontWeight: 700, color: "var(--gold)", fontVariantNumeric: "tabular-nums" }}>{pendingApprovals}</span>)}
        {navBtn("receipts", "History")}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Divider */}
        <div style={{ borderTop: "1px solid var(--border)", margin: "8px 16px" }} />

        {/* User info */}
        <div style={{ padding: "12px 16px", position: "relative" }} ref={menuRef}>
          {menuOpen && <UserMenu onClose={() => setMenuOpen(false)} onNavigate={onNavigate} onOpenSettings={onOpenSettings} />}
          {userEmail && (
            <button style={{
              display: "block", width: "100%", fontSize: "14px",
              color: "var(--text-secondary)", background: "none", border: "none",
              cursor: "pointer", fontFamily: "inherit", textAlign: "left",
              padding: 0, marginBottom: 4, overflow: "hidden",
              textOverflow: "ellipsis", whiteSpace: "nowrap",
            }} onClick={() => setMenuOpen(!menuOpen)}>{userEmail}</button>
          )}
          {creditBalance != null && (
            <div style={{ fontSize: "13px", color: "var(--text-tertiary)", fontVariantNumeric: "tabular-nums" }}>${(creditBalance / 100).toFixed(2)} remaining</div>
          )}
        </div>
      </nav>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Floating sidebar toggle (when collapsed)
   ═══════════════════════════════════════════════════════════ */

function FloatingToggle({ onClick }) {
  return (
    <button onClick={onClick} style={{
      position: "fixed", top: 16, left: 16, zIndex: 50,
      background: "var(--bg-surface)", border: "1px solid var(--border)",
      borderRadius: 8, padding: 8, cursor: "pointer",
      color: "var(--text-secondary)", display: "flex",
      alignItems: "center", justifyContent: "center",
      boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
      transition: "background 150ms",
    }}
      onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-hover)"; }}
      onMouseLeave={e => { e.currentTarget.style.background = "var(--bg-surface)"; }}
    >
      <HamburgerIcon />
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════
   DASHBOARD: WorkersListView
   ═══════════════════════════════════════════════════════════ */

function WorkersListView({ onSelect, onCreate }) {
  const [workers, setWorkers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try { const result = await workerApiRequest({ pathname: "/v1/workers", method: "GET" }); setWorkers(result?.items || result || []); } catch { setWorkers([]); }
      setLoading(false);
    })();
  }, []);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "2rem" }}>
        <div>
          <h1 style={S.pageTitle}>Workers</h1>
          <p style={{ ...S.pageSub, marginBottom: 0 }}>
            {loading ? "Loading..." : workers.length === 0 ? "No workers yet. Create one to get started." : `${workers.length} worker${workers.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <button style={{ ...S.btnPrimary, width: "auto" }} onClick={onCreate}>Create worker</button>
      </div>

      {!loading && workers.length === 0 && (
        <div style={{ padding: "4rem 2rem", textAlign: "center", border: "1px dashed var(--border)", borderRadius: 12 }}>
          <div style={{ fontSize: "1.1rem", fontWeight: 600, color: "var(--text-primary)", marginBottom: "0.5rem" }}>Your first worker is waiting</div>
          <div style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "1.5rem", maxWidth: 360, margin: "0 auto 1.5rem" }}>Describe what you need done, set a schedule, review the charter, and deploy.</div>
          <button style={{ ...S.btnPrimary, width: "auto" }} onClick={onCreate}>Create worker</button>
        </div>
      )}

      {workers.length > 0 && (
        <div>
          <div style={{ ...S.workerRow, cursor: "default", borderBottom: "1px solid var(--border)", padding: "0 0 0.5rem" }}>
            <div style={{ ...S.workerMeta, fontWeight: 600, color: "var(--text-secondary)" }}>Name</div>
            <div style={{ ...S.workerMeta, fontWeight: 600, color: "var(--text-secondary)" }}>Status</div>
            <div style={{ ...S.workerMeta, fontWeight: 600, color: "var(--text-secondary)" }}>Last run</div>
            <div style={{ ...S.workerMeta, fontWeight: 600, color: "var(--text-secondary)" }}>Schedule</div>
            <div style={{ ...S.workerMeta, fontWeight: 600, color: "var(--text-secondary)" }}>Cost</div>
          </div>
          {workers.map(w => (
            <div key={w.id} style={S.workerRow} onClick={() => onSelect(w)}
              onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
              <div style={S.workerName}>{w.name}</div>
              <div style={S.workerMeta}><span style={S.statusDot(STATUS_COLORS[w.status] || STATUS_COLORS.ready)} />{w.status}</div>
              <div style={S.workerMeta}>{w.lastRun || w.lastRunAt ? timeAgo(w.lastRun || w.lastRunAt) : "never"}</div>
              <div style={S.workerMeta}>{w.schedule || "manual"}</div>
              <div style={S.workerMeta}>{w.cost != null ? `$${(typeof w.cost === "number" ? w.cost : 0).toFixed(2)}` : "--"}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   DASHBOARD: WorkerDetailView
   ═══════════════════════════════════════════════════════════ */

function WorkerDetailView({ workerId, onBack, isNewDeploy }) {
  const [worker, setWorker] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(isNewDeploy ? "activity" : "charter");
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [runningAction, setRunningAction] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try { const result = await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}`, method: "GET" }); setWorker(result); } catch { setWorker(null); }
      setLoading(false);
    })();
  }, [workerId]);

  useEffect(() => {
    if (tab === "activity" && workerId) {
      setLogsLoading(true);
      (async () => {
        try { const result = await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}/logs`, method: "GET" }); setLogs(result?.items || result || []); } catch { setLogs([]); }
        setLogsLoading(false);
      })();
    }
  }, [tab, workerId]);

  useEffect(() => {
    if (!isNewDeploy || !workerId) return;
    const interval = setInterval(async () => {
      try {
        const result = await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}`, method: "GET" });
        setWorker(result);
        if (tab === "activity") { const logResult = await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}/logs`, method: "GET" }); setLogs(logResult?.items || logResult || []); }
      } catch { /* ignore */ }
    }, 5000);
    return () => clearInterval(interval);
  }, [isNewDeploy, workerId, tab]);

  async function handleRunNow() {
    setRunningAction(true); setError("");
    try { await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}/run`, method: "POST" }); const result = await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}`, method: "GET" }); setWorker(result); }
    catch (err) { setError(err?.message || "Failed to run worker."); }
    setRunningAction(false);
  }

  async function handlePauseResume() {
    if (!worker) return;
    setRunningAction(true); setError("");
    const newStatus = worker.status === "paused" ? "ready" : "paused";
    try { await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}`, method: "PUT", body: { status: newStatus } }); setWorker(prev => prev ? { ...prev, status: newStatus } : prev); }
    catch (err) { setError(err?.message || "Failed to update worker."); }
    setRunningAction(false);
  }

  if (loading) return (<div><button style={S.backLink} onClick={onBack}>← All workers</button><div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Loading...</div></div>);
  if (!worker) return (<div><button style={S.backLink} onClick={onBack}>← All workers</button><div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Worker not found.</div></div>);

  const charter = typeof worker.charter === "string" ? (() => { try { return JSON.parse(worker.charter); } catch { return null; } })() : worker.charter;
  const tabs = [{ key: "charter", label: "Charter" }, { key: "activity", label: "Activity" }, { key: "settings", label: "Settings" }];

  return (
    <div>
      <button style={S.backLink} onClick={onBack}>← All workers</button>
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "0.3rem" }}>
        <h1 style={{ ...S.pageTitle, marginBottom: 0 }}>{worker.name}</h1>
        <span style={S.statusDot(STATUS_COLORS[worker.status] || STATUS_COLORS.ready)} />
        <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>{worker.status}</span>
      </div>
      <p style={S.pageSub}>{worker.description || "No description"}</p>
      {error && <div style={S.error}>{error}</div>}
      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "2rem" }}>
        <button style={{ ...S.btnPrimary, width: "auto", opacity: runningAction ? 0.5 : 1 }} disabled={runningAction} onClick={handleRunNow}>{runningAction ? "Running..." : "Run now"}</button>
        <button style={S.btnSecondary} disabled={runningAction} onClick={handlePauseResume}>{worker.status === "paused" ? "Resume" : "Pause"}</button>
      </div>
      {worker.cost != null && (
        <div style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "2rem" }}>
          Cost this period: <span style={{ color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>${(typeof worker.cost === "number" ? worker.cost : 0).toFixed(2)}</span>
        </div>
      )}
      <div style={{ display: "flex", gap: "4px", borderBottom: "1px solid var(--border)", marginBottom: "2rem" }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: "0.6rem 1rem", fontSize: "14px", fontWeight: 600,
            color: tab === t.key ? "var(--text-primary)" : "var(--text-secondary)",
            background: "none", border: "none",
            borderBottom: tab === t.key ? "2px solid var(--gold)" : "2px solid transparent",
            cursor: "pointer", fontFamily: "inherit", marginBottom: -1,
          }}>{t.label}</button>
        ))}
      </div>
      {tab === "charter" && <CharterDisplay charter={charter} />}
      {tab === "activity" && (
        <div>
          {isNewDeploy && logs.length === 0 && !logsLoading && (
            <div style={{ padding: "2rem", textAlign: "center", border: "1px dashed var(--border)", borderRadius: 12 }}>
              <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "0.5rem" }}>Your worker is queued and will run shortly.</div>
              <div style={{ width: 24, height: 24, border: "2px solid var(--border)", borderTop: "2px solid var(--gold)", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "1rem auto 0" }} />
            </div>
          )}
          {logsLoading ? (
            <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Loading logs...</div>
          ) : logs.length === 0 && !isNewDeploy ? (
            <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>No activity yet. This worker hasn't run.</div>
          ) : (
            logs.map((entry, i) => <ActivityLogEntry key={entry.id || i} entry={entry} />)
          )}
        </div>
      )}
      {tab === "settings" && (
        <div style={{ maxWidth: 480 }}>
          <label style={S.label}>Schedule</label>
          <div style={{ fontSize: "14px", color: "var(--text-primary)", marginBottom: "1rem" }}>{worker.schedule || "Manual (on-demand)"}</div>
          {worker.model && (<>
            <label style={S.label}>Model</label>
            <div style={{ fontSize: "14px", color: "var(--text-primary)", marginBottom: "2rem" }}>{RECOMMENDED_MODELS.find(m => m.id === worker.model)?.name || worker.model}</div>
          </>)}
        </div>
      )}
    </div>
  );
}

function ActivityLogEntry({ entry }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={S.logEntry}>
      <div style={S.logTime}>{entry.time ? timeAgo(entry.time) : ""}</div>
      <div style={S.logSummary}>{entry.summary}</div>
      {entry.detail && (<>
        <button style={{ ...S.btnGhost, marginTop: "0.4rem", fontSize: "12px" }} onClick={() => setExpanded(!expanded)}>{expanded ? "Hide details" : "Show details"}</button>
        {expanded && <div style={S.logDetail}>{entry.detail}</div>}
      </>)}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   APPROVALS VIEW
   ═══════════════════════════════════════════════════════════ */

function ApprovalsView() {
  const [items, setItems] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState(null);

  useEffect(() => { loadApprovals(); }, []);

  async function loadApprovals() {
    setLoading(true);
    try {
      const runtime = loadRuntimeConfig();
      const [pending, decided] = await Promise.all([fetchApprovalInbox(runtime, { status: "pending" }), fetchApprovalInbox(runtime, { status: "decided" })]);
      setItems(pending?.items || pending || []);
      setHistory(decided?.items || decided || []);
    } catch { setItems([]); setHistory([]); }
    setLoading(false);
  }

  async function handleDecide(requestId, approved) {
    setDeciding(requestId);
    try { const runtime = loadRuntimeConfig(); await decideApprovalInboxItem(runtime, requestId, { approved }); await loadApprovals(); } catch { /* ignore */ }
    setDeciding(null);
  }

  return (
    <div>
      <h1 style={S.pageTitle}>Approvals</h1>
      <p style={S.pageSub}>Workers ask before taking sensitive actions. Review and decide here.</p>
      {loading ? (
        <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Loading...</div>
      ) : (<>
        {items.length === 0 ? (
          <div style={{ padding: "3rem 2rem", textAlign: "center", border: "1px dashed var(--border)", borderRadius: 12, marginBottom: "3rem" }}>
            <div style={{ fontSize: "1rem", fontWeight: 600, color: "var(--text-primary)", marginBottom: "0.3rem" }}>Nothing pending</div>
            <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>When a worker needs your approval, it will appear here.</div>
          </div>
        ) : (
          <div style={{ marginBottom: "3rem" }}>
            {items.map(item => (
              <div key={item.requestId || item.id} style={S.approvalRow}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "0.25rem" }}>{item.workerName || item.agentName || "Worker"}</div>
                    <div style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "0.25rem" }}>{item.action || item.summary || item.description || "Action requires approval"}</div>
                    {item.detail && <div style={{ fontSize: "13px", color: "var(--text-tertiary)", lineHeight: 1.5 }}>{item.detail}</div>}
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--text-tertiary)", flexShrink: 0, marginLeft: "1rem" }}>{item.createdAt ? timeAgo(item.createdAt) : ""}</div>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
                  <button style={{ ...S.btnPrimary, width: "auto", padding: "0.5rem 1.25rem", fontSize: "13px" }} disabled={deciding === (item.requestId || item.id)} onClick={() => handleDecide(item.requestId || item.id, true)}>Approve</button>
                  <button style={{ ...S.btnSecondary, padding: "0.5rem 1.25rem", fontSize: "13px" }} disabled={deciding === (item.requestId || item.id)} onClick={() => handleDecide(item.requestId || item.id, false)}>Deny</button>
                </div>
              </div>
            ))}
          </div>
        )}
        {history.length > 0 && (<>
          <div style={{ ...S.label, marginBottom: "1rem" }}>Recent decisions</div>
          {history.slice(0, 20).map(item => (
            <div key={item.requestId || item.id} style={{ ...S.approvalRow, opacity: 0.7 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <div>
                  <span style={{ fontSize: "14px", color: "var(--text-secondary)" }}>{item.workerName || item.agentName || "Worker"}</span>
                  <span style={{ fontSize: "13px", color: "var(--text-tertiary)", marginLeft: "0.75rem" }}>{item.action || item.summary || "Action"}</span>
                </div>
                <span style={{ fontSize: "12px", fontWeight: 600, color: item.approved || item.decision === "approved" ? "#5bb98c" : "#c97055" }}>{item.approved || item.decision === "approved" ? "Approved" : "Denied"}</span>
              </div>
            </div>
          ))}
        </>)}
      </>)}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   RECEIPTS VIEW
   ═══════════════════════════════════════════════════════════ */

function ReceiptsView() {
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try { const runtime = loadRuntimeConfig(); const result = await fetchWorkOrderReceipts(runtime, { limit: 50 }); setReceipts(result?.items || result || []); } catch { setReceipts([]); }
      setLoading(false);
    })();
  }, []);

  return (
    <div>
      <h1 style={S.pageTitle}>History</h1>
      <p style={S.pageSub}>Execution log across all workers.</p>
      {loading ? (
        <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Loading...</div>
      ) : receipts.length === 0 ? (
        <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>No executions yet.</div>
      ) : (
        receipts.map(r => (
          <div key={r.id || r.receiptId} style={S.logEntry}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: "14px", color: "var(--text-primary)" }}>{r.workerName || r.agentName || r.summary || r.id || "Execution"}</div>
                <div style={S.logTime}>{r.completedAt ? formatDateTime(r.completedAt) : r.createdAt ? formatDateTime(r.createdAt) : ""}</div>
              </div>
              {r.cost != null && <div style={{ ...S.workerMeta, color: "var(--text-secondary)" }}>{typeof r.cost === "number" ? `$${r.cost.toFixed(2)}` : formatCurrency(r.cost)}</div>}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   SETTINGS MODAL -- overlay, not a page
   ═══════════════════════════════════════════════════════════ */

function ToggleSwitch({ on, onToggle }) {
  return (
    <button onClick={onToggle} style={{ width: 44, height: 24, borderRadius: 12, border: "none", cursor: "pointer", background: on ? "var(--gold)" : "var(--bg-hover)", position: "relative", flexShrink: 0, transition: "background 150ms" }}>
      <div style={{ width: 18, height: 18, borderRadius: "50%", background: "white", position: "absolute", top: 3, left: on ? 23 : 3, transition: "left 150ms" }} />
    </button>
  );
}

function ThemePreview({ opt, selected, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: "0.75rem", borderRadius: 10, cursor: "pointer", textAlign: "center",
      fontFamily: "inherit", transition: "border-color 150ms", flex: 1,
      border: selected ? "2px solid var(--gold)" : "2px solid var(--border)",
      background: selected ? "var(--gold-dim)" : "transparent",
    }}>
      {opt.key === "auto" ? (
        <div style={{ width: 80, height: 50, borderRadius: 8, margin: "0 auto 0.5rem", display: "flex", overflow: "hidden" }}>
          <div style={{ flex: 1, background: opt.bgLeft, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 4 }}>
            <div style={{ width: "70%", height: 8, borderRadius: 2, background: opt.fgLeft }} />
          </div>
          <div style={{ flex: 1, background: opt.bgRight, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 4 }}>
            <div style={{ width: "70%", height: 8, borderRadius: 2, background: opt.fgRight }} />
          </div>
        </div>
      ) : (
        <div style={{ width: 80, height: 50, borderRadius: 8, margin: "0 auto 0.5rem", background: opt.bg, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 6 }}>
          <div style={{ width: "80%", height: 8, borderRadius: 2, background: opt.fg }} />
        </div>
      )}
      <div style={{ fontSize: "13px", fontWeight: 600, color: selected ? "var(--text-primary)" : "var(--text-secondary)" }}>{opt.label}</div>
    </button>
  );
}

function SettingsModal({ userEmail, onClose }) {
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState("idle"); // "idle" | "saving" | "saved"
  const [tab, setTab] = useState("account");
  const [theme, setTheme] = useState(() => loadTheme());
  const [defaultModel, setDefaultModel] = useState("google/gemini-3-flash");
  const [notifApproval, setNotifApproval] = useState(true);
  const [notifWeekly, setNotifWeekly] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const runtime = loadRuntimeConfig();

  useEffect(() => {
    (async () => {
      try {
        const result = await fetchTenantSettings(runtime);
        setDisplayName(result?.displayName || result?.name || "");
        if (result?.defaultModel) setDefaultModel(result.defaultModel);
      } catch { /* ignore */ }
      setLoading(false);
    })();
  }, []);

  // Close on Escape
  useEffect(() => {
    function handleKey(e) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  async function handleSave() {
    setSaveState("saving");
    try {
      await updateTenantSettings(runtime, { displayName: displayName.trim(), defaultModel });
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 1500);
    } catch { setSaveState("idle"); }
  }

  function handleThemeChange(t) { setTheme(t); saveTheme(t); }

  const tabs = [{ key: "account", label: "Account" }, { key: "appearance", label: "Appearance" }, { key: "model", label: "Model" }, { key: "notifications", label: "Notifications" }];
  const themes = [
    { key: "light", label: "Light", bg: "#f7f5f0", fg: "#e8e5de" },
    { key: "auto", label: "Auto", bgLeft: "#f7f5f0", bgRight: "#1a1a1a", fgLeft: "#e8e5de", fgRight: "#2a2a2a" },
    { key: "dark", label: "Dark", bg: "#1a1a1a", fg: "#2a2a2a" },
  ];

  function SaveButton({ label = "Save" }) {
    const isSaved = saveState === "saved";
    const isSaving = saveState === "saving";
    return (
      <button style={{
        ...S.btnPrimary, width: "auto", opacity: isSaving ? 0.6 : 1,
        background: isSaved ? "#5bb98c" : "var(--gold)",
        transition: "background 300ms, opacity 150ms",
      }} disabled={isSaving} onClick={handleSave}>
        {isSaving ? "Saving..." : isSaved ? "Saved \u2713" : label}
      </button>
    );
  }

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-content" style={{
        width: "100%", maxWidth: 600, maxHeight: "85vh",
        background: "var(--bg-surface)", borderRadius: 16,
        boxShadow: "0 24px 64px rgba(0,0,0,0.3)",
        overflow: "hidden", display: "flex", flexDirection: "column",
      }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px 0" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>Settings</h2>
          <button onClick={onClose} style={{
            background: "none", border: "none", cursor: "pointer",
            fontSize: "20px", color: "var(--text-secondary)", padding: "4px 8px",
            fontFamily: "inherit", lineHeight: 1,
          }}>{"\u2715"}</button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: "4px", padding: "16px 24px 0", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
          {tabs.map(s => (
            <button key={s.key} onClick={() => setTab(s.key)} style={{
              padding: "8px 12px", fontSize: "14px", fontWeight: 600,
              color: tab === s.key ? "var(--text-primary)" : "var(--text-secondary)",
              background: "none", border: "none",
              borderBottom: tab === s.key ? "2px solid var(--gold)" : "2px solid transparent",
              cursor: "pointer", fontFamily: "inherit", marginBottom: -1,
            }}>{s.label}</button>
          ))}
        </div>

        {/* Content */}
        <div style={{ padding: "24px", overflowY: "auto", flex: 1 }}>
          {loading ? <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Loading...</div> : (<>
            {tab === "account" && (<div>
              <label style={S.label}>Display name</label>
              <FocusInput type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" />
              <div style={{ marginBottom: "2rem" }}><SaveButton /></div>
              <div style={{ borderTop: "1px solid var(--border)", margin: "2rem 0" }} />
              <label style={S.label}>Email</label>
              <div style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "1.5rem" }}>{userEmail || "Not available"}</div>
              <label style={S.label}>Account ID</label>
              <div style={{ fontSize: "13px", color: "var(--text-tertiary)", fontVariantNumeric: "tabular-nums", fontFamily: "monospace" }}>{runtime.tenantId}</div>
              <div style={{ borderTop: "1px solid var(--border)", margin: "2rem 0" }} />
              {!showDeleteConfirm ? (
                <button style={{ ...S.btnSecondary, borderColor: "#c97055", color: "#c97055" }} onClick={() => setShowDeleteConfirm(true)}>Delete account</button>
              ) : (
                <div style={{ padding: "1.25rem", border: "1px solid #c97055", borderRadius: 10, background: "rgba(201,112,85,0.06)" }}>
                  <div style={{ fontSize: "15px", fontWeight: 600, color: "#c97055", marginBottom: "0.5rem" }}>Are you sure?</div>
                  <div style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "1rem", lineHeight: 1.5 }}>This will permanently delete your account and all workers. This action cannot be undone.</div>
                  <div style={{ display: "flex", gap: "0.75rem" }}>
                    <button style={{ ...S.btnPrimary, width: "auto", background: "#c97055" }} onClick={async () => { await logoutSession(); try { localStorage.removeItem(PRODUCT_RUNTIME_STORAGE_KEY); } catch { /* ignore */ } try { localStorage.removeItem(ONBOARDING_STORAGE_KEY); } catch { /* ignore */ } navigate("/login"); }}>Yes, delete my account</button>
                    <button style={S.btnSecondary} onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>)}

            {tab === "appearance" && (<div>
              <label style={S.label}>Color mode</label>
              <p style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "1rem", marginTop: 0 }}>Choose how nooterra looks for you.</p>
              <div style={{ display: "flex", gap: "1rem" }}>
                {themes.map(opt => <ThemePreview key={opt.key} opt={opt} selected={theme === opt.key} onClick={() => handleThemeChange(opt.key)} />)}
              </div>
            </div>)}

            {tab === "model" && (<div>
              <label style={S.label}>Default model</label>
              <p style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "1rem", marginTop: 0 }}>This model will be used for new workers by default.</p>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                {RECOMMENDED_MODELS.map(m => (
                  <div key={m.id} onClick={() => setDefaultModel(m.id)} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "0.7rem 1rem", borderRadius: 8, cursor: "pointer",
                    border: m.id === defaultModel ? "1px solid var(--gold)" : "1px solid var(--border)",
                    background: m.id === defaultModel ? "var(--gold-dim)" : "transparent",
                    transition: "all 150ms",
                  }}>
                    <div>
                      <span style={{ fontSize: "14px", fontWeight: 600, color: m.id === defaultModel ? "var(--text-primary)" : "var(--text-secondary)" }}>{m.name}</span>
                      <span style={{ fontSize: "12px", color: "var(--text-tertiary)", marginLeft: 8 }}>{m.tag}</span>
                    </div>
                    <span style={{ fontSize: "12px", color: "var(--text-tertiary)", fontVariantNumeric: "tabular-nums" }}>${m.inputPer1M.toFixed(2)} / ${m.outputPer1M.toFixed(2)} per 1M</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: "1.5rem" }}><SaveButton label="Save default model" /></div>
            </div>)}

            {tab === "notifications" && (<div>
              <label style={S.label}>Notifications</label>
              <p style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "1.5rem", marginTop: 0 }}>Control how you get notified about worker activity.</p>
              {[
                { label: "Email me when a worker needs approval", desc: "Get notified when a worker is waiting for your decision.", on: notifApproval, toggle: () => setNotifApproval(!notifApproval) },
                { label: "Weekly worker report", desc: "Receive a weekly summary of all worker activity.", on: notifWeekly, toggle: () => setNotifWeekly(!notifWeekly) },
              ].map((n, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem 0", borderBottom: "1px solid var(--border)" }}>
                  <div>
                    <div style={{ fontSize: "14px", color: "var(--text-primary)", fontWeight: 500 }}>{n.label}</div>
                    <div style={{ fontSize: "13px", color: "var(--text-tertiary)", marginTop: "0.15rem" }}>{n.desc}</div>
                  </div>
                  <ToggleSwitch on={n.on} onToggle={n.toggle} />
                </div>
              ))}
            </div>)}
          </>)}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   PRICING VIEW
   ═══════════════════════════════════════════════════════════ */

function PricingView() {
  const tiers = [
    { name: "Free", price: "Free forever", features: ["Local CLI workers", "Any AI provider (bring your own key)", "Unlimited workers and runs", "Charter-based governance", "Full activity logs"], cta: "Install CLI", ctaHref: "https://docs.nooterra.ai", primary: false },
    { name: "Pro", price: "$29 / month", features: ["Everything in Free", "Cloud-hosted workers", "Web dashboard", "Slack approval integration", "Email notifications", "Priority support"], cta: "Start free trial", ctaAction: () => navigate("/signup"), primary: true },
    { name: "Team", price: "$99 / month", features: ["Everything in Pro", "Shared team dashboard", "SSO / SAML", "Audit log export", "Custom worker templates", "Dedicated support"], cta: "Contact us", ctaHref: "mailto:team@nooterra.ai", primary: false },
  ];

  return (
    <div style={S.pricingWrap} className="lovable-fade">
      <h1 style={S.pricingTitle}>Simple, honest pricing</h1>
      <p style={{ fontSize: "1.05rem", color: "var(--text-secondary)", marginBottom: "3rem", maxWidth: 520, lineHeight: 1.6 }}>Start free with local workers. Upgrade when you want cloud hosting and team features.</p>
      {tiers.map((tier, i) => (
        <div key={tier.name} style={{ ...S.tier, borderBottom: i < tiers.length - 1 ? S.tier.borderBottom : "none" }}>
          <div>
            <div style={S.tierName}>{tier.name}</div>
            <div style={S.tierPrice}>{tier.price}</div>
            {tier.features.map((f, j) => <div key={j} style={S.tierFeature}>{f}</div>)}
          </div>
          <div style={{ paddingTop: "0.5rem" }}>
            {tier.ctaHref ? (
              <a href={tier.ctaHref} target={tier.ctaHref.startsWith("http") ? "_blank" : undefined} rel={tier.ctaHref.startsWith("http") ? "noopener noreferrer" : undefined} style={{ ...(tier.primary ? S.btnPrimary : S.btnSecondary), textDecoration: "none", display: "inline-flex", width: "auto" }}>{tier.cta}</a>
            ) : (
              <button style={{ ...(tier.primary ? S.btnPrimary : S.btnSecondary), width: "auto" }} onClick={tier.ctaAction}>{tier.cta}</button>
            )}
          </div>
        </div>
      ))}
      <div style={{ marginTop: "3rem" }}>
        <a href="/" style={S.link} onClick={(e) => { e.preventDefault(); navigate("/"); }}>← Back to home</a>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   APP SHELL -- unified layout with collapsible sidebar
   ═══════════════════════════════════════════════════════════ */

function AppShell({ initialView = "workers", userEmail, isFirstTime }) {
  const [view, setView] = useState(initialView);
  const [selectedWorkerId, setSelectedWorkerId] = useState(null);
  const [isNewDeploy, setIsNewDeploy] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [workers, setWorkers] = useState([]);
  const [creditBalance, setCreditBalance] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    (async () => { try { const runtime = loadRuntimeConfig(); const result = await fetchApprovalInbox(runtime, { status: "pending" }); const items = result?.items || result || []; setPendingApprovals(Array.isArray(items) ? items.length : 0); } catch { /* ignore */ } })();
    (async () => { try { const result = await workerApiRequest({ pathname: "/v1/workers", method: "GET" }); setWorkers(result?.items || result || []); } catch { /* ignore */ } })();
    (async () => { try { const result = await workerApiRequest({ pathname: "/v1/credits", method: "GET" }); if (result?.balance != null) setCreditBalance(result.balance); else if (result?.remaining != null) setCreditBalance(result.remaining); } catch { /* ignore */ } })();
  }, []);

  function handleNavigate(dest, workerId) {
    if (dest === "workerDetail" && workerId) { setSelectedWorkerId(workerId); setIsNewDeploy(false); setView("workerDetail"); }
    else { setView(dest); setSelectedWorkerId(null); setIsNewDeploy(false); }
  }

  function handleSelectWorker(worker) { setSelectedWorkerId(worker.id); setIsNewDeploy(false); setView("workerDetail"); }
  function handleNewWorker() { setView("builder"); setSelectedWorkerId(null); setIsNewDeploy(false); }

  function handleBuilderComplete() {
    (async () => { try { const result = await workerApiRequest({ pathname: "/v1/workers", method: "GET" }); setWorkers(result?.items || result || []); } catch { /* ignore */ } })();
    setView("workers");
  }

  function handleViewWorker(w) {
    (async () => { try { const result = await workerApiRequest({ pathname: "/v1/workers", method: "GET" }); setWorkers(result?.items || result || []); } catch { /* ignore */ } })();
    if (w?.id) { setSelectedWorkerId(w.id); setIsNewDeploy(true); setView("workerDetail"); }
    else setView("workers");
  }

  const sidebarActiveView = view === "workerDetail" || view === "builder" ? "workers" : view;

  return (
    <div style={S.appLayout}>
      <AppSidebar
        activeView={sidebarActiveView}
        onNavigate={handleNavigate}
        workers={workers}
        pendingApprovals={pendingApprovals}
        userEmail={userEmail}
        creditBalance={creditBalance}
        onNewWorker={handleNewWorker}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      {sidebarCollapsed && <FloatingToggle onClick={() => setSidebarCollapsed(false)} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        {view === "builder" && <BuilderView onComplete={handleBuilderComplete} onViewWorker={handleViewWorker} userName={userEmail} isFirstTime={isFirstTime && workers.length === 0} />}
        {view === "workers" && <div style={S.main}><WorkersListView onSelect={handleSelectWorker} onCreate={handleNewWorker} /></div>}
        {view === "workerDetail" && selectedWorkerId && <div style={S.main}><WorkerDetailView workerId={selectedWorkerId} onBack={() => { setSelectedWorkerId(null); setIsNewDeploy(false); setView("workers"); }} isNewDeploy={isNewDeploy} /></div>}
        {view === "approvals" && <div style={S.main}><ApprovalsView /></div>}
        {view === "receipts" && <div style={S.main}><ReceiptsView /></div>}
      </div>
      {settingsOpen && <SettingsModal userEmail={userEmail} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   PRODUCT SHELL -- top-level mode router with session check
   ═══════════════════════════════════════════════════════════ */

export default function ProductShell({ mode, launchId, agentId, runId, requestedPath }) {
  const [currentMode, setCurrentMode] = useState(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [userEmail, setUserEmail] = useState(null);
  const [isFirstTime, setIsFirstTime] = useState(false);

  useEffect(() => { applyTheme(loadTheme()); }, []);

  useEffect(() => {
    let cancelled = false;
    async function checkSession() {
      if (mode === "signup" || mode === "pricing") { setCurrentMode(mode); setSessionChecked(true); return; }
      try {
        const principal = await fetchSessionPrincipal();
        if (!cancelled && principal && principal.email) {
          setUserEmail(principal.email);
          const runtime = loadRuntimeConfig();
          if (principal.tenantId) saveRuntime({ ...runtime, tenantId: principal.tenantId });
          saveOnboardingState({ ...loadOnboardingState(), buyer: principal, sessionExpected: true, completed: true });
          try { const workersResult = await workerApiRequest({ pathname: "/v1/workers", method: "GET" }); if ((workersResult?.items || workersResult || []).length === 0) setIsFirstTime(true); } catch { /* ignore */ }
          if (mode === "login" || mode === "signup") setCurrentMode("dashboard"); else setCurrentMode(mode || "dashboard");
          setSessionChecked(true);
          return;
        }
      } catch { /* No valid session */ }
      if (!cancelled) {
        if (mode === "login" || mode === "signup" || mode === "pricing") setCurrentMode(mode); else setCurrentMode("login");
        setSessionChecked(true);
      }
    }
    checkSession();
    return () => { cancelled = true; };
  }, [mode]);

  useEffect(() => {
    if (sessionChecked) {
      const onboardState = loadOnboardingState();
      if (onboardState?.sessionExpected) setCurrentMode(mode);
      else if (mode === "signup" || mode === "login" || mode === "pricing") setCurrentMode(mode);
    }
  }, [mode, sessionChecked]);

  function handleAuth(dest) {
    if (dest === "builder") {
      const onboardState = loadOnboardingState();
      setUserEmail(onboardState?.buyer?.email || null);
      setIsFirstTime(true);
      setCurrentMode("dashboard");
      navigate("/wallet");
    } else {
      const onboardState = loadOnboardingState();
      setUserEmail(onboardState?.buyer?.email || null);
      setIsFirstTime(false);
      setCurrentMode("dashboard");
      navigate("/wallet");
    }
  }

  if (!sessionChecked) {
    return (
      <div style={S.shell}>
        <div style={S.authWrap}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: "0.5rem" }}>nooterra</div>
            <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Loading...</div>
          </div>
        </div>
      </div>
    );
  }

  const resolvedMode = currentMode;

  function getInitialView() {
    if (isFirstTime) return "builder";
    switch (resolvedMode) {
      case "approvals": return "approvals";
      case "receipts": return "receipts";
      case "workspace": return "workers";
      default: return "workers";
    }
  }

  return (
    <div style={S.shell}>
      {resolvedMode === "signup" && <SignUpView onAuth={handleAuth} />}
      {resolvedMode === "login" && <SignInView onAuth={handleAuth} />}
      {resolvedMode === "pricing" && <PricingView />}
      {!["signup", "login", "pricing"].includes(resolvedMode) && resolvedMode != null && (
        <AppShell initialView={getInitialView()} userEmail={userEmail} isFirstTime={isFirstTime} />
      )}
    </div>
  );
}
