import React from 'react';
import { Activity, Cpu, Webhook, Zap, ArrowUpRight } from 'lucide-react';

export default function DevDashboard() {
  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Welcome */}
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-white mb-2">Mission Control</h1>
          <p className="text-surface-400 font-mono text-sm">Overview of your agent fleet and capabilities (v1: Identity, Discovery, Orchestration, Economics).</p>
        </div>
        <div className="text-right">
          <div className="text-sm text-surface-400 font-mono mb-1">Current Cycle</div>
          <div className="text-xl font-bold text-white font-mono">24,592 <span className="text-xs text-surface-500 font-normal">NCR</span></div>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <MetricCard title="Active Agents" value="3" change="+1" icon={<Cpu className="w-4 h-4" />} />
        <MetricCard title="Total Calls" value="12.4k" change="+12%" icon={<Activity className="w-4 h-4" />} />
        <MetricCard title="Avg Latency" value="240ms" change="-10ms" icon={<Zap className="w-4 h-4" />} />
        <MetricCard title="Error Rate" value="0.02%" change="-0.01%" icon={<Webhook className="w-4 h-4" />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Chart Area */}
        <div className="lg:col-span-2 glass-card p-6 min-h-[400px]">
          <h3 className="text-sm font-semibold text-white mb-6 font-mono uppercase tracking-wider">Inference Volume</h3>
          <div className="h-64 flex items-end gap-1">
            {Array.from({ length: 24 }).map((_, i) => (
              <div key={i} className="flex-1 bg-primary-900/40 hover:bg-primary-500 transition-colors rounded-t-sm" style={{ height: `${30 + Math.random() * 60}%` }} />
            ))}
          </div>
          <div className="flex justify-between mt-4 border-t border-white/5 pt-2 font-mono text-xs text-surface-500">
            <span>00:00</span>
            <span>04:00</span>
            <span>08:00</span>
            <span>12:00</span>
            <span>16:00</span>
            <span>20:00</span>
            <span>23:59</span>
          </div>
        </div>

        {/* Live Logs */}
        <div className="glass-card p-0 overflow-hidden flex flex-col">
          <div className="p-4 border-b border-white/5 bg-black/20">
            <h3 className="text-sm font-semibold text-white font-mono uppercase tracking-wider">Live Logs</h3>
          </div>
          <div className="flex-1 p-4 font-mono text-xs space-y-3 overflow-y-auto max-h-[400px]">
            {[
              { time: "10:42:01", level: "INFO", msg: "Agent [gpt4-reasoning] registered capability" },
              { time: "10:42:05", level: "INFO", msg: "Workflow [wf-9283] started" },
              { time: "10:42:08", level: "WARN", msg: "Latency spike detected in region: us-east" },
              { time: "10:42:15", level: "INFO", msg: "Agent [claude-analysis] payment settled: 5 NCR" },
              { time: "10:42:22", level: "INFO", msg: "Heartbeat received from [code-reviewer]" },
            ].map((log, i) => (
              <div key={i} className="flex gap-3">
                <span className="text-surface-500 shrink-0">{log.time}</span>
                <span className={log.level === 'WARN' ? 'text-yellow-500' : 'text-primary-400'}>{log.level}</span>
                <span className="text-surface-300 truncate">{log.msg}</span>
              </div>
            ))}
            <div className="animate-pulse text-primary-500">_</div>
          </div>
        </div>
      </div>

      {/* Agents Table */}
      <div className="glass-card p-0 overflow-hidden">
        <div className="p-6 border-b border-white/5 flex justify-between items-center bg-black/20">
          <h3 className="text-sm font-semibold text-white font-mono uppercase tracking-wider">Deployed Agents</h3>
          <button className="text-xs text-primary-400 hover:text-white flex items-center gap-1 font-mono">
            View All <ArrowUpRight className="w-3 h-3" />
          </button>
        </div>
        <div className="w-full text-left text-sm">
          <div className="grid grid-cols-5 p-4 text-xs font-medium text-surface-500 font-mono uppercase tracking-wider border-b border-white/5">
            <div className="col-span-2">Agent Name</div>
            <div>Status</div>
            <div>Uptime</div>
            <div className="text-right">Revenue</div>
          </div>
          {[
            { name: "GPT-4 Reasoning", did: "did:noot:gpt4...", status: "active", uptime: "99.9%", rev: "12,450 NCR" },
            { name: "Claude Analysis", did: "did:noot:claude...", status: "active", uptime: "99.5%", rev: "8,920 NCR" },
            { name: "Code Reviewer", did: "did:noot:code...", status: "idle", uptime: "98.2%", rev: "3,222 NCR" },
          ].map((agent) => (
            <div key={agent.did} className="grid grid-cols-5 p-4 items-center hover:bg-white/5 transition-colors border-b border-white/5 last:border-0">
              <div className="col-span-2">
                <div className="font-medium text-white">{agent.name}</div>
                <div className="text-xs text-surface-500 font-mono">{agent.did}</div>
              </div>
              <div>
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${agent.status === 'active' ? 'bg-green-500/10 text-green-400' : 'bg-surface-700/50 text-surface-400'
                  }`}>
                  {agent.status}
                </span>
              </div>
              <div className="text-surface-300 font-mono text-xs">{agent.uptime}</div>
              <div className="text-right text-white font-mono">{agent.rev}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const MetricCard = ({ title, value, change, icon }: { title: string, value: string, change: string, icon: React.ReactNode }) => (
  <div className="bg-surface-900/50 border border-white/10 rounded-lg p-4">
    <div className="flex items-center justify-between mb-2">
      <span className="text-xs font-medium text-surface-500 uppercase tracking-wider font-mono">{title}</span>
      <span className="text-surface-400">{icon}</span>
    </div>
    <div className="flex items-end justify-between">
      <div className="text-2xl font-bold text-white font-mono">{value}</div>
      <div className={`text-xs font-mono mb-1 ${change.startsWith('+') ? 'text-green-400' : 'text-primary-400'}`}>{change}</div>
    </div>
  </div>
);
