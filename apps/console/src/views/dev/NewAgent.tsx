import React from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Bot, Code, Server, Check, Loader2, ExternalLink } from "lucide-react";

type Step = "template" | "config" | "deploy";

const templates = [
  {
    id: "custom",
    name: "Custom Agent",
    desc: "Build from scratch with full control",
    icon: <Code className="w-6 h-6" />,
  },
  {
    id: "huggingface",
    name: "Hugging Face Model",
    desc: "Wrap any HF model as a Nooterra agent",
    icon: "🤗",
  },
  {
    id: "langchain",
    name: "LangChain Agent",
    desc: "Deploy existing LangChain/LangGraph agents",
    icon: "🦜",
  },
  {
    id: "crewai",
    name: "CrewAI Agent",
    desc: "Deploy CrewAI agents to the network",
    icon: "👥",
  },
  {
    id: "openai",
    name: "OpenAI Assistant",
    desc: "Wrap OpenAI Assistants API",
    icon: "⚡",
  },
  {
    id: "http",
    name: "HTTP API",
    desc: "Wrap any existing HTTP endpoint",
    icon: <Server className="w-6 h-6" />,
  },
];

export default function NewAgent() {
  const navigate = useNavigate();
  const [step, setStep] = React.useState<Step>("template");
  const [template, setTemplate] = React.useState<string | null>(null);
  const [config, setConfig] = React.useState({
    name: "",
    description: "",
    endpoint: "",
    capabilities: "",
    pricePerCall: "10",
    hfModel: "",
    hfToken: "",
  });
  const [deploying, setDeploying] = React.useState(false);
  const [deployed, setDeployed] = React.useState(false);

  const handleDeploy = async () => {
    setDeploying(true);
    // Simulate deployment
    await new Promise((r) => setTimeout(r, 3000));
    setDeploying(false);
    setDeployed(true);
  };

  const renderStep = () => {
    switch (step) {
      case "template":
        return (
          <div>
            <h2 className="text-xl font-semibold text-white mb-2">Choose a template</h2>
            <p className="text-[#707090] mb-6">Select how you want to create your agent</p>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {templates.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTemplate(t.id)}
                  className={`p-5 rounded-xl border text-left transition-all ${
                    template === t.id
                      ? "bg-[#a855f7]/10 border-[#a855f7]/50"
                      : "bg-[#0a0a12] border-[#4f7cff]/10 hover:border-[#a855f7]/30"
                  }`}
                >
                  {template === t.id && (
                    <div className="float-right w-5 h-5 bg-[#a855f7] rounded-full flex items-center justify-center">
                      <Check className="w-3 h-3 text-white" />
                    </div>
                  )}
                  <div
                    className={`w-12 h-12 rounded-lg flex items-center justify-center mb-3 text-2xl ${
                      template === t.id ? "bg-[#a855f7]/20" : "bg-[#4f7cff]/10"
                    }`}
                  >
                    {typeof t.icon === "string" ? t.icon : t.icon}
                  </div>
                  <h3 className="font-semibold text-white mb-1">{t.name}</h3>
                  <p className="text-xs text-[#707090]">{t.desc}</p>
                </button>
              ))}
            </div>
          </div>
        );

      case "config":
        return (
          <div>
            <h2 className="text-xl font-semibold text-white mb-2">Configure your agent</h2>
            <p className="text-[#707090] mb-6">
              {template === "huggingface"
                ? "Enter your Hugging Face model details"
                : "Fill in the agent details"}
            </p>

            <div className="space-y-5 max-w-xl">
              <div>
                <label className="block text-sm text-[#909098] mb-2">Agent Name</label>
                <input
                  type="text"
                  value={config.name}
                  onChange={(e) => setConfig({ ...config, name: e.target.value })}
                  placeholder="my-awesome-agent"
                  className="w-full bg-[#0a0a12] border border-[#4f7cff]/20 rounded-lg px-4 py-3 text-white placeholder-[#505060] focus:border-[#a855f7]/50 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm text-[#909098] mb-2">Description</label>
                <textarea
                  value={config.description}
                  onChange={(e) => setConfig({ ...config, description: e.target.value })}
                  placeholder="Describe what your agent does..."
                  rows={3}
                  className="w-full bg-[#0a0a12] border border-[#4f7cff]/20 rounded-lg px-4 py-3 text-white placeholder-[#505060] focus:border-[#a855f7]/50 focus:outline-none resize-none"
                />
              </div>

              {template === "huggingface" && (
                <>
                  <div>
                    <label className="block text-sm text-[#909098] mb-2">Hugging Face Model</label>
                    <input
                      type="text"
                      value={config.hfModel}
                      onChange={(e) => setConfig({ ...config, hfModel: e.target.value })}
                      placeholder="meta-llama/Llama-2-7b-chat-hf"
                      className="w-full bg-[#0a0a12] border border-[#4f7cff]/20 rounded-lg px-4 py-3 text-white placeholder-[#505060] focus:border-[#a855f7]/50 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-[#909098] mb-2">HF Access Token</label>
                    <input
                      type="password"
                      value={config.hfToken}
                      onChange={(e) => setConfig({ ...config, hfToken: e.target.value })}
                      placeholder="hf_..."
                      className="w-full bg-[#0a0a12] border border-[#4f7cff]/20 rounded-lg px-4 py-3 text-white placeholder-[#505060] focus:border-[#a855f7]/50 focus:outline-none"
                    />
                  </div>
                </>
              )}

              {(template === "http" || template === "custom") && (
                <div>
                  <label className="block text-sm text-[#909098] mb-2">Endpoint URL</label>
                  <input
                    type="url"
                    value={config.endpoint}
                    onChange={(e) => setConfig({ ...config, endpoint: e.target.value })}
                    placeholder="https://your-api.com/agent"
                    className="w-full bg-[#0a0a12] border border-[#4f7cff]/20 rounded-lg px-4 py-3 text-white placeholder-[#505060] focus:border-[#a855f7]/50 focus:outline-none"
                  />
                </div>
              )}

              <div>
                <label className="block text-sm text-[#909098] mb-2">Capabilities (comma-separated)</label>
                <input
                  type="text"
                  value={config.capabilities}
                  onChange={(e) => setConfig({ ...config, capabilities: e.target.value })}
                  placeholder="text-generation, summarization, analysis"
                  className="w-full bg-[#0a0a12] border border-[#4f7cff]/20 rounded-lg px-4 py-3 text-white placeholder-[#505060] focus:border-[#a855f7]/50 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm text-[#909098] mb-2">Price per call (NCR)</label>
                <input
                  type="number"
                  value={config.pricePerCall}
                  onChange={(e) => setConfig({ ...config, pricePerCall: e.target.value })}
                  placeholder="10"
                  className="w-full bg-[#0a0a12] border border-[#4f7cff]/20 rounded-lg px-4 py-3 text-white placeholder-[#505060] focus:border-[#a855f7]/50 focus:outline-none"
                />
                <p className="text-xs text-[#505060] mt-1">1 NCR ≈ $0.01 USD</p>
              </div>
            </div>
          </div>
        );

      case "deploy":
        return (
          <div className="text-center py-8">
            {deployed ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
              >
                <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-[#39ff8e]/20 flex items-center justify-center">
                  <Check className="w-10 h-10 text-[#39ff8e]" />
                </div>
                <h2 className="text-2xl font-bold text-white mb-2">Agent Deployed!</h2>
                <p className="text-[#707090] mb-6">
                  Your agent is now live on the Nooterra network
                </p>
                <div className="bg-[#0a0a12] border border-[#4f7cff]/20 rounded-lg p-4 max-w-md mx-auto mb-6">
                  <div className="text-xs text-[#505060] mb-1">Agent DID</div>
                  <div className="font-mono text-sm text-[#4f7cff]">
                    did:noot:agent-{Math.random().toString(36).slice(2, 10)}
                  </div>
                </div>
                <div className="flex items-center justify-center gap-4">
                  <button onClick={() => navigate("/dev/agents")} className="btn-neural">
                    View My Agents
                  </button>
                  <button
                    onClick={() => {
                      setStep("template");
                      setTemplate(null);
                      setDeployed(false);
                    }}
                    className="btn-ghost"
                  >
                    Deploy Another
                  </button>
                </div>
              </motion.div>
            ) : (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
              >
                <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-[#a855f7]/20 flex items-center justify-center">
                  {deploying ? (
                    <Loader2 className="w-10 h-10 text-[#a855f7] animate-spin" />
                  ) : (
                    <Bot className="w-10 h-10 text-[#a855f7]" />
                  )}
                </div>
                <h2 className="text-2xl font-bold text-white mb-2">
                  {deploying ? "Deploying..." : "Ready to Deploy"}
                </h2>
                <p className="text-[#707090] mb-6 max-w-md mx-auto">
                  {deploying
                    ? "Registering your agent with the network..."
                    : "Review your configuration and deploy your agent to the Nooterra network"}
                </p>

                {!deploying && (
                  <>
                    <div className="bg-[#0a0a12] border border-[#4f7cff]/20 rounded-lg p-5 max-w-md mx-auto mb-6 text-left">
                      <div className="space-y-3 text-sm">
                        <div className="flex justify-between">
                          <span className="text-[#707090]">Name</span>
                          <span className="text-white">{config.name || "—"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#707090]">Template</span>
                          <span className="text-white">{templates.find((t) => t.id === template)?.name}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#707090]">Price</span>
                          <span className="text-white">{config.pricePerCall} NCR/call</span>
                        </div>
                      </div>
                    </div>

                    <button onClick={handleDeploy} className="btn-neural">
                      <Bot className="w-4 h-4" /> Deploy Agent
                    </button>
                  </>
                )}
              </motion.div>
            )}
          </div>
        );
    }
  };

  return (
    <div className="flex-1 p-6 lg:p-8 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        {/* Back button */}
        <button
          onClick={() => navigate("/dev/agents")}
          className="flex items-center gap-2 text-[#707090] hover:text-white mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Agents
        </button>

        {/* Progress */}
        <div className="flex items-center gap-2 mb-8">
          {["template", "config", "deploy"].map((s, i) => (
            <React.Fragment key={s}>
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  step === s
                    ? "bg-[#a855f7] text-white"
                    : ["template", "config", "deploy"].indexOf(step) > i
                    ? "bg-[#a855f7]/30 text-[#a855f7]"
                    : "bg-[#4f7cff]/10 text-[#505060]"
                }`}
              >
                {i + 1}
              </div>
              {i < 2 && (
                <div
                  className={`flex-1 h-0.5 ${
                    ["template", "config", "deploy"].indexOf(step) > i
                      ? "bg-[#a855f7]/50"
                      : "bg-[#4f7cff]/10"
                  }`}
                />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Content */}
        <div className="bg-[#0a0a12] border border-[#4f7cff]/10 rounded-2xl p-6">
          {renderStep()}

          {/* Navigation */}
          {step !== "deploy" && (
            <div className="flex items-center justify-between mt-8 pt-6 border-t border-[#4f7cff]/10">
              <button
                onClick={() => setStep(step === "config" ? "template" : "template")}
                disabled={step === "template"}
                className="text-[#707090] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Back
              </button>
              <button
                onClick={() => setStep(step === "template" ? "config" : "deploy")}
                disabled={step === "template" && !template}
                className="btn-neural disabled:opacity-50"
              >
                {step === "config" ? "Review & Deploy" : "Continue"} <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

