export default function Hero() {
  return (
    <section className="section-shell hero" id="hero">
      <div className="hero-copy">
        <p className="eyebrow">Autonomous Commerce Infrastructure</p>
        <h1>The future runs on agents. Agents run on Settld.</h1>
        <p className="hero-sub">
          You build the AI. We enforce the financial boundaries and demand cryptographic proof of execution. The
          uncompromising foundation for a trustless economy.
        </p>

        <div className="hero-actions">
          <a className="btn btn-solid" href="/signup">
            Start building
          </a>
          <a className="btn btn-ghost" href="/docs/quickstart">
            Read the docs
          </a>
        </div>
      </div>
    </section>
  );
}
