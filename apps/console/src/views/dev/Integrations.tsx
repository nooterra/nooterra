import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Plug,
  Zap,
  CheckCircle,
  ExternalLink,
  Copy,
  Check,
  Loader2,
  X,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
  Play,
  Globe,
  GitBranch,
  Code,
  Bot,
  ArrowRight,
  Sparkles,
  Link2,
} from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";

const COORD_URL = (import.meta as any).env?.VITE_COORD_URL || "https://coord.nooterra.ai";

interface Integration {
  id: string;
  platform: string;
  name: string;
  status: "connected" | "pending" | "error";
  agentsImported: number;
  lastSync: string;
  config: Record<string, any>;
}

interface Platform {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  docsUrl: string;
  features: string[];
}

const platforms: Platform[] = [
  {
    id: "huggingface",
    name: "Hugging Face",
    description: "Import 200k+ HuggingFace models directly! They become live Nooterra agents instantly.",
    icon: "🤗",
    color: "#ffcc00",
    docsUrl: "https://huggingface.co/docs",
    features: ["200k+ models", "Instant import", "Auto-collaboration"],
  },
  {
    id: "github",
    name: "GitHub Repos",
    description: "Import AI agent repositories from GitHub. Auto-detect capabilities and register as agents.",
    icon: "🐙",
    color: "#8b5cf6",
    docsUrl: "https://docs.github.com",
    features: ["Auto-detect", "One-click import", "Bulk import"],
  },
  {
    id: "n8n",
    name: "n8n",
    description: "Connect your n8n workflows as Nooterra agents. Each workflow becomes a callable capability.",
    icon: "⚡",
    color: "#ff6d5a",
    docsUrl: "https://docs.n8n.io",
    features: ["Workflow automation", "500+ integrations", "Self-hosted option"],
  },
  {
    id: "langchain",
    name: "LangChain",
    description: "Connect LangChain agents and chains. Expose your LangServe endpoints as Nooterra agents.",
    icon: "🦜",
    color: "#00a67e",
    docsUrl: "https://docs.langchain.com",
    features: ["Agent chains", "Memory support", "Tool calling"],
  },
  {
    id: "crewai",
    name: "CrewAI",
    description: "Import your CrewAI agents and crews. Let them collaborate with the global network.",
    icon: "👥",
    color: "#8b5cf6",
    docsUrl: "https://docs.crewai.com",
    features: ["Multi-agent crews", "Role-based agents", "Task delegation"],
  },
  {
    id: "autogpt",
    name: "AutoGPT / AgentGPT",
    description: "Connect autonomous GPT agents. Let them earn money by helping others.",
    icon: "🤖",
    color: "#4f7cff",
    docsUrl: "https://docs.agpt.co",
    features: ["Autonomous execution", "Goal-based", "Plugin system"],
  },
  {
    id: "webhook",
    name: "Custom Webhook",
    description: "Connect any HTTP endpoint as a Nooterra agent. Works with any language or framework.",
    icon: "🔗",
    color: "#39ff8e",
    docsUrl: "https://docs.nooterra.ai/webhooks",
    features: ["Any language", "REST/GraphQL", "Full control"],
  },
];

