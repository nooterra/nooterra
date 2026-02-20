const commands = [
  "npm run dev:api",
  "npx settld dev:sdk:key --print-only",
  "npx settld sdk:first-run"
];

const outputs = [
  "A paid execution run with quote + authorization evidence",
  "A durable receipt linked to settlement state",
  "Offline verification output with explicit status and issue codes"
];

export default function Quickstart() {
  return (
    <section id="developers" className="section-shell">
      <div className="section-heading" id="quickstart">
        <p className="eyebrow">Developer Quickstart</p>
        <h2>Run your first trusted paid call in minutes.</h2>
        <p>Start local, validate the full economic loop, then connect production providers incrementally.</p>
      </div>
      <div className="quickstart-grid">
        <article className="panel panel-strong">
          <h3>Commands</h3>
          <ol className="command-list">
            {commands.map((command) => (
              <li key={command}>
                <code>{command}</code>
              </li>
            ))}
          </ol>
        </article>
        <article className="panel">
          <h3>Expected outcome</h3>
          <ul className="tight-list">
            {outputs.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <div className="hero-actions">
            <a className="btn btn-solid" href="/demo">
              Open live demo
            </a>
            <a className="btn btn-ghost" href="/operator">
              Open operator inbox
            </a>
          </div>
        </article>
      </div>
    </section>
  );
}
