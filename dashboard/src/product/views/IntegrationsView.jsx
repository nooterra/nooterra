import React, { useState, useEffect } from "react";
import { S, WORKER_API_BASE, workerApiRequest } from "../shared.js";
import { loadRuntimeConfig } from "../api.js";
import { ToggleSwitch } from "../components/SettingsModal.jsx";

/* ===================================================================
   FocusInput (local)
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
   AVAILABLE_INTEGRATIONS
   =================================================================== */

export const AVAILABLE_INTEGRATIONS = [
  { key: "gmail", name: "Gmail", description: "Read and send emails", authType: "oauth", oauthUrl: "/v1/integrations/gmail/authorize" },
  { key: "slack", name: "Slack", description: "Send messages and get approvals", authType: "webhook", fieldLabel: "Webhook URL", fieldPlaceholder: "https://hooks.slack.com/services/..." },
  { key: "github", name: "GitHub", description: "Repos, issues, PRs", authType: "oauth", oauthUrl: "/v1/integrations/github/authorize" },
  { key: "google_calendar", name: "Google Calendar", description: "Schedule and manage events", authType: "oauth", oauthUrl: "/v1/integrations/google-calendar/authorize" },
  { key: "stripe", name: "Stripe", description: "Payment and billing data", authType: "apikey", fieldLabel: "API Key", fieldPlaceholder: "sk_live_..." },
  { key: "notion", name: "Notion", description: "Notes and databases", authType: "oauth", oauthUrl: "/v1/integrations/notion/authorize" },
  { key: "linear", name: "Linear", description: "Issue tracking", authType: "apikey", fieldLabel: "API Key", fieldPlaceholder: "lin_api_..." },
  { key: "custom_webhook", name: "Custom Webhook", description: "Any HTTP endpoint", authType: "webhook", fieldLabel: "URL", fieldPlaceholder: "https://example.com/webhook", hasSecret: true },
];

/* ===================================================================
   IntegrationConnectModal
   =================================================================== */

