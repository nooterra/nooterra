import React, { useState, useEffect } from "react";
import { S, STATUS_COLORS, timeAgo, humanizeSchedule, workerApiRequest } from "../shared.js";

function PerformanceView() {
  const [workers, setWorkers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const result = await workerApiRequest({ pathname: "/v1/workers", method: "GET" });
        setWorkers(result?.workers || result?.items || (Array.isArray(result) ? result : []));
      } catch {
        setWorkers([]);
      }
      setLoading(false);
    })();
  }, []);

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
      <div style={{ padding: "3rem 1.5rem", textAlign: "center", border: "1px dashed var(--border)", borderRadius: 12 }}>
        <div style={{ fontSize: "1rem", fontWeight: 600, color: "var(--text-primary)", marginBottom: "0.5rem" }}>No data yet</div>
        <div style={{ fontSize: "14px", color: "var(--text-secondary)", maxWidth: 360, margin: "0 auto" }}>Deploy your first team to see performance metrics here.</div>
      </div>
    </div>
  );

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
