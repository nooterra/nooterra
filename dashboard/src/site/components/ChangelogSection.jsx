export default function ChangelogSection() {
  return (
    <section id="changelog" className="section-shell">
      <div className="section-heading">
        <p className="eyebrow">Changelog</p>
        <h2>Release evidence, not release vibes.</h2>
        <p>
          Every release includes protocol vectors, conformance expectations, and reproducible artifacts with checksums.
        </p>
      </div>
      <article className="panel">
        <h3>Latest line</h3>
        <ul className="tight-list">
          <li>Conformance report artifacts in release pipeline</li>
          <li>Closepack export + verify checks in CI gates</li>
          <li>Replay mismatch checks wired into release truth audit</li>
        </ul>
      </article>
    </section>
  );
}
