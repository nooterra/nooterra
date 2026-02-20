import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.jsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs.jsx";

const primitiveDetail = {
  identity: {
    title: "Identity + Delegation",
    copy: "Bounded authority for sponsors, agents, and operators with explicit lineage and revocation.",
    bullets: [
      "Delegation lineage checks before execution",
      "Policy scopes and capability allowlists",
      "Lifecycle-aware expiry and revocation"
    ]
  },
  execution: {
    title: "Execution + Escalation",
    copy: "Deterministic command flow with policy gates and signed human overrides when needed.",
    bullets: [
      "Quote -> authorize -> execute -> verify",
      "Suspend/resume state for blocked actions",
      "One-time cryptographic override tokens"
    ]
  },
  economics: {
    title: "Economics + Unwind",
    copy: "Bounded spend and deterministic unwind logic when agents become invalid or insolvent.",
    bullets: [
      "Replay-safe bounded authorizations",
      "Automatic freeze and pending state unwind",
      "Reversal dispatch with retry and dead-letter safety"
    ]
  },
  evidence: {
    title: "Evidence + Verification",
    copy: "Portable proof artifacts for audit, dispute resolution, and offline independent verification.",
    bullets: [
      "Immutable receipts + append-only timeline",
      "Closepack export with offline verifier path",
      "Proof-gated settlement for digital labor"
    ]
  }
};

export default function KernelNow() {
  return (
    <section id="platform" className="section-shell">
      <Card>
        <CardHeader>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#7f2f1f]">Core Capabilities</p>
          <CardTitle className="text-[clamp(1.9rem,4.4vw,3.2rem)] leading-tight tracking-[-0.02em]">
            Freedom for agents. Trust for operators.
          </CardTitle>
          <p className="text-lg leading-relaxed text-[#354152]">
            The primitives required for real-world autonomous systems, delivered as one deterministic control plane.
          </p>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="identity" className="w-full">
            <TabsList>
              <TabsTrigger value="identity">Identity</TabsTrigger>
              <TabsTrigger value="execution">Execution</TabsTrigger>
              <TabsTrigger value="economics">Economics</TabsTrigger>
              <TabsTrigger value="evidence">Evidence</TabsTrigger>
            </TabsList>
            {Object.entries(primitiveDetail).map(([key, section]) => (
              <TabsContent key={key} value={key}>
                <Card className="border-[#e1d8c8] bg-[rgba(255,255,255,0.74)] shadow-none">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-2xl">{section.title}</CardTitle>
                    <p className="text-base text-[#354152]">{section.copy}</p>
                  </CardHeader>
                  <CardContent>
                    <ul className="tight-list mt-0">
                      {section.bullets.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </section>
  );
}

