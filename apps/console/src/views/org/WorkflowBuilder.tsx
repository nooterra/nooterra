import React, { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useParams, useNavigate } from "react-router-dom";
import {
  Play,
  Save,
  Plus,
  Trash2,
  Settings,
  Zap,
  Bot,
  Code,
  FileText,
  Database,
  Globe,
  GitBranch,
  Webhook,
  Clock,
  ChevronRight,
  X,
  Search,
  Loader2,
  Check,
  ArrowRight,
  Sparkles,
  Eye,
  Download,
} from "lucide-react";

const COORD_URL = (import.meta as any).env?.VITE_COORD_URL || "https://coord.nooterra.ai";

interface WorkflowNode {
  id: string;
  type: "trigger" | "agent" | "condition" | "output";
  name: string;
  capability?: string;
  config: Record<string, any>;
  position: { x: number; y: number };
  connections: string[]; // IDs of connected nodes
}

interface Workflow {
  id: string;
  name: string;
  description: string;
  nodes: WorkflowNode[];
  status: "draft" | "active" | "paused";
  trigger: "manual" | "webhook" | "schedule";
}

const agentCapabilities = [
  { id: "cap.llm.reasoning.v1", name: "GPT-4 Reasoning", icon: <Sparkles />, category: "LLM" },
  { id: "cap.llm.code.v1", name: "Code Generation", icon: <Code />, category: "LLM" },
  { id: "cap.code.review.v1", name: "Code Review", icon: <Code />, category: "Dev" },
  { id: "cap.data.analyze.v1", name: "Data Analysis", icon: <Database />, category: "Data" },
  { id: "cap.web.scrape.v1", name: "Web Scraper", icon: <Globe />, category: "Automation" },
  { id: "cap.doc.summarize.v1", name: "Summarizer", icon: <FileText />, category: "LLM" },
  { id: "cap.translate.v1", name: "Translator", icon: <Globe />, category: "LLM" },
];

const nodeColors: Record<string, string> = {
  trigger: "#a855f7",
  agent: "#4f7cff",
  condition: "#f59e0b",
  output: "#39ff8e",
};

