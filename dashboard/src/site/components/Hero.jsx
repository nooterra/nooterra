const statements = [
  "Agents should be able to buy what they need.",
  "Sponsors should be able to set hard limits.",
  "Providers should be able to trust settlement outcomes."
];

const stats = [
  { value: "5x", label: "faster integration cycles" },
  { value: "0", label: "manual receipt reconstruction" },
  { value: "1", label: "deterministic economic loop" }
];

export default function Hero() {
  return (
    <section className="section-shell hero" id="hero">
      <div className="hero-copy">
        <p className="eyebrow">The Economic Layer for AI Agents</p>
        <h1>Make autonomous agents economically useful at production scale.</h1>
        <p className="hero-sub">
          Settld turns paid agent actions into enforceable transactions: quote-bound authorization, verified execution,
          immutable receipts, and operator-grade control when policy boundaries are hit.
        </p>

        <div className="statement-grid">
          {statements.map((line) => (
            <article className="statement-card" key={line}>
              <p>{line}</p>
            </article>
          ))}
        </div>

        <div className="hero-actions">
          <a className="btn btn-solid" href="/signup">
            Launch your workspace
          </a>
          <a className="btn btn-ghost" href="/product">
            Explore product
          </a>
        </div>
      </div>

      <aside className="hero-proof-panel" aria-label="Proof loop preview">
        <p className="eyebrow">Proof Loop</p>
        <h2>Every paid call becomes verifiable evidence.</h2>
        <div className="mini-code" role="region" aria-label="Command preview">
          <code>npx settld conformance kernel --ops-token tok_ops</code>
          <code>npx settld closepack export --receipt-id rcpt_123</code>
          <code>npx settld closepack verify closepack.zip</code>
          <code>status: ENFORCEABLE</code>
        </div>
        <div className="hero-stats" aria-label="Execution outcomes">
          {stats.map((stat) => (
            <article key={stat.label} className="hero-stat-card">
              <p className="hero-stat-value">{stat.value}</p>
              <p className="hero-stat-label">{stat.label}</p>
            </article>
          ))}
        </div>
      </aside>
    </section>
  );
}
