import React, { useState, useEffect } from "react";
import { S, STATUS_COLORS, timeAgo, humanizeSchedule, getGreeting, workerApiRequest } from "../shared.js";

function WorkersListView({ onSelect, onCreate }) {
  const [workers, setWorkers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const userName = typeof localStorage !== "undefined" ? localStorage.getItem("nooterra_user_name") : null;
  useEffect(() => { (async () => { try { const result = await workerApiRequest({ pathname: "/v1/workers", method: "GET" }); setWorkers(result?.items || result || []); } catch { setWorkers([]); } setLoading(false); })(); }, []);

  const filteredWorkers = searchQuery.trim()
    ? workers.filter(w => {
        const q = searchQuery.toLowerCase();
        return (w.name || "").toLowerCase().includes(q) ||
               (w.status || "").toLowerCase().includes(q) ||
               (w.description || "").toLowerCase().includes(q);
      })
    : workers;

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ ...S.pageTitle, marginBottom: 2 }}>
            {getGreeting()}{userName ? `, ${userName}` : ""}
          </h1>
          <p style={{ ...S.pageSub, marginBottom: 0 }}>
            {loading ? "Loading your team..." : workers.length === 0 ? "No workers yet." : `${workers.filter(w => w.status === "running").length} of ${workers.length} workers active`}
          </p>
        </div>
        <button style={{ ...S.btnPrimary, width: "auto", flexShrink: 0 }} onClick={onCreate}>New worker</button>
      </div>
      {!loading && workers.length > 3 && (
        <div style={{ marginBottom: 16, position: "relative" }}>
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search workers..."
            aria-label="Search workers"
            style={{
              width: "100%", padding: "10px 14px", paddingLeft: 36,
              fontSize: "14px", fontFamily: "inherit",
              border: "1px solid var(--border)", borderRadius: 8,
              background: "var(--bg-400, var(--bg-surface))",
              color: "var(--text-100, var(--text-primary))",
              outline: "none", boxSizing: "border-box",
              transition: "border-color 150ms",
            }}
            onFocus={e => { e.currentTarget.style.borderColor = "var(--border-strong, var(--accent))"; }}
            onBlur={e => { e.currentTarget.style.borderColor = "var(--border)"; }}
          />
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
            <circle cx="7" cy="7" r="4.5" stroke="var(--text-300)" strokeWidth="1.5" fill="none" />
            <path d="M10.5 10.5L14 14" stroke="var(--text-300)" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      )}
      {loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{ height: 56, borderRadius: 8, background: "var(--bg-300, var(--bg-hover))", animation: "skeletonPulse 1.5s ease-in-out infinite", animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
      )}
      {!loading && workers.length === 0 && (
        <div style={{ padding: "3rem 1.5rem", textAlign: "center", border: "1px dashed var(--border)", borderRadius: 12 }}>
          <div style={{ fontSize: "1rem", fontWeight: 600, color: "var(--text-primary)", marginBottom: "0.5rem" }}>Your first worker is waiting</div>
          <div style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "1.5rem", maxWidth: 360, margin: "0 auto 1.5rem" }}>Describe what you need and we'll set up a worker for you.</div>
          <button style={{ ...S.btnPrimary, width: "auto" }} onClick={onCreate}>Create worker</button>
        </div>
      )}
      {!loading && filteredWorkers.length === 0 && searchQuery.trim() && (
        <div style={{ padding: "2rem", textAlign: "center", fontSize: "14px", color: "var(--text-secondary)" }}>
          No workers match &ldquo;{searchQuery}&rdquo;
        </div>
      )}
      {!loading && filteredWorkers.length > 0 && (
        <div>
          {filteredWorkers.map(w => (
            <div
              key={w.id}
              onClick={() => onSelect(w)}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "14px 0", borderBottom: "1px solid var(--border)",
                cursor: "pointer", transition: "background 100ms",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-hover, var(--bg-300))"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{
                ...S.statusDot(STATUS_COLORS[w.status] || STATUS_COLORS.ready),
                marginRight: 0, flexShrink: 0,
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.name}</div>
                <div style={{ fontSize: "12px", color: "var(--text-tertiary)", marginTop: 2 }}>
                  {w.status}{w.lastRun || w.lastRunAt ? ` · ${timeAgo(w.lastRun || w.lastRunAt)}` : ""}{w.schedule ? ` · ${humanizeSchedule(w.schedule)}` : ""}
                </div>
              </div>
              <div style={{ fontSize: "13px", color: "var(--text-tertiary)", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                {w.cost != null ? `$${(typeof w.cost === "number" ? w.cost : 0).toFixed(2)}` : ""}
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" style={{ flexShrink: 0, opacity: 0.5 }}><polyline points="9 18 15 12 9 6"/></svg>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default WorkersListView;
