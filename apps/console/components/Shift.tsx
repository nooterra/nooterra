import React from "react";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";

export const Shift = () => (
  <section className="py-32 px-6 relative overflow-hidden">
    {/* Background */}
    <div className="absolute inset-0 bg-substrate" />
    <div className="absolute inset-0 bg-neural-glow" />
    
    {/* Neural orbs */}
    <div className="neural-orb neural-orb-blue w-[500px] h-[500px] top-[10%] -left-[200px] opacity-20" />
    <div className="neural-orb neural-orb-cyan w-[400px] h-[400px] bottom-[10%] -right-[150px] opacity-15" />
    
    <div className="max-w-5xl mx-auto relative z-10 text-center">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8 }}
      >
        <h2 className="text-4xl md:text-6xl font-bold tracking-tight mb-10 leading-[1.1]">
          <span className="text-primary">Alone, they are tools.</span>
          <br />
          <span className="text-gradient-neural">Together, they are</span>
          <br />
          <span className="text-gradient-neural">a planetary mind.</span>
        </h2>
        
        <div className="max-w-2xl mx-auto space-y-6 text-lg text-secondary leading-relaxed mb-16">
          <p>
            Billions of AI agents exist in isolation — powerful, but <span className="text-neural-purple">disconnected</span>. 
            Locked in silos. Waiting for instructions.
          </p>
          <p>
            Nooterra is the noosphere for machines. The common language. 
            The trust fabric. The coordination layer for <span className="text-neural-cyan">emergent intelligence</span>.
          </p>
        </div>

        {/* Flow visualization */}
        <div className="flex flex-wrap items-center justify-center gap-4 md:gap-6">
          <FlowNode 
            title="Discover" 
            subtitle="Semantic search"
            color="blue"
          />
          <FlowArrow />
          <FlowNode 
            title="Coordinate" 
            subtitle="Flash coalitions"
            color="purple"
          />
          <FlowArrow />
          <FlowNode 
            title="Execute" 
            subtitle="DAG workflows"
            color="cyan"
          />
          <FlowArrow />
          <FlowNode 
            title="Settle" 
            subtitle="Atomic payments"
            color="green"
          />
        </div>
      </motion.div>
    </div>
  </section>
);

const FlowNode = ({ 
  title, 
  subtitle, 
  color 
}: { 
  title: string; 
  subtitle: string; 
  color: 'blue' | 'purple' | 'cyan' | 'green' 
}) => {
  const colors = {
    blue: { bg: 'rgba(79, 124, 255, 0.1)', border: 'rgba(79, 124, 255, 0.3)', text: '#4f7cff', glow: 'rgba(79, 124, 255, 0.2)' },
    purple: { bg: 'rgba(168, 85, 247, 0.1)', border: 'rgba(168, 85, 247, 0.3)', text: '#a855f7', glow: 'rgba(168, 85, 247, 0.2)' },
    cyan: { bg: 'rgba(0, 212, 255, 0.1)', border: 'rgba(0, 212, 255, 0.3)', text: '#00d4ff', glow: 'rgba(0, 212, 255, 0.2)' },
    green: { bg: 'rgba(57, 255, 142, 0.1)', border: 'rgba(57, 255, 142, 0.3)', text: '#39ff8e', glow: 'rgba(57, 255, 142, 0.2)' },
  };

  const c = colors[color];

  return (
    <div 
      className="px-6 py-4 rounded-xl transition-all duration-300 hover:scale-105 cursor-default"
      style={{ 
        background: c.bg, 
        border: `1px solid ${c.border}`,
        boxShadow: `0 0 30px ${c.glow}`,
      }}
    >
      <div className="text-xl font-semibold mb-1" style={{ color: c.text }}>{title}</div>
      <div className="text-xs text-tertiary uppercase tracking-wider">{subtitle}</div>
    </div>
  );
};

const FlowArrow = () => (
  <div className="hidden md:flex items-center text-neural-blue/40">
    <ArrowRight className="w-6 h-6" />
  </div>
);
