import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Clock,
  FileCheck,
  Lock,
  Menu,
  RotateCcw,
  Shield,
  X
} from "lucide-react";

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
            href="/developers"
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
              href="/developers"
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
              <span className="block text-sm text-stone-300">API Reference</span>
              <span className="block text-sm text-stone-300">Status</span>
            </div>
          </div>
          <div>
            <h4 className="mb-4 text-xs font-medium uppercase tracking-[0.24em] text-stone-500">Company</h4>
            <div className="space-y-3">
              <span className="block text-sm text-stone-300">Security</span>
              <span className="block text-sm text-stone-300">Privacy</span>
              <span className="block text-sm text-stone-300">Terms</span>
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
          <FadeIn delay={0.3}>
            <div className="mt-12 flex flex-wrap gap-4">
              <a href="/developers" className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-6 py-3 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90">
                Start integrating <ArrowRight size={16} />
              </a>
              <a href="/wallet" className="inline-flex items-center gap-2 rounded-md border border-white/15 px-6 py-3 text-sm font-medium text-stone-100 transition-all duration-200 hover:bg-white/5">
                Explore Action Wallet
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
              <a href="/wallet" className="inline-flex items-center gap-2 rounded-md border border-white/15 px-6 py-3 text-sm font-medium text-stone-100 transition-all duration-200 hover:bg-white/5">
                Explore the Wallet
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
      desc: "Manage policies, inspect receipts, and configure wallets from your terminal.",
      code: `npm install -g @nooterra/cli
nooterra auth login
nooterra wallet create --name "production-agent"
nooterra receipts list --wallet prod-agent --last 24h`
    },
    {
      id: "api",
      label: "REST API",
      desc: "Direct HTTP integration for approvals, grants, receipts, and dispute resolution.",
      code: `curl -X POST https://api.nooterra.com/v1/approve \\
  -H "Authorization: Bearer nt_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "wallet_id": "wal_abc123",
    "action": "purchase",
    "amount": 49.99,
    "currency": "USD"
  }'`
    }
  ];
  const [activeTab, setActiveTab] = useState("mcp");
  const active = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];

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
    </SiteLayout>
  );
}

function IntegrationsPage() {
  const integrations = [
    {
      name: "Claude MCP",
      desc: "Native Model Context Protocol integration. Claude gains governed authority to take real-world actions through Nooterra.",
      status: "Available"
    },
    {
      name: "OpenClaw",
      desc: "Drop-in provider for the OpenClaw agent framework. Approval, receipts, and recourse without changing execution logic.",
      status: "Available"
    },
    {
      name: "REST API",
      desc: "Direct HTTP integration for any language or framework. Full control over approval flows, receipts, and dispute resolution.",
      status: "Available"
    },
    {
      name: "CLI",
      desc: "Manage policies, inspect receipts, and configure wallets from your terminal. Scriptable and CI/CD friendly.",
      status: "Available"
    },
    {
      name: "Codex",
      desc: "Use the same Action Wallet runtime contract inside Codex and other engineering shells without rebuilding approvals or receipts.",
      status: "Available"
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
                    <a href="/developers" className="mt-6 inline-flex items-center gap-1 text-sm text-[#d2b06f] transition-colors hover:text-[#e2c994]">
                      View docs <ArrowRight size={13} />
                    </a>
                  ) : null}
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}

export default function LovableSite({ mode = "home" }) {
  if (mode === "developers") return <DevelopersPage />;
  if (mode === "integrations") return <IntegrationsPage />;
  return <HomePage />;
}
