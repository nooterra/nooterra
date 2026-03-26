import { useEffect, useRef, useState } from "react";
import {
  buildHeaders,
  createClientId,
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
const WORKERS_STORAGE_KEY = "nooterra_workers_v1";
const AUTH_BASE = "/__magic";

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
   ONBOARDING
   ═══════════════════════════════════════════════════════════ */

const AI_PROVIDERS = [
  { id: "anthropic", name: "Anthropic (Claude)" },
  { id: "openai", name: "OpenAI" },
  { id: "google", name: "Google (Gemini)" },
  { id: "aws-bedrock", name: "AWS Bedrock" },
  { id: "azure-openai", name: "Azure OpenAI" },
];

function OnboardingView({ onComplete }) {
  const [step, setStep] = useState(1);
  const [companyName, setCompanyName] = useState("");
  const [provider, setProvider] = useState("");
  const [providerKey, setProviderKey] = useState("");
  const [workerDesc, setWorkerDesc] = useState("");
  const [saving, setSaving] = useState(false);

  function handleNext() {
    if (step < 4) setStep(step + 1);
  }

  function handleBack() {
    if (step > 1) setStep(step - 1);
  }

  async function handleFinish() {
    setSaving(true);
    try {
      const runtime = loadRuntimeConfig();
      if (companyName.trim()) {
        try {
          await updateTenantSettings(runtime, { displayName: companyName.trim() });
        } catch { /* non-fatal */ }
      }
      saveOnboardingState({
        buyer: loadOnboardingState()?.buyer || null,
        sessionExpected: true,
        completed: true,
        companyName: companyName.trim(),
        provider,
      });
    } catch { /* ignore */ }
    setSaving(false);
    onComplete?.();
  }

  const charterPreview = workerDesc.trim() ? generateCharterPreview(workerDesc) : null;

  return (
    <div style={S.onboardWrap}>
      <div style={S.onboardBox} className="lovable-fade" key={step}>
        <div style={S.onboardStep}>Step {step} of 4</div>

        {/* Step indicator */}
        <div style={{ display: "flex", gap: 6, marginBottom: "2rem" }}>
          {[1, 2, 3, 4].map((s) => (
            <div
              key={s}
              style={{
                height: 3,
                flex: 1,
                borderRadius: 2,
                background: s <= step ? "var(--gold)" : "var(--neutral-800)",
                transition: "background 0.2s",
              }}
            />
          ))}
        </div>

        {step === 1 && (
          <>
            <h1 style={S.onboardTitle}>What's your company name?</h1>
            <FocusInput
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Acme Corp"
              autoFocus
            />
            <button
              style={{ ...S.btnPrimary, opacity: !companyName.trim() ? 0.5 : 1 }}
              disabled={!companyName.trim()}
              onClick={handleNext}
            >
              Continue
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <h1 style={S.onboardTitle}>Connect your AI provider</h1>
            <p style={{ ...S.authSub, marginBottom: "1.5rem" }}>
              Workers need an AI model to reason with. Pick your provider and paste your API key.
            </p>
            <label style={S.label}>Provider</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: "1.25rem" }}>
              {AI_PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  style={{
                    ...S.btnSecondary,
                    width: "100%",
                    textAlign: "left",
                    justifyContent: "flex-start",
                    borderColor: provider === p.id ? "var(--gold)" : "var(--neutral-700)",
                    color: provider === p.id ? "var(--neutral-50)" : "var(--neutral-300)",
                  }}
                  onClick={() => setProvider(p.id)}
                >
                  {p.name}
                </button>
              ))}
            </div>
            {provider && (
              <>
                <label style={S.label}>API Key</label>
                <FocusInput
                  type="password"
                  value={providerKey}
                  onChange={(e) => setProviderKey(e.target.value)}
                  placeholder="sk-..."
                />
              </>
            )}
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <button style={S.btnSecondary} onClick={handleBack}>Back</button>
              <button
                style={{ ...S.btnPrimary, flex: 1, opacity: !provider ? 0.5 : 1 }}
                disabled={!provider}
                onClick={handleNext}
              >
                Continue
              </button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h1 style={S.onboardTitle}>Create your first worker</h1>
            <p style={{ ...S.authSub, marginBottom: "1.5rem" }}>
              Describe what you need done. We'll generate a charter — the rules your worker follows.
            </p>
            <label style={S.label}>What should this worker do?</label>
            <textarea
              style={S.textarea}
              value={workerDesc}
              onChange={(e) => setWorkerDesc(e.target.value)}
              placeholder="e.g. Monitor our support inbox and draft replies for common questions"
              autoFocus
            />
            {charterPreview && (
              <div style={{ marginBottom: "1.5rem" }}>
                <div style={{ ...S.label, color: "var(--neutral-400)" }}>Charter preview</div>
                <CharterDisplay charter={charterPreview} compact />
              </div>
            )}
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <button style={S.btnSecondary} onClick={handleBack}>Back</button>
              <button
                style={{ ...S.btnPrimary, flex: 1, opacity: !workerDesc.trim() ? 0.5 : 1 }}
                disabled={!workerDesc.trim()}
                onClick={handleNext}
              >
                Continue
              </button>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <h1 style={S.onboardTitle}>You're all set</h1>
            <p style={{ ...S.authSub, marginBottom: "0.75rem" }}>
              Your workspace <strong style={{ color: "var(--neutral-100)" }}>{companyName}</strong> is
              ready. Your first worker will start once you deploy it from the dashboard.
            </p>
            <div style={{ fontSize: "0.85rem", color: "var(--neutral-400)", marginBottom: "2rem", lineHeight: 1.6 }}>
              Connected to {AI_PROVIDERS.find((p) => p.id === provider)?.name || provider}
            </div>
            <button
              style={{ ...S.btnPrimary, opacity: saving ? 0.6 : 1 }}
              disabled={saving}
              onClick={handleFinish}
            >
              {saving ? "Setting up..." : "Go to dashboard"}
            </button>
          </>
        )}
      </div>
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

