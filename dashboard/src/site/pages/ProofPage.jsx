import PageFrame from "../components/PageFrame.jsx";
import { docsLinks } from "../config/links.js";
import { buttonClasses } from "../components/ui/button.jsx";
import { Badge } from "../components/ui/badge.jsx";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.jsx";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../components/ui/accordion.jsx";

const evidencePillars = [
  {
    id: "protocol",
    title: "Protocol + conformance evidence",
    points: [
      "Deterministic protocol objects, vectors, and fixture corpus checked in CI.",
      "Replay and closepack verification commands are reproducible.",
      "Structured reason/warning codes for machine-readable audit paths."
    ]
  },
  {
    id: "security",
    title: "Security + control evidence",
    points: [
      "Signature validation, replay defense, and bounded policy checks in settlement flow.",
      "Escalation token verification and webhook secret rotation safety.",
      "Insolvency freeze + unwind + reversal controls."
    ]
  },
  {
    id: "operations",
    title: "Operations + runbook evidence",
    points: [
      "Pilot onboarding and incident runbooks checked into docs.",
      "Queue/outbox state visibility and dead-letter handling.",
      "Offline export and reconciliation workflow for finance/control teams."
    ]
  }
];

const notYet = [
  "No named customer logos published yet.",
  "No public case studies published yet.",
  "No fabricated traction metrics on the site."
];

export default function ProofPage() {
  return (
    <PageFrame>
      <section className="section-shell">
        <Card className="bg-gradient-to-br from-[rgba(255,253,248,0.96)] to-[rgba(248,241,230,0.92)]">
          <CardHeader>
            <Badge variant="accent" className="w-fit">Proof</Badge>
            <CardTitle className="text-[clamp(2rem,5vw,3.4rem)] leading-[1] tracking-[-0.02em]">
              Evidence first. Hype second.
            </CardTitle>
            <p className="max-w-4xl text-lg leading-relaxed text-[#354152]">
              We only publish claims we can verify today through artifacts, tests, and runbooks. Customer stories go live
              after customer approval, not before.
            </p>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              <a className={buttonClasses({ size: "lg" })} href={docsLinks.quickstart}>Run quickstart</a>
              <a className={buttonClasses({ variant: "outline", size: "lg" })} href={docsLinks.security}>Review controls</a>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="section-shell">
        <Card>
          <CardHeader>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#7f2f1f]">What We Can Prove Now</p>
            <CardTitle className="text-[clamp(1.6rem,3.8vw,2.5rem)] leading-tight tracking-[-0.02em]">
              Current public proof surface.
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Accordion type="single" collapsible className="grid gap-3">
              {evidencePillars.map((pillar) => (
                <AccordionItem key={pillar.id} value={pillar.id}>
                  <AccordionTrigger>{pillar.title}</AccordionTrigger>
                  <AccordionContent>
                    <ul className="tight-list mt-0">
                      {pillar.points.map((point) => (
                        <li key={point}>{point}</li>
                      ))}
                    </ul>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>
      </section>

      <section className="section-shell">
        <Card>
          <CardHeader>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#7f2f1f]">Transparency</p>
            <CardTitle className="text-[clamp(1.5rem,3.2vw,2.1rem)] leading-tight tracking-[-0.02em]">
              What is intentionally not on the site yet.
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="tight-list mt-0">
              {notYet.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </section>
    </PageFrame>
  );
}

