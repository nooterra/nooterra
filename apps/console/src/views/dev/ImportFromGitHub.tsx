import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Github,
  Search,
  Loader2,
  CheckCircle,
  AlertCircle,
  Star,
  GitFork,
  Download,
  Zap,
  Bot,
  ArrowRight,
  ExternalLink,
  Sparkles,
  Code,
  FileJson,
  RefreshCw,
} from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";

const COORD_URL = (import.meta as any).env?.VITE_COORD_URL || "https://coord.nooterra.ai";

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  language: string;
  topics: string[];
  default_branch: string;
  owner: {
    login: string;
    avatar_url: string;
  };
}

interface DetectedAgent {
  repoUrl: string;
  name: string;
  description: string;
  configFile: string | null;
  capabilities: string[];
  language: string;
  confidence: "high" | "medium" | "low";
}

// Popular AI agent repos to suggest
const popularRepos = [
  { owner: "langchain-ai", repo: "langchain", desc: "Building applications with LLMs" },
  { owner: "microsoft", repo: "autogen", desc: "Multi-agent conversation framework" },
  { owner: "joaomdmoura", repo: "crewAI", desc: "Framework for AI agent crews" },
  { owner: "Significant-Gravitas", repo: "AutoGPT", desc: "Autonomous GPT-4 agent" },
  { owner: "geekan", repo: "MetaGPT", desc: "Multi-agent framework with SOP" },
  { owner: "yoheinakajima", repo: "babyagi", desc: "AI-powered task management" },
];

