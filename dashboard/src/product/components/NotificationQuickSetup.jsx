import React, { useState, useEffect } from "react";
import { workerApiRequest } from "../shared.js";
import { ToggleSwitch } from "./SettingsModal.jsx";

/* ===================================================================
   NotificationQuickSetup
   Inline notification setup that appears after worker creation.
   Compact, dismissible, saves to tenant notification preferences.
   =================================================================== */

const STORAGE_KEY = "nooterra_notif_setup_dismissed";

export default function NotificationQuickSetup({ workerId, addToast }) {
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === "true"; } catch { return false; }
  });
  const [loading, setLoading] = useState(true);
  const [alreadyConfigured, setAlreadyConfigured] = useState(false);
  const [saving, setSaving] = useState(false);

  // Channel states
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [emailAddress, setEmailAddress] = useState("");
  const [slackEnabled, setSlackEnabled] = useState(false);
  const [slackWebhook, setSlackWebhook] = useState("");

  // Load existing prefs
  useEffect(() => {
    (async () => {
      try {
        const prefs = await workerApiRequest({ pathname: "/v1/notifications/preferences", method: "GET" });
        if (prefs) {
          if (prefs.emailEnabled != null) setEmailEnabled(prefs.emailEnabled);
          if (prefs.emailAddress) setEmailAddress(prefs.emailAddress);
          if (prefs.slackEnabled != null) setSlackEnabled(prefs.slackEnabled);
          if (prefs.slackWebhookUrl) setSlackWebhook(prefs.slackWebhookUrl);
          // Already configured if at least one channel beyond dashboard is on
          if (prefs.emailEnabled || prefs.slackEnabled || prefs.smsEnabled || prefs.whatsappEnabled || prefs.telegramEnabled) {
            setAlreadyConfigured(true);
          }
        }
      } catch { /* no prefs yet */ }
      setLoading(false);
    })();
  }, []);

  if (dismissed || loading) return null;

  // Already configured — show compact confirmation
  if (alreadyConfigured) {
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "12px 18px", marginBottom: "1.5rem",
        background: "var(--product-accent-soft, rgba(31, 104, 92, 0.12))",
        borderLeft: "2px solid var(--product-accent, #1f685c)",
        borderRadius: "var(--product-radius-md, 16px)",
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--product-accent, #1f685c)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        <span style={{ fontSize: "14px", fontFamily: "'Public Sans', var(--font-body, sans-serif)", color: "var(--product-accent, #1f685c)", fontWeight: 600 }}>
          Notifications active
        </span>
        <button
          onClick={() => { setDismissed(true); try { localStorage.setItem(STORAGE_KEY, "true"); } catch {} }}
          aria-label="Dismiss"
          style={{
            marginLeft: "auto", background: "none", border: "none", cursor: "pointer",
            color: "var(--product-ink-soft, #707b8d)", fontSize: "16px", padding: "0 2px",
            lineHeight: 1, opacity: 0.6,
          }}
        >&times;</button>
      </div>
    );
  }

  async function handleSave() {
    setSaving(true);
    try {
      await workerApiRequest({
        pathname: "/v1/notifications/preferences",
        method: "PUT",
        body: {
          emailEnabled,
          emailAddress: emailAddress.trim(),
          slackEnabled,
          slackWebhookUrl: slackWebhook.trim(),
        },
      });
      if (addToast) addToast({ message: "Notification preferences saved", type: "success" });
      setDismissed(true);
      try { localStorage.setItem(STORAGE_KEY, "true"); } catch {}
    } catch (err) {
      if (addToast) addToast({ message: "Failed to save notifications", type: "error" });
    }
    setSaving(false);
  }

  function handleDismiss() {
    setDismissed(true);
    try { localStorage.setItem(STORAGE_KEY, "true"); } catch {}
  }

  return (
    <div style={{
      padding: "14px 18px",
      marginBottom: "1.5rem",
      background: "var(--product-accent-soft, rgba(31, 104, 92, 0.12))",
      borderLeft: "2px solid var(--product-accent, #1f685c)",
      borderRadius: "var(--product-radius-md, 16px)",
      fontFamily: "'Public Sans', var(--font-body, sans-serif)",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        {/* Left: prompt text */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--product-accent, #1f685c)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
            Get notified when this worker needs you
          </span>
        </div>

        {/* Right: action buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: "6px 16px", fontSize: "13px", fontWeight: 600,
              background: "var(--product-accent, #1f685c)", color: "#fff",
              border: "none", borderRadius: 8, cursor: saving ? "default" : "pointer",
              fontFamily: "inherit", opacity: saving ? 0.6 : 1,
              transition: "opacity 150ms",
            }}
          >
            {saving ? "Saving..." : "Done"}
          </button>
          <button
            onClick={handleDismiss}
            aria-label="Dismiss notification setup"
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "var(--product-ink-soft, #707b8d)", fontSize: "18px",
              padding: "0 4px", lineHeight: 1, opacity: 0.6,
            }}
          >&times;</button>
        </div>
      </div>

      {/* Channel toggles */}
      <div style={{ display: "flex", gap: 24, marginTop: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
        {/* Dashboard — always on */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--product-accent, #1f685c)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--text-primary)" }}>Dashboard</span>
        </div>

        {/* Email toggle */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ToggleSwitch on={emailEnabled} onToggle={() => setEmailEnabled(!emailEnabled)} aria-label="Enable email notifications" />
            <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--text-primary)" }}>Email</span>
          </div>
          <div style={{
            maxHeight: emailEnabled ? 40 : 0,
            overflow: "hidden",
            transition: "max-height 200ms ease-out",
          }}>
            <input
              type="email"
              value={emailAddress}
              onChange={e => setEmailAddress(e.target.value)}
              placeholder="you@company.com"
              style={{
                width: 200, padding: "5px 10px", fontSize: "13px",
                border: "1px solid var(--border)", borderRadius: 6,
                background: "var(--bg-surface, var(--bg-100))",
                color: "var(--text-primary)", fontFamily: "inherit",
                outline: "none",
              }}
            />
          </div>
        </div>

        {/* Slack toggle */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ToggleSwitch on={slackEnabled} onToggle={() => setSlackEnabled(!slackEnabled)} aria-label="Enable Slack notifications" />
            <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--text-primary)" }}>Slack</span>
          </div>
          <div style={{
            maxHeight: slackEnabled ? 40 : 0,
            overflow: "hidden",
            transition: "max-height 200ms ease-out",
          }}>
            <input
              type="url"
              value={slackWebhook}
              onChange={e => setSlackWebhook(e.target.value)}
              placeholder="https://hooks.slack.com/..."
              style={{
                width: 240, padding: "5px 10px", fontSize: "13px",
                border: "1px solid var(--border)", borderRadius: 6,
                background: "var(--bg-surface, var(--bg-100))",
                color: "var(--text-primary)", fontFamily: "inherit",
                outline: "none",
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