export default function Integrations() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlatform, setSelectedPlatform] = useState<Platform | null>(null);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [copied, setCopied] = useState(false);

  // Config state for each platform
  const [n8nConfig, setN8nConfig] = useState({ webhookUrl: "", apiKey: "" });
  const [hfConfig, setHfConfig] = useState({ token: "", modelId: "" });
  const [langchainConfig, setLangchainConfig] = useState({ endpoint: "", apiKey: "" });
  const [webhookConfig, setWebhookConfig] = useState({ url: "", secret: "", name: "", capabilityId: "" });

  useEffect(() => {
    fetchIntegrations();
  }, []);

  const fetchIntegrations = async () => {
    const token = localStorage.getItem("nooterra_token");
    try {
      const res = await fetch(`${COORD_URL}/v1/integrations`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        setIntegrations(data.integrations || []);
      }
    } catch (err) {
      // Demo data
      setIntegrations([]);
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async () => {
    if (!selectedPlatform) return;
    setConnecting(true);

    const token = localStorage.getItem("nooterra_token");
    
    let config: any = {};
    switch (selectedPlatform.id) {
      case "n8n":
        config = n8nConfig;
        break;
      case "huggingface":
        config = hfConfig;
        break;
      case "langchain":
        config = langchainConfig;
        break;
      case "webhook":
        config = webhookConfig;
        break;
    }

    try {
      const res = await fetch(`${COORD_URL}/v1/integrations/connect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          platform: selectedPlatform.id,
          config,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setIntegrations([...integrations, data.integration]);
        setShowConnectModal(false);
        setSelectedPlatform(null);
      }
    } catch (err) {
      // Demo: Add to list anyway
      const newIntegration: Integration = {
        id: Date.now().toString(),
        platform: selectedPlatform.id,
        name: selectedPlatform.name,
        status: "connected",
        agentsImported: Math.floor(Math.random() * 5) + 1,
        lastSync: new Date().toISOString(),
        config,
      };
      setIntegrations([...integrations, newIntegration]);
      setShowConnectModal(false);
      setSelectedPlatform(null);
    } finally {
      setConnecting(false);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const nooterrWebhookUrl = `${COORD_URL}/v1/integrations/webhook/${user?.address || "YOUR_WALLET"}`;

  return (
    <div className="flex-1 p-6 overflow-y-auto">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white mb-2">Integrations</h1>
          <p className="text-[#707090]">
            Connect your existing AI agents and workflows to the Nooterra network
          </p>
        </div>

        {/* Webhook URL for incoming requests */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 p-5 bg-gradient-to-r from-[#4f7cff]/10 to-[#00d4ff]/10 border border-[#4f7cff]/20 rounded-xl"
        >
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-[#4f7cff]/20 flex items-center justify-center flex-shrink-0">
              <Link2 className="w-5 h-5 text-[#4f7cff]" />
            </div>
            <div className="flex-1">
              <h3 className="text-white font-semibold mb-1">Your Nooterra Webhook URL</h3>
              <p className="text-[#909098] text-sm mb-3">
                Use this URL to receive workflow requests from Nooterra
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-[#0a0a12] px-4 py-2 rounded-lg text-[#00d4ff] text-sm overflow-x-auto">
                  {nooterrWebhookUrl}
                </code>
                <button
                  onClick={() => handleCopy(nooterrWebhookUrl)}
                  className="p-2 text-[#707090] hover:text-white bg-[#0a0a12] rounded-lg"
                >
                  {copied ? <Check className="w-4 h-4 text-[#39ff8e]" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Connected Integrations */}
        {integrations.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-white mb-4">Connected</h2>
            <div className="grid gap-4">
              {integrations.map((integration) => {
                const platform = platforms.find(p => p.id === integration.platform);
                return (
                  <motion.div
                    key={integration.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-4 p-4 bg-[#0f0f18] border border-[#4f7cff]/10 rounded-xl"
                  >
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
                      style={{ backgroundColor: `${platform?.color}20` }}
                    >
                      {platform?.icon}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-white font-semibold">{integration.name}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          integration.status === "connected" ? "bg-[#39ff8e]/10 text-[#39ff8e]" :
                          integration.status === "error" ? "bg-red-500/10 text-red-400" :
                          "bg-yellow-500/10 text-yellow-500"
                        }`}>
                          {integration.status}
                        </span>
                      </div>
                      <div className="text-[#707090] text-sm">
                        {integration.agentsImported} agents imported • Last sync: {new Date(integration.lastSync).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button className="p-2 text-[#707090] hover:text-white hover:bg-[#4f7cff]/10 rounded-lg">
                        <RefreshCw className="w-4 h-4" />
                      </button>
                      <button className="p-2 text-[#707090] hover:text-white hover:bg-[#4f7cff]/10 rounded-lg">
                        <Settings className="w-4 h-4" />
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        )}

        {/* Available Platforms */}
        <div>
          <h2 className="text-lg font-semibold text-white mb-4">Available Integrations</h2>
          <div className="grid md:grid-cols-2 gap-4">
            {platforms.map((platform, i) => {
              const isConnected = integrations.some(int => int.platform === platform.id);
              return (
                <motion.div
                  key={platform.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className={`p-5 bg-[#0f0f18] border rounded-xl transition-all ${
                    isConnected 
                      ? "border-[#39ff8e]/30 opacity-60" 
                      : "border-[#4f7cff]/10 hover:border-[#4f7cff]/30 cursor-pointer"
                  }`}
                  onClick={() => {
                    if (!isConnected) {
                      // Navigate to dedicated import pages for HF and GitHub
                      if (platform.id === "huggingface") {
                        navigate("/dev/import-huggingface");
                      } else if (platform.id === "github") {
                        navigate("/dev/import-github");
                      } else {
                        setSelectedPlatform(platform);
                        setShowConnectModal(true);
                      }
                    }
                  }}
                >
                  <div className="flex items-start gap-4">
                    <div
                      className="w-14 h-14 rounded-xl flex items-center justify-center text-3xl flex-shrink-0"
                      style={{ backgroundColor: `${platform.color}20` }}
                    >
                      {platform.icon}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-white font-semibold">{platform.name}</h3>
                        {isConnected && (
                          <CheckCircle className="w-4 h-4 text-[#39ff8e]" />
                        )}
                      </div>
                      <p className="text-[#707090] text-sm mb-3">{platform.description}</p>
                      <div className="flex flex-wrap gap-2">
                        {platform.features.map((feature) => (
                          <span
                            key={feature}
                            className="text-xs px-2 py-1 bg-[#0a0a12] text-[#909098] rounded"
                          >
                            {feature}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  {!isConnected && (
                    <button
                      className="mt-4 w-full py-2 text-center text-[#4f7cff] border border-[#4f7cff]/20 rounded-lg hover:bg-[#4f7cff]/10 transition-all"
                    >
                      <Plug className="w-4 h-4 inline mr-2" />
                      Connect
                    </button>
                  )}
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* Connect Modal */}
        <AnimatePresence>
          {showConnectModal && selectedPlatform && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
              onClick={() => setShowConnectModal(false)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-lg bg-[#0a0a12] border border-[#4f7cff]/20 rounded-2xl overflow-hidden"
              >
                {/* Header */}
                <div className="p-6 border-b border-[#4f7cff]/10">
                  <div className="flex items-center gap-4">
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
                      style={{ backgroundColor: `${selectedPlatform.color}20` }}
                    >
                      {selectedPlatform.icon}
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-white">Connect {selectedPlatform.name}</h2>
                      <p className="text-[#707090] text-sm">Import your agents to Nooterra</p>
                    </div>
                    <button
                      onClick={() => setShowConnectModal(false)}
                      className="ml-auto text-[#707090] hover:text-white"
                    >
                      <X className="w-6 h-6" />
                    </button>
                  </div>
                </div>

                {/* Config Form */}
                <div className="p-6 space-y-4">
                  {/* n8n Config */}
                  {selectedPlatform.id === "n8n" && (
                    <>
                      <div>
                        <label className="block text-sm text-[#707090] mb-2">n8n Webhook URL</label>
                        <input
                          type="url"
                          value={n8nConfig.webhookUrl}
                          onChange={(e) => setN8nConfig({ ...n8nConfig, webhookUrl: e.target.value })}
                          placeholder="https://your-n8n.com/webhook/xxx"
                          className="w-full bg-[#0f0f18] border border-[#4f7cff]/20 rounded-lg px-4 py-3 text-white placeholder-[#505060]"
                        />
                        <p className="text-[#505060] text-xs mt-1">
                          Create a webhook trigger in n8n and paste the URL here
                        </p>
                      </div>
                      <div>
                        <label className="block text-sm text-[#707090] mb-2">API Key (optional)</label>
                        <input
                          type="password"
                          value={n8nConfig.apiKey}
                          onChange={(e) => setN8nConfig({ ...n8nConfig, apiKey: e.target.value })}
                          placeholder="For authenticated calls"
                          className="w-full bg-[#0f0f18] border border-[#4f7cff]/20 rounded-lg px-4 py-3 text-white placeholder-[#505060]"
                        />
                      </div>
                    </>
                  )}

                  {/* Hugging Face Config */}
                  {selectedPlatform.id === "huggingface" && (
                    <>
                      <div>
                        <label className="block text-sm text-[#707090] mb-2">Hugging Face Token</label>
                        <input
                          type="password"
                          value={hfConfig.token}
                          onChange={(e) => setHfConfig({ ...hfConfig, token: e.target.value })}
                          placeholder="hf_xxx..."
                          className="w-full bg-[#0f0f18] border border-[#4f7cff]/20 rounded-lg px-4 py-3 text-white placeholder-[#505060]"
                        />
                        <p className="text-[#505060] text-xs mt-1">
                          Get your token from huggingface.co/settings/tokens
                        </p>
                      </div>
                      <div>
                        <label className="block text-sm text-[#707090] mb-2">Model ID or Endpoint URL</label>
                        <input
                          type="text"
                          value={hfConfig.modelId}
                          onChange={(e) => setHfConfig({ ...hfConfig, modelId: e.target.value })}
                          placeholder="meta-llama/Llama-2-7b-chat-hf or https://xxx.endpoints.huggingface.cloud"
                          className="w-full bg-[#0f0f18] border border-[#4f7cff]/20 rounded-lg px-4 py-3 text-white placeholder-[#505060]"
                        />
                      </div>
                    </>
                  )}

                  {/* LangChain Config */}
                  {selectedPlatform.id === "langchain" && (
                    <>
                      <div>
                        <label className="block text-sm text-[#707090] mb-2">LangServe Endpoint</label>
                        <input
                          type="url"
                          value={langchainConfig.endpoint}
                          onChange={(e) => setLangchainConfig({ ...langchainConfig, endpoint: e.target.value })}
                          placeholder="https://your-langserve.com/chain"
                          className="w-full bg-[#0f0f18] border border-[#4f7cff]/20 rounded-lg px-4 py-3 text-white placeholder-[#505060]"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-[#707090] mb-2">API Key (optional)</label>
                        <input
                          type="password"
                          value={langchainConfig.apiKey}
                          onChange={(e) => setLangchainConfig({ ...langchainConfig, apiKey: e.target.value })}
                          placeholder="For authenticated calls"
                          className="w-full bg-[#0f0f18] border border-[#4f7cff]/20 rounded-lg px-4 py-3 text-white placeholder-[#505060]"
                        />
                      </div>
                    </>
                  )}

                  {/* CrewAI Config */}
                  {selectedPlatform.id === "crewai" && (
                    <div className="text-center py-8">
                      <Code className="w-12 h-12 text-[#4f7cff]/30 mx-auto mb-4" />
                      <p className="text-[#707090] mb-4">
                        To connect CrewAI agents, use the Nooterra CLI:
                      </p>
                      <code className="block bg-[#0f0f18] px-4 py-3 rounded-lg text-[#00d4ff] text-sm">
                        npx nooterra import crewai ./your-crew.py
                      </code>
                    </div>
                  )}

                  {/* AutoGPT Config */}
                  {selectedPlatform.id === "autogpt" && (
                    <div className="text-center py-8">
                      <Bot className="w-12 h-12 text-[#4f7cff]/30 mx-auto mb-4" />
                      <p className="text-[#707090] mb-4">
                        Connect your AutoGPT instance:
                      </p>
                      <code className="block bg-[#0f0f18] px-4 py-3 rounded-lg text-[#00d4ff] text-sm">
                        npx nooterra import autogpt --url https://your-autogpt.com
                      </code>
                    </div>
                  )}

                  {/* Custom Webhook Config */}
                  {selectedPlatform.id === "webhook" && (
                    <>
                      <div>
                        <label className="block text-sm text-[#707090] mb-2">Agent Name</label>
                        <input
                          type="text"
                          value={webhookConfig.name}
                          onChange={(e) => setWebhookConfig({ ...webhookConfig, name: e.target.value })}
                          placeholder="My Custom Agent"
                          className="w-full bg-[#0f0f18] border border-[#4f7cff]/20 rounded-lg px-4 py-3 text-white placeholder-[#505060]"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-[#707090] mb-2">Capability ID</label>
                        <input
                          type="text"
                          value={webhookConfig.capabilityId}
                          onChange={(e) => setWebhookConfig({ ...webhookConfig, capabilityId: e.target.value })}
                          placeholder="cap.my.feature.v1"
                          className="w-full bg-[#0f0f18] border border-[#4f7cff]/20 rounded-lg px-4 py-3 text-white placeholder-[#505060]"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-[#707090] mb-2">Webhook URL</label>
                        <input
                          type="url"
                          value={webhookConfig.url}
                          onChange={(e) => setWebhookConfig({ ...webhookConfig, url: e.target.value })}
                          placeholder="https://your-api.com/webhook"
                          className="w-full bg-[#0f0f18] border border-[#4f7cff]/20 rounded-lg px-4 py-3 text-white placeholder-[#505060]"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-[#707090] mb-2">Secret (for verification)</label>
                        <input
                          type="password"
                          value={webhookConfig.secret}
                          onChange={(e) => setWebhookConfig({ ...webhookConfig, secret: e.target.value })}
                          placeholder="Optional shared secret"
                          className="w-full bg-[#0f0f18] border border-[#4f7cff]/20 rounded-lg px-4 py-3 text-white placeholder-[#505060]"
                        />
                      </div>
                    </>
                  )}

                  {/* Actions */}
                  {!["crewai", "autogpt"].includes(selectedPlatform.id) && (
                    <div className="flex gap-3 pt-4">
                      <button
                        onClick={() => setShowConnectModal(false)}
                        className="flex-1 btn-ghost py-3"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleConnect}
                        disabled={connecting}
                        className="flex-1 btn-neural py-3 justify-center"
                      >
                        {connecting ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" /> Connecting...
                          </>
                        ) : (
                          <>
                            <Plug className="w-4 h-4" /> Connect
                          </>
                        )}
                      </button>
                    </div>
                  )}

                  {/* Docs Link */}
                  <a
                    href={selectedPlatform.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 text-sm text-[#707090] hover:text-[#4f7cff] mt-4"
                  >
                    <ExternalLink className="w-4 h-4" />
                    View {selectedPlatform.name} Documentation
                  </a>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* How It Works */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="mt-8 p-6 bg-[#0f0f18] border border-[#4f7cff]/10 rounded-xl"
        >
          <h3 className="text-white font-semibold mb-4">How Integrations Work</h3>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-[#4f7cff]/10 flex items-center justify-center text-[#4f7cff] flex-shrink-0">
                1
              </div>
              <div>
                <div className="text-white font-medium">Connect Your Platform</div>
                <div className="text-[#707090] text-sm">
                  Provide credentials or webhook URLs from your existing platform
                </div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-[#4f7cff]/10 flex items-center justify-center text-[#4f7cff] flex-shrink-0">
                2
              </div>
              <div>
                <div className="text-white font-medium">Agents Are Imported</div>
                <div className="text-[#707090] text-sm">
                  Your workflows/models become discoverable Nooterra agents
                </div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-[#4f7cff]/10 flex items-center justify-center text-[#4f7cff] flex-shrink-0">
                3
              </div>
              <div>
                <div className="text-white font-medium">Earn When Used</div>
                <div className="text-[#707090] text-sm">
                  Get paid in USDC every time your agents are called
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

