import { Suspense, lazy, useEffect, useState } from "react";
import { setFrontendSentryRoute } from "./sentry.jsx";
import { initAnalytics, page } from "./product/analytics.js";

initAnalytics();

// Dead code removed: OperatorDashboard, ProductShell, LovableSite

// World Runtime views (new)
const LandingPage = lazy(() => import("./site/LandingPage.jsx"));
const ScanReveal = lazy(() => import("./site/ScanReveal.jsx"));
const WorldRuntimeShell = lazy(() => import("./views/WorldRuntimeShell.jsx"));
const Onboarding2 = lazy(() => import("./views/Onboarding.jsx"));
const SetupFlow = lazy(() => import("./views/onboarding/SetupFlow.jsx"));
const EmployeeShell = lazy(() => import("./views/EmployeeShell.jsx"));
const EmployeeDashboard = lazy(() => import("./views/EmployeeDashboard.jsx"));
const ApprovalInbox = lazy(() => import("./views/ApprovalInbox.jsx"));
const AccountBrief = lazy(() => import("./views/AccountBrief.jsx"));
const EmployeeSettings = lazy(() => import("./views/EmployeeSettings.jsx"));
const ArShell = lazy(() => import("./views/ar/ArShell.jsx"));
const PRODUCT_RUNTIME_STORAGE_KEY = "nooterra_product_runtime_v1";
const PRODUCT_ONBOARDING_STORAGE_KEY = "nooterra_product_onboarding_v1";

