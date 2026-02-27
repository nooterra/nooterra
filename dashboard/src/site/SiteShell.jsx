import { docsLinks, ossLinks } from "./config/links.js";
import "./site.css";

const hostList = ["OpenClaw", "Nooterra", "Claude", "Cursor"];

const controlPrimitives = [
  {
    id: "01",
    title: "Decide",
    body: "Every paid action returns allow, challenge, deny, or escalate."
  },
  {
    id: "02",
    title: "Bind",
    body: "Execution is bound to authorization and policy state."
  },
  {
    id: "03",
    title: "Prove",
    body: "Receipts and evidence are replayable offline."
  },
  {
    id: "04",
    title: "Control",
    body: "Operator overrides and controls keep autonomy reversible."
  }
];

const onboardingSteps = [
  {
    id: "01",
    title: "Install + configure",
    body: "Run setup once. Choose host, wallet mode, and profile in the wizard.",
    terminal: "$ npx nooterra setup\n\no host: openclaw\no wallet mode: managed\no profile: bounded-spend\n\nok configuration written"
  },
  {
    id: "02",
    title: "Route live calls",
    body: "Agent actions pass through Nooterra before money moves.",
    terminal: "-> action: pay_api_call\n-> policy evaluate\n<- decision: ALLOW\n<- reason: BUDGET_OK, RATE_OK\n<- binding: 0x7f2a"
  },
  {
    id: "03",
    title: "Verify outcomes",
    body: "Every run emits auditable evidence.",
    terminal: "$ nooterra x402 receipt verify ./receipt.json\n\nok signature valid\nok timeline hash matches\nok policy fingerprint matches"
  }
];

const walletModes = [
  {
    title: "Managed Wallet",
    body: "Fastest path. Nooterra bootstraps wallet setup for first paid run."
  },
  {
    title: "Bring Your Own Wallet",
    body: "Connect existing wallet IDs and secrets with full policy and evidence controls."
  },
  {
    title: "No Wallet Yet",
    body: "Start trust-only, verify integration, enable money rails when ready."
  }
];

const spendScopes = [
  "Paid tool/API calls",
  "Agent-to-agent subtasks",
  "Procurement workflows with approvals",
  "Data and service purchases under policy limits"
];

const quickCommands = `npx nooterra setup
npm run mcp:probe -- --call nooterra.about '{}'
npm run demo:mcp-paid-exa
nooterra x402 receipt verify /tmp/nooterra-first-receipt.json --format json`;

const proofItems = [
  "Policy fingerprint + reason codes",
  "Execution binding hash + tamper-evident timeline",
  "Settlement receipt + offline verification report"
];

export default function SiteShell() {
  return (
    <div className="calm-site" id="top">
      <header className="calm-nav-wrap">
        <nav className="calm-nav" aria-label="Primary">
          <a className="calm-brand" href="/" aria-label="Nooterra home">
            <img className="calm-logo" src="/brand/nooterra-logo.png" alt="Nooterra logo" />
            <span className="calm-brand-title">Nooterra</span>
          </a>
          <div className="calm-nav-links">
            <a href={docsLinks.home}>Docs</a>
            <a href={docsLinks.quickstart}>Quickstart</a>
            <a href={docsLinks.security}>Security</a>
            <a href={ossLinks.repo}>GitHub</a>
          </div>
          <div className="calm-nav-cta">
            <a className="calm-btn calm-btn-ghost" href={docsLinks.home}>View docs</a>
            <a className="calm-btn calm-btn-solid" href={docsLinks.quickstart}>Start setup</a>
          </div>
        </nav>
      </header>

      <main className="calm-main">
        <section className="calm-hero calm-reveal" id="overview">
          <div className="calm-hero-copy">
            <p className="calm-kicker">Deterministic Agent Commerce Control Plane</p>
            <h1>Let agents spend autonomously. Keep humans in enforceable control.</h1>
            <p className="calm-lead">
              Policy-enforced spending with deterministic receipts.
            </p>
            <div className="calm-hero-cta">
              <a className="calm-btn calm-btn-solid" href={docsLinks.quickstart}>Run quickstart</a>
              <a className="calm-btn calm-btn-ghost" href={docsLinks.integrations}>Integration guide</a>
            </div>
            <ul className="calm-checks">
              <li>One setup flow for multiple agent hosts</li>
              <li>Deterministic policy decisions</li>
              <li>Offline-verifiable evidence</li>
            </ul>
          </div>
          <aside className="calm-command-card" aria-label="Setup preview">
            <p>Get started in one command</p>
            <code>npx nooterra setup</code>
            <pre><code>{quickCommands}</code></pre>
          </aside>
        </section>

        <section className="calm-hosts calm-reveal" style={{ animationDelay: "80ms" }}>
          <p>Works with</p>
          <div className="calm-host-list">
            {hostList.map((host) => (
              <span key={host} className="calm-chip">{host}</span>
            ))}
          </div>
        </section>

        <section className="calm-section calm-reveal" id="primitives" style={{ animationDelay: "120ms" }}>
          <header className="calm-section-head">
            <p>Core Primitives</p>
            <h2>One trust kernel. Four enforceable controls.</h2>
          </header>
          <div className="calm-grid calm-grid-4">
            {controlPrimitives.map((primitive) => (
              <article key={primitive.title} className="calm-card">
                <span className="calm-card-id">{primitive.id}</span>
                <h3>{primitive.title}</h3>
                <p>{primitive.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="calm-section calm-reveal" id="workflow" style={{ animationDelay: "160ms" }}>
          <header className="calm-section-head">
            <p>Workflow</p>
            <h2>How teams use Nooterra in production</h2>
          </header>
          <div className="calm-grid calm-grid-3">
            {onboardingSteps.map((step) => (
              <article key={step.title} className="calm-step">
                <span>{step.id}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
                <pre><code>{step.terminal}</code></pre>
              </article>
            ))}
          </div>
        </section>

        <section className="calm-section calm-reveal" style={{ animationDelay: "200ms" }}>
          <header className="calm-section-head">
            <p>Wallet Setup Paths</p>
            <h2>Managed, BYO, or trust-only mode.</h2>
          </header>
          <div className="calm-grid calm-grid-3">
            {walletModes.map((mode) => (
              <article key={mode.title} className="calm-card calm-card-mode">
                <h3>{mode.title}</h3>
                <p>{mode.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="calm-section calm-reveal" style={{ animationDelay: "240ms" }}>
          <div className="calm-split">
            <article className="calm-card calm-proof-card">
              <h3>What agents can spend on first</h3>
              <ul className="calm-list">
                {spendScopes.map((scope) => (
                  <li key={scope}>{scope}</li>
                ))}
              </ul>
            </article>
            <article className="calm-card calm-proof-card">
              <h3>First proof packet includes</h3>
              <ul className="calm-list">
                {proofItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          </div>
        </section>

        <section className="calm-cta calm-reveal" style={{ animationDelay: "280ms" }}>
          <h2>Start fast. Ship safely.</h2>
          <p>Run setup, route paid actions through policy, and verify receipts offline.</p>
          <div className="calm-hero-cta">
            <a className="calm-btn calm-btn-solid" href={docsLinks.quickstart}>Start setup now</a>
            <a className="calm-btn calm-btn-ghost" href={ossLinks.repo}>View GitHub</a>
          </div>
        </section>
      </main>

      <footer className="calm-footer">
        <span>Nooterra</span>
        <span>Deterministic trust infrastructure for autonomous economic action.</span>
      </footer>
    </div>
  );
}
