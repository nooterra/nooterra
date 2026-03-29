import React, { useState, useEffect } from "react";
import {
  S, WORK_FUNCTIONS, loadTheme, saveTheme, navigate, logoutSession, workerApiRequest,
  ONBOARDING_STORAGE_KEY, tierLabel, tierColor,
} from "../shared.js";
import {
  loadRuntimeConfig,
  PRODUCT_RUNTIME_STORAGE_KEY,
  fetchTenantSettings,
  updateTenantSettings,
} from "../api.js";

/* ===================================================================
   ToggleSwitch
   =================================================================== */

export function ToggleSwitch({ on, onToggle }) {
  return <button onClick={onToggle} style={{ width: 44, height: 24, borderRadius: 12, border: "none", cursor: "pointer", background: on ? "var(--accent)" : "var(--bg-hover)", position: "relative", flexShrink: 0, transition: "background 150ms" }}><div style={{ width: 18, height: 18, borderRadius: "50%", background: "white", position: "absolute", top: 3, left: on ? 23 : 3, transition: "left 150ms" }} /></button>;
}

/* ===================================================================
   FocusInput (local to settings)
   =================================================================== */

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

/* ===================================================================
   CloseIcon
   =================================================================== */

function CloseIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" style={{ display: "block" }}>
      <path d="M5 5l8 8M13 5l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/* ===================================================================
   ThemePreview
   =================================================================== */

function ThemePreview({ opt, selected, onClick }) {
  return (
    <button onClick={onClick} style={{ padding: "0.75rem", borderRadius: 10, cursor: "pointer", textAlign: "center", fontFamily: "inherit", transition: "border-color 150ms", flex: 1, border: selected ? "2px solid var(--accent)" : "2px solid var(--border)", background: selected ? "var(--gold-dim)" : "transparent" }}>
      {opt.key === "auto" ? (
        <div style={{ width: 80, height: 50, borderRadius: 8, margin: "0 auto 0.5rem", display: "flex", overflow: "hidden" }}>
          <div style={{ flex: 1, background: opt.bgLeft, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 4 }}><div style={{ width: "70%", height: 8, borderRadius: 2, background: opt.fgLeft }} /></div>
          <div style={{ flex: 1, background: opt.bgRight, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 4 }}><div style={{ width: "70%", height: 8, borderRadius: 2, background: opt.fgRight }} /></div>
        </div>
      ) : (
        <div style={{ width: 80, height: 50, borderRadius: 8, margin: "0 auto 0.5rem", background: opt.bg, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 6 }}><div style={{ width: "80%", height: 8, borderRadius: 2, background: opt.fg }} /></div>
      )}
      <div style={{ fontSize: "13px", fontWeight: 600, color: selected ? "var(--text-primary)" : "var(--text-secondary)" }}>{opt.label}</div>
    </button>
  );
}

/* ===================================================================
   SettingsModal
   =================================================================== */

