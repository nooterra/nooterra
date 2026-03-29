import React from "react";
import { captureFrontendSentryException } from "../../sentry.jsx";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    captureFrontendSentryException(error, {
      componentStack: errorInfo?.componentStack,
      boundary: this.props.name || "ErrorBoundary",
    });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: "2.5rem 2rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 300,
        }}>
          <div style={{
            maxWidth: 420,
            width: "100%",
            background: "var(--product-panel-strong, var(--bg-400, #ffffff))",
            border: "1px solid var(--product-line, var(--border, #e5e3dd))",
            borderRadius: 14,
            padding: "2rem 1.75rem",
            boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
          }}>
            {/* Icon */}
            <div style={{
              width: 40, height: 40, borderRadius: "50%",
              background: "var(--product-bad-bg, rgba(161,83,71,0.12))",
              display: "flex", alignItems: "center", justifyContent: "center",
              marginBottom: 16,
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--product-bad, #a15347)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>

            <div style={{
              fontSize: "16px",
              fontWeight: 700,
              color: "var(--product-ink-strong, var(--text-primary, #111110))",
              marginBottom: 8,
              fontFamily: "var(--font-display, 'Fraunces', serif)",
            }}>
              Something went wrong
            </div>

            <div style={{
              fontSize: "13px",
              color: "var(--product-ink, var(--text-secondary, #4a4a45))",
              lineHeight: 1.5,
              marginBottom: 20,
              wordBreak: "break-word",
            }}>
              {this.state.error?.message || "An unexpected error occurred while rendering this section."}
            </div>

            <button
              onClick={this.handleReset}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "9px 18px",
                fontSize: "13px",
                fontWeight: 600,
                fontFamily: "var(--font-body, 'Plus Jakarta Sans', system-ui, sans-serif)",
                color: "var(--product-ink-strong, var(--text-primary, #111110))",
                background: "transparent",
                border: "1px solid var(--product-line, var(--border, #e5e3dd))",
                borderRadius: 8,
                cursor: "pointer",
                transition: "border-color 0.15s, background 0.15s",
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = "var(--accent, var(--product-accent))";
                e.currentTarget.style.background = "var(--product-panel-soft, var(--bg-300, rgba(0,0,0,0.04)))";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = "var(--product-line, var(--border, #e5e3dd))";
                e.currentTarget.style.background = "transparent";
              }}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
