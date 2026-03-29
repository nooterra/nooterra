import React, { useState, useEffect } from "react";
import { S, timeAgo, workerApiRequest } from "../shared.js";
import { loadRuntimeConfig, fetchApprovalInbox, decideApprovalInboxItem } from "../api.js";

function InboxView() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState(null);
  const [lastChecked, setLastChecked] = useState(null);

  useEffect(() => { loadInbox(); }, []);

  async function loadInbox() {
    setLoading(true);
    try {
      const runtime = loadRuntimeConfig();
      const result = await fetchApprovalInbox(runtime, { status: "pending" });
      setItems(result?.items || result || []);
    } catch {
      setItems([]);
    }
    setLastChecked(new Date());
    setLoading(false);
  }

  async function handleDecide(requestId, decision) {
    setDeciding(requestId);
    try {
      const runtime = loadRuntimeConfig();
      await decideApprovalInboxItem(runtime, requestId, { approved: decision === "approved" });
      await loadInbox();
    } catch { /* ignore */ }
    setDeciding(null);
  }

  const pendingCount = Array.isArray(items) ? items.length : 0;
  const stats = [
    { label: "waiting", value: pendingCount, color: "#d97706" },
    { label: "blocked", value: 0, color: "#dc2626" },
    { label: "handled", value: 0, color: "var(--green, #5bb98c)" },
    { label: "hrs saved", value: 0, color: "var(--primary, #6366f1)" },
    { label: "violations", value: 0, color: "var(--green, #5bb98c)" },
  ];

  const roleColors = ["#6366f1", "#d97706", "#0ea5e9", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];
  function avatarColor(name) { let h = 0; for (let i = 0; i < (name || "").length; i++) h = (h + (name || "").charCodeAt(i)) % roleColors.length; return roleColors[h]; }
  function getLeftBorderColor(item) {
    if (item.type === "failure" || item.type === "error") return "#dc2626";
    if (item.type === "info") return "#3b82f6";
    return "#d97706";
  }

  return (
    <div>
      <h1 style={S.pageTitle}>Inbox</h1>
      <p style={S.pageSub}>What needs you now.</p>

      {/* Summary strip */}
      <div style={{ display: "flex", gap: 16, padding: "20px 0", borderBottom: "1px solid var(--border)", marginBottom: 24, flexWrap: "wrap" }}>
        {stats.map(s => (
          <div key={s.label} style={{ padding: "12px 20px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-400)" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 22, fontWeight: 700, color: s.color, marginRight: 6 }}>{s.value}</span>
            <span style={{ fontSize: 13, color: "var(--text-200, var(--text-secondary))" }}>{s.label}</span>
          </div>
        ))}
      </div>

      {loading ? (
        <div style={{ fontSize: 14, color: "var(--text-200, var(--text-secondary))" }}>Loading...</div>
      ) : pendingCount === 0 ? (
        /* Empty state */
        <div style={{ padding: "4rem 2rem", textAlign: "center" }}>
          <div style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--green, #5bb98c)", margin: "0 auto 16px", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-100, var(--text-primary))", marginBottom: 6 }}>All clear. Your team is handling everything.</div>
          <div style={{ fontSize: 13, color: "var(--text-300, var(--text-tertiary))", fontFamily: "var(--font-mono)" }}>
            Last checked: {lastChecked ? lastChecked.toLocaleTimeString() : "\u2014"}
          </div>
        </div>
      ) : (
        /* Decision cards */
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {items.map(item => {
            const id = item.requestId || item.id;
            const workerName = item.workerName || item.agentName || "Worker";
            const avatarBg = avatarColor(workerName);
            const leftColor = getLeftBorderColor(item);
            const ruleLine = item.ruleName || item.rule || null;
            return (
              <div key={id} style={{ background: "var(--bg-400)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, borderLeft: `3px solid ${leftColor}` }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                  {/* Avatar */}
                  <div style={{ width: 36, height: 36, borderRadius: "50%", background: avatarBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "#fff", fontWeight: 700, fontSize: 15 }}>
                    {(workerName || "W")[0].toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <span style={{ fontWeight: 600, color: "var(--text-100, var(--text-primary))", fontSize: 15 }}>{workerName}</span>
                      </div>
                      <span style={{ fontSize: 12, color: "var(--text-300, var(--text-tertiary))", fontFamily: "var(--font-mono)", flexShrink: 0, marginLeft: 12 }}>
                        {item.createdAt ? timeAgo(item.createdAt) : ""}
                      </span>
                    </div>
                    <div style={{ color: "var(--text-200, var(--text-secondary))", fontSize: 14, marginTop: 4 }}>
                      {item.action || item.summary || item.description || "Action requires approval"}
                    </div>
                    {ruleLine && (
                      <div style={{ color: "var(--text-300, var(--text-tertiary))", fontSize: 12, fontFamily: "var(--font-mono)", marginTop: 6 }}>
                        Matched: {ruleLine}
                      </div>
                    )}
                    {item.detail && (
                      <div style={{ fontSize: 13, color: "var(--text-300, var(--text-tertiary))", lineHeight: 1.5, marginTop: 4 }}>{item.detail}</div>
                    )}
                    {/* Action buttons */}
                    <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                      {item.type === "connection" ? (
                        <button style={{ padding: "8px 20px", background: "var(--primary, #6366f1)", color: "#fff", border: "none", borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Reconnect</button>
                      ) : (<>
                        <button
                          style={{ padding: "8px 20px", background: "var(--green, #5bb98c)", color: "#fff", border: "none", borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: "pointer", opacity: deciding === id ? 0.6 : 1 }}
                          disabled={deciding === id}
                          onClick={() => handleDecide(id, "approved")}
                        >Approve</button>
                        <button
                          style={{ padding: "8px 20px", background: "transparent", color: "var(--text-200, var(--text-secondary))", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, cursor: "pointer", opacity: deciding === id ? 0.6 : 1 }}
                          disabled={deciding === id}
                          onClick={() => handleDecide(id, "denied")}
                        >Deny</button>
                      </>)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ApprovalsView() {
  const [items, setItems] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState(null);

  useEffect(() => { loadApprovals(); }, []);
  async function loadApprovals() { setLoading(true); try { const runtime = loadRuntimeConfig(); const [pending, decided] = await Promise.all([fetchApprovalInbox(runtime, { status: "pending" }), fetchApprovalInbox(runtime, { status: "decided" })]); setItems(pending?.items || pending || []); setHistory(decided?.items || decided || []); } catch { setItems([]); setHistory([]); } setLoading(false); }
  async function handleDecide(requestId, approved) { setDeciding(requestId); try { const runtime = loadRuntimeConfig(); await decideApprovalInboxItem(runtime, requestId, { approved }); await loadApprovals(); } catch { /* ignore */ } setDeciding(null); }

  return (
    <div>
      <h1 style={S.pageTitle}>Approvals</h1>
      <p style={S.pageSub}>Workers ask before taking sensitive actions. Review and decide here.</p>
      {loading ? <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Loading...</div> : (<>
        {items.length === 0 ? (
          <div style={{ padding: "3rem 2rem", textAlign: "center", border: "1px dashed var(--border)", borderRadius: 12, marginBottom: "3rem" }}>
            <div style={{ fontSize: "1rem", fontWeight: 600, color: "var(--text-primary)", marginBottom: "0.3rem" }}>Nothing pending</div>
            <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>When a worker needs your approval, it will appear here.</div>
          </div>
        ) : (
          <div style={{ marginBottom: "3rem" }}>
            {items.map(item => (
              <div key={item.requestId || item.id} style={S.approvalRow}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "0.25rem" }}>{item.workerName || item.agentName || "Worker"}</div>
                    <div style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "0.25rem" }}>{item.action || item.summary || item.description || "Action requires approval"}</div>
                    {item.detail && <div style={{ fontSize: "13px", color: "var(--text-tertiary)", lineHeight: 1.5 }}>{item.detail}</div>}
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--text-tertiary)", flexShrink: 0, marginLeft: "1rem" }}>{item.createdAt ? timeAgo(item.createdAt) : ""}</div>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
                  <button style={{ ...S.btnPrimary, width: "auto", padding: "0.5rem 1.25rem", fontSize: "13px" }} disabled={deciding === (item.requestId || item.id)} onClick={() => handleDecide(item.requestId || item.id, true)}>Approve</button>
                  <button style={{ ...S.btnSecondary, padding: "0.5rem 1.25rem", fontSize: "13px" }} disabled={deciding === (item.requestId || item.id)} onClick={() => handleDecide(item.requestId || item.id, false)}>Deny</button>
                </div>
              </div>
            ))}
          </div>
        )}
        {history.length > 0 && (<>
          <div style={{ ...S.label, marginBottom: "1rem" }}>Recent decisions</div>
          {history.slice(0, 20).map(item => (
            <div key={item.requestId || item.id} style={{ ...S.approvalRow, opacity: 0.7 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <div>
                  <span style={{ fontSize: "14px", color: "var(--text-secondary)" }}>{item.workerName || item.agentName || "Worker"}</span>
                  <span style={{ fontSize: "13px", color: "var(--text-tertiary)", marginLeft: "0.75rem" }}>{item.action || item.summary || "Action"}</span>
                </div>
                <span style={{ fontSize: "12px", fontWeight: 600, color: item.approved || item.decision === "approved" ? "#5bb98c" : "#c97055" }}>{item.approved || item.decision === "approved" ? "Approved" : "Denied"}</span>
              </div>
            </div>
          ))}
        </>)}
      </>)}
    </div>
  );
}

export { ApprovalsView };
export default InboxView;
