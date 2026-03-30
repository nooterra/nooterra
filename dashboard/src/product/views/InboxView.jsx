import React, { useState, useEffect, useRef } from "react";
import { S, timeAgo, workerApiRequest } from "../shared.js";
import { track } from "../analytics.js";

function InboxView() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState(null);
  const [lastChecked, setLastChecked] = useState(null);
  const [error, setError] = useState(null);
  const fetchingRef = useRef(false);

  useEffect(() => { loadInbox(); const interval = setInterval(loadInbox, 10000); return () => clearInterval(interval); }, []);

  async function loadInbox() {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const result = await workerApiRequest({ pathname: "/v1/approvals" });
      setItems(result?.items || result || []);
    } catch (err) {
      console.error("Failed to load inbox:", err);
      setError("Failed to load inbox. Please try again.");
      setItems([]);
    }
    setLastChecked(new Date());
    setLoading(false);
    fetchingRef.current = false;
  }

  async function handleDecide(requestId, decision) {
    setDeciding(requestId);
    setError(null);
    try {
      const action = decision === "approved" ? "approve" : "deny";
      await workerApiRequest({
        pathname: `/v1/approvals/${encodeURIComponent(requestId)}/${action}`,
        method: "POST"
      });
      track("approval.decided", { decision, workerId: requestId });
      await loadInbox();
    } catch (err) {
      console.error("Failed to process decision:", err);
      setError(`Failed to ${decision === "approved" ? "approve" : "deny"} this action. Please try again.`);
    }
    setDeciding(null);
  }

  const allItems = Array.isArray(items) ? items : [];
  const pendingCount = allItems.filter(i => !i.status || i.status === "pending").length;
  const handledCount = allItems.filter(i => i.status === "approved" || i.status === "denied").length;
  const blockedCount = allItems.filter(i => i.status === "denied" || i.type === "charter_blocked").length;
  const stats = [
    { label: "waiting", value: pendingCount, color: "var(--amber, #c08c30)" },
    { label: "blocked", value: blockedCount, color: "var(--red, #c43a3a)" },
    { label: "handled", value: handledCount, color: "var(--green, #2a9d6e)" },
  ];

  const roleColors = ["var(--accent, #c4613a)", "var(--amber, #c08c30)", "var(--green, #2a9d6e)", "var(--red, #c43a3a)", "var(--text-200, #a3a39d)", "var(--accent, #c4613a)", "var(--amber, #c08c30)"];
  function avatarColor(name) { let h = 0; for (let i = 0; i < (name || "").length; i++) h = (h + (name || "").charCodeAt(i)) % roleColors.length; return roleColors[h]; }
  function getLeftBorderColor(item) {
    if (item.type === "failure" || item.type === "error") return "var(--red, #c43a3a)";
    if (item.type === "info") return "var(--accent, #c4613a)";
    return "var(--amber, #c08c30)";
  }

  return (
    <div>
      <h1 style={S.pageTitle}>Inbox</h1>
      <p style={S.pageSub}>What needs you now.</p>
      {error && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", marginBottom: 16, borderRadius: 8, background: "var(--red-bg, rgba(196,58,58,0.08))", border: "1px solid var(--red, #c43a3a)", color: "var(--red, #c43a3a)", fontSize: "14px" }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{ background: "none", border: "none", color: "var(--red, #c43a3a)", cursor: "pointer", fontWeight: 700, fontSize: "16px", padding: "0 4px", lineHeight: 1 }} aria-label="Dismiss error">&times;</button>
        </div>
      )}

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

export default InboxView;
