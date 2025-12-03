import React from "react";
import { motion } from "framer-motion";
import { TrendingUp, Zap, Bot, Clock, ArrowUpRight, ArrowDownRight } from "lucide-react";

const stats = [
  {
    label: "Total Queries",
    value: "1,247",
    change: "+12%",
    trend: "up",
    icon: <Zap className="w-5 h-5" />,
    color: "#4f7cff",
  },
  {
    label: "Agents Used",
    value: "34",
    change: "+8",
    trend: "up",
    icon: <Bot className="w-5 h-5" />,
    color: "#a855f7",
  },
  {
    label: "Avg Response Time",
    value: "1.2s",
    change: "-0.3s",
    trend: "up",
    icon: <Clock className="w-5 h-5" />,
    color: "#00d4ff",
  },
  {
    label: "Credits Used",
    value: "4,820",
    change: "+18%",
    trend: "up",
    icon: <TrendingUp className="w-5 h-5" />,
    color: "#39ff8e",
  },
];

const recentActivity = [
  { query: "Analyze market trends for Q4", agents: 4, credits: 120, time: "2 min ago" },
  { query: "Generate product descriptions", agents: 2, credits: 45, time: "15 min ago" },
  { query: "Research competitor pricing", agents: 5, credits: 180, time: "1 hour ago" },
  { query: "Summarize legal document", agents: 3, credits: 95, time: "3 hours ago" },
  { query: "Code review for auth module", agents: 2, credits: 60, time: "5 hours ago" },
];

const topAgents = [
  { name: "gpt4-reasoning", queries: 342, color: "#4f7cff" },
  { name: "claude-analysis", queries: 256, color: "#a855f7" },
  { name: "code-assistant", queries: 198, color: "#00d4ff" },
  { name: "research-agent", queries: 167, color: "#39ff8e" },
  { name: "content-writer", queries: 134, color: "#e040fb" },
];

export default function Usage() {
  return (
    <div className="flex-1 p-6 lg:p-8 overflow-y-auto">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Usage Analytics</h1>
          <p className="text-[#707090] mt-1">Track your network activity and resource consumption</p>
        </div>

        {/* Stats grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {stats.map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className="p-5 bg-[#0a0a12] border border-[#4f7cff]/10 rounded-xl"
            >
              <div className="flex items-start justify-between mb-3">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: `${stat.color}15`, color: stat.color }}
                >
                  {stat.icon}
                </div>
                <span
                  className={`flex items-center gap-1 text-xs font-medium ${
                    stat.trend === "up" ? "text-[#39ff8e]" : "text-red-400"
                  }`}
                >
                  {stat.trend === "up" ? (
                    <ArrowUpRight className="w-3 h-3" />
                  ) : (
                    <ArrowDownRight className="w-3 h-3" />
                  )}
                  {stat.change}
                </span>
              </div>
              <div className="text-2xl font-bold text-white mb-1">{stat.value}</div>
              <div className="text-sm text-[#707090]">{stat.label}</div>
            </motion.div>
          ))}
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Recent activity */}
          <div className="lg:col-span-2 bg-[#0a0a12] border border-[#4f7cff]/10 rounded-xl p-5">
            <h2 className="text-lg font-semibold text-white mb-4">Recent Activity</h2>
            <div className="space-y-3">
              {recentActivity.map((activity, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex items-center justify-between p-3 bg-[#0f0f18] rounded-lg"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white truncate">{activity.query}</div>
                    <div className="text-xs text-[#505060] mt-1">
                      {activity.agents} agents • {activity.time}
                    </div>
                  </div>
                  <div className="text-sm font-mono text-[#4f7cff]">{activity.credits} NCR</div>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Top agents */}
          <div className="bg-[#0a0a12] border border-[#4f7cff]/10 rounded-xl p-5">
            <h2 className="text-lg font-semibold text-white mb-4">Top Agents Used</h2>
            <div className="space-y-4">
              {topAgents.map((agent, i) => (
                <motion.div
                  key={agent.name}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-[#909098]">{agent.name}</span>
                    <span className="text-sm text-white font-medium">{agent.queries}</span>
                  </div>
                  <div className="h-1.5 bg-[#0f0f18] rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${(agent.queries / topAgents[0].queries) * 100}%` }}
                      transition={{ duration: 0.8, delay: i * 0.1 }}
                      className="h-full rounded-full"
                      style={{ backgroundColor: agent.color }}
                    />
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>

        {/* Usage chart placeholder */}
        <div className="mt-6 bg-[#0a0a12] border border-[#4f7cff]/10 rounded-xl p-5">
          <h2 className="text-lg font-semibold text-white mb-4">Usage Over Time</h2>
          <div className="h-64 flex items-center justify-center border border-[#4f7cff]/10 rounded-lg">
            <div className="text-center">
              <div className="text-[#505060] mb-2">📊</div>
              <p className="text-[#707090] text-sm">Usage chart coming soon</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

