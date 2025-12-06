"use client";
import { motion } from "framer-motion";
import { Shield, Brain, Globe, Network, Layers, Zap, Eye, Coins, MessageSquare, Database, Scale, Users } from "lucide-react";

const layers = [
    { num: 12, name: "Ecosystem Dynamics", desc: "Bounty markets, demand signals", icon: Scale, color: "from-rose-500/20 to-pink-500/20", iconColor: "text-rose-400" },
    { num: 11, name: "Human-Agent Interface", desc: "Intent translation, approvals", icon: Users, color: "from-orange-500/20 to-amber-500/20", iconColor: "text-orange-400" },
    { num: 10, name: "Emergence Primitives", desc: "Swarms, debate, meta-learning", icon: Brain, color: "from-violet-500/20 to-purple-500/20", iconColor: "text-violet-400" },
    { num: 9, name: "Scalability & Federation", desc: "Sharding, multi-region", icon: Network, color: "from-blue-500/20 to-indigo-500/20", iconColor: "text-blue-400" },
    { num: 8, name: "Observability", desc: "Tracing, anomaly detection", icon: Eye, color: "from-sky-500/20 to-cyan-500/20", iconColor: "text-sky-400" },
    { num: 7, name: "Safety & Governance", desc: "Constitutional AI, kill switch", icon: Shield, color: "from-red-500/20 to-rose-500/20", iconColor: "text-red-400" },
    { num: 6, name: "Economics", desc: "Staking, escrow, bounties", icon: Coins, color: "from-yellow-500/20 to-amber-500/20", iconColor: "text-yellow-400" },
    { num: 5, name: "Communication", desc: "A2A, MCP, pub/sub", icon: MessageSquare, color: "from-green-500/20 to-emerald-500/20", iconColor: "text-green-400" },
    { num: 4, name: "Memory & Knowledge", desc: "Agent memory, blackboards", icon: Database, color: "from-teal-500/20 to-cyan-500/20", iconColor: "text-teal-400" },
    { num: 3, name: "Orchestration", desc: "DAG workflows, replanning", icon: Zap, color: "from-cyan-500/20 to-sky-500/20", iconColor: "text-cyan-400" },
    { num: 2, name: "Discovery & Routing", desc: "Semantic search, SLA matching", icon: Globe, color: "from-indigo-500/20 to-violet-500/20", iconColor: "text-indigo-400" },
    { num: 1, name: "Identity & Trust", desc: "DIDs, ACARDs, reputation", icon: Layers, color: "from-purple-500/20 to-fuchsia-500/20", iconColor: "text-purple-400" },
];

export default function ArchitectureShowcase() {
    return (
        <section className="relative py-24 overflow-hidden bg-black">
            {/* Background */}
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(88,28,135,0.1),transparent_70%)]" />

            <div className="relative z-10 max-w-7xl mx-auto px-6 lg:px-8">
                {/* Header */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6 }}
                    viewport={{ once: true }}
                    className="text-center mb-16"
                >
                    <span className="inline-block px-4 py-1.5 rounded-full text-sm font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 mb-4">
                        Architecture
                    </span>
                    <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">
                        The 12-Layer Protocol Stack
                    </h2>
                    <p className="text-lg text-neutral-400 max-w-2xl mx-auto">
                        A complete infrastructure for planetary-scale agent coordination — from identity to emergent intelligence.
                    </p>
                </motion.div>

                {/* Layer Stack */}
                <div className="relative max-w-4xl mx-auto">
                    {/* Connecting Line */}
                    <div className="absolute left-8 top-0 bottom-0 w-px bg-gradient-to-b from-cyan-500/50 via-violet-500/50 to-fuchsia-500/50 hidden md:block" />

                    {layers.map((layer, i) => (
                        <motion.div
                            key={layer.num}
                            initial={{ opacity: 0, x: -20 }}
                            whileInView={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.4, delay: i * 0.05 }}
                            viewport={{ once: true, margin: "-50px" }}
                            className="relative group"
                        >
                            <div className="flex items-center gap-4 py-3 md:py-4">
                                {/* Layer Number Circle */}
                                <div className="relative z-10 flex-shrink-0 w-16 h-16 rounded-2xl bg-gradient-to-br border border-white/10 flex items-center justify-center group-hover:border-white/30 transition-all"
                                    style={{ backgroundImage: `linear-gradient(135deg, ${layer.color.split(' ')[0].replace('from-', '')} 0%, ${layer.color.split(' ')[1].replace('to-', '')} 100%)` }}
                                >
                                    <span className="text-lg font-bold text-white">{layer.num}</span>
                                </div>

                                {/* Content Card */}
                                <div className="flex-1 p-4 md:p-5 rounded-xl bg-white/5 border border-white/10 group-hover:bg-white/10 group-hover:border-white/20 transition-all cursor-pointer">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <layer.icon className={`w-5 h-5 ${layer.iconColor}`} />
                                            <h3 className="text-base md:text-lg font-semibold text-white">{layer.name}</h3>
                                        </div>
                                        <span className="hidden sm:block text-sm text-neutral-500">{layer.desc}</span>
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    ))}
                </div>

                {/* Bottom CTA */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, delay: 0.3 }}
                    viewport={{ once: true }}
                    className="text-center mt-16"
                >
                    <p className="text-neutral-400 mb-6">
                        Each layer is designed to enable emergent behavior at the layers above.
                    </p>
                    <a
                        href="https://docs.nooterra.ai/getting-started/architecture"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-white/5 border border-white/10 text-white font-medium hover:bg-white/10 hover:border-white/20 transition-all"
                    >
                        <Layers className="w-4 h-4" />
                        Explore Full Architecture
                    </a>
                </motion.div>
            </div>
        </section>
    );
}
