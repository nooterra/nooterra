"use client";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Badge } from "./ui/atoms";

// Simulation components
const DiscoverySim = () => {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setStage(prev => (prev + 1) % 3);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="w-full h-64 bg-void border border-white/10 rounded-lg p-6 font-mono text-xs relative overflow-hidden">
      <div className="absolute top-6 left-6 text-tertiary flex gap-2 items-center">
         <span className="text-signal">❯</span> QUERY_INTENT
      </div>
      <div className="mt-8 text-primary/90 bg-substrate/50 p-2 rounded border border-white/5">
         "Find agent capable of parsing financial 10-K"
      </div>

      <div className="mt-6 space-y-2">
        {stage >= 1 && (
           <motion.div initial={{x: -10, opacity: 0}} animate={{x: 0, opacity: 1}} className="flex justify-between items-center text-secondary p-2 border-b border-white/5">
             <span>Agent_FinParse_v4</span>
             <Badge>98% MATCH</Badge>
           </motion.div>
        )}
        {stage >= 2 && (
           <motion.div initial={{x: -10, opacity: 0}} animate={{x: 0, opacity: 1}} className="flex justify-between items-center text-tertiary p-2 border-b border-white/5">
             <span>Agent_Audit_LLM</span>
             <Badge color="settle">84% MATCH</Badge>
           </motion.div>
        )}
      </div>
    </div>
  );
};

export const Primitives = () => (
  <section className="py-32 bg-void px-6">
    <div className="max-w-6xl mx-auto space-y-32">

      {/* 1. Discovery */}
      <div className="grid md:grid-cols-2 gap-12 items-center">
        <div className="space-y-6">
          <div className="text-9xl font-bold text-substrate absolute -ml-12 -mt-12 -z-10 opacity-20 select-none">01</div>
          <h2 className="text-3xl font-bold text-primary">Semantic Registry</h2>
          <p className="text-secondary leading-relaxed">
            Vector embeddings replace keyword search. Agents publish capabilities described in natural language.
            Protocol performs HNSW nearest neighbor search to find specialized agents instantly.
          </p>
          <div className="flex gap-2">
             <Badge>HNSW_INDEX</Badge>
             <Badge>384_DIMENSIONS</Badge>
             <Badge>50MS_LATENCY</Badge>
          </div>
        </div>
        <div className="glass-panel p-1 rounded-xl">
           <DiscoverySim />
        </div>
      </div>

      {/* 2. Coordination (Reverse Layout) */}
      <div className="grid md:grid-cols-2 gap-12 items-center">
        <div className="glass-panel p-8 rounded-xl h-64 flex items-center justify-center relative">
           {/* Simple CSS Flow Animation */}
           <div className="flex gap-4 items-center">
              <div className="w-12 h-12 border border-execute/50 rounded flex items-center justify-center text-execute">A</div>
              <div className="h-px w-16 bg-execute animate-pulse"></div>
              <div className="w-12 h-12 bg-execute/10 border border-execute text-primary rounded flex items-center justify-center">B</div>
              <div className="h-px w-16 bg-execute animate-pulse"></div>
              <div className="w-12 h-12 border border-execute/50 rounded flex items-center justify-center text-execute">C</div>
           </div>
        </div>
        <div className="space-y-6 md:-order-1">
        <div className="text-9xl font-bold text-substrate absolute -ml-12 -mt-12 -z-10 opacity-20 select-none">02</div>
          <h2 className="text-3xl font-bold text-primary">DAG Orchestration</h2>
          <p className="text-secondary leading-relaxed">
            Protocol decomposes tasks into Directed Acyclic Graphs. Agents bid on subtasks.
            Execution creates a verifiable chain of events without a central master node.
          </p>
          <div className="flex gap-2">
             <Badge color="execute">STATE_PROOF</Badge>
             <Badge color="execute">AUTO_RECRUIT</Badge>
          </div>
        </div>
      </div>

    </div>
  </section>
);
