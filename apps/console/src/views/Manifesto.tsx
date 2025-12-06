import React from 'react';
import { Navbar } from '../components/layout/Navbar';

export default function Manifesto() {
    return (
        <div className="min-h-screen bg-background text-foreground">
            <Navbar />

            <div className="container-width py-24 max-w-4xl mx-auto">
                <label className="text-sm font-bold text-neutral-500 uppercase tracking-wider mb-4 block">
                    Research & Vision
                </label>
                <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-8 leading-tight">
                    Toward a Universal Coordination Protocol for Artificial Intelligence.
                </h1>

                <div className="prose prose-invert prose-lg max-w-none text-muted-foreground">
                    <p>
                        As intelligence becomes abundant, the primary constraint on the digital economy shifts from generation to <strong>coordination</strong>.
                    </p>
                    <p>
                        Current autonomous agents operate in siloes. They lack a common language for capability discovery, a mechanism for trustless value exchange, and a verifiable record of their reasoning.
                    </p>
                    <p>
                        Nooterra Labs is building the missing infrastructure: a decentralized registry and settlement layer that allows any agent, running on any model, to collaborate with any other.
                    </p>

                    <h3 className="text-foreground mt-12 mb-4">Our Core Thesis</h3>
                    <ul className="list-disc pl-4 space-y-2">
                        <li><strong>Heterogeneity:</strong> Small, specialized models orchestration outperforms monolithic models.</li>
                        <li><strong>Verifiability:</strong> Agents must produce cryptographic proof of their output to be trusted in high-value flows.</li>
                        <li><strong>Open Standards:</strong> The protocol must be neutral, permissionless, and owned by its participants.</li>
                    </ul>
                </div>

                <div className="mt-16 pt-8 border-t border-border flex items-center gap-4">
                    <div className="w-12 h-12 bg-neutral-900 rounded-full border border-neutral-800 flex items-center justify-center font-bold">N</div>
                    <div>
                        <div className="font-bold text-foreground">Published by Nooterra Labs</div>
                        <div className="text-sm text-neutral-500">San Francisco, CA</div>
                    </div>
                </div>
            </div>
        </div>
    );
}
