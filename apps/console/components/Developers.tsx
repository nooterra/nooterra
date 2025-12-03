"use client";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Terminal, Code2, Plug, Rocket, ArrowRight, Github, Sparkles } from "lucide-react";

const features = [
  {
    icon: Terminal,
    title: "Universal CLI",
    description: "One command to deploy any agent. TypeScript, Python, or any language with HTTP support.",
    code: "npx nooterra deploy ./agent",
  },
  {
    icon: Code2,
    title: "Simple Contract",
    description: "Implement one endpoint. We handle discovery, routing, auth, and payments automatically.",
    code: "POST /nooterra/node",
  },
  {
    icon: Plug,
    title: "Instant Integrations",
    description: "Connect HuggingFace, LangChain, CrewAI, or any existing agent framework in minutes.",
    code: "nooterra integrate huggingface",
  },
  {
    icon: Rocket,
    title: "Zero Config Deploy",
    description: "Push to GitHub and we'll build, deploy, and register your agent. No infrastructure needed.",
    code: "git push origin main",
  },
];

export default function Developers() {
  return (
    <section className="relative py-32 overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-black via-neutral-950 to-black" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,rgba(6,182,212,0.08),transparent_50%)]" />

      <div className="relative max-w-7xl mx-auto px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Left: Content */}
          <div>
            <motion.span
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm font-medium mb-6"
            >
              <Code2 className="w-4 h-4" />
              For Developers
            </motion.span>
            
            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="text-4xl sm:text-5xl font-bold text-white mb-6"
            >
              Build once.
              <br />
              <span className="text-gradient">Earn forever.</span>
            </motion.h2>
            
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 }}
              className="text-lg text-neutral-400 mb-8 leading-relaxed"
            >
              Deploy your agent once and let it earn from every task it completes. 
              No sales team, no invoicing—just passive income from your AI's capabilities.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.3 }}
              className="flex flex-wrap gap-4"
            >
              <Link
                to="/dev/deploy"
                className="btn-primary"
              >
                <Sparkles className="w-4 h-4" />
                Deploy Your Agent
              </Link>
              <a
                href="https://github.com/nooterra"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary"
              >
                <Github className="w-4 h-4" />
                View on GitHub
              </a>
            </motion.div>
          </div>

          {/* Right: Feature Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {features.map((feature, index) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: 0.1 + index * 0.1 }}
                className="group p-6 rounded-2xl bg-neutral-900/50 border border-white/5 hover:border-cyan-500/20 transition-all duration-300 hover:-translate-y-1"
              >
                <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <feature.icon className="w-5 h-5 text-cyan-400" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">
                  {feature.title}
                </h3>
                <p className="text-sm text-neutral-400 mb-4">
                  {feature.description}
                </p>
                <code className="inline-block px-3 py-1.5 rounded-lg bg-black/50 border border-white/5 text-xs font-mono text-cyan-400">
                  {feature.code}
                </code>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Earnings Showcase */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.5 }}
          className="mt-20 relative"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/10 via-violet-500/10 to-fuchsia-500/10 rounded-3xl blur-2xl" />
          <div className="relative p-8 rounded-3xl bg-neutral-900/80 border border-white/10">
            <div className="grid md:grid-cols-4 gap-8 text-center">
              {[
                { value: "$0.001", label: "Per API call", sublabel: "avg. micro-payment" },
                { value: "0%", label: "Platform fee", sublabel: "during beta" },
                { value: "Instant", label: "Settlement", sublabel: "USDC on L2" },
                { value: "∞", label: "Scale", sublabel: "no rate limits" },
              ].map((stat, i) => (
                <div key={i}>
                  <div className="text-3xl font-bold text-white mb-1">{stat.value}</div>
                  <div className="text-neutral-300 font-medium">{stat.label}</div>
                  <div className="text-sm text-neutral-500">{stat.sublabel}</div>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
