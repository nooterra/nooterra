import { useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Menu,
  RotateCcw,
  Shield,
  X,
  Zap,
  Eye,
  Cpu,
  Clock,
  GitBranch
} from "lucide-react";
import { ossLinks } from "../site/config/links.js";

const DOCS_EXTERNAL = "https://docs.nooterra.com";
const DOCS_GETTING_STARTED = DOCS_EXTERNAL + "/getting-started";
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
    { label: "Pricing", href: "/pricing" },
    { label: "Docs", href: DOCS_EXTERNAL },
    { label: "GitHub", href: ossLinks.repo }
  ];

  return (
    <nav className="fixed inset-x-0 top-0 z-50 border-b border-white/[0.06] bg-[#08090d]/90 backdrop-blur-lg">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <a href="/" className="flex items-center gap-2 group">
          <span className="text-[15px] font-medium tracking-tight text-stone-100 transition-colors duration-200 group-hover:text-[#d2b06f]">
            nooterra
          </span>
        </a>

        <div className="hidden items-center gap-8 md:flex">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={`text-[13px] transition-colors duration-150 ${
                pathname === link.href ? "text-stone-200" : "text-stone-500 hover:text-stone-200"
              }`}
              {...(link.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="hidden items-center gap-3 md:flex">
          <a
            href={ossLinks.repo}
            className="inline-flex items-center rounded-md bg-stone-100 px-3.5 py-1.5 text-[13px] font-medium text-stone-900 transition-all duration-150 hover:bg-white"
            target="_blank" rel="noopener noreferrer"
          >
            Get started
          </a>
        </div>

        <button
          onClick={() => setMobileOpen((v) => !v)}
          className="p-2 text-stone-400 md:hidden"
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {mobileOpen ? (
        <div className="border-t border-white/[0.06] bg-[#08090d]/95 backdrop-blur-lg md:hidden">
          <div className="space-y-3 px-6 py-5">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="block text-sm text-stone-400 transition-colors hover:text-stone-200"
              >
                {link.label}
              </a>
            ))}
            <div className="pt-2">
              <a href={ossLinks.repo} onClick={() => setMobileOpen(false)} className="inline-flex items-center rounded-md bg-stone-100 px-3.5 py-1.5 text-sm font-medium text-stone-900" target="_blank" rel="noopener noreferrer">
                Get started
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </nav>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-white/[0.06]">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div>
            <span className="text-sm font-medium text-stone-300">nooterra</span>
            <p className="mt-2 max-w-xs text-[13px] leading-relaxed text-stone-600">
              AI workers for consequential work.
            </p>
          </div>
          <div className="flex flex-wrap gap-x-12 gap-y-6">
            <div className="space-y-2.5">
              <p className="text-[11px] font-medium uppercase tracking-[0.15em] text-stone-600">Product</p>
              <a href="/pricing" className="block text-[13px] text-stone-500 transition-colors hover:text-stone-300">Pricing</a>
              <a href="/security" className="block text-[13px] text-stone-500 transition-colors hover:text-stone-300">Security</a>
              <a href="/status" className="block text-[13px] text-stone-500 transition-colors hover:text-stone-300">Status</a>
            </div>
            <div className="space-y-2.5">
              <p className="text-[11px] font-medium uppercase tracking-[0.15em] text-stone-600">Resources</p>
              <a href={DOCS_EXTERNAL} className="block text-[13px] text-stone-500 transition-colors hover:text-stone-300" target="_blank" rel="noopener noreferrer">Docs</a>
              <a href={ossLinks.repo} className="block text-[13px] text-stone-500 transition-colors hover:text-stone-300" target="_blank" rel="noopener noreferrer">GitHub</a>
              <a href={DISCORD_HREF} className="block text-[13px] text-stone-500 transition-colors hover:text-stone-300" target="_blank" rel="noopener noreferrer">Discord</a>
            </div>
            <div className="space-y-2.5">
              <p className="text-[11px] font-medium uppercase tracking-[0.15em] text-stone-600">Legal</p>
              <a href="/privacy" className="block text-[13px] text-stone-500 transition-colors hover:text-stone-300">Privacy</a>
              <a href="/terms" className="block text-[13px] text-stone-500 transition-colors hover:text-stone-300">Terms</a>
              <a href="/support" className="block text-[13px] text-stone-500 transition-colors hover:text-stone-300">Support</a>
            </div>
          </div>
        </div>
        <div className="mt-10 border-t border-white/[0.04] pt-6">
          <p className="text-[11px] text-stone-700">&copy; 2026 Nooterra</p>
        </div>
      </div>
    </footer>
  );
}

