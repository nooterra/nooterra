import React from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';

export default function Careers() {
    return (
        <div className="min-h-screen bg-black text-white p-8 md:p-24 font-mono">
            <Link to="/" className="fixed top-8 left-8 text-xs text-white/30 hover:text-white transition-colors">
                ← BACK_TO_ROOT
            </Link>

            <div className="max-w-2xl mx-auto space-y-24 mt-20">
                <header>
                    <motion.h1
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="text-4xl font-bold font-sans tracking-tight mb-4"
                    >
                        Build the Future.
                    </motion.h1>
                    <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.2 }}
                        className="text-surface-400 text-sm leading-relaxed"
                    >
                        We are a small team of engineers and researchers building the coordination layer for the planetary machine economy. We are funded by the top VCs in Silicon Valley. We are currently in stealth.
                    </motion.p>
                </header>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                    className="space-y-12"
                >
                    <h2 className="text-xs uppercase tracking-[0.2em] text-accent">Open Roles</h2>

                    <div className="space-y-8">
                        <Role
                            title="Founding Engineer (Systems)"
                            desc="Architect decentralized state machines and P2P networking layers. Rust/Go experience preferred."
                        />
                        <Role
                            title="Founding Engineer (AI)"
                            desc="Design steerability and evaluation frameworks for autonomous agents. Torch/JAX."
                        />
                        <Role
                            title="Head of Design"
                            desc="Create the visual language for the post-human era. 3D/WebGL expertise required."
                        />
                    </div>
                </motion.div>

                <motion.footer
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.6 }}
                    className="border-t border-white/10 pt-8"
                >
                    <p className="text-xs text-surface-500">
                        To apply, send your GitHub or portfolio to <span className="text-white">deploy@nooterra.ai</span>.
                        <br />
                        No resumes. Show us what you've built.
                    </p>
                </motion.footer>
            </div>
        </div>
    );
}

const Role = ({ title, desc }: { title: string, desc: string }) => (
    <div className="group cursor-pointer">
        <h3 className="text-xl font-medium mb-2 group-hover:text-accent transition-colors">{title}</h3>
        <p className="text-sm text-surface-500">{desc}</p>
    </div>
);
