const plans = [
  {
    name: "Free",
    note: "100 proofs / month",
    detail: "1 entity, community support.",
  },
  {
    name: "Pro",
    note: "1,000 proofs / month",
    detail: "10 entities, webhooks, email support.",
  },
  {
    name: "Scale",
    note: "10,000 proofs / month",
    detail: "Unlimited entities, priority support, advanced policy controls.",
  },
  {
    name: "Enterprise",
    note: "Custom limits + SLAs",
    detail: "Marketplace volume agreements and design-partner integrations.",
  },
];

export default function PricingStrip() {
  return (
    <section id="pricing" className="section-shell section-highlight">
      <div className="section-heading">
        <p className="eyebrow">Pricing</p>
        <h2>Pricing</h2>
        <p>
          Pricing is based on verification volume and active entities. Settlement adapters for real-money rails are
          design-partner alpha.
        </p>
      </div>
      <div className="price-grid">
        {plans.map((plan) => (
          <article className="price-card" key={plan.name}>
            <h3>{plan.name}</h3>
            <p className="price-note">{plan.note}</p>
            <p>{plan.detail}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
