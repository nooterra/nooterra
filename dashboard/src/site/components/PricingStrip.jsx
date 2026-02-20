import { pricingPlans } from "../pricingData.js";

function usd(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2
  }).format(value);
}

export default function PricingStrip() {
  return (
    <section id="pricing" className="section-shell section-highlight">
      <div className="section-heading">
        <p className="eyebrow">Pricing</p>
        <h2>Start free, scale with verified value.</h2>
        <p>Each plan includes the core trust rails. Paid tiers add operational throughput and support depth.</p>
      </div>
      <div className="price-grid">
        {pricingPlans.map((plan) => (
          <article key={plan.id} className={`price-card ${plan.recommended ? "price-card-recommended" : ""}`}>
            <p className="price-plan-label">{plan.recommended ? "Recommended" : "Plan"}</p>
            <h3>{plan.name}</h3>
            <p className="price-note">{plan.monthlyUsd === null ? "Custom" : `${usd(plan.monthlyUsd)} / month`}</p>
            <p className="price-fee">
              {plan.settledFeePercent === null ? "Negotiated settlement fee" : `${plan.settledFeePercent}% settled volume fee`}
            </p>
          </article>
        ))}
      </div>
      <p className="section-linkline">
        <a className="text-link" href="/pricing">
          View full plan breakdown and metered line items
        </a>
      </p>
    </section>
  );
}
