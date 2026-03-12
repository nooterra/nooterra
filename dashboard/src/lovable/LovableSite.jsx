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
const PRODUCT_ONBOARDING_HREF = "/onboarding?experience=app&source=product#identity-access";
const PRICING_ONBOARDING_HREF = "/onboarding?experience=app&source=pricing#identity-access";
const SITE_DOC_ROUTES = {
  home: "/docs",
  quickstart: "/docs/quickstart",
  architecture: "/docs/architecture",
  integrations: "/docs/integrations",
  api: "/docs/api",
  security: "/docs/security",
  ops: "/docs/ops",
  hostQuickstart: "/docs/launch-hosts",
  designPartnerKit: "/docs/partner-kit",
  launchChecklist: "/docs/launch-checklist",
  incidents: "/docs/incidents",
  support: "/support"
};

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
    { label: "Pricing", href: "/pricing" },
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
              The operating account for AI agents.
            </p>
          </div>
          <div>
            <h4 className="mb-4 text-xs font-medium uppercase tracking-[0.24em] text-stone-500">Product</h4>
            <div className="space-y-3">
              <a href="/product" className="block text-sm text-stone-300 transition-colors hover:text-stone-100">Overview</a>
              <a href="/pricing" className="block text-sm text-stone-300 transition-colors hover:text-stone-100">Pricing</a>
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
              <a href="/docs/api" className="block text-sm text-stone-300 transition-colors hover:text-stone-100">API Reference</a>
              <a href={SITE_DOC_ROUTES.designPartnerKit} className="block text-sm text-stone-300 transition-colors hover:text-stone-100">Partner kit</a>
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
          <p className="text-xs text-stone-500">Authority, approvals, receipts, and recourse for machine action.</p>
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
            <p className="mb-8 text-sm uppercase tracking-[0.2em] text-stone-500">Action Wallet</p>
          </FadeIn>
          <FadeIn delay={0.1}>
            <h1
              className="max-w-5xl text-balance text-5xl leading-[0.95] tracking-tight text-stone-100 sm:text-6xl md:text-7xl lg:text-8xl xl:text-[6.5rem]"
              style={{ fontFamily: "var(--lovable-font-serif)" }}
            >
              Give agents wallets,
              <br />
              <span className="text-[#d2b06f]">not unchecked permissions.</span>
            </h1>
          </FadeIn>
          <FadeIn delay={0.2}>
            <p className="mt-8 max-w-2xl text-lg leading-relaxed text-stone-400 md:text-xl">
              Nooterra gives AI agents operating accounts for real-world action. Set limits, ask for approval when it matters, and end every consequential action with a readable receipt.
            </p>
          </FadeIn>
          <FadeIn delay={0.24}>
            <div className="mt-6 flex flex-wrap gap-2">
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-stone-300">For builders, finance, and operators</span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-stone-300">Start with buy + cancel/recover</span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-stone-300">Claude MCP + OpenClaw first</span>
            </div>
          </FadeIn>
          <FadeIn delay={0.3}>
            <div className="mt-12 flex flex-wrap gap-4">
              <a href={MANAGED_ONBOARDING_HREF} className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-6 py-3 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90">
                Create your first Action Wallet <ArrowRight size={16} />
              </a>
              <a href="/product" className="inline-flex items-center gap-2 rounded-md border border-white/15 px-6 py-3 text-sm font-medium text-stone-100 transition-all duration-200 hover:bg-white/5">
                Explore the product
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
              The operating account
              <br />
              <em className="not-italic text-[#d2b06f]">for AI agents.</em>
            </h2>
          </FadeIn>
          <FadeIn delay={0.15}>
            <div className="space-y-6 leading-relaxed text-stone-300">
              <p className="text-lg">
                An agent wants to buy something, cancel something, issue a refund, or change a system. That is where most AI products stop being fun and start becoming risky.
              </p>
              <p>
                Nooterra sits between the agent and the consequence. It checks the rules, routes approval if needed, issues bounded authority, and records what actually happened.
              </p>
              <p className="text-stone-500">
                It is host-first by design. The agent stays where it already runs. Nooterra shows up when trust, proof, or recourse is needed.
              </p>
            </div>
          </FadeIn>
        </div>
      </section>

      <section className="border-t border-white/10 bg-[#0b0f14]">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <FadeIn>
            <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">How it works</p>
            <h2 className="mb-16 text-3xl text-stone-100 md:text-4xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>One clear loop, every time.</h2>
          </FadeIn>
          <div className="overflow-hidden rounded-lg bg-white/10 lg:grid lg:grid-cols-4 lg:gap-px">
            {[
              {
                icon: Shield,
                step: "01",
                title: "Request",
                desc: "The agent asks to do something real. Nooterra turns that into an explicit action request instead of a hidden tool call."
              },
              {
                icon: FileCheck,
                step: "02",
                title: "Decide",
                desc: "Rules run in code, not vibes. Approve automatically, ask a human, or block the action outright."
              },
              {
                icon: FileCheck,
                step: "03",
                title: "Act",
                desc: "If approved, Nooterra issues bounded authority and the host completes the action through the allowed path."
              },
              {
                icon: RotateCcw,
                step: "04",
                title: "Explain",
                desc: "Every important action ends with a receipt. If the result is wrong, there is a dispute and recovery path."
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
                One product.
                <br />
                <span className="text-[#d2b06f]">Three buyers.</span>
              </h2>
              <p className="leading-relaxed text-stone-400">
                Developers want one SDK call instead of rebuilding approvals and receipts. Operators want one place to intervene. Finance wants a readable record and a kill switch.
              </p>
            </FadeIn>
          </div>
          <div className="lg:col-span-3">
            <div className="mb-6 rounded-lg border border-white/10 bg-[#11161e] p-6">
              <p className="text-[11px] uppercase tracking-[0.18em] text-stone-500">Launch scope</p>
              <p className="mt-3 text-sm leading-relaxed text-stone-300">
                Start narrow and make it undeniable: <span className="text-stone-100">buy</span> and <span className="text-stone-100">cancel/recover</span> on <span className="text-stone-100">Claude MCP</span> and <span className="text-stone-100">OpenClaw</span>, with the same runtime available through API, CLI, and Codex.
              </p>
            </div>
            <div className="grid gap-6 sm:grid-cols-3">
              <FadeIn delay={0.1}>
                <div className="rounded-lg border border-white/10 bg-[#11161e] p-6">
                  <p className="text-xs font-medium uppercase tracking-wider text-[#d2b06f]">Builders</p>
                  <h3 className="mt-3 text-xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>Ship faster</h3>
                  <p className="mt-3 text-sm leading-relaxed text-stone-300">
                    Give an agent one tool for approvals, receipts, and disputes instead of building a finance and trust stack from scratch.
                  </p>
                </div>
              </FadeIn>
              <FadeIn delay={0.2}>
                <div className="rounded-lg border border-white/10 bg-[#11161e] p-6">
                  <p className="text-xs font-medium uppercase tracking-wider text-[#d2b06f]">Operators</p>
                  <h3 className="mt-3 text-xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>Stay in control</h3>
                  <p className="mt-3 text-sm leading-relaxed text-stone-300">
                    Review, revoke, refund, dispute, or freeze agent action from one place instead of chasing logs across hosts and vendors.
                  </p>
                </div>
              </FadeIn>
              <FadeIn delay={0.3}>
                <div className="rounded-lg border border-white/10 bg-[#11161e] p-6">
                  <p className="text-xs font-medium uppercase tracking-wider text-[#d2b06f]">Finance & security</p>
                  <h3 className="mt-3 text-xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>Trust the record</h3>
                  <p className="mt-3 text-sm leading-relaxed text-stone-300">
                    Every consequential action ends with a receipt, evidence trail, and recourse path that someone can actually understand later.
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
              <span className="text-[#d2b06f]">Expand from there.</span>
            </h2>
            <p className="mx-auto mb-10 max-w-xl text-stone-400">
              The first win is simple: one hosted approval, one bounded action, one receipt. After that, teams can widen authority with confidence.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <a href={MANAGED_ONBOARDING_HREF} className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-6 py-3 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90">
                Create your first Action Wallet <ArrowRight size={16} />
              </a>
              <a href="/developers" className="inline-flex items-center gap-2 rounded-md border border-white/15 px-6 py-3 text-sm font-medium text-stone-100 transition-all duration-200 hover:bg-white/5">
                Explore developers
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
                One operating account
                <br />
                <span className="text-[#d2b06f]">for every consequential agent action.</span>
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-relaxed text-stone-400">
                Action Wallet gives AI agents a clear way to ask, wait, act, and explain. Builders add one runtime. Operators keep a kill switch. Finance gets a receipt someone can read later.
              </p>
            </FadeIn>
            <FadeIn delay={0.15}>
              <div className="mt-10 flex flex-wrap gap-4">
                <a href={PRODUCT_ONBOARDING_HREF} className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-6 py-3 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90">
                  Create your first Action Wallet <ArrowRight size={16} />
                </a>
                <a href="/pricing" className="inline-flex items-center gap-2 rounded-md border border-white/15 px-6 py-3 text-sm font-medium text-stone-100 transition-all duration-200 hover:bg-white/5">
                  See pricing
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
                    Narrow scope. Real consequence.
                  </h2>
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[#d2b06f]">
                  Action Wallet v1
                </div>
              </div>
              <div className="space-y-3">
                {[
                  { title: "Actions", body: "Buy plus cancel or recover, where money and trust actually matter." },
                  { title: "Hosts", body: "Claude MCP and OpenClaw first, with the same runtime available through Codex, CLI, and API." },
                  { title: "Outcome", body: "Every important action ends in approval, receipt, and recourse instead of an invisible tool call." }
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
              Turn a risky agent action into a controlled product loop.
            </h2>
          </FadeIn>
          <div className="grid gap-5 lg:grid-cols-4">
            {[
              {
                title: "Action Wallet",
                body: "Give the agent a bounded operating account instead of naked permissions and hidden side effects."
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
              Developers want one integration point. Operators want a live control surface. Finance and security want a durable record with a clear stop button. Action Wallet is valuable because it satisfies all three at once.
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
                  Create workspace <ArrowRight size={16} />
                </a>
                <a href="/developers" className="inline-flex items-center gap-2 rounded-md border border-white/15 px-6 py-3 text-sm font-medium text-stone-100 transition-all duration-200 hover:bg-white/5">
                  Explore developers <ArrowUpRight size={15} />
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
  const tiers = [
    {
      title: "Builder",
      eyebrow: "Free",
      body: "Best for teams learning the loop, wiring hosts, and proving the product before money or live approvals matter.",
      points: [
        "Sandbox Action Wallets",
        "API, CLI, and host integrations",
        "Simulated approvals and receipts",
        "Limited live beta usage"
      ],
      cta: { label: "Start free", href: MANAGED_ONBOARDING_HREF },
      featured: false
    },
    {
      title: "Growth",
      eyebrow: "Usage-based",
      body: "Best for teams putting agents into production and paying for real governed actions instead of paying for seats first.",
      points: [
        "Live hosted approvals",
        "Receipts and disputes",
        "Wallet limits and saved rules",
        "Shared team controls"
      ],
      cta: { label: "Talk to us", href: "/support" },
      featured: true
    },
    {
      title: "Enterprise",
      eyebrow: "Custom",
      body: "Best for companies rolling out agent action across teams, systems, and operators with stronger controls and longer retention.",
      points: [
        "SSO and admin controls",
        "Advanced policy and emergency controls",
        "Audit retention and support",
        "Guided onboarding"
      ],
      cta: { label: "Book the enterprise path", href: "/support" },
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
                Free to build.
                <br />
                <span className="text-[#d2b06f]">Paid to run real governed actions.</span>
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-relaxed text-stone-400">
                The product should be cheap to try and serious in production. Teams should not pay before they have seen one approval, one receipt, and one clear reason to trust the loop.
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
                    Keep exploration cheap. Charge when trust matters.
                  </h2>
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[#d2b06f]">
                  Beta posture
                </div>
              </div>
              <div className="space-y-3">
                {[
                  { title: "Builders should get to first value fast", body: "No enterprise sales wall before the first Action Wallet works." },
                  { title: "Production usage should pay for itself", body: "Teams pay when live approvals, receipts, and recourse become part of real operations." },
                  { title: "Enterprise work deserves an enterprise path", body: "SSO, stronger controls, and guided rollout belong in a higher-trust motion." }
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
              One product. Three ways to grow into it.
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
              The first sale should feel like onboarding, not procurement theater.
            </h2>
            <p className="mt-6 max-w-2xl leading-relaxed text-stone-400">
              Builders and agent teams should be able to issue a workspace, connect one host, and prove the first approval-to-receipt loop quickly. Once the product touches real money or real operations, that same loop becomes the enterprise entry point.
            </p>
          </FadeIn>
          <div className="grid gap-4">
            {[
              { title: "Builder motion", body: "Self-serve onboarding, fast docs, and one first real action from Claude, OpenClaw, Codex, CLI, or API." },
              { title: "Operator motion", body: "Shared control surface, live approvals, and a record that makes sense to someone outside the model loop." },
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
  const tabs = [
    {
      id: "mcp",
      label: "Claude MCP",
      desc: "Give Claude one tool for real-world action. Nooterra handles the approval, receipt, and dispute loop around it.",
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
      desc: "Drop Nooterra into OpenClaw and keep the hard parts off your plate: approval routing, receipts, and recourse.",
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
      desc: "Bootstrap the runtime from your terminal and prove the same hosted approval and receipt flow without building a UI first.",
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
      desc: "Call the same runtime directly over HTTP when you want the simplest possible integration surface.",
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
              Add an Action Wallet in minutes.
            </h1>
            <p className="mt-6 max-w-2xl text-lg text-stone-400">
              Give your agent one runtime for approvals, receipts, and disputes. Pick the host or interface you already use and keep the trust layer consistent.
            </p>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-stone-500">
              Launch support is intentionally narrow: Claude MCP and OpenClaw first, with the same Action Wallet runtime available through Codex, CLI, and direct API.
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
                  <a href={SITE_DOC_ROUTES.designPartnerKit} className="inline-flex items-center gap-2 rounded-md border border-white/15 px-5 py-2.5 text-sm font-medium text-stone-100 transition-all duration-200 hover:bg-white/5">
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
                  Start with one real action.
                </h2>
                <p className="mt-4 max-w-2xl text-stone-400">
                  Use onboarding to create the workspace, issue the runtime, and run one approval-to-receipt loop. That is the bar. Everything else comes after.
                </p>
              </div>
              <div className="flex flex-wrap gap-4">
                <a href={MANAGED_ONBOARDING_HREF} className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-6 py-3 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90">
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
      desc: "Use the same Action Wallet flow inside Codex and other engineering shells without rebuilding approvals or receipts.",
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
              Connect where
              <br />
              <span className="text-[#d2b06f]">agents already run.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-lg text-stone-400">
              Nooterra is host-first by design. It fits into the shells, frameworks, and workflows teams already use instead of forcing everyone into a new destination app.
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
                  body: "Start with Claude MCP, OpenClaw, Codex, or direct API. One working host beats a wide but shaky matrix."
                },
                {
                  title: "Reach hosted approval",
                  body: "The first real proof point is not setup. It is a live approval opening on a page a user can actually review."
                },
                {
                  title: "Close with receipt",
                  body: "A successful integration ends with a readable receipt and a clear recourse trail, not just a green terminal line."
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
                Launch stays intentionally narrow: two actions, two launch hosts, one trust loop. The point is not broad compatibility. The point is a clean path from intent to receipt.
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
                  Claude, OpenClaw, Codex, CLI, or direct API. The interface changes. The Action Wallet contract does not.
                </p>
              </div>
              <div className="flex flex-wrap gap-4">
                <a href={MANAGED_ONBOARDING_HREF} className="inline-flex items-center gap-2 rounded-md bg-[#d2b06f] px-6 py-3 text-sm font-medium text-[#0b0f14] transition-all duration-200 hover:opacity-90">
                  Set up runtime <ArrowRight size={16} />
                </a>
                <a href={SITE_DOC_ROUTES.hostQuickstart} className="inline-flex items-center gap-2 rounded-md border border-white/15 px-6 py-3 text-sm font-medium text-stone-100 transition-all duration-200 hover:bg-white/5">
                  Launch host guide <ArrowUpRight size={15} />
                </a>
                <a href={SITE_DOC_ROUTES.designPartnerKit} className="inline-flex items-center gap-2 rounded-md border border-white/15 px-6 py-3 text-sm font-medium text-stone-100 transition-all duration-200 hover:bg-white/5">
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
      title: "Complete one real action",
      body: "Open a hosted approval, finish the run, and close the loop with a receipt plus recourse instead of a shell-only success state."
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
      body: "Use the same Action Wallet contract inside an agent framework and keep approval, receipt, and recourse on Nooterra surfaces.",
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
              <p className="mb-4 text-xs uppercase tracking-[0.2em] text-stone-500">Onboarding</p>
              <h1 className="max-w-4xl text-4xl leading-tight text-stone-100 md:text-5xl lg:text-6xl" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                Create the account.
                <br />
                Run the first action.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-relaxed text-stone-400">
                This is the shortest path from curiosity to a live Action Wallet. Create the workspace, connect one host, and close the first loop with approval, receipt, and recourse.
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
                  href={SITE_DOC_ROUTES.hostQuickstart}
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
              The onboarding flow should not dump people into a blank shell. It should create the account, point them at one host, and make the first approval and receipt path obvious.
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
                    This is the only setup users should really feel. It creates the identity, sign-in path, and runtime boundary the live product depends on.
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-[#0d1218] p-5">
                  <div className="flex items-center gap-3">
                    <Lock className="h-4 w-4 text-[#d2b06f]" />
                    <p className="text-sm font-medium text-stone-100">Managed auth plane</p>
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
  supportHref = SITE_DOC_ROUTES.hostQuickstart,
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
                  <p className="text-[11px] uppercase tracking-[0.22em] text-stone-500">Why this page exists</p>
                  <h2 className="mt-2 text-2xl text-stone-100" style={{ fontFamily: "var(--lovable-font-serif)" }}>
                    One clear route for one clear question.
                  </h2>
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[#d2b06f]">
                  First-class route
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
  if (mode === "pricing") return <PricingPage />;
  if (mode === "developers") return <DevelopersPage />;
  if (mode === "integrations") return <IntegrationsPage />;
  if (mode === "onboarding") return <OnboardingPage />;
  if (mode === "docs") {
    return (
      <ResourcePage
        eyebrow="Docs"
        title="Documentation with the website as the index, not a dead-end redirect."
        summary="Every major public route should explain itself first, then hand users into the deeper docs where the runtime details live."
        primaryCta={{ label: "Open docs home", href: docsLinks.home }}
        secondaryCta={{ label: "Quickstart", href: "/docs/quickstart" }}
        proofPoints={[
          { title: "Browse by job", body: "Quickstart, architecture, integrations, API, security, and ops each get their own route and context." },
          { title: "Keep the jump short", body: "The website explains what the doc set is for before sending users into the full reference surface." },
          { title: "Make the next click obvious", body: "Every route should present one clear primary doc path instead of a generic docs redirect." }
        ]}
        sections={[
          { eyebrow: "Start", title: "Quickstart", body: "Get from zero to your first real action with the smallest possible loop.", href: "/docs/quickstart", ctaLabel: "Open quickstart" },
          { eyebrow: "Build", title: "Architecture", body: "Understand the control plane, artifact chain, and runtime boundaries before you widen scope.", href: "/docs/architecture", ctaLabel: "View architecture" },
          { eyebrow: "Run", title: "Operations", body: "Launch checklist, cutover, incidents, and operator runbooks for real production usage.", href: "/docs/ops", ctaLabel: "Open ops docs" }
        ]}
      />
    );
  }
  if (mode === "docs_quickstart") {
    return (
      <ResourcePage
        eyebrow="Docs / Quickstart"
        title="Start with one real action, not a giant setup ritual."
        summary="The quickstart should get a builder or operator to the first approval and receipt path with the fewest moving parts possible."
        primaryCta={{ label: "Open quickstart", href: docsLinks.quickstart }}
        secondaryCta={{ label: "Create workspace", href: MANAGED_ONBOARDING_HREF }}
        proofPoints={[
          { title: "One runtime", body: "Bootstrap the workspace once, then reuse the same trust contract across hosts." },
          { title: "One live loop", body: "Install, approval, receipt, dispute. Nothing else matters until that path is boring." },
          { title: "One artifact chain", body: "The quickstart should leave users with a real approval URL and a real receipt, not a shell-only success message." }
        ]}
        sections={[
          { eyebrow: "Hosted", title: "Managed onboarding", body: "Use the public onboarding rail if you want the website to issue the runtime for you.", href: MANAGED_ONBOARDING_HREF, ctaLabel: "Start onboarding" },
          { eyebrow: "CLI", title: "Codex / CLI quickstart", body: "The fastest engineering path is still the Action Wallet first-governed-action script.", href: docsLinks.codexEngineeringQuickstart, ctaLabel: "Open engineering guide" },
          { eyebrow: "Hosts", title: "Launch host guide", body: "Pick the supported host path you want to prove first.", href: SITE_DOC_ROUTES.hostQuickstart, ctaLabel: "Open host guide" }
        ]}
      />
    );
  }
  if (mode === "docs_architecture") {
    return (
      <ResourcePage
        eyebrow="Docs / Architecture"
        title="Understand the control plane before you trust it."
        summary="Architecture should explain what Nooterra governs, what it does not, and how proofs, receipts, and recourse remain bound to each action."
        primaryCta={{ label: "Open architecture docs", href: docsLinks.architecture }}
        secondaryCta={{ label: "API surface", href: "/docs/api" }}
        proofPoints={[
          { title: "Policy, not prompts", body: "The system makes decisions through explicit rules and bounded grants, not hidden prompt state." },
          { title: "Evidence, not vibes", body: "Receipts, verifier results, and disputes are attached to the same artifact chain." },
          { title: "Recourse, not dead history", body: "The system is only trustworthy if the same run can later be challenged and unwound." }
        ]}
        sections={[
          { eyebrow: "Control plane", title: "Architecture", body: "Read the full control-plane description and artifact lineage.", href: docsLinks.architecture, ctaLabel: "View docs" },
          { eyebrow: "Reference", title: "API surface", body: "See the launch-scoped lifecycle as a real contract, not a loose set of endpoints.", href: "/docs/api", ctaLabel: "API docs" },
          { eyebrow: "Ops", title: "Launch checklist", body: "Translate the architecture into concrete launch gates and operator controls.", href: SITE_DOC_ROUTES.launchChecklist, ctaLabel: "Launch checklist" }
        ]}
      />
    );
  }
  if (mode === "docs_integrations") {
    return (
      <ResourcePage
        eyebrow="Docs / Integrations"
        title="Every channel should reuse the same trust contract."
        summary="Claude MCP, OpenClaw, Codex, CLI, and direct API should all resolve into the same approval, receipt, and dispute surfaces."
        primaryCta={{ label: "Open integrations reference", href: docsLinks.integrations }}
        secondaryCta={{ label: "Launch hosts", href: SITE_DOC_ROUTES.hostQuickstart }}
        proofPoints={[
          { title: "Host-native in front", body: "The agent experience stays inside the host until trust, proof, or recourse is needed." },
          { title: "Hosted trust surfaces", body: "Approval, wallet, receipt, and dispute stay canonical even when the initiating host changes." },
          { title: "Parity over breadth", body: "One boring first-run loop per channel matters more than a long unsupported matrix." }
        ]}
        sections={[
          { eyebrow: "Claude", title: "Claude MCP", body: "Best first host when you want the clearest approval handoff.", href: docsLinks.claudeDesktopQuickstart, ctaLabel: "Claude quickstart" },
          { eyebrow: "Framework", title: "OpenClaw", body: "Use the same Action Wallet loop inside a more agentic shell.", href: docsLinks.openClawQuickstart, ctaLabel: "OpenClaw guide" },
          { eyebrow: "Engineering", title: "Codex / CLI / API", body: "For builders who want the shortest path from install to the first real action.", href: docsLinks.codexEngineeringQuickstart, ctaLabel: "Engineering guide" }
        ]}
      />
    );
  }
  if (mode === "docs_api") {
    return (
      <ResourcePage
        eyebrow="Docs / API"
        title="The API should feel like one product, not a bag of endpoints."
        summary="Action Wallet becomes trustworthy when the lifecycle is explicit: intent, approval, grant, evidence, receipt, and dispute."
        primaryCta={{ label: "Open API reference", href: docsLinks.api }}
        secondaryCta={{ label: "Engineering guide", href: docsLinks.codexEngineeringQuickstart }}
        proofPoints={[
          { title: "Deterministic writes", body: "The contract should fail closed on missing evidence, mismatched scope, or non-JSON control-plane drift." },
          { title: "Canonical links", body: "Hosted approval, receipt, and dispute surfaces should resolve consistently from every channel." },
          { title: "Idempotent state", body: "The API should make repeated retries safe and auditable instead of ambiguous." }
        ]}
        sections={[
          { eyebrow: "Lifecycle", title: "Action Wallet v1", body: "Read the full launch-scoped lifecycle and object model.", href: docsLinks.api, ctaLabel: "View lifecycle" },
          { eyebrow: "Quickstart", title: "First real action", body: "Use the quickstart script to exercise the same API flow end to end.", href: docsLinks.codexEngineeringQuickstart, ctaLabel: "Run quickstart" },
          { eyebrow: "Ops", title: "Launch checklist", body: "See what the API must prove before you trust it in production.", href: SITE_DOC_ROUTES.launchChecklist, ctaLabel: "Open checklist" }
        ]}
      />
    );
  }
  if (mode === "docs_security") {
    return (
      <ResourcePage
        eyebrow="Docs / Security"
        title="Security should explain the boundaries, not just claim them."
        summary="Nooterra is only credible if the public docs explain fail-closed behavior, scoped authority, operator controls, and the ways the system blocks unsafe state drift."
        primaryCta={{ label: "Open security docs", href: docsLinks.security }}
        secondaryCta={{ label: "Security overview", href: "/security" }}
        proofPoints={[
          { title: "Fail closed by default", body: "Missing artifacts, route drift, or mismatched bindings should stop the action, not silently succeed." },
          { title: "Scoped authority", body: "Hosts get bounded grants, not vague permission to act however they like." },
          { title: "Operator backstops", body: "Kill switches, quarantine, and dispute resolution are part of the product, not an afterthought." }
        ]}
        sections={[
          { eyebrow: "Model", title: "Security model", body: "Read the full trust boundaries and runtime constraints.", href: docsLinks.security, ctaLabel: "Open model" },
          { eyebrow: "Ops", title: "Operations", body: "See how production controls and incident response connect to the security posture.", href: docsLinks.ops, ctaLabel: "Ops docs" },
          { eyebrow: "Policy", title: "Launch checklist", body: "Use the launch list as the concrete security bar for go-live.", href: SITE_DOC_ROUTES.launchChecklist, ctaLabel: "Launch checklist" }
        ]}
      />
    );
  }
  if (mode === "docs_ops") {
    return (
      <ResourcePage
        eyebrow="Docs / Operations"
        title="Operator pages should lead to runbooks, not leave you guessing."
        summary="The ops surface is part of the product. Launch checklists, incidents, cutover, and host success gates should be discoverable from the website too."
        primaryCta={{ label: "Open operations docs", href: docsLinks.ops }}
        secondaryCta={{ label: "Launch checklist", href: SITE_DOC_ROUTES.launchChecklist }}
        proofPoints={[
          { title: "Readiness before launch", body: "Synthetic smokes and onboarding gates should catch route drift before a user does." },
          { title: "Rescue before scale", body: "Operators need quarantine, revoke, refund, and dispute resolution before the product broadens." },
          { title: "Cutover with evidence", body: "Prod claims should be backed by machine-readable reports, not gut feel." }
        ]}
        sections={[
          { eyebrow: "Runbooks", title: "Operations", body: "Daily runbook, health loops, and launch readiness details.", href: docsLinks.ops, ctaLabel: "Open ops" },
          { eyebrow: "Launch", title: "Checklist", body: "The go-live bar for the first product loop.", href: SITE_DOC_ROUTES.launchChecklist, ctaLabel: "Open checklist" },
          { eyebrow: "Incidents", title: "Incident response", body: "What happens when a run, host, or money lane goes sideways.", href: SITE_DOC_ROUTES.incidents, ctaLabel: "Open incident docs" }
        ]}
      />
    );
  }
  if (mode === "docs_launch_hosts") {
    return (
      <ResourcePage
        eyebrow="Docs / Launch hosts"
        title="Every supported host should land on the same approval, receipt, and dispute loop."
        summary="The launch host guide is the public index for proving Claude MCP, OpenClaw, and engineering-shell integrations against one Action Wallet runtime."
        primaryCta={{ label: "Open launch host guide", href: docsLinks.hostQuickstart }}
        secondaryCta={{ label: "Integrations", href: "/integrations" }}
        proofPoints={[
          { title: "Claude MCP first", body: "The cleanest host handoff still matters most for proving the trust layer." },
          { title: "Framework parity second", body: "OpenClaw and engineering shells should reuse the same approval URL, receipt link, and dispute route." },
          { title: "One runtime everywhere", body: "Hosts change. The authority contract and artifact chain should not." }
        ]}
        sections={[
          { eyebrow: "Launch", title: "Claude MCP", body: "The primary host for the simplest install-to-approval proof loop.", href: docsLinks.claudeDesktopQuickstart, ctaLabel: "Open Claude quickstart" },
          { eyebrow: "Framework", title: "OpenClaw", body: "The supported framework path for proving host-native parity.", href: docsLinks.openClawQuickstart, ctaLabel: "Open OpenClaw guide" },
          { eyebrow: "Engineering", title: "Codex / CLI / API", body: "Use the same managed Action Wallet flow from scripts and shells.", href: docsLinks.codexEngineeringQuickstart, ctaLabel: "Open engineering guide" }
        ]}
      />
    );
  }
  if (mode === "docs_partner_kit") {
    return (
      <ResourcePage
        eyebrow="Docs / Partner kit"
        title="Design partners should get one disciplined onboarding pack, not tribal knowledge."
        summary="The partner kit is the public handoff for what a launch partner needs to run a first real action, what evidence to expect, and how to escalate problems."
        primaryCta={{ label: "Open partner kit", href: docsLinks.designPartnerKit }}
        secondaryCta={{ label: "Open onboarding", href: "/onboarding" }}
        proofPoints={[
          { title: "Fast first value", body: "Partners should reach one hosted approval and one receipt quickly." },
          { title: "Sharp expectations", body: "What is supported, what is not, and where to escalate must be visible before the first run." },
          { title: "Shared language", body: "Hosts, receipts, disputes, and operator rescue should be explained the same way everywhere." }
        ]}
        sections={[
          { eyebrow: "Activation", title: "Onboarding", body: "Issue the runtime and point partners at one supported host.", href: "/onboarding", ctaLabel: "Open onboarding" },
          { eyebrow: "Hosts", title: "Launch host guide", body: "Choose the exact host path the partner will prove first.", href: SITE_DOC_ROUTES.hostQuickstart, ctaLabel: "Open host guide" },
          { eyebrow: "Runbook", title: "Support and escalation", body: "Use the same support and operator path when something breaks.", href: SITE_DOC_ROUTES.support, ctaLabel: "Open support path" }
        ]}
      />
    );
  }
  if (mode === "docs_launch_checklist") {
    return (
      <ResourcePage
        eyebrow="Docs / Launch checklist"
        title="A production claim should map to a concrete release bar."
        summary="This route turns the launch checklist into a public website page first, then hands off into the full runbook when deeper operator detail is needed."
        primaryCta={{ label: "Open launch checklist", href: docsLinks.launchChecklist }}
        secondaryCta={{ label: "Status", href: "/status" }}
        proofPoints={[
          { title: "Route health first", body: "Public routes and same-origin control-plane paths should be green before any launch claim." },
          { title: "Proof loop second", body: "Install, approval, receipt, and dispute should work on live hosts before broad rollout." },
          { title: "Operator controls third", body: "Kill switches, quarantine, and recourse must exist before scale." }
        ]}
        sections={[
          { eyebrow: "Website", title: "Public route smoke", body: "The live website has to prove each public route is branded, intentional, and wired correctly.", href: "/status", ctaLabel: "Open status" },
          { eyebrow: "Runtime", title: "First real action", body: "The real product bar is still the first live approval-to-receipt loop.", href: "/onboarding", ctaLabel: "Open onboarding" },
          { eyebrow: "Docs", title: "Operations", body: "Dive into the full operator checklist and cutover docs if you need the full detail.", href: docsLinks.ops, ctaLabel: "Open ops docs" }
        ]}
      />
    );
  }
  if (mode === "docs_incidents") {
    return (
      <ResourcePage
        eyebrow="Docs / Incidents"
        title="When something goes wrong, the support path should already exist."
        summary="Incident response is part of the product. This route gives operators, partners, and builders a clear first stop before they dive into the full runbook."
        primaryCta={{ label: "Open incident docs", href: docsLinks.incidents }}
        secondaryCta={{ label: "Support", href: "/support" }}
        proofPoints={[
          { title: "One escalation path", body: "Users should know where to go when approvals, receipts, or disputes drift." },
          { title: "Keep the artifact chain intact", body: "Incident handling should preserve grants, receipts, verifier results, and disputes." },
          { title: "Operator action is part of trust", body: "Rescue, revoke, refund, quarantine, and kill switches are all public trust commitments." }
        ]}
        sections={[
          { eyebrow: "Rescue", title: "Operator controls", body: "The operator console is the first place incidents become actionable.", href: "/status", ctaLabel: "Open status" },
          { eyebrow: "Recourse", title: "Disputes", body: "Challenge and unwind the bad action without losing the underlying record.", href: "/disputes", ctaLabel: "Open disputes" },
          { eyebrow: "Support", title: "Public support path", body: "Use the website support route for the visible escalation path.", href: "/support", ctaLabel: "Open support" }
        ]}
      />
    );
  }
  if (mode === "status") {
    return (
      <ResourcePage
        eyebrow="Status"
        title="Production posture should be visible."
        summary="Use this route as the public index for launch health, known issues, and operational trust posture instead of burying that information in internal dashboards."
        primaryCta={{ label: "Open operations docs", href: docsLinks.ops }}
        secondaryCta={{ label: "Launch checklist", href: SITE_DOC_ROUTES.launchChecklist }}
        proofPoints={[
          { title: "Health is a product feature", body: "Customers should know where to look when onboarding or approvals feel wrong." },
          { title: "Known issues should be explicit", body: "If there is route drift, degraded auth, or host instability, that should not be hidden." },
          { title: "Ops links should be direct", body: "The status route should be a clear handoff into real runbooks and support channels." }
        ]}
        sections={[
          { eyebrow: "Health", title: "Operations runbook", body: "Current best source for live readiness posture and operational drill-down.", href: docsLinks.ops, ctaLabel: "Open operations" },
          { eyebrow: "Support", title: "Support path", body: "Public issue tracker, operator docs, and launch guidance for sharp edges and regressions.", href: SITE_DOC_ROUTES.support, ctaLabel: "Open support" },
          { eyebrow: "Launch", title: "Go-live checklist", body: "The concrete release bar we hold the system to.", href: SITE_DOC_ROUTES.launchChecklist, ctaLabel: "Open checklist" }
        ]}
      />
    );
  }
  if (mode === "security") {
    return (
      <ResourcePage
        eyebrow="Security"
        title="The product should say how it fails, not just how it succeeds."
        summary="Security for Nooterra means bounded authority, deterministic evidence, operator kill switches, and route-level fail-closed behavior when the web shell drifts from the control plane."
        primaryCta={{ label: "Open security model", href: docsLinks.security }}
        secondaryCta={{ label: "View docs hub", href: "/docs" }}
        proofPoints={[
          { title: "Authority is scoped", body: "The system grants only bounded permission to act and keeps that scope inspectable." },
          { title: "Artifacts are canonical", body: "Receipts, disputes, and verification stay attached to the same run lineage." },
          { title: "Route drift is treated as failure", body: "If the website serves HTML where control-plane JSON belongs, launch gates now block." }
        ]}
        sections={[
          { eyebrow: "Reference", title: "Security model", body: "Read the formal runtime boundaries and protections.", href: docsLinks.security, ctaLabel: "Open model" },
          { eyebrow: "Ops", title: "Incident response", body: "See how the operator side handles drift, abuse, and failures.", href: SITE_DOC_ROUTES.incidents, ctaLabel: "Incident docs" },
          { eyebrow: "Product", title: "Disputes", body: "Recourse is part of the trust model, not separate from it.", href: "/disputes", ctaLabel: "View disputes" }
        ]}
      />
    );
  }
  if (mode === "privacy") {
    return (
      <ResourcePage
        eyebrow="Privacy"
        title="The public site should explain the data boundary before people enter the product."
        summary="This route gives users a clear starting point for how onboarding identities, hosted approvals, receipts, and disputes relate to the broader Nooterra trust model."
        primaryCta={{ label: "Open security model", href: docsLinks.security }}
        secondaryCta={{ label: "Contact support", href: SITE_DOC_ROUTES.support }}
        proofPoints={[
          { title: "Identity is explicit", body: "Work email, company, and runtime issuance are part of the trust boundary." },
          { title: "Artifacts outlive the host", body: "Approval, receipt, and dispute records persist beyond the initiating conversation." },
          { title: "Data should be explainable", body: "Every stored artifact should have a product reason, not just a logging reason." }
        ]}
        sections={[
          { eyebrow: "Identity", title: "Onboarding", body: "See the public onboarding path and what the product asks for first.", href: "/onboarding", ctaLabel: "Open onboarding" },
          { eyebrow: "Artifacts", title: "Receipts", body: "Understand the durable records the system keeps after actions complete.", href: "/receipts", ctaLabel: "View receipts" },
          { eyebrow: "Support", title: "Questions", body: "Route unusual privacy or data handling questions into support and operator channels.", href: SITE_DOC_ROUTES.support, ctaLabel: "Open support" }
        ]}
      />
    );
  }
  if (mode === "terms") {
    return (
      <ResourcePage
        eyebrow="Terms"
        title="Product boundaries should be visible before users sign in."
        summary="This page is the public route for what the first product actually is: host-first Action Wallet, launch-scoped hosts, and explicit recourse instead of vague automation claims."
        primaryCta={{ label: "Open docs hub", href: "/docs" }}
        secondaryCta={{ label: "Developers", href: "/developers" }}
        proofPoints={[
          { title: "Launch scope is narrow", body: "Buy plus cancel/recover on the supported host/runtime paths." },
          { title: "The website is not the whole product", body: "Host-native interaction, hosted trust surfaces, and the underlying Action Wallet flow all matter." },
          { title: "Recourse is part of the promise", body: "Users should understand that approvals, receipts, and disputes are core, not optional." }
        ]}
        sections={[
          { eyebrow: "Scope", title: "Developers", body: "See the actual launch channels and runtime entry points.", href: "/developers", ctaLabel: "View developers" },
          { eyebrow: "Surfaces", title: "Trust pages", body: "Approvals, receipts, disputes, and wallet are the public trust layer.", href: "/wallet", ctaLabel: "View trust pages" },
          { eyebrow: "Reference", title: "Docs", body: "Full reference, launch checklist, and architecture beyond the marketing layer.", href: "/docs", ctaLabel: "Open docs" }
        ]}
      />
    );
  }
  if (mode === "support") {
    return (
      <ResourcePage
        eyebrow="Support"
        title="Support should route users into the right trust surface fast."
        summary="This route exists so users do not have to guess whether they should open a dispute, check status, return to onboarding, or file a public issue."
        primaryCta={{ label: "Open GitHub support", href: ossLinks.issues }}
        secondaryCta={{ label: "Status", href: "/status" }}
        proofPoints={[
          { title: "Action problems go to receipts or disputes", body: "If a real action happened, the right first stop is the linked trust artifact, not a generic support inbox." },
          { title: "Install problems go to onboarding and host guides", body: "Host setup should fall back to the shortest doc path, not a maze." },
          { title: "Platform problems go to status and ops", body: "Known issues and launch blockers should already be visible before a user files a report." }
        ]}
        sections={[
          { eyebrow: "Activation", title: "Onboarding", body: "If you cannot create the runtime or complete the first real action, start here.", href: "/onboarding", ctaLabel: "Open onboarding" },
          { eyebrow: "Artifacts", title: "Receipts and disputes", body: "If the action happened but looks wrong, move into the artifact and recourse surfaces.", href: "/receipts", ctaLabel: "Open receipts" },
          { eyebrow: "Platform", title: "Status and incidents", body: "If the product itself feels off, check live status and incident paths first.", href: "/status", ctaLabel: "Open status" }
        ]}
      />
    );
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
        secondaryCta={{ label: "Launch host guide", href: SITE_DOC_ROUTES.hostQuickstart }}
        steps={[
          { eyebrow: "Reopen", title: "Request again", body: "Seed a new hosted approval from onboarding or the initiating host instead of retrying the expired link.", href: MANAGED_ONBOARDING_HREF, ctaLabel: "Open onboarding" },
          { eyebrow: "Resume", title: "Return to the host", body: "Claude, OpenClaw, or Codex should create a fresh approval request when the user resumes the task.", href: "/integrations", ctaLabel: "View integrations" },
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
        primaryCta={{ label: "Return to wallet", href: "/wallet" }}
        secondaryCta={{ label: "Open dispute guidance", href: "/disputes" }}
        steps={[
          { eyebrow: "Inspect", title: "Check authority state", body: "Open the wallet and confirm which host, rule, or one-time grant was revoked.", href: "/wallet", ctaLabel: "Open wallet" },
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
        summary="Nooterra Action Wallet launches with a narrow host matrix. If this action came from a different shell, use a supported channel or the direct API/CLI path."
        proofTitle="Launch support is intentionally narrow."
        proofBody="The runtime should be boring before it gets broad. Unsupported-host messaging should make the current boundary explicit and give the user a supported path forward."
        reasonCode="UNSUPPORTED_HOST"
        primaryCta={{ label: "Choose a supported host", href: "/integrations" }}
        secondaryCta={{ label: "Engineering quickstart", href: docsLinks.codexEngineeringQuickstart }}
        steps={[
          { eyebrow: "Supported now", title: "Use launch hosts", body: "Claude MCP and OpenClaw are the first-class launch hosts for the guided approval loop.", href: "/integrations", ctaLabel: "View host matrix" },
          { eyebrow: "Builders", title: "Fallback to API or CLI", body: "Codex, CLI, and direct HTTP all use the same Action Wallet flow even if the shell is not a launch-native host.", href: "/developers", ctaLabel: "Developer routes" },
          { eyebrow: "Scope", title: "Read the launch boundary", body: "Understand which channels are live now and which are coming later.", href: "/docs/integrations", ctaLabel: "Integration docs" }
        ]}
      />
    );
  }
  if (mode === "wallet") {
    return (
      <TrustEntryPage
        eyebrow="Action Wallet"
        title="One wallet for every consequential AI action."
        summary="Start with a one-time approval, save a preference when it helps, or set durable rules later. Action Wallet sits between agent intent and real-world consequence."
        proofTitle="The operating account for machine action."
        proofBody="The wallet is where people decide what an agent may do, how far that authority goes, when a human must approve, and how they can intervene later if the result is wrong."
        rail={[
          { title: "Issue authority", state: "scoped", body: "Approve one action, remember a preference, or create a reusable rule with clear limits." },
          { title: "Attach it to the right host", state: "revocable", body: "Claude, OpenClaw, Codex, CLI, and API all run through the same wallet instead of five separate control systems." },
          { title: "Carry limits forward", state: "enforced", body: "Budgets, approvals, dispute windows, and revocation rights stay attached to the action." }
        ]}
        bullets={[
          { title: "One-time approval first", body: "People should get value before they are asked to design a policy system." },
          { title: "Remember what matters", body: "Repeated approvals can become saved preferences after the user sees the product work." },
          { title: "Shared control later", body: "Teams can layer in thresholds, hosts, budgets, and delegated scope on top of the same runtime." }
        ]}
        artifactTitle="A wallet should read like an authority ledger."
        artifactBody="The live wallet is where users see active hosts, pending grants, revocations, and the exact limits attached to future actions. It should feel closer to a control ledger than a settings page."
        artifactStats={[
          { label: "Authority", value: "One-time, remembered, durable", body: "Users can start simple and grow into stronger controls without changing the underlying model." },
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
        summary="An agent asks to do something real. Nooterra shows the consequence, the limit, and why review is required before any authority is granted."
        proofTitle="Approval should answer the important questions fast."
        proofBody="Before someone clicks approve, they should understand what will happen, what it may cost, what proof is expected afterward, and whether this is a one-time decision or something worth remembering."
        rail={[
          { title: "See the consequence", state: "clear", body: "The page should show the exact action, vendor or domain, amount, and host before anything is approved." },
          { title: "Grant only this scope", state: "durable", body: "Approve once, deny it, or save a bounded rule. The result is a grant with real limits, not a vague yes." },
          { title: "Resume only if state still matches", state: "gated", body: "The host resumes only when approval, expiry, and evidence requirements still line up." }
        ]}
        bullets={[
          { title: "Plain language first", body: "People should not need operator jargon to understand what the agent wants permission to do." },
          { title: "One-time before durable", body: "Approve one thing first, then save the pattern later if it becomes useful." },
          { title: "Fail closed", body: "Missing context, missing evidence, or mismatched scope means the action does not proceed." }
        ]}
        artifactTitle="Approval is the handoff between autonomy and authority."
        artifactBody="This page should behave like a serious sign-off surface. It explains the action, the cost or consequence, whether the decision is one-time or repeatable, and what can be challenged later if the outcome looks wrong."
        artifactStats={[
          { label: "Decisioning", value: "Approve, ask, block", body: "The user sees whether the action can proceed now, needs review, or is stopped outright." },
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
        proofBody="If an agent buys, cancels, refunds, or changes something real, users need one place to confirm the outcome, the proof returned, and whether recourse is still available."
        rail={[
          { title: "Show what happened", state: "canonical", body: "Intent, approval, grant, execution, and amount all resolve to the same record." },
          { title: "Show why it is trusted", state: "deterministic", body: "The verifier result and evidence trail should be visible without opening raw payloads." },
          { title: "Keep recourse close", state: "actionable", body: "If something looks wrong, the user should be one click away from the dispute path." }
        ]}
        bullets={[
          { title: "Bound to the action", body: "Approval, grant, evidence, amount, and final state remain attached to the same run." },
          { title: "Readable by humans", body: "Users should understand the outcome in seconds, not by reverse engineering logs." },
          { title: "Actionable after the fact", body: "Receipts are where disputes, refunds, and reversal begin." }
        ]}
        artifactTitle="Receipts are where AI actions become understandable."
        artifactBody="The live receipt vault should make it obvious what happened, why the runtime trusted it, what proof came back, and whether the recourse window is still open. That is the product surface people come back to later."
        artifactStats={[
          { label: "Artifact chain", value: "Intent -> grant -> evidence", body: "Each completed action can be reconstructed without chasing logs across systems." },
          { label: "Human legibility", value: "Outcome, proof, amount", body: "The receipt should answer the questions people actually have after an action completes." },
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
