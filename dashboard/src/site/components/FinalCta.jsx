import { buttonClasses } from "./ui/button.jsx";
import { Card } from "./ui/card.jsx";
import { docsLinks, ossLinks } from "../config/links.js";

export default function FinalCta() {
  return (
    <section className="section-shell">
      <Card className="final-cta-card">
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-[#94f0d7]">Ready to launch trust-first agents?</p>
        <h2 className="text-[clamp(2rem,5vw,3.4rem)] font-bold leading-[1] tracking-[-0.02em]">
          Give every autonomous action a provable paper trail.
        </h2>
        <p className="mt-4 max-w-3xl text-lg leading-relaxed text-[#c7deef]">
          Start with one command, scale with operator controls, and ship agent commerce that survives audit, disputes,
          and real-world incident response.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a className={buttonClasses({ className: "bg-[#94f0d7] text-[#082532] hover:bg-[#aef5e1]" })} href={docsLinks.quickstart}>
            Start onboarding
          </a>
          <a
            className={buttonClasses({
              variant: "outline",
              className: "border-[#3f708f] bg-transparent text-[#e4f0ff] hover:bg-[#173a53]"
            })}
            href={ossLinks.repo}
          >
            View GitHub
          </a>
        </div>
      </Card>
    </section>
  );
}
