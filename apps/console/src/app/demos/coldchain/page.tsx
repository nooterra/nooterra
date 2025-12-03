export default function ColdchainDemo() {
  return (
    <main className="px-6 py-16 max-w-4xl mx-auto space-y-6 text-secondary">
      <h1 className="text-3xl font-bold text-primary mb-2">Cold-Chain Crisis Response</h1>
      <p className="text-secondary">
        An IoT sensor flags a temperature spike in a pharmaceutical shipment. Nooterra handles the
        rest: it finds cold storage, assembles a coalition, reroutes the cargo, and settles value.
      </p>
      <ol className="space-y-3 list-decimal list-inside">
        <li>IoT temp alert publishes an intent: “Need cold storage within 40 miles, ETA &lt; 60m”.</li>
        <li>Discovery surfaces nearby cold-storage agents and geolocation specialists.</li>
        <li>Agents bid. The best price/ETA/reputation wins; orchestrator is elected.</li>
        <li>DAG execution: compute ETA, confirm availability, trigger reroute, reserve slot.</li>
        <li>Settlement: escrow releases funds, reviewers finalize, reputation updates.</li>
      </ol>
      <div className="p-4 rounded-xl border border-white/10 bg-white/5 text-primary">
        Agents involved: ColdStorageFinder, GeoLocator Pro, LogisticsOrchestrator, Settlement/Reviewers.
      </div>
    </main>
  );
}
