import React from "react";
import * as Sentry from "@sentry/react";

let frontendSentryEnabled = false;

function readString(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function readNumber(value, fallback) {
  if (value === null || value === undefined || String(value).trim() === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

export function initFrontendSentry() {
  const dsn = readString(import.meta.env.VITE_SENTRY_DSN);
  if (!dsn || frontendSentryEnabled) return false;
  Sentry.init({
    dsn,
    environment: readString(import.meta.env.VITE_SENTRY_ENVIRONMENT) ?? import.meta.env.MODE ?? "development",
    release: readString(import.meta.env.VITE_SENTRY_RELEASE) ?? "dev",
    tracesSampleRate: readNumber(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE, 0),
    sendDefaultPii: false,
    initialScope: {
      tags: {
        service: "dashboard",
        runtime: "browser"
      }
    },
    beforeSend(event) {
      const path = typeof window !== "undefined" ? window.location.pathname : null;
      if (path) {
        event.tags = { ...(event.tags ?? {}), route_path: path };
      }
      return event;
    }
  });
  frontendSentryEnabled = true;
  return true;
}

export function setFrontendSentryRoute({ mode, path } = {}) {
  if (!frontendSentryEnabled) return;
  if (mode) Sentry.setTag("route_mode", mode);
  if (path) Sentry.setTag("route_path", path);
}

export function captureFrontendSentryException(err, context = {}) {
  if (!frontendSentryEnabled) return;
  Sentry.withScope((scope) => {
    scope.setTag("service", "dashboard");
    scope.setTag("runtime", "browser");
    for (const [key, value] of Object.entries(context)) {
      if (value !== undefined) scope.setExtra(key, value);
    }
    Sentry.captureException(err);
  });
}

function FrontendErrorFallback() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "linear-gradient(180deg, #f6f4ee 0%, #efe8db 100%)",
        color: "#2b2a27",
        padding: "2rem"
      }}
    >
      <div
        style={{
          maxWidth: "32rem",
          border: "1px solid rgba(78, 76, 68, 0.14)",
          borderRadius: "1.5rem",
          background: "rgba(255, 252, 246, 0.92)",
          boxShadow: "0 18px 48px rgba(37, 34, 26, 0.08)",
          padding: "1.5rem"
        }}
      >
        <h1 style={{ margin: 0, fontSize: "1.2rem" }}>Unexpected error</h1>
        <p style={{ margin: "0.75rem 0 0", lineHeight: 1.6 }}>
          Nooterra hit an unexpected error on this page. Reload and try again. The incident has been recorded.
        </p>
      </div>
    </main>
  );
}

export function withFrontendSentryBoundary(children) {
  if (!frontendSentryEnabled) return children;
  return <Sentry.ErrorBoundary fallback={<FrontendErrorFallback />}>{children}</Sentry.ErrorBoundary>;
}
