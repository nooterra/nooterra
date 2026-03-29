import React, { useState } from "react";

function InlineRuleAdder({ color, onAdd, label }) {
  const [text, setText] = useState("");
  return (
    <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
      <input
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter" && text.trim()) {
            e.preventDefault();
            onAdd(text.trim());
            setText("");
          }
        }}
        placeholder="Add rule..." aria-label={label ? "Add " + label + " rule" : "Add rule"}
        style={{
          flex: 1, fontSize: "12px", padding: "4px 8px", borderRadius: 6,
          border: "1px solid var(--border)", background: "var(--bg-100, var(--bg-primary))",
          color: "var(--text-100, var(--text-primary))", outline: "none",
          fontFamily: "var(--font-mono)", boxSizing: "border-box",
        }}
        onFocus={e => { e.target.style.borderColor = color; }}
        onBlur={e => { e.target.style.borderColor = "var(--border)"; }}
      />
      <button
        onClick={() => {
          if (text.trim()) {
            onAdd(text.trim());
            setText("");
          }
        }}
        style={{
          width: 24, height: 24, borderRadius: 6, border: "none",
          background: `${color}22`, color: color, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "14px", fontWeight: 700, padding: 0, flexShrink: 0,
        }}
      >+</button>
    </div>
  );
}

export default InlineRuleAdder;
