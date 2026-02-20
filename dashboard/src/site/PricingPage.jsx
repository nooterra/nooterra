import SiteNav from "./components/SiteNav.jsx";
import SiteFooter from "./components/SiteFooter.jsx";
import { pricingPlans, valueEventPricing } from "./pricingData.js";

function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2
  }).format(value);
}

export default function PricingPage() {
  return (
    <div className="site-root" id="top">
      <div className="site-bg-texture" aria-hidden="true" />
      <div className="site-bg-orb site-bg-orb-a" aria-hidden="true" />
      <div className="site-bg-orb site-bg-orb-b" aria-hidden="true" />
      <SiteNav />
      <main>
        <section className="section-shell">
          <div className="section-highlight pricing-hero">
            <p className="eyebrow">Access Policy</p>
            <h1>Settld is currently free while we ship the full primitive stack.</h1>
            <p className="hero-sub">
              Right now the goal is ecosystem adoption, hard reliability data, and production proof loops across
              identity, policy, settlement, verification, and orchestration primitives.
            </p>
            <div className="hero-actions">
              <a className="btn btn-solid" href="#plans">
                See access terms
              </a>
              <a className="btn btn-ghost" href="/docs">
                Read docs
              </a>
            </div>
          </div>
        </section>

        <section className="section-shell" id="plans">
          <div className="price-grid">
            {pricingPlans.map((plan) => (
              <article key={plan.id} className={`price-card ${plan.recommended ? "price-card-recommended" : ""}`}>
                <p className="price-plan-label">Plan</p>
                <h2>{plan.name}</h2>
                <p className="price-note">{money(plan.monthlyUsd)} / month</p>
                <p className="price-fee">{plan.settledFeePercent}% settled volume fee</p>
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
            <p className="eyebrow">Current Status</p>
            <h2>Open buildout period</h2>
            <p>
              Platform fee: <strong>{money(0)}</strong>
            </p>
            <p>
              Settled volume fee: <strong>0%</strong>
            </p>
            <p>
              Goal: <strong>maximize adoption while finishing all primitives.</strong>
            </p>
          </article>

          <article className="panel">
            <p className="eyebrow">Policy Notes</p>
            <h3>What this means right now</h3>
            <ul className="tight-list">
              {valueEventPricing.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className="hero-note">Commercial packaging can be introduced once production primitives stabilize.</p>
          </article>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
