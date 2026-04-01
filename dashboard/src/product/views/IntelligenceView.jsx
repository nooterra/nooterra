import React, { useState, useEffect, useCallback } from "react";
import { S, workerApiRequest, timeAgo } from "../shared.js";

/* ===================================================================
   Style helpers (local to Intelligence view)
   =================================================================== */

const card = {
  border: "1px solid var(--border)", borderRadius: 12,
  background: "var(--bg-400)", padding: 18, marginBottom: 12,
};
const sectionTitle = {
  fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)",
  textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10,
};
const btnAction = {
  background: "var(--accent, #c4613a)", color: "#fff", border: "none",
  borderRadius: 6, padding: "6px 14px", fontSize: "12px", fontWeight: 600,
  cursor: "pointer", fontFamily: "inherit", transition: "opacity 0.15s",
};
const btnSecondary = {
  background: "none", border: "1px solid var(--border)", borderRadius: 6,
  padding: "6px 14px", fontSize: "12px", fontWeight: 600,
  color: "var(--text-secondary)", cursor: "pointer", fontFamily: "inherit",
};
const tabBtn = (active) => ({
  background: active ? "var(--bg-100)" : "transparent",
  color: active ? "var(--text-100)" : "var(--text-300)",
  border: "none", borderRadius: 6, padding: "7px 14px",
  fontSize: "13px", fontWeight: active ? 600 : 400,
  cursor: "pointer", fontFamily: "inherit", transition: "all 120ms",
});

const TRACE_COLORS = {
  llm_call: "#4a90d9", charter_decision: "#c08c30", tool_exec: "#2a9d6e",
  error: "#c43a3a", memory_load: "#9b59b6", approval_gate: "#d4a017",
};
const TRACE_ICONS = {
  llm_call: "\u2731", charter_decision: "\u2696", tool_exec: "\u2699",
  error: "\u26A0", memory_load: "\u2B50", approval_gate: "\u23F8",
};

function scoreColor(score) {
  if (score > 80) return "var(--green, #2a9d6e)";
  if (score > 50) return "var(--amber, #c08c30)";
  return "var(--red, #c43a3a)";
}

/* ===================================================================
   Tab: Learning Proposals
   =================================================================== */

function ProposalsTab({ workerId }) {
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(null);

  const fetchProposals = useCallback(async () => {
    setLoading(true);
    try {
      const res = await workerApiRequest({ pathname: `/v1/workers/${workerId}/proposals` });
      setProposals(res?.items || res || []);
    } catch { setProposals([]); }
    setLoading(false);
  }, [workerId]);

  useEffect(() => { fetchProposals(); }, [fetchProposals]);

  async function handleAction(id, action) {
    setActing(id);
    try {
      await workerApiRequest({ pathname: `/v1/workers/${workerId}/proposals/${id}/${action}`, method: "POST" });
      await fetchProposals();
    } catch { /* ignore */ }
    setActing(null);
  }

  async function handleGenerate() {
    setActing("generate");
    try {
      await workerApiRequest({ pathname: `/v1/workers/${workerId}/proposals/generate`, method: "POST" });
      await fetchProposals();
    } catch { /* ignore */ }
    setActing(null);
  }

  if (loading) return <div style={{ fontSize: "13px", color: "var(--text-tertiary)" }}>Loading proposals...</div>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={sectionTitle}>Charter Change Proposals</div>
        <button style={btnAction} disabled={acting === "generate"} onClick={handleGenerate}>
          {acting === "generate" ? "Generating..." : "Generate Proposals"}
        </button>
      </div>
      {proposals.length === 0 ? (
        <div style={{ fontSize: "13px", color: "var(--text-tertiary)", lineHeight: 1.6 }}>
          No pending proposals. Click "Generate Proposals" to analyze recent executions.
        </div>
      ) : proposals.map(p => (
        <div key={p.id} style={card}>
          <div style={{ fontSize: "14px", color: "var(--text-primary)", fontWeight: 500, marginBottom: 6 }}>
            {p.rule_text}
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: "12px", color: "var(--text-secondary)", marginBottom: 8 }}>
            <span>{p.from_level} → {p.to_level}</span>
            {p.evidence_summary && <span>{p.evidence_summary}</span>}
          </div>
          {p.confidence != null && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <div style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--bg-300, var(--bg-hover))" }}>
                <div style={{ width: `${Math.round(p.confidence * 100)}%`, height: "100%", borderRadius: 3, background: scoreColor(p.confidence * 100) }} />
              </div>
              <span style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: 600 }}>
                {Math.round(p.confidence * 100)}%
              </span>
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button style={btnAction} disabled={acting === p.id} onClick={() => handleAction(p.id, "approve")}>Approve</button>
            <button style={btnSecondary} disabled={acting === p.id} onClick={() => handleAction(p.id, "reject")}>Reject</button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ===================================================================
   Tab: Competence
   =================================================================== */

