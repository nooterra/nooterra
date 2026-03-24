import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Check,
  Clock,
  FileCheck,
  Lock,
  Menu,
  RotateCcw,
  Shield,
  X
} from "lucide-react";
import { docsLinks, ossLinks } from "../site/config/links.js";

const PUBLIC_ONBOARDING_HREF = "/onboarding";
const PUBLIC_SIGNUP_HREF = "/signup#account-create";
const PUBLIC_LOGIN_HREF = "/login#identity-access";
const MANAGED_ONBOARDING_HREF = buildManagedAccountHref({ flow: "signup", source: "site", hash: "account-create" });
const MANAGED_LOGIN_HREF = buildManagedAccountHref({ flow: "login", source: "site", hash: "identity-access" });
const PUBLIC_DEMO_HREF = "/demo";
const PRODUCT_ONBOARDING_HREF = buildManagedOnboardingHref("product");
const PRICING_ONBOARDING_HREF = buildManagedOnboardingHref("pricing");
const SITE_DOC_ROUTES = {
  home: "/docs",
  quickstart: "/docs/quickstart",
  architecture: "/docs/architecture",
  integrations: "/docs/integrations",
  api: "/docs/api",
  security: "/docs/security",
  ops: "/docs/ops",
  claudeDesktop: "/docs/claude",
  openClaw: "/docs/openclaw",
  codex: "/docs/codex",
  localEnvironment: "/docs/setup",
  hostQuickstart: "/docs/hosts",
  designPartnerKit: "/docs/partners",
  launchChecklist: "/docs/launch",
  incidents: "/docs/incidents",
  support: "/support"
};

const PUBLIC_STATUS_CHECKS = Object.freeze([
  {
    id: "home",
    label: "Homepage",
    description: "Main entry point and first governed-worker CTA.",
    path: "/",
    type: "html",
    needle: "Hire AI workers"
  },
  {
    id: "product",
    label: "Product",
    description: "Public product narrative and governed-worker overview.",
    path: "/product",
    type: "html",
    needle: "actually do real work"
  },
  {
    id: "demo",
    label: "Demo walkthrough",
    description: "Public walkthrough with worker data.",
    path: "/demo",
    type: "html",
    needle: "Sample flow"
  },
  {
    id: "pricing",
    label: "Pricing",
    description: "Builder, usage, and enterprise path.",
    path: "/pricing",
    type: "html",
    needle: "Free to build."
  },
  {
    id: "onboarding",
    label: "Onboarding app",
    description: "Workspace creation and first governed-worker setup entry point.",
    path: "/signup?experience=app#account-create",
    type: "html",
    needle: "Create your workspace."
  },
  {
    id: "support",
    label: "Support route",
    description: "Public escalation path into the right product page.",
    path: "/support",
    type: "html",
    needle: "Get to the right path fast."
  },
  {
    id: "auth_proxy",
    label: "Managed auth proxy",
    description: "Same-origin auth mode handshake used by hosted onboarding.",
    path: "/__magic/v1/public/auth-mode",
    type: "json"
  }
]);

function buildManagedOnboardingHref(source) {
  return buildManagedAccountHref({ flow: "signup", source, hash: "account-create" });
}

function buildManagedAccountHref({ flow = "signup", source = "", hash = "account-create" } = {}) {
  const params = new URLSearchParams();
  params.set("experience", "app");
  const normalizedSource = String(source ?? "").trim();
  if (normalizedSource) params.set("source", normalizedSource);
  const normalizedHash = String(hash ?? "").trim().replace(/^#?/, "");
  return `/${String(flow ?? "signup").trim() || "signup"}?${params.toString()}${normalizedHash ? `#${normalizedHash}` : ""}`;
}

function FadeIn({ children, delay = 0, className = "" }) {
  return (
    <div className={`lovable-fade ${className}`.trim()} style={{ animationDelay: `${delay}s` }}>
      {children}
    </div>
  );
}

function SiteNav() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pathname, setPathname] = useState(typeof window === "undefined" ? "/" : window.location.pathname);

  useEffect(() => {
    const handleChange = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", handleChange);
    return () => window.removeEventListener("popstate", handleChange);
  }, []);

  const navLinks = [
    { label: "Product", href: "/product" },
    { label: "Demo", href: "/demo" },
    { label: "Developers", href: "/developers" },
    { label: "Pricing", href: "/pricing" },
    { label: "Docs", href: "/docs" },
    { label: "Security", href: "/security" }
  ];
  const primaryOnboardingHref =
    pathname === "/product"
      ? PRODUCT_ONBOARDING_HREF
      : pathname === "/pricing"
        ? PRICING_ONBOARDING_HREF
        : buildManagedOnboardingHref("site_nav");

  return (
    <nav className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-[#080b10]/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6 lg:px-8">
        <a href="/" className="flex items-center gap-2 group">
          <span className="text-xl tracking-tight text-stone-100 transition-colors duration-300 group-hover:text-[#d2b06f]" style={{ fontFamily: "var(--lovable-font-serif)" }}>
            Nooterra
          </span>
        </a>

        <div className="hidden items-center gap-6 xl:gap-8 lg:flex">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={`text-sm tracking-wide transition-colors duration-200 ${
                pathname === link.href ? "text-stone-50" : "text-stone-400 hover:text-stone-100"
              }`}
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="hidden items-center gap-3 lg:flex">
          <a
            href={MANAGED_LOGIN_HREF}
            className="inline-flex items-center gap-2 rounded-md border border-white/10 px-4 py-2 text-sm font-medium text-stone-200 transition-all duration-200 hover:bg-white/5"
          >
            Sign in
          </a>
          <a
            href={primaryOnboardingHref}
            className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-4 py-2 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90"
          >
            Get started
          </a>
        </div>

        <button
          onClick={() => setMobileOpen((value) => !value)}
          className="p-2 text-stone-100 lg:hidden"
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {mobileOpen ? (
        <div className="border-t border-white/10 bg-[#080b10]/95 backdrop-blur-xl lg:hidden">
          <div className="space-y-4 px-6 py-6">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className={`block text-base transition-colors ${
                  pathname === link.href ? "text-stone-100" : "text-stone-400"
                }`}
              >
                {link.label}
              </a>
            ))}
            <a
              href={MANAGED_LOGIN_HREF}
              onClick={() => setMobileOpen(false)}
              className="block text-base text-stone-300 transition-colors hover:text-stone-100"
            >
              Sign in
            </a>
            <a
              href={primaryOnboardingHref}
              onClick={() => setMobileOpen(false)}
              className="mt-2 inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-4 py-2 text-sm font-medium text-[#0b0f14]"
            >
              Get started
            </a>
          </div>
        </div>
      ) : null}
    </nav>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-white/10 bg-[#07090d]">
      <div className="mx-auto max-w-7xl px-6 py-16 lg:px-8">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          <div className="col-span-2 md:col-span-1">
            <span className="text-lg text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>Nooterra</span>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-stone-400">
              Worker accounts for consequential AI actions.
            </p>
          </div>
          <div>
            <h4 className="mb-4 text-xs font-medium uppercase tracking-[0.24em] text-stone-500">Product</h4>
            <div className="space-y-3">
              <a href="/" className="block text-sm text-stone-300 transition-colors hover:text-stone-100">Overview</a>
              <a href="/product" className="block text-sm text-stone-300 transition-colors hover:text-stone-100">Product</a>
              <a href="/demo" className="block text-sm text-stone-300 transition-colors hover:text-stone-100">Demo walkthrough</a>
              <a href="/pricing" className="block text-sm text-stone-300 transition-colors hover:text-stone-100">Pricing</a>
              <a href={MANAGED_ONBOARDING_HREF} className="block text-sm text-stone-300 transition-colors hover:text-stone-100">Get started free</a>
              <a href={MANAGED_LOGIN_HREF} className="block text-sm text-stone-300 transition-colors hover:text-stone-100">Sign in</a>
            </div>
          </div>
          <div>
            <h4 className="mb-4 text-xs font-medium uppercase tracking-[0.24em] text-stone-500">Developers</h4>
            <div className="space-y-3">
              <a href="/developers" className="block text-sm text-stone-300 transition-colors hover:text-stone-100">Documentation</a>
              <a href="/integrations" className="block text-sm text-stone-300 transition-colors hover:text-stone-100">Integrations</a>
              <a href="/docs/api" className="block text-sm text-stone-300 transition-colors hover:text-stone-100">API Reference</a>
              <a href="/docs" className="block text-sm text-stone-300 transition-colors hover:text-stone-100">Docs</a>
              <a href={ossLinks.repo} className="block text-sm text-stone-300 transition-colors hover:text-stone-100">GitHub</a>
            </div>
          </div>
          <div>
            <h4 className="mb-4 text-xs font-medium uppercase tracking-[0.24em] text-stone-500">Company</h4>
            <div className="space-y-3">
              <a href="/security" className="block text-sm text-stone-300 transition-colors hover:text-stone-100">Security</a>
              <a href="/status" className="block text-sm text-stone-300 transition-colors hover:text-stone-100">Status</a>
              <a href="/support" className="block text-sm text-stone-300 transition-colors hover:text-stone-100">Support</a>
              <a href="/privacy" className="block text-sm text-stone-300 transition-colors hover:text-stone-100">Privacy</a>
              <a href="/terms" className="block text-sm text-stone-300 transition-colors hover:text-stone-100">Terms</a>
            </div>
          </div>
        </div>
        <div className="mt-16 flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-8 md:flex-row">
          <p className="text-xs text-stone-500">© 2026 Nooterra. All rights reserved.</p>
          <p className="text-xs text-stone-500">Identity, approvals, receipts, and recovery for AI workers.</p>
        </div>
      </div>
    </footer>
  );
}

function SiteLayout({ children }) {
  return (
    <div className="lovable-site min-h-screen bg-[#07090d] text-stone-100">
      <SiteNav />
      <main className="flex-1 pt-16">{children}</main>
      <SiteFooter />
    </div>
  );
}

function looksLikeHtmlDocument(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized.startsWith("<!doctype html") || normalized.startsWith("<html");
}

function normalizeStatusPathname(value) {
  if (typeof window === "undefined") return "";
  try {
    return new URL(String(value ?? "/"), window.location.origin).pathname || "/";
  } catch {
    return "";
  }
}

async function probePublicHtmlRoute(check, { timeoutMs = 8000, intervalMs = 250 } = {}) {
  if (typeof window === "undefined" || !window.document?.body) {
    return {
      ...check,
      status: "unavailable",
      statusLabel: "Unavailable",
      detail: "Browser route checks require a live document body"
    };
  }
  return new Promise((resolve) => {
    const iframe = window.document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.tabIndex = -1;
    iframe.style.position = "fixed";
    iframe.style.width = "1px";
    iframe.style.height = "1px";
    iframe.style.opacity = "0";
    iframe.style.pointerEvents = "none";
    iframe.style.border = "0";

    const expectedPathname = normalizeStatusPathname(check.path);
    let settled = false;
    let intervalId = null;
    let timeoutId = null;
    let lastState = {
      actualPathname: "",
      bodyText: "",
      readyState: "",
      contentType: "text/html"
    };

    const cleanup = () => {
      if (intervalId !== null) window.clearInterval(intervalId);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      iframe.remove();
    };

    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        ...check,
        actualPathname: lastState.actualPathname,
        contentType: lastState.contentType,
        ...result
      });
    };

    const readFrameState = () => {
      try {
        const frameWindow = iframe.contentWindow;
        const frameDocument = iframe.contentDocument;
        lastState = {
          actualPathname: String(frameWindow?.location?.pathname ?? "").trim(),
          bodyText: String(frameDocument?.body?.innerText ?? ""),
          readyState: String(frameDocument?.readyState ?? ""),
          contentType: String(frameDocument?.contentType ?? "text/html").toLowerCase()
        };
        const pathnameMatches = !expectedPathname || lastState.actualPathname === expectedPathname;
        const needleMatches = !check.needle || lastState.bodyText.includes(check.needle);
        if (lastState.readyState === "complete" && pathnameMatches && needleMatches) {
          finish({
            status: "ok",
            statusLabel: "Operational",
            detail: "Rendered branded route correctly in a browser frame"
          });
        }
      } catch (error) {
        finish({
          status: "unavailable",
          statusLabel: "Unavailable",
          detail: String(error?.message ?? "Route probe failed")
        });
      }
    };

    iframe.addEventListener("load", () => {
      readFrameState();
      if (!settled) intervalId = window.setInterval(readFrameState, intervalMs);
    });

    timeoutId = window.setTimeout(() => {
      const detail =
        lastState.actualPathname && expectedPathname && lastState.actualPathname !== expectedPathname
          ? `Resolved to ${lastState.actualPathname} instead of ${expectedPathname}`
          : check.needle && !lastState.bodyText.includes(check.needle)
            ? "Rendered unexpected page content"
            : "Timed out waiting for branded route content";
      finish({
        status: "degraded",
        statusLabel: "Degraded",
        detail
      });
    }, timeoutMs);

    window.document.body.append(iframe);
    iframe.src = check.path;
  });
}

function classifyPublicJsonFailure(response, body, contentType) {
  const trimmed = String(body ?? "").trim();
  let parsed = null;
  if (contentType.includes("application/json")) {
    try {
      parsed = trimmed ? JSON.parse(trimmed) : null;
    } catch {
      parsed = null;
    }
  }
  const message =
    typeof parsed?.message === "string"
      ? parsed.message
      : typeof parsed?.error === "string"
        ? parsed.error
        : trimmed;
  if (response.status === 404 && /application not found/i.test(message)) {
    return {
      status: "unavailable",
      statusLabel: "Unavailable",
      detail: "Railway fallback is answering instead of the Nooterra auth plane.",
      contentType
    };
  }
  if (response.status === 502 && /dns_hostname_not_found/i.test(message)) {
    return {
      status: "unavailable",
      statusLabel: "Unavailable",
      detail: "The public auth proxy cannot resolve the upstream host.",
      contentType
    };
  }
  return {
    status: "unavailable",
    statusLabel: "Unavailable",
    detail: `Returned ${response.status}`,
    contentType
  };
}

function derivePublicStatusVerdict(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return {
      label: "Checking",
      tone: "text-stone-400 border-white/10 bg-white/5"
    };
  }
  const unavailableCount = results.filter((item) => item.status === "unavailable").length;
  const degradedCount = results.filter((item) => item.status === "degraded").length;
  if (unavailableCount > 0) {
    return {
      label: "Degraded",
      tone: "text-rose-300 border-rose-500/20 bg-rose-500/10"
    };
  }
  if (degradedCount > 0) {
    return {
      label: "Watching",
      tone: "text-amber-300 border-amber-500/20 bg-amber-500/10"
    };
  }
  return {
    label: "Operational",
    tone: "text-emerald-300 border-emerald-500/20 bg-emerald-500/10"
  };
}

async function runPublicStatusCheck(check) {
  try {
    if (check.type === "html") {
      return probePublicHtmlRoute(check);
    }
    const response = await fetch(check.path, {
      headers: {
        accept: "application/json"
      }
    });
    const contentType = String(response.headers.get("content-type") ?? "").toLowerCase();
    const body = await response.text();
    if (check.type === "json") {
      if (!response.ok) {
        return {
          ...check,
          ...classifyPublicJsonFailure(response, body, contentType)
        };
      }
      if (!contentType.includes("application/json")) {
        return {
          ...check,
          status: "degraded",
          statusLabel: "Degraded",
          detail: "Returned non-JSON success response",
          contentType
        };
      }
      try {
        const parsed = JSON.parse(body);
        const mode = typeof parsed?.mode === "string" && parsed.mode.trim() ? parsed.mode.trim() : "reachable";
        return {
          ...check,
          status: "ok",
          statusLabel: "Operational",
          detail: `Mode: ${mode}`,
          contentType
        };
      } catch {
        return {
          ...check,
          status: "degraded",
          statusLabel: "Degraded",
          detail: "Returned invalid JSON",
          contentType
        };
      }
    }
  } catch (error) {
    return {
      ...check,
      status: "unavailable",
      statusLabel: "Unavailable",
      detail: String(error?.message ?? "Request failed")
    };
  }
}

