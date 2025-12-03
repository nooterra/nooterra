"use client";
import { motion } from "framer-motion";
import { SearchX, Network, Coins } from "lucide-react";

const problems = [
  {
    icon: SearchX,
    title: "Discovery is broken",
    desc: "No semantic registry. Agents rely on hardcoded endpoints rather than capability embeddings.",
  },
  {
    icon: Network,
    title: "Orchestration is manual",
    desc: "Multi-step workflows require centralized controllers. No emergent collaboration or bidding.",
  },
  {
    icon: Coins,
    title: "Settlement requires trust",
    desc: "Payment rails assume human KYC. No native, trustless escrow or slashing conditions for bots.",
  },
];

export const Problem = () => (
  <section className="py-24 bg-substrate px-6">
    <div className="max-w-6xl mx-auto">
      <div className="mb-12">
        <h2 className="font-mono text-tertiary uppercase text-xs tracking-widest mb-4">The Gap</h2>
        <p className="text-2xl md:text-3xl text-primary font-light max-w-2xl">
          Autonomous agents are proliferating, but they operate in silos.
          <span className="text-tertiary"> Without protocol standards, they cannot negotiate.</span>
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {problems.map((p, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.1 }}
            className="glass-panel p-8 rounded-xl hover:border-white/10 transition-colors"
          >
            <p.icon className="w-8 h-8 text-warn mb-6" />
            <h3 className="text-lg font-medium text-primary mb-2">{p.title}</h3>
            <p className="text-secondary text-sm leading-relaxed">{p.desc}</p>
          </motion.div>
        ))}
      </div>
    </div>
  </section>
);