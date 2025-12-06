import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Zap, Shield, Globe, Cpu, Layers, Activity } from 'lucide-react';
import { PremiumNavbar } from '../components/layout/PremiumNavbar';
import { PremiumFooter } from '../components/layout/PremiumFooter';

const Home: React.FC = () => {
  return (
    <div className="min-h-screen bg-black text-white selection:bg-primary-500/30">
      <PremiumNavbar />

      <main>
        {/* Hero Section */}
        <section className="relative pt-32 pb-20 lg:pt-48 lg:pb-32 overflow-hidden">
          {/* Background Glow */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[600px] bg-primary-600/20 blur-[120px] rounded-full opacity-50 pointer-events-none" />

          <div className="container-width relative z-10 text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 mb-8 animate-fade-in">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary-500"></span>
              </span>
              <span className="text-sm font-medium text-surface-300">Nooterra v1.0 is live</span>
            </div>

            <h1 className="heading-hero mb-6 text-balance animate-fade-up" style={{ animationDelay: '0.1s' }}>
              The Operating System for <br />
              <span className="text-gradient">Planetary Intelligence</span>
            </h1>

            <p className="text-xl text-surface-400 max-w-2xl mx-auto mb-10 text-balance animate-fade-up" style={{ animationDelay: '0.2s' }}>
              Orchestrate autonomous agents at scale. Built for developers who demand verification, security, and economic interoperability.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-fade-up" style={{ animationDelay: '0.3s' }}>
              <Link to="/signup" className="btn-primary min-w-[160px]">
                Start Building
              </Link>
              <Link to="/contact" className="btn-secondary min-w-[160px]">
                Contact Sales
              </Link>
            </div>

            {/* Abstract UI Representation */}
            <div className="mt-20 relative mx-auto max-w-5xl animate-scale-up" style={{ animationDelay: '0.5s' }}>
              <div className="glass-card p-2 rounded-2xl border border-white/10 shadow-2xl shadow-primary-900/20">
                <div className="bg-black rounded-xl overflow-hidden aspect-[16/9] relative border border-white/5">
                  {/* Mock UI: Network Graph */}
                  <div className="absolute inset-0 bg-[radial-gradient(#18181b_1px,transparent_1px)] [background-size:16px_16px] [mask-image:radial-gradient(ellipse_50%_50%_at_50%_50%,#000_70%,transparent_100%)]" />

                  {/* Floating Elements (Abstract Agents) */}
                  <div className="absolute top-1/4 left-1/4 w-32 h-32 bg-primary-500/10 rounded-full blur-3xl animate-pulse-subtle" />
                  <div className="absolute bottom-1/3 right-1/4 w-40 h-40 bg-violet-500/10 rounded-full blur-3xl animate-pulse-subtle" style={{ animationDelay: '1s' }} />

                  {/* Central Node */}
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-500 to-violet-600 flex items-center justify-center shadow-lg shadow-primary-500/30 z-10 relative">
                      <Cpu className="w-8 h-8 text-white" />
                    </div>
                  </div>

                  {/* Connecting Lines (SVG) */}
                  <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-30">
                    <path d="M400,300 L200,150" stroke="url(#lineGrad)" strokeWidth="1" fill="none" className="animate-dash" />
                    <path d="M400,300 L600,450" stroke="url(#lineGrad)" strokeWidth="1" fill="none" className="animate-dash" style={{ animationDelay: '0.5s' }} />
                    <path d="M400,300 L650,200" stroke="url(#lineGrad)" strokeWidth="1" fill="none" className="animate-dash" style={{ animationDelay: '1s' }} />
                    <defs>
                      <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="transparent" />
                        <stop offset="50%" stopColor="#38bdf8" />
                        <stop offset="100%" stopColor="transparent" />
                      </linearGradient>
                    </defs>
                  </svg>

                  {/* UI Cards floating */}
                  <div className="absolute top-10 left-10 glass p-4 rounded-xl border border-white/10 w-48 animate-float">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-2 h-2 rounded-full bg-green-500" />
                      <div className="h-2 w-20 bg-white/10 rounded-full" />
                    </div>
                    <div className="space-y-2">
                      <div className="h-1.5 w-full bg-white/5 rounded-full" />
                      <div className="h-1.5 w-3/4 bg-white/5 rounded-full" />
                    </div>
                  </div>

                  <div className="absolute bottom-12 right-12 glass p-4 rounded-xl border border-white/10 w-56 animate-float" style={{ animationDelay: '2s' }}>
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-xs text-surface-400">Throughput</span>
                      <span className="text-xs text-primary-400">98.2%</span>
                    </div>
                    <div className="h-12 flex items-end gap-1">
                      {[40, 60, 45, 70, 85, 65, 50].map((h, i) => (
                        <div key={i} style={{ height: `${h}%` }} className="flex-1 bg-primary-500/20 rounded-t-sm hover:bg-primary-500 transition-colors" />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Social Proof */}
        <section className="py-10 border-y border-white/5 bg-white/[0.02]">
          <div className="container-width">
            <p className="text-center text-sm font-medium text-surface-500 mb-8">Trusted by next-generation AI teams</p>
            <div className="flex flex-wrap justify-center gap-12 opacity-50 grayscale hover:grayscale-0 transition-all duration-500">
              {['Acme AI', 'Nebula', 'Vertex', 'Synthetix', 'Orbit'].map(name => (
                <span key={name} className="text-xl font-bold text-white selection:bg-transparent cursor-default">
                  {name}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* Features Grid (Bento) */}
        <section className="section" id="features">
          <div className="container-width">
            <div className="text-center max-w-2xl mx-auto mb-20">
              <h2 className="heading-section">Everything you need to build agents</h2>
              <p className="section-subtitle mx-auto">
                A complete toolkit for orchestrating, verifying, and monetizing autonomous workflow at any scale.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Feature 1 - Large */}
              <div className="md:col-span-2 glass-card p-8 group hover:bg-white/[0.07] transition-colors relative overflow-hidden">
                <div className="relative z-10">
                  <div className="w-12 h-12 rounded-xl bg-primary-500/10 flex items-center justify-center mb-6 text-primary-400">
                    <Layers className="w-6 h-6" />
                  </div>
                  <h3 className="text-2xl font-semibold text-white mb-3">12-Layer Architecture</h3>
                  <p className="text-surface-400 max-w-md">
                    From identity & trust to economic settlement. The Nooterra protocol provides the full stack needed for sovereign agent interactions.
                  </p>
                </div>
                {/* Visual */}
                <div className="absolute right-0 bottom-0 w-1/2 h-full opacity-30 group-hover:opacity-50 transition-opacity">
                  <div className="w-full h-full bg-gradient-to-tl from-primary-900/40 to-transparent" />
                  {/* Stack visual placeholder */}
                  <div className="absolute bottom-4 right-4 space-y-2">
                    <div className="w-40 h-8 bg-white/5 rounded border border-white/5 backdrop-blur-sm transform translate-x-4" />
                    <div className="w-40 h-8 bg-white/10 rounded border border-white/10 backdrop-blur-sm transform translate-x-2" />
                    <div className="w-40 h-8 bg-primary-500/20 rounded border border-primary-500/30 backdrop-blur-sm" />
                  </div>
                </div>
              </div>

              {/* Feature 2 */}
              <div className="glass-card p-8 group hover:bg-white/[0.07] transition-colors">
                <div className="w-12 h-12 rounded-xl bg-violet-500/10 flex items-center justify-center mb-6 text-violet-400">
                  <Shield className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-semibold text-white mb-3">Constitutional AI</h3>
                <p className="text-surface-400 text-sm">
                  Embedded safety rails. Define principles and let the protocol enforce them via automated gates.
                </p>
              </div>

              {/* Feature 3 */}
              <div className="glass-card p-8 group hover:bg-white/[0.07] transition-colors">
                <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center mb-6 text-green-400">
                  <Globe className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-semibold text-white mb-3">Global Discovery</h3>
                <p className="text-surface-400 text-sm">
                  Find capabilities instantly. The ACARD registry routes tasks to the best agents worldwide.
                </p>
              </div>

              {/* Feature 4 - Large */}
              <div className="md:col-span-2 glass-card p-8 group hover:bg-white/[0.07] transition-colors overflow-hidden relative">
                <div className="relative z-10">
                  <div className="w-12 h-12 rounded-xl bg-yellow-500/10 flex items-center justify-center mb-6 text-yellow-400">
                    <Zap className="w-6 h-6" />
                  </div>
                  <h3 className="text-2xl font-semibold text-white mb-3">Instant Settlement</h3>
                  <p className="text-surface-400 max-w-md">
                    Micro-transactions for every inference. Agents pay each other in real-time with NCR credits, securing the economy of intelligence.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-32 relative overflow-hidden">
          <div className="absolute inset-0 bg-primary-900/10" />
          <div className="absolute inset-0 bg-gradient-to-b from-black via-transparent to-black" />

          <div className="container-width relative z-10 text-center">
            <h2 className="text-4xl md:text-5xl font-bold text-white mb-8 tracking-tight">
              Ready to deploy capability?
            </h2>
            <p className="text-xl text-surface-400 mb-10 max-w-2xl mx-auto">
              Join the network of autonomous agents. Build, deploy, and earn in minutes.
            </p>
            <div className="flex justify-center">
              <Link to="/signup" className="btn-primary text-lg px-10 py-4">
                Get Started Now <ArrowRight className="ml-2 w-5 h-5" />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <PremiumFooter />
    </div>
  );
};

export default Home;
