const items = [
  "Built for API tools, MCP tools, and paid data providers",
  "Works with delegated sponsor wallets and policy caps",
  "Designed for finance, risk, and compliance review"
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
