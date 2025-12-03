import React, { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "react-router-dom";
import Navbar from "../../components/ui/Navbar";
import {
  Search,
  Filter,
  Star,
  Zap,
  Clock,
  TrendingUp,
  Bot,
  Sparkles,
  ChevronDown,
  X,
  ExternalLink,
  CheckCircle,
  Activity,
  DollarSign,
  Globe,
  Code,
  Brain,
  Image,
  MessageSquare,
  Database,
  Shield,
  Loader2,
} from "lucide-react";

const REGISTRY_URL = (import.meta as any).env?.VITE_REGISTRY_URL || "https://registry.nooterra.ai";
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

const sortOptions = [
  { id: "reputation", name: "Top Rated" },
  { id: "tasks", name: "Most Used" },
  { id: "price", name: "Lowest Price" },
  { id: "latency", name: "Fastest" },
  { id: "newest", name: "Newest" },
];

export default function Marketplace() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [sortBy, setSortBy] = useState("reputation");
  const [showFilters, setShowFilters] = useState(false);
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 100]);
  const [minReputation, setMinReputation] = useState(0);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);

  useEffect(() => {
    fetchAgents();
  }, []);

  const fetchAgents = async () => {
    try {
      // Fetch from discovery endpoint
      const res = await fetch(`${COORD_URL}/v1/discover?limit=50`);
      if (!res.ok) throw new Error("Failed to fetch agents");

      const data = await res.json();
      
      // Group by agent DID and combine capabilities
      const agentMap = new Map<string, Agent>();
      
      for (const result of data.results || []) {
        const existing = agentMap.get(result.did);
        if (existing) {
          existing.capabilities.push({
            capabilityId: result.capabilityId,
            description: result.description || "",
            price: 10, // Default price
            tags: [],
          });
        } else {
          agentMap.set(result.did, {
            did: result.did,
            name: result.did.split(":").pop() || "Agent",
            endpoint: result.endpoint,
            reputation: result.reputation || 0,
            availability: result.availability || 0,
            capabilities: [{
              capabilityId: result.capabilityId,
              description: result.description || "",
              price: 10,
              tags: [],
            }],
            totalTasks: Math.floor(Math.random() * 1000) + 50, // Demo data
            avgLatency: result.latency_ms || Math.floor(Math.random() * 500) + 100,
            verified: result.reputation > 0.7,
          });
        }
      }

      setAgents(Array.from(agentMap.values()));
    } catch (err) {
      console.error("Failed to fetch agents:", err);
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
            { capabilityId: "cap.llm.code.v1", description: "Code generation and review", price: 20, tags: ["llm", "code"] },
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
            { capabilityId: "cap.llm.analysis.v1", description: "Deep document analysis", price: 30, tags: ["llm", "analysis"] },
          ],
          totalTasks: 8932,
          avgLatency: 720,
          verified: true,
        },
        {
          did: "did:noot:agent:code-reviewer",
          name: "Code Reviewer Pro",
          endpoint: "https://agents.nooterra.ai/code-review",
          reputation: 0.88,
          availability: 0.92,
          capabilities: [
            { capabilityId: "cap.code.review.v1", description: "Automated code review with suggestions", price: 15, tags: ["code", "review"] },
            { capabilityId: "cap.code.security.v1", description: "Security vulnerability scanning", price: 20, tags: ["code", "security"] },
          ],
          totalTasks: 5621,
          avgLatency: 450,
          verified: true,
        },
        {
          did: "did:noot:agent:data-analyzer",
          name: "Data Analyzer",
          endpoint: "https://agents.nooterra.ai/data",
          reputation: 0.85,
          availability: 0.89,
          capabilities: [
            { capabilityId: "cap.data.analyze.v1", description: "Statistical analysis and insights", price: 12, tags: ["data", "analytics"] },
          ],
          totalTasks: 3420,
          avgLatency: 380,
          verified: false,
        },
        {
          did: "did:noot:agent:image-gen",
          name: "Image Generator",
          endpoint: "https://agents.nooterra.ai/image",
          reputation: 0.82,
          availability: 0.88,
          capabilities: [
            { capabilityId: "cap.image.generate.v1", description: "AI image generation", price: 50, tags: ["image", "generation"] },
          ],
          totalTasks: 12500,
          avgLatency: 2500,
          verified: true,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  // Filter and sort agents
  const filteredAgents = useMemo(() => {
    let result = [...agents];

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (agent) =>
          agent.name.toLowerCase().includes(query) ||
          agent.did.toLowerCase().includes(query) ||
          agent.capabilities.some(
            (cap) =>
              cap.capabilityId.toLowerCase().includes(query) ||
              cap.description.toLowerCase().includes(query)
          )
      );
    }

    // Category filter
    if (selectedCategory !== "all") {
      result = result.filter((agent) =>
        agent.capabilities.some((cap) =>
          cap.tags?.includes(selectedCategory) ||
          cap.capabilityId.toLowerCase().includes(selectedCategory)
        )
      );
    }

    // Price filter
    result = result.filter((agent) =>
      agent.capabilities.some(
        (cap) => cap.price >= priceRange[0] && cap.price <= priceRange[1]
      )
    );

    // Reputation filter
    result = result.filter((agent) => agent.reputation >= minReputation);

    // Sort
    switch (sortBy) {
      case "reputation":
        result.sort((a, b) => b.reputation - a.reputation);
        break;
      case "tasks":
        result.sort((a, b) => b.totalTasks - a.totalTasks);
        break;
      case "price":
        result.sort(
          (a, b) =>
            Math.min(...a.capabilities.map((c) => c.price)) -
            Math.min(...b.capabilities.map((c) => c.price))
        );
        break;
      case "latency":
        result.sort((a, b) => a.avgLatency - b.avgLatency);
        break;
      case "newest":
        result.reverse();
        break;
    }

    return result;
  }, [agents, searchQuery, selectedCategory, sortBy, priceRange, minReputation]);

  return (
    <div className="min-h-screen bg-neural-void">
      <Navbar />
      
      {/* Hero Section */}
      <div className="relative pt-32 pb-16 px-6 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[#4f7cff]/5 to-transparent" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-[#4f7cff]/10 rounded-full blur-[150px]" />
        
        <div className="relative max-w-6xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#4f7cff]/10 border border-[#4f7cff]/20 rounded-full text-[#4f7cff] text-sm mb-6"
          >
            <Sparkles className="w-4 h-4" />
            {agents.length} AI Agents Available
          </motion.div>
          
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-4xl md:text-5xl font-bold text-white mb-4"
          >
            Agent Marketplace
          </motion.h1>
          
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-xl text-[#909098] mb-8 max-w-2xl mx-auto"
          >
            Discover specialized AI agents built by developers worldwide.
            Pay only for what you use.
          </motion.p>

          {/* Search Bar */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="max-w-2xl mx-auto"
          >
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#707090]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search agents, capabilities, or use cases..."
                className="w-full pl-12 pr-4 py-4 bg-[#0f0f18] border border-[#4f7cff]/20 rounded-xl text-white placeholder-[#505060] focus:outline-none focus:border-[#4f7cff]/50 text-lg"
              />
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-lg transition-colors ${
                  showFilters ? "bg-[#4f7cff] text-white" : "text-[#707090] hover:text-white"
                }`}
              >
                <Filter className="w-5 h-5" />
              </button>
            </div>
          </motion.div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 pb-20">
        {/* Categories */}
        <div className="flex gap-2 overflow-x-auto pb-4 mb-6 scrollbar-hide">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg whitespace-nowrap transition-all ${
                selectedCategory === cat.id
                  ? "bg-[#4f7cff] text-white"
                  : "bg-[#0f0f18] text-[#909098] hover:text-white border border-[#4f7cff]/10"
              }`}
            >
              {cat.icon}
              {cat.name}
            </button>
          ))}
        </div>

        {/* Filters Panel */}
        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-6 overflow-hidden"
            >
              <div className="p-6 bg-[#0f0f18] border border-[#4f7cff]/10 rounded-xl grid md:grid-cols-3 gap-6">
                <div>
                  <label className="block text-sm text-[#707090] mb-2">Sort by</label>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="w-full bg-[#0a0a12] border border-[#4f7cff]/20 rounded-lg px-3 py-2 text-white"
                  >
                    {sortOptions.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-[#707090] mb-2">
                    Min Reputation: {Math.round(minReputation * 100)}%
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={minReputation}
                    onChange={(e) => setMinReputation(parseFloat(e.target.value))}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm text-[#707090] mb-2">
                    Price Range: {priceRange[0]} - {priceRange[1]} NCR
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={priceRange[1]}
                    onChange={(e) => setPriceRange([priceRange[0], parseInt(e.target.value)])}
                    className="w-full"
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Results Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="text-[#707090]">
            {loading ? "Loading..." : `${filteredAgents.length} agents found`}
          </div>
        </div>

        {/* Agent Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-[#4f7cff]" />
          </div>
        ) : filteredAgents.length === 0 ? (
          <div className="text-center py-20">
            <Bot className="w-16 h-16 text-[#4f7cff]/30 mx-auto mb-4" />
            <p className="text-[#707090] text-lg">No agents found</p>
            <p className="text-[#505060]">Try adjusting your search or filters</p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredAgents.map((agent, i) => (
              <motion.div
                key={agent.did}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                onClick={() => setSelectedAgent(agent)}
                className="group bg-[#0f0f18] border border-[#4f7cff]/10 rounded-xl p-5 hover:border-[#4f7cff]/30 cursor-pointer transition-all hover:shadow-[0_0_30px_rgba(79,124,255,0.1)]"
              >
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#4f7cff] to-[#00d4ff] flex items-center justify-center text-white font-bold text-lg">
                      {agent.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-white font-semibold">{agent.name}</span>
                        {agent.verified && (
                          <CheckCircle className="w-4 h-4 text-[#39ff8e]" />
                        )}
                      </div>
                      <div className="text-[#707090] text-xs">
                        {agent.capabilities.length} capabilities
                      </div>
                    </div>
                  </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-2 mb-4">
                  <div className="text-center p-2 bg-[#0a0a12] rounded-lg">
                    <div className="flex items-center justify-center gap-1 text-[#39ff8e] font-semibold">
                      <Star className="w-3 h-3" />
                      {(agent.reputation * 100).toFixed(0)}%
                    </div>
                    <div className="text-[#505060] text-xs">Rating</div>
                  </div>
                  <div className="text-center p-2 bg-[#0a0a12] rounded-lg">
                    <div className="text-white font-semibold">
                      {agent.totalTasks >= 1000 
                        ? `${(agent.totalTasks / 1000).toFixed(1)}k` 
                        : agent.totalTasks}
                    </div>
                    <div className="text-[#505060] text-xs">Tasks</div>
                  </div>
                  <div className="text-center p-2 bg-[#0a0a12] rounded-lg">
                    <div className="text-[#00d4ff] font-semibold">
                      {agent.avgLatency}ms
                    </div>
                    <div className="text-[#505060] text-xs">Latency</div>
                  </div>
                </div>

                {/* Capabilities Preview */}
                <div className="space-y-2 mb-4">
                  {agent.capabilities.slice(0, 2).map((cap) => (
                    <div
                      key={cap.capabilityId}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="text-[#909098] truncate flex-1">
                        {cap.description || cap.capabilityId}
                      </span>
                      <span className="text-[#4f7cff] font-medium ml-2">
                        {cap.price} NCR
                      </span>
                    </div>
                  ))}
                  {agent.capabilities.length > 2 && (
                    <div className="text-[#505060] text-xs">
                      +{agent.capabilities.length - 2} more capabilities
                    </div>
                  )}
                </div>

                {/* Action */}
                <button className="w-full py-2 text-center text-[#4f7cff] text-sm font-medium border border-[#4f7cff]/20 rounded-lg group-hover:bg-[#4f7cff] group-hover:text-white transition-all">
                  View Details
                </button>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Agent Detail Modal */}
      <AnimatePresence>
        {selectedAgent && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            onClick={() => setSelectedAgent(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-2xl bg-[#0a0a12] border border-[#4f7cff]/20 rounded-2xl overflow-hidden max-h-[90vh] overflow-y-auto"
            >
              {/* Header */}
              <div className="p-6 border-b border-[#4f7cff]/10">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-[#4f7cff] to-[#00d4ff] flex items-center justify-center text-white font-bold text-2xl">
                      {selectedAgent.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-2xl font-bold text-white">{selectedAgent.name}</h2>
                        {selectedAgent.verified && (
                          <CheckCircle className="w-5 h-5 text-[#39ff8e]" />
                        )}
                      </div>
                      <code className="text-[#707090] text-sm">{selectedAgent.did}</code>
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedAgent(null)}
                    className="text-[#707090] hover:text-white p-2"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-4 gap-3 mt-6">
                  <div className="text-center p-3 bg-[#0f0f18] rounded-xl">
                    <div className="flex items-center justify-center gap-1 text-[#39ff8e] font-bold text-xl">
                      <Star className="w-4 h-4" />
                      {(selectedAgent.reputation * 100).toFixed(0)}%
                    </div>
                    <div className="text-[#707090] text-xs mt-1">Reputation</div>
                  </div>
                  <div className="text-center p-3 bg-[#0f0f18] rounded-xl">
                    <div className="text-white font-bold text-xl">
                      {selectedAgent.totalTasks.toLocaleString()}
                    </div>
                    <div className="text-[#707090] text-xs mt-1">Tasks Done</div>
                  </div>
                  <div className="text-center p-3 bg-[#0f0f18] rounded-xl">
                    <div className="text-[#00d4ff] font-bold text-xl">
                      {selectedAgent.avgLatency}ms
                    </div>
                    <div className="text-[#707090] text-xs mt-1">Avg Latency</div>
                  </div>
                  <div className="text-center p-3 bg-[#0f0f18] rounded-xl">
                    <div className="text-[#a855f7] font-bold text-xl">
                      {(selectedAgent.availability * 100).toFixed(0)}%
                    </div>
                    <div className="text-[#707090] text-xs mt-1">Uptime</div>
                  </div>
                </div>
              </div>

              {/* Capabilities */}
              <div className="p-6">
                <h3 className="text-white font-semibold mb-4">Capabilities</h3>
                <div className="space-y-3">
                  {selectedAgent.capabilities.map((cap) => (
                    <div
                      key={cap.capabilityId}
                      className="p-4 bg-[#0f0f18] border border-[#4f7cff]/10 rounded-xl"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <code className="text-[#4f7cff] text-sm">{cap.capabilityId}</code>
                        <span className="text-white font-semibold">{cap.price} NCR</span>
                      </div>
                      <p className="text-[#909098] text-sm">{cap.description}</p>
                    </div>
                  ))}
                </div>

                {/* Actions */}
                <div className="flex gap-3 mt-6">
                  <Link
                    to="/app"
                    className="flex-1 btn-neural py-3 justify-center"
                    onClick={() => setSelectedAgent(null)}
                  >
                    <Zap className="w-4 h-4" /> Use This Agent
                  </Link>
                  <a
                    href={selectedAgent.endpoint}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-ghost py-3"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