function SiteLayout({ children }) {
  return (
    <div className="min-h-screen bg-[#09090b] text-stone-300">
      <SiteNav />
      <main className="pt-14">{children}</main>
      <SiteFooter />
    </div>
  );
}

function CodeBlock({ title, children }) {
  return (
    <div className="overflow-hidden rounded-lg border border-white/[0.06] bg-[#0c0c0e]">
      <div className="flex items-center gap-2 border-b border-white/[0.04] px-4 py-2.5">
        <div className="flex gap-1.5">
          <div className="h-2 w-2 rounded-full bg-white/[0.08]" />
          <div className="h-2 w-2 rounded-full bg-white/[0.08]" />
          <div className="h-2 w-2 rounded-full bg-white/[0.08]" />
        </div>
        {title ? <span className="ml-2 font-mono text-[11px] text-stone-600">{title}</span> : null}
      </div>
      <pre className="overflow-x-auto p-5 font-mono text-[13px] leading-relaxed text-stone-400"><code>{children}</code></pre>
    </div>
  );
}

/* ─── Animated worker card ─── */

const WORKER_STEPS = [
  { label: "Read customer email", status: "done" },
  { label: "Look up account in Stripe", status: "done" },
  { label: "Draft refund reply", status: "done" },
  { label: "Issue $49 refund", status: "approval" },
];

function WorkerCard() {
  const [step, setStep] = useState(0);
  const [approved, setApproved] = useState(false);

  useEffect(() => {
    if (step >= WORKER_STEPS.length) return;
    const delay = step === 0 ? 800 : WORKER_STEPS[step].status === "approval" ? 1200 : 700;
    const timer = setTimeout(() => setStep(s => s + 1), delay);
    return () => clearTimeout(timer);
  }, [step]);

  useEffect(() => {
    if (step >= WORKER_STEPS.length && !approved) {
      const timer = setTimeout(() => setApproved(true), 1500);
      return () => clearTimeout(timer);
    }
  }, [step, approved]);

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      {/* Worker header */}
      <div className="flex items-center justify-between border-b border-white/[0.04] px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[13px] font-medium text-stone-200">Customer Support Worker</span>
        </div>
        <span className="text-[11px] text-stone-600">running</span>
      </div>

      {/* Activity */}
      <div className="px-5 py-4 space-y-2.5">
        {WORKER_STEPS.slice(0, step).map((s, i) => (
          <div key={i} className="flex items-center gap-3" style={{ animation: "lovable-fade-in 0.3s ease forwards" }}>
            {s.status === "done" ? (
              <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" strokeWidth={2.5} />
            ) : approved ? (
              <Check className="h-3.5 w-3.5 shrink-0 text-[#d2b06f]" strokeWidth={2.5} />
            ) : (
              <div className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-amber-500 animate-pulse" />
            )}
            <span className={`text-[13px] ${s.status === "approval" && !approved ? "text-amber-400" : "text-stone-400"}`}>
              {s.label}
            </span>
            {s.status === "approval" && !approved ? (
              <span className="ml-auto rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-amber-400">
                needs approval
              </span>
            ) : s.status === "approval" && approved ? (
              <span className="ml-auto rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-emerald-400">
                approved
              </span>
            ) : null}
          </div>
        ))}
        {step < WORKER_STEPS.length ? (
          <div className="flex items-center gap-3 text-stone-600">
            <div className="h-3.5 w-3.5 shrink-0 rounded-full border border-white/[0.08] animate-pulse" />
            <span className="text-[13px]">Working...</span>
          </div>
        ) : null}
      </div>

      {/* Charter summary */}
      <div className="border-t border-white/[0.04] px-5 py-3">
        <div className="flex flex-wrap gap-4 text-[11px]">
          <span className="text-emerald-500/70">4 canDo</span>
          <span className="text-amber-500/70">3 askFirst</span>
          <span className="text-rose-500/70">2 neverDo</span>
          <span className="ml-auto text-stone-600">$0.003 this run</span>
        </div>
      </div>
    </div>
  );
}

/* ─── HOME PAGE ─── */

