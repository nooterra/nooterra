import React, { useState } from "react";
import { Navbar } from "../components/layout/Navbar";
import {
  Activity,
  Zap,
  Globe,
  Bot,
  Clock,
  BarChart3,
  Server
} from "lucide-react";

export default function NetworkDashboard() {
  // Simplified state for the "Labs" aesthetic - clean, data-focused
  const stats = {
    activeAgents: 142,
    workflowsToday: 12842,
    totalCreditsTransacted: 284500,
    avgLatency: 340,
    successRate: 99.1,
    nodesOnline: 24,
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />

      <main className="container-width py-12">
        {/* Header */}
        <div className="mb-12 border-b border-border pb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-sm font-medium text-green-500 font-mono">MAINNET OPERATIONAL</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Network State</h1>
          <p className="text-muted-foreground">
            Live telemetry from the Nooterra Coordination Protocol.
          </p>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
          <MetricCard
            label="Active Agents"
            value={stats.activeAgents.toString()}
            icon={<Bot className="w-4 h-4" />}
          />
          <MetricCard
            label="24h Workflows"
            value={stats.workflowsToday.toLocaleString()}
            icon={<Activity className="w-4 h-4" />}
          />
          <MetricCard
            label="Avg Latency"
            value={`${stats.avgLatency}ms`}
            icon={<Clock className="w-4 h-4" />}
          />
          <MetricCard
            label="Verified Nodes"
            value={stats.nodesOnline.toString()}
            icon={<Server className="w-4 h-4" />}
          />
        </div>

        {/* Charts Section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 tech-card bg-neutral-900/50 p-6 min-h-[400px]">
            <div className="flex justify-between items-center mb-8">
              <h3 className="font-semibold text-sm">Transaction Volume (Credits)</h3>
              <div className="flex gap-2 text-xs font-mono">
                <span className="text-white bg-neutral-800 px-2 py-1 rounded">24H</span>
                <span className="text-neutral-500 px-2 py-1">7D</span>
                <span className="text-neutral-500 px-2 py-1">30D</span>
              </div>
            </div>

            {/* Abstract Chart Representation */}
            <div className="w-full h-64 flex items-end gap-2 border-b border-neutral-800 pb-2">
              {[45, 50, 48, 60, 55, 70, 65, 80, 75, 85, 90, 88, 95, 80, 70, 75, 85, 95, 100, 90].map((h, i) => (
                <div
                  key={i}
                  className="flex-1 bg-neutral-800 hover:bg-neutral-600 transition-colors rounded-sm"
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
            <div className="flex justify-between mt-2 text-xs text-neutral-600 font-mono">
              <span>00:00 UTC</span>
              <span>12:00 UTC</span>
              <span>23:59 UTC</span>
            </div>
          </div>

          <div className="tech-card bg-neutral-900/50 p-6">
            <h3 className="font-semibold text-sm mb-6">Activity Distribution</h3>
            <div className="space-y-6">
              <DistributionBar label="LLM Inference" pct={62} color="bg-neutral-200" />
              <DistributionBar label="Vector Search" pct={24} color="bg-neutral-400" />
              <DistributionBar label="Code Execution" pct={10} color="bg-neutral-600" />
              <DistributionBar label="Image Gen" pct={4} color="bg-neutral-800" />
            </div>

            <div className="mt-12 pt-6 border-t border-neutral-800">
              <div className="text-xs text-neutral-500 mb-2">NETWORK GAS AVG</div>
              <div className="font-mono text-xl flex items-baseline gap-2">
                12 <span className="text-sm text-neutral-600">GWEI</span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

const MetricCard = ({ label, value, icon }: { label: string, value: string, icon: React.ReactNode }) => (
  <div className="p-4 rounded-lg bg-neutral-900/50 border border-border">
    <div className="flex items-center justify-between mb-3 text-muted-foreground">
      <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
      {icon}
    </div>
    <div className="text-2xl font-mono font-medium tracking-tight">{value}</div>
    <div className="text-[10px] text-green-500 mt-1 font-medium">+4.2%</div>
  </div>
);

const DistributionBar = ({ label, pct, color }: { label: string, pct: number, color: string }) => (
  <div>
    <div className="flex justify-between text-xs mb-2">
      <span className="text-neutral-300">{label}</span>
      <span className="font-mono text-neutral-500">{pct}%</span>
    </div>
    <div className="h-1.5 w-full bg-neutral-900 rounded-full overflow-hidden">
      <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  </div>
);
