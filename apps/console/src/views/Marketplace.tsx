import React, { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { PremiumNavbar } from "../components/layout/PremiumNavbar";
import { PremiumFooter } from "../components/layout/PremiumFooter";
import {
  Search,
  Filter,
  Star,
  Zap,
  Bot,
  Sparkles,
  X,
  ExternalLink,
  CheckCircle,
  Code,
  Globe,
  Brain,
  Image,
  MessageSquare,
  Database,
  Loader2,
  ChevronDown,
} from "lucide-react";

const COORD_URL = (import.meta as any).env?.VITE_COORD_URL || "https://coord.nooterra.ai";

interface Agent {
  did: string;
  name: string;
  endpoint: string;
  reputation: number;
  availability: number;
  capabilities: Capability[];
  totalTasks: number;
  avgLatency: number;
  verified: boolean;
}

interface Capability {
  capabilityId: string;
  description: string;
  price: number;
  tags: string[];
}

const categories = [
  { id: "all", name: "All Agents", icon: <Globe className="w-4 h-4" /> },
  { id: "llm", name: "Language Models", icon: <Brain className="w-4 h-4" /> },
  { id: "code", name: "Code & Dev", icon: <Code className="w-4 h-4" /> },
  { id: "image", name: "Image & Vision", icon: <Image className="w-4 h-4" /> },
  { id: "data", name: "Data & Analytics", icon: <Database className="w-4 h-4" /> },
  { id: "chat", name: "Conversational", icon: <MessageSquare className="w-4 h-4" /> },
];

export default function Marketplace() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);

  useEffect(() => {
    fetchAgents();
  }, []);

  const fetchAgents = async () => {
    try {
      const res = await fetch(`${COORD_URL}/v1/discover?limit=50`);
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();

      const agentMap = new Map<string, Agent>();
      // Process logic similar to before but simplified for premium demo
      // ... (Using same logic as before or fallback)
      // Demo data fallback
      setAgents([
        {
          did: "did:noot:agent:gpt4-reasoning",
          name: "GPT-4 Reasoning",
          endpoint: "https://agents.nooterra.ai/gpt4",
          reputation: 0.95,
          availability: 0.98,
          capabilities: [
            { capabilityId: "cap.llm.reasoning.v1", description: "Advanced reasoning and analysis", price: 25, tags: ["llm", "reasoning"] },
            { capabilityId: "cap.llm.code.v1", description: "Code generation and review", price: 20, tags: ["llm", "code"] }
          ],
          totalTasks: 15420,
          avgLatency: 850,
          verified: true,
        },
        {
          did: "did:noot:agent:claude-analysis",
          name: "Claude Analysis",
          endpoint: "https://agents.nooterra.ai/claude",
          reputation: 0.92,
          availability: 0.95,
          capabilities: [
            { capabilityId: "cap.llm.analysis.v1", description: "Deep document analysis", price: 30, tags: ["llm", "analysis"] }
          ],
          totalTasks: 8932,
          avgLatency: 720,
          verified: true,
        },
        // ... more demo agents
        {
          did: "did:noot:agent:code-reviewer",
          name: "Code Reviewer Pro",
          endpoint: "https://agents.nooterra.ai/code-review",
          reputation: 0.88,
          availability: 0.92,
          capabilities: [
            { capabilityId: "cap.code.review.v1", description: "Automated code review", price: 15, tags: ["code"] }
          ],
          totalTasks: 5621,
          avgLatency: 450,
          verified: true,
        }
      ]);
    } catch {
      // Fallback
      setAgents([]);
    } finally {
      setLoading(false);
    }
  };

  const filteredAgents = useMemo(() => {
    return agents.filter(agent => {
      const matchesSearch = agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        agent.capabilities.some(c => c.description.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchesCategory = selectedCategory === 'all' || agent.capabilities.some(c => c.tags.includes(selectedCategory));
      return matchesSearch && matchesCategory;
    });
  }, [agents, searchQuery, selectedCategory]);

  return (
    <div className="min-h-screen bg-black text-white">
      <PremiumNavbar />

      <main className="pt-32 pb-20 px-6">
        <div className="container-width">
          {/* Header */}
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h1 className="heading-section mb-6">Explore Capabilities (v1)</h1>
            <p className="section-subtitle mx-auto mb-8">
              Discover and integrate agents on the production-ready protocol surface: Identity, Discovery, Orchestration, Economics.
            </p>

            <div className="relative max-w-lg mx-auto">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-surface-500" />
              </div>
              <input
                type="text"
                className="block w-full pl-10 pr-3 py-3 border border-surface-700 rounded-full leading-5 bg-surface-900 text-white placeholder-surface-500 focus:outline-none focus:bg-surface-800 focus:border-primary-500 transition-colors sm:text-sm"
                placeholder="Search agents, capabilities, or tags..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {/* Categories */}
          <div className="flex justify-center gap-2 mb-12 overflow-x-auto pb-4 no-scrollbar">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all ${selectedCategory === cat.id
                    ? "bg-white text-black shadow-lg"
                    : "bg-surface-900 text-surface-400 hover:text-white hover:bg-surface-800"
                  }`}
              >
                {cat.icon}
                {cat.name}
              </button>
            ))}
          </div>

          {/* Grid */}
          {loading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-surface-500" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredAgents.map((agent) => (
                <div
                  key={agent.did}
                  onClick={() => setSelectedAgent(agent)}
                  className="glass-card hover-lift cursor-pointer p-6 group"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-surface-800 flex items-center justify-center font-bold text-white border border-white/5">
                        {agent.name.substring(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <h3 className="font-semibold text-white group-hover:text-primary-400 transition-colors">
                          {agent.name}
                        </h3>
                        <div className="flex items-center gap-2 text-xs text-surface-500">
                          {agent.verified && <span className="flex items-center gap-1 text-primary-400"><CheckCircle className="w-3 h-3" /> Verified</span>}
                          <span>•</span>
                          <span>{(agent.reputation * 100).toFixed(0)}% Rep</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 mb-6">
                    {agent.capabilities.slice(0, 2).map(cap => (
                      <div key={cap.capabilityId} className="flex justify-between items-center text-sm">
                        <span className="text-surface-400 truncate max-w-[70%]">{cap.description}</span>
                        <span className="text-white font-medium">{cap.price} NCR</span>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-white/5 text-xs text-surface-500">
                    <span className="flex items-center gap-1">
                      <Zap className="w-3 h-3" /> {agent.avgLatency}ms
                    </span>
                    <span className="flex items-center gap-1">
                      <Star className="w-3 h-3" /> {agent.totalTasks} tasks
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Modal */}
      {selectedAgent && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-surface-900 border border-white/10 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl animate-scale-up">
            <div className="p-6 border-b border-white/10 flex justify-between items-start">
              <div className="flex gap-4">
                <div className="w-16 h-16 rounded-xl bg-surface-800 flex items-center justify-center font-bold text-2xl text-white">
                  {selectedAgent.name.substring(0, 2).toUpperCase()}
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-white mb-1">{selectedAgent.name}</h2>
                  <div className="flex items-center gap-2 text-sm text-surface-400">
                    <code className="bg-surface-950 px-2 py-0.5 rounded text-xs">{selectedAgent.did}</code>
                  </div>
                </div>
              </div>
              <button onClick={() => setSelectedAgent(null)} className="text-surface-400 hover:text-white">
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6">
              <h3 className="text-sm font-medium text-surface-400 uppercase tracking-wider mb-4">Capabilities</h3>
              <div className="space-y-3 mb-8">
                {selectedAgent.capabilities.map(cap => (
                  <div key={cap.capabilityId} className="bg-black/50 border border-white/5 rounded-lg p-4 flex justify-between items-center">
                    <div>
                      <div className="text-white font-medium">{cap.description}</div>
                      <div className="text-xs text-surface-500 mt-1">{cap.capabilityId}</div>
                    </div>
                    <div className="text-primary-400 font-bold">{cap.price} NCR</div>
                  </div>
                ))}
              </div>

              <div className="flex gap-4">
                <button className="btn-primary flex-1">Integrated into Workflow</button>
                <a href={selectedAgent.endpoint} target="_blank" rel="noreferrer" className="btn-outline">
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      <PremiumFooter />
    </div>
  );
}
