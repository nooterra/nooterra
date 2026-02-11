const liveNow = [
  "Signed capability manifests and authority bounds",
  "Agreements committed by callId + inputHash",
  "Funding holds, holdbacks, and challenge windows",
  "Dispute-open signer proof (envelope artifact)",
  "Deterministic verifier plugins (approve or reject)",
  "SettlementDecisionRecord v2 pins policy hash used",
  "Arbitration verdict -> deterministic holdback adjustment",
  "Closepack export + offline verification",
];

export default function KernelNow() {
  return (
    <section id="product" className="section-shell section-highlight">
      <div>
        <p className="eyebrow">What Exists Today</p>
        <h2>Kernel v0 is live now.</h2>
        <p>
          Settld ships one canonical transaction atom, paid capability calls, with enforceable outcomes. Every major
          claim is tied to artifacts, replay, and conformance.
        </p>
      </div>
      <div className="check-grid" role="list" aria-label="Kernel live now features">
        {liveNow.map((item) => (
          <article key={item} role="listitem" className="check-card">
            <p>{item}</p>
          </article>
        ))}
      </div>
      <p className="section-linkline">
        <a className="text-link" href="/kernel-v0/">
          Inspect kernel artifacts
        </a>
      </p>
    </section>
  );
}
