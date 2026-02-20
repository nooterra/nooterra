const statements = [
  "Identity and authority must be explicit and programmable.",
  "Execution and coordination must be policy-bounded and replay-safe.",
  "Evidence and verification must survive audits without platform trust."
];

const stats = [
  { value: "7+", label: "primitive layers in active buildout" },
  { value: "1", label: "deterministic command-to-evidence graph" },
  { value: "0", label: "required trust in live runtime for audits" }
];

export default function Hero() {
  return (
    <section className="section-shell hero" id="hero">
      <div className="hero-copy">
        <p className="eyebrow">Foundational Primitive Stack</p>
        <h1>Build the full operating substrate for autonomous AI systems.</h1>
        <p className="hero-sub">
          Settld is not only payment rails. It is evolving into the primitive layer for delegated authority,
          trustworthy execution, coordination safety, durable evidence, and programmable operations across the agent stack.
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
          <a className="btn btn-ghost" href="/docs">
            Read docs
          </a>
        </div>
      </div>

      <aside className="hero-proof-panel" aria-label="Proof loop preview">
        <p className="eyebrow">Deterministic Control Loop</p>
        <h2>Every critical agent action becomes verifiable system evidence.</h2>
        <div className="mini-code" role="region" aria-label="Command preview">
          <code>authorize -&gt; execute -&gt; receipt -&gt; verify</code>
          <code>escalate -&gt; override/deny -&gt; append timeline</code>
          <code>export -&gt; offline verify -&gt; reconcile</code>
          <code>status: AUDITABLE + REPLAYABLE</code>
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
