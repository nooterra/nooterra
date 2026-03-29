import React, { useState, useEffect } from "react";

function ToastNotification({ message, onClose, onClick }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(() => { setVisible(false); setTimeout(onClose, 300); }, 5000);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div
      onClick={onClick}
      style={{
        position: "fixed", top: 16, right: 16, zIndex: 300,
        maxWidth: 360, padding: "14px 18px",
        background: "var(--bg-400, var(--bg-surface))",
        border: "1px solid var(--border)",
        borderLeft: "3px solid var(--amber, #c08c30)",
        borderRadius: 10,
        boxShadow: "var(--shadow-lg)",
        cursor: onClick ? "pointer" : "default",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateX(0)" : "translateX(20px)",
        transition: "opacity 300ms ease, transform 300ms ease",
      }}
    >
      <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-100, var(--text-primary))", marginBottom: 2 }}>
        Approval needed
      </div>
      <div style={{ fontSize: "12px", color: "var(--text-200, var(--text-secondary))", lineHeight: 1.5 }}>
        {message}
      </div>
    </div>
  );
}

export default ToastNotification;
