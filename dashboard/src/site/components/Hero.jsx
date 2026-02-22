import { buttonClasses } from "./ui/button.jsx";
import { docsLinks, ossLinks } from "../config/links.js";
import { Badge } from "./ui/badge.jsx";

export default function Hero() {
  return (
    <section className="section-shell" id="hero">
      <div className="mx-auto max-w-5xl">
        <p className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-[#7f2f1f]">
          Deterministic trust OS for AI automation
        </p>
        <h1 className="text-[clamp(3rem,9vw,6rem)] font-bold leading-[0.95] tracking-[-0.03em] text-[#1b2430]">
          Simple guardrails. Unstoppable autonomous workflows.
        </h1>
        <p className="mt-6 max-w-3xl text-lg leading-relaxed text-[#354152]">
          Define policies, require human review when necessary, and bind every action to immutable evidence so
          autonomous agents stay productive without compromising risk controls.
        </p>

        <div className="mt-6 grid max-w-4xl grid-cols-1 gap-2 sm:grid-cols-3">
          <Badge variant="accent">Policy scopes</Badge>
          <Badge variant="accent">Approval gates</Badge>
          <Badge variant="accent">Cryptographic proof</Badge>
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          <a className={buttonClasses({ size: "lg" })} href={docsLinks.quickstart}>
            Start onboarding
          </a>
          <a className={buttonClasses({ variant: "outline", size: "lg" })} href="/developers">
            Explore developer flow
          </a>
        </div>
      </div>
    </section>
  );
}