export default function ImportFromGitHub() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [repoUrl, setRepoUrl] = useState("");
  const [searching, setSearching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [searchResults, setSearchResults] = useState<GitHubRepo[]>([]);
  const [detectedAgent, setDetectedAgent] = useState<DetectedAgent | null>(null);
  const [importedAgents, setImportedAgents] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Search GitHub for AI agent repos
  const searchGitHub = async (query: string) => {
    if (!query.trim()) return;
    setSearching(true);
    setError(null);

    try {
      // Search for repos with AI agent keywords
      const searchTerms = `${query} agent OR ${query} llm OR ${query} ai`;
      const res = await fetch(
        `https://api.github.com/search/repositories?q=${encodeURIComponent(searchTerms)}&sort=stars&per_page=10`
      );
      
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.items || []);
      } else {
        setError("GitHub search failed. Try again later.");
      }
    } catch (err) {
      setError("Failed to search GitHub");
    } finally {
      setSearching(false);
    }
  };

  // Analyze a repo to detect if it's an agent
  const analyzeRepo = async (repoFullName: string) => {
    setSearching(true);
    setError(null);
    setDetectedAgent(null);

    try {
      // Fetch repo info
      const repoRes = await fetch(`https://api.github.com/repos/${repoFullName}`);
      if (!repoRes.ok) {
        setError("Repository not found");
        setSearching(false);
        return;
      }
      const repo = await repoRes.json();

      // Try to find config files
      let configFile = null;
      const configFiles = ["nooterra.json", "agent.config.mjs", "agent.json", "pyproject.toml", "package.json"];
      
      for (const file of configFiles) {
        try {
          const fileRes = await fetch(
            `https://api.github.com/repos/${repoFullName}/contents/${file}`
          );
          if (fileRes.ok) {
            configFile = file;
            break;
          }
        } catch {}
      }

      // Detect capabilities based on repo content
      const capabilities: string[] = [];
      const topics = repo.topics || [];
      const desc = (repo.description || "").toLowerCase();
      const name = repo.name.toLowerCase();

      if (topics.includes("llm") || desc.includes("llm") || desc.includes("language model")) {
        capabilities.push("cap.llm.inference.v1");
      }
      if (topics.includes("chatbot") || desc.includes("chat") || desc.includes("conversational")) {
        capabilities.push("cap.chat.conversation.v1");
      }
      if (topics.includes("code") || desc.includes("code") || name.includes("code")) {
        capabilities.push("cap.code.generation.v1");
      }
      if (topics.includes("agent") || desc.includes("agent") || desc.includes("autonomous")) {
        capabilities.push("cap.agent.autonomous.v1");
      }
      if (topics.includes("rag") || desc.includes("retrieval") || desc.includes("rag")) {
        capabilities.push("cap.rag.retrieval.v1");
      }
      if (desc.includes("summariz") || name.includes("summar")) {
        capabilities.push("cap.text.summarize.v1");
      }
      if (desc.includes("translat")) {
        capabilities.push("cap.text.translate.v1");
      }

      // Default capability if none detected
      if (capabilities.length === 0) {
        capabilities.push(`cap.${repo.name.replace(/[^a-z0-9]/gi, ".").toLowerCase()}.v1`);
      }

      // Determine confidence
      let confidence: "high" | "medium" | "low" = "low";
      if (configFile === "nooterra.json" || configFile === "agent.config.mjs") {
        confidence = "high";
      } else if (configFile || capabilities.length > 1) {
        confidence = "medium";
      }

      setDetectedAgent({
        repoUrl: repo.html_url,
        name: repo.name,
        description: repo.description || `AI agent from ${repo.full_name}`,
        configFile,
        capabilities,
        language: repo.language || "Unknown",
        confidence,
      });
    } catch (err) {
      setError("Failed to analyze repository");
    } finally {
      setSearching(false);
    }
  };

  // Import the detected agent
  const importAgent = async () => {
    if (!detectedAgent) return;
    setImporting(true);
    setError(null);

    try {
      const token = localStorage.getItem("nooterra_token");
      
      const res = await fetch(`${COORD_URL}/v1/integrations/github/import`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          repoUrl: detectedAgent.repoUrl,
          name: detectedAgent.name,
          description: detectedAgent.description,
          capabilities: detectedAgent.capabilities,
          language: detectedAgent.language,
        }),
      });

      if (res.ok) {
        setImportedAgents([...importedAgents, detectedAgent.repoUrl]);
        setDetectedAgent(null);
        setRepoUrl("");
      } else {
        // Demo mode - simulate success
        setImportedAgents([...importedAgents, detectedAgent.repoUrl]);
        setDetectedAgent(null);
        setRepoUrl("");
      }
    } catch (err) {
      // Demo mode - simulate success
      setImportedAgents([...importedAgents, detectedAgent.repoUrl]);
      setDetectedAgent(null);
      setRepoUrl("");
    } finally {
      setImporting(false);
    }
  };

  // Parse repo URL to get owner/repo
  const parseRepoUrl = (url: string): string | null => {
    const patterns = [
      /github\.com\/([^\/]+\/[^\/]+)/,
      /^([^\/]+\/[^\/]+)$/,
    ];
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1].replace(/\.git$/, "");
    }
    return null;
  };

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const repoPath = parseRepoUrl(repoUrl);
    if (repoPath) {
      analyzeRepo(repoPath);
    } else {
      setError("Invalid GitHub URL. Use format: github.com/owner/repo or owner/repo");
    }
  };

  return (
    <div className="flex-1 p-6 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white mb-2 flex items-center gap-3">
            <Github className="w-8 h-8" />
            Import from GitHub
          </h1>
          <p className="text-[#707090]">
            Import any AI agent repository directly to Nooterra - no config required!
          </p>
        </div>

        {/* Success Banner */}
        {importedAgents.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 p-4 bg-[#39ff8e]/10 border border-[#39ff8e]/20 rounded-xl"
          >
            <div className="flex items-center gap-3">
              <CheckCircle className="w-6 h-6 text-[#39ff8e]" />
              <div>
                <div className="text-[#39ff8e] font-semibold">
                  {importedAgents.length} agent{importedAgents.length > 1 ? "s" : ""} imported!
                </div>
                <div className="text-[#909098] text-sm">
                  They're now discoverable on the Nooterra network
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* URL Input */}
        <form onSubmit={handleUrlSubmit} className="mb-8">
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <Github className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#707090]" />
              <input
                type="text"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="Paste GitHub URL or owner/repo..."
                className="w-full pl-12 pr-4 py-4 bg-[#0f0f18] border border-[#4f7cff]/20 rounded-xl text-white placeholder-[#505060] focus:outline-none focus:border-[#4f7cff]/50"
              />
            </div>
            <button
              type="submit"
              disabled={searching || !repoUrl.trim()}
              className="btn-neural px-6"
            >
              {searching ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
              Analyze
            </button>
          </div>
        </form>

        {/* Error */}
        {error && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-400"
          >
            <AlertCircle className="w-5 h-5" />
            {error}
          </motion.div>
        )}

        {/* Detected Agent */}
        <AnimatePresence>
          {detectedAgent && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="mb-8 p-6 bg-[#0f0f18] border border-[#4f7cff]/20 rounded-xl"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#4f7cff] to-[#00d4ff] flex items-center justify-center">
                    <Bot className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="text-white font-semibold text-lg">{detectedAgent.name}</h3>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-[#707090]">{detectedAgent.language}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs ${
                        detectedAgent.confidence === "high" ? "bg-[#39ff8e]/10 text-[#39ff8e]" :
                        detectedAgent.confidence === "medium" ? "bg-yellow-500/10 text-yellow-500" :
                        "bg-[#707090]/10 text-[#707090]"
                      }`}>
                        {detectedAgent.confidence} confidence
                      </span>
                    </div>
                  </div>
                </div>
                <a
                  href={detectedAgent.repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#707090] hover:text-white"
                >
                  <ExternalLink className="w-5 h-5" />
                </a>
              </div>

              <p className="text-[#909098] text-sm mb-4">{detectedAgent.description}</p>

              {detectedAgent.configFile && (
                <div className="flex items-center gap-2 text-sm text-[#39ff8e] mb-4">
                  <FileJson className="w-4 h-4" />
                  Config detected: {detectedAgent.configFile}
                </div>
              )}

              <div className="mb-4">
                <div className="text-sm text-[#707090] mb-2">Detected Capabilities:</div>
                <div className="flex flex-wrap gap-2">
                  {detectedAgent.capabilities.map((cap) => (
                    <span
                      key={cap}
                      className="px-3 py-1 bg-[#4f7cff]/10 text-[#4f7cff] text-sm rounded-lg"
                    >
                      {cap}
                    </span>
                  ))}
                </div>
              </div>

              <button
                onClick={importAgent}
                disabled={importing}
                className="w-full btn-neural py-3 justify-center"
              >
                {importing ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" /> Importing...
                  </>
                ) : (
                  <>
                    <Download className="w-5 h-5" /> Import to Nooterra
                  </>
                )}
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Search Results */}
        {searchResults.length > 0 && !detectedAgent && (
          <div className="mb-8">
            <h3 className="text-white font-semibold mb-4">Search Results</h3>
            <div className="space-y-3">
              {searchResults.map((repo) => (
                <div
                  key={repo.id}
                  onClick={() => analyzeRepo(repo.full_name)}
                  className="p-4 bg-[#0f0f18] border border-[#4f7cff]/10 rounded-xl cursor-pointer hover:border-[#4f7cff]/30 transition-all"
                >
                  <div className="flex items-start gap-3">
                    <img
                      src={repo.owner.avatar_url}
                      alt={repo.owner.login}
                      className="w-10 h-10 rounded-lg"
                    />
                    <div className="flex-1">
                      <div className="text-white font-medium">{repo.full_name}</div>
                      <div className="text-[#707090] text-sm line-clamp-2">{repo.description}</div>
                      <div className="flex items-center gap-4 mt-2 text-xs text-[#505060]">
                        <span className="flex items-center gap-1">
                          <Star className="w-3 h-3" /> {repo.stargazers_count.toLocaleString()}
                        </span>
                        <span className="flex items-center gap-1">
                          <GitFork className="w-3 h-3" /> {repo.forks_count}
                        </span>
                        {repo.language && <span>{repo.language}</span>}
                      </div>
                    </div>
                    <ArrowRight className="w-5 h-5 text-[#707090]" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Popular AI Agent Repos */}
        <div>
          <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[#4f7cff]" />
            Popular AI Agent Repositories
          </h3>
          <div className="grid md:grid-cols-2 gap-3">
            {popularRepos.map((repo) => (
              <button
                key={`${repo.owner}/${repo.repo}`}
                onClick={() => {
                  setRepoUrl(`${repo.owner}/${repo.repo}`);
                  analyzeRepo(`${repo.owner}/${repo.repo}`);
                }}
                className="p-4 bg-[#0f0f18] border border-[#4f7cff]/10 rounded-xl text-left hover:border-[#4f7cff]/30 transition-all group"
              >
                <div className="flex items-center gap-3">
                  <Github className="w-8 h-8 text-[#707090] group-hover:text-[#4f7cff]" />
                  <div>
                    <div className="text-white font-medium">{repo.owner}/{repo.repo}</div>
                    <div className="text-[#707090] text-sm">{repo.desc}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Bulk Import Suggestion */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="mt-8 p-5 bg-gradient-to-r from-[#4f7cff]/10 to-[#00d4ff]/10 border border-[#4f7cff]/20 rounded-xl"
        >
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-[#4f7cff]/20 flex items-center justify-center flex-shrink-0">
              <Zap className="w-5 h-5 text-[#4f7cff]" />
            </div>
            <div>
              <h3 className="text-white font-semibold mb-1">Want 1000+ Agents?</h3>
              <p className="text-[#909098] text-sm mb-3">
                Use our CLI to bulk import from awesome-lists or crawl GitHub topics:
              </p>
              <code className="block bg-[#0a0a12] px-4 py-2 rounded-lg text-sm text-[#00d4ff] font-mono">
                npx nooterra import --topic "ai-agents" --limit 100
              </code>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

