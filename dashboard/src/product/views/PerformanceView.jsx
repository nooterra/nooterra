import React, { useState, useEffect, useRef, useCallback } from "react";
import { S, STATUS_COLORS, timeAgo, humanizeSchedule, workerApiRequest, WORKER_API_BASE } from "../shared.js";
import { loadRuntimeConfig } from "../api.js";
import ExecutionTraceViewer from "../components/ExecutionTraceViewer.jsx";

function PerformanceView() {
  const [workers, setWorkers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedExecution, setSelectedExecution] = useState(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const fetchingRef = useRef(false);

  async function loadWorkers() {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const result = await workerApiRequest({ pathname: "/v1/workers", method: "GET" });
      setWorkers(result?.workers || result?.items || (Array.isArray(result) ? result : []));
    } catch {
      setWorkers([]);
    }
    setLoading(false);
    fetchingRef.current = false;
  }

  useEffect(() => {
    loadWorkers();
    const interval = setInterval(loadWorkers, 60000);
    return () => clearInterval(interval);
  }, []);

  const [liveStream, setLiveStream] = useState(false);
  const abortRef = useRef(null);

  // Clean up SSE stream on unmount
  useEffect(() => {
    return () => { if (abortRef.current) abortRef.current.abort(); };
  }, []);

  function startSSEStream(workerId, execId, workerName) {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const runtime = loadRuntimeConfig();
    const url = `${WORKER_API_BASE}/v1/workers/${workerId}/executions/${execId}/stream`;

    setLiveStream(true);
    setSelectedExecution(prev => ({ ...(prev || {}), workerName, _streaming: true }));

    (async () => {
      try {
        const response = await fetch(url, {
          headers: { "x-tenant-id": runtime.tenantId },
          signal: controller.signal,
        });
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop(); // keep incomplete line in buffer

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const event = JSON.parse(line.slice(6));
                setSelectedExecution(prev => {
                  if (!prev) return prev;
                  const activity = [...(prev.activity || []), event];
                  return { ...prev, activity };
                });
                // End stream on terminal events
                if (event.type === "complete" || event.type === "error") {
                  setLiveStream(false);
                  controller.abort();
                  return;
                }
              } catch { /* ignore malformed SSE data */ }
            }
          }
        }
      } catch (err) {
        if (err.name !== "AbortError") {
          setLiveStream(false);
        }
      }
    })();
  }

  async function handleViewTrace(worker) {
    if (abortRef.current) abortRef.current.abort();
    setLiveStream(false);
    setTraceLoading(true);
    try {
      const result = await workerApiRequest({
        pathname: `/v1/workers/${worker.id}/executions/latest`,
        method: "GET",
      });
      const activity = result?.activity || result?.events || [];
      const exec = {
        ...result,
        workerName: worker.name,
        activity,
      };
      setSelectedExecution(exec);

      // If worker is running and execution is in progress, open SSE stream
      const lastEvent = activity[activity.length - 1];
      const isTerminal = lastEvent?.type === "complete" || lastEvent?.type === "error";
      if (worker.status === "running" && result?.id && !isTerminal) {
        startSSEStream(worker.id, result.id, worker.name);
      }
    } catch {
      setSelectedExecution({
        workerName: worker.name,
        activity: [],
      });
    }
    setTraceLoading(false);
  }

  if (loading) return (
    <div>
      <h1 style={S.pageTitle}>Performance</h1>
      <p style={S.pageSub}>Loading metrics...</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {[1, 2, 3, 4].map(i => (
          <div key={i} style={{ height: i === 1 ? 80 : 56, borderRadius: 8, background: "var(--bg-300, var(--bg-hover))", animation: "skeletonPulse 1.5s ease-in-out infinite", animationDelay: `${i * 0.15}s` }} />
        ))}
      </div>
    </div>
  );

  if (workers.length === 0) return (
    <div>
      <h1 style={S.pageTitle}>Performance</h1>
      <p style={S.pageSub}>Track your team's output, cost, and health.</p>
      <div style={{ textAlign: 'center', padding: '3rem 1.5rem', color: 'var(--text-secondary, #999)' }}>
        <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📊</div>
        <div style={{ fontSize: '0.95rem', fontWeight: 500 }}>No execution data yet</div>
        <div style={{ fontSize: '0.85rem', marginTop: '0.25rem', opacity: 0.7 }}>Run a worker to see performance metrics</div>
      </div>
    </div>
  );

  /* ── Trace detail view ───────────────────────────────────────────── */
  if (selectedExecution) {
    return (
      <div>
        <h1 style={S.pageTitle}>Performance</h1>
        <p style={S.pageSub}>
          Execution trace for <strong>{selectedExecution.workerName}</strong>
        </p>
        <ExecutionTraceViewer
          execution={selectedExecution}
          activity={selectedExecution.activity}
          live={liveStream}
          onClose={() => {
            if (abortRef.current) abortRef.current.abort();
            setLiveStream(false);
            setSelectedExecution(null);
          }}
        />
      </div>
    );
  }

  /* ── Main performance view ───────────────────────────────────────── */
  const totalWorkers = workers.length;
  const activeWorkers = workers.filter(w => w.status === "running").length;
  const totalRuns = workers.reduce((sum, w) => sum + (w.totalRuns || w.total_runs || w.stats?.totalRuns || 0), 0);
  const totalCost = workers.reduce((sum, w) => sum + (typeof w.cost === "number" ? w.cost : 0), 0);
  const errorWorkers = workers.filter(w => w.status === "error").length;

  const stats = [
    { label: "Workers", value: totalWorkers },
    { label: "Active", value: activeWorkers },
    { label: "Total runs", value: totalRuns.toLocaleString() },
    { label: "Total cost", value: `$${totalCost.toFixed(2)}` },
    { label: "Errors", value: errorWorkers },
  ];

  const costSorted = [...workers].filter(w => typeof w.cost === "number" && w.cost > 0).sort((a, b) => b.cost - a.cost);
  const maxCost = costSorted.length > 0 ? costSorted[0].cost : 1;

  const healthColor = (status) => {
    if (status === "running") return "var(--green, #2a9d6e)";
    if (status === "paused") return "var(--amber, #c08c30)";
    if (status === "error") return "var(--red, #c43a3a)";
    return "var(--text-300, #8a8a84)";
  };

  return (
    <div>
      <h1 style={S.pageTitle}>Performance</h1>
      <p style={S.pageSub}>Track your team's output, cost, and health.</p>

      {/* Summary stats strip */}
      <div style={{ display: "flex", gap: 1, background: "var(--border)", borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)", marginBottom: 32 }}>
        {stats.map(stat => (
          <div key={stat.label} style={{ flex: 1, padding: "20px 16px", background: "var(--bg-400)", minWidth: 0 }}>
            <div style={{ fontSize: "24px", fontWeight: 700, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums", fontFamily: "var(--font-display, 'Fraunces', serif)" }}>{stat.value}</div>
            <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 4 }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Worker performance table */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>Worker performance</div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ padding: "8px 0", fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", textAlign: "left", borderBottom: "1px solid var(--border)" }}>Status</th>
              <th style={{ padding: "8px 0", fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", textAlign: "left", borderBottom: "1px solid var(--border)" }}>Worker</th>
              <th style={{ padding: "8px 0", fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", textAlign: "right", borderBottom: "1px solid var(--border)", minWidth: 60 }}>Runs</th>
              <th style={{ padding: "8px 0", fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", textAlign: "right", borderBottom: "1px solid var(--border)", minWidth: 60 }}>Cost</th>
              <th style={{ padding: "8px 0", fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", textAlign: "right", borderBottom: "1px solid var(--border)", minWidth: 60 }}>Trace</th>
            </tr>
          </thead>
          <tbody>
            {workers.map(w => {
              const runs = w.totalRuns || w.total_runs || w.stats?.totalRuns || 0;
              const cost = typeof w.cost === "number" ? w.cost : 0;
              const lastRun = w.lastRun || w.lastRunAt || w.last_run_at;
              return (
                <tr key={w.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "14px 12px 14px 0", verticalAlign: "middle" }}>
                    <span style={S.statusDot(healthColor(w.status))} />
                  </td>
                  <td style={{ padding: "14px 0", verticalAlign: "middle" }}>
                    <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.name}</div>
                    <div style={{ fontSize: "12px", color: "var(--text-tertiary)", marginTop: 2 }}>
                      {w.status}{w.schedule ? ` \u00b7 ${humanizeSchedule(w.schedule)}` : ""}
                    </div>
                  </td>
                  <td style={{ padding: "14px 0", fontSize: "13px", color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums", textAlign: "right", minWidth: 60, verticalAlign: "middle" }}>
                    <div>{runs} runs</div>
                    <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: 1 }}>{lastRun ? timeAgo(lastRun) : "\u2014"}</div>
                  </td>
                  <td style={{ padding: "14px 0", fontSize: "13px", color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums", textAlign: "right", minWidth: 60, verticalAlign: "middle" }}>
                    ${cost.toFixed(2)}
                  </td>
                  <td style={{ padding: "14px 0", textAlign: "right", verticalAlign: "middle" }}>
                    <button
                      onClick={() => handleViewTrace(w)}
                      disabled={traceLoading}
                      style={{
                        background: "none", border: "1px solid var(--border)", borderRadius: 6,
                        padding: "4px 10px", fontSize: "11px", fontWeight: 600,
                        color: "var(--text-secondary)", cursor: "pointer",
                        transition: "border-color 0.15s, color 0.15s",
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--accent, var(--product-accent))"; e.currentTarget.style.color = "var(--text-primary)"; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-secondary)"; }}
                    >
                      View trace
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Cost breakdown */}
      {costSorted.length > 0 && (
        <div>
          <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>Cost breakdown</div>
          <div>
            {costSorted.map(w => (
              <div key={w.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: "14px", fontWeight: 500, color: "var(--text-primary)" }}>{w.name}</span>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>${w.cost.toFixed(2)}</span>
                </div>
                <div style={{ height: 4, borderRadius: 2, background: "var(--bg-300, var(--bg-hover))", overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 2, background: "var(--accent)", width: `${(w.cost / maxCost) * 100}%`, transition: "width 0.3s ease" }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default PerformanceView;
