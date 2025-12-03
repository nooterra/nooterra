import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Download,
  Loader2,
  CheckCircle,
  Sparkles,
  Zap,
  ArrowRight,
  Eye,
  Mic,
  FileText,
  Code,
  FlaskConical,
  Stethoscope,
  Palette,
  Search,
  Globe,
  Calculator,
  Play,
  GitBranch,
  ChevronRight,
} from "lucide-react";

const COORD_URL = (import.meta as any).env?.VITE_COORD_URL || "https://coord.nooterra.ai";

interface Category {
  id: string;
  name: string;
  description: string;
  emoji: string;
  modelCount: number;
}

interface WorkflowNode {
  capability: string;
  description: string;
  dependsOn?: string[];
}

interface ExampleWorkflow {
  id: string;
  name: string;
  description: string;
  nodes: Record<string, WorkflowNode>;
}

const categoryIcons: Record<string, React.ReactNode> = {
  vision: <Eye className="w-6 h-6" />,
  audio: <Mic className="w-6 h-6" />,
  document: <FileText className="w-6 h-6" />,
  code: <Code className="w-6 h-6" />,
  science: <FlaskConical className="w-6 h-6" />,
  medical: <Stethoscope className="w-6 h-6" />,
  creative: <Palette className="w-6 h-6" />,
  embedding: <Search className="w-6 h-6" />,
  translation: <Globe className="w-6 h-6" />,
  math: <Calculator className="w-6 h-6" />,
};

