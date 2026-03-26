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

function navigate(path) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
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

/* ═══════════════════════════════════════════════════════════
   Shared styles (inline, keeps single-file constraint)
   ═══════════════════════════════════════════════════════════ */

const S = {
  shell: {
    minHeight: "100vh",
    background: "var(--neutral-950)",
    color: "var(--neutral-200)",
    fontFamily: "var(--font-body)",
    WebkitFontSmoothing: "antialiased",
  },
  /* Auth screens */
  authWrap: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "2rem",
  },
  authBox: {
    width: "100%",
    maxWidth: 400,
  },
  authTitle: {
    fontSize: "clamp(1.6rem, 4vw, 2rem)",
    fontWeight: 700,
    color: "var(--neutral-50)",
    marginBottom: "0.5rem",
    lineHeight: 1.15,
  },
  authSub: {
    fontSize: "0.95rem",
    color: "var(--neutral-400)",
    marginBottom: "2.5rem",
    lineHeight: 1.5,
  },
  label: {
    display: "block",
    fontSize: "0.8rem",
    fontWeight: 600,
    color: "var(--neutral-300)",
    marginBottom: "0.4rem",
    letterSpacing: "0.03em",
    textTransform: "uppercase",
  },
  input: {
    display: "block",
    width: "100%",
    padding: "0.75rem 1rem",
    fontSize: "0.95rem",
    background: "var(--neutral-900)",
    border: "1px solid var(--neutral-700)",
    borderRadius: 8,
    color: "var(--neutral-100)",
    outline: "none",
    marginBottom: "1.25rem",
    fontFamily: "inherit",
    transition: "border-color 0.15s",
  },
  inputFocus: {
    borderColor: "var(--gold)",
  },
  btnPrimary: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0.75rem 1.75rem",
    fontSize: "0.9rem",
    fontWeight: 600,
    background: "var(--gold)",
    color: "var(--neutral-950)",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    letterSpacing: "0.01em",
    transition: "background 0.15s, opacity 0.15s",
    width: "100%",
    fontFamily: "inherit",
  },
  btnSecondary: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0.6rem 1.25rem",
    fontSize: "0.85rem",
    fontWeight: 600,
    background: "transparent",
    color: "var(--neutral-200)",
    border: "1px solid var(--neutral-700)",
    borderRadius: 8,
    cursor: "pointer",
    transition: "border-color 0.15s",
    fontFamily: "inherit",
  },
  btnGhost: {
    background: "none",
    border: "none",
    color: "var(--gold)",
    cursor: "pointer",
    fontSize: "0.85rem",
    fontWeight: 500,
    padding: 0,
    fontFamily: "inherit",
  },
  link: {
    color: "var(--gold)",
    textDecoration: "none",
    fontSize: "0.85rem",
    fontWeight: 500,
  },
  error: {
    fontSize: "0.85rem",
    color: "#c97055",
    marginBottom: "1rem",
  },
  success: {
    fontSize: "0.85rem",
    color: "#5bb98c",
    marginBottom: "1rem",
  },
  /* Dashboard layout */
  dashLayout: {
    display: "flex",
    minHeight: "100vh",
  },
  sidebar: {
    width: 240,
    flexShrink: 0,
    borderRight: "1px solid var(--neutral-800)",
    padding: "2rem 0",
    display: "flex",
    flexDirection: "column",
    position: "sticky",
    top: 0,
    height: "100vh",
    overflowY: "auto",
  },
  sidebarLogo: {
    fontSize: "1.1rem",
    fontWeight: 700,
    color: "var(--neutral-50)",
    padding: "0 1.5rem",
    marginBottom: "2.5rem",
    letterSpacing: "-0.01em",
  },
  navItem: {
    display: "block",
    padding: "0.55rem 1.5rem",
    fontSize: "0.88rem",
    fontWeight: 500,
    color: "var(--neutral-400)",
    cursor: "pointer",
    textDecoration: "none",
    transition: "color 0.12s",
    border: "none",
    background: "none",
    width: "100%",
    textAlign: "left",
    fontFamily: "inherit",
  },
  navItemActive: {
    color: "var(--neutral-50)",
  },
  navSection: {
    fontSize: "0.7rem",
    fontWeight: 600,
    color: "var(--neutral-500)",
    padding: "1.5rem 1.5rem 0.5rem",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
  },
  main: {
    flex: 1,
    padding: "2.5rem 3rem",
    maxWidth: 960,
  },
  pageTitle: {
    fontSize: "clamp(1.4rem, 3vw, 1.75rem)",
    fontWeight: 700,
    color: "var(--neutral-50)",
    marginBottom: "0.3rem",
  },
  pageSub: {
    fontSize: "0.9rem",
    color: "var(--neutral-400)",
    marginBottom: "2rem",
  },
  /* Worker list */
  workerRow: {
    display: "grid",
    gridTemplateColumns: "1fr auto auto auto auto",
    alignItems: "center",
    gap: "1.5rem",
    padding: "1rem 0",
    borderBottom: "1px solid var(--neutral-800)",
    cursor: "pointer",
    transition: "background 0.1s",
  },
  workerName: {
    fontSize: "0.95rem",
    fontWeight: 600,
    color: "var(--neutral-100)",
  },
  workerMeta: {
    fontSize: "0.8rem",
    color: "var(--neutral-400)",
    fontVariantNumeric: "tabular-nums",
  },
  statusDot: (color) => ({
    display: "inline-block",
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: color,
    marginRight: 6,
    verticalAlign: "middle",
  }),
  /* Charter */
  charterSection: {
    marginBottom: "1.5rem",
  },
  charterLabel: {
    fontSize: "0.75rem",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    marginBottom: "0.5rem",
  },
  charterItem: {
    fontSize: "0.88rem",
    color: "var(--neutral-300)",
    padding: "0.3rem 0",
    lineHeight: 1.5,
  },
  /* Approvals */
  approvalRow: {
    padding: "1.25rem 0",
    borderBottom: "1px solid var(--neutral-800)",
  },
  /* Onboarding */
  onboardWrap: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "2rem",
  },
  onboardBox: {
    width: "100%",
    maxWidth: 520,
  },
  onboardStep: {
    fontSize: "0.75rem",
    fontWeight: 600,
    color: "var(--neutral-500)",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    marginBottom: "1rem",
  },
  onboardTitle: {
    fontSize: "clamp(1.5rem, 4vw, 2.2rem)",
    fontWeight: 700,
    color: "var(--neutral-50)",
    marginBottom: "1.5rem",
    lineHeight: 1.15,
  },
  /* Pricing */
  pricingWrap: {
    minHeight: "100vh",
    padding: "6rem 2rem 4rem",
    maxWidth: 1100,
    margin: "0 auto",
  },
  pricingTitle: {
    fontSize: "clamp(2rem, 5vw, 3rem)",
    fontWeight: 700,
    color: "var(--neutral-50)",
    marginBottom: "0.75rem",
    lineHeight: 1.1,
  },
  tier: {
    padding: "2.5rem 0",
    borderBottom: "1px solid var(--neutral-800)",
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "3rem",
    alignItems: "start",
  },
  tierName: {
    fontSize: "1.25rem",
    fontWeight: 700,
    color: "var(--neutral-50)",
    marginBottom: "0.3rem",
  },
  tierPrice: {
    fontSize: "0.95rem",
    color: "var(--neutral-400)",
    marginBottom: "1rem",
  },
  tierFeature: {
    fontSize: "0.88rem",
    color: "var(--neutral-300)",
    padding: "0.25rem 0",
    lineHeight: 1.5,
  },
  /* Textarea */
  textarea: {
    display: "block",
    width: "100%",
    padding: "0.75rem 1rem",
    fontSize: "0.95rem",
    background: "var(--neutral-900)",
    border: "1px solid var(--neutral-700)",
    borderRadius: 8,
    color: "var(--neutral-100)",
    outline: "none",
    fontFamily: "inherit",
    resize: "vertical",
    minHeight: 120,
    lineHeight: 1.5,
    marginBottom: "1.25rem",
  },
  /* Select */
  select: {
    display: "block",
    width: "100%",
    padding: "0.75rem 1rem",
    fontSize: "0.95rem",
    background: "var(--neutral-900)",
    border: "1px solid var(--neutral-700)",
    borderRadius: 8,
    color: "var(--neutral-100)",
    outline: "none",
    fontFamily: "inherit",
    marginBottom: "1.25rem",
    appearance: "none",
  },
  /* Activity log */
  logEntry: {
    padding: "0.75rem 0",
    borderBottom: "1px solid var(--neutral-800)",
  },
  logTime: {
    fontSize: "0.75rem",
    color: "var(--neutral-500)",
    fontVariantNumeric: "tabular-nums",
  },
  logSummary: {
    fontSize: "0.88rem",
    color: "var(--neutral-300)",
    marginTop: "0.2rem",
    lineHeight: 1.5,
  },
  logDetail: {
    fontSize: "0.82rem",
    color: "var(--neutral-500)",
    marginTop: "0.4rem",
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
    padding: "0.75rem 1rem",
    background: "var(--neutral-900)",
    borderRadius: 6,
  },
  /* Back link */
  backLink: {
    display: "inline-block",
    fontSize: "0.82rem",
    fontWeight: 500,
    color: "var(--neutral-400)",
    marginBottom: "2rem",
    cursor: "pointer",
    background: "none",
    border: "none",
    padding: 0,
    fontFamily: "inherit",
  },
  /* OTP input */
  otpInput: {
    display: "block",
    width: "100%",
    padding: "0.75rem 1rem",
    fontSize: "1.5rem",
    fontWeight: 700,
    letterSpacing: "0.5em",
    textAlign: "center",
    background: "var(--neutral-900)",
    border: "1px solid var(--neutral-700)",
    borderRadius: 8,
    color: "var(--neutral-100)",
    outline: "none",
    marginBottom: "1.25rem",
    fontFamily: "inherit",
    transition: "border-color 0.15s",
  },
  /* Spacer */
  mb1: { marginBottom: "1rem" },
  mb2: { marginBottom: "2rem" },
  mt2: { marginTop: "2rem" },
  mt3: { marginTop: "3rem" },
};

