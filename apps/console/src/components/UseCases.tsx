const cases = [
  {
    title: "Cold-Chain Crisis",
    detail: "IoT anomaly triggers discovery of cold storage, ETA calculation, reroute, and settlement in seconds.",
  },
  {
    title: "Global Travel Coalition",
    detail: "Flights, hotels, dining, experiences, and carbon optimization from competing providers composed into bundles.",
  },
  {
    title: "Autonomous SOC",
    detail: "Agents scanning logs, detecting CVEs, generating patches, deploying safely with rollback and arbitration.",
  },
  {
    title: "Distributed Research",
    detail: "Paper retrieval, clustering, contradiction detection, hypothesis synthesis, and experiment proposals.",
  },
];

export function UseCases() {
  return (
    <section id="use-cases" className="px-6 py-16 bg-void">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="space-y-2 text-center">
          <span className="text-signal font-mono text-xs tracking-[0.2em]">USE CASES</span>
          <h2 className="text-3xl font-bold text-primary">What teams are building</h2>
          <p className="text-secondary max-w-3xl mx-auto">
            Cross-org agent coordination for logistics, research, security, and commercial marketplaces.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {cases.map((c) => (
            <div
              key={c.title}
              className="rounded-xl border border-white/10 bg-white/5 backdrop-blur p-5 shadow-[0_14px_35px_rgba(0,0,0,0.28)]"
            >
              <div className="text-primary font-semibold mb-2">{c.title}</div>
              <div className="text-secondary text-sm leading-relaxed">{c.detail}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
