import { docsLinks } from "../config/links.js";

const commands = [
  "npx settld setup",
  "npm run mcp:probe -- --call settld.about '{}'",
  "npm run demo:mcp-paid-exa",
  "settld x402 receipt verify /tmp/settld-first-receipt.json --format json"
];

const outputs = [
  "Host MCP config and runtime env wired to your selected agent runtime",
  "Policy-bound paid execution run with gateId, decisionId, and settlementReceiptId",
  "Deterministic proof packet that finance and compliance can replay offline"
];

export default function Quickstart() {
  return (
    <section id="developers" className="section-shell">
      <div className="section-heading" id="quickstart">
        <p className="eyebrow">Developer Quickstart</p>
        <h2>From install to first verified receipt in four moves.</h2>
        <p>This is the same path your users take in production onboarding.</p>
      </div>
      <div className="quickstart-grid">
        <article className="panel panel-strong">
          <h3>Command sequence</h3>
          <ol className="command-list">
            {commands.map((command) => (
              <li key={command}>
                <code>{command}</code>
              </li>
            ))}
          </ol>
        </article>
        <article className="panel">
          <h3>Expected outcomes</h3>
          <ul className="tight-list">
            {outputs.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <div className="hero-actions">
            <a className="btn btn-solid" href={docsLinks.quickstart}>
              Open quickstart docs
            </a>
            <a className="btn btn-ghost" href="/developers">
              Explore developer docs
            </a>
          </div>
        </article>
      </div>
    </section>
  );
}
