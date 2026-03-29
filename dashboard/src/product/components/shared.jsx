import React, { useState } from "react";
import { S } from "../shared.js";

/* ===================================================================
   FocusInput
   =================================================================== */

export function FocusInput({ id, style, baseStyle, focusStyle, ...props }) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      {...props}
      id={id}
      style={{ ...(baseStyle || S.input), ...style, ...(focused ? (focusStyle || S.inputFocus) : {}) }}
      onFocus={(e) => { setFocused(true); props.onFocus?.(e); }}
      onBlur={(e) => { setFocused(false); props.onBlur?.(e); }}
    />
  );
}

/* ===================================================================
   SendArrow
   =================================================================== */

export function SendArrow({ disabled, onClick }) {
  return (
    <button
      onClick={onClick} disabled={disabled} aria-label="Send"
      style={{
        width: 32, height: 32, borderRadius: "50%",
        background: disabled ? "var(--bg-hover)" : "var(--text-primary)",
        border: "none", cursor: disabled ? "default" : "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0, transition: "opacity 150ms",
        opacity: disabled ? 0.3 : 1,
      }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ display: "block" }}>
        <path d="M8 12V4M4 8l4-4 4 4" stroke={disabled ? "var(--text-tertiary)" : "var(--bg-primary)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

/* ===================================================================
   CloseIcon
   =================================================================== */

export function CloseIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" style={{ display: "block" }}>
      <path d="M5 5l8 8M13 5l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