function getRouteMode() {
  if (typeof window === "undefined") {
    return { mode: "home", launchId: null, agentId: null, runId: null, requestedPath: null };
  }
  const rawPath = window.location.pathname;
  const path = rawPath.length > 1 && rawPath.endsWith("/") ? rawPath.slice(0, -1) : rawPath;
  const searchParams = new URLSearchParams(window.location.search);
  const wantsManagedOnboarding = searchParams.get("experience") === "app";

  if (path === "/" || path === "") return { mode: "home", launchId: null, agentId: null, runId: null, requestedPath: null };

  // World Runtime routes (new dashboard)
  if (path === "/command") return { mode: "command_center", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/state") return { mode: "company_state", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/predictions") return { mode: "predictions", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/autonomy") return { mode: "autonomy_map", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/policies") return { mode: "policy_editor", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/queue") return { mode: "approval_queue", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/v2") return { mode: "landing_v2", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/scan") return { mode: "scan_reveal", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/collections") return { mode: "ar_command_center", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/setup") return { mode: "setup", launchId: null, agentId: null, runId: null, requestedPath: null };

  // Employee routes
  const empMatch = path.match(/^\/employees\/([^/]+)$/);
  if (empMatch) return { mode: "employee_dashboard", launchId: null, agentId: null, runId: null, requestedPath: null, employeeId: empMatch[1] };

  const empApprovalsMatch = path.match(/^\/employees\/([^/]+)\/approvals$/);
  if (empApprovalsMatch) return { mode: "employee_approvals", launchId: null, agentId: null, runId: null, requestedPath: null, employeeId: empApprovalsMatch[1] };

  const empAccountMatch = path.match(/^\/employees\/([^/]+)\/accounts\/([^/]+)$/);
  if (empAccountMatch) return { mode: "employee_account", launchId: null, agentId: null, runId: null, requestedPath: null, employeeId: empAccountMatch[1], objectId: empAccountMatch[2] };

  const empSettingsMatch = path.match(/^\/employees\/([^/]+)\/settings$/);
  if (empSettingsMatch) return { mode: "employee_settings", launchId: null, agentId: null, runId: null, requestedPath: null, employeeId: empSettingsMatch[1] };

  if (path === "/demo") return { mode: "demo", launchId: null, agentId: null, runId: null, requestedPath: null };

  if (path === "/operator") return { mode: "operator", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/network" || path === "/app") return { mode: "legacy", launchId: null, agentId: null, runId: null, requestedPath: path };
  if (path === "/inbox") return { mode: "inbox", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/approvals") return { mode: "approvals", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/wallet") return { mode: "dashboard", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/dashboard") return { mode: "dashboard", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/product") return { mode: "product", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/pricing") return { mode: "pricing", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/integrations") return { mode: "integrations", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/oauth/callback") return { mode: "oauth_callback", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/receipts") return { mode: "receipts", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/disputes") return { mode: "disputes", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/agents") return { mode: "legacy", launchId: null, agentId: null, runId: null, requestedPath: path };
  if (path === "/onboarding") return { mode: "onboarding", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/account") return { mode: "workspace", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/workspace") return { mode: "workspace", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/signup") return { mode: "signup", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/login") return { mode: "login", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/studio") return { mode: "legacy", launchId: null, agentId: null, runId: null, requestedPath: path };
  if (path === "/developers") return { mode: "developers", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/docs") return { mode: "docs", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/docs/quickstart") return { mode: "docs_quickstart", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/docs/architecture") return { mode: "docs_architecture", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/docs/integrations") return { mode: "docs_integrations", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/docs/api") return { mode: "docs_api", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/docs/security") return { mode: "docs_security", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/docs/ops") return { mode: "docs_ops", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/docs/claude-desktop") return { mode: "docs_claude_desktop", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/docs/openclaw") return { mode: "docs_openclaw", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/docs/codex") return { mode: "docs_codex", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/docs/local-environment") return { mode: "docs_local_environment", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/docs/launch-hosts") return { mode: "docs_launch_hosts", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/docs/partner-kit") return { mode: "docs_partner_kit", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/docs/launch-checklist") return { mode: "docs_launch_checklist", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/docs/incidents") return { mode: "docs_incidents", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/changelog") return { mode: "changelog", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/status") return { mode: "status", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/security") return { mode: "security", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/privacy") return { mode: "privacy", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/terms") return { mode: "terms", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/support" || path === "/contact") return { mode: "support", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/expired") return { mode: "expired", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/revoked") return { mode: "revoked", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/verification-failed") return { mode: "verification_failed", launchId: null, agentId: null, runId: null, requestedPath: null };
  if (path === "/unsupported-host") return { mode: "unsupported_host", launchId: null, agentId: null, runId: null, requestedPath: null };
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
  return { mode: "not_found", launchId: null, agentId: null, runId: null, requestedPath: null };
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

function prefersManagedOnboardingFlow() {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("experience") === "app";
  } catch {
    return false;
  }
}

export default function App() {
  const route = getRouteMode();
  useEffect(() => {
    if (typeof window === "undefined") return;
    setFrontendSentryRoute({ mode: route.mode, path: window.location.pathname });
    page(window.location.pathname, { mode: route.mode });
  }, [route.mode]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const rawPath = window.location.pathname;
    const params = new URLSearchParams(window.location.search);
    const wantsManagedOnboarding = params.get("experience") === "app";
    const step = params.get("step");
    const normalizedSearch = step ? `?step=${encodeURIComponent(step)}` : "";
    const hash = window.location.hash || "#account-create";
    if (rawPath === "/workspace" || rawPath === "/account") {
      window.history.replaceState({}, "", `/signup${normalizedSearch}${hash}`);
      return;
    }
    if (rawPath === "/onboarding" && wantsManagedOnboarding) {
      window.history.replaceState({}, "", `/signup${normalizedSearch}${hash}`);
    }
  }, [route.mode]);
  const hasManagedRuntime = hasManagedRuntimeSession();
  const wantsManagedOnboarding =
    route.mode === "workspace" || (route.mode === "onboarding" && prefersManagedOnboardingFlow());
  const alwaysPublicModes = new Set([
    "product",
    "pricing",
    "developers",
    "integrations",
    "onboarding",
    "docs",
    "docs_quickstart",
    "docs_architecture",
    "docs_integrations",
    "docs_api",
    "docs_security",
    "docs_ops",
    "docs_claude_desktop",
    "docs_openclaw",
    "docs_codex",
    "docs_local_environment",
    "docs_launch_hosts",
    "docs_partner_kit",
    "docs_launch_checklist",
    "docs_incidents",
    "status",
    "security",
    "privacy",
    "terms",
    "support",
    "expired",
    "revoked",
    "verification_failed",
    "unsupported_host",
    "changelog",
    "not_found"
  ]);
  const trustEntryModes = new Set(["wallet", "approvals", "receipts", "disputes", "workspace"]);
  // OAuth callback — auto-close popup after brief success message
  const isOAuthCallback = route.mode === "oauth_callback";
  const [oauthCloseFailed, setOauthCloseFailed] = useState(false);
  useEffect(() => {
    if (!isOAuthCallback) return;
    // Try to close popup (works if opened via window.open from same origin)
    try { window.opener && window.opener.focus(); } catch(e) {}

    const closeTimer = setTimeout(() => {
      try { window.close(); } catch(e) {}
    }, 800);

    // Auto-redirect fallback after 2s — don't leave user stranded
    const redirectTimer = setTimeout(() => {
      setOauthCloseFailed(true);
      // Auto-redirect after showing the link briefly
      setTimeout(() => {
        window.location.href = '/integrations';
      }, 1500);
    }, 2000);

    return () => { clearTimeout(closeTimer); clearTimeout(redirectTimer); };
  }, [isOAuthCallback]);

  if (isOAuthCallback) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#faf9f6", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#5bb98c", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <div style={{ fontSize: "16px", fontWeight: 600, color: "#1a1a1a", marginBottom: 8 }}>Connected!</div>
          {oauthCloseFailed ? (
            <div>
              <div style={{ fontSize: "13px", color: "#888", marginBottom: 8 }}>Redirecting to integrations...</div>
              <a href="/integrations" style={{ fontSize: "13px", color: "#5bb98c", textDecoration: "underline" }}>Click here if not redirected</a>
            </div>
          ) : (
            <div style={{ fontSize: "13px", color: "#888" }}>This window will close automatically.</div>
          )}
        </div>
      </div>
    );
  }

  if (route.mode === 'setup') {
    return (
      <Suspense fallback={<RouteLoadingScreen label="Loading setup" />}>
        <SetupFlow />
      </Suspense>
    );
  }

  const employeeModes = new Set(['employee_dashboard', 'employee_approvals', 'employee_account', 'employee_settings']);
  if (employeeModes.has(route.mode)) {
    return (
      <Suspense fallback={<RouteLoadingScreen label="Loading" />}>
        <EmployeeShell employeeId={route.employeeId} initialView={route.mode.replace('employee_', '')}>
          {({ summary, refreshSummary }) => (
            <>
              {route.mode === 'employee_dashboard' && <EmployeeDashboard summary={summary} />}
              {route.mode === 'employee_approvals' && <ApprovalInbox summary={summary} refreshSummary={refreshSummary} />}
              {route.mode === 'employee_account' && <AccountBrief objectId={route.objectId} employeeId={route.employeeId} />}
              {route.mode === 'employee_settings' && <EmployeeSettings summary={summary} />}
            </>
          )}
        </EmployeeShell>
      </Suspense>
    );
  }

  // World Runtime Shell — wraps all 6 dashboard views in shared chrome
  const shellModes = new Set([
    'command_center', 'company_state', 'predictions',
    'autonomy_map', 'policy_editor', 'approval_queue', 'demo',
  ]);

  // Map route modes to shell view keys
  const shellViewMap = {
    command_center: 'command',
    company_state: 'state',
    predictions: 'predictions',
    autonomy_map: 'autonomy',
    policy_editor: 'policies',
    approval_queue: 'queue',
    demo: 'command',
  };

  if (shellModes.has(route.mode)) {
    return (
      <Suspense fallback={<RouteLoadingScreen label="Loading Nooterra" />}>
        <WorldRuntimeShell initialView={shellViewMap[route.mode]} />
      </Suspense>
    );
  }

  // Standalone world runtime pages (no shell)
  if (route.mode === 'home') {
    return (
      <Suspense fallback={<RouteLoadingScreen label="Loading Nooterra" />}>
        <LandingPage />
      </Suspense>
    );
  }

  if (route.mode === 'landing_v2') {
    return (
      <Suspense fallback={<RouteLoadingScreen label="Loading Nooterra" />}>
        <LandingPage />
      </Suspense>
    );
  }

  if (route.mode === 'scan_reveal') {
    return (
      <Suspense fallback={<RouteLoadingScreen label="Loading scan" />}>
        <ScanReveal />
      </Suspense>
    );
  }

  if (route.mode === 'ar_command_center') {
    return (
      <Suspense fallback={<RouteLoadingScreen label="Loading collections" />}>
        <ArShell />
      </Suspense>
    );
  }

  if (route.mode === 'onboarding_v2') {
    return (
      <Suspense fallback={<RouteLoadingScreen label="Loading Nooterra" />}>
        <Onboarding2 />
      </Suspense>
    );
  }

  // Public/marketing pages
  if (
    alwaysPublicModes.has(route.mode) ||
    (trustEntryModes.has(route.mode) && !hasManagedRuntime && !wantsManagedOnboarding)
  ) {
    return (
      <Suspense fallback={<RouteLoadingScreen label="Loading Nooterra" />}>
        <LandingPage mode={route.mode} />
      </Suspense>
    );
  }

  // Fallback: redirect unknown routes to collections
  return (
    <Suspense fallback={<RouteLoadingScreen label="Loading Nooterra" />}>
      <ArShell />
    </Suspense>
  );
}

function RouteLoadingScreen({ label }) {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0a0a0f",
        color: "#e8e9ed",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div style={{
          width: 32, height: 32, margin: "0 auto 12px",
          borderRadius: "50%",
          border: "2px solid #2a2d3d",
          borderTopColor: "#4f8ff7",
          animation: "spin 0.8s linear infinite",
        }} />
        <div style={{ fontSize: "13px", color: "#8b8fa3" }}>{label}</div>
      </div>
    </main>
  );
}
