import React, { useState } from "react";

/* ── Event type metadata ─────────────────────────────────────────── */
const EVENT_META = {
  start:             { label: "Started",          color: "var(--product-good, #2f6d56)",    bg: "var(--product-good-bg, rgba(47,109,86,0.12))" },
  system_prompt:     { label: "System prompt",    color: "#5b8def",                          bg: "rgba(91,141,239,0.12)" },
  llm_response:      { label: "LLM response",     color: "#5b8def",                          bg: "rgba(91,141,239,0.12)" },
  tool_call:         { label: "Tool call",         color: "#9b6dd7",                          bg: "rgba(155,109,215,0.12)" },
  tool_result:       { label: "Tool result",       color: "#9b6dd7",                          bg: "rgba(155,109,215,0.12)" },
  approval_required: { label: "Approval required", color: "var(--product-warn, #8a612f)",    bg: "var(--product-warn-bg, rgba(138,97,47,0.13))" },
  approval_granted:  { label: "Approval granted",  color: "var(--product-warn, #8a612f)",    bg: "var(--product-warn-bg, rgba(138,97,47,0.13))" },
  charter_blocked:   { label: "Charter blocked",   color: "var(--product-bad, #a15347)",     bg: "var(--product-bad-bg, rgba(161,83,71,0.12))" },
  memory_saved:      { label: "Memory saved",      color: "var(--product-good, #2f6d56)",    bg: "var(--product-good-bg, rgba(47,109,86,0.12))" },
  complete:          { label: "Complete",           color: "var(--product-good, #2f6d56)",    bg: "var(--product-good-bg, rgba(47,109,86,0.12))" },
  error:             { label: "Error",              color: "var(--product-bad, #a15347)",     bg: "var(--product-bad-bg, rgba(161,83,71,0.12))" },
};

function meta(type) {
  return EVENT_META[type] || { label: type, color: "var(--product-ink-soft, #707b8d)", bg: "rgba(112,123,141,0.10)" };
}

/* ── Helpers ──────────────────────────────────────────────────────── */

function relativeTimestamp(baseMs, eventMs) {
  const diff = (eventMs - baseMs) / 1000;
  if (diff < 0.01) return "+0s";
  if (diff < 10) return `+${diff.toFixed(1)}s`;
  if (diff < 60) return `+${Math.round(diff)}s`;
  const mins = Math.floor(diff / 60);
  const secs = Math.round(diff % 60);
  return `+${mins}m${secs}s`;
}

function statusLabel(activity) {
  if (!activity || activity.length === 0) return "unknown";
  const last = activity[activity.length - 1];
  if (last.type === "complete") return "complete";
  if (last.type === "error") return "error";
  if (last.type === "approval_required") return "awaiting approval";
  return "in progress";
}

function statusColor(status) {
  if (status === "complete") return "var(--product-good, #2f6d56)";
  if (status === "error") return "var(--product-bad, #a15347)";
  if (status === "awaiting approval") return "var(--product-warn, #8a612f)";
  return "var(--product-ink-soft, #707b8d)";
}

function isExpandable(type) {
  return type === "tool_call" || type === "tool_result";
}

/* ── Summary bar ─────────────────────────────────────────────────── */

