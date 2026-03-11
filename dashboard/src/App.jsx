import { Suspense, lazy, useEffect } from "react";

import { docsLinks } from "./site/config/links.js";

const LovableSite = lazy(() => import("./lovable/LovableSite.jsx"));
const OperatorDashboard = lazy(() => import("./operator/OperatorDashboard.jsx"));
const ProductShell = lazy(() => import("./product/ProductShell.jsx"));
const PRODUCT_RUNTIME_STORAGE_KEY = "nooterra_product_runtime_v1";
const PRODUCT_ONBOARDING_STORAGE_KEY = "nooterra_product_onboarding_v1";

function ExternalRedirect({ href }) {
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.location.replace(href);
    }
  }, [href]);
  return null;
}

function getRouteMode() {
  if (typeof window === "undefined") {
    return { mode: "home", launchId: null, agentId: null, runId: null, requestedPath: null };
  }
  const rawPath = window.location.pathname;
  const path = rawPath.length > 1 && rawPath.endsWith("/") ? rawPath.slice(0, -1) : rawPath;

  if (path === "/operator") return { mode: "operator", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/network" || path === "/app") return { mode: "legacy", launchId: null, agentId: null, runId: null, requestedPath: path };
  if (path === "/inbox") return { mode: "inbox", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/approvals") return { mode: "approvals", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/wallet") return { mode: "wallet", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/integrations") return { mode: "integrations", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/receipts") return { mode: "receipts", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/disputes") return { mode: "disputes", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/agents") return { mode: "legacy", launchId: null, agentId: null, runId: null, requestedPath: path };
  if (path === "/onboarding" || path === "/login") return { mode: "onboarding", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/studio") return { mode: "legacy", launchId: null, agentId: null, runId: null, requestedPath: path };
  if (path === "/developers") return { mode: "developers", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/docs") return { mode: "docs", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/docs/quickstart") return { mode: "docs_quickstart", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/docs/architecture") return { mode: "docs_architecture", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/docs/integrations") return { mode: "docs_integrations", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/docs/api") return { mode: "docs_api", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/docs/security") return { mode: "docs_security", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/docs/ops") return { mode: "docs_ops", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path.startsWith("/launch/")) {
    return {
      mode: "legacy",
      launchId: decodeURIComponent(path.slice("/launch/".length)),
      agentId: null,
      runId: null,
      requestedPath: path
    };
  }
  if (path.startsWith("/agents/")) {
    return {
      mode: "legacy",
      launchId: null,
      agentId: decodeURIComponent(path.slice("/agents/".length)),
      runId: null,
      requestedPath: path
    };
  }
  if (path.startsWith("/runs/")) {
    return {
      mode: "run",
      launchId: null,
      agentId: null,
      runId: decodeURIComponent(path.slice("/runs/".length)),
      requestedPath: null
    };
  }
  return { mode: "home", launchId: null, agentId: null, runId: null, requestedPath: null };
}

function hasManagedRuntimeSession() {
  if (typeof window === "undefined") return false;
  try {
    const onboardingState = JSON.parse(localStorage.getItem(PRODUCT_ONBOARDING_STORAGE_KEY) || "null");
    if (onboardingState?.buyer) return true;
    const runtime = JSON.parse(localStorage.getItem(PRODUCT_RUNTIME_STORAGE_KEY) || "null");
    return Boolean(String(runtime?.apiKey ?? "").trim());
  } catch {
    return false;
  }
}

export default function App() {
  const route = getRouteMode();
  const hasManagedRuntime = hasManagedRuntimeSession();
  const alwaysPublicModes = new Set(["home", "developers", "integrations"]);
  const trustEntryModes = new Set(["wallet", "approvals", "receipts", "disputes", "onboarding"]);
  if (route.mode === "operator") {
    return (
      <Suspense fallback={<RouteLoadingScreen label="Loading operator console" />}>
        <OperatorDashboard />
      </Suspense>
    );
  }
  if (alwaysPublicModes.has(route.mode) || (trustEntryModes.has(route.mode) && !hasManagedRuntime)) {
    return (
      <Suspense fallback={<RouteLoadingScreen label="Loading Nooterra" />}>
        <LovableSite mode={route.mode} />
      </Suspense>
    );
  }
  if (route.mode === "docs") return <ExternalRedirect href={docsLinks.home} />;
  if (route.mode === "docs_quickstart") return <ExternalRedirect href={docsLinks.quickstart} />;
  if (route.mode === "docs_architecture") return <ExternalRedirect href={docsLinks.architecture} />;
  if (route.mode === "docs_integrations") return <ExternalRedirect href={docsLinks.integrations} />;
  if (route.mode === "docs_api") return <ExternalRedirect href={docsLinks.api} />;
  if (route.mode === "docs_security") return <ExternalRedirect href={docsLinks.security} />;
  if (route.mode === "docs_ops") return <ExternalRedirect href={docsLinks.ops} />;
  return (
    <Suspense fallback={<RouteLoadingScreen label="Loading Nooterra" />}>
      <ProductShell
        mode={route.mode}
        launchId={route.launchId}
        agentId={route.agentId}
        runId={route.runId}
        requestedPath={route.requestedPath}
      />
    </Suspense>
  );
}

function RouteLoadingScreen({ label }) {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "linear-gradient(180deg, #f6f4ee 0%, #efe8db 100%)",
        color: "#2b2a27"
      }}
    >
      <div
        style={{
          padding: "1rem 1.25rem",
          border: "1px solid rgba(78, 76, 68, 0.14)",
          borderRadius: "999px",
          background: "rgba(255, 252, 246, 0.88)",
          boxShadow: "0 18px 48px rgba(37, 34, 26, 0.08)",
          fontSize: "0.95rem",
          letterSpacing: "0.01em"
        }}
      >
        {label}
      </div>
    </main>
  );
}
