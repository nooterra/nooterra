import React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { GitBranch, Plus, Search, Play, Pause, MoreVertical, Clock, ArrowRight, Zap } from "lucide-react";

type Workflow = {
  id: string;
  name: string;
  status: "active" | "paused" | "draft";
  runs: number;
  lastRun: string;
  nodes: number;
  createdBy: string;
};

const mockWorkflows: Workflow[] = [
  { id: "1", name: "Customer Support Pipeline", status: "active", runs: 2400, lastRun: "2 min ago", nodes: 5, createdBy: "Sarah" },
  { id: "2", name: "Content Generation Flow", status: "active", runs: 1800, lastRun: "15 min ago", nodes: 4, createdBy: "Mike" },
  { id: "3", name: "Data ETL Pipeline", status: "active", runs: 890, lastRun: "1 hour ago", nodes: 7, createdBy: "Lisa" },
  { id: "4", name: "Report Generator", status: "paused", runs: 450, lastRun: "6 hours ago", nodes: 3, createdBy: "John" },
  { id: "5", name: "Lead Scoring Flow", status: "draft", runs: 0, lastRun: "Never", nodes: 6, createdBy: "Sarah" },
];

export default function Workflows() {
  const [workflows] = React.useState<Workflow[]>(mockWorkflows);
  const [search, setSearch] = React.useState("");

  const filtered = workflows.filter((w) => w.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="flex-1 p-6 lg:p-8 overflow-y-auto">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Workflows</h1>
            <p className="text-[#707090] mt-1">Automate tasks with visual AI pipelines</p>
          </div>
          <Link to="/org/workflows/new" className="btn-neural">
            <Plus className="w-4 h-4" /> New Workflow
          </Link>
        </div>

        {/* Search */}
        <div className="relative mb-6">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#505060]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search workflows..."
            className="w-full bg-[#0a0a12] border border-[#4f7cff]/20 rounded-xl pl-12 pr-4 py-3 text-white placeholder-[#505060] focus:border-[#00d4ff]/40 focus:outline-none transition-all"
          />
        </div>

        {/* Workflows grid */}
        {filtered.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[#00d4ff]/10 flex items-center justify-center">
              <GitBranch className="w-8 h-8 text-[#00d4ff]" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">No workflows found</h3>
            <p className="text-[#707090] mb-6">
              {search ? "Try a different search term" : "Create your first workflow to get started"}
            </p>
            <Link to="/org/workflows/new" className="btn-neural inline-flex">
              <Plus className="w-4 h-4" /> Create Workflow
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((workflow, i) => (
              <motion.div
                key={workflow.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <Link
                  to={`/org/workflows/${workflow.id}`}
                  className="group block p-5 bg-[#0a0a12] border border-[#4f7cff]/10 rounded-xl hover:border-[#00d4ff]/30 transition-all"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-[#00d4ff]/10 flex items-center justify-center group-hover:bg-[#00d4ff]/20 transition-colors">
                        <GitBranch className="w-6 h-6 text-[#00d4ff]" />
                      </div>
                      <div>
                        <h3 className="text-white font-semibold group-hover:text-[#00d4ff] transition-colors">
                          {workflow.name}
                        </h3>
                        <div className="flex items-center gap-3 text-xs text-[#505060] mt-1">
                          <span>{workflow.nodes} nodes</span>
                          <span>•</span>
                          <span>by {workflow.createdBy}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <div className="text-sm text-white">{workflow.runs.toLocaleString()}</div>
                        <div className="text-xs text-[#505060]">runs</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm text-[#707090] flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {workflow.lastRun}
                        </div>
                      </div>
                      <span
                        className={`px-3 py-1 text-xs rounded-full ${
                          workflow.status === "active"
                            ? "bg-[#39ff8e]/10 text-[#39ff8e]"
                            : workflow.status === "paused"
                            ? "bg-yellow-500/10 text-yellow-500"
                            : "bg-[#4f7cff]/10 text-[#4f7cff]"
                        }`}
                      >
                        {workflow.status}
                      </span>
                      <ArrowRight className="w-5 h-5 text-[#505060] group-hover:text-[#00d4ff] transition-colors" />
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

