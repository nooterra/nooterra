import { useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  FileCheck,
  Menu,
  RotateCcw,
  Shield,
  X,
  Zap,
  Eye,
  Cpu,
  Activity,
  BookOpen,
  MessageSquare
} from "lucide-react";
import { ossLinks } from "../site/config/links.js";

const DOCS_EXTERNAL = "https://docs.nooterra.com";
const DISCORD_HREF = "https://discord.gg/nooterra";
const MANAGED_ONBOARDING_HREF = buildManagedAccountHref({ flow: "signup", source: "site", hash: "account-create" });
const MANAGED_LOGIN_HREF = buildManagedAccountHref({ flow: "login", source: "site", hash: "identity-access" });

function buildManagedAccountHref({ flow = "signup", source = "", hash = "account-create" } = {}) {
  const params = new URLSearchParams();
  params.set("experience", "app");
  const normalizedSource = String(source ?? "").trim();
  if (normalizedSource) params.set("source", normalizedSource);
  const normalizedHash = String(hash ?? "").trim().replace(/^#?/, "");
  return `/${String(flow ?? "signup").trim() || "signup"}?${params.toString()}${normalizedHash ? `#${normalizedHash}` : ""}`;
}

function buildManagedOnboardingHref(source) {
  return buildManagedAccountHref({ flow: "signup", source, hash: "account-create" });
}

/* ─── Shared layout ─── */

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
    { label: "Docs", href: DOCS_EXTERNAL },
    { label: "Security", href: "/security" }
  ];

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
              {...(link.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
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
            href={MANAGED_ONBOARDING_HREF}
            className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-4 py-2 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90"
          >
            Get started
          </a>
        </div>

        <button
          onClick={() => setMobileOpen((v) => !v)}
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
            <a href={MANAGED_LOGIN_HREF} onClick={() => setMobileOpen(false)} className="block text-base text-stone-300 transition-colors hover:text-stone-100">
              Sign in
            </a>
            <a href={MANAGED_ONBOARDING_HREF} onClick={() => setMobileOpen(false)} className="mt-2 inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-4 py-2 text-sm font-medium text-[#0b0f14]">
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
              AI workers for consequential work.
            </p>
          </div>
          <div>
            <h4 className="mb-4 text-xs font-medium uppercase tracking-[0.24em] text-stone-500">Product</h4>
            <div className="space-y-3">
              <a href="/product" className="block text-sm text-stone-300 transition-colors hover:text-stone-100">Product</a>
              <a href="/pricing" className="block text-sm text-stone-300 transition-colors hover:text-stone-100">Pricing</a>
              <a href="/demo" className="block text-sm text-stone-300 transition-colors hover:text-stone-100">Demo</a>
            </div>
          </div>
          <div>
            <h4 className="mb-4 text-xs font-medium uppercase tracking-[0.24em] text-stone-500">Developers</h4>
            <div className="space-y-3">
              <a href={DOCS_EXTERNAL} className="block text-sm text-stone-300 transition-colors hover:text-stone-100" target="_blank" rel="noopener noreferrer">Docs</a>
              <a href={ossLinks.repo} className="block text-sm text-stone-300 transition-colors hover:text-stone-100" target="_blank" rel="noopener noreferrer">GitHub</a>
              <a href={DISCORD_HREF} className="block text-sm text-stone-300 transition-colors hover:text-stone-100" target="_blank" rel="noopener noreferrer">Discord</a>
            </div>
          </div>
          <div>
            <h4 className="mb-4 text-xs font-medium uppercase tracking-[0.24em] text-stone-500">Company</h4>
            <div className="space-y-3">
              <a href="/security" className="block text-sm text-stone-300 transition-colors hover:text-stone-100">Security</a>
              <a href="/privacy" className="block text-sm text-stone-300 transition-colors hover:text-stone-100">Privacy</a>
              <a href="/terms" className="block text-sm text-stone-300 transition-colors hover:text-stone-100">Terms</a>
            </div>
          </div>
        </div>
        <div className="mt-16 flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-8 md:flex-row">
          <p className="text-xs text-stone-500">&copy; 2026 Nooterra. All rights reserved.</p>
          <p className="text-xs text-stone-500">Guardrails, approvals, and audit trails for AI workers.</p>
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

function CodeBlock({ title, children }) {
  return (
    <div className="overflow-hidden rounded-lg border border-white/10 bg-[#10151c]">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <div className="h-2.5 w-2.5 rounded-full bg-white/15" />
        <div className="h-2.5 w-2.5 rounded-full bg-white/15" />
        <div className="h-2.5 w-2.5 rounded-full bg-white/15" />
        {title ? <span className="ml-2 font-mono text-xs text-stone-500">{title}</span> : null}
      </div>
      <pre className="overflow-x-auto p-6 text-sm leading-relaxed text-stone-300"><code>{children}</code></pre>
    </div>
  );
}

/* ─── HOME PAGE ─── */

function HomePage() {
  return (
    <SiteLayout>
      {/* Hero */}
      <section className="relative flex min-h-[90vh] items-center overflow-hidden">
        <div className="lovable-grid absolute inset-0 opacity-[0.03]" />
        <div className="lovable-orb lovable-orb-a" />
        <div className="lovable-orb lovable-orb-b" />
        <div className="relative mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <FadeIn>
            <p className="mb-6 text-sm uppercase tracking-[0.2em] text-stone-500">AI workers you control</p>
          </FadeIn>
          <FadeIn delay={0.1}>
            <h1
              className="max-w-5xl text-balance text-5xl leading-[0.95] tracking-tight text-stone-100 sm:text-6xl md:text-7xl lg:text-8xl"
              style={{ fontFamily: "var(--lovable-font-serif)" }}
            >
              AI workers for
              <br />
              <span className="text-[#d2b06f]">consequential work.</span>
            </h1>
          </FadeIn>
          <FadeIn delay={0.2}>
            <p className="mt-8 max-w-2xl text-lg leading-relaxed text-stone-400 md:text-xl">
              Describe what you need in plain English. Nooterra creates a worker with guardrails, approvals, and a full audit trail. Any AI provider. Real tools. Runs 24/7.
            </p>
          </FadeIn>
          <FadeIn delay={0.28}>
            <div className="mt-10 flex flex-wrap gap-4">
              <a href={buildManagedOnboardingHref("home")} className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-6 py-3 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90">
                Get started free <ArrowRight size={16} />
              </a>
              <a href="/demo" className="inline-flex items-center gap-2 rounded-md border border-[#d2b06f]/30 bg-[#d2b06f]/10 px-6 py-3 text-sm font-medium text-[#f3ddae] transition-all duration-200 hover:bg-[#d2b06f]/15">
                See it in action <ArrowUpRight size={15} />
              </a>
            </div>
          </FadeIn>
          <FadeIn delay={0.34}>
            <div className="mt-6">
              <CodeBlock title="terminal">
{`$ npm install -g nooterra
$ nooterra

  What do you need a worker to do?
  > Monitor competitor prices and alert me on Slack

  Creating worker charter...
  ✓ Charter generated with 3 canDo / 2 askFirst / 1 neverDo rules
  ✓ Connected: browser, slack
  ✓ Schedule: every hour

  Price Monitor is live. Worker ID: wrk_a8f2x`}
              </CodeBlock>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Worker creation flow */}
      <section className="border-t border-white/10 bg-[#0b0f14]">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <FadeIn>
            <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">How it works</p>
            <h2 className="mb-16 text-3xl text-stone-100 md:text-4xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>Describe. Charter. Deploy. Supervise.</h2>
          </FadeIn>
          <div className="overflow-hidden rounded-lg bg-white/10 lg:grid lg:grid-cols-4 lg:gap-px">
            {[
              { icon: MessageSquare, step: "01", title: "Describe", desc: "Tell Nooterra what you need done in plain English. It asks clarifying questions until the job is clear." },
              { icon: FileCheck, step: "02", title: "Charter", desc: "A charter is generated: canDo, askFirst, and neverDo rules. Review and adjust before deploying." },
              { icon: Zap, step: "03", title: "Deploy", desc: "The worker goes live as a daemon. Runs on schedule, webhook, or file watch. 24/7." },
              { icon: Eye, step: "04", title: "Supervise", desc: "Watch the live activity feed. Approve escalations from Slack, terminal, or web. Full audit trail." }
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

      {/* Why Nooterra comparison */}
      <section className="border-t border-white/10">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <FadeIn>
            <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">Why Nooterra</p>
            <h2 className="mb-12 text-3xl text-stone-100 md:text-4xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
              Not another chatbot. Not another automation tool.
            </h2>
          </FadeIn>
          <FadeIn delay={0.1}>
            <div className="overflow-hidden rounded-xl border border-white/10">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-[#10151c]">
                    <th className="px-6 py-4 text-left font-medium text-stone-400"></th>
                    <th className="px-6 py-4 text-left font-medium text-stone-400">Raw LLMs</th>
                    <th className="px-6 py-4 text-left font-medium text-stone-400">Custom agents</th>
                    <th className="px-6 py-4 text-left font-medium text-stone-400">Automation tools</th>
                    <th className="px-6 py-4 text-left font-medium text-[#d2b06f]">Nooterra</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {[
                    ["Guardrails", "None", "DIY", "Rigid", "canDo / askFirst / neverDo"],
                    ["Approvals", "None", "Build it yourself", "Limited", "Built-in, any channel"],
                    ["Audit trail", "Logs maybe", "Custom logging", "Partial", "Every action, automatic"],
                    ["AI provider", "Locked in", "Your choice", "Their choice", "Any provider"],
                    ["Runs 24/7", "No", "If you build infra", "Yes", "Yes, daemon mode"],
                    ["Setup time", "Minutes", "Weeks", "Hours", "Minutes"]
                  ].map(([feature, ...cols]) => (
                    <tr key={feature} className="bg-[#0d1218]">
                      <td className="px-6 py-3.5 font-medium text-stone-200">{feature}</td>
                      {cols.map((val, i) => (
                        <td key={i} className={`px-6 py-3.5 ${i === 3 ? "text-[#d2b06f]" : "text-stone-400"}`}>{val}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Feature highlights */}
      <section className="border-t border-white/10 bg-[#0b0f14]">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <FadeIn>
            <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">Features</p>
            <h2 className="mb-16 text-3xl text-stone-100 md:text-4xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
              Everything a worker needs to do real work safely.
            </h2>
          </FadeIn>
          <div className="grid gap-5 lg:grid-cols-4">
            {[
              { icon: Shield, title: "Guardrails", desc: "Every worker gets a charter: canDo, askFirst, and neverDo rules. Enforced at runtime, not suggested." },
              { icon: Check, title: "Approvals", desc: "Workers escalate when they hit a boundary. Approve from Slack, terminal, web, or mobile." },
              { icon: Activity, title: "24/7 Daemon", desc: "Workers run as real daemons with schedules, webhooks, and file watchers. Not a chat session." },
              { icon: Cpu, title: "Any AI Provider", desc: "Use Claude, GPT, Gemini, Llama, or any provider. Bring your own keys. No lock-in." }
            ].map((item, index) => (
              <FadeIn key={item.title} delay={0.08 * index}>
                <div className="lovable-panel h-full">
                  <item.icon className="mb-4 h-5 w-5 text-[#d2b06f]" />
                  <h3 className="mb-3 text-xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>{item.title}</h3>
                  <p className="text-sm leading-relaxed text-stone-400">{item.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* Worker templates */}
      <section className="border-t border-white/10">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <FadeIn>
            <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">Worker templates</p>
            <h2 className="mb-12 text-3xl text-stone-100 md:text-4xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
              Start with a template or describe your own.
            </h2>
          </FadeIn>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { title: "Customer Support", desc: "Triage tickets, draft responses, escalate edge cases to humans." },
              { title: "Sales Researcher", desc: "Find leads, enrich CRM data, draft personalized outreach." },
              { title: "Data Monitor", desc: "Watch dashboards, detect anomalies, alert on Slack." },
              { title: "Content Moderator", desc: "Review submissions, flag policy violations, approve or reject." },
              { title: "Invoice Processor", desc: "Extract data from invoices, match to POs, route for approval." },
              { title: "Competitor Tracker", desc: "Monitor competitor pricing, features, and announcements." }
            ].map((item, index) => (
              <FadeIn key={item.title} delay={0.06 * index}>
                <div className="lovable-panel">
                  <h3 className="text-base font-medium text-stone-100">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-stone-400">{item.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-white/10 bg-[#0b0f14]">
        <div className="mx-auto max-w-7xl px-6 py-24 text-center lg:px-8 lg:py-32">
          <FadeIn>
            <h2 className="mb-6 text-4xl text-stone-100 md:text-5xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
              Your first worker in 5 minutes.
            </h2>
            <div className="mx-auto mb-8 max-w-md">
              <CodeBlock title="terminal">
{`$ npm install -g nooterra
$ nooterra`}
              </CodeBlock>
            </div>
            <div className="flex flex-wrap justify-center gap-4">
              <a href={buildManagedOnboardingHref("home_cta")} className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-6 py-3 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90">
                Get started free <ArrowRight size={16} />
              </a>
              <a href={ossLinks.repo} className="inline-flex items-center gap-2 rounded-md border border-white/15 px-6 py-3 text-sm font-medium text-stone-100 transition-all duration-200 hover:bg-white/5" target="_blank" rel="noopener noreferrer">
                View on GitHub <ArrowUpRight size={15} />
              </a>
            </div>
          </FadeIn>
        </div>
      </section>
    </SiteLayout>
  );
}

/* ─── PRODUCT PAGE ─── */

function ProductPage() {
  return (
    <SiteLayout>
      <section className="relative flex min-h-[72vh] items-end overflow-hidden">
        <div className="lovable-grid absolute inset-0 opacity-[0.03]" />
        <div className="lovable-orb lovable-orb-a" />
        <div className="lovable-orb lovable-orb-b" />
        <div className="relative mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <FadeIn>
            <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">Product</p>
            <h1 className="max-w-4xl text-4xl leading-tight text-stone-100 md:text-5xl lg:text-6xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
              How workers work.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-stone-400">
              Nooterra workers are governed AI processes. They have a charter that defines what they can do, what requires approval, and what they must never touch.
            </p>
          </FadeIn>
        </div>
      </section>

      {/* Charter system */}
      <section className="border-t border-white/10">
        <div className="mx-auto grid max-w-7xl gap-16 px-6 py-24 lg:grid-cols-2 lg:px-8 lg:py-32">
          <FadeIn>
            <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">Charter system</p>
            <h2 className="text-3xl text-stone-100 md:text-4xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
              canDo. askFirst. neverDo.
            </h2>
            <p className="mt-6 leading-relaxed text-stone-400">
              Every worker gets a charter with three rule types. These are not suggestions. They are enforced at runtime.
            </p>
            <div className="mt-8 space-y-4">
              {[
                { label: "canDo", color: "text-emerald-400", desc: "Actions the worker can take autonomously. Read data, send notifications, update records within limits." },
                { label: "askFirst", color: "text-amber-400", desc: "Actions that require human approval before proceeding. Spending money, deleting data, contacting customers." },
                { label: "neverDo", color: "text-rose-400", desc: "Hard boundaries the worker cannot cross. Access production databases, share credentials, modify billing." }
              ].map((rule) => (
                <div key={rule.label} className="lovable-panel">
                  <p className={`font-mono text-sm font-medium ${rule.color}`}>{rule.label}</p>
                  <p className="mt-2 text-sm leading-relaxed text-stone-400">{rule.desc}</p>
                </div>
              ))}
            </div>
          </FadeIn>
          <FadeIn delay={0.15}>
            <CodeBlock title="charter.yaml">
{`name: Price Monitor
schedule: "0 * * * *"  # every hour
provider: claude

canDo:
  - Check competitor websites for price changes
  - Send price alerts to #pricing on Slack
  - Update internal price tracking spreadsheet

askFirst:
  - Adjust our prices by more than 5%
  - Send alerts to customers about price changes

neverDo:
  - Access payment or billing systems
  - Change prices without approval
  - Share competitor data externally`}
            </CodeBlock>
          </FadeIn>
        </div>
      </section>

      {/* Approval flows */}
      <section className="border-t border-white/10 bg-[#0b0f14]">
        <div className="mx-auto grid max-w-7xl gap-16 px-6 py-24 lg:grid-cols-2 lg:px-8 lg:py-32">
          <FadeIn>
            <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">Approval flows</p>
            <h2 className="text-3xl text-stone-100 md:text-4xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
              Workers ask. You decide.
            </h2>
            <p className="mt-6 leading-relaxed text-stone-400">
              When a worker hits an askFirst boundary, it pauses and sends an approval request. You approve or deny from wherever you are.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {[
                { title: "Slack", desc: "Approve with a button click in your Slack channel." },
                { title: "Terminal", desc: "Approve from the CLI with nooterra approve." },
                { title: "Web dashboard", desc: "Review and approve from the web UI." },
                { title: "Mobile", desc: "Push notification with approve/deny actions." }
              ].map((ch) => (
                <div key={ch.title} className="rounded-lg border border-white/10 bg-[#11161e] p-4">
                  <p className="text-sm font-medium text-stone-100">{ch.title}</p>
                  <p className="mt-1 text-sm text-stone-400">{ch.desc}</p>
                </div>
              ))}
            </div>
          </FadeIn>
          <FadeIn delay={0.15}>
            <CodeBlock title="slack notification">
{`┌─────────────────────────────────────────┐
│  🔔 Approval Required                   │
│                                          │
│  Worker: Price Monitor (wrk_a8f2x)       │
│  Action: Adjust widget price by -8%      │
│  Reason: Competitor dropped to $29.99    │
│  Rule:   askFirst — price change > 5%    │
│                                          │
│  [ ✓ Approve ]  [ ✕ Deny ]              │
└─────────────────────────────────────────┘`}
            </CodeBlock>
          </FadeIn>
        </div>
      </section>

      {/* Activity feed */}
      <section className="border-t border-white/10">
        <div className="mx-auto grid max-w-7xl gap-16 px-6 py-24 lg:grid-cols-2 lg:px-8 lg:py-32">
          <FadeIn>
            <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">Live activity</p>
            <h2 className="text-3xl text-stone-100 md:text-4xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
              See what workers are doing. Right now.
            </h2>
            <p className="mt-6 leading-relaxed text-stone-400">
              The activity feed shows every action, every decision, and every escalation in real time. Full audit trail by default.
            </p>
          </FadeIn>
          <FadeIn delay={0.15}>
            <CodeBlock title="activity feed">
{`14:32:01  Price Monitor    checked 12 competitor pages
14:32:04  Price Monitor    found 3 price changes
14:32:05  Price Monitor    sent alert to #pricing
14:33:00  Price Monitor    ⚠ asking: adjust widget price -8%
14:35:22  Price Monitor    ✓ approved by @alex
14:35:23  Price Monitor    updated widget price to $27.99
14:35:24  Price Monitor    logged change to audit trail`}
            </CodeBlock>
          </FadeIn>
        </div>
      </section>

      {/* Knowledge + Provider independence */}
      <section className="border-t border-white/10 bg-[#0b0f14]">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <div className="grid gap-5 lg:grid-cols-2">
            <FadeIn>
              <div className="lovable-panel h-full">
                <BookOpen className="mb-4 h-5 w-5 text-[#d2b06f]" />
                <h3 className="mb-3 text-xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>Knowledge system</h3>
                <p className="text-sm leading-relaxed text-stone-400">
                  Teach workers about your company with <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs text-stone-300">nooterra teach</code>. Upload docs, SOPs, style guides. Workers reference this knowledge when making decisions.
                </p>
              </div>
            </FadeIn>
            <FadeIn delay={0.1}>
              <div className="lovable-panel h-full">
                <Cpu className="mb-4 h-5 w-5 text-[#d2b06f]" />
                <h3 className="mb-3 text-xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>Provider independence</h3>
                <p className="text-sm leading-relaxed text-stone-400">
                  Workers are not tied to any AI provider. Use Claude, GPT-4, Gemini, Llama, or any model. Switch providers without changing your worker. Your keys, your choice.
                </p>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-white/10">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
          <FadeIn>
            <div className="lovable-panel lovable-cta-band flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-3xl text-stone-100 md:text-4xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                  Create your first worker.
                </h2>
                <p className="mt-4 max-w-2xl text-stone-400">
                  Describe what you need. Deploy in minutes. Supervise with confidence.
                </p>
              </div>
              <a href={buildManagedOnboardingHref("product_cta")} className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-6 py-3 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90">
                Get started free <ArrowRight size={16} />
              </a>
            </div>
          </FadeIn>
        </div>
      </section>
    </SiteLayout>
  );
}

/* ─── PRICING PAGE ─── */

function PricingPage() {
  const tiers = [
    {
      title: "Free",
      eyebrow: "Local",
      body: "Run unlimited workers on your machine. Your API keys, your data, no cloud required.",
      points: [
        "Unlimited local workers",
        "Any AI provider",
        "Full charter and guardrails",
        "CLI and MCP support",
        "Community support"
      ],
      cta: { label: "Install free", href: "/developers" },
      featured: false
    },
    {
      title: "Pro",
      eyebrow: "$29/month",
      body: "Workers that run in the cloud, 24/7. Approve from Slack. Webhooks and integrations.",
      points: [
        "Cloud-hosted workers",
        "Slack approvals",
        "Webhook integrations",
        "Activity dashboard",
        "Email support"
      ],
      cta: { label: "Start Pro", href: buildManagedOnboardingHref("pricing_pro") },
      featured: true
    },
    {
      title: "Team",
      eyebrow: "$99/month",
      body: "Shared workers, team approvals, SSO, and audit exports for growing teams.",
      points: [
        "Shared worker dashboard",
        "Team approval workflows",
        "SSO and admin controls",
        "Audit log export",
        "Priority support"
      ],
      cta: { label: "Talk to us", href: "/support" },
      featured: false
    }
  ];

  return (
    <SiteLayout>
      <section className="relative flex min-h-[60vh] items-end overflow-hidden">
        <div className="lovable-grid absolute inset-0 opacity-[0.03]" />
        <div className="lovable-orb lovable-orb-a" />
        <div className="lovable-orb lovable-orb-b" />
        <div className="relative mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <FadeIn>
            <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">Pricing</p>
            <h1 className="max-w-4xl text-4xl leading-tight text-stone-100 md:text-5xl lg:text-6xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
              Free to start.
              <br />
              <span className="text-[#d2b06f]">Scale when you need to.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-stone-400">
              Run unlimited workers locally for free. Upgrade when you need cloud hosting, team features, or Slack approvals.
            </p>
          </FadeIn>
        </div>
      </section>

      <section className="border-t border-white/10">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <div className="grid gap-5 lg:grid-cols-3">
            {tiers.map((tier, index) => (
              <FadeIn key={tier.title} delay={0.08 * index}>
                <div className={`lovable-panel h-full flex flex-col ${tier.featured ? "border-[#d2b06f]/35 bg-[#11161e]" : ""}`}>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-stone-500">{tier.eyebrow}</p>
                  <h3 className="mt-3 text-3xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                    {tier.title}
                  </h3>
                  <p className="mt-4 text-sm leading-relaxed text-stone-400">{tier.body}</p>
                  <div className="mt-6 flex-1 space-y-3">
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
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <FadeIn>
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl text-stone-100 md:text-4xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                No lock-in. Portable by design.
              </h2>
              <p className="mt-6 text-stone-400">
                Export your workers and charters anytime. Free tier has no time limit. Your API keys stay yours. Switch providers without changing workers.
              </p>
            </div>
          </FadeIn>
        </div>
      </section>
    </SiteLayout>
  );
}

/* ─── DEVELOPERS PAGE ─── */

function DevelopersPage() {
  const tabs = [
    {
      id: "cli",
      label: "CLI",
      desc: "The fastest way to get started. Create and manage workers from your terminal.",
      code: `# Install Nooterra globally
npm install -g nooterra

# Create your first worker interactively
nooterra

# Or create directly from a description
nooterra new "Monitor competitor prices and alert me on Slack"

# Manage workers
nooterra workers          # list all workers
nooterra logs wrk_a8f2x   # view activity log
nooterra approve          # review pending approvals
nooterra teach            # add knowledge to workers`
    },
    {
      id: "mcp",
      label: "MCP (Claude Desktop / Cursor)",
      desc: "Add Nooterra as an MCP server. Works with Claude Desktop, Cursor, and any MCP-compatible host.",
      code: `// Add to your MCP config (claude_desktop_config.json)
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
}

// That's it. Claude can now create and manage workers.`
    },
    {
      id: "api",
      label: "REST API",
      desc: "Full programmatic control. Create workers, manage approvals, query activity.",
      code: `# Create a worker
curl -X POST https://api.nooterra.com/v1/workers \\
  -H "Authorization: Bearer $NOOTERRA_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "description": "Monitor competitor prices",
    "provider": "claude",
    "schedule": "0 * * * *"
  }'

# List pending approvals
curl https://api.nooterra.com/v1/approvals?status=pending \\
  -H "Authorization: Bearer $NOOTERRA_API_KEY"`
    }
  ];
  const [activeTab, setActiveTab] = useState("cli");
  const active = tabs.find((t) => t.id === activeTab) ?? tabs[0];

  return (
    <SiteLayout>
      <section className="flex min-h-[50vh] items-end">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <FadeIn>
            <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">Developers</p>
            <h1 className="max-w-3xl text-4xl leading-tight text-stone-100 md:text-5xl lg:text-6xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
              Install. Create. Deploy.
            </h1>
            <p className="mt-6 max-w-2xl text-lg text-stone-400">
              CLI, MCP, or REST API. Same workers, same guardrails, same audit trail everywhere.
            </p>
            <div className="mt-6">
              <CodeBlock title="terminal">
{`$ npm install -g nooterra`}
              </CodeBlock>
            </div>
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
                <div className="mt-6 flex flex-wrap gap-3">
                  <a href={buildManagedOnboardingHref("developers")} className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-5 py-2.5 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90">
                    Get started free <ArrowRight size={16} />
                  </a>
                  <a href={DOCS_EXTERNAL} className="inline-flex items-center gap-2 rounded-md border border-white/15 px-5 py-2.5 text-sm font-medium text-stone-100 transition-all duration-200 hover:bg-white/5" target="_blank" rel="noopener noreferrer">
                    Full docs <ArrowUpRight size={15} />
                  </a>
                </div>
              </div>
              <div className="lg:col-span-3">
                <CodeBlock title="terminal">{active.code}</CodeBlock>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Reference links */}
      <section className="border-t border-white/10 bg-[#0b0f14]">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <div className="grid gap-5 lg:grid-cols-3">
            {[
              { title: "CLI Reference", desc: "Every command, flag, and option. nooterra --help in web form.", href: DOCS_EXTERNAL + "/cli" },
              { title: "API Reference", desc: "REST endpoints for workers, approvals, activity, and configuration.", href: DOCS_EXTERNAL + "/api" },
              { title: "MCP Integration", desc: "Setup guides for Claude Desktop, Cursor, and other MCP hosts.", href: DOCS_EXTERNAL + "/mcp" }
            ].map((item, index) => (
              <FadeIn key={item.title} delay={0.08 * index}>
                <a href={item.href} className="lovable-panel block transition-transform duration-200 hover:-translate-y-1" target="_blank" rel="noopener noreferrer">
                  <h3 className="text-lg text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>{item.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-stone-400">{item.desc}</p>
                  <span className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-[#d2b06f]">
                    Read docs <ArrowUpRight size={14} />
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

/* ─── DEMO PAGE ─── */

function DemoPage() {
  const [step, setStep] = useState(0);
  const steps = [
    {
      title: "1. Describe the worker",
      terminal: `$ nooterra

  What do you need a worker to do?
  > Monitor our top 5 competitors' pricing pages.
    When a price drops more than 10%, alert #pricing on Slack.
    If we should adjust our prices, ask me first.

  Got it. Let me ask a few questions...

  Which competitors?
  > Acme Corp, Widgetly, PriceBest, CostLess, DealFinder

  Which of our products should I track?
  > All products on /pricing

  ✓ Understanding complete. Generating charter...`
    },
    {
      title: "2. Review the charter",
      terminal: `  Charter for "Competitor Price Monitor"
  ────────────────────────────────────────
  canDo:
    ✓ Check competitor pricing pages (5 sites)
    ✓ Send alerts to #pricing on Slack
    ✓ Log all price changes to activity feed

  askFirst:
    ⚠ Recommend price adjustments for our products
    ⚠ Alert channels other than #pricing

  neverDo:
    ✕ Change our prices without approval
    ✕ Access billing or payment systems
    ✕ Share competitor data outside the team

  Provider: claude-sonnet  |  Schedule: every 2 hours
  Tools: browser, slack

  [Deploy] [Edit] [Cancel]`
    },
    {
      title: "3. Approve an escalation",
      terminal: `  ┌─────────────────────────────────────────┐
  │  🔔 Approval Required                   │
  │                                          │
  │  Worker: Competitor Price Monitor        │
  │  Action: Recommend 12% price cut on      │
  │          Widget Pro to match Acme Corp    │
  │                                          │
  │  Context:                                │
  │  - Acme dropped Widget Pro from $49→$39  │
  │  - Our current price: $45               │
  │  - Suggested new price: $39.99           │
  │                                          │
  │  Rule: askFirst — price adjustments      │
  │                                          │
  │  [ ✓ Approve ]  [ ✕ Deny ]              │
  └─────────────────────────────────────────┘`
    },
    {
      title: "4. Watch the activity feed",
      terminal: `  Competitor Price Monitor — Activity Feed
  ─────────────────────────────────────────
  09:00:01  checked Acme Corp /pricing        ✓
  09:00:03  checked Widgetly /pricing          ✓
  09:00:04  checked PriceBest /pricing         ✓
  09:00:05  checked CostLess /pricing          ✓
  09:00:06  checked DealFinder /pricing        ✓
  09:00:07  found: Acme dropped Widget Pro -22%
  09:00:08  sent alert to #pricing             ✓
  09:00:09  ⚠ asking: recommend price cut
  09:12:33  ✓ approved by @alex
  09:12:34  posted recommendation to #pricing  ✓
  09:12:35  logged to audit trail              ✓`
    }
  ];

  return (
    <SiteLayout>
      <section className="relative flex min-h-[50vh] items-end overflow-hidden">
        <div className="lovable-grid absolute inset-0 opacity-[0.03]" />
        <div className="lovable-orb lovable-orb-a" />
        <div className="lovable-orb lovable-orb-b" />
        <div className="relative mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <FadeIn>
            <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">Demo</p>
            <h1 className="max-w-3xl text-4xl leading-tight text-stone-100 md:text-5xl lg:text-6xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
              See a worker in action.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-stone-400">
              From description to deployment to supervision. Walk through the full lifecycle.
            </p>
          </FadeIn>
        </div>
      </section>

      <section className="border-t border-white/10">
        <div className="mx-auto max-w-7xl px-6 py-16 lg:px-8 lg:py-24">
          <div className="mb-8 flex gap-2 overflow-x-auto">
            {steps.map((s, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                className={`whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium transition-all duration-200 ${
                  step === i
                    ? "border-[#d2b06f]/40 bg-[#d2b06f]/12 text-[#f3ddae]"
                    : "border-white/10 bg-white/5 text-stone-300 hover:bg-white/10"
                }`}
              >
                {s.title}
              </button>
            ))}
          </div>
          <FadeIn key={step}>
            <CodeBlock title="nooterra demo">{steps[step].terminal}</CodeBlock>
          </FadeIn>
          <div className="mt-8 flex flex-wrap gap-4">
            <a href={buildManagedOnboardingHref("demo")} className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-6 py-3 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90">
              Try it yourself <ArrowRight size={16} />
            </a>
            <a href="/developers" className="inline-flex items-center gap-2 rounded-md border border-white/15 px-6 py-3 text-sm font-medium text-stone-100 transition-all duration-200 hover:bg-white/5">
              View install guide <ArrowUpRight size={15} />
            </a>
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}

/* ─── SECURITY PAGE ─── */

function SecurityPage() {
  return (
    <SiteLayout>
      <section className="relative flex min-h-[60vh] items-end overflow-hidden">
        <div className="lovable-grid absolute inset-0 opacity-[0.03]" />
        <div className="lovable-orb lovable-orb-a" />
        <div className="lovable-orb lovable-orb-b" />
        <div className="relative mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <FadeIn>
            <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">Security</p>
            <h1 className="max-w-4xl text-4xl leading-tight text-stone-100 md:text-5xl lg:text-6xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
              Security through enforced charters.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-stone-400">
              Workers cannot exceed their charter. Every action is logged. Every escalation requires human approval. Every boundary is enforced at runtime, not suggested.
            </p>
          </FadeIn>
        </div>
      </section>

      <section className="border-t border-white/10">
        <div className="mx-auto grid max-w-7xl gap-5 px-6 py-24 lg:grid-cols-3 lg:px-8 lg:py-32">
          {[
            { title: "Charter enforcement", desc: "canDo, askFirst, and neverDo rules are enforced at the runtime level. Workers cannot bypass their charter." },
            { title: "Full audit trail", desc: "Every action, approval, and decision is logged with timestamps, context, and outcomes. Export anytime." },
            { title: "Emergency controls", desc: "Pause or kill any worker instantly. Revoke approvals. Freeze operations. You are always in control." }
          ].map((item, index) => (
            <FadeIn key={item.title} delay={0.08 * index}>
              <div className="lovable-panel h-full">
                <h3 className="mb-3 text-xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>{item.title}</h3>
                <p className="text-sm leading-relaxed text-stone-400">{item.desc}</p>
              </div>
            </FadeIn>
          ))}
        </div>
      </section>

      <section className="border-t border-white/10 bg-[#0b0f14]">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <FadeIn>
            <div className="lovable-panel lovable-panel-strong">
              <h3 className="mb-6 text-2xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>Security principles</h3>
              <div className="space-y-3">
                {[
                  { title: "Fail closed", body: "If anything is ambiguous, the worker stops and asks. Missing context, unclear scope, or expired approvals all halt execution." },
                  { title: "Least privilege", body: "Workers only have access to the tools and data explicitly granted in their charter. Nothing more." },
                  { title: "Human in the loop", body: "Consequential actions always route through human approval. The threshold is configurable per worker." },
                  { title: "Portable and transparent", body: "Charters are readable YAML. Audit logs are exportable. No black boxes." }
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
    </SiteLayout>
  );
}

/* ─── PRIVACY PAGE ─── */

function PrivacyPage() {
  return (
    <SiteLayout>
      <section className="relative flex min-h-[60vh] items-end overflow-hidden">
        <div className="lovable-grid absolute inset-0 opacity-[0.03]" />
        <div className="lovable-orb lovable-orb-a" />
        <div className="lovable-orb lovable-orb-b" />
        <div className="relative mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <FadeIn>
            <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">Privacy</p>
            <h1 className="max-w-4xl text-4xl leading-tight text-stone-100 md:text-5xl lg:text-6xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
              Your data stays yours.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-stone-400">
              Nooterra stores worker configurations and audit logs. Your API keys are encrypted at rest. We never train on your data or share it with third parties.
            </p>
          </FadeIn>
        </div>
      </section>

      <section className="border-t border-white/10">
        <div className="mx-auto grid max-w-7xl gap-5 px-6 py-24 lg:grid-cols-3 lg:px-8 lg:py-32">
          {[
            { title: "Your keys, your providers", body: "AI provider API keys are encrypted and never leave your account boundary. Free tier runs entirely on your machine." },
            { title: "Audit logs, not surveillance", body: "We log worker actions for your benefit. Audit logs are exportable and deletable. No analytics exhaust." },
            { title: "Data portability", body: "Export your workers, charters, and logs at any time. Cancel and your data is deleted within 30 days." }
          ].map((item, index) => (
            <FadeIn key={item.title} delay={0.08 * index}>
              <div className="lovable-panel h-full">
                <h3 className="mb-3 text-xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>{item.title}</h3>
                <p className="text-sm leading-relaxed text-stone-400">{item.desc}</p>
              </div>
            </FadeIn>
          ))}
        </div>
      </section>
    </SiteLayout>
  );
}

/* ─── TERMS PAGE ─── */

function TermsPage() {
  return (
    <SiteLayout>
      <section className="relative flex min-h-[60vh] items-end overflow-hidden">
        <div className="lovable-grid absolute inset-0 opacity-[0.03]" />
        <div className="lovable-orb lovable-orb-a" />
        <div className="lovable-orb lovable-orb-b" />
        <div className="relative mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <FadeIn>
            <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">Terms</p>
            <h1 className="max-w-4xl text-4xl leading-tight text-stone-100 md:text-5xl lg:text-6xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
              Terms of service.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-stone-400">
              Nooterra provides AI worker infrastructure. Workers operate within charters you define. You are responsible for the instructions you give and the approvals you grant.
            </p>
          </FadeIn>
        </div>
      </section>

      <section className="border-t border-white/10">
        <div className="mx-auto grid max-w-7xl gap-5 px-6 py-24 lg:grid-cols-3 lg:px-8 lg:py-32">
          {[
            { title: "Your workers, your responsibility", body: "You define the charter, grant approvals, and control what workers can do. Nooterra enforces boundaries you set." },
            { title: "Fair use", body: "Workers should perform legitimate business tasks. Do not use Nooterra for spam, fraud, harassment, or anything illegal." },
            { title: "Service availability", body: "Free tier runs locally with no uptime guarantee. Paid tiers include SLA terms. Check status at /status." }
          ].map((item, index) => (
            <FadeIn key={item.title} delay={0.08 * index}>
              <div className="lovable-panel h-full">
                <h3 className="mb-3 text-xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>{item.title}</h3>
                <p className="text-sm leading-relaxed text-stone-400">{item.body}</p>
              </div>
            </FadeIn>
          ))}
        </div>
      </section>
    </SiteLayout>
  );
}

/* ─── SUPPORT PAGE ─── */

function SupportPage() {
  return (
    <SiteLayout>
      <section className="relative flex min-h-[60vh] items-end overflow-hidden">
        <div className="lovable-grid absolute inset-0 opacity-[0.03]" />
        <div className="lovable-orb lovable-orb-a" />
        <div className="lovable-orb lovable-orb-b" />
        <div className="relative mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <FadeIn>
            <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">Support</p>
            <h1 className="max-w-4xl text-4xl leading-tight text-stone-100 md:text-5xl lg:text-6xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
              Get help.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-stone-400">
              Check docs first. If you are stuck, reach out on Discord or open a GitHub issue.
            </p>
          </FadeIn>
        </div>
      </section>

      <section className="border-t border-white/10">
        <div className="mx-auto grid max-w-7xl gap-5 px-6 py-24 lg:grid-cols-3 lg:px-8 lg:py-32">
          {[
            { title: "Documentation", desc: "Guides, API reference, and troubleshooting.", href: DOCS_EXTERNAL, ctaLabel: "Open docs" },
            { title: "Discord", desc: "Ask questions, share workers, get help from the community.", href: DISCORD_HREF, ctaLabel: "Join Discord" },
            { title: "GitHub Issues", desc: "Report bugs or request features.", href: ossLinks.issues, ctaLabel: "Open issue" }
          ].map((item, index) => (
            <FadeIn key={item.title} delay={0.08 * index}>
              <div className="lovable-panel h-full">
                <h3 className="mb-3 text-xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>{item.title}</h3>
                <p className="text-sm leading-relaxed text-stone-400">{item.desc}</p>
                <a href={item.href} className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-[#d2b06f] transition-colors hover:text-[#e2c994]" target="_blank" rel="noopener noreferrer">
                  {item.ctaLabel} <ArrowUpRight size={14} />
                </a>
              </div>
            </FadeIn>
          ))}
        </div>
      </section>
    </SiteLayout>
  );
}

/* ─── STATUS PAGE ─── */

const PUBLIC_STATUS_CHECKS = Object.freeze([
  { id: "home", label: "Homepage", description: "Main site entry point.", path: "/", type: "html", needle: "AI workers for" },
  { id: "product", label: "Product", description: "Product overview page.", path: "/product", type: "html", needle: "How workers work" },
  { id: "pricing", label: "Pricing", description: "Pricing page.", path: "/pricing", type: "html", needle: "Free to start" },
  { id: "demo", label: "Demo", description: "Demo walkthrough.", path: "/demo", type: "html", needle: "See a worker" }
]);

function normalizeStatusPathname(value) {
  if (typeof window === "undefined") return "";
  try { return new URL(String(value ?? "/"), window.location.origin).pathname || "/"; } catch { return ""; }
}

async function probePublicHtmlRoute(check, { timeoutMs = 8000, intervalMs = 250 } = {}) {
  if (typeof window === "undefined" || !window.document?.body) {
    return { ...check, status: "unavailable", statusLabel: "Unavailable", detail: "Browser route checks require a live document body" };
  }
  return new Promise((resolve) => {
    const iframe = window.document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.tabIndex = -1;
    Object.assign(iframe.style, { position: "fixed", width: "1px", height: "1px", opacity: "0", pointerEvents: "none", border: "0" });

    const expectedPathname = normalizeStatusPathname(check.path);
    let settled = false;
    let intervalId = null;
    let timeoutId = null;
    let lastState = { actualPathname: "", bodyText: "", readyState: "" };

    const cleanup = () => {
      if (intervalId !== null) window.clearInterval(intervalId);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      iframe.remove();
    };

    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ ...check, actualPathname: lastState.actualPathname, ...result });
    };

    const readFrameState = () => {
      try {
        const fw = iframe.contentWindow;
        const fd = iframe.contentDocument;
        lastState = { actualPathname: String(fw?.location?.pathname ?? ""), bodyText: String(fd?.body?.innerText ?? ""), readyState: String(fd?.readyState ?? "") };
        const pathnameOk = !expectedPathname || lastState.actualPathname === expectedPathname;
        const needleOk = !check.needle || lastState.bodyText.includes(check.needle);
        if (lastState.readyState === "complete" && pathnameOk && needleOk) {
          finish({ status: "ok", statusLabel: "Operational", detail: "Route rendered correctly" });
        }
      } catch (error) {
        finish({ status: "unavailable", statusLabel: "Unavailable", detail: String(error?.message ?? "Probe failed") });
      }
    };

    iframe.addEventListener("load", () => { readFrameState(); if (!settled) intervalId = window.setInterval(readFrameState, intervalMs); });
    timeoutId = window.setTimeout(() => finish({ status: "degraded", statusLabel: "Degraded", detail: "Timed out" }), timeoutMs);
    window.document.body.append(iframe);
    iframe.src = check.path;
  });
}

function deriveStatusVerdict(results) {
  if (!Array.isArray(results) || results.length === 0) return { label: "Checking", tone: "text-stone-400 border-white/10 bg-white/5" };
  if (results.some((r) => r.status === "unavailable")) return { label: "Degraded", tone: "text-rose-300 border-rose-500/20 bg-rose-500/10" };
  if (results.some((r) => r.status === "degraded")) return { label: "Watching", tone: "text-amber-300 border-amber-500/20 bg-amber-500/10" };
  return { label: "Operational", tone: "text-emerald-300 border-emerald-500/20 bg-emerald-500/10" };
}

function StatusPage() {
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [statusState, setStatusState] = useState({ loading: true, checks: [], checkedAt: "" });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setStatusState((prev) => ({ ...prev, loading: true }));
      const checks = await Promise.all(PUBLIC_STATUS_CHECKS.map((c) => probePublicHtmlRoute(c)));
      if (cancelled) return;
      setStatusState({ loading: false, checks, checkedAt: new Date().toISOString() });
    }
    load();
    return () => { cancelled = true; };
  }, [refreshNonce]);

  const verdict = deriveStatusVerdict(statusState.checks);

  return (
    <SiteLayout>
      <section className="relative flex min-h-[60vh] items-end overflow-hidden">
        <div className="lovable-grid absolute inset-0 opacity-[0.03]" />
        <div className="lovable-orb lovable-orb-a" />
        <div className="lovable-orb lovable-orb-b" />
        <div className="relative mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <FadeIn>
            <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">Status</p>
            <h1 className="max-w-4xl text-4xl leading-tight text-stone-100 md:text-5xl lg:text-6xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
              Service status.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-stone-400">
              Live health checks for Nooterra public routes.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={() => setRefreshNonce((v) => v + 1)}
                className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-6 py-3 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90"
              >
                Refresh <RotateCcw size={16} />
              </button>
              <div className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.18em] ${verdict.tone}`}>
                {statusState.loading ? "Checking" : verdict.label}
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      <section className="border-t border-white/10">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <div className="lovable-panel lovable-panel-strong">
            <p className="mb-1 text-sm text-stone-500">
              {statusState.loading ? "Running checks..." : statusState.checkedAt ? `Last checked ${new Date(statusState.checkedAt).toLocaleString()}.` : ""}
            </p>
            <div className="mt-4 space-y-3">
              {statusState.checks.map((item, index) => (
                <div key={item.id} className="lovable-rail-row">
                  <div className="lovable-rail-index">0{index + 1}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm font-medium text-stone-100">{item.label}</p>
                      <span className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] ${
                        item.status === "ok" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                          : item.status === "degraded" ? "border-amber-500/20 bg-amber-500/10 text-amber-300"
                            : "border-rose-500/20 bg-rose-500/10 text-rose-300"
                      }`}>
                        {item.statusLabel}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-stone-400">{item.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}

/* ─── SIMPLE REDIRECT PAGES ─── */

function SimpleInfoPage({ eyebrow, title, summary }) {
  return (
    <SiteLayout>
      <section className="relative flex min-h-[60vh] items-end overflow-hidden">
        <div className="lovable-grid absolute inset-0 opacity-[0.03]" />
        <div className="lovable-orb lovable-orb-a" />
        <div className="lovable-orb lovable-orb-b" />
        <div className="relative mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <FadeIn>
            <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">{eyebrow}</p>
            <h1 className="max-w-4xl text-4xl leading-tight text-stone-100 md:text-5xl lg:text-6xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
              {title}
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-stone-400">{summary}</p>
            <div className="mt-10 flex flex-wrap gap-4">
              <a href="/" className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-6 py-3 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90">
                Go home <ArrowRight size={16} />
              </a>
              <a href="/support" className="inline-flex items-center gap-2 rounded-md border border-white/15 px-6 py-3 text-sm font-medium text-stone-100 transition-all duration-200 hover:bg-white/5">
                Get help <ArrowUpRight size={15} />
              </a>
            </div>
          </FadeIn>
        </div>
      </section>
    </SiteLayout>
  );
}

/* ─── MAIN EXPORT ─── */

export default function LovableSite({ mode = "home" }) {
  if (mode === "product") return <ProductPage />;
  if (mode === "demo") return <DemoPage />;
  if (mode === "pricing") return <PricingPage />;
  if (mode === "developers") return <DevelopersPage />;
  if (mode === "status") return <StatusPage />;
  if (mode === "security") return <SecurityPage />;
  if (mode === "privacy") return <PrivacyPage />;
  if (mode === "terms") return <TermsPage />;
  if (mode === "support") return <SupportPage />;

  // Docs routes redirect to external docs
  if (typeof mode === "string" && mode.startsWith("docs")) {
    if (typeof window !== "undefined") window.location.replace(DOCS_EXTERNAL);
    return null;
  }

  // Integrations redirects to developers
  if (mode === "integrations") return <DevelopersPage />;

  // Onboarding redirects
  if (mode === "onboarding") {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("experience") === "app") {
        window.location.replace(MANAGED_ONBOARDING_HREF);
        return null;
      }
    }
    return <HomePage />;
  }

  // Error/incident pages
  if (mode === "expired") return <SimpleInfoPage eyebrow="Expired" title="This link has expired." summary="The approval window closed. Return home to start a new request." />;
  if (mode === "revoked") return <SimpleInfoPage eyebrow="Revoked" title="This authority was revoked." summary="The grant is no longer valid. Return home or contact support." />;
  if (mode === "verification_failed") return <SimpleInfoPage eyebrow="Verification failed" title="Verification did not pass." summary="The action completed but proof did not verify. Check your activity feed or contact support." />;
  if (mode === "unsupported_host") return <SimpleInfoPage eyebrow="Unsupported host" title="This host is not yet supported." summary="Nooterra currently supports CLI, MCP, and REST API. Check the developers page for supported integrations." />;

  // Trust entry pages redirect to home for public visitors
  if (mode === "wallet" || mode === "approvals" || mode === "receipts" || mode === "disputes") return <HomePage />;

  return <HomePage />;
}
