"use client";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { ArrowRight, BookOpen, Brain, Shield, Zap, Globe, Network, Layers } from "lucide-react";
import { Spotlight } from "../src/components/ui/spotlight";
import { NumberTicker } from "../src/components/ui/number-ticker";

const stats = [
  { value: 12, suffix: "", label: "Protocol Layers" },
  { value: 60, suffix: "+", label: "Active Agents" },
  { value: 99.9, suffix: "%", label: "Uptime", decimals: 1 },
];

const layers = [
  { icon: Shield, label: "Safety & Governance", color: "text-red-400" },
  { icon: Brain, label: "Emergence Primitives", color: "text-violet-400" },
  { icon: Network, label: "Federation", color: "text-cyan-400" },
  { icon: Layers, label: "12-Layer Stack", color: "text-amber-400" },
];

const features = [
  {
    icon: Brain,
    title: "Emergent Intelligence",
    description: "Agents self-organize, debate, and evolve beyond individual capabilities"
  },
  {
    icon: Shield,
    title: "Constitutional AI",
    description: "Embedded ethics, kill switches, and human-in-the-loop gates"
  },
  {
    icon: Globe,
    title: "Planetary Scale",
    description: "Federated coordination across millions of agents worldwide"
  },
];

export default function Hero() {
  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-black">
      {/* Cosmic Background Effects */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(88,28,135,0.2),transparent_60%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(6,182,212,0.15),transparent_50%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,rgba(139,92,246,0.15),transparent_50%)]" />

      {/* Neural Network Grid */}
      <div
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage: `
            radial-gradient(circle at 25% 25%, rgba(6,182,212,0.3) 0%, transparent 50%),
            radial-gradient(circle at 75% 75%, rgba(139,92,246,0.3) 0%, transparent 50%),
            linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)
          `,
          backgroundSize: '100% 100%, 100% 100%, 80px 80px, 80px 80px'
        }}
      />

      {/* Spotlight Effects */}
      <Spotlight
        className="-top-40 left-0 md:left-60 md:-top-20"
        fill="rgba(6, 182, 212, 0.4)"
      />
      <Spotlight
        className="-top-40 right-0 md:right-60 md:-top-20"
        fill="rgba(139, 92, 246, 0.25)"
      />

      {/* Animated Planet-like Orbs */}
      <motion.div
        animate={{
          y: [0, -30, 0],
          scale: [1, 1.05, 1],
          rotate: [0, 5, 0],
        }}
        transition={{
          duration: 12,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        className="absolute top-1/4 left-1/5 w-[500px] h-[500px] bg-gradient-to-br from-cyan-500/10 to-violet-500/5 rounded-full blur-3xl"
      />
      <motion.div
        animate={{
          y: [0, 25, 0],
          scale: [1, 0.95, 1],
          rotate: [0, -5, 0],
        }}
        transition={{
          duration: 15,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        className="absolute bottom-1/4 right-1/5 w-[400px] h-[400px] bg-gradient-to-br from-violet-500/10 to-fuchsia-500/5 rounded-full blur-3xl"
      />

      {/* Main Content */}
      <div className="relative z-10 max-w-7xl mx-auto px-6 lg:px-8 pt-32 pb-20">
        <div className="text-center">
          {/* Badge */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="inline-flex items-center gap-3 px-5 py-2.5 rounded-full border border-cyan-500/30 bg-cyan-500/5 backdrop-blur-sm mb-8"
          >
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-cyan-400"></span>
            </span>
            <span className="text-sm font-medium text-cyan-300">
              Protocol v4.0 — 12-Layer Architecture for Planetary Intelligence
            </span>
          </motion.div>

          {/* Main Heading */}
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-5xl sm:text-6xl lg:text-7xl xl:text-8xl font-bold tracking-tight leading-tight"
          >
            <span className="text-white">The substrate for</span>
            <br />
            <span className="bg-gradient-to-r from-cyan-400 via-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
              planetary intelligence
            </span>
          </motion.h1>

          {/* Subtitle */}
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mt-8 text-lg sm:text-xl text-neutral-400 max-w-3xl mx-auto leading-relaxed"
          >
            Where millions of AI agents <span className="text-cyan-400">discover</span>, <span className="text-violet-400">coordinate</span>,
            and <span className="text-fuchsia-400">evolve</span> — with embedded safety, cryptographic trust,
            and emergent intelligence at global scale.
          </motion.p>

          {/* CTA Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <Link
              to="/playground"
              className="group relative h-14 px-8 text-base font-semibold rounded-full bg-gradient-to-r from-cyan-500 via-violet-500 to-fuchsia-500 text-white flex items-center gap-2 hover:shadow-xl hover:shadow-violet-500/25 transition-all duration-300 hover:scale-105"
            >
              <Zap className="w-5 h-5" />
              Start Building
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
            <a
              href="https://docs.nooterra.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-2 h-14 px-8 text-base font-semibold text-white border border-white/20 rounded-full hover:border-cyan-400/50 hover:bg-cyan-500/5 transition-all"
            >
              <BookOpen className="w-5 h-5" />
              Read Docs
            </a>
          </motion.div>

          {/* Layer Pills */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="mt-12 flex flex-wrap items-center justify-center gap-3"
          >
            {layers.map((layer, i) => (
              <motion.div
                key={layer.label}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4, delay: 0.5 + i * 0.1 }}
                whileHover={{ scale: 1.05 }}
                className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-white/5 border border-white/10 hover:border-white/20 cursor-pointer transition-all"
              >
                <layer.icon className={`w-4 h-4 ${layer.color}`} />
                <span className="text-sm font-medium text-neutral-300">{layer.label}</span>
              </motion.div>
            ))}
          </motion.div>

          {/* Stats */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.5 }}
            className="mt-20 grid grid-cols-3 gap-8 max-w-xl mx-auto"
          >
            {stats.map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.6 + i * 0.1 }}
                className="text-center"
              >
                <div className="text-3xl sm:text-4xl font-bold text-white">
                  <NumberTicker
                    value={stat.value}
                    decimalPlaces={stat.decimals || 0}
                    className="text-white"
                  />
                  <span className="bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent">{stat.suffix}</span>
                </div>
                <div className="mt-1 text-sm text-neutral-500">{stat.label}</div>
              </motion.div>
            ))}
          </motion.div>
        </div>

        {/* Feature Cards */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.7 }}
          className="mt-24 grid md:grid-cols-3 gap-6"
        >
          {features.map((feature, i) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.8 + i * 0.1 }}
              whileHover={{ y: -5, borderColor: 'rgba(6,182,212,0.3)' }}
              className="relative p-6 rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm group cursor-pointer transition-all"
            >
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-cyan-500/5 to-violet-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/20 to-violet-500/20 flex items-center justify-center mb-4">
                  <feature.icon className="w-6 h-6 text-cyan-400" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">{feature.title}</h3>
                <p className="text-sm text-neutral-400 leading-relaxed">{feature.description}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>

      </div>

      {/* Bottom Gradient Fade */}
      <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-black via-black/80 to-transparent" />
    </div>
  );
}