function HomePage() {
  return (
    <SiteLayout>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[#d2b06f]/[0.03] via-transparent to-transparent" />
        <div className="relative mx-auto max-w-6xl px-6 pb-16 pt-24 md:pb-24 md:pt-36">
          <div className="grid items-center gap-16 lg:grid-cols-2">
            <div>
              <FadeIn>
                <h1 className="text-[clamp(2.25rem,5vw,3.5rem)] leading-[1.08] tracking-[-0.03em] text-stone-100">
                  Describe the job.<br />
                  The worker <span className="text-[#d2b06f]">handles it.</span>
                </h1>
              </FadeIn>
              <FadeIn delay={0.08}>
                <p className="mt-6 max-w-md text-[16px] leading-relaxed text-stone-500">
                  AI workers that run 24/7 with hard boundaries on what they can and can't do. You stay in control. They do the work.
                </p>
              </FadeIn>
              <FadeIn delay={0.14}>
                <div className="mt-8 flex flex-wrap items-center gap-3">
                  <a href={ossLinks.repo} className="inline-flex items-center gap-2 rounded-md bg-stone-100 px-4 py-2.5 text-[13px] font-medium text-stone-900 transition-all duration-150 hover:bg-white" target="_blank" rel="noopener noreferrer">
                    Get started <ArrowRight size={14} />
                  </a>
                  <a href={DOCS_EXTERNAL} className="inline-flex items-center gap-2 rounded-md border border-white/[0.08] px-4 py-2.5 text-[13px] text-stone-500 transition-all duration-150 hover:border-white/[0.15] hover:text-stone-200" target="_blank" rel="noopener noreferrer">
                    Read the docs <ArrowUpRight size={13} />
                  </a>
                </div>
              </FadeIn>
            </div>
            <FadeIn delay={0.2}>
              <WorkerCard />
            </FadeIn>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-white/[0.04]">
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
          <FadeIn>
            <h2 className="text-2xl tracking-[-0.01em] text-stone-200 md:text-3xl">
              How it works
            </h2>
          </FadeIn>
          <div className="mt-12 grid gap-px overflow-hidden rounded-lg border border-white/[0.06] bg-white/[0.03] md:grid-cols-3">
            {[
              { num: "1", title: "Describe", desc: "Tell Nooterra what you need in plain English. It infers the tools, schedule, and generates a charter with canDo, askFirst, and neverDo rules." },
              { num: "2", title: "Deploy", desc: "Review the charter, adjust if needed, and deploy. The worker runs as a daemon — on a schedule, webhook trigger, or continuously." },
              { num: "3", title: "Supervise", desc: "Watch the live activity feed. Approve escalations from Slack, email, or your dashboard. Every action is logged." }
            ].map((item, i) => (
              <FadeIn key={item.num} delay={i * 0.08}>
                <div className="flex h-full flex-col bg-[#09090b] p-8">
                  <span className="mb-5 inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/[0.08] font-mono text-xs text-stone-500">{item.num}</span>
                  <h3 className="mb-2 text-[15px] font-medium text-stone-200">{item.title}</h3>
                  <p className="text-[13px] leading-relaxed text-stone-500">{item.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* Charter system */}
      <section className="border-t border-white/[0.04]">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 py-20 md:grid-cols-2 md:py-28">
          <FadeIn>
            <h2 className="text-2xl tracking-[-0.01em] text-stone-200 md:text-3xl">
              Guardrails that are<br />actually enforced.
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-stone-500">
              Every worker gets a charter with three rule types. These aren't prompt suggestions — they're enforced at runtime before every action.
            </p>
            <div className="mt-8 space-y-3">
              <div className="flex items-start gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
                <span className="mt-0.5 font-mono text-xs font-medium text-emerald-500">canDo</span>
                <p className="text-[13px] text-stone-500">Actions the worker takes autonomously. Read data, send alerts, update records.</p>
              </div>
              <div className="flex items-start gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
                <span className="mt-0.5 font-mono text-xs font-medium text-amber-500">askFirst</span>
                <p className="text-[13px] text-stone-500">Actions that pause and wait for your approval. Refunds, external emails, spending.</p>
              </div>
              <div className="flex items-start gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
                <span className="mt-0.5 font-mono text-xs font-medium text-rose-500">neverDo</span>
                <p className="text-[13px] text-stone-500">Hard blocks the worker cannot cross, no matter what. Enforced at runtime.</p>
              </div>
            </div>
          </FadeIn>
          <FadeIn delay={0.12}>
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
              <div className="border-b border-white/[0.04] px-5 py-3">
                <span className="text-[13px] font-medium text-stone-300">Customer Support Worker</span>
                <span className="ml-3 text-[11px] text-stone-600">charter</span>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-emerald-500/70">Can do</p>
                  <div className="space-y-1.5">
                    {["Read customer emails", "Look up billing in Stripe", "Draft reply messages", "Search FAQ and knowledge base"].map(r => (
                      <div key={r} className="flex items-center gap-2.5">
                        <Check className="h-3 w-3 shrink-0 text-emerald-500/50" strokeWidth={2.5} />
                        <span className="text-[13px] text-stone-400">{r}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-amber-500/70">Ask first</p>
                  <div className="space-y-1.5">
                    {["Issue refunds over $10", "Send emails to customers", "Make promises about features"].map(r => (
                      <div key={r} className="flex items-center gap-2.5">
                        <Shield className="h-3 w-3 shrink-0 text-amber-500/50" strokeWidth={2.5} />
                        <span className="text-[13px] text-stone-400">{r}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-rose-500/70">Never do</p>
                  <div className="space-y-1.5">
                    {["Share customer data between customers", "Make up information", "Delete any records"].map(r => (
                      <div key={r} className="flex items-center gap-2.5">
                        <X className="h-3 w-3 shrink-0 text-rose-500/50" strokeWidth={2.5} />
                        <span className="text-[13px] text-stone-400">{r}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Feature grid */}
      <section className="border-t border-white/[0.04]">
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
          <FadeIn>
            <h2 className="text-2xl tracking-[-0.01em] text-stone-200 md:text-3xl">
              Built for work that matters.
            </h2>
          </FadeIn>
          <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: Shield, title: "Approvals", desc: "Sensitive actions pause and wait for you. Approve from Slack, email, or your phone. First response wins." },
              { icon: Clock, title: "Runs 24/7", desc: "Real daemon with crash recovery, cron schedules, and auto-start on login. Not a chat session." },
              { icon: Cpu, title: "Any provider", desc: "Claude, GPT, Gemini, Llama, Groq, or Ollama. Bring your keys. Swap anytime." },
              { icon: Eye, title: "Full audit", desc: "Every action, tool call, and decision logged automatically. Exportable. No black boxes." }
            ].map((item, i) => (
              <FadeIn key={item.title} delay={i * 0.06}>
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-6">
                  <item.icon className="mb-4 h-4 w-4 text-stone-500" strokeWidth={1.5} />
                  <h3 className="mb-2 text-[14px] font-medium text-stone-200">{item.title}</h3>
                  <p className="text-[13px] leading-relaxed text-stone-500">{item.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* Comparison */}
      <section className="border-t border-white/[0.04]">
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
          <FadeIn>
            <h2 className="mb-10 text-2xl tracking-[-0.01em] text-stone-200 md:text-3xl">
              Not another chatbot.
            </h2>
          </FadeIn>
          <FadeIn delay={0.08}>
            <div className="overflow-x-auto rounded-lg border border-white/[0.06]">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-white/[0.04] bg-white/[0.02]">
                    <th className="px-5 py-3 text-left font-medium text-stone-500"></th>
                    <th className="px-5 py-3 text-left font-normal text-stone-600">ChatGPT / LLM</th>
                    <th className="px-5 py-3 text-left font-normal text-stone-600">Custom agent</th>
                    <th className="px-5 py-3 text-left font-normal text-stone-600">Zapier / Make</th>
                    <th className="px-5 py-3 text-left font-medium text-[#d2b06f]">Nooterra</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.03]">
                  {[
                    ["Guardrails", "None", "DIY", "Rigid rules", "canDo / askFirst / neverDo"],
                    ["Approvals", "None", "Build it", "Limited", "Built-in, multi-channel"],
                    ["Audit trail", "None", "Custom", "Partial", "Every action, automatic"],
                    ["AI provider", "Locked", "Your choice", "Their choice", "Any, swappable"],
                    ["Runs 24/7", "No", "If you build infra", "Yes", "Daemon mode"],
                    ["Setup", "Minutes", "Weeks", "Hours", "Minutes"]
                  ].map(([feature, ...cols]) => (
                    <tr key={feature}>
                      <td className="px-5 py-3 font-medium text-stone-300">{feature}</td>
                      {cols.map((val, i) => (
                        <td key={i} className={`px-5 py-3 ${i === 3 ? "text-[#d2b06f]" : "text-stone-600"}`}>{val}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Templates */}
      <section className="border-t border-white/[0.04]">
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
          <FadeIn>
            <h2 className="text-2xl tracking-[-0.01em] text-stone-200 md:text-3xl">
              Start with a template.
            </h2>
            <p className="mt-3 text-[15px] text-stone-500">Or describe anything and Nooterra builds the charter for you.</p>
          </FadeIn>
          <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { title: "Customer Support", desc: "Triage tickets, draft responses, escalate edge cases." },
              { title: "Data Monitor", desc: "Watch websites, detect changes, alert on Slack." },
              { title: "Sales Researcher", desc: "Find leads, enrich data, draft personalized outreach." },
              { title: "Competitor Tracker", desc: "Monitor pricing, features, and announcements." },
              { title: "Content Moderator", desc: "Review submissions, flag violations, approve or reject." },
              { title: "Invoice Processor", desc: "Extract data, match POs, route for approval." }
            ].map((item, i) => (
              <FadeIn key={item.title} delay={i * 0.04}>
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-5 transition-colors duration-150 hover:border-white/[0.1]">
                  <h3 className="text-[14px] font-medium text-stone-300">{item.title}</h3>
                  <p className="mt-1.5 text-[13px] text-stone-600">{item.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* Providers */}
      <section className="border-t border-white/[0.04]">
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
          <FadeIn>
            <h2 className="text-2xl tracking-[-0.01em] text-stone-200 md:text-3xl">
              Works with every major AI.
            </h2>
            <p className="mt-3 text-[15px] text-stone-500">Your keys. Your choice. Switch providers without changing your workers.</p>
          </FadeIn>
          <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { name: "OpenAI", detail: "GPT-4o, GPT-4o-mini" },
              { name: "Anthropic", detail: "Claude Sonnet, Opus" },
              { name: "Google", detail: "Gemini Pro, Flash" },
              { name: "OpenRouter", detail: "200+ models" },
              { name: "ChatGPT", detail: "Use your subscription" },
              { name: "Groq", detail: "Fast, free tier" },
              { name: "Ollama", detail: "Local, fully private" },
              { name: "More", detail: "Any OpenAI-compatible API" }
            ].map((p, i) => (
              <FadeIn key={p.name} delay={i * 0.04}>
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 transition-colors duration-150 hover:border-white/[0.1]">
                  <span className="text-[14px] font-medium text-stone-300">{p.name}</span>
                  <p className="mt-1 text-[12px] text-stone-600">{p.detail}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-white/[0.04]">
        <div className="mx-auto max-w-6xl px-6 py-24 text-center md:py-32">
          <FadeIn>
            <h2 className="text-3xl tracking-[-0.02em] text-stone-200 md:text-4xl">
              Stop managing tasks.<br />Start managing outcomes.
            </h2>
            <p className="mx-auto mt-4 max-w-md text-[15px] text-stone-500">
              Describe the work. Deploy a worker. Stay in control.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <a href={ossLinks.repo} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-md bg-stone-100 px-5 py-2.5 text-[13px] font-medium text-stone-900 transition-all duration-150 hover:bg-white">
                Get started <ArrowRight size={14} />
              </a>
              <a href={ossLinks.repo} className="inline-flex items-center gap-2 rounded-md border border-white/[0.08] px-5 py-2.5 text-[13px] font-medium text-stone-400 transition-all duration-150 hover:border-white/[0.15] hover:text-stone-200" target="_blank" rel="noopener noreferrer">
                View on GitHub <ArrowUpRight size={14} />
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
      price: "$0",
      desc: "Run unlimited workers locally. Your keys, your data.",
      points: ["Unlimited local workers", "Any AI provider", "Full charter + guardrails", "CLI and MCP support", "Community support"],
      cta: { label: "Install free", href: ossLinks.repo },
      featured: false
    },
    {
      title: "Pro",
      price: "$29",
      period: "/month",
      desc: "Cloud workers, Slack approvals, webhooks.",
      points: ["Cloud-hosted workers", "Slack approvals", "Webhook integrations", "Activity dashboard", "Email support"],
      cta: { label: "Start Pro", href: "/support" },
      featured: true
    },
    {
      title: "Team",
      price: "$99",
      period: "/month",
      desc: "Shared dashboard, SSO, audit exports.",
      points: ["Shared worker dashboard", "Team approval workflows", "SSO and admin controls", "Audit log export", "Priority support"],
      cta: { label: "Talk to us", href: "/support" },
      featured: false
    }
  ];

  return (
    <SiteLayout>
      <section className="mx-auto max-w-6xl px-6 pb-16 pt-24 md:pt-32">
        <FadeIn>
          <h1 className="text-3xl tracking-[-0.02em] text-stone-200 md:text-4xl">
            Free to start. Scale when you need to.
          </h1>
          <p className="mt-4 max-w-xl text-[15px] text-stone-500">
            Run unlimited workers locally for free. Upgrade when you need cloud hosting or team features.
          </p>
        </FadeIn>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-20 md:pb-28">
        <div className="grid gap-4 lg:grid-cols-3">
          {tiers.map((tier, i) => (
            <FadeIn key={tier.title} delay={i * 0.06}>
              <div className={`flex h-full flex-col rounded-lg border p-6 ${
                tier.featured ? "border-[#d2b06f]/20 bg-[#d2b06f]/[0.03]" : "border-white/[0.06] bg-white/[0.02]"
              }`}>
                <p className="text-[13px] text-stone-500">{tier.title}</p>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-3xl font-medium text-stone-200">{tier.price}</span>
                  {tier.period ? <span className="text-[13px] text-stone-600">{tier.period}</span> : null}
                </div>
                <p className="mt-3 text-[13px] text-stone-500">{tier.desc}</p>
                <div className="mt-6 flex-1 space-y-2.5">
                  {tier.points.map((p) => (
                    <div key={p} className="flex items-start gap-2.5">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-stone-500" strokeWidth={2} />
                      <span className="text-[13px] text-stone-400">{p}</span>
                    </div>
                  ))}
                </div>
                <a href={tier.cta.href} className={`mt-8 inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-[13px] font-medium transition-all duration-150 ${
                  tier.featured
                    ? "bg-stone-100 text-stone-900 hover:bg-white"
                    : "border border-white/[0.08] text-stone-400 hover:border-white/[0.15] hover:text-stone-200"
                }`}>
                  {tier.cta.label} <ArrowRight size={14} />
                </a>
              </div>
            </FadeIn>
          ))}
        </div>
        <FadeIn delay={0.2}>
          <p className="mt-12 text-center text-[13px] text-stone-600">
            No lock-in. Export workers and charters anytime. Your API keys stay yours.
          </p>
        </FadeIn>
      </section>
    </SiteLayout>
  );
}

/* ─── SECURITY PAGE ─── */

function SecurityPage() {
  return (
    <SiteLayout>
      <section className="mx-auto max-w-6xl px-6 pb-16 pt-24 md:pt-32">
        <FadeIn>
          <h1 className="text-3xl tracking-[-0.02em] text-stone-200 md:text-4xl">Security</h1>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-stone-500">
            Workers cannot exceed their charter. Every action is logged. Every escalation requires human approval. Every boundary is enforced at runtime.
          </p>
        </FadeIn>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-20 md:pb-28">
        <div className="grid gap-3 md:grid-cols-2">
          {[
            { title: "Fail closed", desc: "Ambiguous situations halt execution and ask. Missing context, unclear scope, or expired approvals all stop the worker." },
            { title: "Least privilege", desc: "Workers only access tools and data explicitly granted in their charter. Nothing more." },
            { title: "Human in the loop", desc: "Consequential actions always route through human approval. The threshold is configurable per worker." },
            { title: "Full audit trail", desc: "Every action, approval, and decision logged with timestamps and context. Export anytime." }
          ].map((item, i) => (
            <FadeIn key={item.title} delay={i * 0.06}>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-6">
                <h3 className="mb-2 text-[14px] font-medium text-stone-200">{item.title}</h3>
                <p className="text-[13px] leading-relaxed text-stone-500">{item.desc}</p>
              </div>
            </FadeIn>
          ))}
        </div>
      </section>
    </SiteLayout>
  );
}

/* ─── SIMPLE PAGES ─── */

function SimplePage({ title, children }) {
  return (
    <SiteLayout>
      <section className="mx-auto max-w-6xl px-6 pb-16 pt-24 md:pt-32">
        <FadeIn>
          <h1 className="text-3xl tracking-[-0.02em] text-stone-200 md:text-4xl">{title}</h1>
        </FadeIn>
      </section>
      <section className="mx-auto max-w-6xl px-6 pb-20 md:pb-28">
        <FadeIn delay={0.06}>{children}</FadeIn>
      </section>
    </SiteLayout>
  );
}

function PrivacyPage() {
  return (
    <SimplePage title="Privacy">
      <div className="grid gap-3 md:grid-cols-3">
        {[
          { title: "Your keys, your providers", desc: "API keys are encrypted at rest and never leave your account boundary. Free tier runs entirely on your machine." },
          { title: "No training on your data", desc: "We never train models on your data. Audit logs are yours — exportable and deletable." },
          { title: "Data portability", desc: "Export workers, charters, and logs at any time. Cancel and your data is deleted within 30 days." }
        ].map((item) => (
          <div key={item.title} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-6">
            <h3 className="mb-2 text-[14px] font-medium text-stone-200">{item.title}</h3>
            <p className="text-[13px] leading-relaxed text-stone-500">{item.desc}</p>
          </div>
        ))}
      </div>
    </SimplePage>
  );
}

function TermsPage() {
  return (
    <SimplePage title="Terms">
      <div className="grid gap-3 md:grid-cols-3">
        {[
          { title: "Your workers, your responsibility", desc: "You define the charter, grant approvals, and control what workers do. Nooterra enforces the boundaries you set." },
          { title: "Fair use", desc: "Workers should perform legitimate business tasks. Do not use for spam, fraud, or harassment." },
          { title: "Service availability", desc: "Free tier runs locally with no uptime guarantee. Paid tiers include SLAs." }
        ].map((item) => (
          <div key={item.title} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-6">
            <h3 className="mb-2 text-[14px] font-medium text-stone-200">{item.title}</h3>
            <p className="text-[13px] leading-relaxed text-stone-500">{item.desc}</p>
          </div>
        ))}
      </div>
    </SimplePage>
  );
}

function SupportPage() {
  return (
    <SimplePage title="Get help">
      <div className="grid gap-3 md:grid-cols-3">
        {[
          { title: "Documentation", desc: "Guides, API reference, and troubleshooting.", href: DOCS_EXTERNAL, cta: "Open docs" },
          { title: "Discord", desc: "Ask questions and get help from the community.", href: DISCORD_HREF, cta: "Join Discord" },
          { title: "GitHub Issues", desc: "Report bugs or request features.", href: ossLinks.issues, cta: "Open issue" }
        ].map((item) => (
          <a key={item.title} href={item.href} className="block rounded-lg border border-white/[0.06] bg-white/[0.02] p-6 transition-colors duration-150 hover:border-white/[0.1]" target="_blank" rel="noopener noreferrer">
            <h3 className="mb-2 text-[14px] font-medium text-stone-200">{item.title}</h3>
            <p className="text-[13px] leading-relaxed text-stone-500">{item.desc}</p>
            <span className="mt-3 inline-flex items-center gap-1.5 text-[13px] text-stone-400">{item.cta} <ArrowUpRight size={12} /></span>
          </a>
        ))}
      </div>
    </SimplePage>
  );
}

/* ─── STATUS PAGE ─── */

const PUBLIC_STATUS_CHECKS = Object.freeze([
  { id: "home", label: "Homepage", path: "/", type: "html", needle: "consequential" },
  { id: "pricing", label: "Pricing", path: "/pricing", type: "html", needle: "Free to start" }
]);

function normalizeStatusPathname(value) {
  if (typeof window === "undefined") return "";
  try { return new URL(String(value ?? "/"), window.location.origin).pathname || "/"; } catch { return ""; }
}

async function probePublicHtmlRoute(check, { timeoutMs = 8000, intervalMs = 250 } = {}) {
  if (typeof window === "undefined" || !window.document?.body) {
    return { ...check, status: "unavailable", statusLabel: "Unavailable", detail: "Requires browser" };
  }
  return new Promise((resolve) => {
    const iframe = window.document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.tabIndex = -1;
    Object.assign(iframe.style, { position: "fixed", width: "1px", height: "1px", opacity: "0", pointerEvents: "none", border: "0" });
    const expectedPathname = normalizeStatusPathname(check.path);
    let settled = false, intervalId = null, timeoutId = null, lastState = {};
    const cleanup = () => { if (intervalId) clearInterval(intervalId); if (timeoutId) clearTimeout(timeoutId); iframe.remove(); };
    const finish = (result) => { if (settled) return; settled = true; cleanup(); resolve({ ...check, ...result }); };
    const readState = () => {
      try {
        const fd = iframe.contentDocument;
        lastState = { pathname: iframe.contentWindow?.location?.pathname ?? "", text: fd?.body?.innerText ?? "", ready: fd?.readyState ?? "" };
        if (lastState.ready === "complete" && (!expectedPathname || lastState.pathname === expectedPathname) && (!check.needle || lastState.text.includes(check.needle))) {
          finish({ status: "ok", statusLabel: "Operational" });
        }
      } catch (e) { finish({ status: "unavailable", statusLabel: "Unavailable" }); }
    };
    iframe.addEventListener("load", () => { readState(); if (!settled) intervalId = setInterval(readState, intervalMs); });
    timeoutId = setTimeout(() => finish({ status: "degraded", statusLabel: "Degraded" }), timeoutMs);
    document.body.append(iframe);
    iframe.src = check.path;
  });
}

function StatusPage() {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState({ loading: true, checks: [] });

  useEffect(() => {
    let c = false;
    (async () => {
      setState(p => ({ ...p, loading: true }));
      const checks = await Promise.all(PUBLIC_STATUS_CHECKS.map(probePublicHtmlRoute));
      if (!c) setState({ loading: false, checks, at: new Date().toISOString() });
    })();
    return () => { c = true; };
  }, [nonce]);

  const allOk = state.checks.every(c => c.status === "ok");

  return (
    <SimplePage title="Status">
      <div className="flex items-center gap-3 mb-8">
        <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] uppercase tracking-wider ${
          state.loading ? "border-white/[0.06] text-stone-500" : allOk ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400" : "border-amber-500/20 bg-amber-500/10 text-amber-400"
        }`}>
          {state.loading ? "Checking..." : allOk ? "All systems operational" : "Degraded"}
        </span>
        <button onClick={() => setNonce(v => v + 1)} className="text-[12px] text-stone-600 hover:text-stone-400 transition-colors">
          <RotateCcw size={12} />
        </button>
      </div>
      <div className="space-y-2">
        {state.checks.map((c) => (
          <div key={c.id} className="flex items-center justify-between rounded-lg border border-white/[0.04] px-4 py-3">
            <span className="text-[13px] text-stone-300">{c.label}</span>
            <span className={`text-[11px] uppercase tracking-wider ${c.status === "ok" ? "text-emerald-400" : c.status === "degraded" ? "text-amber-400" : "text-rose-400"}`}>
              {c.statusLabel}
            </span>
          </div>
        ))}
      </div>
      {state.at ? <p className="mt-4 text-[11px] text-stone-700">Checked {new Date(state.at).toLocaleString()}</p> : null}
    </SimplePage>
  );
}

/* ─── SIMPLE INFO PAGE ─── */

function SimpleInfoPage({ title, summary }) {
  return (
    <SimplePage title={title}>
      <p className="text-[15px] text-stone-500">{summary}</p>
      <div className="mt-6 flex gap-3">
        <a href="/" className="inline-flex items-center gap-2 rounded-md bg-stone-100 px-4 py-2 text-[13px] font-medium text-stone-900">Go home <ArrowRight size={14} /></a>
        <a href="/support" className="inline-flex items-center gap-2 rounded-md border border-white/[0.08] px-4 py-2 text-[13px] text-stone-400">Get help</a>
      </div>
    </SimplePage>
  );
}

/* ─── MAIN EXPORT ─── */

export default function LovableSite({ mode = "home" }) {
  if (mode === "pricing") return <PricingPage />;
  if (mode === "status") return <StatusPage />;
  if (mode === "security") return <SecurityPage />;
  if (mode === "privacy") return <PrivacyPage />;
  if (mode === "terms") return <TermsPage />;
  if (mode === "support") return <SupportPage />;

  // Killed pages → redirect to home
  if (mode === "product" || mode === "demo" || mode === "developers" || mode === "integrations") return <HomePage />;

  // Docs → external
  if (typeof mode === "string" && mode.startsWith("docs")) {
    if (typeof window !== "undefined") window.location.replace(DOCS_EXTERNAL);
    return null;
  }

  // Onboarding redirects
  if (mode === "onboarding") {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("experience") === "app") { window.location.replace(MANAGED_ONBOARDING_HREF); return null; }
    }
    return <HomePage />;
  }

  // Error pages
  if (mode === "expired") return <SimpleInfoPage title="This link has expired." summary="The approval window closed. Return home to start a new request." />;
  if (mode === "revoked") return <SimpleInfoPage title="This authority was revoked." summary="The grant is no longer valid. Contact support if this is unexpected." />;
  if (mode === "verification_failed") return <SimpleInfoPage title="Verification failed." summary="The action could not be verified. Check your activity feed or contact support." />;
  if (mode === "unsupported_host") return <SimpleInfoPage title="Host not supported." summary="Nooterra currently supports CLI, MCP, and REST API." />;

  // Trust entries → home
  if (mode === "wallet" || mode === "approvals" || mode === "receipts" || mode === "disputes") return <HomePage />;

  return <HomePage />;
}
