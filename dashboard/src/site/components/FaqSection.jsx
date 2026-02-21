const faqs = [
  {
    q: "Can agents spend autonomously with Settld?",
    a: "Yes, within delegated policy limits. Sponsors set budgets and constraints, then agents execute paid calls only when authorization and binding checks pass."
  },
  {
    q: "What can we buy first?",
    a: "The strongest lane today is APIs, data, compute, and MCP tools through integrated providers or generic wrappers."
  },
  {
    q: "How do disputes and refunds work?",
    a: "Every transaction has an append-only event timeline with reversal states, signed decisions, and idempotent handling for retries."
  },
  {
    q: "Can finance teams reconcile this?",
    a: "Yes. Receipts are durable, queryable, and exportable as JSONL for reconciliation pipelines and controls."
  },
  {
    q: "Do we need to trust Settld servers forever?",
    a: "No. Closepacks let third parties verify signatures and lineage offline, independent of runtime infrastructure."
  },
  {
    q: "How fast can we integrate?",
    a: "Most teams can run a local verified flow in minutes, then harden policy and onboarding for production over staged rollouts."
  }
];

export default function FaqSection() {
  return (
    <section id="faq" className="section-shell">
      <div className="section-heading">
        <p className="eyebrow">FAQ</p>
        <h2>Questions teams ask before production rollout.</h2>
      </div>
      <div className="faq-list">
        {faqs.map((item) => (
          <details key={item.q} className="faq-item">
            <summary>{item.q}</summary>
            <p>{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
