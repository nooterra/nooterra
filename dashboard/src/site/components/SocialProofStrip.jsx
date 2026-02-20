const items = [
  "Identity, delegation, and policy primitives for autonomous agents",
  "Execution, escalation, and coordination controls with replay safety",
  "Evidence, verification, and runbooks for compliance-grade operations"
];

export default function SocialProofStrip() {
  return (
    <section className="section-shell compact-strip" aria-label="Audience fit">
      {items.map((item) => (
        <article key={item} className="compact-pill">
          <p>{item}</p>
        </article>
      ))}
    </section>
  );
}
