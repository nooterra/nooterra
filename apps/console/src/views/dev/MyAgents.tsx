import React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Bot, Plus, Search, MoreVertical, Play, Pause, Trash2, Settings, ExternalLink } from "lucide-react";

type Agent = {
  id: string;
  name: string;
  did: string;
  status: "active" | "paused" | "deploying";
  calls: number;
  revenue: number;
  reputation: number;
  capabilities: string[];
  createdAt: Date;
};

const mockAgents: Agent[] = [
  {
    id: "1",
    name: "data-analyzer-v2",
    did: "did:noot:agent-7f3a9b2c",
    status: "active",
    calls: 12400,
    revenue: 456,
    reputation: 0.94,
    capabilities: ["data-analysis", "visualization", "insights"],
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30),
  },
  {
    id: "2",
    name: "content-writer",
    did: "did:noot:agent-4d5e6f7a",
    status: "active",
    calls: 8200,
    revenue: 312,
    reputation: 0.91,
    capabilities: ["content-generation", "copywriting"],
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 20),
  },
  {
    id: "3",
    name: "code-reviewer",
    did: "did:noot:agent-8b9c0d1e",
    status: "active",
    calls: 6100,
    revenue: 189,
    reputation: 0.89,
    capabilities: ["code-review", "security-audit"],
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 15),
  },
  {
    id: "4",
    name: "research-assistant",
    did: "did:noot:agent-2f3a4b5c",
    status: "paused",
    calls: 4800,
    revenue: 167,
    reputation: 0.87,
    capabilities: ["research", "summarization"],
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 10),
  },
];

export default function MyAgents() {
  const [agents, setAgents] = React.useState<Agent[]>(mockAgents);
  const [search, setSearch] = React.useState("");
  const [menuOpen, setMenuOpen] = React.useState<string | null>(null);

  const filtered = agents.filter((a) => a.name.toLowerCase().includes(search.toLowerCase()));

  const toggleStatus = (id: string) => {
    setAgents((prev) =>
      prev.map((a) =>
        a.id === id ? { ...a, status: a.status === "active" ? "paused" : "active" } : a
      )
    );
    setMenuOpen(null);
  };

  const deleteAgent = (id: string) => {
    if (confirm("Are you sure you want to delete this agent?")) {
      setAgents((prev) => prev.filter((a) => a.id !== id));
    }
    setMenuOpen(null);
  };

  return (
    <div className="flex-1 p-6 lg:p-8 overflow-y-auto">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">My Agents</h1>
            <p className="text-[#707090] mt-1">Manage your deployed agents</p>
          </div>
          <Link to="/dev/agents/new" className="btn-neural">
            <Plus className="w-4 h-4" /> Deploy Agent
          </Link>
        </div>

        {/* Search */}
        <div className="relative mb-6">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#505060]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agents..."
            className="w-full bg-[#0a0a12] border border-[#4f7cff]/20 rounded-xl pl-12 pr-4 py-3 text-white placeholder-[#505060] focus:border-[#a855f7]/40 focus:outline-none transition-all"
          />
        </div>

        {/* Agents grid */}
        {filtered.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[#a855f7]/10 flex items-center justify-center">
              <Bot className="w-8 h-8 text-[#a855f7]" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">No agents found</h3>
            <p className="text-[#707090] mb-6">
              {search ? "Try a different search term" : "Deploy your first agent to get started"}
            </p>
            <Link to="/dev/agents/new" className="btn-neural inline-flex">
              <Plus className="w-4 h-4" /> Deploy Agent
            </Link>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {filtered.map((agent, i) => (
              <motion.div
                key={agent.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="bg-[#0a0a12] border border-[#4f7cff]/10 rounded-xl p-5 hover:border-[#a855f7]/30 transition-all"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-[#a855f7]/10 flex items-center justify-center">
                      <Bot className="w-6 h-6 text-[#a855f7]" />
                    </div>
                    <div>
                      <h3 className="text-white font-semibold">{agent.name}</h3>
                      <div className="text-xs text-[#505060] font-mono">{agent.did}</div>
                    </div>
                  </div>
                  <div className="relative">
                    <button
                      onClick={() => setMenuOpen(menuOpen === agent.id ? null : agent.id)}
                      className="p-2 text-[#505060] hover:text-white rounded-lg hover:bg-[#4f7cff]/10"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>
                    {menuOpen === agent.id && (
                      <div className="absolute right-0 top-full mt-1 w-40 bg-[#0f0f18] border border-[#4f7cff]/20 rounded-lg py-1 shadow-xl z-10">
                        <button
                          onClick={() => toggleStatus(agent.id)}
                          className="flex items-center gap-2 w-full px-3 py-2 text-sm text-[#909098] hover:bg-[#4f7cff]/10 hover:text-white"
                        >
                          {agent.status === "active" ? (
                            <>
                              <Pause className="w-4 h-4" /> Pause
                            </>
                          ) : (
                            <>
                              <Play className="w-4 h-4" /> Resume
                            </>
                          )}
                        </button>
                        <Link
                          to={`/dev/agents/${agent.id}/settings`}
                          className="flex items-center gap-2 w-full px-3 py-2 text-sm text-[#909098] hover:bg-[#4f7cff]/10 hover:text-white"
                        >
                          <Settings className="w-4 h-4" /> Settings
                        </Link>
                        <button
                          onClick={() => deleteAgent(agent.id)}
                          className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-400 hover:bg-red-500/10"
                        >
                          <Trash2 className="w-4 h-4" /> Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 mb-4">
                  <span
                    className={`px-2 py-0.5 text-xs rounded-full ${
                      agent.status === "active"
                        ? "bg-[#39ff8e]/10 text-[#39ff8e]"
                        : agent.status === "paused"
                        ? "bg-yellow-500/10 text-yellow-500"
                        : "bg-[#4f7cff]/10 text-[#4f7cff]"
                    }`}
                  >
                    {agent.status}
                  </span>
                  <span className="text-xs text-[#505060]">
                    Rep: {(agent.reputation * 100).toFixed(0)}%
                  </span>
                </div>

                <div className="flex flex-wrap gap-1 mb-4">
                  {agent.capabilities.map((cap) => (
                    <span
                      key={cap}
                      className="px-2 py-0.5 text-[10px] bg-[#4f7cff]/10 text-[#4f7cff] rounded-full"
                    >
                      {cap}
                    </span>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-[#4f7cff]/10">
                  <div>
                    <div className="text-lg font-semibold text-white">
                      {agent.calls.toLocaleString()}
                    </div>
                    <div className="text-xs text-[#505060]">Total calls</div>
                  </div>
                  <div>
                    <div className="text-lg font-semibold text-[#39ff8e]">${agent.revenue}</div>
                    <div className="text-xs text-[#505060]">Revenue</div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

