export default function Verifiability() {
  return (
    <section className="section-shell split-section">
      <article className="panel panel-strong">
        <p className="eyebrow">Audit-Grade Evidence</p>
        <h2>Not just logs. Portable proof artifacts.</h2>
        <p>
          Export closepacks with signed quote bindings, auth claims, execution hashes, and settlement timeline.
          Auditors can replay and validate without relying on live provider systems.
        </p>
        <div className="mini-code">
          <code>npx settld closepack export --receipt-id rcpt_123</code>
          <code>npx settld closepack verify closepack.zip</code>
        </div>
      </article>
      <article className="panel">
        <p className="eyebrow">Operator Safety</p>
        <h3>Human escalation built into autonomous spend.</h3>
        <p>
          When policy blocks execution, agents suspend with full context. Operators approve or deny overrides through
          signed commands with replay protection.
        </p>
        <ul className="tight-list">
          <li>Signed escalation events + webhook delivery</li>
          <li>One-time override tokens with expiry and reason</li>
          <li>Automatic unwind path for insolvent or expired agents</li>
        </ul>
      </article>
    </section>
  );
}
