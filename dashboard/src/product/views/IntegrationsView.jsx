import React, { useState, useEffect } from "react";
import { S, WORKER_API_BASE, workerApiRequest } from "../shared.js";
import { loadRuntimeConfig } from "../api.js";
import { ToggleSwitch } from "../components/SettingsModal.jsx";

import { FocusInput } from "../components/shared.jsx";
import FocusTrap from "../components/FocusTrap.jsx";

/* ===================================================================
   AI_PROVIDERS
   =================================================================== */

export const AI_PROVIDERS = [
  { key: "openai", name: "OpenAI", description: "GPT-4o, GPT-4 Turbo, GPT-4o mini", authType: "apikey", fieldLabel: "API Key", fieldPlaceholder: "sk-...", validateEndpoint: "/v1/providers/openai/validate" },
  { key: "anthropic", name: "Anthropic", description: "Claude Opus, Sonnet, Haiku", authType: "apikey", fieldLabel: "API Key", fieldPlaceholder: "sk-ant-...", validateEndpoint: "/v1/providers/anthropic/validate" },
];

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
    if ((integration.id === 'slack' || integration.key === 'slack') && value && !value.startsWith('https://hooks.slack.com/')) {
      setError('Slack webhook URLs must start with https://hooks.slack.com/');
      return;
    }
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
    <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)" }} onClick={onClose} />
      <FocusTrap><div className="popover-animate" style={{ position: "relative", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 16, padding: "2rem", width: "100%", maxWidth: 420, boxShadow: "var(--shadow-lg)" }}>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: "0.3rem" }}>Connect {integration.name}</h2>
        <p style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "1.5rem" }}>{integration.description}</p>
        {error && <div style={S.error}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label htmlFor="integration-field" style={S.label}>{integration.fieldLabel}</label>
          <FocusInput id="integration-field" type="text" value={value} onChange={e => setValue(e.target.value)} placeholder={integration.fieldPlaceholder} />
          {integration.hasSecret && (<>
            <label htmlFor="integration-secret" style={S.label}>Secret (optional)</label>
            <FocusInput id="integration-secret" type="text" value={secret} onChange={e => setSecret(e.target.value)} placeholder="Signing secret" />
          </>)}
          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
            <button type="button" style={S.btnSecondary} onClick={onClose}>Cancel</button>
            <button type="submit" style={{ ...S.btnPrimary, width: "auto", opacity: saving ? 0.5 : 1 }} disabled={saving}>{saving ? "Saving..." : "Connect"}</button>
          </div>
        </form>
      </div></FocusTrap>
    </div>
  );
}

/* ===================================================================
   ProviderConnectModal
   =================================================================== */

