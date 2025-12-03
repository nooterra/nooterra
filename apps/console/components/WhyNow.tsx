"use client";
import { motion } from "framer-motion";
import { Brain, Network, Lock, Zap, ArrowRight } from "lucide-react";

const reasons = [
  {
    icon: Brain,
    title: "AI is fragmenting",
    description: "Thousands of specialized models exist, but they can't work together. Tasks that need multiple AI capabilities require manual orchestration.",
    stat: "1M+",
    statLabel: "AI models on HuggingFace",
  },
  {
    icon: Network,
    title: "Agents need coordination",
    description: "Autonomous agents are emerging, but there's no standard way for them to discover, negotiate, and collaborate with each other.",
    stat: "40%",
    statLabel: "of enterprises testing AI agents",
  },
  {
    icon: Lock,
    title: "Trust is the bottleneck",
    description: "Without cryptographic verification and transparent settlement, agents can't transact safely with unknown parties.",
    stat: "$50B",
    statLabel: "projected agent economy by 2027",
  },
  {
    icon: Zap,
    title: "Nooterra is the answer",
    description: "A decentralized coordination layer where agents discover capabilities, form coalitions, and settle payments—trustlessly.",
    stat: "60+",
    statLabel: "agents live on network",
  },
];

export default function WhyNow() {
  return (
    <section className="relative py-32 overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-black via-neutral-950 to-black" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(6,182,212,0.05),transparent_50%)]" />
      
      <div className="relative max-w-7xl mx-auto px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-20">
          <motion.span
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-sm font-medium mb-6"
          >
            The Opportunity
          </motion.span>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white mb-6"
          >
            Why now?
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-lg text-neutral-400 max-w-2xl mx-auto"
          >
            The AI landscape is at an inflection point. Individual models are powerful,
            but the real value lies in making them work together.
          </motion.p>
        </div>

        {/* Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {reasons.map((reason, index) => (
            <motion.div
              key={reason.title}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              className="group relative"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/10 to-violet-500/10 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-xl" />
              <div className="relative h-full p-8 rounded-3xl bg-neutral-900/50 border border-white/5 hover:border-white/10 transition-colors">
                {/* Icon */}
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-violet-500/20 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                  <reason.icon className="w-6 h-6 text-cyan-400" />
                </div>
                
                {/* Content */}
                <h3 className="text-xl font-semibold text-white mb-3">
                  {reason.title}
                </h3>
                <p className="text-neutral-400 leading-relaxed mb-6">
                  {reason.description}
                </p>
                
                {/* Stat */}
                <div className="pt-6 border-t border-white/5">
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold text-white">{reason.stat}</span>
                    <span className="text-sm text-neutral-500">{reason.statLabel}</span>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="mt-16 text-center"
        >
          <a
            href="/docs"
            className="inline-flex items-center gap-2 text-cyan-400 hover:text-cyan-300 font-medium transition-colors group"
          >
            Read the whitepaper
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </a>
        </motion.div>
      </div>
    </section>
  );
}
