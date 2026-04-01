import React, { useEffect, useState } from "react";

import { AVAILABLE_INTEGRATIONS } from "../integrations-catalog.js";
import { workerApiRequest } from "../shared.js";
import { ToggleSwitch } from "./SettingsModal.jsx";

export function WorkerIntegrationsSection({ workerId }) {
  const [connected, setConnected] = useState([]);
  const [workerIntegrations, setWorkerIntegrations] = useState({});
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [allResult, workerResult] = await Promise.all([
          workerApiRequest({ pathname: "/v1/integrations", method: "GET" }),
          workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}/integrations`, method: "GET" }),
        ]);
        if (cancelled) return;

        const allItems = allResult?.items || allResult || [];
        const workerItems = workerResult?.items || workerResult || [];
        const nextMap = {};
        workerItems.forEach((item) => {
          nextMap[item.service || item.key || item.integrationId] = true;
        });

        setConnected(allItems);
        setWorkerIntegrations(nextMap);
      } catch {
        if (!cancelled) {
          setConnected([]);
          setWorkerIntegrations({});
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workerId]);

  async function handleToggle(integration) {
    const serviceKey = integration.service || integration.key;
    const currentlyEnabled = Boolean(workerIntegrations[serviceKey]);
    setToggling(serviceKey);

    try {
      if (currentlyEnabled) {
        await workerApiRequest({
          pathname: `/v1/workers/${encodeURIComponent(workerId)}/integrations/${encodeURIComponent(serviceKey)}`,
          method: "DELETE",
        });
      } else {
        await workerApiRequest({
          pathname: `/v1/workers/${encodeURIComponent(workerId)}/integrations`,
          method: "POST",
          body: { service: serviceKey, integrationId: integration.id },
        });
      }
      setWorkerIntegrations((previous) => ({ ...previous, [serviceKey]: !currentlyEnabled }));
    } catch {
      // Keep the UI fail-closed. The toggle only updates on confirmed writes.
    } finally {
      setToggling(null);
    }
  }

  if (loading) {
    return <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Loading integrations...</div>;
  }

  if (connected.length === 0) {
    return <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>No integrations connected yet. Go to Integrations to connect services.</div>;
  }

  return (
    <div>
      <p style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "1rem" }}>Choose which connected integrations this worker can access.</p>
      {connected.map((integration) => {
        const serviceKey = integration.service || integration.key;
        const info = AVAILABLE_INTEGRATIONS.find((item) => item.key === serviceKey);
        const enabled = Boolean(workerIntegrations[serviceKey]);

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
