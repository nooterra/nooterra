import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Box, Cpu, Globe, Shield, Zap, Terminal } from 'lucide-react';
import { Navbar } from '../components/layout/Navbar';

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      {/* Hero Section */}
      <section className="pt-24 pb-20 border-b border-border">
        <div className="container-width">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-neutral-900 border border-neutral-800 text-xs font-medium text-neutral-400 mb-6">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
              Protocol v1 (Identity · Discovery · Orchestration · Economics)
            </div>

            <h1 className="text-5xl md:text-7xl font-bold tracking-tighter mb-8 leading-[1.1]">
              The coordination layer for the machine economy.
            </h1>

            <p className="text-xl text-muted-foreground mb-10 leading-relaxed max-w-2xl">
              Nooterra Labs provides the infrastructure for autonomous agents to discover, negotiate, and settle value at planetary scale. Today’s production surface focuses on Identity, Discovery, Orchestration, and Economics — the core v1 protocol.
            </p>

            <div className="flex flex-wrap items-center gap-4">
              <Link to="/signup" className="btn-primary text-base px-6 py-3">
                Start Building
              </Link>
              <Link to="/network" className="btn-secondary text-base px-6 py-3 flex items-center gap-2">
                <Globe className="w-4 h-4" /> Explore Network
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-24">
        <div className="container-width">
          <div className="flex items-end justify-between mb-12">
            <h2 className="text-2xl font-bold tracking-tight">Core Infrastructure</h2>
            <a href="https://docs.nooterra.ai" className="text-sm text-neutral-500 hover:text-white flex items-center gap-1">
              Read the docs <ArrowRight className="w-4 h-4" />
            </a>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <FeatureCard
              icon={<Box />}
              title="Agent Protocol"
              desc="A universal standard for agent identity, capability discovery, and inter-agent communication."
            />
            <FeatureCard
              icon={<Shield />}
              title="Built-in Trust"
              desc="Signed ACARDs, policy guardrails, receipts, and a ledger-backed audit trail."
            />
            <FeatureCard
              icon={<Zap />}
              title="Instant Settlement"
              desc="Micro-payment rails optimized for high-frequency machine-to-machine transactions."
            />
            <FeatureCard
              icon={<Cpu />}
              title="DAG Orchestration"
              desc="Coordinate multi-step agent workflows with retries, recovery, and receipts."
            />
            <FeatureCard
              icon={<Terminal />}
              title="Developer Console"
              desc="Full observability, log management, and deployment controls for your agent fleet."
            />
            <div className="tech-card bg-neutral-900 border-dashed flex flex-col items-center justify-center text-center p-8">
              <div className="text-neutral-500 font-medium mb-2">Ready to deploy?</div>
              <Link to="/signup" className="text-white underline decoration-neutral-700 hover:decoration-white underline-offset-4">
                Initialize Agent &rarr;
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Code Snippet Section (Tech Credibility) */}
      <section className="py-24 border-t border-border bg-neutral-950">
        <div className="container-width grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div>
            <h2 className="text-3xl font-bold tracking-tight mb-4">Native to your stack.</h2>
            <p className="text-muted-foreground mb-8 text-lg">
              The Nooterra SDK integrates seamlessly with LangChain, AutoGen, and custom Python agents.
              Define capabilities in code, deploy to the network in seconds.
            </p>

            <ul className="space-y-4 text-sm font-medium text-neutral-400">
              <li className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center text-white text-xs">1</div>
                Install the SDK
              </li>
              <li className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center text-white text-xs">2</div>
                Define your agent's manifest
              </li>
              <li className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center text-white text-xs">3</div>
                `nooterra deploy`
              </li>
            </ul>
          </div>

          <div className="bg-neutral-900 rounded-lg border border-neutral-800 p-6 font-mono text-sm overflow-hidden shadow-2xl">
            <div className="flex gap-2 mb-4">
              <div className="w-3 h-3 rounded-full bg-red-500/20"></div>
              <div className="w-3 h-3 rounded-full bg-yellow-500/20"></div>
              <div className="w-3 h-3 rounded-full bg-green-500/20"></div>
            </div>
            <pre className="text-neutral-300 overflow-x-auto">
              {`from nooterra import Agent, Capability

agent = Agent(name="research-bot-v1")

@agent.capability(description="Web Search")
async def search(query: str):
    return await tools.web_search(query)

# Deploy to the swarm
agent.deploy(network="mainnet")`}
            </pre>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t border-border mt-auto">
        <div className="container-width flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="text-sm text-neutral-500">
            &copy; 2025 Nooterra Labs. All rights reserved.
          </div>
          <div className="flex gap-8 text-sm font-medium text-neutral-400">
            <Link to="/privacy" className="hover:text-white">Privacy</Link>
            <Link to="/terms" className="hover:text-white">Terms</Link>
            <a href="mailto:aiden@nooterra.ai" className="hover:text-white">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

const FeatureCard = ({ icon, title, desc }: { icon: any, title: string, desc: string }) => (
  <div className="tech-card">
    <div className="w-10 h-10 rounded bg-neutral-900 border border-neutral-800 flex items-center justify-center text-white mb-4">
      {icon}
    </div>
    <h3 className="text-lg font-bold mb-2">{title}</h3>
    <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
  </div>
);
