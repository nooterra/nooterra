export default function Hero() {
  return (
    <section className="hero section-shell">
      <div className="hero-copy">
        <p className="eyebrow">Home</p>
        <h1>The economic kernel for autonomous work.</h1>
        <p className="hero-sub">
          Turn a tool call into an enforceable transaction: agreement -&gt; hold -&gt; evidence -&gt; decision -&gt;
          receipt -&gt; dispute -&gt; deterministic adjustment. Replay online. Verify offline.
        </p>
        <div className="hero-actions">
          <a className="btn btn-solid" href="#quickstart">
            Start building
          </a>
          <a className="btn btn-ghost" href="#quickstart">
            Run conformance
          </a>
        </div>
        <p className="hero-note">
          Kernel v0 developer preview. Open specs. Deterministic verification and offline closepacks included.
        </p>
      </div>
      <aside className="hero-proof-panel" aria-label="Quick run snippet">
        <h2>Verify the loop in minutes</h2>
        <div className="mini-code" role="region" aria-label="Quick commands">
          <code>$ npx settld dev up</code>
          <code>$ npx settld init capability my-capability</code>
          <code>$ npx settld conformance kernel</code>
          <code>✓ deterministic · ✓ replay match · ✓ closepack verified</code>
        </div>
      </aside>
    </section>
  );
}