function StatusPage() {
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [statusState, setStatusState] = useState({
    loading: true,
    checks: [],
    checkedAt: ""
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setStatusState((previous) => ({
        ...previous,
        loading: true
      }));
      const checks = await Promise.all(PUBLIC_STATUS_CHECKS.map((check) => runPublicStatusCheck(check)));
      if (cancelled) return;
      setStatusState({
        loading: false,
        checks,
        checkedAt: new Date().toISOString()
      });
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [refreshNonce]);

  const verdict = derivePublicStatusVerdict(statusState.checks);

  return (
    <SiteLayout>
      <section className="relative flex min-h-[68vh] items-end overflow-hidden">
        <div className="lovable-grid absolute inset-0 opacity-[0.03]" />
        <div className="lovable-orb lovable-orb-a" />
        <div className="lovable-orb lovable-orb-b" />
        <div className="relative mx-auto grid max-w-7xl gap-14 px-6 py-24 lg:grid-cols-[minmax(0,1fr),24rem] lg:px-8 lg:py-32">
          <div>
            <FadeIn>
              <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">Status</p>
              <h1 className="max-w-4xl text-4xl leading-tight text-stone-100 md:text-5xl lg:text-6xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                Service status and route health.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-relaxed text-stone-400">
                Check website routes and auth status before you send someone into the product.
              </p>
            </FadeIn>
            <FadeIn delay={0.15}>
              <div className="mt-10 flex flex-wrap gap-4">
                <button
                  type="button"
                  onClick={() => setRefreshNonce((value) => value + 1)}
                  className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-6 py-3 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90"
                >
                  Refresh checks <RotateCcw size={16} />
                </button>
                <a href={SITE_DOC_ROUTES.launchChecklist} className="inline-flex items-center gap-2 rounded-md border border-white/15 px-6 py-3 text-sm font-medium text-stone-100 transition-all duration-200 hover:bg-white/5">
                  Launch guide <ArrowUpRight size={15} />
                </a>
              </div>
            </FadeIn>
          </div>
          <FadeIn delay={0.2} className="self-end">
            <div className="lovable-panel lovable-panel-strong">
              <div className="mb-6 flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-stone-500">Current posture</p>
                  <h2 className="mt-2 text-2xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                    Public launch routes
                  </h2>
                </div>
                <div className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.18em] ${verdict.tone}`}>
                  {statusState.loading ? "Checking" : verdict.label}
                </div>
              </div>
              <p className="text-sm leading-relaxed text-stone-400">
                {statusState.loading
                  ? "Running browser-level checks against the public site."
                  : statusState.checkedAt
                    ? `Last checked ${new Date(statusState.checkedAt).toLocaleString()}.`
                    : "Checks have not run yet."}
              </p>
              <div className="mt-6 space-y-3">
                {statusState.checks.map((item, index) => (
                  <div key={item.id} className="lovable-rail-row">
                    <div className="lovable-rail-index">0{index + 1}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm font-medium text-stone-100">{item.label}</p>
                        <span
                          className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] ${
                            item.status === "ok"
                              ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                              : item.status === "degraded"
                                ? "border-amber-500/20 bg-amber-500/10 text-amber-300"
                                : "border-rose-500/20 bg-rose-500/10 text-rose-300"
                          }`}
                        >
                          {item.statusLabel}
                        </span>
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-stone-400">{item.description}</p>
                      <p className="mt-2 text-xs leading-relaxed text-stone-500">{item.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      <section className="border-t border-white/10">
        <div className="mx-auto grid max-w-7xl gap-5 px-6 py-24 lg:grid-cols-3 lg:px-8 lg:py-32">
          <FadeIn>
            <div className="lovable-panel h-full">
              <p className="text-[11px] uppercase tracking-[0.22em] text-stone-500">Health</p>
              <h3 className="mt-3 text-2xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                What “good” looks like
              </h3>
              <p className="mt-4 text-sm leading-relaxed text-stone-400">
                Homepage, product, pricing, onboarding, support, and the same-origin auth proxy should all answer with the branded shell or the expected JSON handshake.
              </p>
              <a href={docsLinks.ops} className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-[#d2b06f] transition-colors hover:text-[#e2c994]">
                Open operations docs <ArrowUpRight size={14} />
              </a>
            </div>
          </FadeIn>
          <FadeIn delay={0.08}>
            <div className="lovable-panel h-full">
              <p className="text-[11px] uppercase tracking-[0.22em] text-stone-500">Incidents</p>
              <h3 className="mt-3 text-2xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                What fails closed
              </h3>
              <p className="mt-4 text-sm leading-relaxed text-stone-400">
                If the auth plane is unreachable, onboarding should pause cleanly, point users to support, and never pretend account creation is still live.
              </p>
              <a href={SITE_DOC_ROUTES.incidents} className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-[#d2b06f] transition-colors hover:text-[#e2c994]">
                Incident response <ArrowUpRight size={14} />
              </a>
            </div>
          </FadeIn>
          <FadeIn delay={0.16}>
            <div className="lovable-panel h-full">
              <p className="text-[11px] uppercase tracking-[0.22em] text-stone-500">Support</p>
              <h3 className="mt-3 text-2xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                One visible escalation path
              </h3>
              <p className="mt-4 text-sm leading-relaxed text-stone-400">
                People do not have to guess whether the problem is the website, onboarding, approvals, or a live receipt. Support is the next visible step.
              </p>
              <a href="/support" className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-[#d2b06f] transition-colors hover:text-[#e2c994]">
                Open support <ArrowUpRight size={14} />
              </a>
            </div>
          </FadeIn>
        </div>
      </section>
    </SiteLayout>
  );
}

function SupportPage() {
  const supportTracks = [
    {
      eyebrow: "Activation",
      title: "Account creation or first worker issue",
      body: "If signup, passkey setup, or first worker creation fails, start with the app onboarding flow instead of guessing which internal service broke.",
      href: MANAGED_ONBOARDING_HREF,
      ctaLabel: "Open onboarding"
    },
    {
      eyebrow: "Action flow",
      title: "Approval, receipt, or dispute problem",
      body: "If a real action was requested or completed, the linked approval, receipt, or dispute surface is the right first stop. Those pages are the system of record.",
      href: "/receipts",
      ctaLabel: "Open receipts"
    },
    {
      eyebrow: "Platform",
      title: "Website or auth route drift",
      body: "If the website feels wrong, check live route health first. The status page is where we surface onboarding drift, broken support paths, and same-origin auth failures.",
      href: "/status",
      ctaLabel: "Open status"
    }
  ];

  const incidentPaths = [
    {
      label: "Approval link expired",
      description: "Reissue a fresh hosted approval instead of retrying stale authority.",
      href: "/expired"
    },
    {
      label: "Authority was revoked",
      description: "Move into the revoked path to understand why execution stopped and how to restart safely.",
      href: "/revoked"
    },
    {
      label: "Verification failed",
      description: "Use the verification-failed path when execution happened but the proof did not verify cleanly.",
      href: "/verification-failed"
    },
    {
      label: "Unsupported host",
      description: "If the initiating host is outside the launch envelope, use the supported host guide first.",
      href: "/unsupported-host"
    }
  ];

  return (
    <SiteLayout>
      <section className="relative flex min-h-[68vh] items-end overflow-hidden">
        <div className="lovable-grid absolute inset-0 opacity-[0.03]" />
        <div className="lovable-orb lovable-orb-a" />
        <div className="lovable-orb lovable-orb-b" />
        <div className="relative mx-auto grid max-w-7xl gap-14 px-6 py-24 lg:grid-cols-[minmax(0,1fr),24rem] lg:px-8 lg:py-32">
          <div>
            <FadeIn>
              <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">Support</p>
              <h1 className="max-w-4xl text-4xl leading-tight text-stone-100 md:text-5xl lg:text-6xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                Get to the right path fast.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-relaxed text-stone-400">
                Support points people to the page that owns the problem: onboarding, approvals, receipts, disputes, or status.
              </p>
            </FadeIn>
            <FadeIn delay={0.15}>
              <div className="mt-10 flex flex-wrap gap-4">
                <a href="/status" className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-6 py-3 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90">
                  Check live status <ArrowRight size={16} />
                </a>
                <a href={SITE_DOC_ROUTES.incidents} className="inline-flex items-center gap-2 rounded-md border border-white/15 px-6 py-3 text-sm font-medium text-stone-100 transition-all duration-200 hover:bg-white/5">
                  Incident docs <ArrowUpRight size={15} />
                </a>
              </div>
            </FadeIn>
          </div>
          <FadeIn delay={0.2} className="self-end">
            <div className="lovable-panel lovable-panel-strong">
              <div className="mb-6 flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-stone-500">Fastest route</p>
                  <h2 className="mt-2 text-2xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                    Start from the page that owns the action.
                  </h2>
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[#d2b06f]">
                  Triage first
                </div>
              </div>
              <div className="space-y-3">
                <div className="lovable-rail-row">
                  <div className="lovable-rail-index">01</div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-stone-100">If a real action already happened, go to the receipt.</p>
                    <p className="mt-1 text-sm leading-relaxed text-stone-400">Receipts and disputes hold the evidence, outcome, and recovery path in one place.</p>
                  </div>
                </div>
                <div className="lovable-rail-row">
                  <div className="lovable-rail-index">02</div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-stone-100">If onboarding is broken, use the app onboarding route.</p>
                    <p className="mt-1 text-sm leading-relaxed text-stone-400">That path is where account creation, passkeys, and first worker-runtime issuance should recover or fail closed.</p>
                  </div>
                </div>
                <div className="lovable-rail-row">
                  <div className="lovable-rail-index">03</div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-stone-100">If the website shell feels wrong, check status before filing a ticket.</p>
                    <p className="mt-1 text-sm leading-relaxed text-stone-400">Route drift and same-origin auth failures should already be visible there.</p>
                  </div>
                </div>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      <section className="border-t border-white/10">
        <div className="mx-auto grid max-w-7xl gap-5 px-6 py-24 lg:grid-cols-3 lg:px-8 lg:py-32">
          {supportTracks.map((section, index) => (
            <FadeIn key={section.title} delay={0.08 * index}>
              <div className="lovable-panel h-full">
                <p className="text-[11px] uppercase tracking-[0.22em] text-stone-500">{section.eyebrow}</p>
                <h3 className="mt-3 text-2xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                  {section.title}
                </h3>
                <p className="mt-4 text-sm leading-relaxed text-stone-400">{section.body}</p>
                <a href={section.href} className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-[#d2b06f] transition-colors hover:text-[#e2c994]">
                  {section.ctaLabel} <ArrowUpRight size={14} />
                </a>
              </div>
            </FadeIn>
          ))}
        </div>
      </section>

      <section className="border-t border-white/10 bg-[#0b0f14]">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <FadeIn>
            <div className="mb-8 max-w-3xl">
              <p className="text-[11px] uppercase tracking-[0.22em] text-stone-500">Known failure paths</p>
              <h2 className="mt-3 text-3xl text-stone-100 md:text-4xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                Known failure paths already have a home.
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-stone-400">
                Expired links, revoked authority, failed verification, and unsupported hosts should each land on a dedicated page instead of dropping people into a generic shell.
              </p>
            </div>
          </FadeIn>
          <div className="grid gap-4 md:grid-cols-2">
            {incidentPaths.map((item, index) => (
              <FadeIn key={item.label} delay={0.06 * index}>
                <a href={item.href} className="lovable-panel block transition-transform duration-200 hover:-translate-y-1">
                  <p className="text-sm font-medium text-stone-100">{item.label}</p>
                  <p className="mt-2 text-sm leading-relaxed text-stone-400">{item.description}</p>
                  <span className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-[#d2b06f]">
                    Open route <ArrowUpRight size={14} />
                  </span>
                </a>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}

function SecurityPage() {
  const securityPillars = [
    {
      label: "Deterministic controls",
      body: "High-risk actions resolve through explicit policy checks, bounded grants, and fail-closed behavior when required artifacts are missing."
    },
    {
      label: "Causal records",
      body: "Approvals, evidence, receipts, disputes, and operator actions stay attached to the same action lineage instead of scattering across disconnected tools."
    },
    {
      label: "Emergency response",
      body: "Operators can freeze channels, action types, or launch traffic with emergency controls instead of waiting for an agent or workflow to self-correct."
    }
  ];

  const routeBoundaries = [
    {
      eyebrow: "Website",
      title: "Public routes are branded and smoke-tested",
      body: "Homepage, product, pricing, docs, status, and support are checked continuously so route drift does not hide behind a successful deploy.",
      href: "/status",
      ctaLabel: "View status"
    },
    {
      eyebrow: "Auth plane",
      title: "Hosted onboarding fails closed",
      body: "If secure sign-in or the same-origin proxy is unavailable, onboarding stops cleanly and points people to status and support instead of pretending signup still works.",
      href: buildManagedOnboardingHref("security"),
      ctaLabel: "Get started free"
    },
    {
      eyebrow: "Runtime",
      title: "Live actions leave receipts and disputes",
      body: "The system of record is the approval, evidence, and receipt trail, not a best-effort log line or payment event living somewhere else.",
      href: "/receipts",
      ctaLabel: "View receipts"
    }
  ];

  return (
    <SiteLayout>
      <section className="relative flex min-h-[68vh] items-end overflow-hidden">
        <div className="lovable-grid absolute inset-0 opacity-[0.03]" />
        <div className="lovable-orb lovable-orb-a" />
        <div className="lovable-orb lovable-orb-b" />
        <div className="relative mx-auto grid max-w-7xl gap-14 px-6 py-24 lg:grid-cols-[minmax(0,1fr),24rem] lg:px-8 lg:py-32">
          <div>
            <FadeIn>
              <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">Security</p>
              <h1 className="max-w-4xl text-4xl leading-tight text-stone-100 md:text-5xl lg:text-6xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                Security starts with scoped authority.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-relaxed text-stone-400">
                The system is trustworthy when actions are scoped, approvals are visible, route drift is caught early, and every consequential action leaves a record you can verify later.
              </p>
            </FadeIn>
            <FadeIn delay={0.15}>
              <div className="mt-10 flex flex-wrap gap-4">
                <a href={docsLinks.security} className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-6 py-3 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90">
                  Open security model <ArrowRight size={16} />
                </a>
                <a href="/status" className="inline-flex items-center gap-2 rounded-md border border-white/15 px-6 py-3 text-sm font-medium text-stone-100 transition-all duration-200 hover:bg-white/5">
                  Live status <ArrowUpRight size={15} />
                </a>
              </div>
            </FadeIn>
          </div>
          <FadeIn delay={0.2} className="self-end">
            <div className="lovable-panel lovable-panel-strong">
              <div className="mb-6 flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-stone-500">Core posture</p>
                  <h2 className="mt-2 text-2xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                    Better to stop the action than trust the wrong state.
                  </h2>
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[#d2b06f]">
                  Launch bar
                </div>
              </div>
              <div className="space-y-3">
                {securityPillars.map((item, index) => (
                  <div key={item.label} className="lovable-rail-row">
                    <div className="lovable-rail-index">0{index + 1}</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-stone-100">{item.label}</p>
                      <p className="mt-1 text-sm leading-relaxed text-stone-400">{item.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      <section className="border-t border-white/10">
        <div className="mx-auto grid max-w-7xl gap-5 px-6 py-24 lg:grid-cols-3 lg:px-8 lg:py-32">
          {routeBoundaries.map((section, index) => (
            <FadeIn key={section.title} delay={0.08 * index}>
              <div className="lovable-panel h-full">
                <p className="text-[11px] uppercase tracking-[0.22em] text-stone-500">{section.eyebrow}</p>
                <h3 className="mt-3 text-2xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                  {section.title}
                </h3>
                <p className="mt-4 text-sm leading-relaxed text-stone-400">{section.body}</p>
                <a href={section.href} className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-[#d2b06f] transition-colors hover:text-[#e2c994]">
                  {section.ctaLabel} <ArrowUpRight size={14} />
                </a>
              </div>
            </FadeIn>
          ))}
        </div>
      </section>
    </SiteLayout>
  );
}

function PrivacyPage() {
  const dataZones = [
    {
      label: "Identity and onboarding",
      body: "The public app flow needs enough identity to issue a workspace, establish the trust boundary, and return the user to the right managed surface."
    },
    {
      label: "Action artifacts",
      body: "Receipts, disputes, and operator history exist because consequential machine action needs durable proof, not because we want generic analytics exhaust."
    },
    {
      label: "Public route boundary",
      body: "The public site separates marketing, docs, and live product surfaces before anyone signs in."
    }
  ];

  return (
    <SiteLayout>
      <section className="relative flex min-h-[68vh] items-end overflow-hidden">
        <div className="lovable-grid absolute inset-0 opacity-[0.03]" />
        <div className="lovable-orb lovable-orb-a" />
        <div className="lovable-orb lovable-orb-b" />
        <div className="relative mx-auto grid max-w-7xl gap-14 px-6 py-24 lg:grid-cols-[minmax(0,1fr),24rem] lg:px-8 lg:py-32">
          <div>
            <FadeIn>
              <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">Privacy</p>
              <h1 className="max-w-4xl text-4xl leading-tight text-stone-100 md:text-5xl lg:text-6xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                Know what data belongs to the product.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-relaxed text-stone-400">
                Nooterra stores identity and action artifacts because governed workers need authority, proof, and recovery. Review the data boundary before you create a workspace.
              </p>
            </FadeIn>
            <FadeIn delay={0.15}>
              <div className="mt-10 flex flex-wrap gap-4">
                <a href={buildManagedOnboardingHref("privacy")} className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-6 py-3 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90">
                  Get started free <ArrowRight size={16} />
                </a>
                <a href="/support" className="inline-flex items-center gap-2 rounded-md border border-white/15 px-6 py-3 text-sm font-medium text-stone-100 transition-all duration-200 hover:bg-white/5">
                  Support path <ArrowUpRight size={15} />
                </a>
              </div>
            </FadeIn>
          </div>
          <FadeIn delay={0.2} className="self-end">
            <div className="lovable-panel lovable-panel-strong">
              <div className="mb-6 flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-stone-500">Data boundary</p>
                  <h2 className="mt-2 text-2xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                    Keep the reason for every artifact obvious.
                  </h2>
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[#d2b06f]">
                  Explained
                </div>
              </div>
              <div className="space-y-3">
                {dataZones.map((item, index) => (
                  <div key={item.label} className="lovable-rail-row">
                    <div className="lovable-rail-index">0{index + 1}</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-stone-100">{item.label}</p>
                      <p className="mt-1 text-sm leading-relaxed text-stone-400">{item.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </FadeIn>
        </div>
      </section>
    </SiteLayout>
  );
}

function HomePage() {
  const onboardingHref = buildManagedOnboardingHref("home");
  const walkthroughSteps = [
    { label: "Describe", value: "\"Monitor competitor prices and alert me on Slack\"", detail: "Natural language · Nooterra figures out what tools and rules the worker needs" },
    { label: "Configure", value: "Browser + Slack connected, hourly schedule set", detail: "One question at a time · capabilities inferred · guardrails auto-generated" },
    { label: "Deploy", value: "Price Monitor is live and running 24/7", detail: "Real daemon · triggers on schedule · escalates when rules say so" },
    { label: "Receipt", value: "3 price drops detected, Slack alerts sent", detail: "Every action logged · full audit trail · dispute anything" }
  ];
  return (
    <SiteLayout>
      <section className="relative flex min-h-[90vh] items-center overflow-hidden">
        <div className="lovable-grid absolute inset-0 opacity-[0.03]" />
        <div className="lovable-orb lovable-orb-a" />
        <div className="lovable-orb lovable-orb-b" />
        <div className="relative mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <FadeIn>
            <p className="mb-8 text-sm uppercase tracking-[0.2em] text-stone-500">Governed AI workers</p>
          </FadeIn>
          <FadeIn delay={0.1}>
            <h1
              className="max-w-5xl text-balance text-5xl leading-[0.95] tracking-tight text-stone-100 sm:text-6xl md:text-7xl lg:text-8xl xl:text-[6.5rem]"
              style={{ fontFamily: "var(--lovable-font-serif)" }}
            >
              Hire AI workers
              <br />
              <span className="text-[#d2b06f]">you can actually trust.</span>
            </h1>
          </FadeIn>
          <FadeIn delay={0.2}>
            <p className="mt-8 max-w-2xl text-lg leading-relaxed text-stone-400 md:text-xl">
              Describe any job in plain language. Nooterra builds the worker, connects the tools, sets the guardrails, and runs it 24/7.
              You approve what matters. Every action gets a receipt.
            </p>
          </FadeIn>
          <FadeIn delay={0.24}>
            <div className="mt-6 flex flex-wrap gap-2">
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-stone-300">Any AI provider</span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-stone-300">Runs forever</span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-stone-300">Any job you can describe</span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-stone-300">Built-in guardrails</span>
            </div>
          </FadeIn>
          <FadeIn delay={0.3}>
            <div className="mt-12 flex flex-wrap gap-4">
              <a href={onboardingHref} className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-6 py-3 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90">
                Get started free <ArrowRight size={16} />
              </a>
              <a href={PUBLIC_DEMO_HREF} className="inline-flex items-center gap-2 rounded-md border border-[#d2b06f]/30 bg-[#d2b06f]/10 px-6 py-3 text-sm font-medium text-[#f3ddae] transition-all duration-200 hover:bg-[#d2b06f]/15">
                See the walkthrough <ArrowUpRight size={15} />
              </a>
            </div>
          </FadeIn>
          <FadeIn delay={0.36}>
            <div className="mt-10 overflow-hidden rounded-2xl border border-white/10 bg-[#10151c] shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-stone-500">At a glance</p>
                  <p className="mt-1 text-sm text-stone-300">One worker, one approval, one receipt.</p>
                </div>
                <a href={PUBLIC_DEMO_HREF} className="inline-flex items-center gap-2 text-sm font-medium text-[#d2b06f] transition-colors hover:text-[#e2c994]">
                  Open demo <ArrowUpRight size={15} />
                </a>
              </div>
              <div className="grid gap-px bg-white/10 lg:grid-cols-4">
                {walkthroughSteps.map((item) => (
                  <div key={item.label} className="bg-[#0d1218] px-5 py-5">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-stone-500">{item.label}</p>
                    <p className="mt-3 text-sm font-medium leading-relaxed text-stone-100">{item.value}</p>
                    <p className="mt-2 text-sm leading-relaxed text-stone-400">{item.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      <section className="border-t border-white/10">
        <div className="mx-auto grid max-w-7xl items-start gap-16 px-6 py-24 lg:grid-cols-2 lg:gap-24 lg:px-8 lg:py-32">
          <FadeIn>
            <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">What Nooterra is</p>
            <h2 className="text-3xl leading-tight text-stone-100 md:text-4xl lg:text-5xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
              Describe any job.
              <br />
              <em className="not-italic text-[#d2b06f]">Get a worker that runs forever.</em>
            </h2>
          </FadeIn>
          <FadeIn delay={0.15}>
            <div className="space-y-6 leading-relaxed text-stone-300">
              <p className="text-lg">
                "Monitor my competitors." "Triage my inbox." "Process refunds under $100 automatically." Say what you need in plain English. Nooterra asks the right questions, connects the right tools, and deploys a worker that actually does it.
              </p>
              <p>
                The worker runs 24/7 with hard guardrails — what it can do, what needs your approval, what it can never touch. Every action creates a receipt. Anything can be disputed.
              </p>
              <p className="text-stone-500">
                Use any AI provider. Connect any tools via MCP. Your imagination is the limit — from serious enterprise ops to side projects.
              </p>
            </div>
          </FadeIn>
        </div>
      </section>

      <section className="border-t border-white/10 bg-[#0b0f14]">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <FadeIn>
            <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">How it works</p>
            <h2 className="mb-16 text-3xl text-stone-100 md:text-4xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>One clear path every time.</h2>
          </FadeIn>
          <div className="overflow-hidden rounded-lg bg-white/10 lg:grid lg:grid-cols-4 lg:gap-px">
            {[
              {
                icon: Shield,
                step: "01",
                title: "Describe",
                desc: "Tell Nooterra what you want done. It asks one question at a time until the worker has purpose, tools, and guardrails."
              },
              {
                icon: FileCheck,
                step: "02",
                title: "Deploy",
                desc: "The worker goes live with a charter: what it can do, what it asks first, what it never does. Runs 24/7 on your schedule."
              },
              {
                icon: Clock,
                step: "03",
                title: "Approve",
                desc: "When the worker hits a boundary, you get a notification. Approve from Slack, terminal, web, or mobile with one click."
              },
              {
                icon: RotateCcw,
                step: "04",
                title: "Receipt",
                desc: "Every action produces a readable record. Dispute anything. Full audit trail. Real recourse."
              }
            ].map((item, index) => (
              <FadeIn key={item.step} delay={index * 0.1}>
                <div className="flex h-full flex-col bg-[#10151c] p-8 lg:p-10">
                  <span className="mb-6 font-mono text-xs text-stone-500">{item.step}</span>
                  <item.icon className="mb-4 h-5 w-5 text-[#d2b06f]" />
                  <h3 className="mb-3 text-xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>{item.title}</h3>
                  <p className="flex-1 text-sm leading-relaxed text-stone-400">{item.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-white/10">
        <div className="mx-auto grid max-w-7xl gap-16 px-6 py-24 lg:grid-cols-5 lg:px-8 lg:py-32">
          <div className="lg:col-span-2">
            <FadeIn>
              <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">Why teams use it</p>
              <h2 className="mb-6 text-3xl text-stone-100 md:text-4xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                One system
                <br />
                <span className="text-[#d2b06f]">for builders, operators, and finance.</span>
              </h2>
              <p className="leading-relaxed text-stone-400">
              Builders want one integration instead of rebuilding policy, approvals, receipts, and operator controls. Operators want one place to review and step in.
              Finance and security want a record they can actually trust later.
              </p>
            </FadeIn>
          </div>
          <div className="lg:col-span-3">
            <div className="mb-6 rounded-lg border border-white/10 bg-[#11161e] p-6">
              <p className="text-[11px] uppercase tracking-[0.18em] text-stone-500">What people are building</p>
              <p className="mt-3 text-sm leading-relaxed text-stone-300">
                Competitor price monitors. Inbox triage bots. Automated refund processors. Security audit runners. Customer onboarding assistants. Content moderators. If you can describe the job, Nooterra can run it — with guardrails, approvals, and receipts built in.
              </p>
            </div>
            <div className="grid gap-6 sm:grid-cols-3">
              <FadeIn delay={0.1}>
                <div className="rounded-lg border border-white/10 bg-[#11161e] p-6">
                  <p className="text-xs font-medium uppercase tracking-wider text-[#d2b06f]">Builders</p>
                  <h3 className="mt-3 text-xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>Ship faster</h3>
                  <p className="mt-3 text-sm leading-relaxed text-stone-300">
                    Add one integration for identity, authority, approvals, and receipts instead of building a trust stack from scratch.
                  </p>
                </div>
              </FadeIn>
              <FadeIn delay={0.2}>
                <div className="rounded-lg border border-white/10 bg-[#11161e] p-6">
                  <p className="text-xs font-medium uppercase tracking-wider text-[#d2b06f]">Operators</p>
                  <h3 className="mt-3 text-xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>Stay in control</h3>
                  <p className="mt-3 text-sm leading-relaxed text-stone-300">
                    Review, revoke, pause, dispute, or freeze worker action from one place instead of chasing logs across hosts and vendors.
                  </p>
                </div>
              </FadeIn>
              <FadeIn delay={0.3}>
                <div className="rounded-lg border border-white/10 bg-[#11161e] p-6">
                  <p className="text-xs font-medium uppercase tracking-wider text-[#d2b06f]">Finance & security</p>
                  <h3 className="mt-3 text-xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>Trust the record</h3>
                  <p className="mt-3 text-sm leading-relaxed text-stone-300">
                    See what was requested, what was approved, what happened, and what can still be reversed.
                  </p>
                </div>
              </FadeIn>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-white/10 bg-[#0b0f14]">
        <div className="mx-auto max-w-7xl px-6 py-24 text-center lg:px-8 lg:py-32">
          <FadeIn>
            <h2 className="mb-6 text-4xl text-stone-100 md:text-5xl lg:text-6xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
              Start with one action.
              <br />
              <span className="text-[#d2b06f]">Prove the loop. Expand from there.</span>
            </h2>
            <p className="mx-auto mb-10 max-w-xl text-stone-400">
              The first win is simple: one worker, one approval, one scoped action, one receipt. Once that path is stable, you can widen authority with confidence.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <a href={onboardingHref} className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-6 py-3 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90">
                Get started free <ArrowRight size={16} />
              </a>
            </div>
          </FadeIn>
        </div>
      </section>
    </SiteLayout>
  );
}

function ProductPage() {
  return (
    <SiteLayout>
      <section className="relative flex min-h-[72vh] items-end overflow-hidden">
        <div className="lovable-grid absolute inset-0 opacity-[0.03]" />
        <div className="lovable-orb lovable-orb-a" />
        <div className="lovable-orb lovable-orb-b" />
        <div className="relative mx-auto grid max-w-7xl gap-14 px-6 py-24 lg:grid-cols-[minmax(0,1fr),24rem] lg:px-8 lg:py-32">
          <div>
            <FadeIn>
              <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">Product</p>
              <h1 className="max-w-4xl text-4xl leading-tight text-stone-100 md:text-5xl lg:text-6xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                AI workers that
                <br />
                <span className="text-[#d2b06f]">actually do real work.</span>
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-relaxed text-stone-400">
                Describe any job. Nooterra deploys a worker with the right AI, the right tools, and hard guardrails.
                It runs 24/7, notifies you when it needs approval, and proves everything it did.
              </p>
            </FadeIn>
            <FadeIn delay={0.15}>
              <div className="mt-10 flex flex-wrap gap-4">
                <a href={PRODUCT_ONBOARDING_HREF} className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-6 py-3 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90">
                  Get started free <ArrowRight size={16} />
                </a>
              <a href={PUBLIC_DEMO_HREF} className="inline-flex items-center gap-2 rounded-md border border-[#d2b06f]/30 bg-[#d2b06f]/10 px-6 py-3 text-sm font-medium text-[#f3ddae] transition-all duration-200 hover:bg-[#d2b06f]/15">
                See the walkthrough <ArrowUpRight size={15} />
              </a>
            </div>
            </FadeIn>
          </div>

          <FadeIn delay={0.2} className="self-end">
            <div className="lovable-panel lovable-panel-strong">
              <div className="mb-6 flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-stone-500">What ships today</p>
                  <h2 className="mt-2 text-2xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                    Broad workers. Hard guardrails.
                  </h2>
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[#d2b06f]">
                  Universal worker runtime
                </div>
              </div>
              <div className="space-y-3">
                {[
                  { title: "Create", body: "Describe the job in plain language. Nooterra asks the right questions, infers what tools are needed, and generates a charter with guardrails." },
                  { title: "Run", body: "Workers run 24/7 as daemons with schedules, webhooks, and file watchers. Use CLI, web dashboard, or API — same worker everywhere." },
                  { title: "Trust", body: "Every action produces a receipt. Approvals happen when they matter. Anything can be disputed, reversed, or frozen." }
                ].map((item, index) => (
                  <div key={item.title} className="lovable-rail-row">
                    <div className="lovable-rail-index">0{index + 1}</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-stone-100">{item.title}</p>
                      <p className="mt-1 text-sm leading-relaxed text-stone-400">{item.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      <section className="border-t border-white/10">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <FadeIn>
            <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">What the product does</p>
            <h2 className="mb-16 text-3xl text-stone-100 md:text-4xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
              Turn risky agent execution into accountable work.
            </h2>
          </FadeIn>
          <div className="grid gap-5 lg:grid-cols-4">
            {[
              {
                title: "Worker runtime",
                body: "Give the worker a durable identity, owner, policy envelope, and budget instead of a loose bundle of tools and secrets."
              },
              {
                title: "Approvals",
                body: "Route high-consequence actions to a human when the limits say it matters, then resume cleanly."
              },
              {
                title: "Receipts",
                body: "Keep one readable record of what was requested, what was approved, and what actually happened."
              },
              {
                title: "Disputes",
                body: "Make bad outcomes recoverable with a clear challenge path, not a support dead end."
              }
            ].map((item, index) => (
              <FadeIn key={item.title} delay={0.08 * index}>
                <div className="lovable-panel h-full">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-stone-500">0{index + 1}</p>
                  <h3 className="mt-3 text-2xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                    {item.title}
                  </h3>
                  <p className="mt-4 text-sm leading-relaxed text-stone-400">{item.body}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-white/10 bg-[#0b0f14]">
        <div className="mx-auto grid max-w-7xl gap-16 px-6 py-24 lg:grid-cols-[1.1fr,0.9fr] lg:px-8 lg:py-32">
          <FadeIn>
            <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">Who it is for</p>
            <h2 className="text-3xl text-stone-100 md:text-4xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
              The same product serves the people building, approving, and trusting the action.
            </h2>
            <p className="mt-6 max-w-2xl leading-relaxed text-stone-400">
              Developers want one integration point. Operators want one place to review and step in. Finance and security want a durable record with a clear stop button. The governed worker layer is valuable because it satisfies all three at once.
            </p>
          </FadeIn>
          <div className="grid gap-4">
            {[
              { title: "Builders", body: "Add one SDK call and stop rebuilding approval bots, policy logic, and receipt storage from scratch." },
              { title: "Operators", body: "Intervene, revoke, refund, or freeze from one place when a live action goes sideways." },
              { title: "Finance and security", body: "See what happened, why it was allowed, and how to challenge it later without chasing logs across systems." }
            ].map((item, index) => (
              <FadeIn key={item.title} delay={0.1 * index}>
                <div className="lovable-panel">
                  <div className="mb-3 flex items-center gap-2">
                    <Check className="h-4 w-4 text-[#d2b06f]" />
                    <h3 className="text-base text-stone-100">{item.title}</h3>
                  </div>
                  <p className="text-sm leading-relaxed text-stone-400">{item.body}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-white/10">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
          <FadeIn>
            <div className="lovable-panel lovable-cta-band flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="mb-3 text-xs uppercase tracking-[0.2em] text-stone-500">Start now</p>
                <h2 className="text-3xl text-stone-100 md:text-4xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                  Ship one real action before you widen scope.
                </h2>
                <p className="mt-4 max-w-2xl text-stone-400">
                  The right first win is one approval, one action, and one receipt that everyone can understand. That is how teams start trusting agent execution.
                </p>
              </div>
              <div className="flex flex-wrap gap-4">
                <a href={PRODUCT_ONBOARDING_HREF} className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-6 py-3 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90">
                  Get started free <ArrowRight size={16} />
                </a>
              <a href={PUBLIC_DEMO_HREF} className="inline-flex items-center gap-2 rounded-md border border-[#d2b06f]/30 bg-[#d2b06f]/10 px-6 py-3 text-sm font-medium text-[#f3ddae] transition-all duration-200 hover:bg-[#d2b06f]/15">
                See the walkthrough <ArrowUpRight size={15} />
              </a>
            </div>
            </div>
          </FadeIn>
        </div>
      </section>
    </SiteLayout>
  );
}

function DemoPage() {
  const demoScenarios = [
    {
      id: "claude_recovery",
      label: "Claude recovery",
      title: "Recover from Claude MCP",
      intro: "One worker asks to cancel a duplicate subscription, a manager approves it, and the same run closes with a receipt plus a recovery path.",
      onboardingHref: buildManagedOnboardingHref("demo_claude_recovery"),
      docsHref: docsLinks.claudeDesktopQuickstart,
      docsLabel: "Claude quickstart",
      overview: [
        { label: "Worker", value: "Finance Ops Worker", body: "Owned by Midtown Growth. Budget capped at $250/month. Rules allow supervised vendor action with hosted review." },
        { label: "Host", value: "Claude MCP", body: "The model stays in Claude. Nooterra only steps in when the action needs budget, approval, or proof." },
        { label: "Action", value: "Cancel duplicate analytics subscription and recover credit", body: "The worker gathers vendor context first. Hosted approval opens because the team wants a human on the first recovery action." },
        { label: "Outcome", value: "Receipt verified. Recovery path still open.", body: "The worker acts after approval, and the operator can still unwind or dispute the result if the vendor never follows through." }
      ],
      rail: [
        { state: "Issued", title: "Worker account exists before the action", body: "Identity, owner, limits, and recovery path are already attached before the host tries anything consequential." },
        { state: "Pending", title: "Hosted approval opens for a real person", body: "The request leaves the host and lands on a clean review surface with policy context, amount, and evidence requirements." },
        { state: "Executed", title: "The action closes with evidence and receipt", body: "Execution only happens after the grant is valid. The receipt keeps the exact run, approval, and proof chain readable." },
        { state: "Recoverable", title: "Operators still have a path back", body: "Dispute, refund, retry, and quarantine stay in the same record instead of becoming a support-ticket scavenger hunt." }
      ],
      artifactStats: [
        { label: "Host", value: "Claude MCP", body: "Launch host with the cleanest first approval path." },
        { label: "Approval state", value: "Waiting for Alex Chen", body: "The first recovery action still requires a manager because the saved rule is not in place yet." },
        { label: "Receipt ID", value: "rcpt_demo_20260318_001", body: "Deterministic sample data, matching the real receipt flow." }
      ]
    },
    {
      id: "openclaw_cancel",
      label: "OpenClaw recovery",
      title: "Cancel and recover from OpenClaw",
      intro: "OpenClaw handles the shell. Nooterra keeps the cancellation, refund, receipt, and recovery path tied to one worker record.",
      onboardingHref: buildManagedOnboardingHref("demo_openclaw_cancel"),
      docsHref: docsLinks.openClawQuickstart,
      docsLabel: "OpenClaw guide",
      overview: [
        { label: "Worker", value: "Ops Recovery Worker", body: "Owned by Northstar Ops. Recovery pack enabled. Budget is irrelevant here; proof and recourse are the real product." },
        { label: "Host", value: "OpenClaw", body: "The shell is more autonomous, but approval, receipt, and dispute still stay on the same hosted Nooterra surfaces." },
        { label: "Action", value: "Cancel duplicate analytics subscription and recover credit", body: "The worker submits vendor evidence, asks for approval, and binds the refund path to the same run." },
        { label: "Outcome", value: "Refund promised. Receipt linked. Recourse still open.", body: "The action is successful only because the recovery record is readable later, not because the model said it was done." }
      ],
      rail: [
        { state: "Issued", title: "Action policy is already attached", body: "The worker gets permission for this vendor action before the shell starts improvising around vendor state." },
        { state: "Review", title: "Evidence lands before the operator decides", body: "The hosted approval surface shows the subscription, the duplicate signal, and the requested recovery amount." },
        { state: "Executed", title: "Cancellation and refund promise stay tied together", body: "The receipt captures both the reversal and the vendor promise so finance can validate what happened later." },
        { state: "Recoverable", title: "Dispute stays available if the refund never lands", body: "Recourse remains a first-class path when a vendor claims compliance but the money never returns." }
      ],
      artifactStats: [
        { label: "Host", value: "OpenClaw", body: "More autonomous shell, same approval boundary." },
        { label: "Approval state", value: "Evidence submitted for review", body: "The operator sees the duplicate charge context before authorizing recovery." },
        { label: "Receipt ID", value: "rcpt_demo_20260318_014", body: "The receipt links cancellation, refund promise, and dispute eligibility in one record." }
      ]
    },
    {
      id: "api_refund",
      label: "API refund lane",
      title: "Direct API refund flow",
      intro: "For builders who want the shortest scriptable path: open approval, submit evidence, finalize, and fetch the receipt over API.",
      onboardingHref: buildManagedOnboardingHref("demo_api_refund"),
      docsHref: docsLinks.codexEngineeringQuickstart,
      docsLabel: "API / CLI quickstart",
      overview: [
        { label: "Worker", value: "Support Recovery Worker", body: "Owned by Meridian Support. Refund and dispute evidence packs are preconfigured for scriptable workflows." },
        { label: "Host", value: "REST API", body: "No special shell. The runtime still has identity, approval, evidence, receipt, and dispute semantics." },
        { label: "Action", value: "Recover $89 duplicate charge", body: "The client opens approval, attaches counterparty evidence, then finalizes the same grant into one receipt." },
        { label: "Outcome", value: "Receipt fetched over API. Counterparty evidence preserved.", body: "The API path is useful because it lands on the same receipt and dispute surfaces as every other host." }
      ],
      rail: [
        { state: "Issued", title: "Scriptable worker runtime exists first", body: "The API path starts from the same managed worker runtime as Claude, OpenClaw, and Codex." },
        { state: "Pending", title: "Approval URL is still a hosted human surface", body: "Even the shortest HTTP path must hand humans into the same hosted approval page when a rule requires review." },
        { state: "Executed", title: "Finalize only after evidence is bound", body: "The grant stays incomplete until the counterparty evidence bundle matches the approval and execution context." },
        { state: "Recoverable", title: "Receipts stay aligned across channels", body: "Fetching the receipt over API does not create a second truth. It resolves the same worker record." }
      ],
      artifactStats: [
        { label: "Host", value: "REST API", body: "Shortest integration path, same managed runtime underneath." },
        { label: "Approval state", value: "Approved through hosted review URL", body: "The human decision still lives on the same Nooterra approval surface." },
        { label: "Receipt ID", value: "rcpt_demo_20260318_021", body: "Counterparty evidence and finalization outcome stay attached to one deterministic record." }
      ]
    }
  ];
  const [activeScenarioId, setActiveScenarioId] = useState("claude_recovery");
  const activeScenario = demoScenarios.find((scenario) => scenario.id === activeScenarioId) ?? demoScenarios[0];

  return (
    <SiteLayout>
      <section className="relative flex min-h-[76vh] items-end overflow-hidden">
        <div className="lovable-grid absolute inset-0 opacity-[0.03]" />
        <div className="lovable-orb lovable-orb-a" />
        <div className="lovable-orb lovable-orb-b" />
        <div className="relative mx-auto grid max-w-7xl gap-14 px-6 py-24 lg:grid-cols-[minmax(0,1fr),24rem] lg:px-8 lg:py-32">
          <div>
            <FadeIn>
              <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">Public demo</p>
              <h1 className="max-w-4xl text-4xl leading-tight text-stone-100 md:text-5xl lg:text-6xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                See one worker go
                <br />
                <span className="text-[#d2b06f]">from request to receipt.</span>
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-relaxed text-stone-400">
                Preview one worker flow with sample data before you create a workspace.
              </p>
            </FadeIn>
            <FadeIn delay={0.11}>
              <div className="mt-8 flex flex-wrap gap-3">
                {demoScenarios.map((scenario) => {
                  const isActive = scenario.id === activeScenario.id;
                  return (
                    <button
                      key={scenario.id}
                      type="button"
                      onClick={() => setActiveScenarioId(scenario.id)}
                      className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-all duration-200 ${
                        isActive
                          ? "border-[#d2b06f]/40 bg-[#d2b06f]/12 text-[#f3ddae]"
                          : "border-white/10 bg-white/5 text-stone-300 hover:bg-white/10"
                      }`}
                    >
                      {scenario.label}
                    </button>
                  );
                })}
              </div>
            </FadeIn>
            <FadeIn delay={0.15}>
              <div className="mt-10 flex flex-wrap gap-4">
                <a href={activeScenario.onboardingHref} className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-6 py-3 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90">
                  Get started free <ArrowRight size={16} />
                </a>
                <a href={activeScenario.docsHref} className="inline-flex items-center gap-2 rounded-md border border-[#d2b06f]/30 bg-[#d2b06f]/10 px-6 py-3 text-sm font-medium text-[#f3ddae] transition-all duration-200 hover:bg-[#d2b06f]/15">
                  {activeScenario.docsLabel} <ArrowUpRight size={15} />
                </a>
              </div>
            </FadeIn>
            <FadeIn delay={0.2}>
              <p className="mt-5 max-w-2xl text-sm leading-relaxed text-stone-500">{activeScenario.intro}</p>
            </FadeIn>
          </div>

          <FadeIn delay={0.2} className="self-end">
            <div className="lovable-panel lovable-panel-strong">
              <div className="mb-6 flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-stone-500">Scenario</p>
                  <h2 className="mt-2 text-2xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                    {activeScenario.title}
                  </h2>
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[#d2b06f]">
                  Example
                </div>
              </div>
              <div className="space-y-3">
                {activeScenario.rail.map((item, index) => (
                  <div key={item.title} className="lovable-rail-row">
                    <div className="lovable-rail-index">0{index + 1}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-stone-100">{item.title}</p>
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-stone-400">
                          {item.state}
                        </span>
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-stone-400">{item.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      <section className="border-t border-white/10">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <FadeIn>
            <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">Preview</p>
            <h2 className="mb-16 text-3xl text-stone-100 md:text-4xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
              What the flow looks like.
              <br />
              <span className="text-[#d2b06f]">The same steps happen after setup.</span>
            </h2>
          </FadeIn>
          <div className="grid gap-5 lg:grid-cols-4">
            {activeScenario.overview.map((item, index) => (
              <FadeIn key={item.label} delay={0.08 * index}>
                <div className="lovable-panel h-full">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-stone-500">{item.label}</p>
                  <h3 className="mt-3 text-2xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                    {item.value}
                  </h3>
                  <p className="mt-4 text-sm leading-relaxed text-stone-400">{item.body}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-white/10 bg-[#0b0f14]">
        <div className="mx-auto grid max-w-7xl gap-16 px-6 py-24 lg:grid-cols-[1.1fr,0.9fr] lg:px-8 lg:py-32">
          <FadeIn>
            <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">Why this matters</p>
            <h2 className="text-3xl text-stone-100 md:text-4xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
              Show the workflow
              <br />
              <span className="text-[#d2b06f]">before asking for setup.</span>
            </h2>
            <p className="mt-6 max-w-2xl leading-relaxed text-stone-400">
              A preview gives operators, finance, and builders the same mental model before anyone creates a workspace or opens the docs.
            </p>
          </FadeIn>
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
            {activeScenario.artifactStats.map((stat, index) => (
              <FadeIn key={stat.label} delay={0.08 * index}>
                <div className="lovable-stat-card">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-stone-500">{stat.label}</p>
                  <p className="mt-3 text-xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                    {stat.value}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-stone-400">{stat.body}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-white/10 bg-[#0b0f14]">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
          <FadeIn>
            <div className="lovable-panel lovable-cta-band flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="mb-3 text-xs uppercase tracking-[0.2em] text-stone-500">Next step</p>
                <h2 className="text-3xl text-stone-100 md:text-4xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                  Turn the fake run into a real one.
                </h2>
                <p className="mt-4 max-w-2xl text-stone-400">
                  Create a workspace, connect one supported host, and prove the same loop with a real approval and a real receipt.
                </p>
              </div>
              <div className="flex flex-wrap gap-4">
                <a href={activeScenario.onboardingHref} className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-6 py-3 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90">
                  Get started free <ArrowRight size={16} />
                </a>
                <a href={activeScenario.docsHref} className="inline-flex items-center gap-2 rounded-md border border-white/15 px-6 py-3 text-sm font-medium text-stone-100 transition-all duration-200 hover:bg-white/5">
                  {activeScenario.docsLabel} <ArrowUpRight size={15} />
                </a>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>
    </SiteLayout>
  );
}

function PricingPage() {
  const builderOnboardingHref = PRICING_ONBOARDING_HREF;
  const tiers = [
    {
      title: "Free",
      eyebrow: "Local",
      body: "Create unlimited workers on your machine. Your API keys, your data, no cloud required.",
      points: [
        "Unlimited local workers",
        "Connect any AI provider",
        "Full charter and governance",
        "Runs on your machine"
      ],
      cta: { label: "Download free", href: builderOnboardingHref },
      featured: false
    },
    {
      title: "Pro",
      eyebrow: "$29/month",
      body: "Workers that run in the cloud, 24/7. Approvals from anywhere. Perfect for solo builders and small teams.",
      points: [
        "Cloud-hosted workers",
        "Mobile and Slack approvals",
        "Webhook integrations",
        "Usage-based compute"
      ],
      cta: { label: "Start Pro trial", href: builderOnboardingHref },
      featured: true
    },
    {
      title: "Team",
      eyebrow: "$99/month",
      body: "Shared workers across your team. Audit logs, SSO, and controls that make compliance happy.",
      points: [
        "Shared worker dashboard",
        "Team approval workflows",
        "SSO and admin controls",
        "Audit logs and retention"
      ],
      cta: { label: "Talk to us", href: builderOnboardingHref },
      featured: false
    }
  ];

  return (
    <SiteLayout>
      <section className="relative flex min-h-[68vh] items-end overflow-hidden">
        <div className="lovable-grid absolute inset-0 opacity-[0.03]" />
        <div className="lovable-orb lovable-orb-a" />
        <div className="lovable-orb lovable-orb-b" />
        <div className="relative mx-auto grid max-w-7xl gap-14 px-6 py-24 lg:grid-cols-[minmax(0,1fr),24rem] lg:px-8 lg:py-32">
          <div>
            <FadeIn>
              <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">Pricing</p>
              <h1 className="max-w-4xl text-4xl leading-tight text-stone-100 md:text-5xl lg:text-6xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                Free to start.
                <br />
                <span className="text-[#d2b06f]">Scale when you're ready.</span>
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-relaxed text-stone-400">
                Create unlimited workers on your machine for free. Your API keys, your data, no cloud required. Upgrade when you need 24/7 hosting or team features.
              </p>
            </FadeIn>
            <FadeIn delay={0.15}>
              <div className="mt-10 flex flex-wrap gap-4">
                <a href={PRICING_ONBOARDING_HREF} className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-6 py-3 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90">
                  Start building free <ArrowRight size={16} />
                </a>
                <a href="/support" className="inline-flex items-center gap-2 rounded-md border border-white/15 px-6 py-3 text-sm font-medium text-stone-100 transition-all duration-200 hover:bg-white/5">
                  Talk to us
                </a>
              </div>
            </FadeIn>
          </div>

          <FadeIn delay={0.2} className="self-end">
            <div className="lovable-panel lovable-panel-strong">
              <div className="mb-6 flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-stone-500">Pricing philosophy</p>
                  <h2 className="mt-2 text-2xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                    Your machine first. Our cloud when you're ready.
                  </h2>
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[#d2b06f]">
                  No lock-in
                </div>
              </div>
              <div className="space-y-3">
                {[
                  { title: "Free means actually free", body: "Local workers with your API keys. No credit card. No usage limits." },
                  { title: "Cloud is opt-in", body: "Only pay when you want 24/7 hosting, mobile approvals, or team features." },
                  { title: "Portable by design", body: "Export your workers anytime. Your charters and data stay yours." }
                ].map((item, index) => (
                  <div key={item.title} className="lovable-rail-row">
                    <div className="lovable-rail-index">0{index + 1}</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-stone-100">{item.title}</p>
                      <p className="mt-1 text-sm leading-relaxed text-stone-400">{item.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      <section className="border-t border-white/10">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <FadeIn>
            <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">Plans</p>
            <h2 className="mb-16 text-3xl text-stone-100 md:text-4xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
              Three plans for the same product.
            </h2>
          </FadeIn>
          <div className="grid gap-5 lg:grid-cols-3">
            {tiers.map((tier, index) => (
              <FadeIn key={tier.title} delay={0.08 * index}>
                <div className={`lovable-panel h-full ${tier.featured ? "border-[#d2b06f]/35 bg-[#11161e]" : ""}`}>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-stone-500">{tier.eyebrow}</p>
                  <h3 className="mt-3 text-3xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                    {tier.title}
                  </h3>
                  <p className="mt-4 text-sm leading-relaxed text-stone-400">{tier.body}</p>
                  <div className="mt-6 space-y-3">
                    {tier.points.map((point) => (
                      <div key={point} className="flex items-start gap-3">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#d2b06f]" />
                        <p className="text-sm leading-relaxed text-stone-300">{point}</p>
                      </div>
                    ))}
                  </div>
                  <a href={tier.cta.href} className={`mt-8 inline-flex items-center gap-2 rounded-md px-5 py-2.5 text-sm font-medium transition-all duration-200 ${
                    tier.featured
                      ? "bg-[#d2b06f] text-[#0b0f14] hover:opacity-90"
                      : "border border-white/15 text-stone-100 hover:bg-white/5"
                  }`}>
                    {tier.cta.label} <ArrowRight size={15} />
                  </a>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-white/10 bg-[#0b0f14]">
        <div className="mx-auto grid max-w-7xl gap-16 px-6 py-24 lg:grid-cols-[1.1fr,0.9fr] lg:px-8 lg:py-32">
          <FadeIn>
            <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">How teams start</p>
            <h2 className="text-3xl text-stone-100 md:text-4xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
              The first paid step feels like product value, not procurement theater.
            </h2>
            <p className="mt-6 max-w-2xl leading-relaxed text-stone-400">
              Builders and operator teams can create a workspace, connect one host, and prove the first approval-to-receipt flow quickly. Once the product touches real money or real operations, that same flow becomes the enterprise entry point.
            </p>
          </FadeIn>
          <div className="grid gap-4">
            {[
              { title: "Builder motion", body: "Self-serve onboarding, fast docs, and one first governed action from Claude, OpenClaw, Codex, CLI, or API." },
              { title: "Operator motion", body: "Shared controls, live approvals, and a record that makes sense to someone outside the model loop." },
              { title: "Enterprise motion", body: "Admin controls, stronger rollout support, and a clean path into security, finance, and ops review." }
            ].map((item, index) => (
              <FadeIn key={item.title} delay={0.1 * index}>
                <div className="lovable-panel">
                  <div className="mb-3 flex items-center gap-2">
                    <Check className="h-4 w-4 text-[#d2b06f]" />
                    <h3 className="text-base text-stone-100">{item.title}</h3>
                  </div>
                  <p className="text-sm leading-relaxed text-stone-400">{item.body}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}

function DevelopersPage() {
  const onboardingHref = buildManagedOnboardingHref("developers");
  const tabs = [
    {
      id: "mcp",
      label: "Claude MCP",
      desc: "Give Claude one tool for real-world action. Nooterra handles approvals, receipts, and recovery around it.",
      docsHref: docsLinks.claudeDesktopQuickstart,
      docsLabel: "Claude quickstart",
      code: `# Install the Nooterra MCP server
npx @nooterra/mcp-server init

# Configure the host
{
  "mcpServers": {
    "nooterra": {
      "command": "npx",
      "args": ["@nooterra/mcp-server"],
      "env": {
        "NOOTERRA_API_KEY": "nt_live_..."
      }
    }
  }
}`
    },
    {
      id: "openclaw",
      label: "OpenClaw",
      desc: "Drop Nooterra into OpenClaw and keep approvals, receipts, and recourse consistent.",
      docsHref: docsLinks.openClawQuickstart,
      docsLabel: "OpenClaw quickstart",
      code: `import { NooterraClaw } from "@nooterra/openclaw";

const claw = new NooterraClaw({
  apiKey: process.env.NOOTERRA_API_KEY,
});

const result = await claw.execute({
  action: "cancel_recover",
  summary: "Cancel the duplicate analytics subscription and recover credit",
  vendor: "example.com",
});`
    },
    {
      id: "cli",
      label: "CLI",
      desc: "Create and manage workers from your terminal. The full power of Nooterra in a conversational interface.",
      docsHref: docsLinks.codexEngineeringQuickstart,
      docsLabel: "CLI guide",
      code: `# Install Nooterra
npm install -g nooterra

# Create your first worker interactively
nooterra

# Or create directly
nooterra new

# Manage running workers
nooterra workers
nooterra runtime daemon status`
    },
    {
      id: "api",
      label: "REST API",
      desc: "Call the same runtime directly over HTTP when you want the shortest integration path.",
      docsHref: docsLinks.api,
      docsLabel: "API reference",
      code: `# Open one hosted approval through the onboarding path
curl -X POST https://api.nooterra.ai/v1/tenants/$NOOTERRA_TENANT_ID/onboarding/seed-hosted-approval \\
  -H "Authorization: Bearer $NOOTERRA_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "hostTrack": "codex"
  }'

# Then close the same approval path with one receipt
curl -X POST https://api.nooterra.ai/v1/tenants/$NOOTERRA_TENANT_ID/onboarding/first-paid-call \\
  -H "Authorization: Bearer $NOOTERRA_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{}'`
    }
  ];
  const [activeTab, setActiveTab] = useState("mcp");
  const active = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];
  const firstActionTracks = {
    mcp: {
      title: "What to prove first",
      body: "Install the MCP server, trigger one action that needs permission, and make sure the request lands on a hosted approval page a real user could trust.",
      success: "Good looks like: approval, action, and receipt all stay connected to the same run."
    },
    openclaw: {
      title: "What to prove first",
      body: "Trigger one approval-required action and keep the decision on Nooterra’s hosted approval surface instead of inventing a custom control flow.",
      success: "Good looks like: the OpenClaw path feels just as clean as the Claude path."
    },
    cli: {
      title: "What to prove first",
      body: "Bootstrap one workspace, seed one hosted approval, and let the terminal print the real approval and receipt links instead of a fake local success state.",
      success: "Good looks like: the CLI proves the same product loop as the hosted app."
    },
    api: {
      title: "What to prove first",
      body: "Use the managed onboarding endpoints first. Open approval from the API, then close the same run with a real receipt and recourse trail.",
      success: "Good looks like: one API path opens approval, another finishes the same action cleanly."
    }
  };
  const activeTrack = firstActionTracks[active.id] ?? firstActionTracks.mcp;

  return (
    <SiteLayout>
      <section className="flex min-h-[60vh] items-end">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
            <FadeIn>
              <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">Developers</p>
              <h1 className="max-w-3xl text-4xl leading-tight text-stone-100 md:text-5xl lg:text-6xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
              Build with Nooterra
              <br />
              <span className="text-[#d2b06f]">in 5 minutes.</span>
              </h1>
            <p className="mt-6 max-w-2xl text-lg text-stone-400">
              CLI, MCP, REST API, or framework — pick your integration path. Same worker runtime, same guardrails, same receipts everywhere.
            </p>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-stone-500">
              npm install -g nooterra → nooterra new → your worker is running.
            </p>
          </FadeIn>
        </div>
      </section>

      <section className="border-t border-white/10">
        <div className="mx-auto max-w-7xl px-6 py-16 lg:px-8 lg:py-24">
          <FadeIn>
            <div className="mb-12 flex gap-1 overflow-x-auto border-b border-white/10">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`-mb-px whitespace-nowrap border-b-2 px-5 py-3 text-sm font-medium transition-all duration-200 ${
                    activeTab === tab.id
                      ? "border-[#d2b06f] text-stone-100"
                      : "border-transparent text-stone-500 hover:text-stone-100"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="grid gap-12 lg:grid-cols-5">
              <div className="lg:col-span-2">
                <h3 className="mb-4 text-2xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>{active.label}</h3>
                <p className="leading-relaxed text-stone-400">{active.desc}</p>
                <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-stone-500">{activeTrack.title}</p>
                  <p className="mt-3 text-sm leading-relaxed text-stone-300">{activeTrack.body}</p>
                  <p className="mt-3 text-sm leading-relaxed text-[#d2b06f]">{activeTrack.success}</p>
                </div>
                <div className="mt-6 flex flex-wrap gap-3">
                <a href={onboardingHref} className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-5 py-2.5 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90">
                    Get started free <ArrowRight size={16} />
                </a>
                  <a href={active.docsHref} className="inline-flex items-center gap-2 rounded-md border border-white/15 px-5 py-2.5 text-sm font-medium text-stone-100 transition-all duration-200 hover:bg-white/5">
                    {active.docsLabel} <ArrowUpRight size={15} />
                  </a>
                  <a href={SITE_DOC_ROUTES.designPartnerKit} className="inline-flex items-center gap-2 rounded-md border border-white/15 px-5 py-2.5 text-sm font-medium text-stone-100 transition-all duration-200 hover:bg-white/5">
                    Design partner guide <ArrowUpRight size={15} />
                  </a>
                </div>
              </div>
              <div className="lg:col-span-3">
                <div className="overflow-hidden rounded-lg border border-white/10 bg-[#10151c]">
                  <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
                    <div className="h-2.5 w-2.5 rounded-full bg-white/15" />
                    <div className="h-2.5 w-2.5 rounded-full bg-white/15" />
                    <div className="h-2.5 w-2.5 rounded-full bg-white/15" />
                    <span className="ml-2 font-mono text-xs text-stone-500">{active.id === "api" || active.id === "cli" ? "terminal" : "editor"}</span>
                  </div>
                  <pre className="overflow-x-auto p-6 text-sm leading-relaxed text-stone-300"><code>{active.code}</code></pre>
                </div>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      <section className="border-t border-white/10 bg-[#0b0f14]">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
          <FadeIn>
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="mb-3 text-xs uppercase tracking-[0.2em] text-stone-500">Next step</p>
                <h2 className="text-3xl text-stone-100 md:text-4xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                  Prove the first loop.
                </h2>
                <p className="mt-4 max-w-2xl text-stone-400">
                  Create the workspace, connect one host, and run one approval-to-receipt flow. That is the bar. Everything else comes after.
                </p>
              </div>
              <div className="flex flex-wrap gap-4">
                <a href={onboardingHref} className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-6 py-3 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90">
                  Open onboarding <ArrowRight size={16} />
                </a>
                <a href={SITE_DOC_ROUTES.hostQuickstart} className="inline-flex items-center gap-2 rounded-md border border-white/15 px-6 py-3 text-sm font-medium text-stone-100 transition-all duration-200 hover:bg-white/5">
                  Host quickstart <ArrowUpRight size={15} />
                </a>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>
    </SiteLayout>
  );
}

function IntegrationsPage() {
  const onboardingHref = buildManagedOnboardingHref("integrations");
  const integrations = [
    {
      name: "MCP host",
      desc: "Native Model Context Protocol integration. Compatible hosts can take real-world actions through Nooterra with approvals, receipts, and recovery built in.",
      status: "Available",
      href: docsLinks.claudeDesktopQuickstart,
      ctaLabel: "MCP quickstart"
    },
    {
      name: "Framework runtime",
      desc: "Drop a governed worker into a more agentic framework shell without changing the approval, receipt, and recourse model.",
      status: "Available",
      href: docsLinks.openClawQuickstart,
      ctaLabel: "Framework guide"
    },
    {
      name: "REST API",
      desc: "Direct HTTP integration for any language or framework. Full control over approval flows, receipts, and dispute resolution.",
      status: "Available",
      href: docsLinks.api,
      ctaLabel: "API reference"
    },
    {
      name: "CLI",
      desc: "Manage budgets, inspect receipts, and configure worker controls from your terminal. Scriptable and CI/CD friendly.",
      status: "Available",
      href: docsLinks.codexEngineeringQuickstart,
      ctaLabel: "CLI guide"
    },
    {
      name: "Codex",
      desc: "Use the same governed-worker flow inside Codex and other engineering shells without rebuilding approvals or receipts.",
      status: "Available",
      href: docsLinks.codexEngineeringQuickstart,
      ctaLabel: "Codex guide"
    },
    {
      name: "Webhooks",
      desc: "Real-time notifications for approvals, receipts, disputes, and policy events.",
      status: "Coming soon"
    }
  ];

  return (
    <SiteLayout>
      <section className="flex min-h-[50vh] items-end">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <FadeIn>
            <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">Integrations</p>
            <h1 className="max-w-3xl text-4xl leading-tight text-stone-100 md:text-5xl lg:text-6xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
              Connect the hosts
              <br />
              <span className="text-[#d2b06f]">you already use.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-lg text-stone-400">
              Bring the runtime you already use. MCP hosts, frameworks, Codex, CLI, web, and direct API should all reuse the same governed-worker contract.
            </p>
          </FadeIn>
        </div>
      </section>

      <section className="border-t border-white/10">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <FadeIn>
            <div className="mb-10 grid gap-4 md:grid-cols-3">
              {[
                {
                  title: "Install one runtime",
                  body: "Start with one runtime you trust. One working runtime beats a wide but shaky matrix."
                },
                {
                  title: "Open a real approval",
                  body: "The first proof point is not setup. It is a live approval opening on a page a real user can review."
                },
                {
                  title: "End with a real receipt",
                  body: "A successful integration ends with a readable receipt and a clear recovery path, not just a green terminal line."
                }
              ].map((item) => (
                <div key={item.title} className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
                  <p className="text-sm font-medium text-stone-100">{item.title}</p>
                  <p className="mt-3 text-sm leading-relaxed text-stone-400">{item.body}</p>
                </div>
              ))}
            </div>
            <div className="mb-10 rounded-2xl border border-white/10 bg-white/[0.04] p-6">
                <p className="text-[11px] uppercase tracking-[0.2em] text-stone-500">What launch means right now</p>
                <p className="mt-3 max-w-3xl text-sm leading-relaxed text-stone-300">
                Public beta stays intentionally narrow: one public action family, two launch hosts, one clean path from request to receipt.
                </p>
            </div>
          </FadeIn>
          <div className="overflow-hidden rounded-lg bg-white/10 lg:grid lg:grid-cols-3 lg:gap-px">
            {integrations.map((item, index) => (
              <FadeIn key={item.name} delay={index * 0.08}>
                <div className="flex h-full flex-col bg-[#10151c] p-8">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-lg text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>{item.name}</h3>
                    <span className={`text-xs font-medium uppercase tracking-wider ${item.status === "Available" ? "text-emerald-400" : "text-stone-500"}`}>
                      {item.status}
                    </span>
                  </div>
                  <p className="flex-1 text-sm leading-relaxed text-stone-400">{item.desc}</p>
                  {item.status === "Available" ? (
                    <a href={item.href} className="mt-6 inline-flex items-center gap-1 text-sm text-[#d2b06f] transition-colors hover:text-[#e2c994]">
                      {item.ctaLabel} <ArrowRight size={13} />
                    </a>
                  ) : null}
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-white/10 bg-[#0b0f14]">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
          <FadeIn>
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="mb-3 text-xs uppercase tracking-[0.2em] text-stone-500">Install once</p>
                <h2 className="text-3xl text-stone-100 md:text-4xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                  One contract across every host.
                </h2>
                <p className="mt-4 max-w-2xl text-stone-400">
                  MCP hosts, framework shells, Codex, CLI, or direct API. The shell changes. The approval, receipt, and recovery model does not.
                </p>
              </div>
              <div className="flex flex-wrap gap-4">
                <a href={onboardingHref} className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-6 py-3 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90">
                  Set up runtime <ArrowRight size={16} />
                </a>
                <a href={SITE_DOC_ROUTES.hostQuickstart} className="inline-flex items-center gap-2 rounded-md border border-white/15 px-6 py-3 text-sm font-medium text-stone-100 transition-all duration-200 hover:bg-white/5">
                  Hosts guide <ArrowUpRight size={15} />
                </a>
                <a href={SITE_DOC_ROUTES.designPartnerKit} className="inline-flex items-center gap-2 rounded-md border border-white/15 px-6 py-3 text-sm font-medium text-stone-100 transition-all duration-200 hover:bg-white/5">
                  Design partner guide <ArrowUpRight size={15} />
                </a>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>
    </SiteLayout>
  );
}

function OnboardingPage() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("experience") !== "app") return;
    window.location.replace(MANAGED_ONBOARDING_HREF);
  }, []);

  const activationSteps = [
    {
      title: "Say what you need",
      body: "\"I want a worker that monitors my inbox and forwards urgent emails to Slack.\" Nooterra takes it from there — one question at a time."
    },
    {
      title: "Approve the charter",
      body: "Review what the worker can do, what it asks first, and what it can never touch. Connect your AI provider and tools. Deploy in one click."
    },
    {
      title: "Worker runs forever",
      body: "Your worker operates 24/7 on schedule, webhooks, or file watches. Get notified when it needs you. Every action produces a receipt."
    }
  ];

  const readinessCards = [
    {
      label: "Identity",
      value: "Workspace + operator",
      body: "No anonymous runtime. Every real action starts from an issued identity and a revocable trust boundary."
    },
    {
      label: "Runtime",
      value: "One host, one loop",
      body: "The first win is not a big dashboard. It is install to approval to receipt without handholding."
    },
    {
      label: "Proof",
      value: "Receipt + dispute",
      body: "The flow is only real when the same action can later be verified, challenged, and unwound."
    }
  ];

  const hostTracks = [
    {
      title: "Claude MCP",
      body: "Best first host when you want the cleanest approval handoff and the clearest proof that the product loop works.",
      href: docsLinks.claudeDesktopQuickstart,
      ctaLabel: "Claude quickstart"
    },
    {
      title: "OpenClaw",
      body: "Use the same approval, receipt, and recovery flow inside a more agentic shell.",
      href: docsLinks.openClawQuickstart,
      ctaLabel: "OpenClaw guide"
    },
    {
      title: "Codex / CLI / API",
      body: "Best engineering path when you want a direct integration, scripted tests, and one explicit first real action.",
      href: docsLinks.codexEngineeringQuickstart,
      ctaLabel: "Engineering guide"
    }
  ];

  return (
    <SiteLayout>
      <section className="relative flex min-h-[72vh] items-end overflow-hidden">
        <div className="lovable-grid absolute inset-0 opacity-[0.03]" />
        <div className="lovable-orb lovable-orb-a" />
        <div className="lovable-orb lovable-orb-b" />
        <div className="relative mx-auto grid max-w-7xl gap-14 px-6 py-24 lg:grid-cols-[minmax(0,1fr),24rem] lg:px-8 lg:py-32">
          <div>
            <FadeIn>
              <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">Get started</p>
              <h1 className="max-w-4xl text-4xl leading-tight text-stone-100 md:text-5xl lg:text-6xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                Create your first worker
                <br />
                <span className="text-[#d2b06f]">in under 5 minutes.</span>
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-relaxed text-stone-400">
                Describe what you need. Nooterra builds the worker, connects the tools, and deploys it. Your first worker will be running before you finish your coffee.
              </p>
            </FadeIn>
            <FadeIn delay={0.15}>
              <div className="mt-10 flex flex-wrap gap-4">
                <a
                  href={PUBLIC_SIGNUP_HREF}
                  className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-6 py-3 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90"
                >
                  Get started free <ArrowRight size={16} />
                </a>
                <a
                  href={SITE_DOC_ROUTES.hostQuickstart}
                  className="inline-flex items-center gap-2 rounded-md border border-white/15 px-6 py-3 text-sm font-medium text-stone-100 transition-all duration-200 hover:bg-white/5"
                >
                  Hosts guide <ArrowUpRight size={15} />
                </a>
              </div>
              <p className="mt-4 text-sm text-stone-500">
                Already issued the workspace?{" "}
                <a href={PUBLIC_LOGIN_HREF} className="text-stone-300 transition-colors hover:text-stone-100">
                  Sign in and keep the same approval and receipt trail.
                </a>
              </p>
            </FadeIn>
          </div>

          <FadeIn delay={0.2} className="self-end">
            <div className="lovable-panel lovable-panel-strong">
              <div className="mb-6 flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-stone-500">Activation rail</p>
                  <h2 className="mt-2 text-2xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                    What good onboarding does.
                  </h2>
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[#d2b06f]">
                  First value only
                </div>
              </div>
              <div className="space-y-3">
                {activationSteps.map((item, index) => (
                  <div key={item.title} className="lovable-rail-row">
                    <div className="lovable-rail-index">0{index + 1}</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-stone-100">{item.title}</p>
                      <p className="mt-1 text-sm leading-relaxed text-stone-400">{item.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      <section className="border-t border-white/10">
        <div className="mx-auto grid max-w-7xl gap-16 px-6 py-24 lg:grid-cols-[1.1fr,0.9fr] lg:px-8 lg:py-32">
          <FadeIn>
            <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">First live loop</p>
              <h2 className="text-3xl text-stone-100 md:text-4xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                The activation bar is simple.
              </h2>
              <p className="mt-6 max-w-2xl leading-relaxed text-stone-400">
              The onboarding flow creates the account, points people at one host, and makes the first approval and receipt path obvious.
              </p>
          </FadeIn>
          <div className="grid gap-4">
            {readinessCards.map((card, index) => (
              <FadeIn key={card.label} delay={0.1 * index}>
                <div className="lovable-panel">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-stone-500">{card.label}</p>
                  <h3 className="mt-3 text-xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                    {card.value}
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-stone-400">{card.body}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      <section id="identity-access" className="border-t border-white/10 bg-[#0b0f14]">
        <span id="account-create" aria-hidden="true" />
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
          <FadeIn>
            <div className="lovable-panel lovable-cta-band">
              <div className="grid gap-8 lg:grid-cols-[1fr,18rem] lg:items-end">
                <div>
                  <p className="mb-3 text-xs uppercase tracking-[0.2em] text-stone-500">Identity and access</p>
                  <h2 className="text-3xl text-stone-100 md:text-4xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                    Create the workspace once.
                  </h2>
                  <p className="mt-4 max-w-2xl text-stone-400">
                    This is the only setup users should really feel. It creates the identity, sign-in path, and runtime boundary the live product depends on.
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-[#0d1218] p-5">
                  <div className="flex items-center gap-3">
                    <Lock className="h-4 w-4 text-[#d2b06f]" />
                    <p className="text-sm font-medium text-stone-100">Secure sign-in</p>
                  </div>
                <p className="mt-3 text-sm leading-relaxed text-stone-400">
                    Work email, company, and operator identity. No giant admin project before the first useful action.
                </p>
                </div>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      <section className="border-t border-white/10">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <FadeIn>
            <div className="mb-12 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">Choose one host</p>
                <h2 className="text-3xl text-stone-100 md:text-4xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                  Start narrow. Prove the loop.
                </h2>
              </div>
              <p className="max-w-2xl text-sm leading-relaxed text-stone-400">
                The launch bar is not broad compatibility. It is one host path that gets from install to hosted approval to receipt without confusion.
              </p>
            </div>
          </FadeIn>
          <div className="grid gap-5 lg:grid-cols-3">
            {hostTracks.map((track, index) => (
              <FadeIn key={track.title} delay={0.08 * index}>
                <div className="lovable-panel h-full">
                  <div className="mb-4 flex items-center gap-3">
                    <Shield className="h-4 w-4 text-[#d2b06f]" />
                    <h3 className="text-xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                      {track.title}
                    </h3>
                  </div>
                  <p className="text-sm leading-relaxed text-stone-400">{track.body}</p>
                  <a
                    href={track.href}
                    className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-[#d2b06f] transition-colors hover:text-[#e2c994]"
                  >
                    {track.ctaLabel} <ArrowRight size={14} />
                  </a>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}

function AccountEntryPage({
  eyebrow,
  title,
  summary,
  primaryLabel,
  primaryHref,
  secondaryLabel,
  secondaryHref,
  alternateIntro,
  alternateLabel,
  alternateHref,
  steps,
  noteTitle,
  noteBody
}) {
  return (
    <SiteLayout>
      <section className="relative flex min-h-[72vh] items-end overflow-hidden">
        <div className="lovable-grid absolute inset-0 opacity-[0.03]" />
        <div className="lovable-orb lovable-orb-a" />
        <div className="lovable-orb lovable-orb-b" />
        <div className="relative mx-auto grid max-w-7xl gap-14 px-6 py-24 lg:grid-cols-[minmax(0,1fr),24rem] lg:px-8 lg:py-32">
          <div>
            <FadeIn>
              <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">{eyebrow}</p>
              <h1 className="max-w-4xl text-4xl leading-tight text-stone-100 md:text-5xl lg:text-6xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                {title}
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-relaxed text-stone-400">{summary}</p>
            </FadeIn>
            <FadeIn delay={0.15}>
              <div className="mt-10 flex flex-wrap gap-4">
                <a
                  href={primaryHref}
                  className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-6 py-3 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90"
                >
                  {primaryLabel} <ArrowRight size={16} />
                </a>
                <a
                  href={secondaryHref}
                  className="inline-flex items-center gap-2 rounded-md border border-white/15 px-6 py-3 text-sm font-medium text-stone-100 transition-all duration-200 hover:bg-white/5"
                >
                  {secondaryLabel} <ArrowUpRight size={15} />
                </a>
              </div>
              {alternateHref && alternateLabel ? (
                <p className="mt-4 text-sm text-stone-500">
                  {alternateIntro ? `${alternateIntro} ` : ""}
                  <a href={alternateHref} className="text-stone-300 transition-colors hover:text-stone-100">
                    {alternateLabel}
                  </a>
                </p>
              ) : null}
            </FadeIn>
          </div>

          <FadeIn delay={0.2} className="self-end">
            <div className="lovable-panel lovable-panel-strong">
              <div className="mb-6 flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-stone-500">Account flow</p>
                  <h2 className="mt-2 text-2xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                    What happens next.
                  </h2>
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[#d2b06f]">
                  Secure handoff
                </div>
              </div>
              <div className="space-y-3">
                {steps.map((item, index) => (
                  <div key={item.title} className="lovable-rail-row">
                    <div className="lovable-rail-index">0{index + 1}</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-stone-100">{item.title}</p>
                      <p className="mt-1 text-sm leading-relaxed text-stone-400">{item.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      <section className="border-t border-white/10">
        <div className="mx-auto grid max-w-7xl gap-16 px-6 py-24 lg:grid-cols-[1.1fr,0.9fr] lg:px-8 lg:py-32">
          <FadeIn>
            <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">Why accounts matter</p>
            <h2 className="text-3xl text-stone-100 md:text-4xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
              {noteTitle}
            </h2>
            <p className="mt-6 max-w-2xl leading-relaxed text-stone-400">{noteBody}</p>
          </FadeIn>
          <FadeIn delay={0.1}>
            <div className="lovable-panel">
              <p className="text-[11px] uppercase tracking-[0.22em] text-stone-500">What you get</p>
              <ul className="mt-4 space-y-3 text-sm leading-relaxed text-stone-300">
                <li>Workspace identity tied to every approval, receipt, and dispute.</li>
                <li>One runtime boundary for MCP hosts, framework shells, Codex, CLI, and API.</li>
                <li>Hosted approval, receipt, and dispute pages that can be revoked, audited, and reopened later.</li>
              </ul>
            </div>
          </FadeIn>
        </div>
      </section>
    </SiteLayout>
  );
}

function TrustEntryPage({
  eyebrow,
  title,
  summary,
  proofTitle,
  proofBody,
  bullets,
  rail,
  artifactTitle,
  artifactBody,
  artifactStats,
  ctaLabel = "Open onboarding",
  onboardingHref = MANAGED_ONBOARDING_HREF,
  supportHref = SITE_DOC_ROUTES.hostQuickstart,
  supportLabel = "Hosts guide"
}) {
  return (
    <SiteLayout>
      <section className="relative flex min-h-[72vh] items-end overflow-hidden">
        <div className="lovable-grid absolute inset-0 opacity-[0.03]" />
        <div className="lovable-orb lovable-orb-a" />
        <div className="lovable-orb lovable-orb-b" />
        <div className="relative mx-auto grid max-w-7xl gap-14 px-6 py-24 lg:grid-cols-[minmax(0,1fr),24rem] lg:px-8 lg:py-32">
          <div>
            <FadeIn>
              <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">{eyebrow}</p>
              <h1 className="max-w-4xl text-4xl leading-tight text-stone-100 md:text-5xl lg:text-6xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                {title}
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-relaxed text-stone-400">{summary}</p>
            </FadeIn>
            <FadeIn delay={0.15}>
              <div className="mt-10 flex flex-wrap gap-4">
                <a href={onboardingHref} className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-6 py-3 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90">
                  {ctaLabel} <ArrowRight size={16} />
                </a>
                <a href={supportHref} className="inline-flex items-center gap-2 rounded-md border border-white/15 px-6 py-3 text-sm font-medium text-stone-100 transition-all duration-200 hover:bg-white/5">
                  {supportLabel}
                </a>
              </div>
            </FadeIn>
          </div>

          <FadeIn delay={0.2} className="self-end">
            <div className="lovable-panel lovable-panel-strong">
              <div className="mb-6 flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-stone-500">How it works</p>
                  <h2 className="mt-2 text-2xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                    What this page handles.
                  </h2>
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[#d2b06f]">
                  Live product
                </div>
              </div>
              <div className="space-y-3">
                {rail.map((item, index) => (
                  <div key={item.title} className="lovable-rail-row">
                    <div className="lovable-rail-index">0{index + 1}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-stone-100">{item.title}</p>
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-stone-400">
                          {item.state}
                        </span>
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-stone-400">{item.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      <section className="border-t border-white/10">
        <div className="mx-auto grid max-w-7xl gap-16 px-6 py-24 lg:grid-cols-[1.1fr,0.9fr] lg:px-8 lg:py-32">
          <FadeIn>
            <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">Why it matters</p>
            <h2 className="text-3xl text-stone-100 md:text-4xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
              {proofTitle}
            </h2>
            <p className="mt-6 max-w-2xl leading-relaxed text-stone-400">{proofBody}</p>
          </FadeIn>
          <div className="grid gap-4">
            {bullets.map((bullet, index) => (
              <FadeIn key={bullet.title} delay={0.1 * index}>
                <div className="lovable-panel">
                  <div className="mb-3 flex items-center gap-2">
                    <Check className="h-4 w-4 text-[#d2b06f]" />
                    <h3 className="text-base text-stone-100">{bullet.title}</h3>
                  </div>
                  <p className="text-sm leading-relaxed text-stone-400">{bullet.body}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-white/10 bg-[#0b0f14]">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 py-20 lg:grid-cols-[1.1fr,0.9fr] lg:px-8">
          <FadeIn>
            <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">Surface anatomy</p>
            <h2 className="text-3xl text-stone-100 md:text-4xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
              {artifactTitle}
            </h2>
            <p className="mt-6 max-w-2xl leading-relaxed text-stone-400">{artifactBody}</p>
          </FadeIn>
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
            {artifactStats.map((stat, index) => (
              <FadeIn key={stat.label} delay={0.08 * index}>
                <div className="lovable-stat-card">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-stone-500">{stat.label}</p>
                  <p className="mt-3 text-xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                    {stat.value}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-stone-400">{stat.body}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-white/10 bg-[#0b0f14]">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
          <FadeIn>
            <div className="lovable-panel lovable-cta-band flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="mb-3 text-xs uppercase tracking-[0.2em] text-stone-500">Live product</p>
                <h2 className="text-3xl text-stone-100 md:text-4xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                  Real surface. Real controls.
                </h2>
                <p className="mt-4 max-w-2xl text-stone-400">
                  Once your workspace is issued, this route becomes the live governed-worker surface. Until then, we show the product clearly instead of dumping you into an empty shell.
                </p>
              </div>
              <a href={onboardingHref} className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-6 py-3 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90">
                Get started free <ArrowRight size={16} />
              </a>
            </div>
          </FadeIn>
        </div>
      </section>
    </SiteLayout>
  );
}

function ResourcePage({
  eyebrow,
  title,
  summary,
  primaryCta,
  secondaryCta,
  sections,
  proofPoints
}) {
  return (
    <SiteLayout>
      <section className="relative flex min-h-[68vh] items-end overflow-hidden">
        <div className="lovable-grid absolute inset-0 opacity-[0.03]" />
        <div className="lovable-orb lovable-orb-a" />
        <div className="lovable-orb lovable-orb-b" />
        <div className="relative mx-auto grid max-w-7xl gap-14 px-6 py-24 lg:grid-cols-[minmax(0,1fr),24rem] lg:px-8 lg:py-32">
          <div>
            <FadeIn>
              <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">{eyebrow}</p>
              <h1 className="max-w-4xl text-4xl leading-tight text-stone-100 md:text-5xl lg:text-6xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                {title}
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-relaxed text-stone-400">{summary}</p>
            </FadeIn>
            <FadeIn delay={0.15}>
              <div className="mt-10 flex flex-wrap gap-4">
                <a href={primaryCta.href} className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-6 py-3 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90">
                  {primaryCta.label} <ArrowRight size={16} />
                </a>
                <a href={secondaryCta.href} className="inline-flex items-center gap-2 rounded-md border border-white/15 px-6 py-3 text-sm font-medium text-stone-100 transition-all duration-200 hover:bg-white/5">
                  {secondaryCta.label} <ArrowUpRight size={15} />
                </a>
              </div>
            </FadeIn>
          </div>
          <FadeIn delay={0.2} className="self-end">
            <div className="lovable-panel lovable-panel-strong">
              <div className="mb-6 flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-stone-500">Quick orientation</p>
                  <h2 className="mt-2 text-2xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                    Start here.
                  </h2>
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[#d2b06f]">
                  Docs
                </div>
              </div>
              <div className="space-y-3">
                {proofPoints.map((item, index) => (
                  <div key={item.title} className="lovable-rail-row">
                    <div className="lovable-rail-index">0{index + 1}</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-stone-100">{item.title}</p>
                      <p className="mt-1 text-sm leading-relaxed text-stone-400">{item.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      <section className="border-t border-white/10">
        <div className="mx-auto grid max-w-7xl gap-5 px-6 py-24 lg:grid-cols-3 lg:px-8 lg:py-32">
          {sections.map((section, index) => (
            <FadeIn key={section.title} delay={0.08 * index}>
              <div className="lovable-panel h-full">
                <p className="text-[11px] uppercase tracking-[0.22em] text-stone-500">{section.eyebrow}</p>
                <h3 className="mt-3 text-2xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                  {section.title}
                </h3>
                <p className="mt-4 text-sm leading-relaxed text-stone-400">{section.body}</p>
                <a href={section.href} className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-[#d2b06f] transition-colors hover:text-[#e2c994]">
                  {section.ctaLabel} <ArrowUpRight size={14} />
                </a>
              </div>
            </FadeIn>
          ))}
        </div>
      </section>
    </SiteLayout>
  );
}

function FailStatePage({
  eyebrow,
  title,
  summary,
  proofTitle,
  proofBody,
  primaryCta,
  secondaryCta,
  reasonCode,
  steps
}) {
  return (
    <SiteLayout>
      <section className="relative flex min-h-[72vh] items-end overflow-hidden">
        <div className="lovable-grid absolute inset-0 opacity-[0.03]" />
        <div className="lovable-orb lovable-orb-a" />
        <div className="lovable-orb lovable-orb-b" />
        <div className="relative mx-auto grid max-w-7xl gap-14 px-6 py-24 lg:grid-cols-[minmax(0,1fr),24rem] lg:px-8 lg:py-32">
          <div>
            <FadeIn>
              <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">{eyebrow}</p>
              <h1 className="max-w-4xl text-4xl leading-tight text-stone-100 md:text-5xl lg:text-6xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                {title}
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-relaxed text-stone-400">{summary}</p>
            </FadeIn>
            <FadeIn delay={0.15}>
              <div className="mt-10 flex flex-wrap gap-4">
                <a href={primaryCta.href} className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-6 py-3 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90">
                  {primaryCta.label} <ArrowRight size={16} />
                </a>
                <a href={secondaryCta.href} className="inline-flex items-center gap-2 rounded-md border border-white/15 px-6 py-3 text-sm font-medium text-stone-100 transition-all duration-200 hover:bg-white/5">
                  {secondaryCta.label} <ArrowUpRight size={15} />
                </a>
              </div>
            </FadeIn>
          </div>
          <FadeIn delay={0.2} className="self-end">
            <div className="lovable-panel lovable-panel-strong">
              <div className="mb-6 flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-stone-500">Trust state</p>
                  <h2 className="mt-2 text-2xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                    {proofTitle}
                  </h2>
                </div>
                <div className="rounded-full border border-[#d2b06f]/25 bg-[#d2b06f]/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[#d2b06f]">
                  {reasonCode}
                </div>
              </div>
              <p className="text-sm leading-relaxed text-stone-400">{proofBody}</p>
            </div>
          </FadeIn>
        </div>
      </section>

      <section className="border-t border-white/10">
        <div className="mx-auto grid max-w-7xl gap-5 px-6 py-24 lg:grid-cols-3 lg:px-8 lg:py-32">
          {steps.map((step, index) => (
            <FadeIn key={step.title} delay={0.08 * index}>
              <div className="lovable-panel h-full">
                <p className="text-[11px] uppercase tracking-[0.22em] text-stone-500">{step.eyebrow}</p>
                <h3 className="mt-3 text-2xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                  {step.title}
                </h3>
                <p className="mt-4 text-sm leading-relaxed text-stone-400">{step.body}</p>
                <a href={step.href} className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-[#d2b06f] transition-colors hover:text-[#e2c994]">
                  {step.ctaLabel} <ArrowUpRight size={14} />
                </a>
              </div>
            </FadeIn>
          ))}
        </div>
      </section>
    </SiteLayout>
  );
}

export default function LovableSite({ mode = "home" }) {
  if (mode === "product") return <ProductPage />;
  if (mode === "demo") return <DemoPage />;
  if (mode === "pricing") return <PricingPage />;
  if (mode === "developers") return <DevelopersPage />;
  if (mode === "integrations") return <IntegrationsPage />;
  if (mode === "onboarding") return <OnboardingPage />;
  if (mode === "signup") {
    return (
      <AccountEntryPage
        eyebrow="Sign up"
        title="Create your workspace. Deploy your first worker."
        summary="One workspace holds all your workers, approvals, and receipts. Takes 30 seconds."
        primaryLabel="Create workspace"
        primaryHref={buildManagedAccountHref({ flow: "signup", source: "public_signup", hash: "account-create" })}
        secondaryLabel="See how it works"
        secondaryHref={PUBLIC_DEMO_HREF}
        alternateIntro="Already issued the workspace?"
        alternateLabel="Sign in instead."
        alternateHref={PUBLIC_LOGIN_HREF}
        steps={[
          { title: "Create the workspace identity", body: "Start with work email, company, and operator identity so approvals, receipts, and disputes already have a real owner." },
          { title: "Issue the runtime", body: "Bootstrap one governed-worker runtime boundary instead of scattering keys and permissions across hosts." },
          { title: "Prove one live action", body: "Seed one approval, finish one run, and end with one real receipt before broadening scope." }
        ]}
        noteTitle="A real governed worker needs a real workspace."
        noteBody="Browse the product without signing in. Create a workspace when you are ready to issue approvals, receipts, and revocable authority."
      />
    );
  }
  if (mode === "login") {
    return (
      <AccountEntryPage
        eyebrow="Sign in"
        title="Return to the same workspace, approvals, and receipts."
        summary="Sign-in continues the public site, then hands off into the secure account flow only when it is time to authenticate."
        primaryLabel="Continue to secure sign-in"
        primaryHref={buildManagedAccountHref({ flow: "login", source: "public_login", hash: "identity-access" })}
        secondaryLabel="Need help recovering access"
        secondaryHref={SITE_DOC_ROUTES.support}
        alternateIntro="Need a new workspace first?"
        alternateLabel="Create one here."
        alternateHref={PUBLIC_SIGNUP_HREF}
        steps={[
          { title: "Open secure sign-in", body: "Use the secure workspace sign-in flow instead of a dead-end public form." },
          { title: "Return to your runtime", body: "Resume the same worker, host bindings, and approval pages you used before." },
          { title: "Pick up the loop", body: "Go back to approval, receipt, dispute, or runtime bootstrap without losing the current record." }
        ]}
        noteTitle="Accounts are for real actions, not for reading the site."
        noteBody="Browse first. Sign in when you need the same workspace, approvals, and receipts."
      />
    );
  }
  if (mode === "docs") {
    return (
      <ResourcePage
        eyebrow="Docs"
        title="Docs for your first live action."
        summary="Set up a host, open approval, inspect the receipt, and go deeper only when you need API or ops detail."
        primaryCta={{ label: "Open quickstart", href: SITE_DOC_ROUTES.quickstart }}
        secondaryCta={{ label: "See the walkthrough", href: PUBLIC_DEMO_HREF }}
        proofPoints={[
          { title: "Start with a real task", body: "Begin with quickstart, the hosts guide, or the API docs depending on what you need to prove first." },
          { title: "Read by job", body: "Quickstart, integrations, API, security, and ops each answer a different question." },
          { title: "Move toward the live action", body: "Each page gets you closer to a real approval, receipt, and recovery flow." }
        ]}
        sections={[
          { eyebrow: "Start", title: "Quickstart", body: "Get from zero to your first real action with the smallest possible loop.", href: "/docs/quickstart", ctaLabel: "Open quickstart" },
          { eyebrow: "Connect", title: "Integrations", body: "See the supported hosts and how they land on the same approval, receipt, and dispute loop.", href: "/docs/integrations", ctaLabel: "View integrations" },
          { eyebrow: "Reference", title: "API", body: "Read the launch-scoped lifecycle and object model when you need the real contract.", href: "/docs/api", ctaLabel: "Open API docs" }
        ]}
      />
    );
  }
  if (mode === "docs_quickstart") {
    return (
      <ResourcePage
        eyebrow="Docs / Quickstart"
        title="Quickstart"
        summary="Go from zero to approval, receipt, and recovery with the smallest possible loop. If you want the shape first, open the walkthrough."
        primaryCta={{ label: "Get started free", href: buildManagedOnboardingHref("docs_quickstart") }}
        secondaryCta={{ label: "See the walkthrough", href: PUBLIC_DEMO_HREF }}
        proofPoints={[
          { title: "One runtime", body: "Bootstrap the workspace once, then reuse the same worker flow across hosts." },
          { title: "One live loop", body: "Install, approval, receipt, dispute. Nothing else matters until that path is stable." },
          { title: "One record", body: "Leave with a real approval URL and a real receipt, not a shell-only success message." }
        ]}
        sections={[
          { eyebrow: "Hosted", title: "Managed onboarding", body: "Use the public onboarding rail if you want the website to issue the runtime for you.", href: buildManagedOnboardingHref("docs_quickstart"), ctaLabel: "Start onboarding" },
          { eyebrow: "CLI", title: "Codex / CLI quickstart", body: "Use the script once you are ready to run the live loop.", href: docsLinks.codexEngineeringQuickstart, ctaLabel: "Open engineering guide" },
          { eyebrow: "Hosts", title: "Hosts guide", body: "Pick the supported host path you want to prove first.", href: SITE_DOC_ROUTES.hostQuickstart, ctaLabel: "Open hosts guide" }
        ]}
      />
    );
  }
  if (mode === "docs_architecture") {
    return (
      <ResourcePage
        eyebrow="Docs / Architecture"
        title="How Nooterra works."
        summary="See what Nooterra governs, what stays in the host, and how approvals, receipts, and recovery stay bound to the same action."
        primaryCta={{ label: "API surface", href: SITE_DOC_ROUTES.api }}
        secondaryCta={{ label: "Launch guide", href: SITE_DOC_ROUTES.launchChecklist }}
        proofPoints={[
          { title: "Policy, not prompts", body: "The system makes decisions through explicit rules and bounded grants, not hidden prompt state." },
          { title: "Evidence, not vibes", body: "Receipts, verifier results, and disputes stay attached to the same record." },
          { title: "Recourse, not dead history", body: "The system is only trustworthy if the same run can later be challenged and unwound." }
        ]}
        sections={[
          { eyebrow: "Architecture", title: "System overview", body: "Read the full system description and artifact lineage.", href: docsLinks.architecture, ctaLabel: "View docs" },
          { eyebrow: "Reference", title: "API surface", body: "See the launch-scoped lifecycle as a real contract, not a loose set of endpoints.", href: "/docs/api", ctaLabel: "API docs" },
          { eyebrow: "Ops", title: "Launch guide", body: "Translate the architecture into concrete launch gates and operator controls.", href: SITE_DOC_ROUTES.launchChecklist, ctaLabel: "Open launch guide" }
        ]}
      />
    );
  }
  if (mode === "docs_integrations") {
    return (
      <ResourcePage
        eyebrow="Docs / Integrations"
        title="Host integrations"
        summary="MCP hosts, framework runtimes, Codex, CLI, and direct API can all reuse the same approval, receipt, and dispute surfaces."
        primaryCta={{ label: "Launch hosts", href: SITE_DOC_ROUTES.hostQuickstart }}
        secondaryCta={{ label: "Get started free", href: buildManagedOnboardingHref("docs_integrations") }}
        proofPoints={[
          { title: "Host-native in front", body: "The agent experience stays inside the host until trust, proof, or recourse is needed." },
          { title: "Hosted product pages", body: "Approval, budget, receipt, and dispute stay aligned even when the initiating host changes." },
          { title: "Parity over breadth", body: "One repeatable first-run path per channel matters more than a long unsupported matrix." }
        ]}
        sections={[
          { eyebrow: "MCP", title: "MCP hosts", body: "Use the same governed-worker loop inside host-native tools.", href: docsLinks.claudeDesktopQuickstart, ctaLabel: "MCP quickstart" },
          { eyebrow: "Framework", title: "Framework runtimes", body: "Reuse the same governed-worker loop inside a more agentic shell.", href: docsLinks.openClawQuickstart, ctaLabel: "Framework guide" },
          { eyebrow: "Engineering", title: "Codex / CLI / API", body: "For builders who want the shortest path from install to the first real action.", href: docsLinks.codexEngineeringQuickstart, ctaLabel: "Engineering guide" }
        ]}
      />
    );
  }
  if (mode === "docs_api") {
    return (
      <ResourcePage
        eyebrow="Docs / API"
        title="One lifecycle. Clear contracts."
        summary="The API is explicit: intent, approval, grant, evidence, receipt, and dispute."
        primaryCta={{ label: "Run quickstart", href: docsLinks.codexEngineeringQuickstart }}
        secondaryCta={{ label: "Launch guide", href: SITE_DOC_ROUTES.launchChecklist }}
        proofPoints={[
          { title: "Deterministic writes", body: "The contract fails closed on missing evidence, mismatched scope, or malformed API responses." },
          { title: "Canonical links", body: "Hosted approval, receipt, and dispute surfaces resolve consistently from every channel." },
          { title: "Idempotent state", body: "Repeated retries stay safe and auditable instead of ambiguous." }
        ]}
        sections={[
          { eyebrow: "Lifecycle", title: "Governed worker lifecycle", body: "Read the lifecycle and object model for governed runs, approvals, receipts, and disputes.", href: docsLinks.api, ctaLabel: "View lifecycle" },
          { eyebrow: "Quickstart", title: "First real action", body: "Use the quickstart script to exercise the same API flow end to end.", href: docsLinks.codexEngineeringQuickstart, ctaLabel: "Run quickstart" },
          { eyebrow: "Ops", title: "Launch guide", body: "See what the API must prove before you trust it in production.", href: SITE_DOC_ROUTES.launchChecklist, ctaLabel: "Open launch guide" }
        ]}
      />
    );
  }
  if (mode === "docs_security") {
    return (
      <ResourcePage
        eyebrow="Docs / Security"
        title="Security model"
        summary="Understand fail-closed behavior, scoped authority, and operator controls in plain language."
        primaryCta={{ label: "Security overview", href: "/security" }}
        secondaryCta={{ label: "Launch guide", href: SITE_DOC_ROUTES.launchChecklist }}
        proofPoints={[
          { title: "Fail closed by default", body: "Missing artifacts, route drift, or mismatched bindings stop the action instead of silently succeeding." },
          { title: "Scoped authority", body: "Hosts get bounded grants, not vague permission to act however they like." },
          { title: "Operator backstops", body: "Kill switches, quarantine, and dispute resolution are part of the product, not an afterthought." }
        ]}
        sections={[
          { eyebrow: "Model", title: "Security model", body: "Read the full trust boundaries and runtime constraints.", href: docsLinks.security, ctaLabel: "Open model" },
          { eyebrow: "Ops", title: "Operations", body: "See how production controls and incident response connect to the security posture.", href: docsLinks.ops, ctaLabel: "Ops docs" },
          { eyebrow: "Policy", title: "Launch guide", body: "Use the launch guide as the concrete security bar for go-live.", href: SITE_DOC_ROUTES.launchChecklist, ctaLabel: "Open launch guide" }
        ]}
      />
    );
  }
  if (mode === "docs_ops") {
    return (
      <ResourcePage
        eyebrow="Docs / Operations"
        title="Operations"
        summary="Runbooks for launch, incidents, cutover, and day-to-day operator work."
        primaryCta={{ label: "Launch guide", href: SITE_DOC_ROUTES.launchChecklist }}
        secondaryCta={{ label: "Open status", href: "/status" }}
        proofPoints={[
          { title: "Readiness before launch", body: "Synthetic smokes and onboarding gates catch route drift before a user does." },
          { title: "Rescue before scale", body: "Operators need quarantine, revoke, refund, and dispute resolution before the product broadens." },
          { title: "Cutover with evidence", body: "Production claims are backed by machine-readable reports, not gut feel." }
        ]}
        sections={[
          { eyebrow: "Runbooks", title: "Operations", body: "Daily runbook, health loops, and launch readiness details.", href: docsLinks.ops, ctaLabel: "Open ops" },
          { eyebrow: "Launch", title: "Launch guide", body: "What must be true before the first release is live.", href: SITE_DOC_ROUTES.launchChecklist, ctaLabel: "Open launch guide" },
          { eyebrow: "Incidents", title: "Incident response", body: "What happens when a run, host, or money lane goes sideways.", href: SITE_DOC_ROUTES.incidents, ctaLabel: "Open incident response" }
        ]}
      />
    );
  }
  if (mode === "docs_launch_hosts") {
    return (
      <ResourcePage
        eyebrow="Docs / Hosts"
        title="Hosts"
        summary="MCP hosts, framework runtimes, and engineering-shell paths should all prove the same governed-worker loop."
        primaryCta={{ label: "Open MCP quickstart", href: docsLinks.claudeDesktopQuickstart }}
        secondaryCta={{ label: "View integrations", href: "/integrations" }}
        proofPoints={[
          { title: "Host parity", body: "The cleanest host handoff still matters most for proving the product." },
          { title: "Framework parity", body: "Framework runtimes and engineering shells should reuse the same approval URL, receipt link, and dispute route." },
          { title: "One runtime everywhere", body: "Hosts change. The authority contract and proof trail do not." }
        ]}
        sections={[
          { eyebrow: "MCP", title: "MCP hosts", body: "A direct host path for the simplest install-to-approval loop.", href: docsLinks.claudeDesktopQuickstart, ctaLabel: "Open MCP quickstart" },
          { eyebrow: "Framework", title: "Framework runtimes", body: "A framework path for proving host-native parity.", href: docsLinks.openClawQuickstart, ctaLabel: "Open framework guide" },
          { eyebrow: "Engineering", title: "Codex / CLI / API", body: "Use the same managed governed-worker flow from scripts and shells.", href: docsLinks.codexEngineeringQuickstart, ctaLabel: "Open engineering guide" }
        ]}
      />
    );
  }
  if (mode === "docs_partner_kit") {
    return (
      <ResourcePage
        eyebrow="Docs / Design partners"
        title="Design partner guide"
        summary="Everything a launch partner needs to run one real action, understand the evidence, and know where to escalate issues."
        primaryCta={{ label: "Get started free", href: buildManagedOnboardingHref("docs_partner_kit") }}
        secondaryCta={{ label: "Hosts guide", href: SITE_DOC_ROUTES.hostQuickstart }}
        proofPoints={[
          { title: "Fast first value", body: "Partners reach one hosted approval and one receipt quickly." },
          { title: "Sharp expectations", body: "What is supported, what is not, and where to escalate must be visible before the first run." },
          { title: "Shared language", body: "Hosts, receipts, disputes, and operator rescue are explained the same way everywhere." }
        ]}
        sections={[
          { eyebrow: "Activation", title: "Onboarding", body: "Issue the runtime and point partners at one supported host.", href: buildManagedOnboardingHref("docs_partner_kit"), ctaLabel: "Get started free" },
          { eyebrow: "Hosts", title: "Hosts guide", body: "Choose the exact host path the partner will prove first.", href: SITE_DOC_ROUTES.hostQuickstart, ctaLabel: "Open hosts guide" },
          { eyebrow: "Runbook", title: "Support and escalation", body: "Use the same support and operator path when something breaks.", href: SITE_DOC_ROUTES.support, ctaLabel: "Open support path" }
        ]}
      />
    );
  }
  if (mode === "docs_claude_desktop") {
    return (
      <ResourcePage
        eyebrow="Docs / Claude MCP"
        title="Claude MCP quickstart"
        summary="Install the MCP server, seed one worker-account request, and prove the approval-to-receipt loop before expanding anywhere else."
        primaryCta={{ label: "Get started free", href: buildManagedOnboardingHref("docs_claude_desktop") }}
        secondaryCta={{ label: "Hosts guide", href: SITE_DOC_ROUTES.hostQuickstart }}
        proofPoints={[
          { title: "Host-native first", body: "Claude stays in front until trust, proof, or recourse needs a hosted Nooterra surface." },
          { title: "One approval path", body: "The first success bar is a hosted approval URL that resolves cleanly back into the same budget, receipt, and dispute chain." },
          { title: "Real result", body: "End with a real receipt, not just a completed local command." }
        ]}
        sections={[
          { eyebrow: "Setup", title: "Create the workspace", body: "Issue the managed account first so the approval and receipt surfaces already exist when Claude asks to act.", href: buildManagedOnboardingHref("docs_claude_desktop"), ctaLabel: "Start onboarding" },
          { eyebrow: "Hosts", title: "Hosts guide", body: "See where Claude sits in the supported host matrix and how it shares the same runtime contract as every other channel.", href: SITE_DOC_ROUTES.hostQuickstart, ctaLabel: "Open hosts guide" },
          { eyebrow: "Reference", title: "API lifecycle", body: "The Claude flow still resolves into the same ActionIntent, ApprovalRequest, ExecutionGrant, receipt, and dispute chain.", href: SITE_DOC_ROUTES.api, ctaLabel: "Open API docs" }
        ]}
      />
    );
  }
  if (mode === "docs_openclaw") {
    return (
      <ResourcePage
        eyebrow="Docs / OpenClaw"
        title="OpenClaw quickstart"
        summary="Use the OpenClaw path when you want a more agentic shell, but keep approvals, receipts, and disputes on the same hosted flow."
        primaryCta={{ label: "Get started free", href: buildManagedOnboardingHref("docs_openclaw") }}
        secondaryCta={{ label: "Hosts guide", href: SITE_DOC_ROUTES.hostQuickstart }}
        proofPoints={[
          { title: "Same runtime underneath", body: "The host gets freedom in the shell, not freedom from the worker-account rules and artifacts." },
          { title: "Hosted product pages stay aligned", body: "Approvals, receipts, and disputes still belong to Nooterra even when the initiating shell is more autonomous." },
          { title: "Keep the flow consistent", body: "OpenClaw is useful only if the same approval, receipt, and recovery flow survives a more agentic environment." }
        ]}
        sections={[
          { eyebrow: "Setup", title: "Managed onboarding", body: "Start with the same workspace and runtime identity used by Claude, Codex, CLI, and direct API flows.", href: buildManagedOnboardingHref("docs_openclaw"), ctaLabel: "Start onboarding" },
          { eyebrow: "Hosts", title: "Hosts guide", body: "Compare OpenClaw against the other supported channels and keep the first rollout narrow.", href: SITE_DOC_ROUTES.hostQuickstart, ctaLabel: "Open hosts guide" },
          { eyebrow: "Reference", title: "Developers", body: "Use the developer page when you need the runtime, SDK, and host-pack details behind the OpenClaw flow.", href: "/developers", ctaLabel: "View developers" }
        ]}
      />
    );
  }
  if (mode === "docs_codex") {
    return (
      <ResourcePage
        eyebrow="Docs / Codex / CLI / API"
        title="CLI and API quickstart"
        summary="Use the direct scriptable flow to prove the same managed worker-account loop from Codex, CLI, or raw API calls."
        primaryCta={{ label: "Get started free", href: buildManagedOnboardingHref("docs_codex") }}
        secondaryCta={{ label: "Open quickstart", href: SITE_DOC_ROUTES.quickstart }}
        proofPoints={[
          { title: "Scriptable end to end", body: "Bootstrap, seed approval, and verify the hosted links without needing the UI to fake success for you." },
          { title: "Fail closed on route drift", body: "Stop immediately if the public API returns HTML, stale links, or incomplete artifacts." },
          { title: "Same receipts, same disputes", body: "CLI and API users should land on the same receipt and recourse surfaces as every other host." }
        ]}
        sections={[
          { eyebrow: "Quickstart", title: "First live action", body: "Run the direct engineering path and make sure it returns approval, run, and receipt links that all resolve on the public site.", href: SITE_DOC_ROUTES.quickstart, ctaLabel: "Open quickstart" },
          { eyebrow: "Hosts", title: "Hosts guide", body: "Codex, CLI, and API are supported channels even when they are not the most polished public surface.", href: SITE_DOC_ROUTES.hostQuickstart, ctaLabel: "Open hosts guide" },
          { eyebrow: "Environment", title: "Local environment", body: "When you need the repo and runtime details, use the local environment guide.", href: SITE_DOC_ROUTES.localEnvironment, ctaLabel: "Open local guide" }
        ]}
      />
    );
  }
  if (mode === "docs_local_environment") {
    return (
      <ResourcePage
        eyebrow="Docs / Local environment"
        title="Local setup"
        summary="Run Nooterra locally, then prove the first approval and receipt."
        primaryCta={{ label: "Open developers", href: "/developers" }}
        secondaryCta={{ label: "Open quickstart", href: SITE_DOC_ROUTES.quickstart }}
        proofPoints={[
          { title: "Local setup should feel familiar", body: "Use the same approval, receipt, and dispute loop you expect in production." },
          { title: "One repo, one runtime", body: "Use the documented setup path instead of chasing setup details across the repo." },
          { title: "One docs flow", body: "Engineering-heavy pages should still feel like part of one product." }
        ]}
        sections={[
          { eyebrow: "Build", title: "Developers", body: "Start here if you want the public overview of channels, SDKs, and support surfaces.", href: "/developers", ctaLabel: "Open developers" },
          { eyebrow: "Run", title: "Quickstart", body: "Once the repo is ready, go straight to the first live action.", href: SITE_DOC_ROUTES.quickstart, ctaLabel: "Open quickstart" },
          { eyebrow: "Ops", title: "Operations", body: "Use the ops docs when production behavior and recovery rules matter.", href: SITE_DOC_ROUTES.ops, ctaLabel: "Open ops docs" }
        ]}
      />
    );
  }
  if (mode === "docs_launch_checklist") {
    return (
      <ResourcePage
        eyebrow="Docs / Launch"
        title="Launch checklist"
        summary="What must be true before the first release is live."
        primaryCta={{ label: "Open status", href: "/status" }}
        secondaryCta={{ label: "See the walkthrough", href: PUBLIC_DEMO_HREF }}
        proofPoints={[
          { title: "Route health first", body: "Public routes and same-origin auth paths are green before any launch claim." },
          { title: "Proof loop second", body: "Install, approval, receipt, and dispute work on live hosts before broad rollout." },
          { title: "Operator controls third", body: "Kill switches, quarantine, and recourse must exist before scale." }
        ]}
        sections={[
          { eyebrow: "Website", title: "Public route smoke", body: "The live website should prove each public route is branded and wired correctly.", href: "/status", ctaLabel: "Open status" },
          { eyebrow: "Runtime", title: "First real action", body: "The launch bar is the first live approval-to-receipt loop.", href: buildManagedOnboardingHref("docs_launch_checklist"), ctaLabel: "Get started free" },
          { eyebrow: "Docs", title: "Operations", body: "Open the operator docs if you need the full detail.", href: docsLinks.ops, ctaLabel: "Open ops docs" }
        ]}
      />
    );
  }
  if (mode === "docs_incidents") {
    return (
      <ResourcePage
        eyebrow="Docs / Incident response"
        title="Incident response"
        summary="What to do when approvals, receipts, or payment flows go wrong."
        primaryCta={{ label: "Open support", href: "/support" }}
        secondaryCta={{ label: "Open status", href: "/status" }}
        proofPoints={[
          { title: "One escalation path", body: "Know where to go when approvals, receipts, or disputes drift." },
          { title: "Keep the record intact", body: "Incident handling preserves grants, receipts, verifier results, and disputes." },
          { title: "Recovery is part of the product", body: "Rescue, revoke, refund, quarantine, and kill switches stay available when things go wrong." }
        ]}
        sections={[
          { eyebrow: "Rescue", title: "Status and controls", body: "The status page is the first place incidents become actionable.", href: "/status", ctaLabel: "Open status" },
          { eyebrow: "Recourse", title: "Disputes", body: "Challenge and unwind the bad action without losing the record.", href: "/disputes", ctaLabel: "Open disputes" },
          { eyebrow: "Support", title: "Support", body: "Use Support for the visible escalation path.", href: "/support", ctaLabel: "Open support" }
        ]}
      />
    );
  }
  if (mode === "status") {
    return <StatusPage />;
  }
  if (mode === "security") {
    return <SecurityPage />;
  }
  if (mode === "privacy") {
    return <PrivacyPage />;
  }
  if (mode === "terms") {
    return (
      <ResourcePage
        eyebrow="Terms"
        title="See the product boundary before you sign in."
        summary="These terms cover governed AI workers, connected capabilities, approval surfaces, and the audit and recovery boundaries around consequential AI actions."
        primaryCta={{ label: "Open docs hub", href: "/docs" }}
        secondaryCta={{ label: "Developers", href: "/developers" }}
        proofPoints={[
          { title: "Authority is bounded", body: "Workers only act within explicit limits, connected capability boundaries, and current approval state." },
          { title: "More than the marketing site", body: "Host-native interaction, hosted approval pages, and the underlying governed-worker flow all matter." },
          { title: "Recourse is part of the promise", body: "Users should understand that approvals, receipts, and disputes are core, not optional." }
        ]}
        sections={[
          { eyebrow: "Scope", title: "Developers", body: "See the actual launch channels and runtime entry points.", href: "/developers", ctaLabel: "View developers" },
          { eyebrow: "Surfaces", title: "Live product pages", body: "Approvals, receipts, disputes, and wallet are the public-facing product surfaces.", href: "/wallet", ctaLabel: "View product pages" },
          { eyebrow: "Reference", title: "Docs", body: "Full reference, launch guidance, and architecture beyond the marketing layer.", href: "/docs", ctaLabel: "Open docs" }
        ]}
      />
    );
  }
  if (mode === "support") {
    return <SupportPage />;
  }
  if (mode === "expired") {
    return (
      <FailStatePage
        eyebrow="Approval expired"
        title="The approval window closed before the action could continue."
        summary="This link no longer carries live authority. The safe next move is to reopen the request from the host or issue a fresh approval from onboarding."
        proofTitle="Expired means no stale permission survives."
        proofBody="Approval links should fail closed when the time window is over. The host must ask again so the user can re-confirm consequence, amount, and current context."
        reasonCode="EXPIRED_LINK"
        primaryCta={{ label: "Issue a fresh approval", href: MANAGED_ONBOARDING_HREF }}
        secondaryCta={{ label: "Hosts guide", href: SITE_DOC_ROUTES.hostQuickstart }}
        steps={[
          { eyebrow: "Reopen", title: "Request again", body: "Seed a new hosted approval from onboarding or the initiating runtime instead of retrying the expired link.", href: MANAGED_ONBOARDING_HREF, ctaLabel: "Open onboarding" },
          { eyebrow: "Resume", title: "Return to the runtime", body: "The initiating runtime creates a fresh approval request when the user resumes the task.", href: "/integrations", ctaLabel: "View integrations" },
          { eyebrow: "Understand", title: "Read the trust model", body: "Why expired links exist and how the approval window is enforced.", href: "/docs/security", ctaLabel: "Security docs" }
        ]}
      />
    );
  }
  if (mode === "revoked") {
    return (
      <FailStatePage
        eyebrow="Grant revoked"
        title="This authority was revoked before execution could continue."
        summary="The grant that allowed this action is no longer valid. The host should stop acting and the user should decide whether to request a new bounded approval."
        proofTitle="Revoked means the system no longer trusts the grant."
        proofBody="A revoked grant should immediately remove the host’s right to continue. That keeps the system deterministic when a user changes their mind or an operator intervenes."
        reasonCode="GRANT_REVOKED"
        primaryCta={{ label: "Return to controls", href: "/wallet" }}
        secondaryCta={{ label: "Open dispute guidance", href: "/disputes" }}
        steps={[
          { eyebrow: "Inspect", title: "Check authority state", body: "Open the controls view and confirm which host, rule, or one-time grant was revoked.", href: "/wallet", ctaLabel: "Open controls" },
          { eyebrow: "Recover", title: "Create a new bounded grant", body: "If the action is still needed, reopen the approval flow rather than trying to reuse the revoked authority.", href: "/approvals", ctaLabel: "Open approvals" },
          { eyebrow: "Escalate", title: "Use recourse when needed", body: "If a revoked grant still led to a bad outcome, move directly into receipt and dispute handling.", href: "/disputes", ctaLabel: "Open disputes" }
        ]}
      />
    );
  }
  if (mode === "verification_failed") {
    return (
      <FailStatePage
        eyebrow="Verification failed"
        title="The action completed, but the proof did not verify."
        summary="Nooterra stopped short of trusting the result. The next step is to inspect the receipt or dispute path, not to silently accept the outcome."
        proofTitle="Proof has to match the action before money or trust can settle."
        proofBody="Verification failure means evidence, settlement state, or runtime bindings did not line up. The system should show the failure clearly and route the user into receipt and recourse."
        reasonCode="VERIFICATION_FAILED"
        primaryCta={{ label: "Open receipts", href: "/receipts" }}
        secondaryCta={{ label: "Challenge the result", href: "/disputes" }}
        steps={[
          { eyebrow: "Inspect", title: "Read the receipt", body: "Look at the final amount, verifier result, and proof chain before deciding what to do next.", href: "/receipts", ctaLabel: "Open receipts" },
          { eyebrow: "Challenge", title: "Move into recourse", body: "If the evidence is wrong or missing, open the dispute path from the receipt-linked flow.", href: "/disputes", ctaLabel: "Open disputes" },
          { eyebrow: "Runbook", title: "Understand the operator path", body: "See how verification failures are supposed to be handled at launch.", href: "/docs/ops", ctaLabel: "Ops docs" }
        ]}
      />
    );
  }
  if (mode === "unsupported_host") {
    return (
      <FailStatePage
        eyebrow="Unsupported host"
        title="This host is outside the launch support envelope."
        summary="Nooterra launches with a narrow host matrix. If this action came from a different shell, use a supported channel or the direct API/CLI path."
        proofTitle="Launch support is intentionally narrow."
        proofBody="The runtime needs to be stable before it gets broad. Unsupported-host messaging makes the current boundary explicit and gives the user a supported path forward."
        reasonCode="UNSUPPORTED_HOST"
        primaryCta={{ label: "Choose a supported host", href: "/integrations" }}
        secondaryCta={{ label: "Engineering quickstart", href: docsLinks.codexEngineeringQuickstart }}
        steps={[
          { eyebrow: "Supported now", title: "Use a connected runtime", body: "Start from the runtime you already use and keep the governed-worker loop intact.", href: "/integrations", ctaLabel: "View host matrix" },
          { eyebrow: "Builders", title: "Fallback to API or CLI", body: "Codex, CLI, and direct HTTP all use the same worker flow even if the shell is not a dedicated host integration.", href: "/developers", ctaLabel: "Developer routes" },
          { eyebrow: "Scope", title: "Read the integration boundary", body: "Understand which channels are polished now and which are still rough edges.", href: "/docs/integrations", ctaLabel: "Integration docs" }
        ]}
      />
    );
  }
  if (mode === "wallet") {
    return (
      <TrustEntryPage
        eyebrow="Authority"
        title="One governed worker layer for consequential AI action."
        summary="Start with a one-time approval, save a preference when it helps, or set durable rules later. The governed worker layer sits between agent intent and real-world consequence."
        proofTitle="The authority boundary for machine action."
        proofBody="This page is where people decide what an agent may do, how far that authority goes, when a human must approve, and how they can intervene later if the result is wrong."
        rail={[
          { title: "Issue authority", state: "scoped", body: "Approve one action, remember a preference, or create a reusable rule with clear limits." },
          { title: "Attach it to the right runtime", state: "revocable", body: "TUI, web, API, and connected hosts all run through the same governed-worker contract instead of separate control systems." },
          { title: "Carry limits forward", state: "enforced", body: "Budgets, approvals, dispute windows, and revocation rights stay attached to the action." }
        ]}
        bullets={[
          { title: "One-time approval first", body: "People should get value before they are asked to design a policy system." },
          { title: "Remember what matters", body: "Repeated approvals can become saved preferences after the user sees the product work." },
          { title: "Shared control later", body: "Teams can layer in thresholds, hosts, budgets, and delegated scope on top of the same runtime." }
        ]}
        artifactTitle="This page should read like an authority ledger."
        artifactBody="The live budget and authority page is where users see active hosts, pending grants, revocations, and the exact limits attached to future actions. It should read more like a control ledger than a settings page."
        artifactStats={[
          { label: "Authority", value: "One-time, remembered, durable", body: "Users can start simple and grow into stronger controls without changing the underlying model." },
          { label: "Hosts", value: "MCP, frameworks, Codex", body: "Every runtime uses the same grant and receipt model, so trust does not fork by host." },
          { label: "Controls", value: "Limits, revokes, windows", body: "Real constraints stay attached to actions instead of hiding in prompts or tribal knowledge." }
        ]}
        ctaLabel="Set up worker"
        onboardingHref={buildManagedOnboardingHref("wallet")}
      />
    );
  }
  if (mode === "approvals") {
    return (
      <TrustEntryPage
        eyebrow="Approvals"
        title="Know exactly what you are approving."
        summary="An agent asks to do something real. Nooterra shows the consequence, the limit, and why review is required before any authority is granted."
        proofTitle="Approval should answer the important questions fast."
        proofBody="Before someone clicks approve, they should understand what will happen, what it may cost, what proof is expected afterward, and whether this is a one-time decision or something worth remembering."
        rail={[
          { title: "See the consequence", state: "clear", body: "The page should show the exact action, vendor or domain, amount, and host before anything is approved." },
          { title: "Grant only this scope", state: "durable", body: "Approve once, deny it, or save a bounded rule. The result is a grant with real limits, not a vague yes." },
          { title: "Resume only if state still matches", state: "gated", body: "The host resumes only when approval, expiry, and evidence requirements still line up." }
        ]}
        bullets={[
          { title: "Plain language first", body: "People do not need operator jargon to understand what the agent wants permission to do." },
          { title: "One-time before durable", body: "Approve one thing first, then save the pattern later if it becomes useful." },
          { title: "Fail closed", body: "Missing context, missing evidence, or mismatched scope means the action does not proceed." }
        ]}
        artifactTitle="Approval is the handoff between autonomy and authority."
        artifactBody="This page behaves like a serious sign-off surface. It explains the action, the cost or consequence, whether the decision is one-time or repeatable, and what can be challenged later if the outcome looks wrong."
        artifactStats={[
          { label: "Decisioning", value: "Approve, ask, block", body: "The user sees whether the action can proceed now, needs review, or is stopped outright." },
          { label: "Binding", value: "Scope + expiry + proof", body: "Approval creates a scoped grant with a real time window and explicit evidence expectations." },
          { label: "Posture", value: "Fail closed", body: "If state drifts or proof is missing, the action stops instead of silently succeeding." }
        ]}
        ctaLabel="Open approval flow"
        onboardingHref={buildManagedOnboardingHref("approvals")}
      />
    );
  }
  if (mode === "receipts") {
    return (
      <TrustEntryPage
        eyebrow="Receipts"
        title="Every action should end in a readable record."
        summary="Receipts show what the agent asked to do, what was approved, what actually happened, and what proof came back."
        proofTitle="A receipt is where trust becomes durable."
        proofBody="If an agent buys, cancels, refunds, or changes something real, users need one place to confirm the outcome, the proof returned, and whether recourse is still available."
        rail={[
          { title: "Show what happened", state: "complete", body: "Intent, approval, grant, execution, and amount all resolve to the same record." },
          { title: "Show why it is trusted", state: "deterministic", body: "The verifier result and evidence trail stay visible without opening raw payloads." },
          { title: "Keep recourse close", state: "actionable", body: "If something looks wrong, the dispute path stays one click away." }
        ]}
        bullets={[
          { title: "Bound to the action", body: "Approval, grant, evidence, amount, and final state remain attached to the same run." },
          { title: "Readable by humans", body: "Users should understand the outcome in seconds, not by reverse engineering logs." },
          { title: "Actionable after the fact", body: "Receipts are where disputes, refunds, and reversal begin." }
        ]}
        artifactTitle="Receipts are where AI actions become understandable."
        artifactBody="The live receipt vault should make it obvious what happened, why the runtime trusted it, what proof came back, and whether the recourse window is still open. That is the product surface people come back to later."
        artifactStats={[
          { label: "Proof trail", value: "Intent -> grant -> evidence", body: "Each completed action can be reconstructed without chasing logs across systems." },
          { label: "Human legibility", value: "Outcome, proof, amount", body: "The receipt should answer the questions people actually have after an action completes." },
          { label: "Recourse", value: "Refunds, disputes, reversals", body: "Receipts are live records with follow-on rights, not inert history." }
        ]}
        ctaLabel="Issue first receipt"
        onboardingHref={buildManagedOnboardingHref("receipts")}
      />
    );
  }
  if (mode === "disputes") {
    return (
      <TrustEntryPage
        eyebrow="Disputes"
        title="If something goes wrong, there has to be a path back."
        summary="Disputes turn a receipt into a live challenge path with timing, evidence, and operator follow-through."
        proofTitle="Trust requires recourse, not just proof."
        proofBody="People will not trust agents with consequential actions unless they know how to challenge a bad result, when that window closes, and what happens after they open it."
        rail={[
          { title: "Start from the receipt", state: "bound", body: "Every dispute begins from the exact record that shows the action happened." },
          { title: "State the issue clearly", state: "recoverable", body: "Users should know what to submit, what evidence helps, and what kind of review to expect." },
          { title: "Resolve without losing the trail", state: "audited", body: "Refunds, reversals, and operator interventions stay attached to the same record." }
        ]}
        bullets={[
          { title: "Clear timing", body: "The page should say whether the dispute window is open, closed, or already in progress." },
          { title: "Operator-backed", body: "Refund, resolve, revoke, and quarantine all sit behind the same rescue path." },
          { title: "Designed for consequence", body: "The product assumes some actions will go wrong and treats recourse as first-class infrastructure." }
        ]}
        artifactTitle="A dispute should preserve the evidence chain, not break it."
        artifactBody="Users need a visible route from receipt to challenge to resolution, including timing expectations and likely next steps. Operators need enough state to unwind a bad action without losing the underlying artifacts or host context."
        artifactStats={[
          { label: "Entry point", value: "Receipt-linked", body: "The challenge begins from the same record that authorized and finalized the action." },
          { label: "Operator tools", value: "Refund, revoke, quarantine", body: "Real recourse requires real interventions, not just a support form." },
          { label: "Outcome", value: "Resolved with lineage", body: "The resolution becomes part of the permanent history of that run." }
        ]}
        ctaLabel="Set up recourse"
        onboardingHref={buildManagedOnboardingHref("disputes")}
      />
    );
  }
  return <HomePage />;
}