function SummaryBar({ execution, activity }) {
  const status = statusLabel(activity);
  const sColor = statusColor(status);

  const first = activity[0]?.timestamp ? new Date(activity[0].timestamp).getTime() : 0;
  const last = activity[activity.length - 1]?.timestamp ? new Date(activity[activity.length - 1].timestamp).getTime() : 0;
  const durationSec = first && last ? ((last - first) / 1000) : 0;
  const durationStr = durationSec < 60 ? `${durationSec.toFixed(1)}s` : `${Math.floor(durationSec / 60)}m ${Math.round(durationSec % 60)}s`;

  const rounds = activity.filter(e => e.type === "llm_response").length;
  const toolCalls = activity.filter(e => e.type === "tool_call").length;

  const tokens = execution?.tokens ?? execution?.totalTokens ?? null;
  const cost = execution?.cost ?? null;

  const stats = [
    { label: "Duration", value: durationStr },
    { label: "LLM rounds", value: rounds },
    { label: "Tool calls", value: toolCalls },
    ...(tokens != null ? [{ label: "Tokens", value: tokens.toLocaleString() }] : []),
    ...(cost != null ? [{ label: "Cost", value: `$${cost.toFixed(4)}` }] : []),
    { label: "Status", value: status, color: sColor },
  ];

  return (
    <div style={{ display: "flex", gap: 1, background: "var(--product-line, var(--border))", borderRadius: 12, overflow: "hidden", border: "1px solid var(--product-line, var(--border))", marginBottom: 24 }}>
      {stats.map(s => (
        <div key={s.label} style={{ flex: 1, padding: "14px 12px", background: "var(--product-panel-strong, var(--bg-400))", minWidth: 0 }}>
          <div style={{ fontSize: "16px", fontWeight: 700, color: s.color || "var(--product-ink-strong, var(--text-primary))", fontVariantNumeric: "tabular-nums", fontFamily: "var(--font-display, 'Fraunces', serif)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.value}</div>
          <div style={{ fontSize: "10px", fontWeight: 600, color: "var(--product-ink-soft, var(--text-tertiary))", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 3 }}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}

/* ── Timeline event row ──────────────────────────────────────────── */

function EventRow({ event, baseMs, isLast }) {
  const [expanded, setExpanded] = useState(false);
  const m = meta(event.type);
  const expandable = isExpandable(event.type);
  const eventMs = event.timestamp ? new Date(event.timestamp).getTime() : baseMs;

  const detail = event.arguments || event.result || event.detail || event.data || null;
  const hasDetail = expandable && detail != null;

  return (
    <div
      style={{ display: "flex", gap: 0, cursor: hasDetail ? "pointer" : "default" }}
      onClick={hasDetail ? () => setExpanded(prev => !prev) : undefined}
    >
      {/* Timeline spine */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 24, flexShrink: 0, paddingTop: 2 }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: m.color, flexShrink: 0, boxShadow: `0 0 0 3px ${m.bg}` }} />
        {!isLast && <div style={{ flex: 1, width: 2, background: "var(--product-line, var(--border))", marginTop: 4 }} />}
      </div>

      {/* Event content */}
      <div style={{ flex: 1, paddingBottom: isLast ? 0 : 16, paddingLeft: 12, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          {/* Timestamp */}
          <span style={{ fontSize: "11px", fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace", color: "var(--product-ink-soft, var(--text-tertiary))", flexShrink: 0 }}>
            {relativeTimestamp(baseMs, eventMs)}
          </span>
          {/* Type badge */}
          <span style={{ fontSize: "11px", fontWeight: 600, color: m.color, background: m.bg, padding: "2px 8px", borderRadius: 6, whiteSpace: "nowrap" }}>
            {m.label}
          </span>
          {/* Expand indicator */}
          {hasDetail && (
            <span style={{ fontSize: "11px", color: "var(--product-ink-soft, var(--text-tertiary))", userSelect: "none" }}>
              {expanded ? "\u25BE" : "\u25B8"}
            </span>
          )}
        </div>
        {/* Message */}
        {event.message && (
          <div style={{ fontSize: "13px", color: "var(--product-ink, var(--text-secondary))", marginTop: 4, lineHeight: 1.5, wordBreak: "break-word" }}>
            {event.message}
          </div>
        )}
        {/* Expanded detail */}
        {expanded && hasDetail && (
          <pre style={{
            marginTop: 8, padding: "10px 12px", borderRadius: 8,
            background: "var(--product-panel-soft, var(--bg-300, rgba(0,0,0,0.15)))",
            border: "1px solid var(--product-line, var(--border))",
            fontSize: "12px", fontFamily: "'IBM Plex Mono', monospace",
            color: "var(--product-ink, var(--text-secondary))",
            overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word",
            maxHeight: 300, overflowY: "auto",
          }}>
            {typeof detail === "string" ? detail : JSON.stringify(detail, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

/* ── Main component ──────────────────────────────────────────────── */

function ExecutionTraceViewer({ execution, activity, onClose }) {
  if (!activity || activity.length === 0) {
    return (
      <div style={{ padding: "2rem 0", textAlign: "center", color: "var(--product-ink-soft, var(--text-tertiary))", fontSize: "14px" }}>
        No activity recorded for this execution.
      </div>
    );
  }

  const baseMs = activity[0]?.timestamp ? new Date(activity[0].timestamp).getTime() : Date.now();

  return (
    <div>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {onClose && (
            <button
              onClick={onClose}
              style={{ background: "none", border: "1px solid var(--product-line, var(--border))", borderRadius: 8, padding: "5px 10px", fontSize: "12px", fontWeight: 600, color: "var(--product-ink, var(--text-secondary))", cursor: "pointer", lineHeight: 1 }}
            >
              &larr; Back
            </button>
          )}
          <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--product-ink-strong, var(--text-primary))" }}>
            Execution trace
          </div>
        </div>
        <div style={{ fontSize: "12px", color: "var(--product-ink-soft, var(--text-tertiary))" }}>
          {activity.length} event{activity.length !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Summary */}
      <SummaryBar execution={execution || {}} activity={activity} />

      {/* Timeline */}
      <div style={{ paddingLeft: 4 }}>
        {activity.map((event, i) => (
          <EventRow
            key={`${event.type}-${event.timestamp}-${i}`}
            event={event}
            baseMs={baseMs}
            isLast={i === activity.length - 1}
          />
        ))}
      </div>
    </div>
  );
}

export default ExecutionTraceViewer;
