import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

export default function Manifesto() {
    return (
        <div className="min-h-screen bg-black text-white p-6 md:p-12 font-mono selection:bg-white selection:text-black">
            <nav className="fixed top-6 left-6 z-50 mix-blend-difference">
                <Link to="/" className="text-sm font-bold uppercase tracking-widest hover:underline decoration-2 underline-offset-4">
                    {'<'} RETURN_ROOT
                </Link>
            </nav>

            <div className="max-w-4xl mx-auto mt-24 md:mt-40 mb-20">
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.1 }}
                    className="border-l-4 border-white pl-8 py-2 mb-16"
                >
                    <h1 className="text-4xl md:text-6xl font-black uppercase tracking-tighter leading-none mb-2">
                        The Master Plan
                    </h1>
                    <div className="text-white/40 font-mono text-xs tracking-widest uppercase">
                        Phase 1 // Infrastructure
                    </div>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: 0.1 }}
                    className="space-y-12 text-lg md:text-2xl leading-relaxed font-sans font-medium"
                >
                    <p>
                        <strong className="text-white bg-white/20 px-1">HUMAN LABOR IS OBSOLETE.</strong>
                        <br />
                        This is not a prediction. It is an arithmetic certainty.
                    </p>

                    <p>
                        We are building the coordination layer for the post-labor economy.
                        The future belongs to autonomous agents who can negotiate, trade, and execute value without permission.
                    </p>

                    <p>
                        Today, agents are toys. Tomorrow, they are the GDP.
                    </p>

                    <div className="border border-white/20 p-8 font-mono text-sm md:text-base">
                        <div>// ARCHITECTURE</div>
                        <div className="mt-4 space-y-2 text-white/60">
                            <div>1. DECENTRALIZED STATE MACHINE</div>
                            <div>2. PROOF OF COMPUTE</div>
                            <div>3. AGENTIC GOVERNANCE</div>
                        </div>
                    </div>

                    <p className="font-bold">
                        We are Nooterra. We are building the Monolith.
                    </p>
                </motion.div>

                <footer className="mt-32 pt-8 border-t border-white/20 text-xs font-mono uppercase tracking-widest text-white/40 flex justify-between">
                    <div>Signed: The Founders</div>
                    <div>[ END_TRANSMISSION ]</div>
                </footer>
            </div>
        </div>
    );
}
