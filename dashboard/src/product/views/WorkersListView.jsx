import React, { useState, useEffect } from "react";
import { S, STATUS_COLORS, timeAgo, humanizeSchedule, getGreeting, workerApiRequest } from "../shared.js";

const STATUS_LABELS = {
  running: "Running",
  paused: "Paused",
  ready: "Ready",
  error: "Error",
};

function WorkerCard({ worker, onClick }) {
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
      aria-label={`View ${worker.name} — ${worker.status}`}
      style={{
        display: "flex", flexDirection: "column", gap: 0,
        padding: 0, border: "1px solid var(--border)",
        borderRadius: 12, cursor: "pointer",
        background: "var(--bg-surface, var(--bg-400))",
        textAlign: "left", fontFamily: "inherit",
        transition: "border-color 150ms, box-shadow 150ms",
        overflow: "hidden", width: "100%",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = "var(--border-strong, var(--accent))";
        e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.06)";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = "var(--border)";
        e.currentTarget.style.boxShadow = "none";
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

  const runningCount = workers.filter(w => w.status === "running").length;

  return (
    <div>
      <style>{`@keyframes workerCardPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>

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
            <div key={i} style={{ height: 160, borderRadius: 12, background: "var(--bg-300, var(--bg-hover))", animation: "skeletonPulse 1.5s ease-in-out infinite", animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && workers.length === 0 && (
        <div style={{ padding: "clamp(2rem, 6vh, 4rem) 1.5rem", textAlign: "center", border: "1px dashed var(--border)", borderRadius: 12, maxWidth: 480, margin: "0 auto" }}>
          <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: "0.75rem", lineHeight: 1.2 }}>Describe your business. We staff it.</div>
          <div style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "1rem", lineHeight: 1.6 }}>
            Nooterra builds you a team of AI workers — each with explicit rules about what they can do on their own, what needs your approval, and what's off-limits.
          </div>
          <div style={{ fontSize: "13px", color: "var(--text-tertiary)", marginBottom: "1.5rem", lineHeight: 1.6 }}>
            <strong style={{ color: "var(--green, #2a9d6e)" }}>Can do</strong> — worker handles it autonomously<br/>
            <strong style={{ color: "var(--amber, #c08c30)" }}>Ask first</strong> — pauses and routes to you for approval<br/>
            <strong style={{ color: "var(--red, #c43a3a)" }}>Never do</strong> — hard-blocked, no exceptions
          </div>
          <button style={{ ...S.btnPrimary, width: "auto" }} onClick={onCreate}>Create your first team</button>
        </div>
      )}

      {/* No search results */}
      {!loading && filteredWorkers.length === 0 && searchQuery.trim() && (
        <div style={{ padding: "2rem", textAlign: "center", fontSize: "14px", color: "var(--text-secondary)" }}>
          No workers match &ldquo;{searchQuery}&rdquo;
        </div>
      )}

      {/* Worker cards grid */}
      {!loading && filteredWorkers.length > 0 && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          gap: 12,
        }}>
          {filteredWorkers.map(w => (
            <WorkerCard key={w.id} worker={w} onClick={() => onSelect(w)} />
          ))}
        </div>
      )}
    </div>
  );
}

export default WorkersListView;
