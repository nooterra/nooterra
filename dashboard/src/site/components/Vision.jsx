import { Card } from "./ui/card.jsx";

const rolloutSteps = [
  {
    title: "Connect runtime",
    copy: "Choose host and wallet mode in setup. Settld writes MCP wiring and runtime passport context."
  },
  {
    title: "Enforce policy",
    copy: "Every high-risk action routes through deterministic allow/challenge/deny/escalate decisions."
  },
  {
    title: "Prove outcomes",
    copy: "Receipts and verification packets become the shared truth for engineering, finance, and compliance."
  }
];

export default function Vision() {
  return (
    <section className="section-shell">
      <div className="mb-6 max-w-4xl">
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-[#ffca7a]">Build path</p>
        <h2 className="text-[clamp(1.9rem,4.2vw,3rem)] font-bold leading-tight tracking-[-0.02em] text-[#f4f9ff]">
          Terminal-first onboarding, production-grade control.
        </h2>
        <p className="mt-4 text-lg leading-relaxed text-[#b0c6d9]">
          Settld is opinionated where trust matters most. You move fast with one command, then grow into operator
          workflows, disputes, and financial reconciliation without replacing your agent runtime.
        </p>
      </div>
      <div className="build-path-grid">
        <Card className="build-path-terminal">
          <h3 className="text-2xl font-bold leading-tight text-[#f4f9ff]">Launch in one command</h3>
          <div className="mini-code">
            <code>$ npx settld setup</code>
            <code>→ choose host, wallet mode, and guardrail profile</code>
            <code>→ smoke test MCP and start first paid run</code>
          </div>
        </Card>
        <div className="build-path-steps">
          {rolloutSteps.map((step, index) => (
            <Card key={step.title} className="build-path-step">
              <p>{String(index + 1).padStart(2, "0")}</p>
              <h3>{step.title}</h3>
              <span>{step.copy}</span>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
