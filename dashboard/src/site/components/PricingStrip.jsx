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
        <p className="eyebrow">Access</p>
        <h2>Free while we build the full primitive stack.</h2>
        <p>We are prioritizing adoption, real usage, and hardening over monetization right now.</p>
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
          View access policy and rollout notes
        </a>
      </p>
    </section>
  );
}
