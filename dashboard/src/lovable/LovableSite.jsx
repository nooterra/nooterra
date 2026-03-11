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

const MANAGED_ONBOARDING_HREF = "/onboarding?experience=app#identity-access";

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
    { label: "Developers", href: "/developers" },
    { label: "Wallet", href: "/wallet" },
    { label: "Approvals", href: "/approvals" },
    { label: "Receipts", href: "/receipts" },
    { label: "Disputes", href: "/disputes" },
    { label: "Integrations", href: "/integrations" }
  ];

  return (
    <nav className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-[#080b10]/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6 lg:px-8">
        <a href="/" className="flex items-center gap-2 group">
          <span className="text-xl tracking-tight text-stone-100 transition-colors duration-300 group-hover:text-[#d2b06f]" style={{ fontFamily: "var(--lovable-font-serif)" }}>
            Nooterra
          </span>
        </a>

        <div className="hidden items-center gap-8 lg:flex">
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

        <div className="hidden lg:block">
            <a
            href={MANAGED_ONBOARDING_HREF}
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
              href={MANAGED_ONBOARDING_HREF}
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
              Delegated authority infrastructure for AI agents.
            </p>
          </div>
          <div>
            <h4 className="mb-4 text-xs font-medium uppercase tracking-[0.24em] text-stone-500">Product</h4>
            <div className="space-y-3">
              <a href="/wallet" className="block text-sm text-stone-300 transition-colors hover:text-stone-100">Action Wallet</a>
              <a href="/approvals" className="block text-sm text-stone-300 transition-colors hover:text-stone-100">Approvals</a>
              <a href="/receipts" className="block text-sm text-stone-300 transition-colors hover:text-stone-100">Receipts</a>
              <a href="/disputes" className="block text-sm text-stone-300 transition-colors hover:text-stone-100">Disputes</a>
            </div>
          </div>
          <div>
            <h4 className="mb-4 text-xs font-medium uppercase tracking-[0.24em] text-stone-500">Developers</h4>
            <div className="space-y-3">
              <a href="/developers" className="block text-sm text-stone-300 transition-colors hover:text-stone-100">Documentation</a>
              <a href="/integrations" className="block text-sm text-stone-300 transition-colors hover:text-stone-100">Integrations</a>
              <a href={docsLinks.api} className="block text-sm text-stone-300 transition-colors hover:text-stone-100">API Reference</a>
              <a href={docsLinks.designPartnerKit} className="block text-sm text-stone-300 transition-colors hover:text-stone-100">Partner kit</a>
              <a href={ossLinks.repo} className="block text-sm text-stone-300 transition-colors hover:text-stone-100">GitHub</a>
            </div>
          </div>
          <div>
            <h4 className="mb-4 text-xs font-medium uppercase tracking-[0.24em] text-stone-500">Company</h4>
            <div className="space-y-3">
              <a href={docsLinks.security} className="block text-sm text-stone-300 transition-colors hover:text-stone-100">Security</a>
              <a href={docsLinks.ops} className="block text-sm text-stone-300 transition-colors hover:text-stone-100">Operations</a>
              <a href={docsLinks.launchChecklist} className="block text-sm text-stone-300 transition-colors hover:text-stone-100">Launch checklist</a>
              <a href={ossLinks.issues} className="block text-sm text-stone-300 transition-colors hover:text-stone-100">Support</a>
            </div>
          </div>
        </div>
        <div className="mt-16 flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-8 md:flex-row">
          <p className="text-xs text-stone-500">© 2026 Nooterra. All rights reserved.</p>
          <p className="text-xs text-stone-500">Trust infrastructure for autonomous systems.</p>
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

function HomePage() {
  return (
    <SiteLayout>
      <section className="relative flex min-h-[90vh] items-center overflow-hidden">
        <div className="lovable-grid absolute inset-0 opacity-[0.03]" />
        <div className="lovable-orb lovable-orb-a" />
        <div className="lovable-orb lovable-orb-b" />
        <div className="relative mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <FadeIn>
            <p className="mb-8 text-sm uppercase tracking-[0.2em] text-stone-500">Delegated authority infrastructure</p>
          </FadeIn>
          <FadeIn delay={0.1}>
            <h1
              className="max-w-5xl text-balance text-5xl leading-[0.95] tracking-tight text-stone-100 sm:text-6xl md:text-7xl lg:text-8xl xl:text-[6.5rem]"
              style={{ fontFamily: "var(--lovable-font-serif)" }}
            >
              Let AI act.
              <br />
              <span className="text-[#d2b06f]">Keep control.</span>
            </h1>
          </FadeIn>
          <FadeIn delay={0.2}>
            <p className="mt-8 max-w-xl text-lg leading-relaxed text-stone-400 md:text-xl">
              Nooterra sits between agent intent and external action. Approve before it happens. Prove after it does.
            </p>
          </FadeIn>
          <FadeIn delay={0.24}>
            <div className="mt-6 flex flex-wrap gap-2">
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-stone-300">Launch actions: buy + cancel/recover</span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-stone-300">Launch hosts: Claude MCP + OpenClaw</span>
            </div>
          </FadeIn>
          <FadeIn delay={0.3}>
            <div className="mt-12 flex flex-wrap gap-4">
              <a href={MANAGED_ONBOARDING_HREF} className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-6 py-3 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90">
                Get started <ArrowRight size={16} />
              </a>
              <a href="/developers" className="inline-flex items-center gap-2 rounded-md border border-white/15 px-6 py-3 text-sm font-medium text-stone-100 transition-all duration-200 hover:bg-white/5">
                Explore developer toolkit
              </a>
            </div>
          </FadeIn>
        </div>
      </section>

      <section className="border-t border-white/10">
        <div className="mx-auto grid max-w-7xl items-start gap-16 px-6 py-24 lg:grid-cols-2 lg:gap-24 lg:px-8 lg:py-32">
          <FadeIn>
            <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">What is Nooterra</p>
            <h2 className="text-3xl leading-tight text-stone-100 md:text-4xl lg:text-5xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
              The control layer for
              <br />
              <em className="not-italic text-[#d2b06f]">consequential</em> AI actions.
            </h2>
          </FadeIn>
          <FadeIn delay={0.15}>
            <div className="space-y-6 leading-relaxed text-stone-300">
              <p className="text-lg">
                AI agents want to do things in the real world. Buy products. Cancel subscriptions. Move money. These actions have consequences.
              </p>
              <p>
                Nooterra is the governance layer that decides what an AI system may do, under what conditions, with what approvals, and with what audit trail.
              </p>
              <p className="text-stone-500">
                Host-first architecture. Nooterra lives inside AI hosts and only appears when trust, approval, proof, or recourse is needed.
              </p>
            </div>
          </FadeIn>
        </div>
      </section>

      <section className="border-t border-white/10 bg-[#0b0f14]">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <FadeIn>
            <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">How it works</p>
            <h2 className="mb-16 text-3xl text-stone-100 md:text-4xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>Four primitives. Nothing more.</h2>
          </FadeIn>
          <div className="overflow-hidden rounded-lg bg-white/10 lg:grid lg:grid-cols-4 lg:gap-px">
            {[
              {
                icon: Shield,
                step: "01",
                title: "Approve",
                desc: "Agent requests action. Policy evaluates. Human or deterministic approval grants scoped authority."
              },
              {
                icon: FileCheck,
                step: "02",
                title: "Execute",
                desc: "Scoped grant authorizes external action. Nooterra governs permission. External systems execute."
              },
              {
                icon: FileCheck,
                step: "03",
                title: "Receipt",
                desc: "Cryptographic proof of what happened. Immutable record. Attached to the action, not the system."
              },
              {
                icon: RotateCcw,
                step: "04",
                title: "Recourse",
                desc: "Something wrong? Dispute it. Cancel it. Recover. Fail-closed by default. Always a path back."
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
              <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">Launch scope</p>
              <h2 className="mb-6 text-3xl text-stone-100 md:text-4xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                Small product.
                <br />
                Sharp boundaries.
              </h2>
              <p className="leading-relaxed text-stone-400">
                The first release is intentionally narrow. Buy plus cancel/recover with strong policy boundaries. We ship less so it works completely.
              </p>
            </FadeIn>
          </div>
          <div className="lg:col-span-3">
            <div className="grid gap-6 sm:grid-cols-2">
              <FadeIn delay={0.1}>
                <div className="rounded-lg border border-white/10 bg-[#11161e] p-6">
                  <div className="mb-3 flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-emerald-400" />
                    <span className="text-xs font-medium uppercase tracking-wider text-emerald-400">Ships now</span>
                  </div>
                  <ul className="space-y-2.5 text-sm text-stone-300">
                    <li>Action Wallet</li>
                    <li>Purchase approval flow</li>
                    <li>Cancellation + recovery</li>
                    <li>Cryptographic receipts</li>
                    <li>Dispute initiation</li>
                    <li>Deterministic policy engine</li>
                  </ul>
                </div>
              </FadeIn>
              <FadeIn delay={0.2}>
                <div className="rounded-lg border border-white/10 bg-[#11161e] p-6">
                  <div className="mb-3 flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-stone-500" />
                    <span className="text-xs font-medium uppercase tracking-wider text-stone-500">Not yet</span>
                  </div>
                  <ul className="space-y-2.5 text-sm text-stone-400">
                    <li>Multi-party workflows</li>
                    <li>Payment rail</li>
                    <li>Agent-to-agent delegation</li>
                    <li>Custom policy DSL</li>
                    <li>Compliance frameworks</li>
                    <li>Enterprise SSO</li>
                  </ul>
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
              Ready to govern
              <br />
              <span className="text-[#d2b06f]">AI actions?</span>
            </h2>
            <p className="mx-auto mb-10 max-w-md text-stone-400">
              Integrate Nooterra in minutes. Claude MCP, OpenClaw, CLI, or raw API.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <a href="/developers" className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-6 py-3 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90">
                View documentation <ArrowRight size={16} />
              </a>
              <a href={MANAGED_ONBOARDING_HREF} className="inline-flex items-center gap-2 rounded-md border border-white/15 px-6 py-3 text-sm font-medium text-stone-100 transition-all duration-200 hover:bg-white/5">
                Set up Action Wallet
              </a>
            </div>
          </FadeIn>
        </div>
      </section>
    </SiteLayout>
  );
}

function DevelopersPage() {
  const tabs = [
    {
      id: "mcp",
      label: "Claude MCP",
      desc: "Integrate Nooterra as a Model Context Protocol server. Claude gains governed authority to take real-world actions.",
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
      desc: "Drop-in OpenClaw provider. Your framework gets approvals, receipts, and recourse without changing execution logic.",
      docsHref: docsLinks.openClawQuickstart,
      docsLabel: "OpenClaw quickstart",
      code: `import { NooterraClaw } from "@nooterra/openclaw";

const claw = new NooterraClaw({
  apiKey: process.env.NOOTERRA_API_KEY,
});

const result = await claw.execute({
  action: "purchase",
  amount: 49.99,
  currency: "USD",
  vendor: "example.com",
});`
    },
    {
      id: "cli",
      label: "CLI",
      desc: "Run the managed onboarding loop from your terminal and keep approvals, receipts, and disputes on the hosted Nooterra surfaces.",
      docsHref: docsLinks.codexEngineeringQuickstart,
      docsLabel: "CLI / Codex guide",
      code: `# Reuse an existing workspace
NOOTERRA_TENANT_ID=tenant_example \\
npm run quickstart:action-wallet:first-approval

# Or create one on the fly
NOOTERRA_SIGNUP_EMAIL=founder@example.com \\
NOOTERRA_SIGNUP_COMPANY="Nooterra" \\
NOOTERRA_SIGNUP_NAME="Founding User" \\
npm run quickstart:action-wallet:first-approval`
    },
    {
      id: "api",
      label: "REST API",
      desc: "Direct HTTP integration for the same runtime contract used by Claude MCP, OpenClaw, Codex, and CLI.",
      docsHref: docsLinks.api,
      docsLabel: "API reference",
      code: `# Open one hosted approval through the onboarding path
curl -X POST https://api.nooterra.work/v1/tenants/$NOOTERRA_TENANT_ID/onboarding/seed-hosted-approval \\
  -H "Authorization: Bearer $NOOTERRA_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "hostTrack": "codex"
  }'

# Then close the same governed loop with one receipt
curl -X POST https://api.nooterra.work/v1/tenants/$NOOTERRA_TENANT_ID/onboarding/first-paid-call \\
  -H "Authorization: Bearer $NOOTERRA_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{}'`
    }
  ];
  const [activeTab, setActiveTab] = useState("mcp");
  const active = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];
  const firstActionTracks = {
    mcp: {
      title: "First governed action",
      body: "Install the MCP server, ask Claude for one action that must ask first, then confirm the request lands on the hosted approvals page.",
      success: "What good looks like: the same run later binds to a receipt, not a shell-only success message."
    },
    openclaw: {
      title: "First governed action",
      body: "Package OpenClaw against the same runtime, trigger one approval-required action, and keep the decision on Nooterra’s hosted approval surface.",
      success: "What good looks like: approval, receipt, and dispute all stay on the same runtime contract as the Claude path."
    },
    cli: {
      title: "First governed action",
      body: "Bootstrap one workspace, seed one hosted approval, and let the terminal print the exact approval URL, run id, and receipt URL instead of improvising shell-only UX.",
      success: "What good looks like: the terminal proves the same approval and receipt contract as the hosted product, with no local-only success path."
    },
    api: {
      title: "First governed action",
      body: "Use the managed onboarding endpoints first, not a bespoke action prototype. Open approval from the API, then close the same run with a receipt and dispute trail.",
      success: "What good looks like: one API path reaches hosted approval, one managed call issues the receipt, and recourse stays linked to the same tenant."
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
              Integrate trust in minutes.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-stone-400">
              Four integration paths. Same governance primitives. Choose your entry point.
            </p>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-stone-500">
              Launch certification is narrower than the docs surface. Claude MCP and OpenClaw are the certified launch hosts; Codex, CLI, and direct API reuse the same runtime contract as engineering shells.
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
                  <a href={MANAGED_ONBOARDING_HREF} className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-5 py-2.5 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90">
                    Create workspace <ArrowRight size={16} />
                  </a>
                  <a href={active.docsHref} className="inline-flex items-center gap-2 rounded-md border border-white/15 px-5 py-2.5 text-sm font-medium text-stone-100 transition-all duration-200 hover:bg-white/5">
                    {active.docsLabel} <ArrowUpRight size={15} />
                  </a>
                  <a href={docsLinks.designPartnerKit} className="inline-flex items-center gap-2 rounded-md border border-white/15 px-5 py-2.5 text-sm font-medium text-stone-100 transition-all duration-200 hover:bg-white/5">
                    Partner kit <ArrowUpRight size={15} />
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
                  Issue a real wallet.
                </h2>
                <p className="mt-4 max-w-2xl text-stone-400">
                  Use onboarding to create the workspace identity, API key, and hosted approval surface. You do not need a bloated account setup flow. You need one controlled runtime.
                </p>
              </div>
              <div className="flex flex-wrap gap-4">
                <a href={MANAGED_ONBOARDING_HREF} className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-6 py-3 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90">
                  Open onboarding <ArrowRight size={16} />
                </a>
                <a href={docsLinks.hostQuickstart} className="inline-flex items-center gap-2 rounded-md border border-white/15 px-6 py-3 text-sm font-medium text-stone-100 transition-all duration-200 hover:bg-white/5">
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
  const integrations = [
    {
      name: "Claude MCP",
      desc: "Native Model Context Protocol integration. Claude gains governed authority to take real-world actions through Nooterra.",
      status: "Available",
      href: docsLinks.claudeDesktopQuickstart,
      ctaLabel: "Claude quickstart"
    },
    {
      name: "OpenClaw",
      desc: "Drop-in provider for the OpenClaw agent framework. Approval, receipts, and recourse without changing execution logic.",
      status: "Available",
      href: docsLinks.openClawQuickstart,
      ctaLabel: "OpenClaw guide"
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
      desc: "Manage policies, inspect receipts, and configure wallets from your terminal. Scriptable and CI/CD friendly.",
      status: "Available",
      href: docsLinks.codexEngineeringQuickstart,
      ctaLabel: "CLI guide"
    },
    {
      name: "Codex",
      desc: "Use the same Action Wallet runtime contract inside Codex and other engineering shells without rebuilding approvals or receipts.",
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
              Connects where
              <br />
              <span className="text-[#d2b06f]">agents live.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-stone-400">
              Nooterra is host-first. It integrates into existing agent infrastructure, not the other way around.
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
                  title: "Install one host",
                  body: "Claude MCP, OpenClaw, Codex, or raw API. Do not widen the launch surface before one path is boring."
                },
                {
                  title: "Reach hosted approval",
                  body: "The first real proof point is not setup. It is a live decision opening on the Nooterra approval surface."
                },
                {
                  title: "Close with receipt",
                  body: "A successful integration ends with a receipt and recourse trail, not just a green terminal line."
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
                The production launch surface is intentionally narrow. Ship the two working actions, the two working hosts, and the same approval, receipt, and dispute loop everywhere else.
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
                  Same runtime. Every host.
                </h2>
                <p className="mt-4 max-w-2xl text-stone-400">
                  Claude, OpenClaw, Codex, CLI, or direct API. The integration surface changes. The trust contract does not.
                </p>
              </div>
              <div className="flex flex-wrap gap-4">
                <a href={MANAGED_ONBOARDING_HREF} className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-6 py-3 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90">
                  Set up runtime <ArrowRight size={16} />
                </a>
                <a href={docsLinks.hostQuickstart} className="inline-flex items-center gap-2 rounded-md border border-white/15 px-6 py-3 text-sm font-medium text-stone-100 transition-all duration-200 hover:bg-white/5">
                  Launch host guide <ArrowUpRight size={15} />
                </a>
                <a href={docsLinks.designPartnerKit} className="inline-flex items-center gap-2 rounded-md border border-white/15 px-6 py-3 text-sm font-medium text-stone-100 transition-all duration-200 hover:bg-white/5">
                  Partner onboarding kit <ArrowUpRight size={15} />
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
  const activationSteps = [
    {
      title: "Create the runtime identity",
      body: "Issue the workspace, operator identity, and API key that Action Wallet uses to bind approvals, receipts, and disputes."
    },
    {
      title: "Connect one host",
      body: "Start with Claude MCP, OpenClaw, Codex, CLI, or API. One host path should feel boring before you widen the surface."
    },
    {
      title: "Complete one governed action",
      body: "Open a hosted approval, finish the run, and close the loop with a receipt plus recourse instead of a shell-only success state."
    }
  ];

  const readinessCards = [
    {
      label: "Identity",
      value: "Workspace + operator",
      body: "No anonymous runtime. Every governed action starts from an issued identity and a revocable trust boundary."
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
      body: "Best first host when you want the cleanest approval handoff and the most direct proof that the runtime contract works.",
      href: docsLinks.claudeDesktopQuickstart,
      ctaLabel: "Claude quickstart"
    },
    {
      title: "OpenClaw",
      body: "Use the same Action Wallet contract inside an agent framework and keep approval, receipt, and recourse on Nooterra surfaces.",
      href: docsLinks.openClawQuickstart,
      ctaLabel: "OpenClaw guide"
    },
    {
      title: "Codex / CLI / API",
      body: "Best engineering path when you want a direct runtime integration, scripted tests, and one explicit first governed action.",
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
              <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">Onboarding</p>
              <h1 className="max-w-4xl text-4xl leading-tight text-stone-100 md:text-5xl lg:text-6xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                Issue the wallet.
                <br />
                Run the first governed action.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-relaxed text-stone-400">
                This is the shortest path from curiosity to a live Action Wallet runtime. Create the workspace, connect one host, and close the first action with approval, receipt, and recourse.
              </p>
            </FadeIn>
            <FadeIn delay={0.15}>
              <div className="mt-10 flex flex-wrap gap-4">
                <a
                  href={MANAGED_ONBOARDING_HREF}
                  className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-6 py-3 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90"
                >
                  Create workspace <ArrowRight size={16} />
                </a>
                <a
                  href={docsLinks.hostQuickstart}
                  className="inline-flex items-center gap-2 rounded-md border border-white/15 px-6 py-3 text-sm font-medium text-stone-100 transition-all duration-200 hover:bg-white/5"
                >
                  Launch host guide <ArrowUpRight size={15} />
                </a>
              </div>
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
              The onboarding flow should not dump people into a blank app shell. It should issue the runtime, point them at one host, and make the first approval and receipt path obvious.
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
                    Issuing the workspace is the only setup you should feel. It creates the identity, passkey path, and runtime boundary the live Action Wallet depends on.
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-[#0d1218] p-5">
                  <div className="flex items-center gap-3">
                    <Lock className="h-4 w-4 text-[#d2b06f]" />
                    <p className="text-sm font-medium text-stone-100">Managed auth plane</p>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-stone-400">
                    Work email, company, and operator identity. No giant admin setup before the first governed action.
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
  supportHref = docsLinks.hostQuickstart,
  supportLabel = "Launch host guide"
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
                <a href={MANAGED_ONBOARDING_HREF} className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-6 py-3 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90">
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
                  <p className="text-[11px] uppercase tracking-[0.22em] text-stone-500">Decision rail</p>
                  <h2 className="mt-2 text-2xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                    What this surface controls.
                  </h2>
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[#d2b06f]">
                  Live trust layer
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
                  Once your workspace is issued, this route becomes the live Action Wallet surface. Until then, we show the product clearly instead of dumping you into an empty shell.
                </p>
              </div>
              <a href={MANAGED_ONBOARDING_HREF} className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-6 py-3 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90">
                Create workspace <ArrowRight size={16} />
              </a>
            </div>
          </FadeIn>
        </div>
      </section>
    </SiteLayout>
  );
}

export default function LovableSite({ mode = "home" }) {
  if (mode === "developers") return <DevelopersPage />;
  if (mode === "integrations") return <IntegrationsPage />;
  if (mode === "onboarding") return <OnboardingPage />;
  if (mode === "wallet") {
    return (
      <TrustEntryPage
        eyebrow="Action Wallet"
        title="One wallet for every consequential AI action."
        summary="Set one-time approvals, remembered preferences, or durable rules. Action Wallet sits between agent intent and external consequence."
        proofTitle="Not another dashboard. The permission layer."
        proofBody="The wallet is where users define who an agent may act for, how much authority it has, when human approval is required, and how recourse works if something goes wrong."
        rail={[
          { title: "Issue authority", state: "scoped", body: "Set a one-time approval, a remembered preference, or a reusable rule with an explicit ceiling." },
          { title: "Bind a host", state: "revocable", body: "Claude, OpenClaw, Codex, CLI, or API all run through the same wallet contract instead of custom glue." },
          { title: "Carry limits forward", state: "enforced", body: "Spend caps, approvals, dispute windows, and reversibility travel with the action." }
        ]}
        bullets={[
          { title: "One-time approval first", body: "Approve a single action without building a policy system up front." },
          { title: "Remember what matters", body: "Promote repeated approvals into reusable preferences only after the user sees value." },
          { title: "Shared control later", body: "Teams can add limits, hosts, thresholds, and delegated scopes on top of the same runtime." }
        ]}
        artifactTitle="A wallet should read like an authority ledger."
        artifactBody="The live wallet is where users see active hosts, pending grants, revocations, and the exact guardrails attached to future actions. It should feel closer to a cap table for machine authority than a typical settings page."
        artifactStats={[
          { label: "Authority", value: "One-time, remembered, durable", body: "Users can start with a single permission, then graduate into stored preferences and team policy." },
          { label: "Hosts", value: "Claude, OpenClaw, Codex", body: "Every runtime uses the same grant and receipt model, so trust does not fork by host." },
          { label: "Controls", value: "Limits, revokes, windows", body: "Real constraints stay attached to actions instead of hiding in prompts or tribal knowledge." }
        ]}
        ctaLabel="Set up Action Wallet"
      />
    );
  }
  if (mode === "approvals") {
    return (
      <TrustEntryPage
        eyebrow="Approvals"
        title="Know exactly what you are approving."
        summary="An agent asks to do something real. Nooterra shows the consequence, the limit, and the reason review is required before any authority is granted."
        proofTitle="Approval should answer the important questions fast."
        proofBody="Before someone clicks approve, they should understand what will happen, what it may cost, what proof is expected afterward, and whether the permission applies once or can be remembered later."
        rail={[
          { title: "See the consequence", state: "clear", body: "The page should show the exact action, vendor or domain, amount, and host before any authority is granted." },
          { title: "Grant only this scope", state: "durable", body: "Approve once, deny, or save a bounded rule. The result is a grant with real limits, not a vague yes." },
          { title: "Resume only if state still matches", state: "gated", body: "The host resumes only when approval, expiry, and evidence requirements still line up." }
        ]}
        bullets={[
          { title: "Plain language first", body: "People should not need operator jargon to understand what the agent wants permission to do." },
          { title: "One-time before durable", body: "Users can approve a single action first, then turn repeated decisions into remembered rules later." },
          { title: "Fail closed", body: "Missing context, missing evidence, or mismatched scope means the action does not proceed." }
        ]}
        artifactTitle="Approval is the handoff between autonomy and authority."
        artifactBody="This page should behave like a serious sign-off surface. It explains the action, the cost or consequence, whether the decision is one-time or repeatable, and what the user will be able to challenge later if the outcome looks wrong."
        artifactStats={[
          { label: "Decisioning", value: "Approve, ask, block", body: "The user sees whether this action can proceed now, needs review, or is stopped outright." },
          { label: "Binding", value: "Scope + expiry + proof", body: "Approval creates a scoped grant with a real time window and explicit evidence expectations." },
          { label: "Posture", value: "Fail closed", body: "If state drifts or proof is missing, the action stops instead of silently succeeding." }
        ]}
        ctaLabel="Open approval flow"
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
        proofBody="If an agent buys, cancels, or recovers something real, users need one place to confirm the final amount, the evidence returned, the verifier outcome, and whether recourse is still available."
        rail={[
          { title: "Show what happened", state: "canonical", body: "Intent, approval, grant, execution, and amount all resolve to the same record." },
          { title: "Show why it is trusted", state: "deterministic", body: "The verifier outcome and evidence trail should be visible without opening raw payloads." },
          { title: "Keep recourse close", state: "actionable", body: "If something looks wrong, the user should be one click away from the dispute path." }
        ]}
        bullets={[
          { title: "Bound to the action", body: "Approval, grant, evidence, amount, and final state remain attached to the same run." },
          { title: "Readable by humans", body: "Users should understand the outcome in seconds, not by reverse engineering logs." },
          { title: "Actionable after the fact", body: "Receipts are not dead history. They are where disputes, refunds, and reversal begin." }
        ]}
        artifactTitle="Receipts are where AI actions become understandable."
        artifactBody="The live receipt vault should make it obvious what happened, why the runtime trusted it, what proof came back, and whether the recourse window is still open. That is the trust surface users come back to later."
        artifactStats={[
          { label: "Artifact chain", value: "Intent -> grant -> evidence", body: "Each completed action can be reconstructed without chasing logs across systems." },
          { label: "Human legibility", value: "Outcome, proof, amount", body: "The receipt should answer the questions users actually have after an action completes." },
          { label: "Recourse", value: "Refunds, disputes, reversals", body: "Receipts are live records with follow-on rights, not inert history." }
        ]}
        ctaLabel="Issue first receipt"
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
        proofBody="People will not trust agents with consequential actions unless they know how to challenge a bad result, when that challenge window closes, and what happens after they open it."
        rail={[
          { title: "Start from the receipt", state: "bound", body: "Every dispute begins from the exact record that shows the action happened." },
          { title: "State the issue clearly", state: "recoverable", body: "Users should know what to submit, what evidence helps, and what kind of review to expect." },
          { title: "Resolve without losing the trail", state: "audited", body: "Refunds, reversals, and operator interventions stay attached to the same record." }
        ]}
        bullets={[
          { title: "Clear timing", body: "The product should say whether the dispute window is open, closed, or already in progress." },
          { title: "Operator-backed", body: "Refund, resolve, revoke, and quarantine all sit behind the same rescue path." },
          { title: "Designed for consequence", body: "The product assumes some actions will go wrong and treats recourse as first-class infrastructure." }
        ]}
        artifactTitle="A dispute should preserve the evidence chain, not break it."
        artifactBody="Users need a visible route from receipt to challenge to resolution, including timing expectations and likely next steps. Operators need enough state to unwind a bad action without losing the underlying artifacts, verifier verdicts, or host context."
        artifactStats={[
          { label: "Entry point", value: "Receipt-linked", body: "The challenge begins from the same artifact chain that authorized and finalized the action." },
          { label: "Operator tools", value: "Refund, revoke, quarantine", body: "Real recourse requires real interventions, not just a support form." },
          { label: "Outcome", value: "Resolved with lineage", body: "The resolution becomes part of the permanent history of that run." }
        ]}
        ctaLabel="Set up recourse"
      />
    );
  }
  return <HomePage />;
}
