import React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { GitBranch, Users, Bot, Zap, ArrowUpRight, ArrowRight, Activity, Clock } from "lucide-react";

const stats = [
  { label: "Active Workflows", value: "8", change: "+3", icon: <GitBranch className="w-5 h-5" />, color: "#00d4ff" },
  { label: "Team Members", value: "12", change: "+2", icon: <Users className="w-5 h-5" />, color: "#a855f7" },
  { label: "Agent Fleet", value: "34", change: "+5", icon: <Bot className="w-5 h-5" />, color: "#4f7cff" },
  { label: "Tasks Today", value: "1.2K", change: "+24%", icon: <Zap className="w-5 h-5" />, color: "#39ff8e" },
];

const recentWorkflows = [
  { name: "Customer Support Pipeline", status: "active", runs: 2400, lastRun: "2 min ago" },
  { name: "Content Generation Flow", status: "active", runs: 1800, lastRun: "15 min ago" },
  { name: "Data ETL Pipeline", status: "active", runs: 890, lastRun: "1 hour ago" },
  { name: "Report Generator", status: "scheduled", runs: 450, lastRun: "6 hours ago" },
];

const teamActivity = [
  { user: "Sarah", action: "deployed workflow 'Lead Scoring'", time: "5 min ago" },
  { user: "Mike", action: "added agent 'sentiment-analyzer'", time: "1 hour ago" },
  { user: "Lisa", action: "updated team permissions", time: "2 hours ago" },
  { user: "John", action: "created new workflow", time: "4 hours ago" },
];

export default function OrgDashboard() {
  return (
    <div className="flex-1 p-6 lg:p-8 overflow-y-auto">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Organization Dashboard</h1>
            <p className="text-[#707090] mt-1">Manage your team and AI workflows</p>
          </div>
          <Link to="/org/workflows/new" className="btn-neural">
            <GitBranch className="w-4 h-4" /> New Workflow
          </Link>
        </div>

        {/* Stats */}
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
                <span className="flex items-center gap-1 text-xs font-medium text-[#39ff8e]">
                  <ArrowUpRight className="w-3 h-3" />
                  {stat.change}
                </span>
              </div>
              <div className="text-2xl font-bold text-white mb-1">{stat.value}</div>
              <div className="text-sm text-[#707090]">{stat.label}</div>
            </motion.div>
          ))}
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Workflows */}
          <div className="lg:col-span-2 bg-[#0a0a12] border border-[#4f7cff]/10 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Active Workflows</h2>
              <Link to="/org/workflows" className="text-sm text-[#00d4ff] hover:text-[#00d4ff]/80">
                View all <ArrowRight className="w-3 h-3 inline" />
              </Link>
            </div>
            <div className="space-y-3">
              {recentWorkflows.map((workflow, i) => (
                <motion.div
                  key={workflow.name}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex items-center justify-between p-4 bg-[#0f0f18] rounded-lg hover:bg-[#0f0f18]/80 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-[#00d4ff]/10 flex items-center justify-center">
                      <GitBranch className="w-5 h-5 text-[#00d4ff]" />
                    </div>
                    <div>
                      <div className="text-sm text-white">{workflow.name}</div>
                      <div className="text-xs text-[#505060] flex items-center gap-2">
                        <Clock className="w-3 h-3" /> {workflow.lastRun}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-sm text-white">{workflow.runs.toLocaleString()}</div>
                      <div className="text-xs text-[#505060]">runs</div>
                    </div>
                    <span
                      className={`px-2 py-0.5 text-xs rounded-full ${
                        workflow.status === "active"
                          ? "bg-[#39ff8e]/10 text-[#39ff8e]"
                          : "bg-[#4f7cff]/10 text-[#4f7cff]"
                      }`}
                    >
                      {workflow.status}
                    </span>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Team activity */}
          <div className="bg-[#0a0a12] border border-[#4f7cff]/10 rounded-xl p-5">
            <h2 className="text-lg font-semibold text-white mb-4">Team Activity</h2>
            <div className="space-y-4">
              {teamActivity.map((item, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex gap-3"
                >
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#00d4ff] to-[#a855f7] flex items-center justify-center text-white text-xs font-medium flex-shrink-0">
                    {item.user.charAt(0)}
                  </div>
                  <div>
                    <div className="text-sm text-[#909098]">
                      <span className="text-white">{item.user}</span> {item.action}
                    </div>
                    <div className="text-xs text-[#505060]">{item.time}</div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>

        {/* Quick actions */}
        <div className="mt-6 grid sm:grid-cols-3 gap-4">
          <Link
            to="/org/workflows/new"
            className="p-5 bg-[#0a0a12] border border-[#4f7cff]/10 rounded-xl hover:border-[#00d4ff]/30 transition-all group"
          >
            <GitBranch className="w-6 h-6 text-[#00d4ff] mb-3" />
            <h3 className="text-white font-medium mb-1 group-hover:text-[#00d4ff]">Create Workflow</h3>
            <p className="text-sm text-[#505060]">Build visual AI pipelines</p>
          </Link>
          <Link
            to="/org/team"
            className="p-5 bg-[#0a0a12] border border-[#4f7cff]/10 rounded-xl hover:border-[#a855f7]/30 transition-all group"
          >
            <Users className="w-6 h-6 text-[#a855f7] mb-3" />
            <h3 className="text-white font-medium mb-1 group-hover:text-[#a855f7]">Manage Team</h3>
            <p className="text-sm text-[#505060]">Invite members & set permissions</p>
          </Link>
          <Link
            to="/org/fleet"
            className="p-5 bg-[#0a0a12] border border-[#4f7cff]/10 rounded-xl hover:border-[#4f7cff]/30 transition-all group"
          >
            <Bot className="w-6 h-6 text-[#4f7cff] mb-3" />
            <h3 className="text-white font-medium mb-1 group-hover:text-[#4f7cff]">Agent Fleet</h3>
            <p className="text-sm text-[#505060]">Configure your AI agents</p>
          </Link>
        </div>
      </div>
    </div>
  );
}