export default function WorkflowBuilder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLDivElement>(null);
  
  const [workflow, setWorkflow] = useState<Workflow>({
    id: id || "new",
    name: "Untitled Workflow",
    description: "",
    nodes: [
      {
        id: "trigger-1",
        type: "trigger",
        name: "Start",
        config: { trigger: "manual" },
        position: { x: 100, y: 200 },
        connections: [],
      },
    ],
    status: "draft",
    trigger: "manual",
  });
  
  const [selectedNode, setSelectedNode] = useState<WorkflowNode | null>(null);
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [connecting, setConnecting] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Load existing workflow
  useEffect(() => {
    if (id && id !== "new") {
      loadWorkflow(id);
    }
  }, [id]);

  const loadWorkflow = async (workflowId: string) => {
    try {
      const token = localStorage.getItem("nooterra_token");
      const res = await fetch(`${COORD_URL}/v1/saved-workflows/${workflowId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        setWorkflow(data);
      }
    } catch (err) {
      console.error("Failed to load workflow:", err);
    }
  };

  const handleNodeDragStart = (e: React.MouseEvent, nodeId: string) => {
    const node = workflow.nodes.find(n => n.id === nodeId);
    if (!node) return;
    
    setDragging(nodeId);
    setDragOffset({
      x: e.clientX - node.position.x,
      y: e.clientY - node.position.y,
    });
  };

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    
    setWorkflow(prev => ({
      ...prev,
      nodes: prev.nodes.map(node =>
        node.id === dragging
          ? { ...node, position: { x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y } }
          : node
      ),
    }));
  }, [dragging, dragOffset]);

  const handleMouseUp = () => {
    setDragging(null);
    setConnecting(null);
  };

  const addNode = (capability: typeof agentCapabilities[0]) => {
    const newNode: WorkflowNode = {
      id: `agent-${Date.now()}`,
      type: "agent",
      name: capability.name,
      capability: capability.id,
      config: {},
      position: { x: 300 + Math.random() * 200, y: 150 + Math.random() * 200 },
      connections: [],
    };

    // Connect from last node
    const lastNode = workflow.nodes[workflow.nodes.length - 1];
    if (lastNode) {
      lastNode.connections.push(newNode.id);
    }

    setWorkflow(prev => ({
      ...prev,
      nodes: [...prev.nodes, newNode],
    }));
    setShowAgentPicker(false);
  };

  const deleteNode = (nodeId: string) => {
    if (nodeId === "trigger-1") return; // Can't delete trigger
    
    setWorkflow(prev => ({
      ...prev,
      nodes: prev.nodes
        .filter(n => n.id !== nodeId)
        .map(n => ({
          ...n,
          connections: n.connections.filter(c => c !== nodeId),
        })),
    }));
    setSelectedNode(null);
  };

  const saveWorkflow = async () => {
    setSaving(true);
    try {
      const token = localStorage.getItem("nooterra_token");
      const method = id && id !== "new" ? "PUT" : "POST";
      const url = id && id !== "new" 
        ? `${COORD_URL}/v1/saved-workflows/${id}`
        : `${COORD_URL}/v1/saved-workflows`;
      
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: workflow.name,
          description: workflow.description,
          nodes: workflow.nodes.reduce((acc, node) => ({
            ...acc,
            [node.id]: {
              capabilityId: node.capability || "trigger",
              dependsOn: workflow.nodes
                .filter(n => n.connections.includes(node.id))
                .map(n => n.id),
              payload: node.config,
            },
          }), {}),
          triggerType: workflow.trigger,
          status: workflow.status,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (!id || id === "new") {
          navigate(`/org/workflows/${data.id}`);
        }
      }
    } catch (err) {
      console.error("Failed to save workflow:", err);
    } finally {
      setSaving(false);
    }
  };

  const runWorkflow = async () => {
    setRunning(true);
    try {
      const token = localStorage.getItem("nooterra_token");
      
      // Convert to workflow format and execute
      const nodes = workflow.nodes
        .filter(n => n.type === "agent")
        .reduce((acc, node, i) => ({
          ...acc,
          [`step${i + 1}`]: {
            capabilityId: node.capability,
            dependsOn: i > 0 ? [`step${i}`] : undefined,
            payload: node.config,
          },
        }), {});

      const res = await fetch(`${COORD_URL}/v1/workflows/publish`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          intent: workflow.description || workflow.name,
          maxCents: 1000,
          nodes,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        navigate(`/org/workflows/${data.workflowId || id}`);
      }
    } catch (err) {
      console.error("Failed to run workflow:", err);
    } finally {
      setRunning(false);
    }
  };

  const filteredCapabilities = agentCapabilities.filter(cap =>
    cap.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    cap.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between p-4 bg-[#0a0a12] border-b border-[#4f7cff]/10">
        <div className="flex items-center gap-4">
          <input
            type="text"
            value={workflow.name}
            onChange={(e) => setWorkflow(prev => ({ ...prev, name: e.target.value }))}
            className="text-lg font-semibold bg-transparent text-white border-b border-transparent hover:border-[#4f7cff]/30 focus:border-[#4f7cff] focus:outline-none px-1"
          />
          <span className={`text-xs px-2 py-1 rounded-full ${
            workflow.status === "active" ? "bg-[#39ff8e]/10 text-[#39ff8e]" :
            workflow.status === "paused" ? "bg-yellow-500/10 text-yellow-500" :
            "bg-[#707090]/10 text-[#707090]"
          }`}>
            {workflow.status}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPreview(true)}
            className="btn-ghost py-2"
          >
            <Eye className="w-4 h-4" /> Preview
          </button>
          <button
            onClick={saveWorkflow}
            disabled={saving}
            className="btn-ghost py-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save
          </button>
          <button
            onClick={runWorkflow}
            disabled={running || workflow.nodes.filter(n => n.type === "agent").length === 0}
            className="btn-neural py-2"
          >
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Run
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Canvas */}
        <div
          ref={canvasRef}
          className="flex-1 relative bg-[#050508] overflow-auto"
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          style={{
            backgroundImage: `
              radial-gradient(circle at 1px 1px, rgba(79, 124, 255, 0.1) 1px, transparent 0)
            `,
            backgroundSize: "40px 40px",
          }}
        >
          {/* Connection Lines */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none">
            {workflow.nodes.map(node =>
              node.connections.map(targetId => {
                const target = workflow.nodes.find(n => n.id === targetId);
                if (!target) return null;
                return (
                  <g key={`${node.id}-${targetId}`}>
                    <line
                      x1={node.position.x + 140}
                      y1={node.position.y + 40}
                      x2={target.position.x}
                      y2={target.position.y + 40}
                      stroke="url(#connectionGradient)"
                      strokeWidth="2"
                    />
                    <defs>
                      <linearGradient id="connectionGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor={nodeColors[node.type]} />
                        <stop offset="100%" stopColor={nodeColors[target.type]} />
                      </linearGradient>
                    </defs>
                  </g>
                );
              })
            )}
          </svg>

          {/* Nodes */}
          {workflow.nodes.map(node => (
            <motion.div
              key={node.id}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className={`absolute cursor-move select-none ${
                selectedNode?.id === node.id ? "ring-2 ring-[#4f7cff]" : ""
              }`}
              style={{
                left: node.position.x,
                top: node.position.y,
                width: 140,
              }}
              onMouseDown={(e) => handleNodeDragStart(e, node.id)}
              onClick={() => setSelectedNode(node)}
            >
              <div
                className="rounded-xl border-2 overflow-hidden"
                style={{
                  borderColor: nodeColors[node.type],
                  backgroundColor: `${nodeColors[node.type]}10`,
                }}
              >
                <div
                  className="px-3 py-2 flex items-center gap-2"
                  style={{ backgroundColor: `${nodeColors[node.type]}30` }}
                >
                  {node.type === "trigger" ? <Zap className="w-4 h-4" /> :
                   node.type === "agent" ? <Bot className="w-4 h-4" /> :
                   node.type === "condition" ? <GitBranch className="w-4 h-4" /> :
                   <Check className="w-4 h-4" />}
                  <span className="text-white text-sm font-medium truncate">{node.name}</span>
                </div>
                {node.capability && (
                  <div className="px-3 py-2">
                    <code className="text-[10px] text-[#707090] break-all">
                      {node.capability.split(".").slice(-2).join(".")}
                    </code>
                  </div>
                )}
              </div>
              
              {/* Connection Handle */}
              <div
                className="absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-[#4f7cff] border-2 border-[#0a0a12] cursor-crosshair"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  setConnecting(node.id);
                }}
              />
            </motion.div>
          ))}

          {/* Add Node Button */}
          <button
            onClick={() => setShowAgentPicker(true)}
            className="absolute bottom-6 left-1/2 -translate-x-1/2 btn-neural py-3 px-6"
          >
            <Plus className="w-5 h-5" /> Add Agent
          </button>
        </div>

        {/* Node Config Panel */}
        <AnimatePresence>
          {selectedNode && (
            <motion.div
              initial={{ x: 300, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 300, opacity: 0 }}
              className="w-80 bg-[#0a0a12] border-l border-[#4f7cff]/10 overflow-y-auto"
            >
              <div className="p-4 border-b border-[#4f7cff]/10 flex items-center justify-between">
                <h3 className="text-white font-semibold">Configure Node</h3>
                <button
                  onClick={() => setSelectedNode(null)}
                  className="text-[#707090] hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-4 space-y-4">
                <div>
                  <label className="block text-sm text-[#707090] mb-1">Name</label>
                  <input
                    type="text"
                    value={selectedNode.name}
                    onChange={(e) => {
                      setWorkflow(prev => ({
                        ...prev,
                        nodes: prev.nodes.map(n =>
                          n.id === selectedNode.id ? { ...n, name: e.target.value } : n
                        ),
                      }));
                      setSelectedNode({ ...selectedNode, name: e.target.value });
                    }}
                    className="w-full bg-[#0f0f18] border border-[#4f7cff]/20 rounded-lg px-3 py-2 text-white"
                  />
                </div>

                {selectedNode.type === "trigger" && (
                  <div>
                    <label className="block text-sm text-[#707090] mb-1">Trigger Type</label>
                    <select
                      value={selectedNode.config.trigger || "manual"}
                      onChange={(e) => {
                        const newConfig = { ...selectedNode.config, trigger: e.target.value };
                        setWorkflow(prev => ({
                          ...prev,
                          nodes: prev.nodes.map(n =>
                            n.id === selectedNode.id ? { ...n, config: newConfig } : n
                          ),
                        }));
                        setSelectedNode({ ...selectedNode, config: newConfig });
                      }}
                      className="w-full bg-[#0f0f18] border border-[#4f7cff]/20 rounded-lg px-3 py-2 text-white"
                    >
                      <option value="manual">Manual</option>
                      <option value="webhook">Webhook</option>
                      <option value="schedule">Schedule</option>
                    </select>
                  </div>
                )}

                {selectedNode.capability && (
                  <div>
                    <label className="block text-sm text-[#707090] mb-1">Capability</label>
                    <code className="block text-[#4f7cff] text-sm bg-[#0f0f18] px-3 py-2 rounded-lg">
                      {selectedNode.capability}
                    </code>
                  </div>
                )}

                <div>
                  <label className="block text-sm text-[#707090] mb-1">Input Payload</label>
                  <textarea
                    value={JSON.stringify(selectedNode.config.payload || {}, null, 2)}
                    onChange={(e) => {
                      try {
                        const payload = JSON.parse(e.target.value);
                        const newConfig = { ...selectedNode.config, payload };
                        setWorkflow(prev => ({
                          ...prev,
                          nodes: prev.nodes.map(n =>
                            n.id === selectedNode.id ? { ...n, config: newConfig } : n
                          ),
                        }));
                        setSelectedNode({ ...selectedNode, config: newConfig });
                      } catch {}
                    }}
                    placeholder="{}"
                    rows={4}
                    className="w-full bg-[#0f0f18] border border-[#4f7cff]/20 rounded-lg px-3 py-2 text-white font-mono text-sm resize-none"
                  />
                </div>

                {selectedNode.type !== "trigger" && (
                  <button
                    onClick={() => deleteNode(selectedNode.id)}
                    className="w-full flex items-center justify-center gap-2 py-2 text-red-400 bg-red-500/10 rounded-lg hover:bg-red-500/20"
                  >
                    <Trash2 className="w-4 h-4" /> Delete Node
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Agent Picker Modal */}
      <AnimatePresence>
        {showAgentPicker && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
            onClick={() => setShowAgentPicker(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg bg-[#0a0a12] border border-[#4f7cff]/20 rounded-2xl overflow-hidden"
            >
              <div className="p-4 border-b border-[#4f7cff]/10">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#707090]" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search agents..."
                    className="w-full pl-10 pr-4 py-3 bg-[#0f0f18] border border-[#4f7cff]/20 rounded-xl text-white placeholder-[#505060]"
                    autoFocus
                  />
                </div>
              </div>

              <div className="p-4 max-h-[400px] overflow-y-auto">
                <div className="grid gap-2">
                  {filteredCapabilities.map((cap) => (
                    <button
                      key={cap.id}
                      onClick={() => addNode(cap)}
                      className="flex items-center gap-4 p-4 rounded-xl bg-[#0f0f18] hover:bg-[#4f7cff]/10 border border-transparent hover:border-[#4f7cff]/30 transition-all text-left"
                    >
                      <div className="w-10 h-10 rounded-lg bg-[#4f7cff]/10 flex items-center justify-center text-[#4f7cff]">
                        {cap.icon}
                      </div>
                      <div className="flex-1">
                        <div className="text-white font-medium">{cap.name}</div>
                        <div className="text-[#707090] text-xs">{cap.category}</div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-[#707090]" />
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
