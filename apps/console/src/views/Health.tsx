import React from "react";
import { ShieldAlert, CheckCircle, Clock, Loader2, RefreshCw } from "lucide-react";

type AlertItem = {
  id: number;
  type: string;
  severity: string;
  message: string;
  meta?: any;
  created_at: string;
  acknowledged_at?: string | null;
  resolved_at?: string | null;
};

export default function Health() {
  const coordUrl = (import.meta as any).env?.VITE_COORD_URL || "https://coord.nooterra.ai";
  const apiKey = typeof window !== "undefined" ? localStorage.getItem("apiKey") || "" : "";
  const [alerts, setAlerts] = React.useState<AlertItem[]>([]);
  const [resolved, setResolved] = React.useState<boolean>(false);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string | null>(null);
  const [actionBusy, setActionBusy] = React.useState<number | null>(null);
  const [metrics, setMetrics] = React.useState<any[]>([]);
  const [metricsWindow, setMetricsWindow] = React.useState<number>(60);
  const [metricsLoading, setMetricsLoading] = React.useState<boolean>(false);

  const fetchAlerts = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${coordUrl}/v1/admin/alerts${resolved ? "?resolved=true" : ""}`, {
        headers: apiKey ? { "x-api-key": apiKey } : {},
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Failed to load alerts (${res.status})`);
      }
      const json = await res.json();
      setAlerts(json.alerts || []);
    } catch (err: any) {
      setError(err.message || "Failed to load alerts");
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  }, [coordUrl, apiKey, resolved]);

  React.useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const fetchMetrics = React.useCallback(async () => {
    setMetricsLoading(true);
    try {
      const res = await fetch(
        `${coordUrl}/v1/admin/agent-metrics?windowMinutes=${metricsWindow}`,
        { headers: apiKey ? { "x-api-key": apiKey } : {} }
      );
      if (res.ok) {
        const json = await res.json();
        setMetrics(json.metrics || []);
      } else {
        setMetrics([]);
      }
    } catch (err) {
      setMetrics([]);
    } finally {
      setMetricsLoading(false);
    }
  }, [coordUrl, apiKey, metricsWindow]);

  React.useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  const doAction = async (id: number, action: "ack" | "resolve") => {
    setActionBusy(id);
    try {
      const res = await fetch(`${coordUrl}/v1/admin/alerts/${id}/${action}`, {
        method: "POST",
        headers: apiKey ? { "x-api-key": apiKey } : {},
      });
      if (!res.ok) {
        throw new Error(`Failed to ${action} alert ${id}`);
      }
      await fetchAlerts();
    } catch (err: any) {
      setError(err.message || `Failed to ${action} alert`);
    } finally {
      setActionBusy(null);
    }
  };

  const getSeverityColor = (severity: string) => {
    if (severity === "error") return "text-red-400 border-red-500/30 bg-red-500/10";
    if (severity === "warn") return "text-amber-300 border-amber-400/30 bg-amber-400/10";
    return "text-neural-cyan border-neural-cyan/30 bg-neural-cyan/10";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-primary">Network Health</h2>
          <p className="text-sm text-secondary mt-1">
            Operational alerts for stuck workflows, failure spikes, and DLQ backlog
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchAlerts}
            disabled={loading}
            className="btn-ghost text-xs py-2 px-3"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <label className="flex items-center gap-2 text-xs text-secondary">
            <input
              type="checkbox"
              className="w-3 h-3"
              checked={resolved}
              onChange={(e) => setResolved(e.target.checked)}
            />
            Show resolved
          </label>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-200">
          {error}
        </div>
      )}

      {loading && alerts.length === 0 && (
        <div className="text-secondary text-sm flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading alerts...
        </div>
      )}

      {!loading && alerts.length === 0 && !error && (
        <div className="text-secondary text-sm">No alerts.</div>
      )}

      <div className="border border-white/10 rounded-xl p-4 bg-substrate/60">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-secondary">Agent & Capability Health</div>
            <div className="text-[11px] text-secondary">Failure rate and latency over the last window.</div>
          </div>
          <div className="flex items-center gap-2 text-xs text-secondary">
            <label className="flex items-center gap-1">
              Window (minutes):
              <input
                type="number"
                min={5}
                max={1440}
                value={metricsWindow}
                onChange={(e) => setMetricsWindow(Number(e.target.value) || 60)}
                className="w-16 bg-void border border-white/10 rounded px-2 py-1 text-xs"
              />
            </label>
            <button
              onClick={fetchMetrics}
              disabled={metricsLoading}
              className="btn-ghost text-xs py-1 px-2"
            >
              <RefreshCw className={`w-4 h-4 ${metricsLoading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>
        {metricsLoading && <div className="text-secondary text-xs flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Loading metrics…</div>}
        {!metricsLoading && metrics.length === 0 && (
          <div className="text-secondary text-xs">No metrics in this window.</div>
        )}
        {!metricsLoading && metrics.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-white/10 text-secondary">
                <tr>
                  <th className="text-left px-2 py-2">Agent</th>
                  <th className="text-left px-2 py-2">Capability</th>
                  <th className="text-left px-2 py-2">Calls</th>
                  <th className="text-left px-2 py-2">Failures</th>
                  <th className="text-left px-2 py-2">Failure rate</th>
                  <th className="text-left px-2 py-2">Avg latency</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((m, idx) => {
                  const rate = m.failureRate != null ? (m.failureRate * 100).toFixed(1) + "%" : "—";
                  const latency = m.avgLatencyMs != null ? `${Math.round(m.avgLatencyMs)} ms` : "—";
                  const rateColor =
                    m.failureRate >= 0.5
                      ? "text-red-400"
                      : m.failureRate >= 0.2
                      ? "text-amber-300"
                      : "text-neural-green";
                  return (
                    <tr key={`${m.agentDid}-${m.capabilityId}-${idx}`} className="border-b border-white/5">
                      <td className="px-2 py-2 font-mono">{m.agentDid}</td>
                      <td className="px-2 py-2 font-mono text-secondary">{m.capabilityId}</td>
                      <td className="px-2 py-2">{m.callsTotal}</td>
                      <td className="px-2 py-2">{m.callsFailed}</td>
                      <td className={`px-2 py-2 ${rateColor}`}>{rate}</td>
                      <td className="px-2 py-2 text-secondary">{latency}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="space-y-3">
        {alerts.map((a) => {
          const sev = a.severity || "warn";
          const meta = a.meta && typeof a.meta === "object" ? a.meta : null;
          return (
            <div
              key={a.id}
              className="border border-white/10 rounded-xl p-4 bg-substrate/80"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div
                    className={`w-10 h-10 rounded-lg flex items-center justify-center border ${getSeverityColor(sev)}`}
                  >
                    {sev === "error" ? (
                      <ShieldAlert className="w-5 h-5" />
                    ) : sev === "warn" ? (
                      <AlertIcon />
                    ) : (
                      <CheckCircle className="w-5 h-5" />
                    )}
                  </div>
                  <div>
                    <div className="text-sm text-secondary uppercase tracking-[0.18em]">
                      {a.type}
                    </div>
                    <div className="text-primary text-base">{a.message}</div>
                    <div className="text-[11px] text-secondary mt-1 flex items-center gap-2">
                      <Clock className="w-3 h-3" />
                      {new Date(a.created_at).toLocaleString()}
                      {a.acknowledged_at && (
                        <span className="text-neural-cyan/80">
                          · Acked {new Date(a.acknowledged_at).toLocaleString()}
                        </span>
                      )}
                      {a.resolved_at && (
                        <span className="text-neural-green/80">
                          · Resolved {new Date(a.resolved_at).toLocaleString()}
                        </span>
                      )}
                    </div>
                    {meta && (
                      <pre className="mt-2 text-[11px] text-secondary bg-abyss border border-white/5 rounded p-2 overflow-x-auto">
                        {JSON.stringify(meta, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
                {!a.resolved_at && (
                  <div className="flex flex-col gap-2 text-xs">
                    {!a.acknowledged_at && (
                      <button
                        className="px-3 py-1 rounded bg-white/10 hover:bg-white/15 border border-white/10"
                        onClick={() => doAction(a.id, "ack")}
                        disabled={actionBusy === a.id}
                      >
                        {actionBusy === a.id ? "Working..." : "Acknowledge"}
                      </button>
                    )}
                    <button
                      className="px-3 py-1 rounded bg-neural-green/10 hover:bg-neural-green/15 border border-neural-green/20 text-neural-green"
                      onClick={() => doAction(a.id, "resolve")}
                      disabled={actionBusy === a.id}
                    >
                      {actionBusy === a.id ? "Working..." : "Resolve"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.29 3.86 1.82 18a1 1 0 0 0 .86 1.5h18.64a1 1 0 0 0 .86-1.5L12 3.86a1 1 0 0 0-1.72 0Z" />
    </svg>
  );
}
