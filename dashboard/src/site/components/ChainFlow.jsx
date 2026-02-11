const chain = [
  {
    title: "Manifest",
    detail: "Provider publishes a signed description of the capability and verifier hints.",
    artifacts: "ToolManifest",
  },
  {
    title: "Agreement",
    detail: "Payer signs terms, authority context, and an input commitment.",
    artifacts: "ToolCallAgreement",
  },
  {
    title: "Hold",
    detail: "Funds lock before execution under challenge-window semantics.",
    artifacts: "FundingHold",
  },
  {
    title: "Evidence",
    detail: "Provider signs what happened and binds it to callId + inputHash.",
    artifacts: "ToolCallEvidence",
  },
  {
    title: "Decision + Receipt",
    detail: "Verifier evaluates and the kernel emits portable decision + receipt artifacts.",
    artifacts: "SettlementDecisionRecord, SettlementReceipt",
  },
  {
    title: "Dispute + Adjustment",
    detail: "A case freezes release; a verdict routes only held funds via deterministic adjustment.",
    artifacts: "DisputeOpenEnvelope, ArbitrationCase, ArbitrationVerdict, SettlementAdjustment",
  },
];

export default function ChainFlow() {
  return (
    <section id="protocol" className="section-shell">
      <div className="section-heading">
        <p className="eyebrow">Canonical Transaction Chain</p>
        <h2>One transaction. Deterministic artifacts.</h2>
      </div>
      <ol className="chain-grid">
        {chain.map((step, index) => (
          <li key={step.title} className="chain-card">
            <p className="chain-index">{String(index + 1).padStart(2, "0")}</p>
            <h3>{step.title}</h3>
            <p>{step.detail}</p>
            <p className="chain-artifacts">
              Artifacts: <code>{step.artifacts}</code>
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
