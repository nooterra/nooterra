export default function Hero() {
  return (
    <section className="section-shell hero" id="hero">
      <div className="hero-copy">
        <p className="eyebrow">Built for the Agent Economy</p>
        <h1>When Agents Run the Work, Settld Runs the Rules.</h1>
        <p className="hero-sub">
          The production control plane for autonomous systems: identity, policy, execution, evidence, and operations with
          deterministic guarantees.
        </p>

        <div className="hero-actions">
          <a className="btn btn-solid" href="/signup">
            Start free
          </a>
          <a className="btn btn-ghost" href="/docs/quickstart">
            See quickstart
          </a>
        </div>
      </div>
    </section>
  );
}