const STATUS_COLORS = {
  running: "#5bb98c",
  paused: "var(--gold)",
  ready: "var(--neutral-400)",
  error: "#c97055",
};

/* ═══════════════════════════════════════════════════════════
   FocusInput — input that highlights on focus
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
   AUTH: SignUpView — real Magic Link signup
   ═══════════════════════════════════════════════════════════ */

function SignUpView({ onAuth }) {
  const [step, setStep] = useState("form"); // "form" | "otp"
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [signupResult, setSignupResult] = useState(null);

  async function handleSubmitForm(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      // Try passkey signup first (better UX — skips OTP step)
      let passkeySuccess = false;
      try {
        const optionsResp = await authRequest({
          pathname: "/v1/public/signup/passkey/options",
          body: { email: email.trim(), company: company.trim() },
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

          // Save passkey bundle for future logins
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

          // Session cookie is now set — fetch principal
          const principal = await fetchSessionPrincipal();
          const runtime = loadRuntimeConfig();
          const tenantId = optionsResp.tenantId || passkeyResp?.tenantId || principal?.tenantId || runtime.tenantId;
          saveRuntime({ ...runtime, tenantId });
          saveOnboardingState({ buyer: principal, sessionExpected: true });
          passkeySuccess = true;
          onAuth?.("onboarding");
        }
      } catch {
        // Passkey not supported or failed — fall through to OTP flow
      }

      if (!passkeySuccess) {
        // Standard signup: sends OTP email
        const result = await authRequest({
          pathname: "/v1/public/signup",
          body: { email: email.trim(), company: company.trim() },
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

      // Verify OTP to complete signup — the backend activates the session cookie on this call
      if (tenantId) {
        await authRequest({
          pathname: `/v1/tenants/${encodeURIComponent(tenantId)}/buyer/login`,
          body: { email: email.trim(), code: otpCode.trim() },
        });
      }

      // Session should now be active — fetch principal
      const principal = await fetchSessionPrincipal();
      const runtime = loadRuntimeConfig();
      saveRuntime({ ...runtime, tenantId: tenantId || principal?.tenantId || runtime.tenantId });
      saveOnboardingState({ buyer: principal, sessionExpected: true });

      // Try to register a passkey now that we have a session
      try {
        const keypair = await generateBrowserEd25519KeypairPem();
        const optionsResp = await authRequest({
          pathname: `/v1/tenants/${encodeURIComponent(tenantId)}/buyer/login/passkey/options`,
          body: { email: email.trim() },
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
        // Passkey registration is optional — not fatal
      }

      onAuth?.("onboarding");
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
                    body: { email: email.trim(), company: company.trim() },
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
        <h1 style={S.authTitle}>Create your workspace</h1>
        <p style={S.authSub}>
          Deploy AI workers that handle real work — monitored, governed, on your terms.
        </p>
        {error && <div style={S.error}>{error}</div>}
        <form onSubmit={handleSubmitForm}>
          <label style={S.label}>Email</label>
          <FocusInput
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            required
            autoFocus
          />
          <label style={S.label}>Company name</label>
          <FocusInput
            type="text"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Acme Corp"
            required
          />
          <button
            type="submit"
            style={{ ...S.btnPrimary, opacity: loading ? 0.6 : 1 }}
            disabled={loading}
          >
            {loading ? "Creating..." : "Create workspace"}
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
   AUTH: SignInView — real Magic Link login
   ═══════════════════════════════════════════════════════════ */

function SignInView({ onAuth }) {
  const [step, setStep] = useState("form"); // "form" | "otp"
  const [tenantId, setTenantId] = useState("");
  const [email, setEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const tid = tenantId.trim();
    const em = email.trim();
    try {
      // Check if we have a stored passkey for this tenant/email
      const storedPasskey = loadStoredBuyerPasskeyBundle({ tenantId: tid, email: em });

      if (storedPasskey) {
        // Passkey login flow
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

          // Session is active — confirm
          const principal = await fetchSessionPrincipal();
          const runtime = loadRuntimeConfig();
          saveRuntime({ ...runtime, tenantId: tid });
          saveOnboardingState({ buyer: principal, sessionExpected: true });
          onAuth?.("dashboard");
          return;
        }
      }

      // No passkey or passkey flow failed — fall back to OTP
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
      saveOnboardingState({ buyer: principal, sessionExpected: true });
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

  return (
    <div style={S.authWrap}>
      <div style={S.authBox} className="lovable-fade">
        <h1 style={S.authTitle}>Welcome back</h1>
        <p style={S.authSub}>
          Sign in to manage your workers.
        </p>
        {error && <div style={S.error}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label style={S.label}>Tenant ID</label>
          <FocusInput
            type="text"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            placeholder="tenant_abc123"
            required
            autoFocus
          />
          <label style={S.label}>Email</label>
          <FocusInput
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            required
          />
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
   BUILDER: Inference logic (ported from worker-builder-core)
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
  // Try to extract a meaningful name
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
  // Fallback: first 3-4 meaningful words
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
      // Check if they want to add more capabilities
      if (/add|also|slack|gmail|email|github|browser|search/.test(lower)) {
        const additional = inferCapabilities(input);
        const existingIds = new Set(conv.context.capabilities.map(c => c.id));
        for (const cap of additional) {
          if (!existingIds.has(cap.id)) {
            conv.context.capabilities.push(cap);
          }
        }
        // Re-infer charter with new capabilities
        conv.context.charter = inferCharterRules(conv.context.taskDescription, conv.context.capabilities);
      }

      // Show charter review
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
      // Looks good / continue
      // Show model options
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
      // Check if they picked a model by name or just confirmed
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
      return; // deployment handled by the component
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
  const [conv, setConv] = useState(() => {
    const c = createBuilderConversation();
    addBuilderMessage(c, "builder", "What do you need a worker to do?");
    return c;
  });
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState("");
  const [deployedWorker, setDeployedWorker] = useState(null);

  function sendMessage(text) {
    const next = { ...conv, messages: [...conv.messages], context: { ...conv.context } };
    // Deep-copy charter if it exists
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

    // If state just moved to DEPLOYING, kick off the API call
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

      // Mark onboarding complete
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
    addBuilderMessage(c, "builder", "What do you need a worker to do?");
    setConv(c);
    setDeployedWorker(null);
    setDeployError("");
  }

  return { conv, sendMessage, selectModel, deploying, deployError, deployedWorker, reset };
}

/* ═══════════════════════════════════════════════════════════
   BUILDER: Chat styles
   ═══════════════════════════════════════════════════════════ */

const BS = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minHeight: "100vh",
  },
  wrapInline: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minHeight: 0,
  },
  header: {
    padding: "2rem 2.5rem 1rem",
    borderBottom: "1px solid var(--neutral-800)",
    flexShrink: 0,
  },
  headerTitle: {
    fontSize: "1.1rem",
    fontWeight: 700,
    color: "var(--neutral-50)",
  },
  headerSub: {
    fontSize: "0.82rem",
    color: "var(--neutral-500)",
    marginTop: "0.2rem",
  },
  messagesArea: {
    flex: 1,
    overflowY: "auto",
    padding: "1.5rem 2.5rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
  },
  bubbleRow: (isUser) => ({
    display: "flex",
    justifyContent: isUser ? "flex-end" : "flex-start",
  }),
  bubble: (isUser) => ({
    maxWidth: "75%",
    padding: "0.75rem 1rem",
    borderRadius: 12,
    fontSize: "0.9rem",
    lineHeight: 1.55,
    color: "var(--neutral-100)",
    background: isUser ? "var(--neutral-800)" : "var(--neutral-900)",
    borderLeft: isUser ? "none" : "3px solid var(--gold)",
    wordBreak: "break-word",
  }),
  inputBar: {
    display: "flex",
    gap: "0.5rem",
    padding: "1rem 2.5rem 1.5rem",
    borderTop: "1px solid var(--neutral-800)",
    flexShrink: 0,
    background: "var(--neutral-950)",
  },
  chatInput: {
    flex: 1,
    padding: "0.7rem 1rem",
    fontSize: "0.9rem",
    background: "var(--neutral-900)",
    border: "1px solid var(--neutral-700)",
    borderRadius: 8,
    color: "var(--neutral-100)",
    outline: "none",
    fontFamily: "inherit",
    transition: "border-color 0.15s",
  },
  sendBtn: {
    padding: "0.7rem 1.25rem",
    fontSize: "0.85rem",
    fontWeight: 600,
    background: "var(--gold)",
    color: "var(--neutral-950)",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "opacity 0.15s",
    flexShrink: 0,
  },
  capBtn: {
    display: "inline-block",
    padding: "0.45rem 0.9rem",
    fontSize: "0.82rem",
    fontWeight: 600,
    background: "var(--gold-dim)",
    color: "var(--gold)",
    border: "1px solid var(--gold)",
    borderRadius: 6,
    cursor: "pointer",
    fontFamily: "inherit",
    marginRight: "0.5rem",
    marginTop: "0.5rem",
    transition: "background 0.15s",
  },
  skipBtn: {
    display: "inline-block",
    padding: "0.45rem 0.9rem",
    fontSize: "0.82rem",
    fontWeight: 500,
    background: "transparent",
    color: "var(--neutral-400)",
    border: "1px solid var(--neutral-700)",
    borderRadius: 6,
    cursor: "pointer",
    fontFamily: "inherit",
    marginTop: "0.5rem",
    transition: "border-color 0.15s",
  },
  charterBlock: {
    marginTop: "0.75rem",
    padding: "0.75rem 1rem",
    background: "rgba(0,0,0,0.2)",
    borderRadius: 8,
    border: "1px solid var(--neutral-800)",
  },
  modelCard: (isSelected) => ({
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "0.6rem 0.9rem",
    borderRadius: 8,
    border: isSelected ? "1px solid var(--gold)" : "1px solid var(--neutral-700)",
    background: isSelected ? "rgba(210,176,111,0.08)" : "transparent",
    cursor: "pointer",
    marginTop: "0.4rem",
    transition: "all 0.15s",
  }),
  deployBtn: {
    display: "inline-block",
    padding: "0.6rem 1.5rem",
    fontSize: "0.88rem",
    fontWeight: 600,
    background: "var(--gold)",
    color: "var(--neutral-950)",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    fontFamily: "inherit",
    marginTop: "0.75rem",
    transition: "opacity 0.15s",
  },
  viewWorkerBtn: {
    display: "inline-block",
    padding: "0.55rem 1.25rem",
    fontSize: "0.85rem",
    fontWeight: 600,
    background: "var(--gold)",
    color: "var(--neutral-950)",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    fontFamily: "inherit",
    marginTop: "0.75rem",
    transition: "opacity 0.15s",
  },
};

/* ═══════════════════════════════════════════════════════════
   BUILDER: BuilderMessage — renders typed messages
   ═══════════════════════════════════════════════════════════ */

function BuilderMessage({ msg, onAction }) {
  const isUser = msg.role === "user";

  if (isUser) {
    return (
      <div style={BS.bubbleRow(true)} className="lovable-fade">
        <div style={BS.bubble(true)}>{msg.content}</div>
      </div>
    );
  }

  // Builder messages
  const meta = msg.meta;

  return (
    <div style={BS.bubbleRow(false)} className="lovable-fade">
      <div style={BS.bubble(false)}>
        <div>{msg.content}</div>

        {/* Capabilities with connect buttons */}
        {meta?.type === "capabilities" && meta.capabilities?.length > 0 && (
          <div style={{ marginTop: "0.6rem" }}>
            {meta.capabilities.map(cap => (
              <button
                key={cap.id}
                style={BS.capBtn}
                onClick={() => alert(`Integration coming soon. Your worker will use built-in tools for ${cap.name} for now.`)}
              >
                Connect {cap.name}
              </button>
            ))}
            <button style={BS.skipBtn} onClick={() => onAction?.("skip_capabilities")}>
              Skip for now
            </button>
          </div>
        )}

        {meta?.type === "capabilities_fallback" && (
          <div style={{ marginTop: "0.6rem" }}>
            <button style={BS.skipBtn} onClick={() => onAction?.("skip_capabilities")}>
              Sounds good, continue
            </button>
          </div>
        )}

        {/* Charter preview */}
        {meta?.type === "charter" && meta.charter && (
          <div style={BS.charterBlock}>
            <CharterDisplay charter={meta.charter} compact />
            <button
              style={{ ...BS.skipBtn, marginTop: "0.75rem" }}
              onClick={() => onAction?.("charter_ok")}
            >
              Looks good
            </button>
          </div>
        )}

        {/* Model selection cards */}
        {meta?.type === "models" && meta.models && (
          <div style={{ marginTop: "0.5rem" }}>
            {meta.models.map(m => (
              <div
                key={m.id}
                style={BS.modelCard(m.id === meta.selected)}
                onClick={() => onAction?.("select_model", m.id)}
              >
                <div>
                  <span style={{ fontSize: "0.88rem", fontWeight: 600, color: m.id === meta.selected ? "var(--neutral-100)" : "var(--neutral-300)" }}>{m.name}</span>
                  <span style={{ fontSize: "0.75rem", color: "var(--neutral-500)", marginLeft: 8 }}>{m.tag}</span>
                </div>
                <span style={{ fontSize: "0.75rem", color: "var(--neutral-500)", fontVariantNumeric: "tabular-nums" }}>
                  ${m.inputPer1M.toFixed(2)} / ${m.outputPer1M.toFixed(2)} per 1M
                </span>
              </div>
            ))}
            <button
              style={{ ...BS.skipBtn, marginTop: "0.6rem" }}
              onClick={() => onAction?.("confirm_model")}
            >
              Use recommended
            </button>
          </div>
        )}

        {/* Deploy confirmation */}
        {meta?.type === "confirm" && (
          <div>
            <button
              style={BS.deployBtn}
              onClick={() => onAction?.("deploy")}
            >
              Deploy worker
            </button>
          </div>
        )}

        {/* Deployed success */}
        {meta?.type === "deployed" && (
          <div>
            <button
              style={BS.viewWorkerBtn}
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
   BUILDER: BuilderChat component
   ═══════════════════════════════════════════════════════════ */

function BuilderChat({ fullScreen = false, onComplete, onViewWorker, onBack }) {
  const { conv, sendMessage, selectModel, deploying, deployedWorker, reset } = useBuilderState();
  const [inputValue, setInputValue] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const messagesEndRef = useRef(null);
  const messagesAreaRef = useRef(null);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conv.messages.length]);

  function handleSend() {
    const text = inputValue.trim();
    if (!text || deploying) return;
    setInputValue("");
    sendMessage(text);
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
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

  const isDeployed = conv.state === BUILDER_STATES.DEPLOYED;
  const isDeploying = conv.state === BUILDER_STATES.DEPLOYING || deploying;

  return (
    <div style={fullScreen ? BS.wrap : BS.wrapInline}>
      {/* Header */}
      <div style={BS.header}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={BS.headerTitle}>
              {fullScreen ? "nooterra" : "New worker"}
            </div>
            <div style={BS.headerSub}>
              {fullScreen
                ? "Tell me what you need done. I'll build a worker for it."
                : "Describe the job and I'll set it up."
              }
            </div>
          </div>
          {!fullScreen && onBack && (
            <button style={S.btnGhost} onClick={onBack}>Cancel</button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div style={BS.messagesArea} ref={messagesAreaRef}>
        {conv.messages.map((msg) => (
          <BuilderMessage key={msg.id} msg={msg} onAction={handleAction} />
        ))}
        {isDeploying && (
          <div style={BS.bubbleRow(false)} className="lovable-fade">
            <div style={{ ...BS.bubble(false), color: "var(--neutral-400)" }}>Deploying...</div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      {!isDeployed && (
        <div style={BS.inputBar}>
          <input
            type="text"
            style={{
              ...BS.chatInput,
              ...(inputFocused ? { borderColor: "var(--gold)" } : {}),
            }}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            placeholder={
              conv.state === BUILDER_STATES.GREETING || conv.state === BUILDER_STATES.UNDERSTANDING
                ? "e.g. Monitor competitor prices and post a daily summary to Slack"
                : "Type a message..."
            }
            disabled={isDeploying}
            autoFocus
          />
          <button
            style={{ ...BS.sendBtn, opacity: !inputValue.trim() || isDeploying ? 0.5 : 1 }}
            onClick={handleSend}
            disabled={!inputValue.trim() || isDeploying}
          >
            Send
          </button>
        </div>
      )}

      {/* Post-deploy: offer to create another or go to dashboard */}
      {isDeployed && (
        <div style={{ ...BS.inputBar, justifyContent: "center", gap: "1rem" }}>
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

function generateCharterPreview(description) {
  const desc = description.toLowerCase();
  const canDo = [];
  const askFirst = [];
  const neverDo = [];

  if (desc.includes("email") || desc.includes("inbox") || desc.includes("support")) {
    canDo.push("Read incoming support emails");
    canDo.push("Draft reply templates");
    askFirst.push("Send replies to customers");
    neverDo.push("Delete or archive emails without review");
  }
  if (desc.includes("monitor") || desc.includes("check") || desc.includes("watch")) {
    canDo.push("Monitor data sources on schedule");
    canDo.push("Generate summary reports");
    askFirst.push("Trigger alerts or notifications");
  }
  if (desc.includes("write") || desc.includes("draft") || desc.includes("create")) {
    canDo.push("Draft content based on templates");
    askFirst.push("Publish or send drafted content");
    neverDo.push("Publish without human approval");
  }

  if (canDo.length === 0) {
    canDo.push("Execute the described task");
    canDo.push("Log results and status");
    askFirst.push("Take actions with external side effects");
    neverDo.push("Access resources outside defined scope");
  }

  neverDo.push("Spend money without approval");
  neverDo.push("Access credentials or keys directly");

  return { canDo, askFirst, neverDo };
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
   DASHBOARD: Sidebar
   ═══════════════════════════════════════════════════════════ */

function Sidebar({ activeView, onNavigate, pendingApprovals = 0 }) {
  const [creditBalance, setCreditBalance] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const result = await workerApiRequest({ pathname: "/v1/credits", method: "GET" });
        if (result?.balance != null) {
          setCreditBalance(result.balance);
        } else if (result?.remaining != null) {
          setCreditBalance(result.remaining);
        }
      } catch { /* ignore — credits endpoint may not exist yet */ }
    })();
  }, []);

  return (
    <nav style={S.sidebar}>
      <div style={S.sidebarLogo}>nooterra</div>

      <button
        style={{ ...S.navItem, ...(activeView === "workers" ? S.navItemActive : {}) }}
        onClick={() => onNavigate("workers")}
      >
        Workers
      </button>
      <button
        style={{ ...S.navItem, ...(activeView === "approvals" ? S.navItemActive : {}) }}
        onClick={() => onNavigate("approvals")}
      >
        Approvals
        {pendingApprovals > 0 && (
          <span
            style={{
              marginLeft: 8,
              fontSize: "0.72rem",
              fontWeight: 700,
              color: "var(--gold)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {pendingApprovals}
          </span>
        )}
      </button>
      <button
        style={{ ...S.navItem, ...(activeView === "receipts" ? S.navItemActive : {}) }}
        onClick={() => onNavigate("receipts")}
      >
        History
      </button>
      <button
        style={{ ...S.navItem, ...(activeView === "settings" ? S.navItemActive : {}) }}
        onClick={() => onNavigate("settings")}
      >
        Settings
      </button>

      {creditBalance != null && (
        <div style={{ padding: "1rem 1.5rem", marginTop: "0.5rem" }}>
          <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--neutral-500)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.3rem" }}>
            Credits
          </div>
          <div style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--neutral-100)", fontVariantNumeric: "tabular-nums" }}>
            ${(creditBalance / 100).toFixed(2)} remaining
          </div>
          <a
            href="/settings"
            onClick={(e) => { e.preventDefault(); onNavigate("settings"); }}
            style={{ fontSize: "0.78rem", color: "var(--gold)", textDecoration: "none", fontWeight: 500 }}
          >
            Top up
          </a>
        </div>
      )}

      <div style={{ flex: 1 }} />

      <div style={S.navSection}>Resources</div>
      <a href="https://docs.nooterra.ai" style={S.navItem} target="_blank" rel="noopener noreferrer">
        Docs
      </a>
      <a href="https://github.com/nooterra" style={S.navItem} target="_blank" rel="noopener noreferrer">
        GitHub
      </a>
      <button
        style={{ ...S.navItem, color: "var(--neutral-500)", marginTop: "0.5rem" }}
        onClick={async () => {
          await logoutSession();
          try { localStorage.removeItem(PRODUCT_RUNTIME_STORAGE_KEY); } catch { /* ignore */ }
          try { localStorage.removeItem(ONBOARDING_STORAGE_KEY); } catch { /* ignore */ }
          navigate("/login");
        }}
      >
        Sign out
      </button>
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
        <button style={S.btnPrimary} onClick={onCreate}>
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
          {/* Header */}
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

function WorkerDetailView({ workerId, onBack }) {
  const [worker, setWorker] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("charter");
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

  async function handleRunNow() {
    setRunningAction(true);
    setError("");
    try {
      await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}/run`, method: "POST" });
      // Reload worker to get updated status
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

      {/* Action buttons */}
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

      {/* Cost summary */}
      {worker.cost != null && (
        <div style={{ fontSize: "0.85rem", color: "var(--neutral-400)", marginBottom: "2rem" }}>
          Cost this period: <span style={{ color: "var(--neutral-200)", fontVariantNumeric: "tabular-nums" }}>${(typeof worker.cost === "number" ? worker.cost : 0).toFixed(2)}</span>
        </div>
      )}

      {/* Tabs */}
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
          {logsLoading ? (
            <div style={{ fontSize: "0.88rem", color: "var(--neutral-500)" }}>Loading logs...</div>
          ) : logs.length === 0 ? (
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
   DASHBOARD: CreateWorkerView (now uses BuilderChat)
   ═══════════════════════════════════════════════════════════ */

function deriveWorkerName(description) {
  return inferWorkerName(description);
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
   RECEIPTS VIEW (execution history)
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

function SettingsView() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const runtime = loadRuntimeConfig();
        const result = await fetchTenantSettings(runtime);
        setSettings(result);
        setDisplayName(result?.displayName || result?.name || "");
      } catch {
        setSettings({});
      }
      setLoading(false);
    })();
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      const runtime = loadRuntimeConfig();
      await updateTenantSettings(runtime, { displayName: displayName.trim() });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* ignore */ }
    setSaving(false);
  }

  const runtime = loadRuntimeConfig();

  return (
    <div>
      <h1 style={S.pageTitle}>Settings</h1>
      <p style={S.pageSub}>Manage your workspace configuration.</p>

      {loading ? (
        <div style={{ fontSize: "0.88rem", color: "var(--neutral-500)" }}>Loading...</div>
      ) : (
        <div style={{ maxWidth: 480 }}>
          <label style={S.label}>Workspace name</label>
          <FocusInput
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <button
            style={{ ...S.btnPrimary, width: "auto", opacity: saving ? 0.6 : 1 }}
            disabled={saving}
            onClick={handleSave}
          >
            {saving ? "Saving..." : saved ? "Saved" : "Save"}
          </button>

          <div style={{ ...S.label, marginTop: "3rem" }}>Tenant ID</div>
          <div style={{ fontSize: "0.85rem", color: "var(--neutral-400)", fontVariantNumeric: "tabular-nums", marginBottom: "2rem" }}>
            {runtime.tenantId}
          </div>

          <div style={{ ...S.label, marginTop: "1rem" }}>API endpoint</div>
          <div style={{ fontSize: "0.85rem", color: "var(--neutral-400)", wordBreak: "break-all", marginBottom: "2rem" }}>
            {runtime.baseUrl}
          </div>

          <button
            style={{ ...S.btnSecondary, borderColor: "#c97055", color: "#c97055" }}
            onClick={async () => {
              if (window.confirm("Sign out of this workspace?")) {
                await logoutSession();
                try { localStorage.removeItem(PRODUCT_RUNTIME_STORAGE_KEY); } catch { /* ignore */ }
                try { localStorage.removeItem(ONBOARDING_STORAGE_KEY); } catch { /* ignore */ }
                navigate("/login");
              }
            }}
          >
            Sign out
          </button>
        </div>
      )}
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
   DASHBOARD SHELL (authenticated views)
   ═══════════════════════════════════════════════════════════ */

function DashboardShell({ initialView = "workers" }) {
  const [view, setView] = useState(initialView);
  const [selectedWorkerId, setSelectedWorkerId] = useState(null);
  const [pendingApprovals, setPendingApprovals] = useState(0);

  useEffect(() => {
    // Check pending approvals count
    (async () => {
      try {
        const runtime = loadRuntimeConfig();
        const result = await fetchApprovalInbox(runtime, { status: "pending" });
        const items = result?.items || result || [];
        setPendingApprovals(Array.isArray(items) ? items.length : 0);
      } catch { /* ignore */ }
    })();
  }, []);

  function handleNavigate(dest) {
    setView(dest);
    setSelectedWorkerId(null);
  }

  function handleSelectWorker(worker) {
    setSelectedWorkerId(worker.id);
    setView("workerDetail");
  }

  function handleCreateWorker(result) {
    if (result?.id) {
      setSelectedWorkerId(result.id);
      setView("workerDetail");
    } else {
      setView("workers");
    }
  }

  return (
    <div style={S.dashLayout}>
      <Sidebar
        activeView={view === "workerDetail" || view === "createWorker" ? "workers" : view}
        onNavigate={handleNavigate}
        pendingApprovals={pendingApprovals}
      />
      <main style={S.main}>
        {view === "workers" && (
          <WorkersListView
            onSelect={handleSelectWorker}
            onCreate={() => setView("createWorker")}
          />
        )}
        {view === "workerDetail" && selectedWorkerId && (
          <WorkerDetailView
            workerId={selectedWorkerId}
            onBack={() => { setSelectedWorkerId(null); setView("workers"); }}
          />
        )}
        {view === "createWorker" && (
          <BuilderChat
            onBack={() => setView("workers")}
            onComplete={() => setView("workers")}
            onViewWorker={(w) => { if (w?.id) { setSelectedWorkerId(w.id); setView("workerDetail"); } else { setView("workers"); } }}
          />
        )}
        {view === "approvals" && <ApprovalsView />}
        {view === "receipts" && <ReceiptsView />}
        {view === "settings" && <SettingsView />}
      </main>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   PRODUCT SHELL — top-level mode router with session check
   ═══════════════════════════════════════════════════════════ */

export default function ProductShell({ mode, launchId, agentId, runId, requestedPath }) {
  const [currentMode, setCurrentMode] = useState(null); // null = checking session
  const [sessionChecked, setSessionChecked] = useState(false);

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
          // Session is valid — save state and go to requested view or dashboard
          const runtime = loadRuntimeConfig();
          if (principal.tenantId) {
            saveRuntime({ ...runtime, tenantId: principal.tenantId });
          }
          saveOnboardingState({
            ...loadOnboardingState(),
            buyer: principal,
            sessionExpected: true,
          });

          // Check if onboarding was completed
          const onboardState = loadOnboardingState();
          if (onboardState?.completed || mode === "dashboard" || mode === "wallet" || mode === "approvals" || mode === "receipts" || mode === "workspace" || mode === "disputes") {
            setCurrentMode(mode === "login" ? "dashboard" : mode);
          } else {
            setCurrentMode("onboarding");
          }
          setSessionChecked(true);
          return;
        }
      } catch {
        // No valid session
      }

      if (!cancelled) {
        // No session — show login unless explicitly requesting signup/pricing
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
      // Only update for non-auth modes if we have a session
      const onboardState = loadOnboardingState();
      if (onboardState?.sessionExpected) {
        setCurrentMode(mode);
      } else if (mode === "signup" || mode === "login" || mode === "pricing") {
        setCurrentMode(mode);
      }
    }
  }, [mode, sessionChecked]);

  function handleAuth(dest) {
    if (dest === "onboarding") {
      navigate("/onboarding?experience=app");
      setCurrentMode("onboarding");
    } else {
      navigate("/wallet");
      setCurrentMode("dashboard");
    }
  }

  function handleOnboardingComplete() {
    navigate("/wallet");
    setCurrentMode("dashboard");
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

  return (
    <div style={S.shell}>
      {resolvedMode === "signup" && (
        <SignUpView onAuth={handleAuth} />
      )}

      {resolvedMode === "login" && (
        <SignInView onAuth={handleAuth} />
      )}

      {resolvedMode === "onboarding" && (
        <BuilderChat
          fullScreen
          onComplete={handleOnboardingComplete}
          onViewWorker={(w) => { handleOnboardingComplete(); }}
        />
      )}

      {resolvedMode === "pricing" && (
        <PricingView />
      )}

      {(resolvedMode === "wallet" || resolvedMode === "dashboard") && (
        <DashboardShell initialView="workers" />
      )}

      {resolvedMode === "approvals" && (
        <DashboardShell initialView="approvals" />
      )}

      {resolvedMode === "receipts" && (
        <DashboardShell initialView="receipts" />
      )}

      {resolvedMode === "workspace" && (
        <DashboardShell initialView="settings" />
      )}

      {resolvedMode === "disputes" && (
        <DashboardShell initialView="workers" />
      )}

      {/* Fallback: any unrecognized mode → dashboard */}
      {!["signup", "login", "onboarding", "pricing", "wallet", "dashboard", "approvals", "receipts", "workspace", "disputes"].includes(resolvedMode) && (
        <DashboardShell initialView="workers" />
      )}
    </div>
  );
}
