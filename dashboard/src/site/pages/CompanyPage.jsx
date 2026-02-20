import PageFrame from "../components/PageFrame.jsx";

const principles = [
  "Autonomy requires layered primitives, not isolated features",
  "Trust comes from deterministic evidence, not vendor claims",
  "Policy and safety must be programmable and enforceable",
  "Scale comes from standards, wrappers, and shared contracts"
];

export default function CompanyPage() {
  return (
    <PageFrame>
      <section className="section-shell page-hero">
        <p className="eyebrow">Company</p>
        <h1>We are building the primitive substrate for autonomous AI systems.</h1>
        <p>
          The next decade is not just AI spending money. It is AI agents coordinating identity, authority, work,
          verification, and operations at scale. Settld is building that underlying primitive stack.
        </p>
        <div className="hero-actions">
          <a className="btn btn-solid" href="/docs/ops">Operations docs</a>
          <a className="btn btn-ghost" href="/docs">Docs</a>
        </div>
      </section>

      <section className="section-shell">
        <div className="statement-grid">
          {principles.map((principle) => (
            <article key={principle} className="statement-card">
              <p>{principle}</p>
            </article>
          ))}
        </div>
      </section>
    </PageFrame>
  );
}
