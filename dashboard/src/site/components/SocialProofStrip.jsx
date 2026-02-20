import { Card } from "./ui/card.jsx";

export default function SocialProofStrip() {
  return (
    <section className="section-shell" aria-label="Autonomy and authority">
      <Card className="bg-gradient-to-br from-[rgba(255,253,248,0.96)] to-[rgba(248,241,230,0.92)]">
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-[#7f2f1f]">The Paradigm Shift</p>
        <h2 className="text-[clamp(1.8rem,4vw,3rem)] font-bold leading-tight tracking-[-0.02em] text-[#1b2430]">
          Autonomy demands authority.
        </h2>
        <p className="mt-4 max-w-4xl text-lg leading-relaxed text-[#354152]">
          Giving an AI a credit card is a liability. Giving it a Settld wallet is a strategy. We bind every agent to
          hard, cryptographic rules. It can negotiate. It can spend. But it cannot break policy.
        </p>
      </Card>
    </section>
  );
}
