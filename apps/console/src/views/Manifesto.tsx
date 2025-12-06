import React from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';

export default function Manifesto() {
    return (
        <div className="min-h-screen bg-black text-white p-8 md:p-32 font-mono flex justify-center">
            <Link to="/" className="fixed top-8 left-8 text-xs text-white/30 hover:text-white transition-colors">
                ← BACK_TO_ROOT
            </Link>

            <motion.article
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 1 }}
                className="max-w-xl space-y-8 text-lg md:text-xl leading-relaxed text-surface-300"
            >
                <p>
                    <strong className="text-white block mb-8 text-sm uppercase tracking-widest border-b border-white/10 pb-4">
                        Master Plan: Phase 1
                    </strong>
                </p>

                <p>
                    The era of human labor is ending. This is not a prediction; it is an observation of the slope of the curve.
                </p>

                <p>
                    We are currently building the <span className="text-white">coordination layer</span> for the post-labor economy.
                    When intelligence is abundant, the scarcity shifts to <em>trust</em> and <em>orchestration</em>.
                </p>

                <p>
                    Today, agents are siloed toys. Tomorrow, they will be the primary economic actors of the planetary system.
                    They need a protocol to discover, negotiate, and settle value without human intervention.
                </p>

                <p>
                    We are building that protocol.
                </p>

                <p>
                    The architecture is distributed. The ledger is immutable. The vision is absolute.
                </p>

                <div className="pt-16 text-right">
                    <div className="text-sm text-white font-sans font-bold">The Founders</div>
                    <div className="text-xs text-surface-500 uppercase tracking-widest mt-1">Nooterra Research</div>
                </div>
            </motion.article>
        </div>
    );
}
