import PageFrame from "../components/PageFrame.jsx";

const sections = [
  {
    id: "quickstart",
    title: "Quickstart",
    copy: "Run a full quote -> authorization -> execution -> receipt cycle in minutes.",
    commands: ["npm run dev:api", "npx settld dev:sdk:key --print-only", "npx settld sdk:first-run"]
  },
  {
    id: "authz",
    title: "Spend Authorization",
    copy: "All spend is quote-bound, request-bound, and policy-bounded. No blank-check tokens.",
    commands: [
      "POST /x402/wallets/:walletId/authorize",
      "POST /x402/gate/authorize-payment",
      "GET /x402/wallets/:walletId/budgets"
    ]
  },
  {
    id: "receipts",
    title: "Receipts and Exports",
    copy: "Immutable receipt snapshots plus append-only events provide audit-grade system-of-record behavior.",
    commands: ["GET /x402/receipts/:receiptId", "GET /x402/receipts?cursor=...", "GET /x402/receipts/export.jsonl?..."]
  },
  {
    id: "verification",
    title: "Offline Verification",
    copy: "Closepacks can be verified outside Settld infrastructure for compliance and disputes.",
    commands: ["npx settld closepack export --receipt-id rcpt_123", "npx settld closepack verify closepack.zip"]
  },
  {
    id: "escalation",
    title: "Operator Escalation",
    copy: "Policy blocks suspend state and route to operator inbox with signed one-time overrides.",
    commands: [
      "GET /x402/gate/escalations?status=pending",
      "POST /x402/gate/escalations/:id/resolve",
      "POST /x402/webhooks/endpoints"
    ]
  }
];

const references = [
  { href: "/product", label: "Product architecture" },
  { href: "/developers", label: "Developer rollout path" },
  { href: "/security", label: "Security controls" },
  { href: "/pricing", label: "Pricing and packaging" },
  { href: "/demo", label: "Interactive runtime demo" },
  { href: "/operator", label: "Operator escalation inbox" }
];

export default function DocsPage() {
  return (
    <PageFrame>
      <section className="section-shell page-hero">
        <p className="eyebrow">Documentation</p>
        <h1>Ship autonomous commerce without improvising your trust layer.</h1>
        <p>
          This page is your implementation map: APIs, operational loops, and verification flows used to run Settld in
          production.
        </p>
        <div className="hero-actions">
          <a className="btn btn-solid" href="#quickstart">Start quickstart</a>
          <a className="btn btn-ghost" href="/operator">Open operator inbox</a>
        </div>
      </section>

      <section className="section-shell docs-layout">
        <aside className="docs-toc">
          <p className="eyebrow">Contents</p>
          <ul>
            {sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>{section.title}</a>
              </li>
            ))}
          </ul>
        </aside>

        <div className="docs-content">
          {sections.map((section) => (
            <article key={section.id} id={section.id} className="docs-section-card">
              <h2>{section.title}</h2>
              <p>{section.copy}</p>
              <div className="mini-code">
                {section.commands.map((cmd) => (
                  <code key={cmd}>{cmd}</code>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="section-shell section-highlight">
        <div className="section-heading">
          <p className="eyebrow">Reference</p>
          <h2>Core pages and operational surfaces</h2>
        </div>
        <div className="docs-ref-grid">
          {references.map((ref) => (
            <a key={ref.href} href={ref.href} className="docs-ref-card">
              {ref.label}
            </a>
          ))}
        </div>
      </section>
    </PageFrame>
  );
}