function CompetenceTab({ workerId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await workerApiRequest({ pathname: `/v1/workers/${workerId}/competence` });
        const items = res?.items || res || [];
        items.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        setRows(items);
      } catch { setRows([]); }
      setLoading(false);
    })();
  }, [workerId]);

  if (loading) return <div style={{ fontSize: "13px", color: "var(--text-tertiary)" }}>Loading competence data...</div>;
  if (rows.length === 0) return <div style={{ fontSize: "13px", color: "var(--text-tertiary)" }}>No competence data yet. Run some tasks first.</div>;

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)" }}>
            {["Task Type", "Score", "Runs", "Success %", "Avg Duration", "Avg Cost"].map(h => (
              <th key={h} style={{ ...sectionTitle, padding: "8px 10px", textAlign: "left" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const score = r.score ?? 0;
            const successRate = r.total_runs > 0 ? Math.round(((r.successful_runs ?? r.success_count ?? 0) / r.total_runs) * 100) : 0;
            return (
              <tr key={r.task_type || i} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "10px", color: "var(--text-primary)", fontWeight: 500 }}>{r.task_type}</td>
                <td style={{ padding: "10px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 60, height: 6, borderRadius: 3, background: "var(--bg-300, var(--bg-hover))" }}>
                      <div style={{ width: `${score}%`, height: "100%", borderRadius: 3, background: scoreColor(score) }} />
                    </div>
                    <span style={{ color: scoreColor(score), fontWeight: 600, fontSize: "12px" }}>{score}</span>
                  </div>
                </td>
                <td style={{ padding: "10px", color: "var(--text-secondary)" }}>{r.total_runs ?? 0}</td>
                <td style={{ padding: "10px", color: "var(--text-secondary)" }}>{successRate}%</td>
                <td style={{ padding: "10px", color: "var(--text-secondary)" }}>{r.avg_duration ? `${(r.avg_duration / 1000).toFixed(1)}s` : "--"}</td>
                <td style={{ padding: "10px", color: "var(--text-secondary)" }}>{r.avg_cost != null ? `$${r.avg_cost.toFixed(3)}` : "--"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ===================================================================
   Tab: Sessions
   =================================================================== */

function SessionsTab({ workerId }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [completing, setCompleting] = useState(null);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await workerApiRequest({ pathname: `/v1/workers/${workerId}/sessions` });
      setSessions(res?.items || res || []);
    } catch { setSessions([]); }
    setLoading(false);
  }, [workerId]);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  async function handleComplete(sessionId) {
    setCompleting(sessionId);
    try {
      await workerApiRequest({ pathname: `/v1/workers/${workerId}/sessions/${sessionId}/complete`, method: "POST" });
      await fetchSessions();
    } catch { /* ignore */ }
    setCompleting(null);
  }

  if (loading) return <div style={{ fontSize: "13px", color: "var(--text-tertiary)" }}>Loading sessions...</div>;
  if (sessions.length === 0) return <div style={{ fontSize: "13px", color: "var(--text-tertiary)" }}>No sessions found.</div>;

  return (
    <div>
      {sessions.map(s => (
        <div key={s.id} style={{ ...card, cursor: "pointer" }} onClick={() => setExpanded(expanded === s.id ? null : s.id)}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "14px", color: "var(--text-primary)", fontWeight: 500 }}>{s.goal || "Untitled session"}</div>
              <div style={{ fontSize: "12px", color: "var(--text-tertiary)", marginTop: 4 }}>
                {s.status} · {timeAgo(s.created_at)} · {s.execution_count ?? 0} executions
              </div>
            </div>
            {s.status === "active" && (
              <button style={btnAction} disabled={completing === s.id} onClick={(e) => { e.stopPropagation(); handleComplete(s.id); }}>
                {completing === s.id ? "..." : "Complete"}
              </button>
            )}
          </div>
          {expanded === s.id && (
            <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 8, background: "var(--bg-300, var(--bg-hover))", fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              {s.context ? JSON.stringify(s.context, null, 2) : "No context data."}
              {s.history && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>History:</div>
                  {JSON.stringify(s.history, null, 2)}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ===================================================================
   Tab: Execution Trace
   =================================================================== */

function TraceTab({ workerId }) {
  const [trace, setTrace] = useState([]);
  const [loading, setLoading] = useState(true);
  const [execId, setExecId] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const latest = await workerApiRequest({ pathname: `/v1/workers/${workerId}/executions/latest` });
        const eid = latest?.id || latest?.execution_id;
        if (eid) {
          setExecId(eid);
          const res = await workerApiRequest({ pathname: `/v1/workers/${workerId}/executions/${eid}/trace` });
          setTrace(res?.items || res || []);
        }
      } catch { setTrace([]); }
      setLoading(false);
    })();
  }, [workerId]);

  if (loading) return <div style={{ fontSize: "13px", color: "var(--text-tertiary)" }}>Loading trace...</div>;
  if (trace.length === 0) return <div style={{ fontSize: "13px", color: "var(--text-tertiary)" }}>No execution trace available.</div>;

  return (
    <div>
      {execId && <div style={{ fontSize: "12px", color: "var(--text-tertiary)", marginBottom: 12 }}>Execution: {execId}</div>}
      {trace.map((entry, i) => {
        const color = TRACE_COLORS[entry.trace_type] || "var(--text-secondary)";
        const icon = TRACE_ICONS[entry.trace_type] || "\u25CF";
        const payload = entry.payload ? (typeof entry.payload === "string" ? entry.payload : JSON.stringify(entry.payload)) : "";
        const summary = payload.length > 120 ? payload.slice(0, 120) + "..." : payload;
        return (
          <div key={i} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border)", alignItems: "flex-start" }}>
            <div style={{ fontSize: "12px", color: "var(--text-tertiary)", fontWeight: 600, minWidth: 24, textAlign: "right" }}>
              {entry.seq ?? i + 1}
            </div>
            <div style={{ fontSize: "14px", minWidth: 20, color }}>{icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{
                  fontSize: "11px", fontWeight: 600, textTransform: "uppercase",
                  color, padding: "1px 6px", borderRadius: 4,
                  background: `color-mix(in srgb, ${color} 12%, transparent)`,
                }}>{entry.trace_type}</span>
                {entry.duration_ms != null && (
                  <span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>{entry.duration_ms}ms</span>
                )}
              </div>
              {summary && (
                <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: 4, lineHeight: 1.5, wordBreak: "break-word" }}>
                  {summary}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ===================================================================
   IntelligenceView (main export)
   =================================================================== */

export default function IntelligenceView({ workerId }) {
  const [activeTab, setActiveTab] = useState("proposals");

  const tabs = [
    { key: "proposals", label: "Learning Proposals" },
    { key: "competence", label: "Competence" },
    { key: "sessions", label: "Sessions" },
    { key: "trace", label: "Execution Trace" },
  ];

  return (
    <div>
      <h1 style={S.pageTitle}>Intelligence</h1>
      <p style={S.pageSub}>Learning loop, competence scores, sessions, and execution traces.</p>

      <div style={{ display: "flex", gap: 4, marginBottom: 20, padding: 4, background: "var(--bg-400)", borderRadius: 8, border: "1px solid var(--border)" }}>
        {tabs.map(t => (
          <button key={t.key} style={tabBtn(activeTab === t.key)} onClick={() => setActiveTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "proposals" && <ProposalsTab workerId={workerId} />}
      {activeTab === "competence" && <CompetenceTab workerId={workerId} />}
      {activeTab === "sessions" && <SessionsTab workerId={workerId} />}
      {activeTab === "trace" && <TraceTab workerId={workerId} />}
    </div>
  );
}
