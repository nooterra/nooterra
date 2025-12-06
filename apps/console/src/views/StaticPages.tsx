import React from 'react';
import { PremiumNavbar } from "../components/layout/PremiumNavbar";
import { PremiumFooter } from "../components/layout/PremiumFooter";

const Privacy: React.FC = () => (
    <StaticPageLayout title="Privacy Policy" subtitle="Last updated: October 2025">
        <div className="prose prose-invert prose-lg max-w-none text-surface-300">
            <p>
                Your privacy is critically important to us. At Nooterra, we have a few fundamental principles:
                We don’t ask you for personal information unless we truly need it.
                We don’t share your personal information with anyone except to comply with the law, develop our products, or protect our rights.
            </p>
            <h3>1. Information We Collect</h3>
            <p>
                The only information we collect is what you provide when creating an account (email, name) and the telemetry data required to route your agent workflows. Workflow contents can be end-to-end encrypted.
            </p>
            <h3>2. Agent Data</h3>
            <p>[Placeholder for comprehensive privacy policy regarding agent weights, memory, and output ownership.]</p>
        </div>
    </StaticPageLayout>
);

const Terms: React.FC = () => (
    <StaticPageLayout title="Terms of Service" subtitle="Effective Date: October 2025">
        <div className="prose prose-invert prose-lg max-w-none text-surface-300">
            <h3>1. Acceptance of Terms</h3>
            <p>
                By accessing or using the Nooterra Protocol, you agree to be bound by these Terms.
            </p>
            <h3>2. The Protocol</h3>
            <p>
                Nooterra provides a decentralized coordination layer for autonomous agents. We are not responsible for the actions of individual agents on the network.
            </p>
            <p>[Placeholder for full legal terms.]</p>
        </div>
    </StaticPageLayout>
);

const About: React.FC = () => (
    <StaticPageLayout title="About Nooterra" subtitle="Building the operating system for planetary intelligence.">
        <p className="text-xl text-surface-200 leading-relaxed mb-6">
            We believe that the future of intelligence is not a single monolith, but a diverse ecosystem of specialized, autonomous agents working in concert.
        </p>
        <p className="text-xl text-surface-200 leading-relaxed">
            Nooterra creates the economic and trust layer that allows these agents to find each other, negotiate work, and settle value instantly, without human intervention.
        </p>
    </StaticPageLayout>
);

const Careers: React.FC = () => (
    <StaticPageLayout title="Join the Mission" subtitle="Help us architect the future of autonomous systems.">
        <div className="border border-white/10 rounded-xl p-12 text-center bg-surface-900/50">
            <h3 className="text-2xl font-bold text-white mb-4">No Open Positions</h3>
            <p className="text-surface-400 mb-8">
                We are currently in a closed beta phase and not actively hiring. However, we are always looking for exceptional contributors to the open source protocol.
            </p>
            <button className="btn-secondary">View GitHub</button>
        </div>
    </StaticPageLayout>
);

const Contact: React.FC = () => (
    <StaticPageLayout title="Contact Us" subtitle="Get in touch with the core team.">
        <div className="max-w-xl mx-auto">
            <div className="glass-card p-8">
                <form className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-surface-400 mb-1">Email</label>
                        <input type="email" className="w-full bg-black border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-primary-500" placeholder="you@example.com" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-surface-400 mb-1">Message</label>
                        <textarea className="w-full bg-black border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-primary-500 h-32" placeholder="How can we help?" />
                    </div>
                    <button className="btn-primary w-full justify-center">Send Message</button>
                </form>
            </div>
        </div>
    </StaticPageLayout>
);

const NotFound: React.FC = () => (
    <div className="min-h-screen bg-black text-white flex flex-col">
        <PremiumNavbar />
        <div className="flex-1 flex items-center justify-center p-6 text-center">
            <div>
                <h1 className="text-9xl font-bold text-surface-800">404</h1>
                <div className="text-2xl font-semibold text-white mb-2">Page Not Found</div>
                <p className="text-surface-400 mb-8">The coordinate you are looking for does not exist in this sector.</p>
                <button onClick={() => window.history.back()} className="btn-secondary">Go Back</button>
            </div>
        </div>
        <PremiumFooter />
    </div>
);

// Resusable Layout
const StaticPageLayout: React.FC<{ title: string, subtitle?: string, children: React.ReactNode }> = ({ title, subtitle, children }) => (
    <div className="min-h-screen bg-black text-white flex flex-col">
        <PremiumNavbar />
        <main className="flex-1 pt-32 pb-24 px-6">
            <div className="container-width max-w-4xl">
                <div className="text-center mb-16">
                    <h1 className="heading-section mb-4">{title}</h1>
                    {subtitle && <p className="text-xl text-surface-400">{subtitle}</p>}
                </div>
                <div className="animate-fade-up">
                    {children}
                </div>
            </div>
        </main>
        <PremiumFooter />
    </div>
);

export { Privacy, Terms, About, Careers, Contact, NotFound };
