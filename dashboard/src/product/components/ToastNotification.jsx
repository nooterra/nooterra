import React, { useState, useEffect } from "react";

const TOAST_ICONS = {
  success: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--green, #2a9d6e)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  error: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--red, #c43a3a)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
  info: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent, #c4613a)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
  warning: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--amber, #c08c30)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
};

const BORDER_COLORS = {
  success: "var(--green, #2a9d6e)",
  error: "var(--red, #c43a3a)",
  info: "var(--accent, #c4613a)",
  warning: "var(--amber, #c08c30)",
};

/**
 * Single toast item.
 */
function Toast({ id, message, title, type = "info", onClose, onClick, duration = 4000 }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    if (duration > 0) {
      const timer = setTimeout(() => { setVisible(false); setTimeout(() => onClose(id), 300); }, duration);
      return () => clearTimeout(timer);
    }
  }, []);

  return (
    <div
      onClick={onClick}
      role="alert"
      style={{
        maxWidth: 380, padding: "12px 16px",
        background: "var(--bg-400, var(--bg-surface))",
        border: "1px solid var(--border)",
        borderLeft: `3px solid ${BORDER_COLORS[type] || BORDER_COLORS.info}`,
        borderRadius: 10,
        boxShadow: "0 4px 20px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.06)",
        cursor: onClick ? "pointer" : "default",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateX(0)" : "translateX(24px)",
        transition: "opacity 300ms cubic-bezier(0.16,1,0.3,1), transform 300ms cubic-bezier(0.16,1,0.3,1)",
        display: "flex", alignItems: "flex-start", gap: 10,
        pointerEvents: "auto",
      }}
    >
      <div style={{ flexShrink: 0, marginTop: 1 }}>
        {TOAST_ICONS[type] || TOAST_ICONS.info}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {title && (
          <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)", marginBottom: 1, lineHeight: 1.3 }}>
            {title}
          </div>
        )}
        <div style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.5 }}>
          {message}
        </div>
      </div>
      <button
        onClick={e => { e.stopPropagation(); setVisible(false); setTimeout(() => onClose(id), 300); }}
        aria-label="Dismiss"
        style={{
          background: "none", border: "none", cursor: "pointer", padding: 2,
          color: "var(--text-tertiary)", flexShrink: 0, marginTop: -2,
          fontSize: "16px", lineHeight: 1, opacity: 0.5,
        }}
      >
        &times;
      </button>
    </div>
  );
}

/**
 * Toast container — renders a stack of toasts.
 * Usage: <ToastContainer toasts={toasts} onDismiss={removeToast} />
 */
export function ToastContainer({ toasts = [], onDismiss }) {
  if (toasts.length === 0) return null;
  return (
    <div style={{
      position: "fixed", top: 16, right: 16, zIndex: 9999,
      display: "flex", flexDirection: "column", gap: 8,
      pointerEvents: "none",
    }}>
      {toasts.slice(0, 5).map(t => (
        <Toast key={t.id} {...t} onClose={onDismiss} />
      ))}
    </div>
  );
}

/**
 * Hook for managing toasts.
 * Returns [toasts, addToast, removeToast]
 */
export function useToasts() {
  const [toasts, setToasts] = useState([]);
  let idCounter = 0;

  function addToast({ message, title, type = "info", duration = 4000, onClick }) {
    const id = `toast_${Date.now()}_${idCounter++}`;
    setToasts(prev => [...prev.slice(-4), { id, message, title, type, duration, onClick }]);
    return id;
  }

  function removeToast(id) {
    setToasts(prev => prev.filter(t => t.id !== id));
  }

  return [toasts, addToast, removeToast];
}

// Default export for backwards compat
export default Toast;
