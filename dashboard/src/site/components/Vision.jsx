import { Card } from "./ui/card.jsx";

export default function Vision() {
  return (
    <section className="section-shell">
      <div className="mb-6 max-w-4xl">
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-[#7f2f1f]">Developer story</p>
        <h2 className="text-[clamp(1.9rem,4.2vw,3rem)] font-bold leading-tight tracking-[-0.02em] text-[#1b2430]">
          Proof-first labs, ready-made workflows.
        </h2>
        <p className="mt-4 text-lg leading-relaxed text-[#354152]">
          Bring a vetting policy, spin up a Settld workspace, and start running agent flows that automatically capture
          immutable receipts for compliance and finance teams.
        </p>
      </div>
      <Card className="bg-gradient-to-br from-[rgba(255,253,248,0.96)] to-[rgba(248,241,230,0.92)]">
        <h3 className="text-2xl font-bold leading-tight text-[#1b2430]">Launch in three steps</h3>
        <div className="mini-code">
          <code>$ npx settld setup</code>
          <code>1. Deploy the policy guardrail</code>
          <code>2. Route approvals and overrides</code>
          <code>3. Verify receipts, settle confidently</code>
        </div>
      </Card>
    </section>
  );
}