function ProviderConnectModal({ provider, onClose, onSave }) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    if (!value.trim()) { setError("This field is required."); return; }
    setValidating(true);
    setError("");
    try {
      // Validate the key first
      const validation = await workerApiRequest({ pathname: provider.validateEndpoint, method: "POST", body: { apiKey: value.trim() } });
      if (!validation?.ok) { setError("Key validation failed. Please check your API key."); setValidating(false); return; }
      setValidating(false);
      setSaving(true);
      // Store the key
      await workerApiRequest({ pathname: "/v1/providers", method: "POST", body: { provider: provider.key, apiKey: value.trim() } });
      onSave(validation);
    } catch (err) {
      setError(err?.message || "Failed to validate key. Check that your API key is correct.");
    }
    setValidating(false);
    setSaving(false);
  }

  const btnLabel = validating ? "Validating..." : saving ? "Saving..." : "Connect";

  return (
    <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)" }} onClick={onClose} />
      <FocusTrap><div className="popover-animate" style={{ position: "relative", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 16, padding: "2rem", width: "100%", maxWidth: 420, boxShadow: "var(--shadow-lg)" }}>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: "0.3rem" }}>Connect {provider.name}</h2>
        <p style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "1.5rem" }}>{provider.description}</p>
        {error && <div style={S.error}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <label htmlFor="provider-key-field" style={S.label}>{provider.fieldLabel}</label>
          <FocusInput id="provider-key-field" type="password" value={value} onChange={e => setValue(e.target.value)} placeholder={provider.fieldPlaceholder} />
          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
            <button type="button" style={S.btnSecondary} onClick={onClose}>Cancel</button>
            <button type="submit" style={{ ...S.btnPrimary, width: "auto", opacity: (saving || validating) ? 0.5 : 1 }} disabled={saving || validating}>{btnLabel}</button>
          </div>
        </form>
      </div></FocusTrap>
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
  const [error, setError] = useState(null);

  // AI Provider state
  const [providers, setProviders] = useState([]);
  const [providerModal, setProviderModal] = useState(null);
  const [disconnectingProvider, setDisconnectingProvider] = useState(null);

  async function loadProviders() {
    try {
      const result = await workerApiRequest({ pathname: "/v1/providers", method: "GET" });
      setProviders(result?.providers || []);
    } catch {
      setProviders([]);
    }
  }

  function getConnectedProvider(key) {
    return providers.find(p => p.provider === key && p.connected);
  }

  async function handleDisconnectProvider(key) {
    setDisconnectingProvider(key);
    try {
      await workerApiRequest({ pathname: `/v1/providers/${encodeURIComponent(key)}`, method: "DELETE" });
      await loadProviders();
    } catch (err) {
      console.error("Failed to disconnect provider:", err);
      setError("Failed to disconnect provider. Please try again.");
    }
    setDisconnectingProvider(null);
  }

  async function loadIntegrations() {
    try {
      setError(null);
      const result = await workerApiRequest({ pathname: "/v1/integrations", method: "GET" });
      setConnected(result?.items || result || []);
    } catch (err) {
      console.error("Failed to load integrations:", err);
      setError("Failed to load integrations. Please try again.");
      setConnected([]);
    }
    setLoading(false);
  }

  useEffect(() => { loadIntegrations(); loadProviders(); }, []);

  function isConnected(serviceKey) {
    return connected.find(c => c.service === serviceKey || c.key === serviceKey);
  }

  async function handleConnect(integration) {
    if (integration.authType === "oauth") {
      const runtime = loadRuntimeConfig();
      const tenantId = runtime?.tenantId || "";
      const oauthHref = WORKER_API_BASE + integration.oauthUrl + "?tenantId=" + encodeURIComponent(tenantId);
      const popup = window.open(oauthHref, "nooterra_oauth", "width=520,height=700,popup=yes");
      if (!popup) {
        window.location.href = oauthHref;
        return;
      }
      const poll = setInterval(() => {
        if (popup.closed) { clearInterval(poll); loadIntegrations(); }
      }, 500);
      return;
    }
    setConnectModal(integration);
  }

  async function handleDisconnect(serviceKey) {
    const entry = isConnected(serviceKey);
    if (!entry) return;
    const integration = AVAILABLE_INTEGRATIONS.find(a => a.key === serviceKey);
    if (!window.confirm(`Disconnect ${integration?.name || serviceKey}? Your workers will lose access to this service.`)) return;
    setDisconnecting(serviceKey);
    try {
      await workerApiRequest({ pathname: `/v1/integrations/${encodeURIComponent(entry.id)}`, method: "DELETE" });
      await loadIntegrations();
    } catch (err) {
      console.error("Failed to disconnect integration:", err);
      setError("Failed to disconnect integration. Please try again.");
    }
    setDisconnecting(null);
  }

  return (
    <div>
      <h1 style={S.pageTitle}>Integrations</h1>
      <p style={S.pageSub}>Connect services your workers can use to get work done.</p>
      {error && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", marginBottom: 16, borderRadius: 8, background: "var(--red-bg, rgba(196,58,58,0.08))", border: "1px solid var(--red, #c43a3a)", color: "var(--red, #c43a3a)", fontSize: "14px" }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{ background: "none", border: "none", color: "var(--red, #c43a3a)", cursor: "pointer", fontWeight: 700, fontSize: "16px", padding: "0 4px", lineHeight: 1 }} aria-label="Dismiss error">&times;</button>
        </div>
      )}
      {loading ? (
        <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Loading...</div>
      ) : (
        <>
          {/* AI Providers Section */}
          <div style={{ marginBottom: "2rem" }}>
            <h2 style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "0.75rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>AI Providers</h2>
            <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "1rem", lineHeight: 1.5 }}>Bring your own API keys for direct model access. Workers can use your keys instead of OpenRouter.</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem" }}>
              {AI_PROVIDERS.map(provider => {
                const conn = getConnectedProvider(provider.key);
                return (
                  <div key={provider.key} style={{ border: conn ? "1px solid #5bb98c" : "1px solid var(--border)", borderRadius: 12, padding: 24, background: "var(--bg-surface)", transition: "border-color 150ms" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                      <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)" }}>{provider.name}</div>
                      {conn && (
                        <span style={{ fontSize: "11px", fontWeight: 600, color: "#5bb98c", background: "rgba(91,185,140,0.1)", padding: "2px 8px", borderRadius: 6 }}>Verified</span>
                      )}
                    </div>
                    <div style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: 16, lineHeight: 1.5 }}>{provider.description}</div>
                    {conn && (
                      <div style={{ fontSize: "12px", color: "var(--text-tertiary)", marginBottom: 12, fontFamily: "var(--font-mono, monospace)" }}>
                        Key: {conn.maskedKey}
                      </div>
                    )}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={S.statusDot(conn ? "#5bb98c" : "var(--text-tertiary)")} />
                        <span style={{ fontSize: "13px", color: conn ? "#5bb98c" : "var(--text-tertiary)", fontWeight: 500 }}>{conn ? "Connected" : "Not connected"}</span>
                      </div>
                      {conn ? (
                        <button
                          style={{ ...S.btnSecondary, padding: "6px 14px", fontSize: "13px", opacity: disconnectingProvider === provider.key ? 0.5 : 1 }}
                          disabled={disconnectingProvider === provider.key}
                          onClick={() => handleDisconnectProvider(provider.key)}
                        >{disconnectingProvider === provider.key ? "..." : "Disconnect"}</button>
                      ) : (
                        <button
                          style={{ ...S.btnPrimary, width: "auto", padding: "6px 14px", fontSize: "13px" }}
                          onClick={() => setProviderModal(provider)}
                        >Connect</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Tool Integrations Section */}
          <h2 style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "0.75rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>Tool Integrations</h2>
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
        </>
      )}
      {connectModal && (
        <IntegrationConnectModal
          integration={connectModal}
          onClose={() => setConnectModal(null)}
          onSave={() => { setConnectModal(null); loadIntegrations(); }}
        />
      )}
      {providerModal && (
        <ProviderConnectModal
          provider={providerModal}
          onClose={() => setProviderModal(null)}
          onSave={() => { setProviderModal(null); loadProviders(); }}
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
