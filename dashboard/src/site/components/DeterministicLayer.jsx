export default function DeterministicLayer() {
  return (
    <section className="section-shell split-section">
      <article className="panel">
        <p className="eyebrow">Deterministic Evaluation</p>
        <h2>Deterministic evaluation, not trust-my-logs.</h2>
        <p>
          Settld supports verifier plugins that deterministically accept or reject based on evidence. Replay tooling
          recomputes the same evaluation path and compares it to stored decision artifacts.
        </p>
      </article>
      <article className="panel panel-strong">
        <p className="eyebrow">Deterministic Cases</p>
        <h3>Two outcomes with explicit reason codes</h3>
        <div className="mini-code">
          <code>Case A: approve -&gt; holdback schedule + release path</code>
          <code>status=approved reasonCodes=["ACCEPTANCE_PASSED"]</code>
          <code>Case B: reject -&gt; no payout / refund held amount</code>
          <code>status=rejected reasonCodes=["ACCEPTANCE_FAILED"]</code>
        </div>
      </article>
    </section>
  );
}
