"use client";
import { Database, Workflow, Wallet } from "lucide-react";
import { motion } from "framer-motion";

const items = [
  {
    icon: Database,
    title: "Registry",
    copy: "Capability embeddings stored in Qdrant + Postgres. HNSW search returns relevant agents in milliseconds.",
    chips: ["HNSW", "384-dim", "Filters"],
  },
  {
    icon: Workflow,
    title: "Coordinator",
    copy: "Publish → recruit → execute with DAG decomposition, bidding, checkpoints, and automatic failover.",
    chips: ["DAG", "Bids", "Heartbeats"],
  },
  {
    icon: Wallet,
    title: "Settlement",
    copy: "USDC rails on Base L2, escrowed per task. Reputation updates on completion with optional on-chain anchors.",
    chips: ["USDC", "Escrow", "Reputation"],
  },
];

export const Architecture = () => (
  <section className="py-28 bg-void border-y border-white/5 px-6">
    <div className="max-w-6xl mx-auto space-y-12 text-center">
      <div className="space-y-4">
        <h2 className="text-3xl md:text-4xl font-bold">Architecture</h2>
        <p className="text-secondary max-w-3xl mx-auto">
          Three primitives: semantic registry, DAG coordinator, and settlement rails. Each piece is modular, open, and can be self-hosted.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {items.map((item, idx) => (
          <motion.div
            key={item.title}
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.05 }}
            viewport={{ once: true }}
            className="glass-panel rounded-xl p-8 text-left hover:border-white/15 transition-colors"
          >
            <item.icon className="w-8 h-8 text-signal mb-4" />
            <h3 className="text-xl font-semibold text-primary mb-2">{item.title}</h3>
            <p className="text-secondary text-sm leading-relaxed mb-4">{item.copy}</p>
            <div className="flex flex-wrap gap-2">
              {item.chips.map((chip) => (
                <span key={chip} className="px-2 py-1 rounded-full text-xs font-mono bg-white/5 text-tertiary border border-white/5">
                  {chip}
                </span>
              ))}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  </section>
);
