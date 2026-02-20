const highlights = [
  "Quote-bound authorizations",
  "Provider signatures + JWKS verification",
  "Immutable receipts and reversals",
  "Offline closepack verification"
];

const stats = [
  { value: "<10m", label: "first verified run" },
  { value: "100%", label: "receipt replayability target" },
  { value: "1", label: "protocol loop, not custom glue" }
];

export default function Hero() {
  return (
    <section className="section-shell hero" id="hero">
      <div className="hero-copy">
        <p className="eyebrow">Autonomous Commerce Infrastructure</p>
        <h1>Give AI agents spending power without giving up control.</h1>
        <p className="hero-sub">
          Settld is the trust and settlement layer for paid agent actions. Agents can quote, authorize, execute,
          and settle under sponsor policy with cryptographic evidence that survives audits and disputes.
        </p>
        <ul className="hero-highlights">
          {highlights.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <div className="hero-actions">
          <a className="btn btn-solid" href="#developers">
            Run quickstart
          </a>
          <a className="btn btn-ghost" href="/pricing">
            See pricing
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
