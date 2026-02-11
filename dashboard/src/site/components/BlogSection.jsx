export default function BlogSection() {
  return (
    <section id="blog" className="section-shell">
      <div className="section-heading">
        <p className="eyebrow">Blog</p>
        <h2>Kernel notes for builders.</h2>
      </div>
      <div className="future-grid">
        <article className="future-card">
          <p>Payment is not settlement.</p>
        </article>
        <article className="future-card">
          <p>Tool calls are not work. Contracts are work.</p>
        </article>
        <article className="future-card">
          <p>Offline verification and why closepacks exist.</p>
        </article>
        <article className="future-card">
          <p>Deterministic verifiers: what we can guarantee.</p>
        </article>
      </div>
    </section>
  );
}
