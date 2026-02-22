import { docsLinks, ossLinks } from "./config/links.js";

const hostList = ["OpenClaw", "Codex", "Claude", "Cursor"];
const steps = [
  {
    title: "Connect runtime",
    body: "Run setup, pick host, and wire MCP in one pass."
  },
  {
    title: "Enforce policy",
    body: "Every risky action resolves via allow, challenge, deny, or escalate."
  },
  {
    title: "Verify outcomes",
    body: "Receipts and proof artifacts replay offline for ops, finance, and compliance."
  }
];

const proofItems = [
  "Policy fingerprint + reason codes",
  "Execution binding and tamper-evident timeline",
  "Settlement receipt with offline verification output"
];

export default function SiteShell() {
  return (
    <div className="simple-site" id="top">
      <header className="simple-nav">
        <a className="simple-brand" href="/" aria-label="Settld home">
          <span className="simple-brand-name">Settld</span>
          <span className="simple-brand-sub">Trust OS for agent commerce</span>
        </a>
        <div className="simple-nav-links">
          <a href={docsLinks.home}>Docs</a>
          <a href={docsLinks.quickstart}>Quickstart</a>
          <a href={ossLinks.repo}>GitHub</a>
          <a className="simple-btn" href={docsLinks.quickstart}>Start onboarding</a>
        </div>
      </header>

      <main className="simple-main">
        <section className="simple-hero">
          <p className="simple-kicker">Trust OS for Agent Commerce</p>
          <h1>Let agents spend autonomously. Keep humans in control.</h1>
          <p className="simple-lead">
            Settld is the control layer between agent actions and money movement. It enforces policy decisions,
            supports operator intervention, and emits deterministic evidence by default.
          </p>
          <div className="simple-hosts" aria-label="Supported hosts">
            {hostList.map((host) => (
              <span key={host}>{host}</span>
            ))}
          </div>
          <div className="simple-command-wrap">
            <span>Run first setup:</span>
            <code>npx settld setup</code>
          </div>
          <div className="simple-actions">
            <a className="simple-btn" href={docsLinks.quickstart}>Open Quickstart</a>
            <a className="simple-btn simple-btn-muted" href={docsLinks.integrations}>Host Integrations</a>
          </div>
        </section>

        <section className="simple-section-card">
          <h2>What Settld is</h2>
          <p>
            A deterministic trust kernel for agent spending. Not a wallet replacement, not a prompt guardrail.
            It is the enforcement and evidence layer that makes autonomous spending production-safe.
          </p>
        </section>

        <section className="simple-grid" aria-label="How Settld works">
          {steps.map((step, index) => (
            <article key={step.title}>
              <p className="simple-step">0{index + 1}</p>
              <h2>{step.title}</h2>
              <p>{step.body}</p>
            </article>
          ))}
        </section>

        <section className="simple-links" aria-label="Proof outputs and links">
          <h2>First proof packet includes</h2>
          <ul>
            {proofItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <div className="simple-links-row">
            <a href={docsLinks.home}>Documentation</a>
            <a href={docsLinks.quickstart}>Quickstart</a>
            <a href={docsLinks.security}>Security model</a>
            <a href={docsLinks.api}>API reference</a>
            <a href={ossLinks.repo}>GitHub</a>
          </div>
        </section>

        <section className="simple-commands" aria-label="Quick command flow">
          <h2>Four commands to first verified run</h2>
          <pre><code>{`npx settld setup
npm run mcp:probe -- --call settld.about '{}'
npm run demo:mcp-paid-exa
settld x402 receipt verify /tmp/settld-first-receipt.json --format json`}</code></pre>
        </section>
      </main>

      <footer className="simple-footer">
        <span>Settld</span>
        <span>Trust infrastructure for autonomous economic action.</span>
      </footer>
    </div>
  );
}
