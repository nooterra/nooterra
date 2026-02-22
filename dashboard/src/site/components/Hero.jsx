import { buttonClasses } from "./ui/button.jsx";
import { docsLinks } from "../config/links.js";
import { Badge } from "./ui/badge.jsx";

export default function Hero() {
  return (
    <section className="section-shell" id="hero">
      <div className="hero-grid">
        <article>
          <p className="hero-kicker">Deterministic trust OS for agent commerce</p>
          <h1 className="hero-title">Let agents spend. Keep humans in control.</h1>
          <p className="hero-copy">
            Settld is the enforcement layer between autonomous action and money movement. Every high-risk step is
            policy checked, challengeable, and receipts are deterministic by default.
          </p>
          <div className="hero-chip-row">
            <Badge variant="accent">Allow / Challenge / Deny / Escalate</Badge>
            <Badge variant="accent">Proof packets for audit</Badge>
            <Badge variant="accent">Cross-host MCP ready</Badge>
          </div>
          <div className="hero-actions">
            <a className={buttonClasses({ size: "lg" })} href={docsLinks.quickstart}>
              Start onboarding
            </a>
            <a className={buttonClasses({ variant: "outline", size: "lg" })} href="/developers">
              See integration path
            </a>
          </div>
        </article>
        <aside className="hero-proof-card">
          <p className="hero-proof-label">What ships in the first proof packet</p>
          <ul className="tight-list mt-0">
            <li>Policy fingerprint + reason codes for each decision</li>
            <li>Execution binding hashes and tamper-evident timeline</li>
            <li>Settlement receipt + offline verification output</li>
          </ul>
          <div className="hero-proof-meta">
            <div>
              <span>First run target</span>
              <strong>&lt; 10 min</strong>
            </div>
            <div>
              <span>Default command</span>
              <strong>npx settld setup</strong>
            </div>
          </div>
        </aside>
      </div>
      <div className="hero-lane">
        <p>Use with OpenClaw, Codex, Claude, and Cursor through one hardened trust contract.</p>
        <div className="hero-lane-grid">
          <span>Policy Runtime</span>
          <span>Operator Inbox</span>
          <span>Receipt Verification</span>
          <span>Dispute / Reversal</span>
        </div>
      </div>
    </section>
  );
}