function WorkersListView({ workers, onSelect, onCreate }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "2rem" }}>
        <div>
          <h1 style={S.pageTitle}>Workers</h1>
          <p style={{ ...S.pageSub, marginBottom: 0 }}>
            {workers.length === 0
              ? "No workers yet. Create one to get started."
              : `${workers.length} worker${workers.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <button style={S.btnPrimary} onClick={onCreate}>
          Create worker
        </button>
      </div>

      {workers.length === 0 && (
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
              <div style={S.workerMeta}>{w.lastRun ? timeAgo(w.lastRun) : "never"}</div>
              <div style={S.workerMeta}>{w.schedule || "manual"}</div>
              <div style={S.workerMeta}>{w.cost != null ? `$${w.cost.toFixed(2)}` : "--"}</div>
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

function WorkerDetailView({ worker, onBack, onUpdate, onDelete }) {
  const [tab, setTab] = useState("charter");
  const [editing, setEditing] = useState(false);
  const [editCharter, setEditCharter] = useState(null);

  function handlePauseResume() {
    const newStatus = worker.status === "paused" ? "ready" : "paused";
    onUpdate?.({ ...worker, status: newStatus });
  }

  function handleDelete() {
    if (window.confirm(`Delete worker "${worker.name}"? This cannot be undone.`)) {
      onDelete?.(worker.id);
    }
  }

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

      {/* Cost summary */}
      {worker.cost != null && (
        <div style={{ fontSize: "0.85rem", color: "var(--neutral-400)", marginBottom: "2rem" }}>
          Cost this period: <span style={{ color: "var(--neutral-200)", fontVariantNumeric: "tabular-nums" }}>${worker.cost.toFixed(2)}</span>
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
        <CharterDisplay charter={worker.charter} />
      )}

      {tab === "activity" && (
        <div>
          {(!worker.activityLog || worker.activityLog.length === 0) ? (
            <div style={{ fontSize: "0.88rem", color: "var(--neutral-500)" }}>
              No activity yet. This worker hasn't run.
            </div>
          ) : (
            worker.activityLog.map((entry, i) => (
              <ActivityLogEntry key={i} entry={entry} />
            ))
          )}
        </div>
      )}

      {tab === "settings" && (
        <div style={{ maxWidth: 480 }}>
          <label style={S.label}>Schedule</label>
          <div style={{ fontSize: "0.88rem", color: "var(--neutral-200)", marginBottom: "2rem" }}>
            {worker.schedule || "Manual (on-demand)"}
          </div>

          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <button style={S.btnSecondary} onClick={handlePauseResume}>
              {worker.status === "paused" ? "Resume" : "Pause"}
            </button>
            <button
              style={{ ...S.btnSecondary, borderColor: "#c97055", color: "#c97055" }}
              onClick={handleDelete}
            >
              Delete worker
            </button>
          </div>
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
   DASHBOARD: CreateWorkerView
   ═══════════════════════════════════════════════════════════ */

const SCHEDULE_OPTIONS = [
  { value: "continuous", label: "Continuous" },
  { value: "hourly", label: "Every hour" },
  { value: "daily", label: "Once a day" },
  { value: "custom", label: "Custom cron" },
];

function CreateWorkerView({ onBack, onCreate }) {
  const [description, setDescription] = useState("");
  const [schedule, setSchedule] = useState("daily");
  const [customCron, setCustomCron] = useState("");
  const [creating, setCreating] = useState(false);

  const charter = description.trim() ? generateCharterPreview(description) : null;

  async function handleDeploy() {
    if (!description.trim()) return;
    setCreating(true);
    const worker = {
      id: createClientId("wkr"),
      name: deriveWorkerName(description),
      description: description.trim(),
      status: "ready",
      schedule: schedule === "custom" ? customCron || "custom" : schedule,
      charter: charter || { canDo: [], askFirst: [], neverDo: [] },
      cost: 0,
      lastRun: null,
      activityLog: [],
      createdAt: new Date().toISOString(),
    };
    // Persist locally
    try {
      const existing = JSON.parse(localStorage.getItem(WORKERS_STORAGE_KEY) || "[]");
      existing.push(worker);
      localStorage.setItem(WORKERS_STORAGE_KEY, JSON.stringify(existing));
    } catch { /* ignore */ }

    // Try API
    try {
      const runtime = loadRuntimeConfig();
      await requestJson({
        baseUrl: runtime.baseUrl,
        pathname: "/v1/workers",
        method: "POST",
        headers: buildHeaders({ ...runtime, write: true }),
        body: {
          name: worker.name,
          description: worker.description,
          schedule: worker.schedule,
          charter: worker.charter,
        },
      });
    } catch { /* non-fatal — local state is primary */ }

    setCreating(false);
    onCreate?.(worker);
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
      <div style={{ width: "100%", maxWidth: 580 }} className="lovable-fade">
        <button style={S.backLink} onClick={onBack}>
          ← Back
        </button>
        <h1 style={{ ...S.pageTitle, fontSize: "clamp(1.5rem, 4vw, 2rem)", marginBottom: "0.5rem" }}>
          Create a worker
        </h1>
        <p style={{ ...S.pageSub, marginBottom: "2rem" }}>
          Describe the job, pick a schedule, review the charter, deploy.
        </p>

        <label style={S.label}>What do you need a worker to do?</label>
        <textarea
          style={S.textarea}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Check our Stripe dashboard every morning and post a revenue summary to Slack"
          autoFocus
        />

        <label style={S.label}>How often?</label>
        <div style={{ display: "flex", gap: 6, marginBottom: "1.25rem", flexWrap: "wrap" }}>
          {SCHEDULE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              style={{
                ...S.btnSecondary,
                borderColor: schedule === opt.value ? "var(--gold)" : "var(--neutral-700)",
                color: schedule === opt.value ? "var(--neutral-50)" : "var(--neutral-300)",
              }}
              onClick={() => setSchedule(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {schedule === "custom" && (
          <FocusInput
            type="text"
            value={customCron}
            onChange={(e) => setCustomCron(e.target.value)}
            placeholder="0 9 * * 1-5"
          />
        )}

        {charter && (
          <div style={{ marginBottom: "2rem" }}>
            <div style={{ ...S.label, color: "var(--neutral-400)" }}>Charter preview</div>
            <CharterDisplay charter={charter} compact />
          </div>
        )}

        <button
          style={{ ...S.btnPrimary, opacity: !description.trim() || creating ? 0.5 : 1 }}
          disabled={!description.trim() || creating}
          onClick={handleDeploy}
        >
          {creating ? "Deploying..." : "Deploy worker"}
        </button>
      </div>
    </div>
  );
}

function deriveWorkerName(description) {
  const words = description.trim().split(/\s+/).slice(0, 4);
  if (words.length === 0) return "Worker";
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
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
  const [selectedWorker, setSelectedWorker] = useState(null);
  const [workers, setWorkers] = useState([]);
  const [pendingApprovals, setPendingApprovals] = useState(0);

  useEffect(() => {
    // Load workers from localStorage
    try {
      const stored = JSON.parse(localStorage.getItem(WORKERS_STORAGE_KEY) || "[]");
      if (Array.isArray(stored)) setWorkers(stored);
    } catch { /* ignore */ }

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
    setSelectedWorker(null);
  }

  function handleSelectWorker(worker) {
    setSelectedWorker(worker);
    setView("workerDetail");
  }

  function handleCreateWorker(worker) {
    setWorkers((prev) => [...prev, worker]);
    setSelectedWorker(worker);
    setView("workerDetail");
  }

  function handleUpdateWorker(updated) {
    setWorkers((prev) => {
      const next = prev.map((w) => (w.id === updated.id ? updated : w));
      try { localStorage.setItem(WORKERS_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
    setSelectedWorker(updated);
  }

  function handleDeleteWorker(id) {
    setWorkers((prev) => {
      const next = prev.filter((w) => w.id !== id);
      try { localStorage.setItem(WORKERS_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
    setSelectedWorker(null);
    setView("workers");
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
            workers={workers}
            onSelect={handleSelectWorker}
            onCreate={() => setView("createWorker")}
          />
        )}
        {view === "workerDetail" && selectedWorker && (
          <WorkerDetailView
            worker={selectedWorker}
            onBack={() => { setSelectedWorker(null); setView("workers"); }}
            onUpdate={handleUpdateWorker}
            onDelete={handleDeleteWorker}
          />
        )}
        {view === "createWorker" && (
          <CreateWorkerView
            onBack={() => setView("workers")}
            onCreate={handleCreateWorker}
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
        <OnboardingView onComplete={handleOnboardingComplete} />
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
