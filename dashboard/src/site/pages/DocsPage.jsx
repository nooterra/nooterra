import PageFrame from "../components/PageFrame.jsx";
import { docsLinks } from "../config/links.js";
import { buttonClasses } from "../components/ui/button.jsx";
import { Badge } from "../components/ui/badge.jsx";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.jsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs.jsx";

const docsPaths = [
  {
    title: "Quickstart",
    summary: "Run first verified flow from authority to offline verification.",
    href: docsLinks.quickstart,
    badge: "Getting Started"
  },
  {
    title: "Integrations",
    summary: "MCP host patterns for Codex, Claude, Cursor, and OpenClaw.",
    href: docsLinks.integrations,
    badge: "Reference"
  },
  {
    title: "API Surface",
    summary: "Authorization, verification, receipts, reversal, and lifecycle endpoints.",
    href: docsLinks.api,
    badge: "Reference"
  },
  {
    title: "Security Model",
    summary: "Cryptographic guarantees, replay defense, and trust boundaries.",
    href: docsLinks.security,
    badge: "Reference"
  },
  {
    title: "Operations",
    summary: "Production runbooks, key management, and incident procedures.",
    href: docsLinks.ops,
    badge: "Runbook"
  },
  {
    title: "Control Plane Architecture",
    summary: "Primitive layers and deterministic state-machine model.",
    href: docsLinks.architecture,
    badge: "Architecture"
  }
];

const roleTracks = {
  founder: {
    title: "Founder / Product Lead",
    copy: "Understand what ships now, what’s next, and how to scope an open-source rollout.",
    links: [docsLinks.quickstart, docsLinks.roadmap, docsLinks.faq]
  },
  engineer: {
    title: "Engineer",
    copy: "Integrate quickly, then harden with deterministic verification and control loops.",
    links: [docsLinks.integrations, docsLinks.api, docsLinks.architecture]
  },
  security: {
    title: "Security / Compliance",
    copy: "Review trust boundaries, controls, and incident runbooks before cutover.",
    links: [docsLinks.security, docsLinks.ops, docsLinks.incidents]
  }
};

function formatLink(link) {
  if (link.includes("/quickstart/")) return "Open Quickstart";
  if (link.includes("/integrations/")) return "Open Integrations";
  if (link.includes("/api-surface/")) return "Open API Surface";
  if (link.includes("/control-plane/")) return "Open Architecture";
  if (link.includes("/security-model/")) return "Open Security Model";
  if (link.includes("/operations/")) return "Open Operations";
  if (link.includes("/incidents/")) return "Open Incident Runbook";
  if (link.includes("/roadmap/")) return "Open Roadmap";
  if (link.includes("/faq/")) return "Open FAQ";
  return "Open Doc";
}

export default function DocsPage() {
  return (
    <PageFrame>
      <section className="section-shell">
        <Card className="bg-gradient-to-br from-[rgba(255,253,248,0.96)] to-[rgba(248,241,230,0.92)]">
          <CardHeader>
            <Badge variant="accent" className="w-fit">Docs</Badge>
            <CardTitle className="text-[clamp(2.1rem,5.2vw,3.7rem)] leading-[1] tracking-[-0.02em]">
              Production docs for autonomous systems teams.
            </CardTitle>
            <p className="max-w-4xl text-lg leading-relaxed text-[#354152]">
              Settld docs are hosted on MkDocs. Use this page as your routing layer by role, then jump directly into the right section.
            </p>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              <a className={buttonClasses({ size: "lg" })} href={docsLinks.home}>Open full docs</a>
              <a className={buttonClasses({ variant: "outline", size: "lg" })} href={docsLinks.integrations}>Start with MCP</a>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="section-shell">
        <Card>
          <CardHeader>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#7f2f1f]">Start by Role</p>
            <CardTitle className="text-[clamp(1.7rem,3.8vw,2.6rem)] leading-tight tracking-[-0.02em]">
              Find your path in one click.
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="engineer" className="w-full">
              <TabsList>
                <TabsTrigger value="founder">Founder</TabsTrigger>
                <TabsTrigger value="engineer">Engineer</TabsTrigger>
                <TabsTrigger value="security">Security</TabsTrigger>
              </TabsList>
              {Object.entries(roleTracks).map(([key, track]) => (
                <TabsContent key={key} value={key}>
                  <Card className="border-[#e1d8c8] bg-[rgba(255,255,255,0.74)] shadow-none">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-2xl">{track.title}</CardTitle>
                      <p className="text-base text-[#354152]">{track.copy}</p>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-wrap gap-3">
                        {track.links.map((link) => (
                          <a key={link} className={buttonClasses({ variant: "outline", size: "sm" })} href={link}>
                            {formatLink(link)}
                          </a>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </Card>
      </section>

      <section className="section-shell">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {docsPaths.map((path) => (
            <Card key={path.title}>
              <CardHeader>
                <Badge variant="accent" className="w-fit">{path.badge}</Badge>
                <CardTitle className="text-2xl">{path.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed text-[#354152]">{path.summary}</p>
                <a className="mt-4 inline-block font-semibold text-[#7f2f1f]" href={path.href}>Open path</a>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </PageFrame>
  );
}
