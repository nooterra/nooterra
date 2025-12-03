import React from "react";
import { motion } from "framer-motion";
import { Search, Check, ExternalLink, Loader2, Bot, Plus } from "lucide-react";
import { useHuggingFace } from "../../hooks/useHuggingFace";

export default function HuggingFaceConnect() {
  const { loading, error, connected, connect, disconnect, searchModels, getUserModels, deployAsAgent } = useHuggingFace();
  const [token, setToken] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [models, setModels] = React.useState<any[]>([]);
  const [userModels, setUserModels] = React.useState<any[]>([]);
  const [selectedModel, setSelectedModel] = React.useState<string | null>(null);
  const [deploying, setDeploying] = React.useState(false);

  React.useEffect(() => {
    if (connected) {
      getUserModels().then(setUserModels);
    }
  }, [connected]);

  const handleConnect = async () => {
    const success = await connect(token);
    if (success) {
      setToken("");
      getUserModels().then(setUserModels);
    }
  };

  const handleSearch = async () => {
    if (!search.trim()) return;
    const results = await searchModels(search);
    setModels(results);
  };

  const handleDeploy = async (modelId: string) => {
    setDeploying(true);
    const did = await deployAsAgent(modelId, {
      name: modelId.split("/").pop() || "hf-model",
      description: `Hugging Face model: ${modelId}`,
      pricePerCall: 10,
      capabilities: ["inference"],
    });
    setDeploying(false);
    
    if (did) {
      alert(`Agent deployed! DID: ${did}`);
    }
  };

  return (
    <div className="flex-1 p-6 lg:p-8 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Hugging Face Integration</h1>
          <p className="text-[#707090] mt-1">Connect your HF models to the Nooterra network</p>
        </div>

        {!connected ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-[#0a0a12] border border-[#4f7cff]/10 rounded-2xl p-8 text-center"
          >
            <div className="w-20 h-20 mx-auto mb-6 bg-yellow-500/10 rounded-2xl flex items-center justify-center text-4xl">
              🤗
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">Connect Hugging Face</h2>
            <p className="text-[#707090] mb-6 max-w-md mx-auto">
              Link your Hugging Face account to deploy your models as Nooterra agents
            </p>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 mb-4 text-red-400 text-sm">
                {error}
              </div>
            )}

            <div className="max-w-md mx-auto">
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Enter your HF Access Token"
                className="w-full bg-[#0f0f18] border border-[#4f7cff]/20 rounded-lg px-4 py-3 text-white placeholder-[#505060] focus:border-[#4f7cff]/50 focus:outline-none mb-4"
              />
              <button
                onClick={handleConnect}
                disabled={loading || !token}
                className="btn-neural w-full justify-center disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Connect"} 
              </button>
              <a
                href="https://huggingface.co/settings/tokens"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-[#4f7cff] hover:text-[#00d4ff] mt-4"
              >
                Get your access token <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </motion.div>
        ) : (
          <div className="space-y-6">
            {/* Connected status */}
            <div className="flex items-center justify-between p-4 bg-[#39ff8e]/10 border border-[#39ff8e]/20 rounded-xl">
              <div className="flex items-center gap-3">
                <Check className="w-5 h-5 text-[#39ff8e]" />
                <span className="text-white">Hugging Face connected</span>
              </div>
              <button
                onClick={disconnect}
                className="text-sm text-[#707090] hover:text-white"
              >
                Disconnect
              </button>
            </div>

            {/* Search models */}
            <div className="bg-[#0a0a12] border border-[#4f7cff]/10 rounded-xl p-5">
              <h2 className="text-lg font-semibold text-white mb-4">Search Models</h2>
              <div className="flex gap-3 mb-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#505060]" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    placeholder="Search for models..."
                    className="w-full bg-[#0f0f18] border border-[#4f7cff]/20 rounded-lg pl-10 pr-4 py-2.5 text-white placeholder-[#505060] focus:border-[#4f7cff]/40 focus:outline-none"
                  />
                </div>
                <button onClick={handleSearch} className="btn-neural" disabled={loading}>
                  Search
                </button>
              </div>

              {models.length > 0 && (
                <div className="space-y-2">
                  {models.map((model) => (
                    <div
                      key={model.id}
                      className="flex items-center justify-between p-3 bg-[#0f0f18] rounded-lg"
                    >
                      <div>
                        <div className="text-white font-medium">{model.id}</div>
                        <div className="text-xs text-[#505060]">
                          {model.pipeline} • {model.downloads.toLocaleString()} downloads
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeploy(model.id)}
                        disabled={deploying}
                        className="px-3 py-1.5 bg-[#4f7cff]/10 text-[#4f7cff] text-sm rounded-lg hover:bg-[#4f7cff]/20"
                      >
                        <Bot className="w-4 h-4 inline mr-1" /> Deploy
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* User's models */}
            {userModels.length > 0 && (
              <div className="bg-[#0a0a12] border border-[#4f7cff]/10 rounded-xl p-5">
                <h2 className="text-lg font-semibold text-white mb-4">Your Models</h2>
                <div className="space-y-2">
                  {userModels.map((model) => (
                    <div
                      key={model.id}
                      className="flex items-center justify-between p-3 bg-[#0f0f18] rounded-lg"
                    >
                      <div>
                        <div className="text-white font-medium">{model.name}</div>
                        <div className="text-xs text-[#505060]">
                          {model.pipeline} • {model.downloads.toLocaleString()} downloads
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeploy(model.id)}
                        disabled={deploying}
                        className="px-3 py-1.5 bg-[#a855f7]/10 text-[#a855f7] text-sm rounded-lg hover:bg-[#a855f7]/20"
                      >
                        <Plus className="w-4 h-4 inline mr-1" /> Deploy as Agent
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