export function IntegrationConnectModal({ integration, onClose, onSave }) {
  const [value, setValue] = useState("");
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    if (!value.trim()) { setError("This field is required."); return; }
    setSaving(true);
    setError("");
    try {
      const body = { service: integration.key, config: { [integration.authType === "apikey" ? "apiKey" : "webhookUrl"]: value.trim() } };
      if (integration.hasSecret && secret.trim()) body.config.secret = secret.trim();
      await workerApiRequest({ pathname: "/v1/integrations", method: "POST", body });
      onSave();
    } catch (err) {
      setError(err?.message || "Failed to save integration.");
    }
    setSaving(false);
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)" }} onClick={onClose} />
      <div className="popover-animate" style={{ position: "relative", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 16, padding: "2rem", width: "100%", maxWidth: 420, boxShadow: "var(--shadow-lg)" }}>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: "0.3rem" }}>Connect {integration.name}</h2>
        <p style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "1.5rem" }}>{integration.description}</p>
        {error && <div style={S.error}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label style={S.label}>{integration.fieldLabel}</label>
          <FocusInput type="text" value={value} onChange={e => setValue(e.target.value)} placeholder={integration.fieldPlaceholder} />
          {integration.hasSecret && (<>
            <label style={S.label}>Secret (optional)</label>
            <FocusInput type="text" value={secret} onChange={e => setSecret(e.target.value)} placeholder="Signing secret" />
          </>)}
          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
            <button type="button" style={S.btnSecondary} onClick={onClose}>Cancel</button>
            <button type="submit" style={{ ...S.btnPrimary, width: "auto", opacity: saving ? 0.5 : 1 }} disabled={saving}>{saving ? "Saving..." : "Connect"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ===================================================================
   IntegrationsView
   =================================================================== */

function IntegrationsView() {
  const [connected, setConnected] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connectModal, setConnectModal] = useState(null);
  const [disconnecting, setDisconnecting] = useState(null);

  async function loadIntegrations() {
    try {
      const result = await workerApiRequest({ pathname: "/v1/integrations", method: "GET" });
      setConnected(result?.items || result || []);
    } catch { setConnected([]); }
    setLoading(false);
  }

  useEffect(() => { loadIntegrations(); }, []);

  function isConnected(serviceKey) {
    return connected.find(c => c.service === serviceKey || c.key === serviceKey);
  }

  async function handleConnect(integration) {
    if (integration.authType === "oauth") {
      const runtime = loadRuntimeConfig();
      const tenantId = runtime?.tenantId || "";
      window.location.href = WORKER_API_BASE + integration.oauthUrl + "?tenantId=" + encodeURIComponent(tenantId);
      return;
    }
    setConnectModal(integration);
  }

  async function handleDisconnect(serviceKey) {
    const entry = isConnected(serviceKey);
    if (!entry) return;
    setDisconnecting(serviceKey);
    try {
      await workerApiRequest({ pathname: `/v1/integrations/${encodeURIComponent(entry.id)}`, method: "DELETE" });
      await loadIntegrations();
    } catch { /* ignore */ }
    setDisconnecting(null);
  }

  return (
    <div>
      <h1 style={S.pageTitle}>Integrations</h1>
      <p style={S.pageSub}>Connect services your workers can use to get work done.</p>
      {loading ? (
        <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Loading...</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem" }}>
          {AVAILABLE_INTEGRATIONS.map(integration => {
            const conn = isConnected(integration.key);
            return (
              <div key={integration.key} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 24, background: "var(--bg-surface)", transition: "border-color 150ms" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)" }}>{integration.name}</div>
                </div>
                <div style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: 16, lineHeight: 1.5 }}>{integration.description}</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={S.statusDot(conn ? "#5bb98c" : "var(--text-tertiary)")} />
                    <span style={{ fontSize: "13px", color: conn ? "#5bb98c" : "var(--text-tertiary)", fontWeight: 500 }}>{conn ? "Connected" : "Not connected"}</span>
                  </div>
                  {conn ? (
                    <button
                      style={{ ...S.btnSecondary, padding: "6px 14px", fontSize: "13px", opacity: disconnecting === integration.key ? 0.5 : 1 }}
                      disabled={disconnecting === integration.key}
                      onClick={() => handleDisconnect(integration.key)}
                    >{disconnecting === integration.key ? "..." : "Disconnect"}</button>
                  ) : (
                    <button
                      style={{ ...S.btnPrimary, width: "auto", padding: "6px 14px", fontSize: "13px" }}
                      onClick={() => handleConnect(integration)}
                    >Connect</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {connectModal && (
        <IntegrationConnectModal
          integration={connectModal}
          onClose={() => setConnectModal(null)}
          onSave={() => { setConnectModal(null); loadIntegrations(); }}
        />
      )}
    </div>
  );
}

/* ===================================================================
   WorkerIntegrationsSection
   =================================================================== */

export function WorkerIntegrationsSection({ workerId }) {
  const [connected, setConnected] = useState([]);
  const [workerIntegrations, setWorkerIntegrations] = useState({});
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [allResult, workerResult] = await Promise.all([
          workerApiRequest({ pathname: "/v1/integrations", method: "GET" }),
          workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}/integrations`, method: "GET" }),
        ]);
        const allItems = allResult?.items || allResult || [];
        setConnected(allItems);
        const wItems = workerResult?.items || workerResult || [];
        const map = {};
        wItems.forEach(wi => { map[wi.service || wi.key || wi.integrationId] = true; });
        setWorkerIntegrations(map);
      } catch { setConnected([]); setWorkerIntegrations({}); }
      setLoading(false);
    })();
  }, [workerId]);

  async function handleToggle(integration) {
    const serviceKey = integration.service || integration.key;
    const currentlyEnabled = !!workerIntegrations[serviceKey];
    setToggling(serviceKey);
    try {
      if (currentlyEnabled) {
        await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}/integrations/${encodeURIComponent(serviceKey)}`, method: "DELETE" });
      } else {
        await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}/integrations`, method: "POST", body: { service: serviceKey, integrationId: integration.id } });
      }
      setWorkerIntegrations(prev => ({ ...prev, [serviceKey]: !currentlyEnabled }));
    } catch { /* ignore */ }
    setToggling(null);
  }

  if (loading) return <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Loading integrations...</div>;
  if (connected.length === 0) return <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>No integrations connected yet. Go to Integrations to connect services.</div>;

  return (
    <div>
      <p style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "1rem" }}>Choose which connected integrations this worker can access.</p>
      {connected.map(integration => {
        const serviceKey = integration.service || integration.key;
        const info = AVAILABLE_INTEGRATIONS.find(a => a.key === serviceKey);
        const enabled = !!workerIntegrations[serviceKey];
        return (
          <div key={serviceKey} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.75rem 0", borderBottom: "1px solid var(--border)" }}>
            <div>
              <div style={{ fontSize: "14px", fontWeight: 500, color: "var(--text-primary)" }}>{info?.name || serviceKey}</div>
              <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>{info?.description || ""}</div>
            </div>
            <ToggleSwitch on={enabled} onToggle={() => { if (toggling !== serviceKey) handleToggle(integration); }} />
          </div>
        );
      })}
    </div>
  );
}

export default IntegrationsView;
