import { Card } from "./ui/card.jsx";

const trustClaims = [
  {
    title: "Deterministic policy outcomes",
    copy: "Every paid action resolves through a stable decision engine with reason codes and policy fingerprints."
  },
  {
    title: "Operations-first controls",
    copy: "Challenge queues, kill switches, and signed operator actions keep risky flows reversible and accountable."
  },
  {
    title: "Audit-grade evidence",
    copy: "Receipts, timelines, and verification artifacts can be replayed offline without trusting runtime infrastructure."
  }
];

export default function SocialProofStrip() {
  return (
    <section className="section-shell" aria-label="Operational confidence">
      <div className="trust-strip-head">
        <p className="eyebrow">Why teams switch to Settld</p>
        <h2>Autonomy becomes operationally safe when trust is programmable.</h2>
      </div>
      <div className="trust-strip-grid">
        {trustClaims.map((claim) => (
          <Card key={claim.title} className="trust-strip-card">
            <h3>{claim.title}</h3>
            <p>{claim.copy}</p>
          </Card>
        ))}
      </div>
    </section>
  );
}
