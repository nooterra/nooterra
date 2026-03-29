import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_BASE_URL,
  STORAGE_KEY,
  headersFor,
  loadSavedConfig
} from "./operator-constants.js";
import MetricsTab from "./tabs/MetricsTab.jsx";
import RescueTab from "./tabs/RescueTab.jsx";
import AuditTab from "./tabs/AuditTab.jsx";
import EmergencyTab from "./tabs/EmergencyTab.jsx";
import SpendTab from "./tabs/SpendTab.jsx";

const TAB_OPTIONS = [
  { id: "metrics", label: "Launch Metrics" },
  { id: "rescue", label: "Rescue Queue" },
  { id: "audit", label: "Audit Feed" },
  { id: "emergency", label: "Emergency Controls" },
  { id: "spend", label: "Spend Escalations" }
];

const TAB_TITLES = {
  metrics: "Action Wallet Launch Metrics",
  rescue: "Rescue Queue",
  audit: "Audit Feed",
  emergency: "Emergency Controls",
  spend: "Spend Escalations"
};

const TAB_DESCRIPTIONS = {
  metrics: "Track approval, grant, evidence, receipt, dispute, and rescue pressure for the locked buy and cancel/recover launch scope.",
  rescue: "Triages blocked approvals, dispute-linked runs, and quarantine-worthy recovery work before launch trust breaks.",
  audit: "Review the append-only operator action stream with run and dispute filtering before support work escapes into chats and memory.",
  emergency: "View and trigger launch-scoped pause, quarantine, revoke, and kill-switch controls without weakening the signed dual-control model.",
  spend: "Review blocked autonomous spend and issue signed override decisions."
};

export default function OperatorDashboard() {
  const saved = loadSavedConfig();
  const [config, setConfig] = useState(
    saved ?? {
      baseUrl: DEFAULT_BASE_URL,
      apiKey: "",
      tenantId: "tenant_default",
      protocol: "1.0"
    }
  );
  const [activeTab, setActiveTab] = useState("rescue");

  /* Cross-tab shared state: MetricsTab reads these, RescueTab/EmergencyTab write them */
  const [rescueQueue, setRescueQueue] = useState([]);
  const [emergencyEvents, setEmergencyEvents] = useState([]);

  /* Refresh counter — bumped by the Refresh button to tell the active tab to reload */
  const [refreshSeq, setRefreshSeq] = useState(0);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch {
      // ignore
    }
  }, [config]);

  const requestHeaders = useMemo(
    () => headersFor({ tenantId: config.tenantId, protocol: config.protocol, apiKey: config.apiKey }),
    [config]
  );

  const handleQueueChange = useCallback((queue) => setRescueQueue(queue), []);
  const handleEventsChange = useCallback((events) => setEmergencyEvents(events), []);

  return (
    <div className="operator-root">
      <div className="operator-bg operator-bg-a" aria-hidden="true" />
      <div className="operator-bg operator-bg-b" aria-hidden="true" />

      <header className="operator-topbar">
        <div>
          <p className="operator-eyebrow">Nooterra Operator Console</p>
          <h1>{TAB_TITLES[activeTab]}</h1>
          <p>{TAB_DESCRIPTIONS[activeTab]}</p>
        </div>
        <div className="operator-top-actions">
          <button
            className="operator-ghost-btn"
            onClick={() => setRefreshSeq((n) => n + 1)}
          >
            Refresh
          </button>
          <a className="operator-ghost-btn" href="/">
            Back to site
          </a>
        </div>
      </header>

      <section className="operator-mode-tabs" aria-label="Operator modes">
        {TAB_OPTIONS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`operator-mode-tab ${activeTab === tab.id ? "is-active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </section>

      <section className="operator-config-grid">
        <label>
          <span>API base URL</span>
          <input
            value={config.baseUrl}
            onChange={(event) => setConfig((prev) => ({ ...prev, baseUrl: event.target.value }))}
            placeholder="/__nooterra or http://127.0.0.1:3000"
          />
        </label>
        <label>
          <span>Tenant</span>
          <input
            value={config.tenantId}
            onChange={(event) => setConfig((prev) => ({ ...prev, tenantId: event.target.value }))}
            placeholder="tenant_default"
          />
        </label>
        <label>
          <span>Protocol</span>
          <input
            value={config.protocol}
            onChange={(event) => setConfig((prev) => ({ ...prev, protocol: event.target.value }))}
            placeholder="1.0"
          />
        </label>
        <label>
          <span>API key (Bearer)</span>
          <input
            value={config.apiKey}
            onChange={(event) => setConfig((prev) => ({ ...prev, apiKey: event.target.value }))}
            placeholder="sk_test_..."
          />
        </label>
      </section>

      {activeTab === "metrics" ? (
        <MetricsTab
          config={config}
          requestHeaders={requestHeaders}
          rescueQueue={rescueQueue}
          emergencyEvents={emergencyEvents}
          setActiveTab={setActiveTab}
          refreshSeq={refreshSeq}
        />
      ) : activeTab === "rescue" ? (
        <RescueTab
          config={config}
          requestHeaders={requestHeaders}
          onQueueChange={handleQueueChange}
          refreshSeq={refreshSeq}
        />
      ) : activeTab === "audit" ? (
        <AuditTab
          config={config}
          requestHeaders={requestHeaders}
          refreshSeq={refreshSeq}
        />
      ) : activeTab === "emergency" ? (
        <EmergencyTab
          config={config}
          requestHeaders={requestHeaders}
          onEventsChange={handleEventsChange}
          refreshSeq={refreshSeq}
        />
      ) : (
        <SpendTab
          config={config}
          requestHeaders={requestHeaders}
          refreshSeq={refreshSeq}
        />
      )}
    </div>
  );
}
