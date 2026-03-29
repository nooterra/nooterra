import React, { useState, useEffect, useRef } from "react";
import { ALL_MODELS, MODEL_CATEGORIES } from "../shared.js";

function ModelDropdown({ model, onModelChange, providerFilter }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef(null);
  const searchRef = useRef(null);
  const selectedModel = ALL_MODELS.find(m => m.id === model);

  useEffect(() => {
    if (!open) return;
    function handleClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  useEffect(() => {
    if (open && searchRef.current) searchRef.current.focus();
  }, [open]);

  // Filter models by provider if BYOK provider is selected
  const baseModels = providerFilter
    ? ALL_MODELS.filter(m => m.provider.toLowerCase() === providerFilter.toLowerCase() || m.id.startsWith(providerFilter + "/"))
    : ALL_MODELS;

  const filtered = search.trim()
    ? baseModels.filter(m =>
        m.name.toLowerCase().includes(search.toLowerCase()) ||
        m.provider.toLowerCase().includes(search.toLowerCase()) ||
        m.category.toLowerCase().includes(search.toLowerCase())
      )
    : baseModels;

  const priceColor = (price) => {
    if (price === "Free") return "var(--green)";
    if (price === "$") return "var(--text-tertiary)";
    if (price === "$$") return "var(--amber)";
    return "var(--red)";
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => { setOpen(!open); setSearch(""); }}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          background: "transparent", border: "none", color: "var(--text-secondary)",
          fontSize: "13px", padding: "4px 8px", cursor: "pointer", fontFamily: "inherit",
          display: "flex", alignItems: "center", gap: 4, borderRadius: 6,
        }}
      >
        {selectedModel?.name || "Select model"}
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div
          className="popover-animate"
          role="listbox"
          onKeyDown={e => { if (e.key === "Escape") setOpen(false); }}
          style={{
            position: "absolute", top: "100%", left: 0, marginTop: 4,
            background: "var(--bg-400, var(--bg-surface))", border: "1px solid var(--border)",
            borderRadius: 12, boxShadow: "var(--shadow-lg)", zIndex: 200,
            minWidth: 340, maxWidth: 400, overflow: "hidden",
          }}
        >
          {/* Search input */}
          <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search models..." aria-label="Search models"
              style={{
                width: "100%", padding: "7px 10px", fontSize: "13px", fontFamily: "inherit",
                border: "1px solid var(--border)", borderRadius: 8, outline: "none",
                background: "var(--bg-primary, var(--bg-surface))", color: "var(--text-primary)",
                boxSizing: "border-box",
              }}
              onFocus={e => { e.currentTarget.style.borderColor = "var(--accent)"; }}
              onBlur={e => { e.currentTarget.style.borderColor = "var(--border)"; }}
            />
          </div>
          {/* Scrollable model list */}
          <div style={{ maxHeight: 400, overflowY: "auto", padding: "4px 0" }}>
            {MODEL_CATEGORIES.map(cat => {
              const catModels = filtered.filter(m => m.category === cat.key);
              if (catModels.length === 0) return null;
              return (
                <div key={cat.key}>
                  <div style={{
                    padding: "8px 14px 4px", fontSize: "10px", fontWeight: 700,
                    color: "var(--text-300, var(--text-tertiary))", textTransform: "uppercase",
                    letterSpacing: "0.08em", fontFamily: "var(--font-mono, monospace)",
                  }}>
                    {cat.label}
                  </div>
                  {catModels.map(m => {
                    const isSelected = m.id === model;
                    return (
                      <button
                        key={m.id}
                        role="option"
                        aria-selected={m.id === model}
                        onClick={() => { onModelChange(m.id); setOpen(false); }}
                        style={{
                          display: "flex", alignItems: "center", gap: 8,
                          width: "100%", padding: "7px 14px", fontSize: "13px",
                          background: isSelected ? "var(--bg-200, var(--bg-hover))" : "transparent",
                          color: isSelected ? "var(--text-primary)" : "var(--text-secondary)",
                          border: "none", borderLeft: isSelected ? "3px solid var(--accent)" : "3px solid transparent",
                          cursor: "pointer", fontFamily: "inherit", textAlign: "left",
                          transition: "background 150ms",
                        }}
                        onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "var(--bg-200, var(--bg-hover))"; }}
                        onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
                      >
                        <span style={{ flex: 1, fontWeight: isSelected ? 600 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {m.name}
                        </span>
                        <span style={{
                          fontSize: "11px", fontWeight: 600, color: priceColor(m.price),
                          minWidth: 32, textAlign: "center",
                        }}>
                          {m.price}
                        </span>
                        <span style={{
                          fontSize: "10px", padding: "2px 6px", borderRadius: 4,
                          background: "var(--bg-200, var(--bg-hover))", color: "var(--text-tertiary)",
                          fontWeight: 500, whiteSpace: "nowrap",
                        }}>
                          {m.provider}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div style={{ padding: "16px 14px", fontSize: "13px", color: "var(--text-tertiary)", textAlign: "center" }}>
                No models match your search
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default ModelDropdown;
