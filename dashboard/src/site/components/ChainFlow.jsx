const flow = [
  {
    stage: "01",
    title: "Quote",
    copy: "Provider returns a signed quote bound to request semantics and price limits."
  },
  {
    stage: "02",
    title: "Authorize",
    copy: "Sponsor wallet issuer mints bounded spend authorization with nonce, expiry, and idempotency."
  },
  {
    stage: "03",
    title: "Execute",
    copy: "Paid call runs only after policy and signature checks pass."
  },
  {
    stage: "04",
    title: "Receipt",
    copy: "Gateway persists immutable receipt snapshot plus append-only event timeline."
  },
  {
    stage: "05",
    title: "Verify",
    copy: "Teams export closepacks and verify signatures and lineage offline, independent of Settld runtime."
  }
];

export default function ChainFlow() {
  return (
    <section id="workflow" className="section-shell section-highlight">
      <div className="section-heading">
        <p className="eyebrow">Workflow</p>
        <h2>Deterministic path from intent to enforceable settlement.</h2>
      </div>
      <ol className="flow-grid">
        {flow.map((step) => (
          <li key={step.title} className="flow-card">
            <p className="flow-stage">{step.stage}</p>
            <h3>{step.title}</h3>
            <p>{step.copy}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
