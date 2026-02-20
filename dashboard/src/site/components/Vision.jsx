const now = [
  "Quote-bound authorization and receipt durability",
  "Escalation, replay defense, and reversal lifecycle",
  "Offline verification for audits and dispute resolution"
];

const next = [
  "Universal paid wrappers with OpenAPI import",
  "Policy-aware tool resolver for autonomous selection",
  "Expanded adapter rails for payouts and procurement"
];

export default function Vision() {
  return (
    <section className="section-shell">
      <div className="section-heading">
        <p className="eyebrow">Roadmap Focus</p>
        <h2>Ship the rails. Then scale the network.</h2>
      </div>
      <div className="future-grid">
        <article className="future-card">
          <h3>Live today</h3>
          <ul className="tight-list">
            {now.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
        <article className="future-card">
          <h3>Next platform wave</h3>
          <ul className="tight-list">
            {next.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      </div>
    </section>
  );
}
