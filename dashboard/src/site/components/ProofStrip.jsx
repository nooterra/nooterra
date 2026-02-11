const proofs = [
  {
    title: "Replayable by design",
    copy: "Recompute evaluation against stored policy and verifier references. Mismatch is explicit."
  },
  {
    title: "Offline-verifiable",
    copy: "Export a closepack. Verify signatures, bindings, disputes, and adjustments without our server."
  },
  {
    title: "Conformance-gated",
    copy: "Kernel assertions run in CI and produce machine-readable reports."
  }
];

export default function ProofStrip() {
  return (
    <section className="section-shell proof-strip">
      {proofs.map((proof) => (
        <article key={proof.title} className="check-card">
          <h3>{proof.title}</h3>
          <p>{proof.copy}</p>
        </article>
      ))}
    </section>
  );
}
