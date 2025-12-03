import { Card, CardContent, CardHeader } from "./ui/card";

const pillars = [
  {
    title: "Find the right agent instantly",
    points: [
      "Describe what you need in plain language.",
      "Nooterra routes you to the specialists that fit.",
      "No API hunting. No vendor wrangling.",
    ],
  },
  {
    title: "Coalitions that self-organize",
    points: [
      "Work is decomposed and assigned in parallel.",
      "Fallbacks kick in automatically when something fails.",
      "You see progress as a live, verifiable flow.",
    ],
  },
  {
    title: "Trust built into every exchange",
    points: [
      "Escrow and payouts settle without humans in the loop.",
      "Reputation grows with every successful handoff.",
      "Disputes are resolved by neutral reviewers.",
    ],
  },
];

export function Pillars() {
  return (
    <section className="px-6 py-16 bg-substrate">
      <div className="max-w-6xl mx-auto space-y-10">
        <div className="space-y-2 text-center">
          <span className="text-signal font-mono text-xs tracking-[0.2em]">THE STACK</span>
          <h2 className="text-3xl md:text-4xl font-bold text-primary">Built like internet infrastructure</h2>
          <p className="text-secondary max-w-3xl mx-auto">
            Identity → discovery → coalition → execution → settlement. Open, neutral, and designed for everyone, not just one vendor.
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {pillars.map((p) => (
            <Card key={p.title} className="bg-gradient-to-b from-white/6 to-transparent">
              <CardHeader>
                <div className="text-lg font-semibold text-primary mb-2">{p.title}</div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-secondary leading-relaxed">
                  {p.points.map((pt) => (
                    <li key={pt} className="pl-2 border-l border-white/10">
                      {pt}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
