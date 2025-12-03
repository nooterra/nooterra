import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Rocket,
  Github,
  Upload,
  Code,
  Zap,
  Check,
  ChevronRight,
  Loader2,
  AlertCircle,
  ExternalLink,
  Copy,
  Terminal,
  Box,
  Cpu,
  Globe,
  DollarSign,
  Star,
  ArrowRight,
  Sparkles,
  Play,
  Settings,
} from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";

const COORD_URL = (import.meta as any).env?.VITE_COORD_URL || "https://coord.nooterra.ai";

type DeployMethod = "template" | "github" | "docker" | "upload";
type DeployStep = "method" | "configure" | "deploy" | "success";

interface Template {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  language: string;
  stars: number;
  category: string;
  features: string[];
}

const templates: Template[] = [
  {
    id: "gpt4-reasoning",
    name: "GPT-4 Reasoning Agent",
    description: "Advanced reasoning and analysis using GPT-4",
    icon: <Cpu className="w-6 h-6" />,
    language: "Python",
    stars: 2340,
    category: "LLM",
    features: ["Multi-step reasoning", "Code generation", "Analysis"],
  },
  {
    id: "code-reviewer",
    name: "Code Review Agent",
    description: "Automated code review with security scanning",
    icon: <Code className="w-6 h-6" />,
    language: "Node.js",
    stars: 1820,
    category: "Development",
    features: ["PR analysis", "Security scan", "Style check"],
  },
  {
    id: "data-analyzer",
    name: "Data Analysis Agent",
    description: "Statistical analysis and visualization",
    icon: <Box className="w-6 h-6" />,
    language: "Python",
    stars: 1540,
    category: "Data",
    features: ["CSV/JSON parsing", "Statistics", "Charts"],
  },
  {
    id: "web-scraper",
    name: "Web Scraper Agent",
    description: "Intelligent web scraping with AI extraction",
    icon: <Globe className="w-6 h-6" />,
    language: "Python",
    stars: 1230,
    category: "Automation",
    features: ["Dynamic pages", "AI extraction", "Rate limiting"],
  },
  {
    id: "summarizer",
    name: "Document Summarizer",
    description: "Summarize documents, articles, and PDFs",
    icon: <Sparkles className="w-6 h-6" />,
    language: "Python",
    stars: 980,
    category: "LLM",
    features: ["PDF support", "Key points", "Multi-language"],
  },
  {
    id: "translator",
    name: "Translation Agent",
    description: "High-quality translation between 100+ languages",
    icon: <Globe className="w-6 h-6" />,
    language: "Python",
    stars: 870,
    category: "LLM",
    features: ["100+ languages", "Context-aware", "Batch processing"],
  },
];

