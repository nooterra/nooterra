import PageFrame from "../components/PageFrame.jsx";

const pillars = [
  {
    title: "Identity + Delegation Primitives",
    copy: "Sponsor, agent, and operator authority is explicit, programmable, and scope-bounded."
  },
  {
    title: "Execution + Coordination Primitives",
    copy: "Actions, escalations, and command transitions are deterministic, signed, and replay-safe."
  },
  {
    title: "Evidence + Verification Primitives",
    copy: "Durable receipts, reversals, exports, and closepacks are portable and independently verifiable."
  }
];

const lanes = [
  "APIs and data providers",
  "MCP tools and paid capabilities",
  "Policy-gated SaaS actions",
  "Escalation and operator approvals"
];

export default function ProductPage() {
  return (
    <PageFrame>
      <section className="section-shell page-hero">
        <p className="eyebrow">Product</p>
        <h1>Primitive infrastructure for autonomous systems.</h1>
        <p>
          Settld is building the end-to-end primitive layer across identity, policy, execution, coordination,
          economics, and verification. Payment is one primitive, not the full product boundary.
        </p>
        <div className="hero-actions">
          <a className="btn btn-solid" href="/docs">Open docs</a>
          <a className="btn btn-ghost" href="/docs/security">Security model</a>
        </div>
      </section>

      <section className="section-shell">
        <div className="statement-grid">
          {pillars.map((pillar) => (
            <article key={pillar.title} className="statement-card">
              <h3>{pillar.title}</h3>
              <p>{pillar.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section-shell section-highlight">
        <div className="section-heading">
          <p className="eyebrow">Where Teams Start</p>
          <h2>Launch in constrained lanes, then expand primitive coverage.</h2>
        </div>
        <ul className="tight-list">
          {lanes.map((lane) => (
            <li key={lane}>{lane}</li>
          ))}
        </ul>
      </section>
    </PageFrame>
  );
}
