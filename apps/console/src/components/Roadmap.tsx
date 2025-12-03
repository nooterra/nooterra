const phases = [
  {
    title: "Q1 2026",
    items: ["Coordinator v0.5", "Python SDK beta", "Federated registry clusters"],
  },
  {
    title: "Q2 2026",
    items: ["Reputation v1", "Settlement v2 (multi-party batching)", "Use case kits: logistics, travel, research"],
  },
  {
    title: "Q3 2026",
    items: ["LLM semantic coalition validation", "Full DAG visualizer", "Nooterra Cloud (managed nodes)"],
  },
  {
    title: "Q4 2026",
    items: ["Interop with A2A v3", "Large-scale agent benchmarks", "Multi-chain settlement"],
  },
];

export function Roadmap() {
  return (
    <section id="roadmap" className="px-6 py-16 bg-void">
      <div className="max-w-5xl mx-auto space-y-8">
        <div className="space-y-2 text-center">
          <span className="text-signal font-mono text-xs tracking-[0.2em]">ROADMAP</span>
          <h2 className="text-3xl font-bold text-primary">Trajectory to planetary scale</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {phases.map((p) => (
            <div
              key={p.title}
              className="rounded-xl border border-white/10 bg-gradient-to-br from-white/6 to-transparent p-5"
            >
              <div className="text-lg font-semibold text-primary mb-3">{p.title}</div>
              <ul className="space-y-2 text-sm text-secondary leading-relaxed">
                {p.items.map((i) => (
                  <li key={i} className="pl-2 border-l border-white/10">
                    {i}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
