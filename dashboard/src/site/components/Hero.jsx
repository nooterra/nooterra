import { buttonClasses } from "./ui/button.jsx";
import { docsLinks, ossLinks } from "../config/links.js";
import { Badge } from "./ui/badge.jsx";

export default function Hero() {
  return (
    <section className="section-shell" id="hero">
      <div className="mx-auto max-w-5xl">
        <p className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-[#7f2f1f]">
          Infrastructure for the Agent Era
        </p>
        <h1 className="max-w-[11ch] text-[clamp(3rem,9vw,6.25rem)] font-bold leading-[0.95] tracking-[-0.03em] text-[#1b2430]">
          The future runs on agents. Agents run on Settld.
        </h1>
        <p className="mt-6 max-w-3xl text-lg leading-relaxed text-[#354152]">
          You build the intelligence. Settld enforces identity, policy, execution, and evidence primitives so autonomous
          systems can operate in the real world with trust attached by default.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          <Badge variant="accent">Delegated Authority</Badge>
          <Badge variant="accent">Deterministic Execution</Badge>
          <Badge variant="accent">Operator Escalation</Badge>
          <Badge variant="accent">Offline Verification</Badge>
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          <a className={buttonClasses({ size: "lg" })} href={docsLinks.integrations}>
            Start with MCP
          </a>
          <a className={buttonClasses({ variant: "outline", size: "lg" })} href={ossLinks.repo}>
            View GitHub
          </a>
        </div>
      </div>
    </section>
  );
}
