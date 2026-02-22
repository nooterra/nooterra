import { docsLinks } from "../config/links.js";

const commands = [
  "npx settld setup --non-interactive --host openclaw --wallet-mode managed --wallet-bootstrap remote",
  "npm run mcp:probe -- --call settld.about '{}'",
  "npm run demo:mcp-paid-exa"
];

const outputs = [
  "Host MCP config and runtime env wired for your tenant",
  "Paid execution run with gateId, decisionId, and settlementReceiptId",
  "Verifiable receipt artifact for finance and compliance workflows"
];

export default function Quickstart() {
  return (
    <section id="developers" className="section-shell">
      <div className="section-heading" id="quickstart">
        <p className="eyebrow">Developer Quickstart</p>
        <h2>Run your first trusted paid call in minutes.</h2>
        <p>One command to onboard, one probe to activate, one paid call to produce your first verifiable receipt.</p>
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
