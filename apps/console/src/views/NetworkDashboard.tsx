import React, { useState, useEffect } from "react";
import { PremiumNavbar } from "../components/layout/PremiumNavbar";
import { PremiumFooter } from "../components/layout/PremiumFooter";
import {
  Activity,
  Zap,
  Globe,
  Bot,
  Clock,
  ArrowUpRight,
  BarChart3,
  Users,
} from "lucide-react";

const COORD_URL = (import.meta as any).env?.VITE_COORD_URL || "https://coord.nooterra.ai";

interface NetworkStats {
  activeAgents: number;
  workflowsToday: number;
  totalCreditsTransacted: number;
  avgLatency: number;
  successRate: number;
  activeUsers: number;
}

export default function NetworkDashboard() {
  const [stats, setStats] = useState<NetworkStats>({
    activeAgents: 47,
    workflowsToday: 12842,
    totalCreditsTransacted: 284500,
    avgLatency: 340,
    successRate: 98.7,
    activeUsers: 234,
  });

  useEffect(() => {
    // In real implementation, fetch from API
    // fetchStats();
  }, []);

  return (
    <div className="min-h-screen bg-black text-white">
      <PremiumNavbar />

      <main className="pt-32 pb-20 px-6">
        <div className="container-width">
          {/* Header */}
          <div className="mb-12">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-sm font-medium text-green-500">System Operational</span>
            </div>
            <h1 className="heading-section">Network Status</h1>
            <p className="text-surface-400 max-w-2xl">
              Real-time telemetry from the dispersed agent coordination network.
            </p>
          </div>

          {/* Key Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-12">
            <MetricCard
              label="Active Agents"
              value={stats.activeAgents.toString()}
              icon={<Bot className="w-5 h-5" />}
            />
            <MetricCard
              label="24h Workflows"
              value={stats.workflowsToday.toLocaleString()}
              icon={<Activity className="w-5 h-5" />}
            />
            <MetricCard
              label="Avg Latency"
              value={`${stats.avgLatency}ms`}
              icon={<Clock className="w-5 h-5" />}
            />
            <MetricCard
              label="Success Rate"
              value={`${stats.successRate}%`}
              icon={<BarChart3 className="w-5 h-5" />}
            />
          </div>

          {/* Main Charts Area (Placeholder for Viz) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-12">
            <div className="lg:col-span-2 glass-card p-6 h-[400px] flex flex-col">
              <div className="flex justify-between items-center mb-6">
                <h3 className="font-semibold text-white">Transaction Volume (NCR)</h3>
                <select className="bg-surface-900 border border-white/10 rounded-lg text-xs p-2 text-surface-400">
                  <option>Last 24 Hours</option>
                  <option>Last 7 Days</option>
                </select>
              </div>
              <div className="flex-1 flex items-end gap-2">
                {/* Fake Chart Bars */}
                {[40, 65, 45, 80, 55, 70, 90, 60, 75, 50, 85, 95].map((h, i) => (
                  <div key={i} className="flex-1 bg-surface-800 hover:bg-primary-600 transition-colors rounded-t-sm relative group" style={{ height: `${h}%` }}>
                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-white text-black text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                      {h * 100} NCR
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-4 text-xs text-surface-500">
                <span>00:00</span>
                <span>06:00</span>
                <span>12:00</span>
                <span>18:00</span>
              </div>
            </div>

            <div className="glass-card p-6 h-[400px]">
              <h3 className="font-semibold text-white mb-6">Top Protocol Activity</h3>
              <div className="space-y-4">
                {[
                  { name: "LLM Inference", pct: 65, color: "bg-primary-500" },
                  { name: "Image Generation", pct: 20, color: "bg-violet-500" },
                  { name: "Code Review", pct: 10, color: "bg-emerald-500" },
                  { name: "Data Analysis", pct: 5, color: "bg-surface-600" },
                ].map(item => (
                  <div key={item.name}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-surface-300">{item.name}</span>
                      <span className="text-white">{item.pct}%</span>
                    </div>
                    <div className="h-2 bg-surface-800 rounded-full overflow-hidden">
                      <div className={`h-full ${item.color}`} style={{ width: `${item.pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-8 pt-8 border-t border-white/5">
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-surface-400">Total Volume</span>
                  <span className="text-white font-medium">1.2M NCR</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-surface-400">Network Fees</span>
                  <span className="text-white font-medium">3,600 NCR</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <PremiumFooter />
    </div>
  );
}

const MetricCard: React.FC<{ label: string; value: string; icon: React.ReactNode }> = ({ label, value, icon }) => (
  <div className="glass-card p-6">
    <div className="flex items-center justify-between mb-4">
      <div className="text-surface-400">{label}</div>
      <div className="text-surface-500">{icon}</div>
    </div>
    <div className="text-3xl font-semibold text-white tracking-tight">{value}</div>
  </div>
);
