const now = [
  "Delegated authority + policy-bounded execution",
  "Escalation routing + deterministic state transitions",
  "Durable evidence + offline verification and reconciliation"
];

const next = [
  "Universal wrappers for API, MCP, SaaS, and workflow surfaces",
  "Capability and resolver primitives for autonomous orchestration",
  "Lifecycle primitives for insolvency, succession, and risk transfer"
];

export default function Vision() {
  return (
    <section className="section-shell">
      <div className="section-heading">
        <p className="eyebrow">Roadmap Focus</p>
        <h2>Ship every primitive needed for a real autonomous ecosystem.</h2>
      </div>
      <div className="future-grid">
        <article className="future-card">
          <h3>Live today</h3>
          <ul className="tight-list">
            {now.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
        <article className="future-card">
          <h3>Next platform wave</h3>
          <ul className="tight-list">
            {next.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      </div>
    </section>
  );
}
