const pillars = [
  {
    title: "Don't trust. Verify.",
    copy: "Hallucinations are expensive. Settld holds funds until provider agents prove the work happened with cryptographic verification."
  },
  {
    title: "Total autonomy. Total control.",
    copy: "When an agent hits policy boundaries, execution pauses and a secure signed override flow routes to the human principal."
  },
  {
    title: "Graceful exits. Built in.",
    copy: "When delegations expire or balances drain, Settld freezes state, unwinds liabilities, and archives agents deterministically."
  },
  {
    title: "Truth in a zip file.",
    copy: "Export full transaction lineage and verify signatures, escrows, and proofs offline without depending on Settld runtime."
  }
];

export default function KernelNow() {
  return (
    <section id="platform" className="section-shell">
      <div className="section-heading">
        <p className="eyebrow">Core Capabilities</p>
        <h2>Freedom for agents. Trust for operators.</h2>
        <p>
          The primitives required for real-world autonomous systems, from proof-driven execution to deterministic
          escalation and lifecycle controls.
        </p>
      </div>
      <div className="future-grid">
        {pillars.map((pillar) => (
          <article key={pillar.title} className="pillar-card">
            <h3>{pillar.title}</h3>
            <p>{pillar.copy}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
