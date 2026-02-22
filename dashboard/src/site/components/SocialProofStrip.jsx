import { Card } from "./ui/card.jsx";

export default function SocialProofStrip() {
  return (
    <section className="section-shell" aria-label="Operational confidence">
      <Card className="bg-gradient-to-br from-[rgba(255,253,248,0.96)] to-[rgba(248,241,230,0.92)]">
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-[#7f2f1f]">Operational story</p>
        <h2 className="text-[clamp(1.8rem,4vw,3rem)] font-bold leading-tight tracking-[-0.02em] text-[#1b2430]">
          Every agent move tells the same deterministic story.
        </h2>
        <p className="mt-4 max-w-4xl text-lg leading-relaxed text-[#354152]">
          Policies vote before any action runs, approvals gate exceptions, and immutable receipts keep finance and
          compliance teams in sync. Settld keeps autonomy productive, but never unmoored from governance.
        </p>
        <ul className="tight-list mt-6 grid gap-3 sm:grid-cols-3">
          <li>Policy-defined guardrails for every capability request</li>
          <li>Human approval or trusted overrides before risky steps</li>
          <li>Proof-bound evidence the entire org can audit</li>
        </ul>
      </Card>
    </section>
  );
}
