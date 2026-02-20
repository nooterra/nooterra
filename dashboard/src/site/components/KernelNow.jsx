const pillars = [
  {
    title: "Delegated Authority",
    copy: "Sponsors define budgets, risk classes, and allowlists. Agents receive bounded authorizations instead of blank-check wallets."
  },
  {
    title: "Cryptographic Execution",
    copy: "Quotes, signatures, and evidence bindings are validated at settlement time, with replay and tamper checks built in."
  },
  {
    title: "Durable Accounting",
    copy: "Receipts and reversal events are immutable, queryable, exportable, and independently verifiable offline."
  }
];

export default function KernelNow() {
  return (
    <section id="platform" className="section-shell">
      <div className="section-heading">
        <p className="eyebrow">Platform</p>
        <h2>One economic control plane for agent actions.</h2>
        <p>
          Settld replaces bespoke payment glue with a deterministic loop from quote to settlement, including dispute
          and refund lifecycle handling.
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
