const items = [
  "Govern autonomous agents with hard policy boundaries.",
  "Settle execution with cryptographic proof, not trust.",
  "Operate at scale with replayable evidence and deterministic workflows."
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
