import { Card } from "./ui/card.jsx";

export default function Vision() {
  return (
    <section className="section-shell">
      <div className="mb-6 max-w-4xl">
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-[#7f2f1f]">Developer Section</p>
        <h2 className="text-[clamp(1.9rem,4.2vw,3rem)] font-bold leading-tight tracking-[-0.02em] text-[#1b2430]">
          From zero to verified in minutes.
        </h2>
        <p className="mt-4 text-lg leading-relaxed text-[#354152]">
          Total operational freedom with absolute cryptographic accountability. The runtime for the autonomous economy
          is a single command away.
        </p>
      </div>
      <Card className="bg-gradient-to-br from-[rgba(255,253,248,0.96)] to-[rgba(248,241,230,0.92)]">
        <h3 className="text-2xl font-bold leading-tight text-[#1b2430]">Command Line</h3>
        <div className="mini-code">
          <code>$ npx settld dev up</code>
          <code>✓ API running</code>
          <code>✓ Control surfaces online</code>
          <code>✓ Ready for first verified flow</code>
        </div>
      </Card>
    </section>
  );
}