function SettingsModal({ userEmail, userTier, creditBalance, onClose }) {
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState("");
  const [workFunction, setWorkFunction] = useState("founder");
  const [preferences, setPreferences] = useState("");
  const [saveState, setSaveState] = useState("idle");
  const [tab, setTab] = useState("general");
  const [theme, setTheme] = useState(() => loadTheme());
  const [font, setFont] = useState("default");
  const [defaultModel, setDefaultModel] = useState("nvidia/nemotron-3-super-120b-a12b:free");
  const [notifApproval, setNotifApproval] = useState(true);
  const [notifWeekly, setNotifWeekly] = useState(false);
  const [notifErrors, setNotifErrors] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [copiedAccountId, setCopiedAccountId] = useState(false);
  const [billingLoading, setBillingLoading] = useState(false);
  const [showCreditPicker, setShowCreditPicker] = useState(false);
  const runtime = loadRuntimeConfig();

  useEffect(() => {
    try { const stored = JSON.parse(localStorage.getItem("nooterra_settings") || "{}"); if (stored.displayName) setDisplayName(stored.displayName); if (stored.workFunction) setWorkFunction(stored.workFunction); if (stored.preferences) setPreferences(stored.preferences); if (stored.defaultModel) setDefaultModel(stored.defaultModel); } catch { /* ignore */ }
    (async () => { try { const result = await fetchTenantSettings(runtime); if (result?.displayName) setDisplayName(result.displayName); if (result?.name && !displayName) setDisplayName(result.name); } catch { /* ignore */ } setLoading(false); })();
  }, []);

  useEffect(() => { function handleKey(e) { if (e.key === "Escape") onClose(); } document.addEventListener("keydown", handleKey); return () => document.removeEventListener("keydown", handleKey); }, [onClose]);

  async function handleSave() {
    setSaveState("saving");
    try {
      const settingsData = { displayName: displayName.trim(), workFunction, preferences: preferences.trim(), defaultModel };
      localStorage.setItem("nooterra_settings", JSON.stringify(settingsData));
      if (displayName.trim()) localStorage.setItem("nooterra_user_name", displayName.trim());
      try { await updateTenantSettings(runtime, { displayName: displayName.trim() }); } catch { /* backend may reject */ }
      setSaveState("saved"); setTimeout(() => setSaveState("idle"), 2000);
    } catch (err) { console.error("Settings save failed:", err); setSaveState("error"); setTimeout(() => setSaveState("idle"), 2000); }
  }

  function handleThemeChange(t) { setTheme(t); saveTheme(t); }
  function handleCopyAccountId() { try { navigator.clipboard.writeText(runtime.tenantId); setCopiedAccountId(true); setTimeout(() => setCopiedAccountId(false), 1500); } catch { /* ignore */ } }

  async function handleBillingCheckout(payload) {
    setBillingLoading(true);
    try { const result = await workerApiRequest({ pathname: "/v1/billing/checkout", method: "POST", body: { ...payload, email: userEmail } }); if (result?.url) window.location.href = result.url; else { console.error("No checkout URL returned", result); setBillingLoading(false); } } catch (err) { console.error("Billing checkout failed:", err); setBillingLoading(false); }
  }

  // --- Notification preferences state ---
  const [notifEmailEnabled, setNotifEmailEnabled] = useState(false);
  const [notifEmailAddress, setNotifEmailAddress] = useState(userEmail || "");
  const [notifSlackEnabled, setNotifSlackEnabled] = useState(false);
  const [notifSlackWebhook, setNotifSlackWebhook] = useState("");
  const [notifSlackTesting, setNotifSlackTesting] = useState(false);
  const [notifSlackTestResult, setNotifSlackTestResult] = useState(null);
  const [notifSmsEnabled, setNotifSmsEnabled] = useState(false);
  const [notifSmsPhone, setNotifSmsPhone] = useState("");
  const [notifWhatsappEnabled, setNotifWhatsappEnabled] = useState(false);
  const [notifWhatsappPhone, setNotifWhatsappPhone] = useState("");
  const [notifTelegramEnabled, setNotifTelegramEnabled] = useState(false);
  const [notifTelegramChatId, setNotifTelegramChatId] = useState("");
  const [notifEvents, setNotifEvents] = useState({
    approvalRequired: true,
    workerCompleted: false,
    workerError: true,
    budgetAlert: true,
    securityAlert: true,
  });
  const [notifSaveState, setNotifSaveState] = useState("idle");

  // Load notification preferences on mount
  useEffect(() => {
    (async () => {
      try {
        const prefs = await workerApiRequest({ pathname: "/v1/notifications/preferences", method: "GET" });
        if (prefs) {
          if (prefs.emailEnabled != null) setNotifEmailEnabled(prefs.emailEnabled);
          if (prefs.emailAddress) setNotifEmailAddress(prefs.emailAddress);
          if (prefs.slackEnabled != null) setNotifSlackEnabled(prefs.slackEnabled);
          if (prefs.slackWebhookUrl) setNotifSlackWebhook(prefs.slackWebhookUrl);
          if (prefs.smsEnabled != null) setNotifSmsEnabled(prefs.smsEnabled);
          if (prefs.smsPhone) setNotifSmsPhone(prefs.smsPhone);
          if (prefs.whatsappEnabled != null) setNotifWhatsappEnabled(prefs.whatsappEnabled);
          if (prefs.whatsappPhone) setNotifWhatsappPhone(prefs.whatsappPhone);
          if (prefs.telegramEnabled != null) setNotifTelegramEnabled(prefs.telegramEnabled);
          if (prefs.telegramChatId) setNotifTelegramChatId(prefs.telegramChatId);
          if (prefs.events) setNotifEvents(prev => ({ ...prev, ...prefs.events }));
        }
      } catch { /* no prefs yet */ }
    })();
  }, []);

  async function handleNotifSave() {
    setNotifSaveState("saving");
    try {
      await workerApiRequest({
        pathname: "/v1/notifications/preferences",
        method: "PUT",
        body: {
          emailEnabled: notifEmailEnabled,
          emailAddress: notifEmailAddress.trim(),
          slackEnabled: notifSlackEnabled,
          slackWebhookUrl: notifSlackWebhook.trim(),
          smsEnabled: notifSmsEnabled,
          smsPhone: notifSmsPhone.trim(),
          whatsappEnabled: notifWhatsappEnabled,
          whatsappPhone: notifWhatsappPhone.trim(),
          telegramEnabled: notifTelegramEnabled,
          telegramChatId: notifTelegramChatId.trim(),
          events: notifEvents,
        },
      });
      setNotifSaveState("saved");
      setTimeout(() => setNotifSaveState("idle"), 2000);
    } catch (err) {
      console.error("Notification preferences save failed:", err);
      setNotifSaveState("error");
      setTimeout(() => setNotifSaveState("idle"), 2000);
    }
  }

  async function handleSlackTest() {
    setNotifSlackTesting(true);
    setNotifSlackTestResult(null);
    try {
      const result = await workerApiRequest({
        pathname: "/v1/notifications/test-slack",
        method: "POST",
        body: { webhookUrl: notifSlackWebhook.trim() },
      });
      setNotifSlackTestResult(result?.ok ? "success" : "error");
    } catch {
      setNotifSlackTestResult("error");
    }
    setNotifSlackTesting(false);
    setTimeout(() => setNotifSlackTestResult(null), 3000);
  }

  function toggleNotifEvent(key) {
    setNotifEvents(prev => ({ ...prev, [key]: !prev[key] }));
  }

  const sidebarTabs = [{ key: "general", label: "General" }, { key: "notifications", label: "Notifications" }, { key: "billing", label: "Billing" }, { key: "account", label: "Account" }];
  const themes = [{ key: "light", label: "Light", bg: "#FAF9F5", fg: "#EBE8E0" }, { key: "auto", label: "Auto", bgLeft: "#FAF9F5", bgRight: "#212121", fgLeft: "#EBE8E0", fgRight: "#2f2f2f" }, { key: "dark", label: "Dark", bg: "#212121", fg: "#2f2f2f" }];
  const fonts = [{ key: "default", label: "Default" }, { key: "sans", label: "Sans" }, { key: "mono", label: "Mono" }];

  function SaveButton({ label = "Save" }) {
    const isSaved = saveState === "saved"; const isSaving = saveState === "saving"; const isError = saveState === "error";
    return <button style={{ ...S.btnPrimary, width: "auto", padding: "8px 20px", fontSize: "14px", opacity: isSaving ? 0.6 : 1, background: isSaved ? "#5bb98c" : isError ? "#c97055" : "var(--text-100)", transition: "background 300ms, opacity 150ms, transform 150ms", transform: isSaved ? "scale(1.02)" : "scale(1)" }} disabled={isSaving} onClick={handleSave}>{isSaving ? "Saving..." : isSaved ? "\u2713 Saved" : isError ? "Failed -- try again" : label}</button>;
  }

  const currentTier = userTier || "free";
  const balance = creditBalance != null ? (creditBalance / 100).toFixed(2) : "0.00";

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-content" style={{ width: "100%", maxWidth: 720, maxHeight: "85vh", background: "var(--bg-surface)", borderRadius: 16, boxShadow: "var(--shadow-lg)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px 16px", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>Settings</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)", padding: 4, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", transition: "background 150ms" }}
            onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-hover)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "none"; }}
          ><CloseIcon /></button>
        </div>
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          <div style={{ width: 180, flexShrink: 0, borderRight: "1px solid var(--border)", padding: "16px 0", overflowY: "auto" }}>
            {sidebarTabs.map(s => (
              <button key={s.key} onClick={() => setTab(s.key)} style={{ display: "block", width: "100%", padding: "8px 20px", fontSize: "14px", fontWeight: tab === s.key ? 600 : 400, color: tab === s.key ? "var(--text-primary)" : "var(--text-secondary)", background: tab === s.key ? "var(--bg-hover)" : "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left", transition: "background 150ms, color 150ms", borderLeft: tab === s.key ? "2px solid var(--accent)" : "2px solid transparent" }}
                onMouseEnter={e => { if (tab !== s.key) e.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={e => { if (tab !== s.key) e.currentTarget.style.background = "transparent"; }}
              >{s.label}</button>
            ))}
          </div>
          <div style={{ flex: 1, padding: "24px", overflowY: "auto" }}>
            {loading ? <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Loading...</div> : (<>
              {tab === "general" && (<div>
                <div style={{ marginBottom: "2rem" }}>
                  <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "1.25rem" }}>Profile</div>
                  <label style={S.label}>Display name</label>
                  <FocusInput type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" />
                  <label style={S.label}>Work function</label>
                  <select value={workFunction} onChange={(e) => setWorkFunction(e.target.value)} style={{ ...S.input, cursor: "pointer", appearance: "auto" }}>{WORK_FUNCTIONS.map(wf => <option key={wf.value} value={wf.value}>{wf.label}</option>)}</select>
                </div>
                <div style={{ marginBottom: "2rem" }}>
                  <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "0.5rem" }}>Preferences</div>
                  <p style={{ fontSize: "13px", color: "var(--text-tertiary)", marginTop: 0, marginBottom: "0.75rem" }}>What preferences should workers consider?</p>
                  <textarea value={preferences} onChange={(e) => setPreferences(e.target.value)} placeholder="e.g. Always use formal language. Prefer bullet points over paragraphs." style={{ ...S.textarea, minHeight: 80 }} />
                </div>
                <div style={{ marginBottom: "2rem" }}>
                  <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "0.5rem" }}>Appearance</div>
                  <p style={{ fontSize: "13px", color: "var(--text-tertiary)", marginTop: 0, marginBottom: "1rem" }}>Choose how Nooterra looks.</p>
                  <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.5rem" }}>{themes.map(opt => <ThemePreview key={opt.key} opt={opt} selected={theme === opt.key} onClick={() => handleThemeChange(opt.key)} />)}</div>
                  <label style={S.label}>Font</label>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    {fonts.map(f => <button key={f.key} onClick={() => setFont(f.key)} style={{ padding: "6px 16px", fontSize: "13px", fontWeight: 500, borderRadius: 6, border: font === f.key ? "1px solid var(--accent)" : "1px solid var(--border)", background: font === f.key ? "var(--gold-dim)" : "transparent", color: font === f.key ? "var(--text-primary)" : "var(--text-secondary)", cursor: "pointer", fontFamily: f.key === "mono" ? "monospace" : f.key === "sans" ? "sans-serif" : "inherit", transition: "all 150ms" }}>{f.label}</button>)}
                  </div>
                </div>
                <SaveButton />
              </div>)}
              {tab === "notifications" && (<div>
                <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "0.5rem" }}>Notification channels</div>
                <p style={{ fontSize: "13px", color: "var(--text-tertiary)", marginTop: 0, marginBottom: "1.5rem" }}>Choose how you want to be notified about worker activity.</p>

                {[
                  { key: "email", label: "Email", desc: "Get notifications delivered to your inbox", enabled: notifEmailEnabled, onToggle: () => setNotifEmailEnabled(!notifEmailEnabled) },
                  { key: "slack", label: "Slack", desc: "Get notifications in a Slack channel", enabled: notifSlackEnabled, onToggle: () => setNotifSlackEnabled(!notifSlackEnabled) },
                  { key: "sms", label: "SMS", desc: "Text message alerts", enabled: notifSmsEnabled, onToggle: () => setNotifSmsEnabled(!notifSmsEnabled) },
                  { key: "whatsapp", label: "WhatsApp", desc: "WhatsApp message alerts", enabled: notifWhatsappEnabled, onToggle: () => setNotifWhatsappEnabled(!notifWhatsappEnabled) },
                  { key: "telegram", label: "Telegram", desc: "Telegram bot alerts", enabled: notifTelegramEnabled, onToggle: () => setNotifTelegramEnabled(!notifTelegramEnabled) },
                  { key: "dashboard", label: "Dashboard", desc: "See notifications in your Nooterra dashboard", enabled: true, onToggle: () => {} },
                ].map((ch) => (
                  <div key={ch.key}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0", borderBottom: "1px solid var(--border)" }}>
                      <div>
                        <div style={{ fontSize: "14px", color: "var(--text-primary)", fontWeight: 500 }}>{ch.label}</div>
                        <div style={{ fontSize: "13px", color: "var(--text-tertiary)", marginTop: 2 }}>{ch.desc}</div>
                      </div>
                      <ToggleSwitch on={ch.enabled} onToggle={ch.onToggle} />
                    </div>
                    {ch.key === "sms" && notifSmsEnabled && (
                      <div style={{ padding: "8px 0 16px" }}>
                        <FocusInput value={notifSmsPhone} onChange={e => setNotifSmsPhone(e.target.value)} placeholder="+1 555 123 4567" style={{ marginBottom: 0 }} />
                      </div>
                    )}
                    {ch.key === "whatsapp" && notifWhatsappEnabled && (
                      <div style={{ padding: "8px 0 16px" }}>
                        <FocusInput value={notifWhatsappPhone} onChange={e => setNotifWhatsappPhone(e.target.value)} placeholder="+1 555 123 4567" style={{ marginBottom: 0 }} />
                      </div>
                    )}
                    {ch.key === "telegram" && notifTelegramEnabled && (
                      <div style={{ padding: "8px 0 16px" }}>
                        <FocusInput value={notifTelegramChatId} onChange={e => setNotifTelegramChatId(e.target.value)} placeholder="Chat ID (e.g. 123456789)" style={{ marginBottom: 0 }} />
                      </div>
                    )}
                  </div>
                ))}

                <div style={{ marginTop: "2rem", marginBottom: "1rem" }}>
                  <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "0.5rem" }}>Events</div>
                  <p style={{ fontSize: "13px", color: "var(--text-tertiary)", marginTop: 0, marginBottom: "1rem" }}>Choose which events trigger notifications.</p>
                </div>
                {[
                  { key: "approvalRequired", label: "Approval needed", desc: "Worker is waiting for your approval" },
                  { key: "workerCompleted", label: "Run completed", desc: "A scheduled run finished" },
                  { key: "workerError", label: "Run failed", desc: "Something went wrong during execution" },
                  { key: "budgetAlert", label: "Low credits", desc: "Credits are running low" },
                  { key: "securityAlert", label: "Security alert", desc: "Anomaly or policy violation detected" },
                ].map((evt) => (
                  <div key={evt.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
                    <div>
                      <div style={{ fontSize: "14px", color: "var(--text-primary)", fontWeight: 500 }}>{evt.label}</div>
                      <div style={{ fontSize: "12px", color: "var(--text-tertiary)", marginTop: 2 }}>{evt.desc}</div>
                    </div>
                    <ToggleSwitch on={notifEvents[evt.key]} onToggle={() => toggleNotifEvent(evt.key)} />
                  </div>
                ))}

                <div style={{ marginTop: "1.5rem" }}>
                  <button style={{ ...S.btnPrimary, width: "auto", padding: "8px 20px", fontSize: "14px", opacity: notifSaveState === "saving" ? 0.6 : 1, background: notifSaveState === "saved" ? "#5bb98c" : notifSaveState === "error" ? "#c97055" : "var(--text-100)", transition: "background 300ms" }} disabled={notifSaveState === "saving"} onClick={handleNotifSave}>{notifSaveState === "saving" ? "Saving..." : notifSaveState === "saved" ? "\u2713 Saved" : "Save"}</button>
                </div>
              </div>)}
              {tab === "account" && (<div>
                <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "1.25rem" }}>Account</div>
                <label style={S.label}>Email</label>
                <div style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "1.5rem" }}>{userEmail || "Not available"}</div>
                <label style={S.label}>Account ID</label>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "1.5rem" }}>
                  <div style={{ fontSize: "13px", color: "var(--text-tertiary)", fontVariantNumeric: "tabular-nums", fontFamily: "monospace" }}>{runtime.tenantId}</div>
                  <button onClick={handleCopyAccountId} style={{ fontSize: "12px", padding: "2px 8px", borderRadius: 4, border: "1px solid var(--border)", background: copiedAccountId ? "#5bb98c" : "transparent", color: copiedAccountId ? "white" : "var(--text-tertiary)", cursor: "pointer", fontFamily: "inherit", transition: "all 150ms" }}>{copiedAccountId ? "Copied" : "Copy"}</button>
                </div>
                <div style={{ borderTop: "1px solid var(--border)", margin: "2rem 0" }} />
                <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "1rem" }}>Active sessions</div>
                <div style={{ padding: "1rem", border: "1px solid var(--border)", borderRadius: 8, marginBottom: "1rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div><div style={{ fontSize: "14px", fontWeight: 500, color: "var(--text-primary)" }}>This browser</div><div style={{ fontSize: "13px", color: "var(--text-tertiary)" }}>Current session</div></div>
                    <div style={{ fontSize: "12px", color: "#5bb98c", fontWeight: 600 }}>Active</div>
                  </div>
                </div>
                <button style={{ ...S.btnSecondary, fontSize: "13px", padding: "0.5rem 1rem" }} onClick={async () => { await logoutSession(); navigate("/login"); }}>Log out of all devices</button>
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
              {tab === "billing" && (<div>
                <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "1.25rem" }}>Billing</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderRadius: 10, border: "1px solid var(--border)", marginBottom: "1.5rem" }}>
                  <div>
                    <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>{tierLabel(currentTier)} plan</div>
                    <div style={{ fontSize: "13px", color: "var(--text-tertiary)", marginTop: 2 }}>Credits: ${balance}</div>
                  </div>
                  {currentTier === "free" && <button style={{ ...S.btnSecondary, width: "auto", padding: "6px 16px", fontSize: "13px", opacity: billingLoading ? 0.6 : 1 }} disabled={billingLoading} onClick={() => handleBillingCheckout({ plan: "pro" })}>{billingLoading ? "..." : "Upgrade"}</button>}
                </div>
                <label style={S.label}>Credits</label>
                <div style={{ display: "flex", gap: 8, marginBottom: "1.5rem", flexWrap: "wrap" }}>
                  {[{ amount: 500, label: "$5" }, { amount: 2000, label: "$20" }, { amount: 5000, label: "$50" }].map(c => (
                    <button key={c.amount} style={{ ...S.btnSecondary, width: "auto", padding: "6px 16px", fontSize: "13px" }} onClick={() => handleBillingCheckout({ type: "credits", amount: c.amount })}>Add {c.label}</button>
                  ))}
                </div>
                {currentTier !== "free" && (<><div style={{ borderTop: "1px solid var(--border)", margin: "1.5rem 0" }} /><button style={{ ...S.btnGhost, color: "var(--text-tertiary)", fontSize: "13px" }}>Cancel plan</button></>)}
              </div>)}
            </>)}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsModal;
