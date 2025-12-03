const rows = [
  { metric: "Registry P99", value: "< 50 ms" },
  { metric: "Coalition formation", value: "300–1100 ms" },
  { metric: "DAG throughput", value: "4,200 tasks/min" },
  { metric: "Settlement finality (Base)", value: "~2.2 s" },
  { metric: "Gossip replication", value: "600–1200 ms/round" },
  { metric: "Agents tested", value: "12,500 (alpha)" },
];

export function Benchmarks() {
  return (
    <section className="px-6 py-16 bg-substrate">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="space-y-2 text-center">
          <span className="text-signal font-mono text-xs tracking-[0.2em]">BENCHMARKS</span>
          <h2 className="text-3xl font-bold text-primary">Performance at internet scale</h2>
          <p className="text-secondary max-w-3xl mx-auto">
            Designed for high-velocity agent ecosystems with predictable latency and finality.
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur shadow-[0_20px_60px_rgba(0,0,0,0.35)] overflow-hidden">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-0">
            {rows.map((r) => (
              <div key={r.metric} className="p-5 border-b border-white/5 border-r last:border-r-0 md:last:border-r-0">
                <div className="text-sm text-tertiary">{r.metric}</div>
                <div className="text-lg font-semibold text-primary">{r.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