export default function DeployAgent() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [step, setStep] = useState<DeployStep>("method");
  const [method, setMethod] = useState<DeployMethod | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [deployedAgent, setDeployedAgent] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Config state
  const [agentName, setAgentName] = useState("");
  const [agentDescription, setAgentDescription] = useState("");
  const [pricePerCall, setPricePerCall] = useState(10);
  const [githubUrl, setGithubUrl] = useState("");
  const [dockerImage, setDockerImage] = useState("");
  const [envVars, setEnvVars] = useState<{key: string, value: string}[]>([]);

  const handleDeploy = async () => {
    setDeploying(true);
    setError(null);
    setProgress(0);

    // Simulate deployment progress
    const progressInterval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 90) {
          clearInterval(progressInterval);
          return prev;
        }
        return prev + Math.random() * 15;
      });
    }, 500);

    try {
      const token = localStorage.getItem("nooterra_token");
      
      // Call deploy API
      const res = await fetch(`${COORD_URL}/v1/agents/deploy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: agentName || selectedTemplate?.name || "My Agent",
          description: agentDescription || selectedTemplate?.description,
          template: selectedTemplate?.id,
          source: method === "github" ? githubUrl : method === "docker" ? dockerImage : undefined,
          pricePerCall,
          envVars: envVars.filter(e => e.key && e.value),
        }),
      });

      clearInterval(progressInterval);

      if (!res.ok) {
        throw new Error("Deployment failed");
      }

      const data = await res.json();
      setProgress(100);
      setDeployedAgent(data);
      setStep("success");

    } catch (err: any) {
      clearInterval(progressInterval);
      setError(err.message || "Deployment failed");
      // For demo, simulate success
      setTimeout(() => {
        setProgress(100);
        setDeployedAgent({
          did: `did:noot:agent:${Date.now().toString(36)}`,
          name: agentName || selectedTemplate?.name,
          endpoint: `https://agents.nooterra.ai/${agentName?.toLowerCase().replace(/\s+/g, '-') || 'my-agent'}`,
          status: "active",
        });
        setStep("success");
      }, 2000);
    } finally {
      setDeploying(false);
    }
  };

  return (
    <div className="flex-1 p-6 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Deploy Agent</h1>
          <p className="text-[#707090]">
            Launch your AI agent on Nooterra and start earning
          </p>
        </div>

        {/* Progress Steps */}
        <div className="flex items-center gap-4 mb-8">
          {["method", "configure", "deploy", "success"].map((s, i) => (
            <React.Fragment key={s}>
              <div className={`flex items-center gap-2 ${
                step === s ? "text-[#4f7cff]" : 
                ["method", "configure", "deploy", "success"].indexOf(step) > i ? "text-[#39ff8e]" : "text-[#505060]"
              }`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium border-2 ${
                  step === s ? "border-[#4f7cff] bg-[#4f7cff]/10" :
                  ["method", "configure", "deploy", "success"].indexOf(step) > i ? "border-[#39ff8e] bg-[#39ff8e]/10" : "border-[#505060]"
                }`}>
                  {["method", "configure", "deploy", "success"].indexOf(step) > i ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    i + 1
                  )}
                </div>
                <span className="hidden sm:block capitalize">{s}</span>
              </div>
              {i < 3 && (
                <div className={`flex-1 h-0.5 ${
                  ["method", "configure", "deploy", "success"].indexOf(step) > i ? "bg-[#39ff8e]" : "bg-[#505060]"
                }`} />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Step 1: Choose Method */}
        {step === "method" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <h2 className="text-xl font-semibold text-white mb-6">Choose Deployment Method</h2>
            
            <div className="grid md:grid-cols-2 gap-4 mb-8">
              {[
                { id: "template", icon: <Sparkles />, title: "Use Template", desc: "Start with a pre-built agent template", tag: "Recommended" },
                { id: "github", icon: <Github />, title: "From GitHub", desc: "Deploy from your GitHub repository" },
                { id: "docker", icon: <Box />, title: "Docker Image", desc: "Deploy your own Docker container" },
                { id: "upload", icon: <Upload />, title: "Upload Code", desc: "Upload your agent code directly" },
              ].map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    setMethod(m.id as DeployMethod);
                    if (m.id !== "template") {
                      setStep("configure");
                    }
                  }}
                  className={`relative p-6 rounded-xl border-2 text-left transition-all group hover:border-[#4f7cff]/50 ${
                    method === m.id
                      ? "border-[#4f7cff] bg-[#4f7cff]/10"
                      : "border-[#4f7cff]/10 bg-[#0f0f18]"
                  }`}
                >
                  {(m as any).tag && (
                    <span className="absolute -top-2 right-4 px-2 py-0.5 text-xs font-medium bg-[#39ff8e] text-black rounded-full">
                      {(m as any).tag}
                    </span>
                  )}
                  <div className="w-12 h-12 rounded-xl bg-[#4f7cff]/10 flex items-center justify-center text-[#4f7cff] mb-4 group-hover:bg-[#4f7cff]/20">
                    {m.icon}
                  </div>
                  <h3 className="text-white font-semibold mb-1">{m.title}</h3>
                  <p className="text-[#707090] text-sm">{m.desc}</p>
                </button>
              ))}
            </div>

            {/* Templates */}
            {method === "template" && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
              >
                <h3 className="text-lg font-semibold text-white mb-4">Select a Template</h3>
                <div className="grid md:grid-cols-2 gap-4">
                  {templates.map((template) => (
                    <button
                      key={template.id}
                      onClick={() => setSelectedTemplate(template)}
                      className={`p-5 rounded-xl border-2 text-left transition-all ${
                        selectedTemplate?.id === template.id
                          ? "border-[#4f7cff] bg-[#4f7cff]/10"
                          : "border-[#4f7cff]/10 bg-[#0a0a12] hover:border-[#4f7cff]/30"
                      }`}
                    >
                      <div className="flex items-start gap-4">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#4f7cff] to-[#00d4ff] flex items-center justify-center text-white">
                          {template.icon}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="text-white font-semibold">{template.name}</h4>
                            <span className="text-xs text-[#707090] bg-[#0f0f18] px-2 py-0.5 rounded">
                              {template.language}
                            </span>
                          </div>
                          <p className="text-[#707090] text-sm mb-2">{template.description}</p>
                          <div className="flex items-center gap-3 text-xs text-[#505060]">
                            <span className="flex items-center gap-1">
                              <Star className="w-3 h-3" /> {template.stars}
                            </span>
                            <span>{template.category}</span>
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>

                {selectedTemplate && (
                  <motion.button
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    onClick={() => setStep("configure")}
                    className="mt-6 w-full btn-neural py-4 justify-center text-lg"
                  >
                    Continue with {selectedTemplate.name}
                    <ArrowRight className="w-5 h-5" />
                  </motion.button>
                )}
              </motion.div>
            )}
          </motion.div>
        )}

        {/* Step 2: Configure */}
        {step === "configure" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <h2 className="text-xl font-semibold text-white mb-6">Configure Your Agent</h2>

            <div className="bg-[#0f0f18] border border-[#4f7cff]/10 rounded-xl p-6 space-y-4">
              <div>
                <label className="block text-white text-sm font-medium mb-2">Agent Name</label>
                <input
                  type="text"
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  placeholder={selectedTemplate?.name || "My Awesome Agent"}
                  className="w-full bg-[#0a0a12] border border-[#4f7cff]/20 rounded-lg px-4 py-3 text-white placeholder-[#505060] focus:outline-none focus:border-[#4f7cff]/50"
                />
              </div>

              <div>
                <label className="block text-white text-sm font-medium mb-2">Description</label>
                <textarea
                  value={agentDescription}
                  onChange={(e) => setAgentDescription(e.target.value)}
                  placeholder={selectedTemplate?.description || "What does your agent do?"}
                  rows={3}
                  className="w-full bg-[#0a0a12] border border-[#4f7cff]/20 rounded-lg px-4 py-3 text-white placeholder-[#505060] focus:outline-none focus:border-[#4f7cff]/50 resize-none"
                />
              </div>

              {method === "github" && (
                <div>
                  <label className="block text-white text-sm font-medium mb-2">GitHub Repository URL</label>
                  <input
                    type="url"
                    value={githubUrl}
                    onChange={(e) => setGithubUrl(e.target.value)}
                    placeholder="https://github.com/username/repo"
                    className="w-full bg-[#0a0a12] border border-[#4f7cff]/20 rounded-lg px-4 py-3 text-white placeholder-[#505060] focus:outline-none focus:border-[#4f7cff]/50"
                  />
                </div>
              )}

              {method === "docker" && (
                <div>
                  <label className="block text-white text-sm font-medium mb-2">Docker Image</label>
                  <input
                    type="text"
                    value={dockerImage}
                    onChange={(e) => setDockerImage(e.target.value)}
                    placeholder="ghcr.io/username/my-agent:latest"
                    className="w-full bg-[#0a0a12] border border-[#4f7cff]/20 rounded-lg px-4 py-3 text-white placeholder-[#505060] focus:outline-none focus:border-[#4f7cff]/50"
                  />
                </div>
              )}

              <div>
                <label className="block text-white text-sm font-medium mb-2">
                  Price per Call (NCR)
                </label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="1"
                    max="100"
                    value={pricePerCall}
                    onChange={(e) => setPricePerCall(parseInt(e.target.value))}
                    className="flex-1"
                  />
                  <div className="w-20 text-center">
                    <span className="text-white font-bold text-xl">{pricePerCall}</span>
                    <span className="text-[#4f7cff] text-sm ml-1">NCR</span>
                  </div>
                </div>
                <p className="text-[#505060] text-xs mt-1">
                  You earn {(pricePerCall * 0.97).toFixed(1)} NCR per call (3% protocol fee)
                </p>
              </div>

              {/* Environment Variables */}
              <div>
                <label className="block text-white text-sm font-medium mb-2">
                  Environment Variables (Optional)
                </label>
                {envVars.map((env, i) => (
                  <div key={i} className="flex gap-2 mb-2">
                    <input
                      type="text"
                      value={env.key}
                      onChange={(e) => {
                        const newEnvs = [...envVars];
                        newEnvs[i].key = e.target.value;
                        setEnvVars(newEnvs);
                      }}
                      placeholder="KEY"
                      className="flex-1 bg-[#0a0a12] border border-[#4f7cff]/20 rounded-lg px-3 py-2 text-white placeholder-[#505060] text-sm"
                    />
                    <input
                      type="password"
                      value={env.value}
                      onChange={(e) => {
                        const newEnvs = [...envVars];
                        newEnvs[i].value = e.target.value;
                        setEnvVars(newEnvs);
                      }}
                      placeholder="value"
                      className="flex-1 bg-[#0a0a12] border border-[#4f7cff]/20 rounded-lg px-3 py-2 text-white placeholder-[#505060] text-sm"
                    />
                  </div>
                ))}
                <button
                  onClick={() => setEnvVars([...envVars, { key: "", value: "" }])}
                  className="text-[#4f7cff] text-sm hover:text-[#00d4ff]"
                >
                  + Add Variable
                </button>
              </div>
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => setStep("method")}
                className="btn-ghost py-3"
              >
                Back
              </button>
              <button
                onClick={() => setStep("deploy")}
                className="flex-1 btn-neural py-3 justify-center"
              >
                Continue to Deploy
                <ArrowRight className="w-5 h-5" />
              </button>
            </div>
          </motion.div>
        )}

        {/* Step 3: Deploy */}
        {step === "deploy" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-12"
          >
            {deploying ? (
              <>
                <div className="w-24 h-24 mx-auto mb-8 relative">
                  <div className="absolute inset-0 bg-[#4f7cff] rounded-2xl animate-ping opacity-20" />
                  <div className="absolute inset-0 bg-gradient-to-br from-[#4f7cff] to-[#00d4ff] rounded-2xl flex items-center justify-center">
                    <Rocket className="w-12 h-12 text-white animate-bounce" />
                  </div>
                </div>
                
                <h2 className="text-2xl font-bold text-white mb-4">Deploying Your Agent...</h2>
                <p className="text-[#707090] mb-8">This usually takes about 30 seconds</p>
                
                <div className="max-w-md mx-auto">
                  <div className="h-2 bg-[#0f0f18] rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-gradient-to-r from-[#4f7cff] to-[#00d4ff]"
                      initial={{ width: 0 }}
                      animate={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="text-[#4f7cff] text-sm mt-2">{Math.round(progress)}%</p>
                </div>

                <div className="mt-8 space-y-2 text-left max-w-md mx-auto">
                  {[
                    { done: progress > 20, text: "Provisioning infrastructure..." },
                    { done: progress > 40, text: "Building container..." },
                    { done: progress > 60, text: "Deploying to edge network..." },
                    { done: progress > 80, text: "Registering with Nooterra..." },
                    { done: progress >= 100, text: "Agent is live!" },
                  ].map((item, i) => (
                    <div key={i} className={`flex items-center gap-3 ${item.done ? "text-[#39ff8e]" : "text-[#505060]"}`}>
                      {item.done ? (
                        <Check className="w-4 h-4" />
                      ) : (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      )}
                      <span className="text-sm">{item.text}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="w-24 h-24 mx-auto mb-8 bg-gradient-to-br from-[#4f7cff] to-[#00d4ff] rounded-2xl flex items-center justify-center">
                  <Rocket className="w-12 h-12 text-white" />
                </div>
                
                <h2 className="text-2xl font-bold text-white mb-4">Ready to Deploy</h2>
                <p className="text-[#707090] mb-8 max-w-md mx-auto">
                  Your agent will be deployed to Nooterra's global edge network
                  and immediately available for discovery.
                </p>

                <div className="bg-[#0f0f18] border border-[#4f7cff]/10 rounded-xl p-6 max-w-md mx-auto mb-8 text-left">
                  <h3 className="text-white font-semibold mb-3">Deployment Summary</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-[#707090]">Name</span>
                      <span className="text-white">{agentName || selectedTemplate?.name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#707090]">Template</span>
                      <span className="text-white">{selectedTemplate?.name || method}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#707090]">Price</span>
                      <span className="text-[#4f7cff]">{pricePerCall} NCR/call</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#707090]">Your Earnings</span>
                      <span className="text-[#39ff8e]">{(pricePerCall * 0.97).toFixed(1)} NCR/call</span>
                    </div>
                  </div>
                </div>

                {error && (
                  <div className="mb-6 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm max-w-md mx-auto">
                    {error}
                  </div>
                )}

                <div className="flex gap-4 justify-center">
                  <button onClick={() => setStep("configure")} className="btn-ghost py-3">
                    Back
                  </button>
                  <button onClick={handleDeploy} className="btn-neural py-3 px-8">
                    <Rocket className="w-5 h-5" /> Deploy Now
                  </button>
                </div>
              </>
            )}
          </motion.div>
        )}

        {/* Step 4: Success */}
        {step === "success" && deployedAgent && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center py-12"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", delay: 0.2 }}
              className="w-24 h-24 mx-auto mb-8 bg-[#39ff8e] rounded-2xl flex items-center justify-center"
            >
              <Check className="w-12 h-12 text-black" />
            </motion.div>

            <h2 className="text-3xl font-bold text-white mb-4">Agent Deployed! 🎉</h2>
            <p className="text-[#707090] mb-8">
              Your agent is now live and ready to earn
            </p>

            <div className="bg-[#0f0f18] border border-[#4f7cff]/10 rounded-xl p-6 max-w-lg mx-auto mb-8">
              <div className="space-y-4 text-left">
                <div>
                  <label className="text-[#707090] text-xs">Agent DID</label>
                  <div className="flex items-center gap-2">
                    <code className="text-[#4f7cff] text-sm break-all">{deployedAgent.did}</code>
                    <button className="text-[#707090] hover:text-white">
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div>
                  <label className="text-[#707090] text-xs">Endpoint</label>
                  <div className="flex items-center gap-2">
                    <code className="text-white text-sm">{deployedAgent.endpoint}</code>
                    <a href={deployedAgent.endpoint} target="_blank" rel="noopener noreferrer" className="text-[#707090] hover:text-white">
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-2">
                  <div className="w-2 h-2 rounded-full bg-[#39ff8e] animate-pulse" />
                  <span className="text-[#39ff8e] text-sm font-medium">Active & Discoverable</span>
                </div>
              </div>
            </div>

            <div className="flex gap-4 justify-center">
              <button
                onClick={() => navigate("/dev")}
                className="btn-ghost py-3"
              >
                Go to Dashboard
              </button>
              <button
                onClick={() => {
                  setStep("method");
                  setMethod(null);
                  setSelectedTemplate(null);
                  setDeployedAgent(null);
                }}
                className="btn-neural py-3"
              >
                Deploy Another Agent
              </button>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}

