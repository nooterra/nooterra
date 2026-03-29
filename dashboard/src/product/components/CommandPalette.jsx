import React, { useState, useEffect, useRef } from "react";

function CommandPalette({ open, onClose, workers, onNavigate, onSelectWorker, onToggleTheme }) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  useEffect(() => { setQuery(""); setSelectedIndex(0); }, [open]);

  if (!open) return null;

  const staticActions = [
    { id: "inbox", label: "Go to Inbox", section: "Navigate", action: () => onNavigate("inbox") },
    { id: "team", label: "Go to Team", section: "Navigate", action: () => onNavigate("team") },
    { id: "activity", label: "Go to Activity", section: "Navigate", action: () => onNavigate("activity") },
    { id: "performance", label: "Go to Performance", section: "Navigate", action: () => onNavigate("performance") },
    { id: "connections", label: "Go to Connections", section: "Navigate", action: () => onNavigate("connections") },
    { id: "new-worker", label: "New Worker", section: "Actions", action: () => onNavigate("builder") },
    { id: "settings", label: "Open Settings", section: "Actions", action: () => onNavigate("settings") },
    { id: "theme", label: "Toggle Dark Mode", section: "Actions", action: onToggleTheme },
  ];

  const workerActions = (workers || []).map(w => ({
    id: `worker-${w.id}`,
    label: w.name,
    section: "Workers",
    meta: w.status,
    action: () => onSelectWorker(w),
  }));

  const allActions = [...staticActions, ...workerActions];

  const q = query.toLowerCase().trim();
  const filtered = q
    ? allActions.filter(a => a.label.toLowerCase().includes(q) || (a.meta && a.meta.toLowerCase().includes(q)))
    : allActions;

  const clamped = Math.min(selectedIndex, filtered.length - 1);

  function handleKeyDown(e) {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, filtered.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, 0)); return; }
    if (e.key === "Enter" && filtered[clamped]) {
      e.preventDefault();
      filtered[clamped].action();
      onClose();
      return;
    }
  }

  // Group by section
  const sections = {};
  for (const item of filtered) {
    if (!sections[item.section]) sections[item.section] = [];
    sections[item.section].push(item);
  }

  let globalIndex = 0;

  return (
    <div
      className="modal-backdrop"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ alignItems: "flex-start", paddingTop: "min(20vh, 160px)" }}
    >
      <div
        className="popover-animate"
        style={{
          width: "100%", maxWidth: 520, background: "var(--bg-400, var(--bg-surface))",
          border: "1px solid var(--border)", borderRadius: 16,
          boxShadow: "var(--shadow-xl)", overflow: "hidden",
        }}
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
            placeholder="Type a command or search..."
            aria-label="Command palette search"
            style={{
              width: "100%", padding: "8px 0", fontSize: "15px", fontFamily: "inherit",
              border: "none", outline: "none", background: "transparent",
              color: "var(--text-100, var(--text-primary))", boxSizing: "border-box",
            }}
          />
        </div>

        {/* Results */}
        <div style={{ maxHeight: 360, overflowY: "auto", padding: "4px 0" }}>
          {filtered.length === 0 && (
            <div style={{ padding: "24px 16px", textAlign: "center", fontSize: "13px", color: "var(--text-300, var(--text-tertiary))" }}>
              No results for &ldquo;{query}&rdquo;
            </div>
          )}
          {Object.entries(sections).map(([section, items]) => (
            <div key={section}>
              <div style={{
                padding: "8px 16px 4px", fontSize: "10px", fontWeight: 700,
                color: "var(--text-300, var(--text-tertiary))", textTransform: "uppercase",
                letterSpacing: "0.08em", fontFamily: "var(--font-mono)",
              }}>{section}</div>
              {items.map(item => {
                const idx = globalIndex++;
                const isActive = idx === clamped;
                return (
                  <button
                    key={item.id}
                    onClick={() => { item.action(); onClose(); }}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      width: "100%", padding: "8px 16px", fontSize: "14px",
                      fontFamily: "inherit", border: "none", cursor: "pointer",
                      background: isActive ? "var(--bg-200, var(--bg-hover))" : "transparent",
                      color: isActive ? "var(--text-100, var(--text-primary))" : "var(--text-200, var(--text-secondary))",
                      textAlign: "left", transition: "background 80ms",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-200, var(--bg-hover))"; }}
                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
                  >
                    <span>{item.label}</span>
                    {item.meta && (
                      <span style={{ fontSize: "11px", color: "var(--text-300)", fontFamily: "var(--font-mono)" }}>{item.meta}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer hint */}
        <div style={{
          padding: "8px 16px", borderTop: "1px solid var(--border)",
          fontSize: "11px", color: "var(--text-300, var(--text-tertiary))",
          display: "flex", gap: 12,
        }}>
          <span><kbd style={{ padding: "1px 4px", borderRadius: 3, border: "1px solid var(--border)", fontSize: "10px", fontFamily: "var(--font-mono)" }}>&#8593;&#8595;</kbd> navigate</span>
          <span><kbd style={{ padding: "1px 4px", borderRadius: 3, border: "1px solid var(--border)", fontSize: "10px", fontFamily: "var(--font-mono)" }}>&#8629;</kbd> select</span>
          <span><kbd style={{ padding: "1px 4px", borderRadius: 3, border: "1px solid var(--border)", fontSize: "10px", fontFamily: "var(--font-mono)" }}>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

export default CommandPalette;
