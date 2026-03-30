import React, { useState, useEffect, useRef } from "react";
import { S, STATUS_COLORS, timeAgo, humanizeSchedule, getGreeting, workerApiRequest } from "../shared.js";

const STATUS_LABELS = {
  running: "Running",
  paused: "Paused",
  ready: "Ready",
  error: "Error",
};

function WorkerCard({ worker, onClick, index = 0 }) {
  const charter = (() => { try { return typeof worker.charter === "string" ? JSON.parse(worker.charter) : worker.charter; } catch { return null; } })();
  const stats = typeof worker.stats === "string" ? (() => { try { return JSON.parse(worker.stats); } catch { return null; } })() : worker.stats;
  const statusColor = STATUS_COLORS[worker.status] || STATUS_COLORS.ready;
  const isRunning = worker.status === "running";
  const totalRuns = stats?.totalRuns ?? worker.total_runs ?? 0;
  const successRate = stats?.totalRuns > 0 && stats?.successfulRuns != null
    ? Math.round((stats.successfulRuns / stats.totalRuns) * 100) : null;

  return (
    <button
      onClick={onClick}
      className="worker-card"
      aria-label={`View ${worker.name} — ${worker.status}`}
      style={{
        display: "flex", flexDirection: "column", gap: 0,
        padding: 0, border: "1px solid var(--border)",
        borderRadius: 12, cursor: "pointer",
        background: "var(--bg-surface, var(--bg-400))",
        textAlign: "left", fontFamily: "inherit",
        overflow: "hidden", width: "100%",
        animation: `cardEnter 0.3s cubic-bezier(0.16,1,0.3,1) ${index * 0.05}s both`,
      }}
    >
      {/* Header: status bar + name */}
      <div style={{ padding: "14px 16px 10px", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
          background: statusColor,
          ...(isRunning ? { animation: "workerCardPulse 2s ease-in-out infinite" } : {}),
        }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: "15px", fontWeight: 600, color: "var(--text-primary)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{worker.name}</div>
        </div>
        <span style={{
          fontSize: "11px", fontWeight: 600, textTransform: "uppercase",
          letterSpacing: "0.04em", color: statusColor,
          padding: "2px 8px", borderRadius: 4,
          background: `color-mix(in srgb, ${statusColor} 10%, transparent)`,
        }}>
          {STATUS_LABELS[worker.status] || worker.status}
        </span>
      </div>

      {/* Description */}
      {worker.description && (
        <div style={{
          padding: "0 16px 10px", fontSize: "13px", color: "var(--text-secondary)",
          lineHeight: 1.5, overflow: "hidden", textOverflow: "ellipsis",
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
        }}>
          {worker.description}
        </div>
      )}

      {/* Charter summary pills */}
      {charter && (charter.canDo?.length > 0 || charter.askFirst?.length > 0 || charter.neverDo?.length > 0) && (
        <div style={{ padding: "0 16px 10px", display: "flex", gap: 6, flexWrap: "wrap" }}>
          {charter.canDo?.length > 0 && (
            <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--green, #2a9d6e)", padding: "2px 8px", borderRadius: 4, background: "rgba(42,157,110,0.08)" }}>
              {charter.canDo.length} can do
            </span>
          )}
          {charter.askFirst?.length > 0 && (
            <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--amber, #c08c30)", padding: "2px 8px", borderRadius: 4, background: "rgba(192,140,48,0.08)" }}>
              {charter.askFirst.length} ask first
            </span>
          )}
          {charter.neverDo?.length > 0 && (
            <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--red, #c43a3a)", padding: "2px 8px", borderRadius: 4, background: "rgba(196,58,58,0.08)" }}>
              {charter.neverDo.length} never
            </span>
          )}
        </div>
      )}

      {/* Stats footer */}
      <div style={{
        display: "flex", gap: 0, borderTop: "1px solid var(--border)",
        background: "var(--bg-300, var(--bg-hover))",
      }}>
        <div style={{ flex: 1, padding: "10px 16px" }}>
          <div style={{ fontSize: "10px", fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Last run</div>
          <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: 1, fontVariantNumeric: "tabular-nums" }}>
            {worker.lastRun || worker.last_run_at ? timeAgo(worker.lastRun || worker.last_run_at) : "Never"}
          </div>
        </div>
        <div style={{ flex: 1, padding: "10px 16px", borderLeft: "1px solid var(--border)" }}>
          <div style={{ fontSize: "10px", fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Runs</div>
          <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: 1, fontVariantNumeric: "tabular-nums" }}>
            {totalRuns}{successRate != null ? ` · ${successRate}%` : ""}
          </div>
        </div>
        <div style={{ flex: 1, padding: "10px 16px", borderLeft: "1px solid var(--border)" }}>
          <div style={{ fontSize: "10px", fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Schedule</div>
          <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {humanizeSchedule(worker.schedule) || "Manual"}
          </div>
        </div>
      </div>
    </button>
  );
}

function WorkersListView({ onSelect, onCreate }) {
  const [workers, setWorkers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState(null);
  const [sortBy, setSortBy] = useState("recent");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(interval);
  }, []);
  const userName = typeof localStorage !== "undefined" ? localStorage.getItem("nooterra_user_name") : null;
  const fetchingRef = useRef(false);
  async function loadWorkers() {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try { setError(null); const result = await workerApiRequest({ pathname: "/v1/workers", method: "GET" }); setWorkers(result?.workers || result?.items || (Array.isArray(result) ? result : [])); } catch (err) { console.error("Failed to load workers:", err); setError("Failed to load workers. Please try again."); setWorkers([]); }
    setLoading(false);
    fetchingRef.current = false;
  }
  useEffect(() => { loadWorkers(); const interval = setInterval(loadWorkers, 30000); return () => clearInterval(interval); }, []);

  const filteredWorkers = searchQuery.trim()
    ? workers.filter(w => {
        const q = searchQuery.toLowerCase();
        return (w.name || "").toLowerCase().includes(q) ||
               (w.status || "").toLowerCase().includes(q) ||
               (w.description || "").toLowerCase().includes(q);
      })
    : workers;

  const runningCount = workers.filter(w => w.status === "running").length;

  return (
    <div>
      <style>{`
        @keyframes workerCardPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes cardEnter { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes shimmer { 0%, 100% { opacity: 0.3; } 50% { opacity: 0.6; } }
        .worker-card { transition: border-color 200ms, box-shadow 200ms, transform 200ms; }
        .worker-card:hover { border-color: var(--border-strong, var(--accent)); box-shadow: 0 4px 16px rgba(0,0,0,0.08); transform: translateY(-2px); }
        @media (prefers-reduced-motion: reduce) { .worker-card, [style*="cardEnter"] { animation: none !important; } }
      `}</style>

      {error && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", marginBottom: 16, borderRadius: 8, background: "var(--red-bg, rgba(196,58,58,0.08))", border: "1px solid var(--red, #c43a3a)", color: "var(--red, #c43a3a)", fontSize: "14px" }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{ background: "none", border: "none", color: "var(--red, #c43a3a)", cursor: "pointer", fontWeight: 700, fontSize: "16px", padding: "0 4px", lineHeight: 1 }} aria-label="Dismiss error">&times;</button>
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ ...S.pageTitle, marginBottom: 2 }}>
            {getGreeting()}{userName ? `, ${userName}` : ""}
          </h1>
          <p style={{ ...S.pageSub, marginBottom: 0 }}>
            {loading ? "Loading your team..." : workers.length === 0 ? "No workers yet." : `${runningCount} of ${workers.length} worker${workers.length !== 1 ? "s" : ""} active`}
          </p>
        </div>
        <button style={{ ...S.btnPrimary, width: "auto", flexShrink: 0 }} onClick={onCreate}>New worker</button>
      </div>

      {/* Search */}
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

      {/* Loading skeleton */}
      {loading && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{ borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
              <div style={{ padding: "14px 16px", display: "flex", gap: 10, alignItems: "center" }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--bg-300)", animation: "shimmer 1.5s ease-in-out infinite" }} />
                <div style={{ height: 16, flex: 1, borderRadius: 4, background: "var(--bg-300)", animation: "shimmer 1.5s ease-in-out infinite", animationDelay: `${i * 0.1}s` }} />
              </div>
              <div style={{ padding: "0 16px 14px" }}>
                <div style={{ height: 12, width: "80%", borderRadius: 4, background: "var(--bg-300)", animation: "shimmer 1.5s ease-in-out infinite", animationDelay: `${i * 0.1 + 0.05}s` }} />
              </div>
              <div style={{ display: "flex", borderTop: "1px solid var(--border)", background: "var(--bg-300)" }}>
                {[1, 2, 3].map(j => (
                  <div key={j} style={{ flex: 1, padding: "10px 16px", borderLeft: j > 1 ? "1px solid var(--border)" : "none" }}>
                    <div style={{ height: 8, width: 40, borderRadius: 3, background: "var(--bg-hover)", animation: "shimmer 1.5s ease-in-out infinite", marginBottom: 4 }} />
                    <div style={{ height: 12, width: 50, borderRadius: 3, background: "var(--bg-hover)", animation: "shimmer 1.5s ease-in-out infinite" }} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && workers.length === 0 && (
        <div style={{ textAlign: 'center', padding: '3rem 1.5rem', color: 'var(--text-secondary, #999)' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🤖</div>
          <div style={{ fontSize: '0.95rem', fontWeight: 500 }}>No workers yet</div>
          <div style={{ fontSize: '0.85rem', marginTop: '0.25rem', opacity: 0.7 }}>Create your first AI worker to get started</div>
          <button style={{ ...S.btnPrimary, width: "auto", padding: "10px 28px", marginTop: "1.25rem" }} onClick={onCreate}>Create your first team</button>
        </div>
      )}

      {/* No search results */}
      {!loading && filteredWorkers.length === 0 && searchQuery.trim() && (
        <div style={{ padding: "2rem", textAlign: "center", fontSize: "14px", color: "var(--text-secondary)" }}>
          No workers match &ldquo;{searchQuery}&rdquo;
        </div>
      )}

      {/* Sort + Worker cards grid */}
      {!loading && filteredWorkers.length > 0 && (() => {
        const sorted = [...filteredWorkers].sort((a, b) => {
          if (sortBy === "name") return (a.name || "").localeCompare(b.name || "");
          if (sortBy === "status") return (a.status || "").localeCompare(b.status || "");
          if (sortBy === "runs") return ((typeof b.stats === "object" ? b.stats : {})?.totalRuns || b.total_runs || 0) - ((typeof a.stats === "object" ? a.stats : {})?.totalRuns || a.total_runs || 0);
          // "recent" — sort by last run or creation
          return new Date(b.last_run_at || b.created_at || 0) - new Date(a.last_run_at || a.created_at || 0);
        });
        return (<>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: "12px", color: "var(--product-ink-soft, var(--text-300))" }}>Sort by</span>
            <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{
              fontSize: "12px", padding: "4px 8px", borderRadius: 6,
              border: "1px solid var(--product-line, var(--border))", background: "var(--product-panel, var(--bg-400))",
              color: "var(--product-ink-strong, var(--text-100))", cursor: "pointer", fontFamily: "inherit",
            }}>
              <option value="recent">Most recent</option>
              <option value="name">Name A-Z</option>
              <option value="status">Status</option>
              <option value="runs">Most runs</option>
            </select>
          </div>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
            gap: 12,
          }}>
            {sorted.map((w, i) => (
              <WorkerCard key={w.id} worker={w} onClick={() => onSelect(w)} index={i} />
            ))}
          </div>
        </>);
      })()}
    </div>
  );
}

export default WorkersListView;
