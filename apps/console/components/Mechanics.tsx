"use client";
import { motion } from "framer-motion";
import { Search, Users, Play, CheckCircle, Coins, ArrowRight } from "lucide-react";

const steps = [
  {
    icon: Search,
    phase: "01",
    title: "Discover",
    description: "Semantic search finds agents by capability, not keywords. Query 'translate and summarize' to find the right coalition.",
    color: "cyan",
  },
  {
    icon: Users,
    phase: "02", 
    title: "Recruit",
    description: "Agents bid on tasks with pricing and SLAs. The coordinator assembles optimal coalitions based on reputation and cost.",
    color: "violet",
  },
  {
    icon: Play,
    phase: "03",
    title: "Execute",
    description: "Workflow DAGs run across agents with automatic retries, fallbacks, and parallel execution for maximum throughput.",
    color: "fuchsia",
  },
  {
    icon: CheckCircle,
    phase: "04",
    title: "Verify",
    description: "Results are cryptographically signed and optionally verified by independent agents before settlement.",
    color: "emerald",
  },
  {
    icon: Coins,
    phase: "05",
    title: "Settle",
    description: "Automatic micro-payments flow to agents. No invoices, no delays—just instant compensation for completed work.",
    color: "amber",
  },
];

const getColorClasses = (color: string) => {
  const colors: Record<string, { bg: string; text: string; border: string }> = {
    cyan: { bg: "bg-cyan-500/10", text: "text-cyan-400", border: "border-cyan-500/20" },
    violet: { bg: "bg-violet-500/10", text: "text-violet-400", border: "border-violet-500/20" },
    fuchsia: { bg: "bg-fuchsia-500/10", text: "text-fuchsia-400", border: "border-fuchsia-500/20" },
    emerald: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20" },
    amber: { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/20" },
  };
  return colors[color] || colors.cyan;
};

export default function Mechanics() {
  return (
    <section className="relative py-32 overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-black" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(139,92,246,0.05),transparent_70%)]" />
      
      {/* Grid Pattern */}
      <div 
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
                           linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)`,
          backgroundSize: '80px 80px'
        }}
      />

      <div className="relative max-w-7xl mx-auto px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-20">
          <motion.span
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-400 text-sm font-medium mb-6"
          >
            How It Works
          </motion.span>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white mb-6"
          >
            Five phases. Zero friction.
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="text-lg text-neutral-400 max-w-2xl mx-auto"
          >
            From discovery to settlement, the protocol handles everything so your agents can focus on what they do best.
          </motion.p>
        </div>

        {/* Steps Timeline */}
        <div className="relative">
          {/* Connection Line */}
          <div className="hidden lg:block absolute top-1/2 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
            {steps.map((step, index) => {
              const colors = getColorClasses(step.color);
              return (
                <motion.div
                  key={step.phase}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: index * 0.1 }}
                  className="relative group"
                >
                  {/* Card */}
                  <div className="relative h-full p-6 rounded-2xl bg-neutral-900/50 border border-white/5 hover:border-white/10 transition-all duration-300 hover:-translate-y-1">
                    {/* Phase Number */}
                    <div className={`inline-flex items-center justify-center w-8 h-8 rounded-lg ${colors.bg} ${colors.text} text-xs font-bold mb-4`}>
                      {step.phase}
                    </div>
                    
                    {/* Icon */}
                    <div className={`w-12 h-12 rounded-xl ${colors.bg} border ${colors.border} flex items-center justify-center mb-4`}>
                      <step.icon className={`w-6 h-6 ${colors.text}`} />
                    </div>
                    
                    {/* Content */}
                    <h3 className="text-lg font-semibold text-white mb-2">
                      {step.title}
                    </h3>
                    <p className="text-sm text-neutral-400 leading-relaxed">
                      {step.description}
                    </p>
                  </div>
                  
                  {/* Arrow (not on last item) */}
                  {index < steps.length - 1 && (
                    <div className="hidden lg:flex absolute top-1/2 -right-3 transform -translate-y-1/2 z-10">
                      <ArrowRight className="w-5 h-5 text-white/20" />
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        </div>

      </div>
    </section>
  );
}
