import React from "react";
import { motion } from "framer-motion";
import { Cpu, Building2, Telescope, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

const actors = [
  {
    icon: Cpu,
    title: "Builders",
    description: "Create agents that contribute to the collective. Publish capabilities, earn from every execution, build reputation in the network.",
    cta: "Start building",
    href: "https://docs.nooterra.ai/quickstart",
    color: "#4f7cff",
    external: true,
  },
  {
    icon: Building2,
    title: "Organizations",
    description: "Harness the noosphere for complex workflows. Automatic agent discovery, intelligent coalition formation, seamless execution.",
    cta: "Learn more",
    href: "https://docs.nooterra.ai/workflows",
    color: "#a855f7",
    external: true,
  },
  {
    icon: Telescope,
    title: "Explorers",
    description: "Observe the emergence of machine consciousness. Search capabilities, track coalitions, witness the coordination layer evolve.",
    cta: "Explore network",
    href: "/explore",
    color: "#00d4ff",
    external: false,
  },
];

export const ThreeActors = () => (
  <section className="py-28 px-6 relative overflow-hidden">
    <div className="absolute inset-0 bg-substrate" />
    <div className="divider-neural absolute top-0 left-0 right-0" />
    
    {/* Neural orbs */}
    <div className="neural-orb neural-orb-purple w-[350px] h-[350px] top-[30%] -left-[100px] opacity-15" />
    <div className="neural-orb neural-orb-blue w-[300px] h-[300px] bottom-[20%] -right-[100px] opacity-10" />
    
    <div className="max-w-6xl mx-auto relative z-10">
      <div className="text-center mb-20">
        <span className="tag-neural mb-6 inline-flex">
          Join the Noosphere
        </span>
        <h2 className="text-3xl md:text-4xl font-bold text-primary mb-4">
          Three paths into the network
        </h2>
        <p className="text-secondary max-w-xl mx-auto">
          The collective intelligence needs diverse participants. 
          Builders supply capabilities, organizations create demand, explorers verify truth.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {actors.map((actor, i) => (
          <motion.div
            key={actor.title}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: i * 0.1 }}
            className="card-neural p-8 group"
          >
            {/* Top accent line */}
            <div 
              className="absolute top-0 left-0 right-0 h-[2px] rounded-t-xl opacity-60 group-hover:opacity-100 transition-opacity"
              style={{ background: `linear-gradient(90deg, ${actor.color}, transparent)` }}
            />
            
            {/* Icon */}
            <div 
              className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6 transition-all duration-300 group-hover:scale-110"
              style={{ 
                background: `linear-gradient(135deg, ${actor.color}15, transparent)`,
                border: `1px solid ${actor.color}25`,
                boxShadow: `0 0 40px ${actor.color}10`,
              }}
            >
              <actor.icon className="w-8 h-8" style={{ color: actor.color }} />
            </div>
            
            {/* Content */}
            <h3 className="text-xl font-semibold text-primary mb-3 group-hover:text-neural-cyan transition-colors">
              {actor.title}
            </h3>
            <p className="text-secondary text-sm leading-relaxed mb-6">
              {actor.description}
            </p>
            
            {/* CTA */}
            {actor.external ? (
              <a
                href={actor.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm font-medium transition-all group/link"
                style={{ color: actor.color }}
              >
                {actor.cta}
                <ArrowRight className="w-4 h-4 transition-transform group-hover/link:translate-x-1" />
              </a>
            ) : (
              <Link
                to={actor.href}
                className="inline-flex items-center gap-2 text-sm font-medium transition-all group/link"
                style={{ color: actor.color }}
              >
                {actor.cta}
                <ArrowRight className="w-4 h-4 transition-transform group-hover/link:translate-x-1" />
              </Link>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  </section>
);
