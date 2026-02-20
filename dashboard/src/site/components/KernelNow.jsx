import { Card } from "./ui/card.jsx";

const pillars = [
  {
    title: "Don't trust. Verify.",
    copy: "Hallucinations are expensive. Settld holds funds until provider agents prove the work happened with cryptographic verification."
  },
  {
    title: "Total autonomy. Total control.",
    copy: "When an agent hits policy boundaries, execution pauses and a secure signed override flow routes to the human principal."
  },
  {
    title: "Graceful exits. Built in.",
    copy: "When delegations expire or balances drain, Settld freezes state, unwinds liabilities, and archives agents deterministically."
  },
  {
    title: "Truth in a zip file.",
    copy: "Export full transaction lineage and verify signatures, escrows, and proofs offline without depending on Settld runtime."
  }
];

export default function KernelNow() {
  return (
    <section id="platform" className="section-shell">
      <div className="mb-6 max-w-4xl">
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-[#7f2f1f]">Core Capabilities</p>
        <h2 className="text-[clamp(1.9rem,4.4vw,3.2rem)] font-bold leading-tight tracking-[-0.02em] text-[#1b2430]">
          Freedom for agents. Trust for operators.
        </h2>
        <p className="mt-4 text-lg leading-relaxed text-[#354152]">
          The primitives required for real-world autonomous systems, from proof-driven execution to deterministic
          escalation and lifecycle controls.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {pillars.map((pillar) => (
          <Card key={pillar.title}>
            <h3 className="text-2xl font-bold leading-tight tracking-[-0.01em] text-[#1b2430]">{pillar.title}</h3>
            <p className="mt-3 text-base leading-relaxed text-[#354152]">{pillar.copy}</p>
          </Card>
        ))}
      </div>
    </section>
  );
}
