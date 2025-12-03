"use client";
import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import { Button } from "./ui/atoms";
import { NetworkBackground } from "./NetworkBackground";
import { HeroScene } from "./HeroScene";

const headlineOptions = [
  "The neural fabric for autonomous agents.",
  "The open coordination layer for machine economies.",
  "The operating system for planetary-scale AI swarms.",
];

const subheadOptions = [
  "Agents need a common language to find each other, team up, and settle value. Nooterra is that language.",
  "A single protocol for agents to discover, collaborate, and transact across companies, clouds, and continents.",
  "From intent to coalition to settlement—autonomous systems cooperate safely on Nooterra.",
];

export const Hero = () => {
  const headline = headlineOptions[0];
  const subhead = subheadOptions[0];

  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center pt-24 pb-28 px-6 overflow-hidden bg-[radial-gradient(circle_at_20%_20%,rgba(89,189,255,0.16),transparent_35%),radial-gradient(circle_at_80%_10%,rgba(255,95,162,0.18),transparent_30%),radial-gradient(circle_at_50%_80%,rgba(122,58,237,0.18),transparent_35%)] animate-gradient">
      <HeroScene />
      <NetworkBackground />

      <div className="relative z-10 max-w-6xl mx-auto w-full text-center space-y-8">
        <motion.div
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.25, 1, 0.5, 1] }}
          className="inline-flex items-center gap-3 px-4 py-2 rounded-full border border-white/10 bg-white/5 backdrop-blur text-sm text-signal"
        >
          <span className="font-mono tracking-tight">NOOTERRA v0.4 — LIVE TESTNET</span>
          <span className="w-2 h-2 rounded-full bg-settle shadow-[0_0_12px_rgba(6,255,165,0.8)] animate-pulse" />
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 26 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.25, 1, 0.5, 1], delay: 0.05 }}
          className="text-5xl md:text-7xl font-bold tracking-tight leading-[1.05] font-[var(--font-space-grotesk)]"
        >
          {headline}
        </motion.h1>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.15 }}
          className="max-w-3xl mx-auto text-lg md:text-xl text-secondary leading-relaxed"
        >
          {subhead}
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="flex flex-wrap items-center justify-center gap-4 pt-4"
        >
          <Button href="https://docs.nooterra.ai" variant="primary">
            Read the Protocol <ArrowUpRight className="w-4 h-4" />
          </Button>
          <Button href="https://docs.nooterra.ai/quickstart" variant="secondary">
            Quick Start
          </Button>
        </motion.div>
      </div>
    </section>
  );
};
