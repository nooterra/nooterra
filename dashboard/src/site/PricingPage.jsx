import SiteNav from "./components/SiteNav.jsx";
import SiteFooter from "./components/SiteFooter.jsx";
import { blendedMonthlyCost, pricingPlans, valueEventPricing } from "./pricingData.js";

function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2
  }).format(value);
}

export default function PricingPage() {
  const growthExample = blendedMonthlyCost({
    monthlyBaseUsd: 599,
    settledVolumeUsd: 500000,
    settledFeePercent: 0.45
  });

  return (
    <div className="site-root" id="top">
      <div className="site-bg-texture" aria-hidden="true" />
      <div className="site-bg-orb site-bg-orb-a" aria-hidden="true" />
      <div className="site-bg-orb site-bg-orb-b" aria-hidden="true" />
      <SiteNav />
      <main>
        <section className="section-shell">
          <div className="section-highlight pricing-hero">
            <p className="eyebrow">Pricing</p>
            <h1>Predictable platform fees. Variable cost tied to verified value.</h1>
            <p className="hero-sub">
              Settld pricing is designed for agent operations: low-friction start, clear unit economics, and audit-ready
              line items as volume scales.
            </p>
            <div className="hero-actions">
              <a className="btn btn-solid" href="#plans">
                Compare plans
              </a>
              <a className="btn btn-ghost" href="/#developers">
                Run quickstart
              </a>
            </div>
          </div>
        </section>

        <section className="section-shell" id="plans">
          <div className="price-grid">
            {pricingPlans.map((plan) => (
              <article key={plan.id} className={`price-card ${plan.recommended ? "price-card-recommended" : ""}`}>
                <p className="price-plan-label">{plan.recommended ? "Recommended" : "Plan"}</p>
                <h2>{plan.name}</h2>
                <p className="price-note">
                  {plan.monthlyUsd === null ? "Custom annual contract" : `${money(plan.monthlyUsd)} / month`}
                </p>
                <p className="price-fee">
                  {plan.settledFeePercent === null
                    ? "Negotiated settlement fee"
                    : `${plan.settledFeePercent}% settled volume fee`}
                </p>
                <ul className="tight-list">
                  {plan.includes.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section className="section-shell split-section">
          <article className="panel panel-strong">
            <p className="eyebrow">Worked Example</p>
            <h2>Growth plan at $500k/month settled volume</h2>
            <p>
              Base platform fee: <strong>{money(599)}</strong>
            </p>
            <p>
              Settlement fee: <strong>{money(2250)}</strong>
            </p>
            <p>
              Blended monthly total: <strong>{growthExample ? money(growthExample) : "n/a"}</strong>
            </p>
          </article>

          <article className="panel">
            <p className="eyebrow">Metered Value Events</p>
            <h3>Line items exposed for finance review</h3>
            <ul className="tight-list">
              {valueEventPricing.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className="hero-note">Receipts and exports map directly to these billing dimensions.</p>
          </article>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
