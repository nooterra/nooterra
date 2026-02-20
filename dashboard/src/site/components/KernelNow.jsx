const pillars = [
  {
    title: "Identity and Authority",
    copy: "Agent, sponsor, and operator identities are explicit, signed, and policy-constrained."
  },
  {
    title: "Execution and Coordination",
    copy: "Command flows, escalation paths, and state transitions are deterministic and replay-protected."
  },
  {
    title: "Economics and Settlement",
    copy: "Spend authorization, reversals, disputes, and reconciliation remain bounded and auditable."
  },
  {
    title: "Evidence and Verification",
    copy: "Receipts, timelines, and closepacks are immutable, portable, and independently verifiable."
  }
];

export default function KernelNow() {
  return (
    <section id="platform" className="section-shell">
      <div className="section-heading">
        <p className="eyebrow">Platform</p>
        <h2>A full primitive layer for autonomous systems.</h2>
        <p>
          Settld unifies identity, authority, execution, settlement, and verification primitives into one coherent control plane.
        </p>
      </div>
      <div className="pillar-grid">
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