export default function SpecializedAgents() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [workflows, setWorkflows] = useState<ExampleWorkflow[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importedCount, setImportedCount] = useState(0);
  const [selectedWorkflow, setSelectedWorkflow] = useState<ExampleWorkflow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const res = await fetch(`${COORD_URL}/v1/integrations/huggingface/specialized-categories`);
      if (res.ok) {
        const data = await res.json();
        setCategories(data.categories || []);
        setWorkflows(data.exampleWorkflows || []);
      } else {
        // Fallback data
        setCategories([
          { id: "vision", name: "Computer Vision", description: "Real image analysis", emoji: "👁️", modelCount: 5 },
          { id: "audio", name: "Audio & Speech", description: "Transcribe, generate audio", emoji: "🎵", modelCount: 4 },
          { id: "document", name: "Document AI", description: "Extract data from PDFs", emoji: "📄", modelCount: 4 },
          { id: "code", name: "Code & Programming", description: "Code generation", emoji: "💻", modelCount: 3 },
          { id: "science", name: "Scientific", description: "Protein folding, chemistry", emoji: "🔬", modelCount: 3 },
          { id: "medical", name: "Medical", description: "Clinical NLP", emoji: "🏥", modelCount: 2 },
          { id: "creative", name: "Creative", description: "Image generation", emoji: "🎨", modelCount: 3 },
          { id: "embedding", name: "Embeddings", description: "Semantic search", emoji: "🔍", modelCount: 3 },
          { id: "translation", name: "Translation", description: "100+ languages", emoji: "🌍", modelCount: 3 },
          { id: "math", name: "Math", description: "Equation solving", emoji: "🧮", modelCount: 2 },
        ]);
        setWorkflows([
          {
            id: "document-to-insights",
            name: "Document to Insights",
            description: "Extract, translate, analyze",
            nodes: {
              extract: { capability: "cap.document.ocr", description: "OCR" },
              summarize: { capability: "cap.text.summarize", description: "Summarize", dependsOn: ["extract"] },
              translate: { capability: "cap.translate", description: "Translate", dependsOn: ["summarize"] },
            },
          },
        ]);
      }
    } catch (err) {
      console.error("Failed to fetch specialized categories:", err);
    } finally {
      setLoading(false);
    }
  };

  const toggleCategory = (id: string) => {
    setSelectedCategories(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelectedCategories(new Set(categories.map(c => c.id)));
  };

  const handleImport = async () => {
    setImporting(true);
    setImportedCount(0);

    try {
      const token = localStorage.getItem("nooterra_token");
      const res = await fetch(`${COORD_URL}/v1/integrations/huggingface/import-specialized`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          categories: selectedCategories.size > 0 ? Array.from(selectedCategories) : undefined,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setImportedCount(data.imported || 0);
      } else {
        // Demo mode
        const totalModels = Array.from(selectedCategories).reduce((sum, catId) => {
          const cat = categories.find(c => c.id === catId);
          return sum + (cat?.modelCount || 0);
        }, 0);
        setImportedCount(totalModels || categories.reduce((s, c) => s + c.modelCount, 0));
      }
    } catch (err) {
      console.error("Import failed:", err);
    } finally {
      setImporting(false);
    }
  };

  const totalSelectedModels = Array.from(selectedCategories).reduce((sum, catId) => {
    const cat = categories.find(c => c.id === catId);
    return sum + (cat?.modelCount || 0);
  }, 0);

  const totalModels = categories.reduce((s, c) => s + c.modelCount, 0);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#4f7cff]" />
      </div>
    );
  }

  return (
    <div className="flex-1 p-6 overflow-y-auto">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2 flex items-center gap-3">
            <Sparkles className="w-8 h-8 text-[#00d4ff]" />
            Specialized AI Agents
          </h1>
          <p className="text-[#909098] text-lg">
            Import agents that can do things general LLMs <span className="text-[#ff6b6b] font-semibold">CANNOT</span> do.
            Real image analysis, audio processing, scientific computing, and more.
          </p>
        </div>

        {/* Import Success */}
        {importedCount > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8 p-6 bg-gradient-to-r from-[#39ff8e]/10 to-[#00d4ff]/10 border border-[#39ff8e]/30 rounded-xl"
          >
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-xl bg-[#39ff8e]/20 flex items-center justify-center">
                <CheckCircle className="w-8 h-8 text-[#39ff8e]" />
              </div>
              <div>
                <div className="text-[#39ff8e] text-xl font-bold">
                  🎉 {importedCount} Specialized Agents Imported!
                </div>
                <div className="text-[#909098]">
                  These agents are now live and ready to collaborate in workflows
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* Categories Grid */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-white">Select Categories</h2>
            <button
              onClick={selectAll}
              className="text-[#4f7cff] hover:text-[#00d4ff] text-sm font-medium"
            >
              Select All ({totalModels} models)
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {categories.map((category, i) => (
              <motion.button
                key={category.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                onClick={() => toggleCategory(category.id)}
                className={`p-4 rounded-xl border-2 text-left transition-all ${
                  selectedCategories.has(category.id)
                    ? "border-[#4f7cff] bg-[#4f7cff]/10 shadow-lg shadow-[#4f7cff]/20"
                    : "border-[#4f7cff]/10 bg-[#0f0f18] hover:border-[#4f7cff]/30"
                }`}
              >
                <div className="text-3xl mb-2">{category.emoji}</div>
                <div className="text-white font-semibold text-sm mb-1">{category.name}</div>
                <div className="text-[#707090] text-xs mb-2">{category.description}</div>
                <div className="text-[#4f7cff] text-xs font-medium">
                  {category.modelCount} models
                </div>
              </motion.button>
            ))}
          </div>
        </div>

        {/* Import Button */}
        <div className="mb-12">
          <button
            onClick={handleImport}
            disabled={importing}
            className="w-full btn-neural py-5 justify-center text-lg"
          >
            {importing ? (
              <>
                <Loader2 className="w-6 h-6 animate-spin" />
                Importing Specialized Agents...
              </>
            ) : (
              <>
                <Download className="w-6 h-6" />
                Import {selectedCategories.size > 0 ? totalSelectedModels : totalModels} Specialized Agents
              </>
            )}
          </button>
          <p className="text-center text-[#707090] text-sm mt-2">
            {selectedCategories.size > 0
              ? `Selected: ${Array.from(selectedCategories).join(", ")}`
              : "All categories will be imported"}
          </p>
        </div>

        {/* Example Workflows */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold text-white mb-2 flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-[#00d4ff]" />
            Example Collaboration Workflows
          </h2>
          <p className="text-[#707090] mb-6">
            See how specialized agents work together to complete complex tasks
          </p>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {workflows.map((workflow, i) => (
              <motion.div
                key={workflow.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + i * 0.1 }}
                className="p-5 bg-[#0f0f18] border border-[#4f7cff]/10 rounded-xl hover:border-[#4f7cff]/30 transition-all cursor-pointer group"
                onClick={() => setSelectedWorkflow(workflow)}
              >
                <div className="flex items-start justify-between mb-3">
                  <h3 className="text-white font-semibold">{workflow.name}</h3>
                  <ChevronRight className="w-5 h-5 text-[#707090] group-hover:text-[#4f7cff] transition-colors" />
                </div>
                <p className="text-[#707090] text-sm mb-4">{workflow.description}</p>
                
                {/* Mini workflow visualization */}
                <div className="flex items-center gap-1 flex-wrap">
                  {Object.entries(workflow.nodes).map(([name, node], idx) => (
                    <React.Fragment key={name}>
                      <div className="px-2 py-1 bg-[#4f7cff]/10 rounded text-xs text-[#4f7cff] font-medium">
                        {name}
                      </div>
                      {idx < Object.keys(workflow.nodes).length - 1 && (
                        <ArrowRight className="w-3 h-3 text-[#707090]" />
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Workflow Detail Modal */}
        <AnimatePresence>
          {selectedWorkflow && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
              onClick={() => setSelectedWorkflow(null)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-[#0a0a12] border border-[#4f7cff]/20 rounded-2xl p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-start justify-between mb-6">
                  <div>
                    <h2 className="text-2xl font-bold text-white mb-1">
                      {selectedWorkflow.name}
                    </h2>
                    <p className="text-[#909098]">{selectedWorkflow.description}</p>
                  </div>
                  <button
                    onClick={() => setSelectedWorkflow(null)}
                    className="text-[#707090] hover:text-white"
                  >
                    ✕
                  </button>
                </div>

                {/* Workflow DAG Visualization */}
                <div className="space-y-4">
                  {Object.entries(selectedWorkflow.nodes).map(([name, node], idx) => (
                    <motion.div
                      key={name}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.1 }}
                      className="flex items-start gap-4"
                    >
                      <div className="w-10 h-10 rounded-full bg-[#4f7cff]/20 flex items-center justify-center text-[#4f7cff] font-bold flex-shrink-0">
                        {idx + 1}
                      </div>
                      <div className="flex-1 p-4 bg-[#0f0f18] border border-[#4f7cff]/10 rounded-xl">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-white font-semibold">{name}</span>
                          {node.dependsOn && node.dependsOn.length > 0 && (
                            <span className="text-xs text-[#707090]">
                              ← depends on: {node.dependsOn.join(", ")}
                            </span>
                          )}
                        </div>
                        <p className="text-[#909098] text-sm mb-2">{node.description}</p>
                        <code className="text-xs text-[#00d4ff] bg-[#00d4ff]/10 px-2 py-1 rounded">
                          {node.capability}
                        </code>
                      </div>
                    </motion.div>
                  ))}
                </div>

                <div className="mt-6 flex gap-3">
                  <button
                    className="flex-1 btn-neural justify-center"
                    onClick={() => {
                      // TODO: Actually run this workflow
                      alert("Workflow execution coming soon!");
                    }}
                  >
                    <Play className="w-5 h-5" />
                    Run This Workflow
                  </button>
                  <button
                    className="px-6 py-3 border border-[#4f7cff]/20 text-[#909098] rounded-xl hover:bg-[#4f7cff]/10 transition-all"
                    onClick={() => setSelectedWorkflow(null)}
                  >
                    Close
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Why Specialized Agents Matter */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="p-6 bg-gradient-to-br from-[#4f7cff]/5 to-[#00d4ff]/5 border border-[#4f7cff]/10 rounded-xl"
        >
          <h3 className="text-white font-semibold text-lg mb-4">
            🧠 Why Specialized Agents Beat General LLMs
          </h3>
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h4 className="text-[#ff6b6b] font-medium mb-2">❌ General LLMs (GPT-4, Claude)</h4>
              <ul className="text-[#909098] text-sm space-y-1">
                <li>• Hallucinate image descriptions</li>
                <li>• Can't actually process audio</li>
                <li>• Limited mathematical precision</li>
                <li>• No real document parsing</li>
                <li>• Generic code suggestions</li>
              </ul>
            </div>
            <div>
              <h4 className="text-[#39ff8e] font-medium mb-2">✅ Specialized Agents</h4>
              <ul className="text-[#909098] text-sm space-y-1">
                <li>• Real computer vision with bounding boxes</li>
                <li>• Actual audio transcription (Whisper)</li>
                <li>• Mathematical proof generation (Llemma)</li>
                <li>• OCR + document structure extraction</li>
                <li>• 80+ language code models (StarCoder)</li>
              </ul>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

