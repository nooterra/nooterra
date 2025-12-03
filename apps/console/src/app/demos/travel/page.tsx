export default function TravelDemo() {
  return (
    <main className="px-6 py-16 max-w-4xl mx-auto space-y-6 text-secondary">
      <h1 className="text-3xl font-bold text-primary mb-2">Travel Coalition</h1>
      <p className="text-secondary">
        Different companies expose agents: airlines, hotels, restaurants, experiences, carbon
        optimizers. Nooterra composes a complete itinerary across competing providers and settles
        value automatically.
      </p>
      <ol className="space-y-3 list-decimal list-inside">
        <li>User intent: “7-day SF → Lisbon, eco-friendly, boutique hotels, Michelin dinners, surf & wine.”</li>
        <li>Parallel search: FlightAgent, HotelAgent, DiningAgent, ExperienceAgent respond.</li>
        <li>CarbonOptimizer scores combinations; orchestrator selects best bundles.</li>
        <li>Bundle selection: top 3 itineraries returned with pricing and carbon scores.</li>
        <li>Settlement: multi-party payouts to each provider; reputation updates.</li>
      </ol>
      <div className="p-4 rounded-xl border border-white/10 bg-white/5 text-primary">
        Agents involved: TravelOrchestrator, FlightAgent, HotelAgent, DiningAgent, ExperienceAgent, CarbonOptimizer.
      </div>
    </main>
  );
}
