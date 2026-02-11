export default function Verifiability() {
  return (
    <section id="security" className="section-shell split-section">
      <article className="panel panel-strong">
        <p className="eyebrow">Offline Verification</p>
        <h2>Verify without trust.</h2>
        <p>
          Closepacks are portable bundles you can hand to auditors, customers, or counterparties. Offline verification
          checks signature integrity, binding invariants, dispute lineage, policy pinning, and deterministic adjustment
          semantics.
        </p>
        <div className="mini-code" role="region" aria-label="Closepack command snippet">
          <code>npx settld closepack export --agreement-hash &lt;hash&gt; --out closepack.zip</code>
          <code>npx settld closepack verify closepack.zip</code>
        </div>
        <a className="text-link" href="/kernel-v0/">
          Closepack format and verification rules
        </a>
      </article>
      <article className="panel">
        <p className="eyebrow">Replay Integrity</p>
        <h3>Replayable by design</h3>
        <p>
          Recompute evaluation against stored policy and verifier references. Replay endpoints compare recomputation
          against stored SettlementDecisionRecord.v2 fields including policy hash pinning and normalization version.
        </p>
        <dl className="metric-list">
          <div>
            <dt>Replay outcome</dt>
            <dd>MATCH / MISMATCH with issue codes</dd>
          </div>
          <div>
            <dt>Verifier pinning</dt>
            <dd>verifierRef + verificationMethodHashUsed</dd>
          </div>
          <div>
            <dt>Dispute legitimacy</dt>
            <dd>Signed DisputeOpenEnvelope for non-admin opens</dd>
          </div>
        </dl>
      </article>
    </section>
  );
}
