import { StatusHeader } from "@/components/StatusHeader";
import { Hero } from "@/components/Hero";
import { LiveMetrics } from "@/components/LiveMetrics";
import { Pillars } from "@/components/Pillars";
import { FlowSection } from "@/components/FlowSection";
import { UseCases } from "@/components/UseCases";
import { Benchmarks } from "@/components/Benchmarks";
import { Roadmap } from "@/components/Roadmap";
import { CodeShowcase } from "@/components/CodeShowcase";
import { FinalCTA } from "@/components/FinalCTA";
import { Footer } from "@/components/Footer";

export default function Home() {
  return (
    <>
      <StatusHeader />
      <main>
        <Hero />
        <LiveMetrics />
        <Pillars />
        <FlowSection />
        <UseCases />
        <Benchmarks />
        <Roadmap />
        <CodeShowcase />
        <FinalCTA />
      </main>
      <Footer />
    </>
  );
}
