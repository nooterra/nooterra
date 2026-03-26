import { useEffect, useRef, useState } from "react";
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

function cls(...args) {
  return args.filter(Boolean).join(" ");
}

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
  try {
    localStorage.setItem(PRODUCT_RUNTIME_STORAGE_KEY, JSON.stringify(config));
  } catch { /* ignore */ }
}

function loadOnboardingState() {
  try {
    return JSON.parse(localStorage.getItem(ONBOARDING_STORAGE_KEY) || "null") || null;
  } catch { return null; }
}

function saveOnboardingState(state) {
  try {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

function loadTheme() {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) || "dark";
  } catch { return "dark"; }
}

function saveTheme(theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch { /* ignore */ }
  applyTheme(theme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

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
    headers: {
      "x-tenant-id": runtime.tenantId,
      "content-type": "application/json",
    },
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
  try {
    await authRequest({ pathname: "/v1/buyer/logout", method: "POST" });
  } catch { /* ignore */ }
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
   Shared styles
   ═══════════════════════════════════════════════════════════ */

const S = {
  shell: { minHeight: "100vh", background: "var(--neutral-950)", color: "var(--neutral-200)", fontFamily: "var(--font-body)", WebkitFontSmoothing: "antialiased" },
  authWrap: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" },
  authBox: { width: "100%", maxWidth: 400 },
  authTitle: { fontSize: "clamp(1.6rem, 4vw, 2rem)", fontWeight: 700, color: "var(--neutral-50)", marginBottom: "0.5rem", lineHeight: 1.15 },
  authSub: { fontSize: "0.95rem", color: "var(--neutral-400)", marginBottom: "2.5rem", lineHeight: 1.5 },
  label: { display: "block", fontSize: "0.8rem", fontWeight: 600, color: "var(--neutral-300)", marginBottom: "0.4rem", letterSpacing: "0.03em", textTransform: "uppercase" },
  input: { display: "block", width: "100%", padding: "0.75rem 1rem", fontSize: "0.95rem", background: "var(--neutral-900)", border: "1px solid var(--neutral-700)", borderRadius: 8, color: "var(--neutral-100)", outline: "none", marginBottom: "1.25rem", fontFamily: "inherit", transition: "border-color 0.15s" },
  inputFocus: { borderColor: "var(--gold)" },
  btnPrimary: { display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0.75rem 1.75rem", fontSize: "0.9rem", fontWeight: 600, background: "var(--gold)", color: "var(--neutral-950)", border: "none", borderRadius: 8, cursor: "pointer", letterSpacing: "0.01em", transition: "background 0.15s, opacity 0.15s", width: "100%", fontFamily: "inherit" },
  btnSecondary: { display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0.6rem 1.25rem", fontSize: "0.85rem", fontWeight: 600, background: "transparent", color: "var(--neutral-200)", border: "1px solid var(--neutral-700)", borderRadius: 8, cursor: "pointer", transition: "border-color 0.15s", fontFamily: "inherit" },
  btnGhost: { background: "none", border: "none", color: "var(--gold)", cursor: "pointer", fontSize: "0.85rem", fontWeight: 500, padding: 0, fontFamily: "inherit" },
  link: { color: "var(--gold)", textDecoration: "none", fontSize: "0.85rem", fontWeight: 500 },
  error: { fontSize: "0.85rem", color: "#c97055", marginBottom: "1rem" },
  success: { fontSize: "0.85rem", color: "#5bb98c", marginBottom: "1rem" },
  appLayout: { display: "flex", minHeight: "100vh" },
  sidebar: { width: 240, flexShrink: 0, borderRight: "1px solid var(--neutral-800)", display: "flex", flexDirection: "column", position: "sticky", top: 0, height: "100vh", overflowY: "auto", background: "var(--neutral-950)" },
  sidebarLogo: { fontSize: "1.1rem", fontWeight: 700, color: "var(--neutral-50)", padding: "1.5rem 1.5rem 1rem", letterSpacing: "-0.01em" },
  navItem: { display: "block", padding: "0.55rem 1.5rem", fontSize: "0.88rem", fontWeight: 500, color: "var(--neutral-400)", cursor: "pointer", textDecoration: "none", transition: "color 0.12s", border: "none", background: "none", width: "100%", textAlign: "left", fontFamily: "inherit" },
  navItemActive: { color: "var(--neutral-50)" },
  navSection: { fontSize: "0.7rem", fontWeight: 600, color: "var(--neutral-500)", padding: "1.5rem 1.5rem 0.5rem", letterSpacing: "0.06em", textTransform: "uppercase" },
  main: { flex: 1, padding: "2.5rem 3rem", maxWidth: 960 },
  pageTitle: { fontSize: "clamp(1.4rem, 3vw, 1.75rem)", fontWeight: 700, color: "var(--neutral-50)", marginBottom: "0.3rem" },
  pageSub: { fontSize: "0.9rem", color: "var(--neutral-400)", marginBottom: "2rem" },
  workerRow: { display: "grid", gridTemplateColumns: "1fr auto auto auto auto", alignItems: "center", gap: "1.5rem", padding: "1rem 0", borderBottom: "1px solid var(--neutral-800)", cursor: "pointer", transition: "background 0.1s" },
  workerName: { fontSize: "0.95rem", fontWeight: 600, color: "var(--neutral-100)" },
  workerMeta: { fontSize: "0.8rem", color: "var(--neutral-400)", fontVariantNumeric: "tabular-nums" },
  statusDot: (color) => ({ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: color, marginRight: 6, verticalAlign: "middle" }),
  charterSection: { marginBottom: "1.5rem" },
  charterLabel: { fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.5rem" },
  charterItem: { fontSize: "0.88rem", color: "var(--neutral-300)", padding: "0.3rem 0", lineHeight: 1.5 },
  approvalRow: { padding: "1.25rem 0", borderBottom: "1px solid var(--neutral-800)" },
  pricingWrap: { minHeight: "100vh", padding: "6rem 2rem 4rem", maxWidth: 1100, margin: "0 auto" },
  pricingTitle: { fontSize: "clamp(2rem, 5vw, 3rem)", fontWeight: 700, color: "var(--neutral-50)", marginBottom: "0.75rem", lineHeight: 1.1 },
  tier: { padding: "2.5rem 0", borderBottom: "1px solid var(--neutral-800)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3rem", alignItems: "start" },
  tierName: { fontSize: "1.25rem", fontWeight: 700, color: "var(--neutral-50)", marginBottom: "0.3rem" },
  tierPrice: { fontSize: "0.95rem", color: "var(--neutral-400)", marginBottom: "1rem" },
  tierFeature: { fontSize: "0.88rem", color: "var(--neutral-300)", padding: "0.25rem 0", lineHeight: 1.5 },
  textarea: { display: "block", width: "100%", padding: "0.75rem 1rem", fontSize: "0.95rem", background: "var(--neutral-900)", border: "1px solid var(--neutral-700)", borderRadius: 8, color: "var(--neutral-100)", outline: "none", fontFamily: "inherit", resize: "vertical", minHeight: 120, lineHeight: 1.5, marginBottom: "1.25rem" },
  select: { display: "block", width: "100%", padding: "0.75rem 1rem", fontSize: "0.95rem", background: "var(--neutral-900)", border: "1px solid var(--neutral-700)", borderRadius: 8, color: "var(--neutral-100)", outline: "none", fontFamily: "inherit", marginBottom: "1.25rem", appearance: "none" },
  logEntry: { padding: "0.75rem 0", borderBottom: "1px solid var(--neutral-800)" },
  logTime: { fontSize: "0.75rem", color: "var(--neutral-500)", fontVariantNumeric: "tabular-nums" },
  logSummary: { fontSize: "0.88rem", color: "var(--neutral-300)", marginTop: "0.2rem", lineHeight: 1.5 },
  logDetail: { fontSize: "0.82rem", color: "var(--neutral-500)", marginTop: "0.4rem", lineHeight: 1.5, whiteSpace: "pre-wrap", padding: "0.75rem 1rem", background: "var(--neutral-900)", borderRadius: 6 },
  backLink: { display: "inline-block", fontSize: "0.82rem", fontWeight: 500, color: "var(--neutral-400)", marginBottom: "2rem", cursor: "pointer", background: "none", border: "none", padding: 0, fontFamily: "inherit" },
  otpInput: { display: "block", width: "100%", padding: "0.75rem 1rem", fontSize: "1.5rem", fontWeight: 700, letterSpacing: "0.5em", textAlign: "center", background: "var(--neutral-900)", border: "1px solid var(--neutral-700)", borderRadius: 8, color: "var(--neutral-100)", outline: "none", marginBottom: "1.25rem", fontFamily: "inherit", transition: "border-color 0.15s" },
};

const STATUS_COLORS = {
  running: "#5bb98c",
  paused: "var(--gold)",
  ready: "var(--neutral-400)",
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
      style={{
        ...S.input,
        ...style,
        ...(focused ? S.inputFocus : {}),
      }}
      onFocus={(e) => { setFocused(true); props.onFocus?.(e); }}
      onBlur={(e) => { setFocused(false); props.onBlur?.(e); }}
    />
  );
}

/* ═══════════════════════════════════════════════════════════
   SendArrow — inline SVG send button
   ═══════════════════════════════════════════════════════════ */

function SendArrow({ disabled, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 32,
        height: 32,
        borderRadius: "50%",
        background: disabled ? "var(--neutral-700)" : "var(--gold)",
        border: "none",
        cursor: disabled ? "default" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        transition: "background 0.15s",
        opacity: disabled ? 0.5 : 1,
      }}
      aria-label="Send"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ display: "block" }}>
        <path
          d="M3 8h10M9 4l4 4-4 4"
          stroke={disabled ? "var(--neutral-500)" : "var(--neutral-950)"}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════
   AUTH: SignUpView
   ═══════════════════════════════════════════════════════════ */

function SignUpView({ onAuth }) {
  const [step, setStep] = useState("form"); // "form" | "otp"
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
        const optionsResp = await authRequest({
          pathname: "/v1/public/signup/passkey/options",
          body: { email: email.trim(), company: email.trim().split("@")[0] },
        });

        if (optionsResp?.challenge && optionsResp?.challengeId) {
          const keypair = await generateBrowserEd25519KeypairPem();
          const signature = await signBrowserPasskeyChallengeBase64Url({
            privateKeyPem: keypair.privateKeyPem,
            challenge: optionsResp.challenge,
          });

          const passkeyResp = await authRequest({
            pathname: "/v1/public/signup/passkey",
            body: {
              tenantId: optionsResp.tenantId,
              challengeId: optionsResp.challengeId,
              challenge: optionsResp.challenge,
              credentialId: keypair.keyId,
              publicKeyPem: keypair.publicKeyPem,
              signature,
              label: `${navigator.userAgent.split(" ").slice(-1)[0] || "Browser"} passkey`,
            },
          });

          saveStoredBuyerPasskeyBundle({
            tenantId: optionsResp.tenantId || passkeyResp?.tenantId,
            email: email.trim(),
            credentialId: keypair.keyId,
            publicKeyPem: keypair.publicKeyPem,
            privateKeyPem: keypair.privateKeyPem,
            keyId: keypair.keyId,
            label: "Browser passkey",
            createdAt: new Date().toISOString(),
          });

          const principal = await fetchSessionPrincipal();
          const runtime = loadRuntimeConfig();
          const tenantId = optionsResp.tenantId || passkeyResp?.tenantId || principal?.tenantId || runtime.tenantId;
          saveRuntime({ ...runtime, tenantId });
          saveOnboardingState({ buyer: principal, sessionExpected: true, completed: true });
          passkeySuccess = true;
          onAuth?.("builder");
        }
      } catch {
        // Passkey not supported — fall through to OTP
      }

      if (!passkeySuccess) {
        const result = await authRequest({
          pathname: "/v1/public/signup",
          body: { email: email.trim(), company: email.trim().split("@")[0] },
        });
        setSignupResult(result);
        setStep("otp");
      }
    } catch (err) {
      setError(err?.message || "Sign up failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmitOtp(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const tenantId = signupResult?.tenantId;

      if (tenantId) {
        await authRequest({
          pathname: `/v1/tenants/${encodeURIComponent(tenantId)}/buyer/login`,
          body: { email: email.trim(), code: otpCode.trim() },
        });
      }

      const principal = await fetchSessionPrincipal();
      const runtime = loadRuntimeConfig();
      saveRuntime({ ...runtime, tenantId: tenantId || principal?.tenantId || runtime.tenantId });
      saveOnboardingState({ buyer: principal, sessionExpected: true, completed: true });

      // Try to register a passkey now that we have a session
      try {
        const keypair = await generateBrowserEd25519KeypairPem();
        const optionsResp = await authRequest({
          pathname: `/v1/tenants/${encodeURIComponent(tenantId)}/buyer/login/passkey/options`,
          body: { email: email.trim(), company: email.trim().split("@")[0] },
        });
        if (optionsResp?.challenge && optionsResp?.challengeId) {
          const signature = await signBrowserPasskeyChallengeBase64Url({
            privateKeyPem: keypair.privateKeyPem,
            challenge: optionsResp.challenge,
          });
          await authRequest({
            pathname: `/v1/tenants/${encodeURIComponent(tenantId)}/buyer/login/passkey`,
            body: {
              challengeId: optionsResp.challengeId,
              challenge: optionsResp.challenge,
              credentialId: keypair.keyId,
              publicKeyPem: keypair.publicKeyPem,
              signature,
              label: "Browser passkey",
            },
          });
          saveStoredBuyerPasskeyBundle({
            tenantId,
            email: email.trim(),
            credentialId: keypair.keyId,
            publicKeyPem: keypair.publicKeyPem,
            privateKeyPem: keypair.privateKeyPem,
            keyId: keypair.keyId,
            label: "Browser passkey",
            createdAt: new Date().toISOString(),
          });
        }
      } catch {
        // Passkey registration is optional
      }

      onAuth?.("builder");
    } catch (err) {
      setError(err?.message || "Invalid code. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (step === "otp") {
    return (
      <div style={S.authWrap}>
        <div style={S.authBox} className="lovable-fade">
          <h1 style={S.authTitle}>Check your email</h1>
          <p style={S.authSub}>
            We sent a 6-digit code to <strong style={{ color: "var(--neutral-100)" }}>{email}</strong>.
            Enter it below to verify your account.
          </p>
          {error && <div style={S.error}>{error}</div>}
          <form onSubmit={handleSubmitOtp}>
            <label style={S.label}>Verification code</label>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              required
              autoFocus
              style={{
                ...S.otpInput,
                ...(otpCode.length === 6 ? { borderColor: "var(--gold)" } : {}),
              }}
            />
            <button
              type="submit"
              style={{ ...S.btnPrimary, opacity: loading || otpCode.length < 6 ? 0.5 : 1 }}
              disabled={loading || otpCode.length < 6}
            >
              {loading ? "Verifying..." : "Verify and continue"}
            </button>
          </form>
          <p style={{ ...S.authSub, marginTop: "1.5rem", marginBottom: 0, fontSize: "0.82rem" }}>
            Didn't receive a code?{" "}
            <button
              style={S.btnGhost}
              onClick={async () => {
                setError("");
                try {
                  await authRequest({
                    pathname: "/v1/public/signup",
                    body: { email: email.trim(), company: email.trim().split("@")[0] },
                  });
                } catch { /* ignore */ }
              }}
            >
              Resend
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={S.authWrap}>
      <div style={S.authBox} className="lovable-fade">
        <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--neutral-50)", marginBottom: "2rem", letterSpacing: "-0.01em" }}>
          nooterra
        </div>
        <h1 style={S.authTitle}>Get started</h1>
        <p style={S.authSub}>
          We'll send a verification code to your email. No password needed.
        </p>
        {error && <div style={S.error}>{error}</div>}
        <form onSubmit={handleSubmitForm}>
          <label style={S.label}>Email</label>
          <FocusInput
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            autoFocus
          />
          <button
            type="submit"
            style={{ ...S.btnPrimary, opacity: loading ? 0.6 : 1 }}
            disabled={loading || !email.trim()}
          >
            {loading ? "Sending code..." : "Continue \u2192"}
          </button>
        </form>
        <p style={{ ...S.authSub, marginTop: "1.5rem", marginBottom: 0 }}>
          Already have an account?{" "}
          <a href="/login" style={S.link} onClick={(e) => { e.preventDefault(); navigate("/login"); }}>
            Sign in
          </a>
        </p>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   AUTH: SignInView
   ═══════════════════════════════════════════════════════════ */

function SignInView({ onAuth }) {
  const [step, setStep] = useState("form"); // "form" | "otp"
  const [tenantId, setTenantId] = useState("");
  const [email, setEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasStoredPasskey, setHasStoredPasskey] = useState(false);

  // On mount, check for stored passkey and auto-fill
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
    setError("");
    setLoading(true);
    const tid = tenantId.trim();
    const em = email.trim();
    try {
      const storedPasskey = loadStoredBuyerPasskeyBundle({ tenantId: tid, email: em });
      if (!storedPasskey) {
        setError("No stored passkey found. Please use email sign-in.");
        setLoading(false);
        return;
      }

      const optionsResp = await authRequest({
        pathname: `/v1/tenants/${encodeURIComponent(tid)}/buyer/login/passkey/options`,
        body: { email: em },
      });

      if (optionsResp?.challenge && optionsResp?.challengeId) {
        const signature = await signBrowserPasskeyChallengeBase64Url({
          privateKeyPem: storedPasskey.privateKeyPem,
          challenge: optionsResp.challenge,
        });

        await authRequest({
          pathname: `/v1/tenants/${encodeURIComponent(tid)}/buyer/login/passkey`,
          body: {
            challengeId: optionsResp.challengeId,
            challenge: optionsResp.challenge,
            credentialId: storedPasskey.credentialId,
            publicKeyPem: storedPasskey.publicKeyPem,
            signature,
          },
        });

        touchStoredBuyerPasskeyBundle({ tenantId: tid, email: em });

        const principal = await fetchSessionPrincipal();
        const runtime = loadRuntimeConfig();
        saveRuntime({ ...runtime, tenantId: tid });
        saveOnboardingState({ buyer: principal, sessionExpected: true, completed: true });
        onAuth?.("dashboard");
        return;
      }

      setError("Passkey authentication failed. Try email sign-in instead.");
    } catch (err) {
      setError(err?.message || "Passkey sign-in failed. Try email sign-in instead.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const tid = tenantId.trim();
    const em = email.trim();
    try {
      const storedPasskey = loadStoredBuyerPasskeyBundle({ tenantId: tid, email: em });

      if (storedPasskey) {
        const optionsResp = await authRequest({
          pathname: `/v1/tenants/${encodeURIComponent(tid)}/buyer/login/passkey/options`,
          body: { email: em },
        });

        if (optionsResp?.challenge && optionsResp?.challengeId) {
          const signature = await signBrowserPasskeyChallengeBase64Url({
            privateKeyPem: storedPasskey.privateKeyPem,
            challenge: optionsResp.challenge,
          });

          await authRequest({
            pathname: `/v1/tenants/${encodeURIComponent(tid)}/buyer/login/passkey`,
            body: {
              challengeId: optionsResp.challengeId,
              challenge: optionsResp.challenge,
              credentialId: storedPasskey.credentialId,
              publicKeyPem: storedPasskey.publicKeyPem,
              signature,
            },
          });

          touchStoredBuyerPasskeyBundle({ tenantId: tid, email: em });

          const principal = await fetchSessionPrincipal();
          const runtime = loadRuntimeConfig();
          saveRuntime({ ...runtime, tenantId: tid });
          saveOnboardingState({ buyer: principal, sessionExpected: true, completed: true });
          onAuth?.("dashboard");
          return;
        }
      }

      await authRequest({
        pathname: `/v1/tenants/${encodeURIComponent(tid)}/buyer/login/otp`,
        body: { email: em },
      });
      setStep("otp");
    } catch (err) {
      setError(err?.message || "Sign in failed. Check your credentials.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmitOtp(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const tid = tenantId.trim();
    const em = email.trim();
    try {
      await authRequest({
        pathname: `/v1/tenants/${encodeURIComponent(tid)}/buyer/login`,
        body: { email: em, code: otpCode.trim() },
      });

      const principal = await fetchSessionPrincipal();
      const runtime = loadRuntimeConfig();
      saveRuntime({ ...runtime, tenantId: tid });
      saveOnboardingState({ buyer: principal, sessionExpected: true, completed: true });
      onAuth?.("dashboard");
    } catch (err) {
      setError(err?.message || "Invalid code. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (step === "otp") {
    return (
      <div style={S.authWrap}>
        <div style={S.authBox} className="lovable-fade">
          <h1 style={S.authTitle}>Check your email</h1>
          <p style={S.authSub}>
            We sent a 6-digit code to <strong style={{ color: "var(--neutral-100)" }}>{email}</strong>.
          </p>
          {error && <div style={S.error}>{error}</div>}
          <form onSubmit={handleSubmitOtp}>
            <label style={S.label}>Verification code</label>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              required
              autoFocus
              style={{
                ...S.otpInput,
                ...(otpCode.length === 6 ? { borderColor: "var(--gold)" } : {}),
              }}
            />
            <button
              type="submit"
              style={{ ...S.btnPrimary, opacity: loading || otpCode.length < 6 ? 0.5 : 1 }}
              disabled={loading || otpCode.length < 6}
            >
              {loading ? "Verifying..." : "Sign in"}
            </button>
          </form>
          <p style={{ ...S.authSub, marginTop: "1.5rem", marginBottom: 0, fontSize: "0.82rem" }}>
            <button
              style={S.btnGhost}
              onClick={() => { setStep("form"); setOtpCode(""); setError(""); }}
            >
              Back to login
            </button>
          </p>
        </div>
      </div>
    );
  }

  // If we have a stored passkey, show simplified sign-in
  if (hasStoredPasskey) {
    return (
      <div style={S.authWrap}>
        <div style={S.authBox} className="lovable-fade">
          <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--neutral-50)", marginBottom: "2rem", letterSpacing: "-0.01em" }}>
            nooterra
          </div>
          <h1 style={S.authTitle}>Welcome back</h1>
          <p style={S.authSub}>
            Signing in as <strong style={{ color: "var(--neutral-100)" }}>{email}</strong>
          </p>
          {error && <div style={S.error}>{error}</div>}
          <button
            style={{ ...S.btnPrimary, opacity: loading ? 0.6 : 1, marginBottom: "1rem" }}
            disabled={loading}
            onClick={handlePasskeyLogin}
          >
            {loading ? "Signing in..." : "Sign in with passkey"}
          </button>
          <p style={{ ...S.authSub, marginTop: "1rem", marginBottom: 0, fontSize: "0.82rem" }}>
            Not you?{" "}
            <button
              style={S.btnGhost}
              onClick={() => { setHasStoredPasskey(false); setTenantId(""); setEmail(""); setError(""); }}
            >
              Use a different account
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={S.authWrap}>
      <div style={S.authBox} className="lovable-fade">
        <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--neutral-50)", marginBottom: "2rem", letterSpacing: "-0.01em" }}>
          nooterra
        </div>
        <h1 style={S.authTitle}>Welcome back</h1>
        <p style={S.authSub}>
          Sign in to your account.
        </p>
        {error && <div style={S.error}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label style={S.label}>Email</label>
          <FocusInput
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            autoFocus
          />
          <label style={S.label}>Your account ID</label>
          <FocusInput
            type="text"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            placeholder="tenant_abc123"
            required
          />
          <p style={{ fontSize: "0.78rem", color: "var(--neutral-500)", marginTop: "-0.75rem", marginBottom: "1.25rem", lineHeight: 1.4 }}>
            Check your signup email for this.
          </p>
          <button
            type="submit"
            style={{ ...S.btnPrimary, opacity: loading ? 0.6 : 1 }}
            disabled={loading}
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "1.5rem" }}>
          <a href="/signup" style={S.link} onClick={(e) => { e.preventDefault(); navigate("/signup"); }}>
            Create account
          </a>
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
      case "browser":
        rules.canDo.push("Browse websites and fetch web pages");
        rules.canDo.push("Extract content from pages");
        rules.askFirst.push("Fill forms or submit data on websites");
        break;
      case "slack":
        rules.canDo.push("Read messages from allowed channels");
        rules.canDo.push("Send messages to allowed channels");
        rules.askFirst.push("Send direct messages to individuals");
        rules.neverDo.push("Post to channels not in the allowed list");
        break;
      case "email":
        rules.canDo.push("Read emails matching search criteria");
        if (/send|reply|forward/.test(desc)) rules.askFirst.push("Send emails");
        rules.neverDo.push("Delete emails permanently");
        break;
      case "github":
        rules.canDo.push("Read repository contents");
        rules.canDo.push("Create and update issues");
        rules.askFirst.push("Create or merge pull requests");
        rules.neverDo.push("Delete branches or repositories");
        break;
      case "filesystem":
        rules.canDo.push("Read files in allowed directories");
        if (/write|create|save/.test(desc)) rules.canDo.push("Write files in allowed directories");
        rules.neverDo.push("Access files outside allowed directories");
        break;
      case "webSearch":
        rules.canDo.push("Search the web for information");
        break;
      default: break;
    }
  }
  if (/monitor|watch|track|alert/.test(desc)) {
    rules.canDo.push("Monitor specified data sources continuously");
    rules.canDo.push("Send alerts when conditions are met");
  }
  if (/write|draft|create|generate/.test(desc)) {
    rules.canDo.push("Draft content based on instructions");
    rules.askFirst.push("Publish or send drafted content");
    rules.neverDo.push("Publish without human approval");
  }
  if (/price|cost|budget|spend/.test(desc)) {
    rules.askFirst.push("Make purchases above threshold");
    rules.neverDo.push("Exceed budget limits");
  }
  rules.neverDo.push("Spend money without approval");
  rules.neverDo.push("Access credentials or keys directly");
  rules.canDo = [...new Set(rules.canDo)];
  rules.askFirst = [...new Set(rules.askFirst)];
  rules.neverDo = [...new Set(rules.neverDo)];
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
  const desc = description.trim().toLowerCase();
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
   BUILDER: State machine
   ═══════════════════════════════════════════════════════════ */

const BUILDER_STATES = {
  GREETING: "greeting",
  UNDERSTANDING: "understanding",
  CAPABILITIES_CHECK: "capabilities_check",
  CHARTER_REVIEW: "charter_review",
  MODEL_SUGGEST: "model_suggest",
  CONFIRM: "confirm",
  DEPLOYING: "deploying",
  DEPLOYED: "deployed",
};

function createBuilderConversation() {
  return {
    state: BUILDER_STATES.GREETING,
    messages: [],
    context: {
      taskDescription: null,
      workerName: null,
      capabilities: [],
      charter: null,
      schedule: null,
      model: "google/gemini-3-flash",
    },
  };
}

function addBuilderMessage(conv, role, content, meta = null) {
  conv.messages.push({ id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, role, content, meta, ts: Date.now() });
}

function processBuilderInput(conv, userInput) {
  const input = userInput.trim();
  addBuilderMessage(conv, "user", input);

  switch (conv.state) {
    case BUILDER_STATES.GREETING:
    case BUILDER_STATES.UNDERSTANDING: {
      if (input.length < 5) {
        addBuilderMessage(conv, "builder", "Tell me a bit more -- what should this worker actually do? The more detail, the better.");
        return;
      }
      conv.context.taskDescription = input;
      conv.context.capabilities = inferCapabilities(input);
      conv.context.schedule = inferSchedule(input);
      conv.context.workerName = inferWorkerName(input);
      conv.context.charter = inferCharterRules(input, conv.context.capabilities);

      if (conv.context.capabilities.length === 0) {
        addBuilderMessage(conv, "builder", "Got it. I didn't detect any specific integrations from your description. This worker will use built-in tools (web browsing, search, file system). Sound good, or do you need something specific like Slack, Gmail, or GitHub?", { type: "capabilities_fallback" });
        conv.state = BUILDER_STATES.CAPABILITIES_CHECK;
        return;
      }

      const capNames = conv.context.capabilities.map(c => c.name).join(", ");
      addBuilderMessage(conv, "builder",
        `Got it. I'll call this worker "${conv.context.workerName}".`,
      );
      addBuilderMessage(conv, "builder",
        `This worker will need: ${capNames}. Want to connect them now, or skip for later?`,
        { type: "capabilities", capabilities: conv.context.capabilities },
      );
      conv.state = BUILDER_STATES.CAPABILITIES_CHECK;
      return;
    }

    case BUILDER_STATES.CAPABILITIES_CHECK: {
      const lower = input.toLowerCase();
      if (/add|also|slack|gmail|email|github|browser|search/.test(lower)) {
        const additional = inferCapabilities(input);
        const existingIds = new Set(conv.context.capabilities.map(c => c.id));
        for (const cap of additional) {
          if (!existingIds.has(cap.id)) {
            conv.context.capabilities.push(cap);
          }
        }
        conv.context.charter = inferCharterRules(conv.context.taskDescription, conv.context.capabilities);
      }

      addBuilderMessage(conv, "builder",
        "Here's the charter I'd suggest for this worker. Review it and let me know if you want to change anything.",
        { type: "charter", charter: conv.context.charter },
      );
      conv.state = BUILDER_STATES.CHARTER_REVIEW;
      return;
    }

    case BUILDER_STATES.CHARTER_REVIEW: {
      const lower = input.toLowerCase();
      if (/add .+ to (askfirst|ask first|never|can do|cando)/i.test(lower)) {
        const addMatch = input.match(/add (.+?) to (askfirst|ask first|never|neverdo|can do|cando)/i);
        if (addMatch) {
          const rule = addMatch[1].trim();
          const bucket = addMatch[2].toLowerCase().replace(/\s+/g, "");
          if (bucket === "askfirst") conv.context.charter.askFirst.push(rule);
          else if (bucket === "never" || bucket === "neverdo") conv.context.charter.neverDo.push(rule);
          else if (bucket === "cando") conv.context.charter.canDo.push(rule);
          addBuilderMessage(conv, "builder", `Done. Updated the charter.`, { type: "charter", charter: conv.context.charter });
          return;
        }
      }
      if (/remove|delete/i.test(lower)) {
        addBuilderMessage(conv, "builder", "Which rule should I remove? Paste the exact text or tell me which section (canDo, askFirst, neverDo) and what to remove.");
        return;
      }
      const topModels = RECOMMENDED_MODELS.slice(0, 3);
      const currentModel = RECOMMENDED_MODELS.find(m => m.id === conv.context.model) || topModels[0];
      addBuilderMessage(conv, "builder",
        `I'd recommend ${currentModel.name} for this type of work -- $${currentModel.inputPer1M.toFixed(2)}/$${currentModel.outputPer1M.toFixed(2)} per 1M tokens. You can change this anytime in settings.`,
        { type: "models", models: topModels, selected: conv.context.model },
      );
      conv.state = BUILDER_STATES.MODEL_SUGGEST;
      return;
    }

    case BUILDER_STATES.MODEL_SUGGEST: {
      const lower = input.toLowerCase();
      for (const m of RECOMMENDED_MODELS) {
        if (lower.includes(m.name.toLowerCase()) || lower.includes(m.id.toLowerCase())) {
          conv.context.model = m.id;
          break;
        }
      }
      const schedule = conv.context.schedule;
      addBuilderMessage(conv, "builder",
        `Ready to deploy "${conv.context.workerName}"? Schedule: ${schedule?.label || "on demand"}.`,
        { type: "confirm", workerName: conv.context.workerName, schedule },
      );
      conv.state = BUILDER_STATES.CONFIRM;
      return;
    }

    case BUILDER_STATES.CONFIRM: {
      const lower = input.toLowerCase();
      if (/no|wait|change|edit|back/.test(lower)) {
        addBuilderMessage(conv, "builder", "No problem. What would you like to change? You can say things like 'change the name', 'edit the charter', or 'pick a different model'.");
        return;
      }
      conv.state = BUILDER_STATES.DEPLOYING;
      return;
    }

    default:
      addBuilderMessage(conv, "builder", "Something went wrong. Let's start fresh -- what do you need a worker to do?");
      conv.state = BUILDER_STATES.GREETING;
  }
}

/* ═══════════════════════════════════════════════════════════
   BUILDER: useBuilderState hook
   ═══════════════════════════════════════════════════════════ */

function useBuilderState() {
  const [conv, setConv] = useState(() => createBuilderConversation());
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState("");
  const [deployedWorker, setDeployedWorker] = useState(null);

  function sendMessage(text) {
    const next = { ...conv, messages: [...conv.messages], context: { ...conv.context } };
    if (next.context.charter) {
      next.context.charter = {
        canDo: [...next.context.charter.canDo],
        askFirst: [...next.context.charter.askFirst],
        neverDo: [...next.context.charter.neverDo],
      };
    }
    if (next.context.capabilities) {
      next.context.capabilities = [...next.context.capabilities];
    }
    processBuilderInput(next, text);
    setConv(next);

    if (next.state === BUILDER_STATES.DEPLOYING) {
      handleDeploy(next);
    }
  }

  function selectModel(modelId) {
    const next = { ...conv, messages: [...conv.messages], context: { ...conv.context } };
    next.context.model = modelId;
    const m = RECOMMENDED_MODELS.find(r => r.id === modelId);
    if (m) {
      addBuilderMessage(next, "user", m.name);
    }
    const schedule = next.context.schedule;
    addBuilderMessage(next, "builder",
      `Ready to deploy "${next.context.workerName}"? Schedule: ${schedule?.label || "on demand"}.`,
      { type: "confirm", workerName: next.context.workerName, schedule },
    );
    next.state = BUILDER_STATES.CONFIRM;
    setConv(next);
  }

  async function handleDeploy(c) {
    setDeploying(true);
    setDeployError("");
    try {
      const charter = c.context.charter || { canDo: [], askFirst: [], neverDo: [] };
      const result = await workerApiRequest({
        pathname: "/v1/workers",
        method: "POST",
        body: {
          name: c.context.workerName || "New Worker",
          description: c.context.taskDescription || "",
          charter: JSON.stringify(charter),
          schedule: scheduleToApiValue(c.context.schedule),
          model: c.context.model,
        },
      });
      setDeployedWorker(result);

      saveOnboardingState({
        buyer: loadOnboardingState()?.buyer || null,
        sessionExpected: true,
        completed: true,
      });

      const next = { ...c, messages: [...c.messages] };
      addBuilderMessage(next, "builder",
        `"${c.context.workerName}" is live.`,
        { type: "deployed", worker: result, workerName: c.context.workerName },
      );
      next.state = BUILDER_STATES.DEPLOYED;
      setConv(next);
    } catch (err) {
      setDeployError(err?.message || "Failed to deploy worker.");
      const next = { ...c, messages: [...c.messages] };
      addBuilderMessage(next, "builder", `Deploy failed: ${err?.message || "Unknown error"}. Try again?`);
      next.state = BUILDER_STATES.CONFIRM;
      setConv(next);
    }
    setDeploying(false);
  }

  function reset() {
    const c = createBuilderConversation();
    setConv(c);
    setDeployedWorker(null);
    setDeployError("");
  }

  return { conv, sendMessage, selectModel, deploying, deployError, deployedWorker, reset };
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
      {sections.map((sec) =>
        sec.items.length > 0 ? (
          <div key={sec.key} style={{ marginBottom: compact ? "0.75rem" : "1.25rem" }}>
            <div
              style={{
                ...S.charterLabel,
                color: sec.color,
                fontSize: compact ? "0.7rem" : "0.75rem",
              }}
            >
              {sec.label}
            </div>
            {sec.items.map((item, i) => (
              <div key={i} style={{ ...S.charterItem, fontSize: compact ? "0.82rem" : "0.88rem" }}>
                <span style={S.statusDot(sec.color)} />
                {item}
              </div>
            ))}
          </div>
        ) : null
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   BuilderMessage — renders a single message in the chat
   ═══════════════════════════════════════════════════════════ */

function BuilderMessage({ msg, onAction, selectedModel }) {
  const isUser = msg.role === "user";

  if (isUser) {
    return (
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.5rem" }} className="lovable-fade">
        <div style={{
          maxWidth: "75%",
          padding: "0.75rem 1rem",
          borderRadius: 16,
          borderBottomRightRadius: 4,
          fontSize: "0.9rem",
          lineHeight: 1.55,
          color: "var(--neutral-100)",
          background: "var(--neutral-800)",
          wordBreak: "break-word",
        }}>
          {msg.content}
        </div>
      </div>
    );
  }

  const meta = msg.meta;

  return (
    <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: "0.5rem" }} className="lovable-fade">
      <div style={{
        maxWidth: "85%",
        fontSize: "0.9rem",
        lineHeight: 1.6,
        color: "var(--neutral-200)",
        wordBreak: "break-word",
      }}>
        <div>{msg.content}</div>

        {/* Capabilities with connect buttons */}
        {meta?.type === "capabilities" && meta.capabilities?.length > 0 && (
          <div style={{ marginTop: "0.75rem", display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {meta.capabilities.map(cap => (
              <button
                key={cap.id}
                style={{
                  padding: "0.4rem 0.85rem",
                  fontSize: "0.82rem",
                  fontWeight: 600,
                  background: "rgba(210,176,111,0.08)",
                  color: "var(--gold)",
                  border: "1px solid rgba(210,176,111,0.3)",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
                onClick={() => alert(`Integration coming soon. Your worker will use built-in tools for ${cap.name} for now.`)}
              >
                Connect {cap.name}
              </button>
            ))}
            <button
              style={{
                padding: "0.4rem 0.85rem",
                fontSize: "0.82rem",
                fontWeight: 500,
                background: "transparent",
                color: "var(--neutral-400)",
                border: "1px solid var(--neutral-700)",
                borderRadius: 6,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
              onClick={() => onAction?.("skip_capabilities")}
            >
              Skip for now
            </button>
          </div>
        )}

        {meta?.type === "capabilities_fallback" && (
          <div style={{ marginTop: "0.75rem" }}>
            <button
              style={{
                padding: "0.4rem 0.85rem",
                fontSize: "0.82rem",
                fontWeight: 500,
                background: "transparent",
                color: "var(--neutral-400)",
                border: "1px solid var(--neutral-700)",
                borderRadius: 6,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
              onClick={() => onAction?.("skip_capabilities")}
            >
              Sounds good, continue
            </button>
          </div>
        )}

        {/* Charter preview */}
        {meta?.type === "charter" && meta.charter && (
          <div style={{
            marginTop: "0.75rem",
            padding: "1rem",
            background: "rgba(0,0,0,0.25)",
            borderRadius: 10,
            borderLeft: "3px solid var(--gold)",
          }}>
            <CharterDisplay charter={meta.charter} compact />
            <button
              style={{
                marginTop: "0.5rem",
                padding: "0.4rem 0.85rem",
                fontSize: "0.82rem",
                fontWeight: 500,
                background: "transparent",
                color: "var(--neutral-400)",
                border: "1px solid var(--neutral-700)",
                borderRadius: 6,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
              onClick={() => onAction?.("charter_ok")}
            >
              Looks good
            </button>
          </div>
        )}

        {/* Model selection cards */}
        {meta?.type === "models" && meta.models && (
          <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            {meta.models.map(m => (
              <div
                key={m.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "0.6rem 0.9rem",
                  borderRadius: 8,
                  border: m.id === (selectedModel || meta.selected) ? "1px solid var(--gold)" : "1px solid var(--neutral-700)",
                  background: m.id === (selectedModel || meta.selected) ? "rgba(210,176,111,0.08)" : "transparent",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
                onClick={() => onAction?.("select_model", m.id)}
              >
                <div>
                  <span style={{ fontSize: "0.88rem", fontWeight: 600, color: m.id === (selectedModel || meta.selected) ? "var(--neutral-100)" : "var(--neutral-300)" }}>{m.name}</span>
                  <span style={{ fontSize: "0.75rem", color: "var(--neutral-500)", marginLeft: 8 }}>{m.tag}</span>
                </div>
                <span style={{ fontSize: "0.75rem", color: "var(--neutral-500)", fontVariantNumeric: "tabular-nums" }}>
                  ${m.inputPer1M.toFixed(2)} / ${m.outputPer1M.toFixed(2)} per 1M
                </span>
              </div>
            ))}
            <button
              style={{
                marginTop: "0.25rem",
                padding: "0.4rem 0.85rem",
                fontSize: "0.82rem",
                fontWeight: 500,
                background: "transparent",
                color: "var(--neutral-400)",
                border: "1px solid var(--neutral-700)",
                borderRadius: 6,
                cursor: "pointer",
                fontFamily: "inherit",
                alignSelf: "flex-start",
              }}
              onClick={() => onAction?.("confirm_model")}
            >
              Use recommended
            </button>
          </div>
        )}

        {/* Deploy confirmation */}
        {meta?.type === "confirm" && (
          <div style={{ marginTop: "0.75rem" }}>
            <button
              style={{
                padding: "0.6rem 1.5rem",
                fontSize: "0.88rem",
                fontWeight: 600,
                background: "var(--gold)",
                color: "var(--neutral-950)",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
              onClick={() => onAction?.("deploy")}
            >
              Deploy worker
            </button>
          </div>
        )}

        {/* Deployed success */}
        {meta?.type === "deployed" && (
          <div style={{ marginTop: "0.75rem" }}>
            <button
              style={{
                padding: "0.55rem 1.25rem",
                fontSize: "0.85rem",
                fontWeight: 600,
                background: "var(--gold)",
                color: "var(--neutral-950)",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
              onClick={() => onAction?.("view_worker", meta.worker)}
            >
              View worker
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   AutoTextarea — grows with content, min 1 row, max 5 rows
   ═══════════════════════════════════════════════════════════ */

function AutoTextarea({ value, onChange, onKeyDown, placeholder, disabled, autoFocus }) {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = "auto";
      const scrollH = ref.current.scrollHeight;
      const lineH = 24;
      const maxH = lineH * 5 + 24; // 5 rows + padding
      ref.current.style.height = Math.min(scrollH, maxH) + "px";
    }
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      rows={1}
      style={{
        width: "100%",
        padding: "0.85rem 1rem",
        paddingBottom: "2.75rem",
        fontSize: "0.95rem",
        background: "transparent",
        border: "none",
        color: "var(--neutral-100)",
        outline: "none",
        fontFamily: "inherit",
        resize: "none",
        lineHeight: "24px",
        overflow: "auto",
      }}
    />
  );
}

/* ═══════════════════════════════════════════════════════════
   BuilderInputBox — the fancy input with model selector + send
   ═══════════════════════════════════════════════════════════ */

function BuilderInputBox({ value, onChange, onSend, disabled, model, onModelChange, placeholder }) {
  const [focused, setFocused] = useState(false);

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend?.();
    }
  }

  const selectedModel = RECOMMENDED_MODELS.find(m => m.id === model);

  return (
    <div
      style={{
        background: "var(--neutral-900)",
        border: focused ? "1px solid var(--gold)" : "1px solid var(--neutral-700)",
        borderRadius: 16,
        transition: "border-color 0.15s",
        position: "relative",
        maxWidth: 680,
        width: "100%",
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <AutoTextarea
        value={value}
        onChange={onChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || "Describe what you need..."}
        disabled={disabled}
        autoFocus
      />
      {/* Bottom bar: model selector + send */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 0.75rem 0.65rem",
      }}>
        <select
          value={model}
          onChange={(e) => onModelChange?.(e.target.value)}
          style={{
            background: "transparent",
            border: "1px solid var(--neutral-700)",
            borderRadius: 6,
            color: "var(--neutral-400)",
            fontSize: "0.78rem",
            padding: "0.3rem 0.5rem",
            fontFamily: "inherit",
            outline: "none",
            cursor: "pointer",
            appearance: "none",
            paddingRight: "1.2rem",
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23666' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
            backgroundRepeat: "no-repeat",
            backgroundPosition: "right 0.4rem center",
          }}
        >
          {RECOMMENDED_MODELS.map(m => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <SendArrow disabled={disabled || !value.trim()} onClick={onSend} />
      </div>
    </div>
  );
}

/* ── TemplateCard ── */

function TemplateCard({ template, onDeploy, deploying }) {
  return (
    <div style={{ padding: "1.5rem", border: "1px solid var(--neutral-800)", borderRadius: 12, background: "var(--neutral-900)", display: "flex", flexDirection: "column", gap: "0.75rem", transition: "border-color 0.15s", cursor: "default" }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--neutral-600)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--neutral-800)"; }}>
      <div style={{ fontSize: "1rem", fontWeight: 700, color: "var(--neutral-50)" }}>{template.name}</div>
      <div style={{ fontSize: "0.85rem", color: "var(--neutral-400)", lineHeight: 1.5, flex: 1 }}>{template.description}</div>
      <button style={{ ...S.btnPrimary, width: "auto", alignSelf: "flex-start", padding: "0.5rem 1.25rem", fontSize: "0.82rem", opacity: deploying ? 0.5 : 1 }} disabled={deploying} onClick={() => onDeploy(template)}>{deploying ? "Deploying..." : "Deploy \u2192"}</button>
    </div>
  );
}

/* ── TemplateCharterReview ── */

function TemplateCharterReview({ template, onDeploy, onCustomize, deploying }) {
  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "2rem" }} className="lovable-fade">
      <button style={S.backLink} onClick={onCustomize}>← Back</button>
      <h2 style={{ ...S.pageTitle, marginBottom: "0.5rem" }}>{template.name}</h2>
      <p style={{ ...S.pageSub, marginBottom: "1.5rem" }}>{template.description}</p>
      <div style={{ padding: "1.25rem", background: "rgba(0,0,0,0.25)", borderRadius: 10, borderLeft: "3px solid var(--gold)", marginBottom: "2rem" }}>
        <div style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--neutral-300)", marginBottom: "1rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>What this worker can do</div>
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
   BuilderView — the main builder chat (Claude/ChatGPT style)
   Now with template selection for first-time users
   ═══════════════════════════════════════════════════════════ */

function BuilderView({ onComplete, onViewWorker, userName, isFirstTime }) {
  const { conv, sendMessage, selectModel, deploying, deployedWorker, reset } = useBuilderState();
  const [inputValue, setInputValue] = useState("");
  const [selectedModel, setSelectedModel] = useState("google/gemini-3-flash");
  const messagesEndRef = useRef(null);
  const [templateReview, setTemplateReview] = useState(null); // template being reviewed
  const [templateDeploying, setTemplateDeploying] = useState(false);
  const [templateError, setTemplateError] = useState("");

  const hasMessages = conv.messages.length > 0;
  const isDeployed = conv.state === BUILDER_STATES.DEPLOYED;
  const isDeploying = conv.state === BUILDER_STATES.DEPLOYING || deploying;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conv.messages.length]);

  function handleSend() {
    const text = inputValue.trim();
    if (!text || isDeploying) return;
    setInputValue("");
    sendMessage(text);
  }

  function handleAction(action, payload) {
    switch (action) {
      case "skip_capabilities":
        sendMessage("skip for now");
        break;
      case "charter_ok":
        sendMessage("looks good");
        break;
      case "select_model":
        setSelectedModel(payload);
        selectModel(payload);
        break;
      case "confirm_model":
        sendMessage("use recommended");
        break;
      case "deploy":
        sendMessage("deploy");
        break;
      case "view_worker":
        if (payload?.id) {
          onViewWorker?.(payload);
        } else {
          onComplete?.();
        }
        break;
      default:
        break;
    }
  }

  async function handleTemplateDeploy(template) {
    setTemplateDeploying(true);
    setTemplateError("");
    try {
      const result = await workerApiRequest({
        pathname: "/v1/workers",
        method: "POST",
        body: {
          name: template.name,
          description: template.description,
          charter: JSON.stringify(template.charter),
          schedule: templateScheduleToApiValue(template.schedule),
          model: template.model,
        },
      });

      saveOnboardingState({
        buyer: loadOnboardingState()?.buyer || null,
        sessionExpected: true,
        completed: true,
      });

      // Go directly to worker detail
      if (result?.id) {
        onViewWorker?.(result);
      } else {
        onComplete?.();
      }
    } catch (err) {
      setTemplateError(err?.message || "Failed to deploy worker.");
    }
    setTemplateDeploying(false);
  }

  // Template charter review screen
  if (templateReview) {
    return (
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        minHeight: "calc(100vh - 1px)",
        padding: "2rem",
      }}>
        {templateError && <div style={{ ...S.error, textAlign: "center", marginBottom: "1rem" }}>{templateError}</div>}
        <TemplateCharterReview
          template={templateReview}
          onDeploy={() => handleTemplateDeploy(templateReview)}
          onCustomize={() => { setTemplateReview(null); setTemplateError(""); }}
          deploying={templateDeploying}
        />
      </div>
    );
  }

  // Welcome screen with templates (shown when no messages and first-time user)
  if (!hasMessages && isFirstTime) {
    return (
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        minHeight: "calc(100vh - 1px)",
        padding: "2rem",
      }}>
        <div style={{ flex: 1 }} />
        <div style={{ textAlign: "center", marginBottom: "2.5rem", maxWidth: 600 }}>
          <h1 style={{
            fontSize: "clamp(1.5rem, 4vw, 2.2rem)",
            fontWeight: 700,
            color: "var(--neutral-50)",
            lineHeight: 1.2,
            marginBottom: "0.5rem",
          }}>
            Welcome to Nooterra.
          </h1>
          <p style={{ fontSize: "1rem", color: "var(--neutral-400)", marginTop: "0.5rem" }}>
            Deploy your first worker in 30 seconds.
          </p>
        </div>

        {/* Template heading */}
        <div style={{ marginBottom: "1.25rem", textAlign: "center", width: "100%", maxWidth: 780 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "1.5rem" }}>
            <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--neutral-300)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Pick a template
            </span>
            <span style={{ fontSize: "0.78rem", color: "var(--neutral-500)" }}>
              or describe your own below
            </span>
          </div>
        </div>

        {/* Template grid */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "1rem",
          width: "100%",
          maxWidth: 780,
          marginBottom: "2.5rem",
        }}>
          {STARTER_TEMPLATES.map(t => (
            <TemplateCard
              key={t.id}
              template={t}
              onDeploy={(tmpl) => setTemplateReview(tmpl)}
              deploying={false}
            />
          ))}
        </div>

        {/* Custom worker input */}
        <div style={{ width: "100%", maxWidth: 680, textAlign: "center" }}>
          <div style={{ fontSize: "0.82rem", color: "var(--neutral-500)", marginBottom: "0.75rem" }}>
            Or tell me what you need:
          </div>
          <BuilderInputBox
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onSend={handleSend}
            disabled={false}
            model={selectedModel}
            onModelChange={setSelectedModel}
            placeholder="Describe what you need..."
          />
        </div>
        <div style={{ flex: 1.5 }} />
      </div>
    );
  }

  // Greeting screen for returning users (no messages, not first time -- just the builder chat)
  if (!hasMessages) {
    const greeting = getGreeting();
    const displayName = userName ? userName.split("@")[0] : null;
    return (
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        minHeight: "calc(100vh - 1px)",
        padding: "2rem",
      }}>
        <div style={{ flex: 1 }} />
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <h1 style={{
            fontSize: "clamp(1.5rem, 4vw, 2.2rem)",
            fontWeight: 700,
            color: "var(--neutral-50)",
            lineHeight: 1.2,
            marginBottom: "0.25rem",
          }}>
            {displayName ? `${greeting}, ${displayName}.` : "What do you need done?"}
          </h1>
          {displayName && (
            <p style={{ fontSize: "1rem", color: "var(--neutral-500)", marginTop: "0.5rem" }}>
              What do you need done?
            </p>
          )}
        </div>
        <BuilderInputBox
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onSend={handleSend}
          disabled={false}
          model={selectedModel}
          onModelChange={setSelectedModel}
          placeholder="Describe what you need..."
        />
        <div style={{ flex: 1.5 }} />
      </div>
    );
  }

  // Conversation view
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100vh",
    }}>
      {/* Messages area */}
      <div style={{
        flex: 1,
        overflowY: "auto",
        padding: "2rem 0",
        display: "flex",
        flexDirection: "column",
      }}>
        <div style={{
          maxWidth: 680,
          width: "100%",
          margin: "0 auto",
          padding: "0 1.5rem",
          display: "flex",
          flexDirection: "column",
          gap: "0.25rem",
        }}>
          {conv.messages.map((msg) => (
            <BuilderMessage
              key={msg.id}
              msg={msg}
              onAction={handleAction}
              selectedModel={selectedModel}
            />
          ))}
          {isDeploying && (
            <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: "0.5rem" }} className="lovable-fade">
              <div style={{ fontSize: "0.9rem", color: "var(--neutral-400)" }}>Deploying...</div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input area (fixed at bottom) */}
      {!isDeployed && (
        <div style={{
          flexShrink: 0,
          padding: "1rem 1.5rem 1.5rem",
          display: "flex",
          justifyContent: "center",
          background: "var(--neutral-950)",
        }}>
          <BuilderInputBox
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onSend={handleSend}
            disabled={isDeploying}
            model={selectedModel}
            onModelChange={setSelectedModel}
            placeholder="Type a message..."
          />
        </div>
      )}

      {/* Post-deploy actions */}
      {isDeployed && (
        <div style={{
          flexShrink: 0,
          padding: "1rem 1.5rem 1.5rem",
          display: "flex",
          justifyContent: "center",
          gap: "0.75rem",
          background: "var(--neutral-950)",
        }}>
          <button style={S.btnSecondary} onClick={reset}>
            Create another worker
          </button>
          <button style={{ ...S.btnPrimary, width: "auto" }} onClick={onComplete}>
            Go to dashboard
          </button>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   AppSidebar — persistent sidebar (Claude/ChatGPT style)
   ═══════════════════════════════════════════════════════════ */

function AppSidebar({ activeView, onNavigate, workers, pendingApprovals, userEmail, creditBalance, onNewWorker }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  const navBtn = (key, label, extra) => (
    <button style={{ ...S.navItem, ...(activeView === key ? S.navItemActive : {}) }} onClick={() => onNavigate(key)}>{label}{extra}</button>
  );

  return (
    <nav style={S.sidebar}>
      <div style={S.sidebarLogo}>nooterra</div>
      <div style={{ padding: "0 1rem 1rem" }}>
        <button onClick={onNewWorker} style={{ display: "block", width: "100%", padding: "0.6rem 1rem", fontSize: "0.85rem", fontWeight: 600, background: "var(--gold)", color: "var(--neutral-950)", border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", transition: "opacity 0.15s" }}>New worker</button>
      </div>
      {navBtn("workers", "Workers")}
      {navBtn("approvals", "Approvals", pendingApprovals > 0 && <span style={{ marginLeft: 8, fontSize: "0.72rem", fontWeight: 700, color: "var(--gold)", fontVariantNumeric: "tabular-nums" }}>{pendingApprovals}</span>)}
      {navBtn("receipts", "History")}
      {navBtn("settings", "Settings")}
      <div style={{ borderTop: "1px solid var(--neutral-800)", margin: "0.75rem 1.5rem" }} />
      {workers && workers.length > 0 ? (
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          <div style={{ ...S.navSection, paddingTop: "0.5rem" }}>Active Workers</div>
          {workers.map(w => (
            <button key={w.id} style={{ ...S.navItem, fontSize: "0.82rem", display: "flex", alignItems: "center", gap: "0.5rem" }} onClick={() => onNavigate("workerDetail", w.id)}>
              <span style={S.statusDot(STATUS_COLORS[w.status] || STATUS_COLORS.ready)} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.name}</span>
            </button>
          ))}
        </div>
      ) : <div style={{ flex: 1 }} />}
      <div style={{ borderTop: "1px solid var(--neutral-800)", margin: "0.5rem 1.5rem" }} />

      {/* User info + dropdown menu */}
      <div style={{ padding: "0.75rem 1.5rem", position: "relative" }} ref={menuRef}>
        {menuOpen && (() => {
          const mStyle = { display: "block", width: "100%", padding: "0.6rem 1rem", fontSize: "0.85rem", color: "var(--neutral-200)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left", textDecoration: "none" };
          const hover = (e) => { e.currentTarget.style.background = "var(--neutral-800)"; };
          const unhover = (e) => { e.currentTarget.style.background = "none"; };
          const sep = <div style={{ borderTop: "1px solid var(--neutral-700)", margin: "0.25rem 0" }} />;
          return (
            <div style={{ position: "absolute", bottom: "100%", left: "0.75rem", right: "0.75rem", background: "var(--neutral-900)", border: "1px solid var(--neutral-700)", borderRadius: 8, boxShadow: "0 -4px 16px rgba(0,0,0,0.3)", padding: "0.25rem 0", zIndex: 100, marginBottom: "0.25rem" }}>
              <button style={{ ...mStyle, display: "flex", justifyContent: "space-between", alignItems: "center" }} onMouseEnter={hover} onMouseLeave={unhover} onClick={() => { setMenuOpen(false); onNavigate("settings"); }}>
                <span>Settings</span><span style={{ fontSize: "0.75rem", color: "var(--neutral-500)" }}>&#8984;,</span>
              </button>
              <a href="https://docs.nooterra.ai" target="_blank" rel="noopener noreferrer" style={mStyle} onMouseEnter={hover} onMouseLeave={unhover} onClick={() => setMenuOpen(false)}>Get help</a>
              {sep}
              <a href="/pricing" style={mStyle} onMouseEnter={hover} onMouseLeave={unhover} onClick={(e) => { e.preventDefault(); setMenuOpen(false); navigate("/pricing"); }}>Upgrade to Pro</a>
              {sep}
              <button style={mStyle} onMouseEnter={hover} onMouseLeave={unhover} onClick={async () => { setMenuOpen(false); await logoutSession(); try { localStorage.removeItem(PRODUCT_RUNTIME_STORAGE_KEY); } catch { /* ignore */ } try { localStorage.removeItem(ONBOARDING_STORAGE_KEY); } catch { /* ignore */ } navigate("/login"); }}>Log out</button>
            </div>
          );
        })()}
        {userEmail && (
          <button style={{ display: "block", width: "100%", fontSize: "0.8rem", color: "var(--neutral-300)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left", padding: 0, marginBottom: "0.3rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} onClick={() => setMenuOpen(!menuOpen)}>{userEmail}</button>
        )}
        {creditBalance != null && (
          <div style={{ fontSize: "0.78rem", color: "var(--neutral-500)", fontVariantNumeric: "tabular-nums" }}>${(creditBalance / 100).toFixed(2)} credits</div>
        )}
      </div>
    </nav>
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
      try {
        const result = await workerApiRequest({ pathname: "/v1/workers", method: "GET" });
        setWorkers(result?.items || result || []);
      } catch {
        setWorkers([]);
      }
      setLoading(false);
    })();
  }, []);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "2rem" }}>
        <div>
          <h1 style={S.pageTitle}>Workers</h1>
          <p style={{ ...S.pageSub, marginBottom: 0 }}>
            {loading
              ? "Loading..."
              : workers.length === 0
                ? "No workers yet. Create one to get started."
                : `${workers.length} worker${workers.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <button style={{ ...S.btnPrimary, width: "auto" }} onClick={onCreate}>
          Create worker
        </button>
      </div>

      {!loading && workers.length === 0 && (
        <div
          style={{
            padding: "4rem 2rem",
            textAlign: "center",
            border: "1px dashed var(--neutral-700)",
            borderRadius: 12,
          }}
        >
          <div style={{ fontSize: "1.1rem", fontWeight: 600, color: "var(--neutral-300)", marginBottom: "0.5rem" }}>
            Your first worker is waiting
          </div>
          <div style={{ fontSize: "0.88rem", color: "var(--neutral-500)", marginBottom: "1.5rem", maxWidth: 360, margin: "0 auto 1.5rem" }}>
            Describe what you need done, set a schedule, review the charter, and deploy.
          </div>
          <button style={{ ...S.btnPrimary, width: "auto" }} onClick={onCreate}>
            Create worker
          </button>
        </div>
      )}

      {workers.length > 0 && (
        <div>
          <div
            style={{
              ...S.workerRow,
              cursor: "default",
              borderBottom: "1px solid var(--neutral-700)",
              padding: "0 0 0.5rem",
            }}
          >
            <div style={{ ...S.workerMeta, fontWeight: 600, color: "var(--neutral-300)" }}>Name</div>
            <div style={{ ...S.workerMeta, fontWeight: 600, color: "var(--neutral-300)" }}>Status</div>
            <div style={{ ...S.workerMeta, fontWeight: 600, color: "var(--neutral-300)" }}>Last run</div>
            <div style={{ ...S.workerMeta, fontWeight: 600, color: "var(--neutral-300)" }}>Schedule</div>
            <div style={{ ...S.workerMeta, fontWeight: 600, color: "var(--neutral-300)" }}>Cost</div>
          </div>
          {workers.map((w) => (
            <div
              key={w.id}
              style={S.workerRow}
              onClick={() => onSelect(w)}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--neutral-900)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <div style={S.workerName}>{w.name}</div>
              <div style={S.workerMeta}>
                <span style={S.statusDot(STATUS_COLORS[w.status] || STATUS_COLORS.ready)} />
                {w.status}
              </div>
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
      try {
        const result = await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}`, method: "GET" });
        setWorker(result);
      } catch {
        setWorker(null);
      }
      setLoading(false);
    })();
  }, [workerId]);

  useEffect(() => {
    if (tab === "activity" && workerId) {
      setLogsLoading(true);
      (async () => {
        try {
          const result = await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}/logs`, method: "GET" });
          setLogs(result?.items || result || []);
        } catch {
          setLogs([]);
        }
        setLogsLoading(false);
      })();
    }
  }, [tab, workerId]);

  // Auto-poll for new deploy to catch first execution
  useEffect(() => {
    if (!isNewDeploy || !workerId) return;
    const interval = setInterval(async () => {
      try {
        const result = await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}`, method: "GET" });
        setWorker(result);
        if (tab === "activity") {
          const logResult = await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}/logs`, method: "GET" });
          setLogs(logResult?.items || logResult || []);
        }
      } catch { /* ignore */ }
    }, 5000);
    return () => clearInterval(interval);
  }, [isNewDeploy, workerId, tab]);

  async function handleRunNow() {
    setRunningAction(true);
    setError("");
    try {
      await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}/run`, method: "POST" });
      const result = await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}`, method: "GET" });
      setWorker(result);
    } catch (err) {
      setError(err?.message || "Failed to run worker.");
    }
    setRunningAction(false);
  }

  async function handlePauseResume() {
    if (!worker) return;
    setRunningAction(true);
    setError("");
    const newStatus = worker.status === "paused" ? "ready" : "paused";
    try {
      await workerApiRequest({
        pathname: `/v1/workers/${encodeURIComponent(workerId)}`,
        method: "PUT",
        body: { status: newStatus },
      });
      setWorker((prev) => prev ? { ...prev, status: newStatus } : prev);
    } catch (err) {
      setError(err?.message || "Failed to update worker.");
    }
    setRunningAction(false);
  }

  if (loading) {
    return (
      <div>
        <button style={S.backLink} onClick={onBack}>← All workers</button>
        <div style={{ fontSize: "0.88rem", color: "var(--neutral-500)" }}>Loading...</div>
      </div>
    );
  }

  if (!worker) {
    return (
      <div>
        <button style={S.backLink} onClick={onBack}>← All workers</button>
        <div style={{ fontSize: "0.88rem", color: "var(--neutral-500)" }}>Worker not found.</div>
      </div>
    );
  }

  const charter = typeof worker.charter === "string" ? (() => { try { return JSON.parse(worker.charter); } catch { return null; } })() : worker.charter;

  const tabs = [
    { key: "charter", label: "Charter" },
    { key: "activity", label: "Activity" },
    { key: "settings", label: "Settings" },
  ];

  return (
    <div>
      <button style={S.backLink} onClick={onBack}>
        ← All workers
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "0.3rem" }}>
        <h1 style={{ ...S.pageTitle, marginBottom: 0 }}>{worker.name}</h1>
        <span style={S.statusDot(STATUS_COLORS[worker.status] || STATUS_COLORS.ready)} />
        <span style={{ fontSize: "0.82rem", color: "var(--neutral-400)" }}>{worker.status}</span>
      </div>
      <p style={S.pageSub}>{worker.description || "No description"}</p>

      {error && <div style={S.error}>{error}</div>}

      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "2rem" }}>
        <button
          style={{ ...S.btnPrimary, width: "auto", opacity: runningAction ? 0.5 : 1 }}
          disabled={runningAction}
          onClick={handleRunNow}
        >
          {runningAction ? "Running..." : "Run now"}
        </button>
        <button
          style={S.btnSecondary}
          disabled={runningAction}
          onClick={handlePauseResume}
        >
          {worker.status === "paused" ? "Resume" : "Pause"}
        </button>
      </div>

      {worker.cost != null && (
        <div style={{ fontSize: "0.85rem", color: "var(--neutral-400)", marginBottom: "2rem" }}>
          Cost this period: <span style={{ color: "var(--neutral-200)", fontVariantNumeric: "tabular-nums" }}>${(typeof worker.cost === "number" ? worker.cost : 0).toFixed(2)}</span>
        </div>
      )}

      <div style={{ display: "flex", gap: "0.25rem", borderBottom: "1px solid var(--neutral-800)", marginBottom: "2rem" }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: "0.6rem 1rem",
              fontSize: "0.85rem",
              fontWeight: 600,
              color: tab === t.key ? "var(--neutral-50)" : "var(--neutral-400)",
              background: "none",
              border: "none",
              borderBottom: tab === t.key ? "2px solid var(--gold)" : "2px solid transparent",
              cursor: "pointer",
              fontFamily: "inherit",
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "charter" && (
        <CharterDisplay charter={charter} />
      )}

      {tab === "activity" && (
        <div>
          {isNewDeploy && logs.length === 0 && !logsLoading && (
            <div style={{
              padding: "2rem",
              textAlign: "center",
              border: "1px dashed var(--neutral-700)",
              borderRadius: 12,
            }}>
              <div style={{
                fontSize: "0.95rem",
                fontWeight: 600,
                color: "var(--neutral-300)",
                marginBottom: "0.5rem",
              }}>
                Your worker is queued and will run shortly.
              </div>
              <div style={{
                width: 24,
                height: 24,
                border: "2px solid var(--neutral-700)",
                borderTop: "2px solid var(--gold)",
                borderRadius: "50%",
                animation: "spin 1s linear infinite",
                margin: "1rem auto 0",
              }} />
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          )}
          {logsLoading ? (
            <div style={{ fontSize: "0.88rem", color: "var(--neutral-500)" }}>Loading logs...</div>
          ) : logs.length === 0 && !isNewDeploy ? (
            <div style={{ fontSize: "0.88rem", color: "var(--neutral-500)" }}>
              No activity yet. This worker hasn't run.
            </div>
          ) : (
            logs.map((entry, i) => (
              <ActivityLogEntry key={entry.id || i} entry={entry} />
            ))
          )}
        </div>
      )}

      {tab === "settings" && (
        <div style={{ maxWidth: 480 }}>
          <label style={S.label}>Schedule</label>
          <div style={{ fontSize: "0.88rem", color: "var(--neutral-200)", marginBottom: "1rem" }}>
            {worker.schedule || "Manual (on-demand)"}
          </div>
          {worker.model && (
            <>
              <label style={S.label}>Model</label>
              <div style={{ fontSize: "0.88rem", color: "var(--neutral-200)", marginBottom: "2rem" }}>
                {RECOMMENDED_MODELS.find((m) => m.id === worker.model)?.name || worker.model}
              </div>
            </>
          )}
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
      {entry.detail && (
        <>
          <button
            style={{ ...S.btnGhost, marginTop: "0.4rem", fontSize: "0.78rem" }}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "Hide details" : "Show details"}
          </button>
          {expanded && <div style={S.logDetail}>{entry.detail}</div>}
        </>
      )}
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

  useEffect(() => {
    loadApprovals();
  }, []);

  async function loadApprovals() {
    setLoading(true);
    try {
      const runtime = loadRuntimeConfig();
      const [pending, decided] = await Promise.all([
        fetchApprovalInbox(runtime, { status: "pending" }),
        fetchApprovalInbox(runtime, { status: "decided" }),
      ]);
      setItems(pending?.items || pending || []);
      setHistory(decided?.items || decided || []);
    } catch {
      setItems([]);
      setHistory([]);
    }
    setLoading(false);
  }

  async function handleDecide(requestId, approved) {
    setDeciding(requestId);
    try {
      const runtime = loadRuntimeConfig();
      await decideApprovalInboxItem(runtime, requestId, { approved });
      await loadApprovals();
    } catch { /* ignore */ }
    setDeciding(null);
  }

  return (
    <div>
      <h1 style={S.pageTitle}>Approvals</h1>
      <p style={S.pageSub}>
        Workers ask before taking sensitive actions. Review and decide here.
      </p>

      {loading ? (
        <div style={{ fontSize: "0.88rem", color: "var(--neutral-500)" }}>Loading...</div>
      ) : (
        <>
          {items.length === 0 ? (
            <div style={{
              padding: "3rem 2rem",
              textAlign: "center",
              border: "1px dashed var(--neutral-700)",
              borderRadius: 12,
              marginBottom: "3rem",
            }}>
              <div style={{ fontSize: "1rem", fontWeight: 600, color: "var(--neutral-300)", marginBottom: "0.3rem" }}>
                Nothing pending
              </div>
              <div style={{ fontSize: "0.85rem", color: "var(--neutral-500)" }}>
                When a worker needs your approval, it will appear here.
              </div>
            </div>
          ) : (
            <div style={{ marginBottom: "3rem" }}>
              {items.map((item) => (
                <div key={item.requestId || item.id} style={S.approvalRow}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--neutral-100)", marginBottom: "0.25rem" }}>
                        {item.workerName || item.agentName || "Worker"}
                      </div>
                      <div style={{ fontSize: "0.85rem", color: "var(--neutral-300)", marginBottom: "0.25rem" }}>
                        {item.action || item.summary || item.description || "Action requires approval"}
                      </div>
                      {item.detail && (
                        <div style={{ fontSize: "0.82rem", color: "var(--neutral-500)", lineHeight: 1.5 }}>
                          {item.detail}
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--neutral-500)", flexShrink: 0, marginLeft: "1rem" }}>
                      {item.createdAt ? timeAgo(item.createdAt) : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
                    <button
                      style={{ ...S.btnPrimary, width: "auto", padding: "0.5rem 1.25rem", fontSize: "0.82rem" }}
                      disabled={deciding === (item.requestId || item.id)}
                      onClick={() => handleDecide(item.requestId || item.id, true)}
                    >
                      Approve
                    </button>
                    <button
                      style={{ ...S.btnSecondary, padding: "0.5rem 1.25rem", fontSize: "0.82rem" }}
                      disabled={deciding === (item.requestId || item.id)}
                      onClick={() => handleDecide(item.requestId || item.id, false)}
                    >
                      Deny
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {history.length > 0 && (
            <>
              <div style={{ ...S.label, marginBottom: "1rem" }}>Recent decisions</div>
              {history.slice(0, 20).map((item) => (
                <div key={item.requestId || item.id} style={{ ...S.approvalRow, opacity: 0.7 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <div>
                      <span style={{ fontSize: "0.85rem", color: "var(--neutral-300)" }}>
                        {item.workerName || item.agentName || "Worker"}
                      </span>
                      <span style={{ fontSize: "0.82rem", color: "var(--neutral-500)", marginLeft: "0.75rem" }}>
                        {item.action || item.summary || "Action"}
                      </span>
                    </div>
                    <span
                      style={{
                        fontSize: "0.78rem",
                        fontWeight: 600,
                        color: item.approved || item.decision === "approved" ? "#5bb98c" : "#c97055",
                      }}
                    >
                      {item.approved || item.decision === "approved" ? "Approved" : "Denied"}
                    </span>
                  </div>
                </div>
              ))}
            </>
          )}
        </>
      )}
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
      try {
        const runtime = loadRuntimeConfig();
        const result = await fetchWorkOrderReceipts(runtime, { limit: 50 });
        setReceipts(result?.items || result || []);
      } catch {
        setReceipts([]);
      }
      setLoading(false);
    })();
  }, []);

  return (
    <div>
      <h1 style={S.pageTitle}>History</h1>
      <p style={S.pageSub}>Execution log across all workers.</p>

      {loading ? (
        <div style={{ fontSize: "0.88rem", color: "var(--neutral-500)" }}>Loading...</div>
      ) : receipts.length === 0 ? (
        <div style={{ fontSize: "0.88rem", color: "var(--neutral-500)" }}>No executions yet.</div>
      ) : (
        receipts.map((r) => (
          <div key={r.id || r.receiptId} style={S.logEntry}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: "0.88rem", color: "var(--neutral-200)" }}>
                  {r.workerName || r.agentName || r.summary || r.id || "Execution"}
                </div>
                <div style={S.logTime}>
                  {r.completedAt ? formatDateTime(r.completedAt) : r.createdAt ? formatDateTime(r.createdAt) : ""}
                </div>
              </div>
              {r.cost != null && (
                <div style={{ ...S.workerMeta, color: "var(--neutral-300)" }}>
                  {typeof r.cost === "number" ? `$${r.cost.toFixed(2)}` : formatCurrency(r.cost)}
                </div>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   SETTINGS VIEW
   ═══════════════════════════════════════════════════════════ */

function ToggleSwitch({ on, onToggle }) {
  return (
    <button onClick={onToggle} style={{ width: 44, height: 24, borderRadius: 12, border: "none", cursor: "pointer", background: on ? "var(--gold)" : "var(--neutral-700)", position: "relative", flexShrink: 0, transition: "background 0.15s" }}>
      <div style={{ width: 18, height: 18, borderRadius: "50%", background: "white", position: "absolute", top: 3, left: on ? 23 : 3, transition: "left 0.15s" }} />
    </button>
  );
}

function ThemePreview({ opt, selected, onClick }) {
  const base = { padding: "0.75rem", borderRadius: 10, border: selected ? "2px solid var(--gold)" : "2px solid var(--neutral-700)", background: selected ? "var(--gold-dim)" : "transparent", cursor: "pointer", textAlign: "center", fontFamily: "inherit", transition: "border-color 0.15s", flex: 1 };
  return (
    <button onClick={onClick} style={base}>
      {opt.key === "auto" ? (
        <div style={{ width: 80, height: 50, borderRadius: 6, margin: "0 auto 0.5rem", display: "flex", overflow: "hidden" }}>
          <div style={{ flex: 1, background: opt.bgLeft, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 4 }}>
            <div style={{ width: "70%", height: 8, borderRadius: 2, background: opt.fgLeft }} />
          </div>
          <div style={{ flex: 1, background: opt.bgRight, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 4 }}>
            <div style={{ width: "70%", height: 8, borderRadius: 2, background: opt.fgRight }} />
          </div>
        </div>
      ) : (
        <div style={{ width: 80, height: 50, borderRadius: 6, margin: "0 auto 0.5rem", background: opt.bg, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 6 }}>
          <div style={{ width: "80%", height: 8, borderRadius: 2, background: opt.fg }} />
        </div>
      )}
      <div style={{ fontSize: "0.82rem", fontWeight: 600, color: selected ? "var(--neutral-100)" : "var(--neutral-400)" }}>{opt.label}</div>
    </button>
  );
}

function SettingsView({ userEmail }) {
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
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

  async function handleSave() {
    setSaving(true); setSaved(false);
    try { await updateTenantSettings(runtime, { displayName: displayName.trim(), defaultModel }); setSaved(true); setTimeout(() => setSaved(false), 2000); } catch { /* ignore */ }
    setSaving(false);
  }

  function handleThemeChange(t) { setTheme(t); saveTheme(t); }

  const tabs = [{ key: "account", label: "Account" }, { key: "appearance", label: "Appearance" }, { key: "model", label: "Default Model" }, { key: "notifications", label: "Notifications" }, { key: "danger", label: "Danger Zone" }];
  const themes = [
    { key: "light", label: "Light", bg: "#f5f3ef", fg: "#d4cfc7" },
    { key: "auto", label: "Auto", bgLeft: "#f5f3ef", bgRight: "#0d0c0a", fgLeft: "#d4cfc7", fgRight: "#1f1d1a" },
    { key: "dark", label: "Dark", bg: "#0d0c0a", fg: "#1f1d1a" },
  ];
  const saveBtn = (label = "Save") => (<button style={{ ...S.btnPrimary, width: "auto", opacity: saving ? 0.6 : 1 }} disabled={saving} onClick={handleSave}>{saving ? "Saving..." : saved ? "Saved" : label}</button>);

  if (loading) return (<div><h1 style={S.pageTitle}>Settings</h1><p style={S.pageSub}>Loading...</p></div>);

  return (
    <div>
      <h1 style={S.pageTitle}>Settings</h1>
      <p style={S.pageSub}>Manage your account and preferences.</p>
      <div style={{ maxWidth: 560 }}>
        <div style={{ display: "flex", gap: "0.25rem", borderBottom: "1px solid var(--neutral-800)", marginBottom: "2rem", flexWrap: "wrap" }}>
          {tabs.map((s) => (
            <button key={s.key} onClick={() => setTab(s.key)} style={{ padding: "0.6rem 1rem", fontSize: "0.85rem", fontWeight: 600, color: tab === s.key ? "var(--neutral-50)" : "var(--neutral-400)", background: "none", border: "none", borderBottom: tab === s.key ? "2px solid var(--gold)" : "2px solid transparent", cursor: "pointer", fontFamily: "inherit", marginBottom: -1 }}>{s.label}</button>
          ))}
        </div>

        {tab === "account" && (<div>
          <label style={S.label}>Display name</label>
          <FocusInput type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" />
          <div style={{ marginBottom: "2rem" }}>{saveBtn()}</div>
          <div style={{ borderTop: "1px solid var(--neutral-800)", margin: "2rem 0" }} />
          <label style={S.label}>Email</label>
          <div style={{ fontSize: "0.88rem", color: "var(--neutral-300)", marginBottom: "1.5rem" }}>{userEmail || "Not available"}</div>
          <label style={S.label}>Account ID</label>
          <div style={{ fontSize: "0.78rem", color: "var(--neutral-500)", fontVariantNumeric: "tabular-nums", fontFamily: "monospace" }}>{runtime.tenantId}</div>
        </div>)}

        {tab === "appearance" && (<div>
          <label style={S.label}>Color mode</label>
          <p style={{ fontSize: "0.85rem", color: "var(--neutral-400)", marginBottom: "1rem", marginTop: 0 }}>Choose how nooterra looks for you.</p>
          <div style={{ display: "flex", gap: "1rem" }}>
            {themes.map((opt) => <ThemePreview key={opt.key} opt={opt} selected={theme === opt.key} onClick={() => handleThemeChange(opt.key)} />)}
          </div>
        </div>)}

        {tab === "model" && (<div>
          <label style={S.label}>Default model</label>
          <p style={{ fontSize: "0.85rem", color: "var(--neutral-400)", marginBottom: "1rem", marginTop: 0 }}>This model will be used for new workers by default. You can change it per worker.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            {RECOMMENDED_MODELS.map((m) => (
              <div key={m.id} onClick={() => setDefaultModel(m.id)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.7rem 1rem", borderRadius: 8, cursor: "pointer", border: m.id === defaultModel ? "1px solid var(--gold)" : "1px solid var(--neutral-700)", background: m.id === defaultModel ? "rgba(210,176,111,0.08)" : "transparent", transition: "all 0.15s" }}>
                <div><span style={{ fontSize: "0.88rem", fontWeight: 600, color: m.id === defaultModel ? "var(--neutral-100)" : "var(--neutral-300)" }}>{m.name}</span><span style={{ fontSize: "0.75rem", color: "var(--neutral-500)", marginLeft: 8 }}>{m.tag}</span></div>
                <span style={{ fontSize: "0.75rem", color: "var(--neutral-500)", fontVariantNumeric: "tabular-nums" }}>${m.inputPer1M.toFixed(2)} / ${m.outputPer1M.toFixed(2)} per 1M</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: "1.5rem" }}>{saveBtn("Save default model")}</div>
        </div>)}

        {tab === "notifications" && (<div>
          <label style={S.label}>Notifications</label>
          <p style={{ fontSize: "0.85rem", color: "var(--neutral-400)", marginBottom: "1.5rem", marginTop: 0 }}>Control how you get notified about worker activity.</p>
          {[{ label: "Email me when a worker needs approval", desc: "Get notified when a worker is waiting for your decision.", on: notifApproval, toggle: () => setNotifApproval(!notifApproval) },
            { label: "Weekly worker report", desc: "Receive a weekly summary of all worker activity.", on: notifWeekly, toggle: () => setNotifWeekly(!notifWeekly) }].map((n, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem 0", borderBottom: "1px solid var(--neutral-800)" }}>
              <div><div style={{ fontSize: "0.88rem", color: "var(--neutral-200)", fontWeight: 500 }}>{n.label}</div><div style={{ fontSize: "0.78rem", color: "var(--neutral-500)", marginTop: "0.15rem" }}>{n.desc}</div></div>
              <ToggleSwitch on={n.on} onToggle={n.toggle} />
            </div>
          ))}
        </div>)}

        {tab === "danger" && (<div>
          <label style={{ ...S.label, color: "#c97055" }}>Danger Zone</label>
          <p style={{ fontSize: "0.85rem", color: "var(--neutral-400)", marginBottom: "1.5rem", marginTop: 0 }}>Irreversible actions. Please be certain.</p>
          {!showDeleteConfirm ? (
            <button style={{ ...S.btnSecondary, borderColor: "#c97055", color: "#c97055" }} onClick={() => setShowDeleteConfirm(true)}>Delete account</button>
          ) : (
            <div style={{ padding: "1.25rem", border: "1px solid #c97055", borderRadius: 10, background: "rgba(201,112,85,0.06)" }}>
              <div style={{ fontSize: "0.9rem", fontWeight: 600, color: "#c97055", marginBottom: "0.5rem" }}>Are you sure?</div>
              <div style={{ fontSize: "0.85rem", color: "var(--neutral-400)", marginBottom: "1rem", lineHeight: 1.5 }}>This will permanently delete your account and all workers. This action cannot be undone.</div>
              <div style={{ display: "flex", gap: "0.75rem" }}>
                <button style={{ ...S.btnPrimary, width: "auto", background: "#c97055" }} onClick={async () => { await logoutSession(); try { localStorage.removeItem(PRODUCT_RUNTIME_STORAGE_KEY); } catch { /* ignore */ } try { localStorage.removeItem(ONBOARDING_STORAGE_KEY); } catch { /* ignore */ } navigate("/login"); }}>Yes, delete my account</button>
                <button style={S.btnSecondary} onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>)}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   PRICING VIEW
   ═══════════════════════════════════════════════════════════ */

function PricingView() {
  const tiers = [
    {
      name: "Free",
      price: "Free forever",
      features: [
        "Local CLI workers",
        "Any AI provider (bring your own key)",
        "Unlimited workers and runs",
        "Charter-based governance",
        "Full activity logs",
      ],
      cta: "Install CLI",
      ctaHref: "https://docs.nooterra.ai",
      primary: false,
    },
    {
      name: "Pro",
      price: "$29 / month",
      features: [
        "Everything in Free",
        "Cloud-hosted workers",
        "Web dashboard",
        "Slack approval integration",
        "Email notifications",
        "Priority support",
      ],
      cta: "Start free trial",
      ctaAction: () => navigate("/signup"),
      primary: true,
    },
    {
      name: "Team",
      price: "$99 / month",
      features: [
        "Everything in Pro",
        "Shared team dashboard",
        "SSO / SAML",
        "Audit log export",
        "Custom worker templates",
        "Dedicated support",
      ],
      cta: "Contact us",
      ctaHref: "mailto:team@nooterra.ai",
      primary: false,
    },
  ];

  return (
    <div style={S.pricingWrap} className="lovable-fade">
      <h1 style={S.pricingTitle}>Simple, honest pricing</h1>
      <p style={{ fontSize: "1.05rem", color: "var(--neutral-400)", marginBottom: "3rem", maxWidth: 520, lineHeight: 1.6 }}>
        Start free with local workers. Upgrade when you want cloud hosting and team features.
      </p>

      {tiers.map((tier, i) => (
        <div key={tier.name} style={{ ...S.tier, borderBottom: i < tiers.length - 1 ? S.tier.borderBottom : "none" }}>
          <div>
            <div style={S.tierName}>{tier.name}</div>
            <div style={S.tierPrice}>{tier.price}</div>
            {tier.features.map((f, j) => (
              <div key={j} style={S.tierFeature}>{f}</div>
            ))}
          </div>
          <div style={{ paddingTop: "0.5rem" }}>
            {tier.ctaHref ? (
              <a
                href={tier.ctaHref}
                target={tier.ctaHref.startsWith("http") ? "_blank" : undefined}
                rel={tier.ctaHref.startsWith("http") ? "noopener noreferrer" : undefined}
                style={{
                  ...(tier.primary ? S.btnPrimary : S.btnSecondary),
                  textDecoration: "none",
                  display: "inline-flex",
                  width: "auto",
                }}
              >
                {tier.cta}
              </a>
            ) : (
              <button
                style={{ ...(tier.primary ? S.btnPrimary : S.btnSecondary), width: "auto" }}
                onClick={tier.ctaAction}
              >
                {tier.cta}
              </button>
            )}
          </div>
        </div>
      ))}

      <div style={{ marginTop: "3rem" }}>
        <a href="/" style={S.link} onClick={(e) => { e.preventDefault(); navigate("/"); }}>
          ← Back to home
        </a>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   APP SHELL — unified layout with persistent sidebar
   ═══════════════════════════════════════════════════════════ */

function AppShell({ initialView = "workers", userEmail, isFirstTime }) {
  const [view, setView] = useState(initialView);
  const [selectedWorkerId, setSelectedWorkerId] = useState(null);
  const [isNewDeploy, setIsNewDeploy] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [workers, setWorkers] = useState([]);
  const [creditBalance, setCreditBalance] = useState(null);

  // Load sidebar data
  useEffect(() => {
    (async () => {
      try {
        const runtime = loadRuntimeConfig();
        const result = await fetchApprovalInbox(runtime, { status: "pending" });
        const items = result?.items || result || [];
        setPendingApprovals(Array.isArray(items) ? items.length : 0);
      } catch { /* ignore */ }
    })();

    (async () => {
      try {
        const result = await workerApiRequest({ pathname: "/v1/workers", method: "GET" });
        setWorkers(result?.items || result || []);
      } catch { /* ignore */ }
    })();

    (async () => {
      try {
        const result = await workerApiRequest({ pathname: "/v1/credits", method: "GET" });
        if (result?.balance != null) setCreditBalance(result.balance);
        else if (result?.remaining != null) setCreditBalance(result.remaining);
      } catch { /* ignore */ }
    })();
  }, []);

  function handleNavigate(dest, workerId) {
    if (dest === "workerDetail" && workerId) {
      setSelectedWorkerId(workerId);
      setIsNewDeploy(false);
      setView("workerDetail");
    } else {
      setView(dest);
      setSelectedWorkerId(null);
      setIsNewDeploy(false);
    }
  }

  function handleSelectWorker(worker) {
    setSelectedWorkerId(worker.id);
    setIsNewDeploy(false);
    setView("workerDetail");
  }

  function handleNewWorker() {
    setView("builder");
    setSelectedWorkerId(null);
    setIsNewDeploy(false);
  }

  function handleBuilderComplete() {
    // Reload workers list
    (async () => {
      try {
        const result = await workerApiRequest({ pathname: "/v1/workers", method: "GET" });
        setWorkers(result?.items || result || []);
      } catch { /* ignore */ }
    })();
    setView("workers");
  }

  function handleViewWorker(w) {
    // Reload workers list
    (async () => {
      try {
        const result = await workerApiRequest({ pathname: "/v1/workers", method: "GET" });
        setWorkers(result?.items || result || []);
      } catch { /* ignore */ }
    })();
    if (w?.id) {
      setSelectedWorkerId(w.id);
      setIsNewDeploy(true);
      setView("workerDetail");
    } else {
      setView("workers");
    }
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
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        {view === "builder" && (
          <BuilderView
            onComplete={handleBuilderComplete}
            onViewWorker={handleViewWorker}
            userName={userEmail}
            isFirstTime={isFirstTime && workers.length === 0}
          />
        )}
        {view === "workers" && (
          <div style={S.main}>
            <WorkersListView
              onSelect={handleSelectWorker}
              onCreate={handleNewWorker}
            />
          </div>
        )}
        {view === "workerDetail" && selectedWorkerId && (
          <div style={S.main}>
            <WorkerDetailView
              workerId={selectedWorkerId}
              onBack={() => { setSelectedWorkerId(null); setIsNewDeploy(false); setView("workers"); }}
              isNewDeploy={isNewDeploy}
            />
          </div>
        )}
        {view === "approvals" && (
          <div style={S.main}>
            <ApprovalsView />
          </div>
        )}
        {view === "receipts" && (
          <div style={S.main}>
            <ReceiptsView />
          </div>
        )}
        {view === "settings" && (
          <div style={S.main}>
            <SettingsView userEmail={userEmail} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   PRODUCT SHELL — top-level mode router with session check
   ═══════════════════════════════════════════════════════════ */

export default function ProductShell({ mode, launchId, agentId, runId, requestedPath }) {
  const [currentMode, setCurrentMode] = useState(null); // null = checking session
  const [sessionChecked, setSessionChecked] = useState(false);
  const [userEmail, setUserEmail] = useState(null);
  const [isFirstTime, setIsFirstTime] = useState(false);

  // Apply theme on mount
  useEffect(() => {
    applyTheme(loadTheme());
  }, []);

  // On mount, check for an existing session
  useEffect(() => {
    let cancelled = false;

    async function checkSession() {
      // If the mode is explicitly an auth page, skip session check
      if (mode === "signup" || mode === "pricing") {
        setCurrentMode(mode);
        setSessionChecked(true);
        return;
      }

      try {
        const principal = await fetchSessionPrincipal();
        if (!cancelled && principal && principal.email) {
          setUserEmail(principal.email);
          const runtime = loadRuntimeConfig();
          if (principal.tenantId) {
            saveRuntime({ ...runtime, tenantId: principal.tenantId });
          }
          saveOnboardingState({
            ...loadOnboardingState(),
            buyer: principal,
            sessionExpected: true,
            completed: true,
          });

          // Check if user has any workers to determine first-time status
          try {
            const workersResult = await workerApiRequest({ pathname: "/v1/workers", method: "GET" });
            const workersList = workersResult?.items || workersResult || [];
            if (workersList.length === 0) {
              setIsFirstTime(true);
            }
          } catch { /* ignore */ }

          // Authenticated user — map mode to view
          if (mode === "login" || mode === "signup") {
            setCurrentMode("dashboard");
          } else {
            setCurrentMode(mode || "dashboard");
          }
          setSessionChecked(true);
          return;
        }
      } catch {
        // No valid session
      }

      if (!cancelled) {
        if (mode === "login" || mode === "signup" || mode === "pricing") {
          setCurrentMode(mode);
        } else {
          setCurrentMode("login");
        }
        setSessionChecked(true);
      }
    }

    checkSession();
    return () => { cancelled = true; };
  }, [mode]);

  // Update mode when prop changes (after initial session check)
  useEffect(() => {
    if (sessionChecked) {
      const onboardState = loadOnboardingState();
      if (onboardState?.sessionExpected) {
        setCurrentMode(mode);
      } else if (mode === "signup" || mode === "login" || mode === "pricing") {
        setCurrentMode(mode);
      }
    }
  }, [mode, sessionChecked]);

  function handleAuth(dest) {
    if (dest === "builder") {
      // Signup flow: first-time user, show templates
      const onboardState = loadOnboardingState();
      setUserEmail(onboardState?.buyer?.email || null);
      setIsFirstTime(true);
      setCurrentMode("dashboard");
      navigate("/wallet");
    } else {
      // Login flow: returning user, go to workers list
      const onboardState = loadOnboardingState();
      setUserEmail(onboardState?.buyer?.email || null);
      setIsFirstTime(false);
      setCurrentMode("dashboard");
      navigate("/wallet");
    }
  }

  // Show loading state while checking session
  if (!sessionChecked) {
    return (
      <div style={S.shell}>
        <div style={S.authWrap}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--neutral-50)", marginBottom: "0.5rem" }}>
              nooterra
            </div>
            <div style={{ fontSize: "0.88rem", color: "var(--neutral-500)" }}>
              Loading...
            </div>
          </div>
        </div>
      </div>
    );
  }

  const resolvedMode = currentMode;

  // Determine the initial view for AppShell based on mode and first-time status
  function getInitialView() {
    // First-time users (from signup or no workers) get the builder with templates
    if (isFirstTime) return "builder";
    switch (resolvedMode) {
      case "approvals": return "approvals";
      case "receipts": return "receipts";
      case "workspace": return "settings";
      default: return "workers"; // Returning users see workers list
    }
  }

  return (
    <div style={S.shell}>
      {resolvedMode === "signup" && (
        <SignUpView onAuth={handleAuth} />
      )}

      {resolvedMode === "login" && (
        <SignInView onAuth={handleAuth} />
      )}

      {resolvedMode === "pricing" && (
        <PricingView />
      )}

      {/* All authenticated views use the unified AppShell */}
      {!["signup", "login", "pricing"].includes(resolvedMode) && resolvedMode != null && (
        <AppShell initialView={getInitialView()} userEmail={userEmail} isFirstTime={isFirstTime} />
      )}
    </div>
  );
}
