import React, { useState, useEffect } from "react";
import {
  S, AUTH_BASE, saveRuntime, saveOnboardingState, loadOnboardingState,
  authRequest, fetchSessionPrincipal,
} from "../shared.js";
import { track } from "../analytics.js";
import {
  loadRuntimeConfig,
  loadStoredBuyerPasskeyBundle,
  signBrowserPasskeyChallengeBase64Url,
  touchStoredBuyerPasskeyBundle,
  generateBrowserEd25519KeypairPem,
  saveStoredBuyerPasskeyBundle,
  updateTenantSettings,
} from "../api.js";

/* ===================================================================
   Auth styles
   =================================================================== */

const A = {
  wrap: { minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "2rem 1.5rem", background: "var(--bg-100, #faf9f6)", fontFamily: "var(--font-body, 'Plus Jakarta Sans', system-ui, sans-serif)", WebkitFontSmoothing: "antialiased" },
  inner: { width: "100%", maxWidth: 380, textAlign: "center" },
  heading: { fontSize: 28, fontWeight: 700, color: "var(--text-100, #111110)", marginBottom: "0.75rem", lineHeight: 1.15, letterSpacing: "-0.02em" },
  sub: { fontSize: 15, color: "var(--text-200, #4a4a45)", marginBottom: "2.5rem", lineHeight: 1.5 },
  input: { display: "block", width: "100%", padding: "14px 18px", fontSize: 15, background: "var(--bg-400, #ffffff)", border: "1px solid var(--border, #e5e3dd)", borderRadius: 10, color: "var(--text-100, #111110)", outline: "none", marginBottom: "1rem", fontFamily: "inherit", transition: "border-color 0.2s, box-shadow 0.2s", boxSizing: "border-box" },
  inputFocus: { borderColor: "var(--text-100, #111110)", boxShadow: "0 0 0 1px var(--text-100, #111110)" },
  otpInput: { display: "block", width: "100%", padding: "16px 18px", fontSize: "1.75rem", fontWeight: 700, letterSpacing: "0.5em", textAlign: "center", background: "var(--bg-400, #ffffff)", border: "1px solid var(--border, #e5e3dd)", borderRadius: 10, color: "var(--text-100, #111110)", outline: "none", marginBottom: "1.25rem", fontFamily: "var(--font-mono, monospace)", transition: "border-color 0.2s, box-shadow 0.2s", boxSizing: "border-box" },
  btn: { display: "flex", alignItems: "center", justifyContent: "center", width: "100%", padding: "14px 22px", fontSize: 15, fontWeight: 600, background: "var(--text-100, #111110)", color: "var(--bg-100, #faf9f6)", border: "none", borderRadius: 10, cursor: "pointer", fontFamily: "inherit", transition: "opacity 0.15s, transform 0.1s", letterSpacing: "0.01em", marginTop: "0.5rem" },
  error: { fontSize: 14, color: "#c43a3a", marginBottom: "1rem", lineHeight: 1.4, background: "var(--red-bg, #c43a3a14)", border: "1px solid rgba(196,58,58,0.2)", borderRadius: 10, padding: "10px 16px", textAlign: "left" },
  divider: { display: "flex", alignItems: "center", gap: "1rem", margin: "1.5rem 0", color: "var(--text-300, #8a8a82)", fontSize: 13 },
  dividerLine: { flex: 1, height: 1, background: "var(--border, #e5e3dd)" },
  links: { display: "flex", justifyContent: "center", gap: "0.5rem", marginTop: "3rem", alignItems: "center" },
  link: { fontSize: 13, color: "var(--text-300, #8a8a82)", textDecoration: "none", cursor: "pointer", background: "none", border: "none", fontFamily: "inherit", padding: 0 },
  linkSep: { fontSize: 13, color: "var(--border, #e5e3dd)" },
  resend: { fontSize: 14, color: "var(--text-200, #4a4a45)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0, marginTop: "1.5rem", textAlign: "center", width: "100%", textDecoration: "underline", textUnderlineOffset: "2px" },
};

import { FocusInput } from "../components/shared.jsx";
function AuthInput(props) {
  return <FocusInput baseStyle={A.input} focusStyle={A.inputFocus} {...props} />;
}

function AuthView({ onAuth }) {
  const [step, setStep] = useState("form");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [isNewAccount, setIsNewAccount] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      // Handle Google OAuth callback
      const params = new URLSearchParams(window.location.search);
      const googleAuth = params.get("google_auth");
      const googleTenant = params.get("tenant");
      const googleError = params.get("message");
      if (googleAuth === "error" && googleError) {
        setError(googleError);
        window.history.replaceState({}, "", window.location.pathname);
        return;
      }
      if (googleAuth === "success" && googleTenant) {
        try {
          const principal = await fetchSessionPrincipal();
          if (principal?.ok) {
            saveRuntime({ ...loadRuntimeConfig(), tenantId: googleTenant });
            saveOnboardingState({ buyer: principal, sessionExpected: true, completed: true });
            if (principal.principal?.email) {
              localStorage.setItem("nooterra_user_name", principal.principal.email.split("@")[0]);
            }
            window.history.replaceState({}, "", window.location.pathname);
            track("user.logged_in", { method: "google" });
            onAuth?.("dashboard");
            return;
          }
        } catch { /* session not established */ }
        setError("Couldn't sign you in with Google. Please try again.");
        window.history.replaceState({}, "", window.location.pathname);
        return;
      }

      // Try passkey auto-login
      try {
        const stored = loadStoredBuyerPasskeyBundle({});
        if (!stored?.tenantId || !stored?.email) return;
        const tid = stored.tenantId; const em = stored.email;
        const optionsResp = await authRequest({ pathname: `/v1/tenants/${encodeURIComponent(tid)}/buyer/login/passkey/options`, body: { email: em } });
        if (optionsResp?.challenge && optionsResp?.challengeId) {
          const signature = await signBrowserPasskeyChallengeBase64Url({ privateKeyPem: stored.privateKeyPem, challenge: optionsResp.challenge });
          await authRequest({ pathname: `/v1/tenants/${encodeURIComponent(tid)}/buyer/login/passkey`, body: { challengeId: optionsResp.challengeId, challenge: optionsResp.challenge, credentialId: stored.credentialId, publicKeyPem: stored.publicKeyPem, signature } });
          touchStoredBuyerPasskeyBundle({ tenantId: tid, email: em });
          const principal = await fetchSessionPrincipal();
          saveRuntime({ ...loadRuntimeConfig(), tenantId: tid });
          saveOnboardingState({ buyer: principal, sessionExpected: true, completed: true });
          track("user.logged_in", { method: "passkey" });
          onAuth?.("dashboard");
        }
      } catch { /* no stored passkey or it failed */ }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleContinue(e) {
    e.preventDefault(); setError(""); setLoading(true);
    const em = email.trim();
    try {
      const result = await authRequest({ pathname: "/v1/public/signup", body: { email: em, company: em.split("@")[0] } });
      const tid = result?.tenantId;
      if (!tid) { setError("Couldn't sign you in. Check your email and try again."); setLoading(false); return; }
      setTenantId(tid);
      const storedPasskey = loadStoredBuyerPasskeyBundle({ tenantId: tid, email: em });
      if (storedPasskey) {
        try {
          const optionsResp = await authRequest({ pathname: `/v1/tenants/${encodeURIComponent(tid)}/buyer/login/passkey/options`, body: { email: em } });
          if (optionsResp?.challenge && optionsResp?.challengeId) {
            const signature = await signBrowserPasskeyChallengeBase64Url({ privateKeyPem: storedPasskey.privateKeyPem, challenge: optionsResp.challenge });
            await authRequest({ pathname: `/v1/tenants/${encodeURIComponent(tid)}/buyer/login/passkey`, body: { challengeId: optionsResp.challengeId, challenge: optionsResp.challenge, credentialId: storedPasskey.credentialId, publicKeyPem: storedPasskey.publicKeyPem, signature } });
            touchStoredBuyerPasskeyBundle({ tenantId: tid, email: em });
            const principal = await fetchSessionPrincipal();
            saveRuntime({ ...loadRuntimeConfig(), tenantId: tid });
            saveOnboardingState({ buyer: principal, sessionExpected: true, completed: true });
            track("user.logged_in", { method: "passkey" });
            onAuth?.("dashboard");
            return;
          }
        } catch { /* passkey failed, fall through to OTP */ }
      }
      const newAccount = !!result?.otpIssued;
      setIsNewAccount(newAccount);
      if (!newAccount) await authRequest({ pathname: `/v1/tenants/${encodeURIComponent(tid)}/buyer/login/otp`, body: { email: em } });
      setStep("otp");
    } catch (err) { setError(err?.message || "Couldn't sign you in. Check your email and try again."); }
    finally { setLoading(false); }
  }

  async function handleVerify(e) {
    e.preventDefault(); setError(""); setLoading(true);
    const tid = tenantId.trim(); const em = email.trim();
    try {
      await authRequest({ pathname: `/v1/tenants/${encodeURIComponent(tid)}/buyer/login`, body: { email: em, code: otpCode.trim() } });
      const principal = await fetchSessionPrincipal();
      const runtime = loadRuntimeConfig();
      saveRuntime({ ...runtime, tenantId: tid });
      saveOnboardingState({ buyer: principal, sessionExpected: true, completed: true });
      if (isNewAccount && fullName.trim()) {
        try {
          await updateTenantSettings({ ...runtime, tenantId: tid }, { displayName: fullName.trim(), callMe: fullName.trim().split(" ")[0] });
          localStorage.setItem("nooterra_user_name", fullName.trim());
        } catch { /* non-fatal */ }
      }
      try {
        const keypair = await generateBrowserEd25519KeypairPem();
        const optionsResp = await authRequest({ pathname: `/v1/tenants/${encodeURIComponent(tid)}/buyer/login/passkey/options`, body: { email: em, company: em.split("@")[0] } });
        if (optionsResp?.challenge && optionsResp?.challengeId) {
          const signature = await signBrowserPasskeyChallengeBase64Url({ privateKeyPem: keypair.privateKeyPem, challenge: optionsResp.challenge });
          await authRequest({ pathname: `/v1/tenants/${encodeURIComponent(tid)}/buyer/login/passkey`, body: { challengeId: optionsResp.challengeId, challenge: optionsResp.challenge, credentialId: keypair.keyId, publicKeyPem: keypair.publicKeyPem, signature, label: "Browser passkey" } });
          saveStoredBuyerPasskeyBundle({ tenantId: tid, email: em, credentialId: keypair.keyId, publicKeyPem: keypair.publicKeyPem, privateKeyPem: keypair.privateKeyPem, keyId: keypair.keyId, label: "Browser passkey", createdAt: new Date().toISOString() });
        }
      } catch { /* Passkey registration is optional */ }
      track("user.logged_in", { method: "otp" });
      onAuth?.(isNewAccount ? "builder" : "dashboard");
    } catch (err) { setError(err?.message || "Invalid code. Please try again."); }
    finally { setLoading(false); }
  }

  async function handleResend() {
    setError("");
    const em = email.trim(); const tid = tenantId.trim();
    try {
      if (isNewAccount) await authRequest({ pathname: "/v1/public/signup", body: { email: em, company: em.split("@")[0] } });
      else await authRequest({ pathname: `/v1/tenants/${encodeURIComponent(tid)}/buyer/login/otp`, body: { email: em } });
    } catch { /* ignore */ }
  }

  if (step === "otp") {
    return (
      <div style={A.wrap}>
        <div style={A.inner} className="lovable-fade">
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "3rem" }}>
            <img src="/nooterra-logo.png" alt="nooterra" style={{ height: 24 }} />
          </div>
          <h1 style={A.heading}>Enter your code</h1>
          <p style={A.sub}>We sent a verification code to <strong style={{ color: "#1a1a1a" }}>{email}</strong>.</p>
          {error && <div style={A.error}>{error}</div>}
          <form onSubmit={handleVerify}>
            <input
              type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
              value={otpCode} onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000" required autoFocus={!isNewAccount} aria-label="Verification code"
              style={{ ...A.otpInput, ...(otpCode.length === 6 ? { borderColor: "#1a1a1a" } : {}) }}
            />
            <button type="submit" style={{ ...A.btn, opacity: loading || otpCode.length < 6 ? 0.5 : 1 }} disabled={loading || otpCode.length < 6}>
              {loading ? "Verifying..." : "Verify"}
            </button>
          </form>
          <div style={{ textAlign: "center" }}>
            <button style={A.resend} onClick={handleResend}>Resend code</button>
          </div>
        </div>
      </div>
    );
  }

  const socialBtnStyle = { display: "flex", alignItems: "center", justifyContent: "center", gap: 10, width: "100%", padding: "13px 20px", fontSize: 15, fontWeight: 500, background: "var(--bg-400, #ffffff)", color: "var(--text-100, #111110)", border: "1px solid var(--border, #e5e3dd)", borderRadius: 10, cursor: "pointer", fontFamily: "inherit", transition: "background 0.15s, border-color 0.15s", marginBottom: "0.6rem" };
  return (
    <div style={A.wrap}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, padding: "1.5rem 1.5rem" }}>
        <img src="/nooterra-logo.png" alt="nooterra" style={{ height: 24 }} />
      </div>
      <div style={A.inner} className="lovable-fade">
        <h1 style={A.heading}>Log in or sign up</h1>
        <p style={A.sub}>Your AI team is one description away.</p>
        {error && <div style={A.error}>{error}</div>}
        <button style={socialBtnStyle} onClick={() => { window.location.href = `${AUTH_BASE}/v1/public/buyer/google/start?redirect=${encodeURIComponent(window.location.origin + "/signup")}`; }} onMouseOver={(e) => { e.currentTarget.style.background = "var(--bg-200, #f3f1ec)"; e.currentTarget.style.borderColor = "var(--border-strong, #d4d1c9)"; }} onMouseOut={(e) => { e.currentTarget.style.background = "var(--bg-400, #ffffff)"; e.currentTarget.style.borderColor = "var(--border, #e5e3dd)"; }}>
          <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
          Continue with Google
        </button>
        <div style={A.divider}><div style={A.dividerLine} /><span>OR</span><div style={A.dividerLine} /></div>
        <form onSubmit={handleContinue}>
          <AuthInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" required autoFocus />
          <button type="submit" style={{ ...A.btn, opacity: loading || !email.trim() ? 0.5 : 1 }} disabled={loading || !email.trim()}>
            {loading ? "One moment..." : "Continue"}
          </button>
        </form>
        <div style={A.links}>
          <a href="/terms" style={A.link}>Terms of Use</a>
          <span style={A.linkSep}>|</span>
          <a href="/privacy" style={A.link}>Privacy Policy</a>
        </div>
      </div>
    </div>
  );
}

export default AuthView;
