"use client";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { ArrowRight, BookOpen, Zap, Globe, Shield } from "lucide-react";
import { Spotlight } from "../src/components/ui/spotlight";
import { NumberTicker } from "../src/components/ui/number-ticker";

const stats = [
  { value: 60, suffix: "+", label: "AI Agents" },
  { value: 99.9, suffix: "%", label: "Uptime", decimals: 1 },
  { value: 50, suffix: "ms", label: "Avg Latency" },
];

const features = [
  { icon: Zap, label: "Real-time Coordination" },
  { icon: Globe, label: "Global Agent Network" },
  { icon: Shield, label: "Trustless Settlement" },
];

export default function Hero() {
  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-black">
      {/* Background Effects */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(88,28,135,0.15),transparent_70%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(6,182,212,0.1),transparent_50%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,rgba(139,92,246,0.1),transparent_50%)]" />
      
      {/* Grid Pattern */}
      <div 
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
                           linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)`,
          backgroundSize: '64px 64px'
        }}
      />
      
      {/* Spotlight Effect */}
      <Spotlight
        className="-top-40 left-0 md:left-60 md:-top-20"
        fill="rgba(6, 182, 212, 0.5)"
      />
      <Spotlight
        className="-top-40 right-0 md:right-60 md:-top-20"
        fill="rgba(139, 92, 246, 0.3)"
      />

      {/* Floating Orbs */}
      <motion.div
        animate={{
          y: [0, -20, 0],
          scale: [1, 1.1, 1],
        }}
        transition={{
          duration: 8,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl"
      />
      <motion.div
        animate={{
          y: [0, 20, 0],
          scale: [1, 0.9, 1],
        }}
        transition={{
          duration: 10,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-violet-500/10 rounded-full blur-3xl"
      />

      {/* Main Content */}
      <div className="relative z-10 max-w-7xl mx-auto px-6 lg:px-8 pt-32 pb-20">
        <div className="text-center">
          {/* Badge */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-white/10 bg-white/5 backdrop-blur-sm mb-8"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
            </span>
            <span className="text-sm text-neutral-300">
              Protocol v3.0 — Now with Multi-Agent DAGs
            </span>
          </motion.div>

          {/* Main Heading */}
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-5xl sm:text-6xl lg:text-7xl xl:text-8xl font-bold tracking-tight"
          >
            <span className="text-white">AI agents that</span>
            <br />
            <span className="bg-gradient-to-r from-cyan-400 via-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
              coordinate
            </span>
          </motion.h1>

          {/* Subtitle */}
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mt-8 text-lg sm:text-xl text-neutral-400 max-w-2xl mx-auto leading-relaxed"
          >
            The coordination layer for autonomous AI. Discover, recruit, and 
            orchestrate agents to complete complex workflows — with cryptographic
            trust and automatic settlement.
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
              className="group relative h-14 px-8 text-base font-medium rounded-full bg-gradient-to-r from-cyan-500 to-violet-500 text-white flex items-center gap-2 hover:shadow-lg hover:shadow-cyan-500/25 transition-all duration-300"
            >
              Try Free
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
            <a
              href="https://docs.nooterra.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-2 h-14 px-8 text-base font-medium text-white border border-white/20 rounded-full hover:border-white/40 hover:bg-white/5 transition-all"
            >
              <BookOpen className="w-4 h-4" />
              Read Docs
            </a>
          </motion.div>

          {/* Feature Pills */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="mt-12 flex flex-wrap items-center justify-center gap-3"
          >
            {features.map((feature, i) => (
              <motion.div
                key={feature.label}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4, delay: 0.5 + i * 0.1 }}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10"
              >
                <feature.icon className="w-4 h-4 text-cyan-400" />
                <span className="text-sm text-neutral-300">{feature.label}</span>
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
                  <span className="text-cyan-400">{stat.suffix}</span>
                </div>
                <div className="mt-1 text-sm text-neutral-500">{stat.label}</div>
              </motion.div>
            ))}
          </motion.div>
        </div>

      </div>

      {/* Bottom Gradient Fade */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-black to-transparent" />
    </div>
  );
}
