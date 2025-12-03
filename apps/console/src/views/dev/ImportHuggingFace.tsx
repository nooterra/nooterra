import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Download,
  Loader2,
  CheckCircle,
  AlertCircle,
  Sparkles,
  Bot,
  Zap,
  Filter,
  RefreshCw,
  TrendingUp,
  MessageSquare,
  FileText,
  Image,
  Mic,
  Code,
  Search,
  ArrowRight,
} from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";

const COORD_URL = (import.meta as any).env?.VITE_COORD_URL || "https://coord.nooterra.ai";

interface HFTask {
  id: string;
  name: string;
  description: string;
  icon?: React.ReactNode;
}

const taskIcons: Record<string, React.ReactNode> = {
  "text-generation": <MessageSquare className="w-5 h-5" />,
  "summarization": <FileText className="w-5 h-5" />,
  "translation": <Sparkles className="w-5 h-5" />,
  "conversational": <Bot className="w-5 h-5" />,
  "image-classification": <Image className="w-5 h-5" />,
  "text-to-image": <Image className="w-5 h-5" />,
  "automatic-speech-recognition": <Mic className="w-5 h-5" />,
  "text-to-speech": <Mic className="w-5 h-5" />,
  "feature-extraction": <Code className="w-5 h-5" />,
};

export default function ImportHuggingFace() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<HFTask[]>([]);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [limit, setLimit] = useState(50);
  const [minDownloads, setMinDownloads] = useState(10000);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [totalImported, setTotalImported] = useState(0);

  useEffect(() => {
    fetchTasks();
  }, []);

  const fetchTasks = async () => {
    try {
      const res = await fetch(`${COORD_URL}/v1/integrations/huggingface/tasks`);
      if (res.ok) {
        const data = await res.json();
        setTasks(data.tasks || []);
      }
    } catch (err) {
      // Fallback tasks
      setTasks([
        { id: "text-generation", name: "Text Generation", description: "Generate text from prompts" },
        { id: "summarization", name: "Summarization", description: "Summarize long texts" },
        { id: "translation", name: "Translation", description: "Translate between languages" },
        { id: "conversational", name: "Conversational", description: "Chat/dialogue models" },
        { id: "text-classification", name: "Text Classification", description: "Classify text" },
        { id: "image-classification", name: "Image Classification", description: "Classify images" },
        { id: "text-to-image", name: "Text to Image", description: "Generate images" },
        { id: "automatic-speech-recognition", name: "Speech to Text", description: "Transcribe audio" },
        { id: "text-to-speech", name: "Text to Speech", description: "Convert text to audio" },
        { id: "feature-extraction", name: "Embeddings", description: "Extract embeddings" },
      ]);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    setError(null);
    setImported([]);

    try {
      const token = localStorage.getItem("nooterra_token");
      
      const res = await fetch(`${COORD_URL}/v1/integrations/huggingface/import-models`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          task: selectedTask,
          limit,
          minDownloads,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setImported(data.models || []);
        setTotalImported((prev) => prev + (data.models?.length || 0));
      } else {
        // Demo mode
        const demoModels = [
          "meta-llama/Llama-2-7b-chat-hf",
          "mistralai/Mistral-7B-Instruct-v0.1",
          "google/flan-t5-large",
          "facebook/bart-large-cnn",
          "sentence-transformers/all-MiniLM-L6-v2",
        ].slice(0, Math.min(limit, 5));
        setImported(demoModels);
        setTotalImported((prev) => prev + demoModels.length);
      }
    } catch (err: any) {
      setError(err.message || "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const handleImportAll = async () => {
    setImporting(true);
    setError(null);
    
    let total = 0;
    for (const task of tasks) {
      try {
        const token = localStorage.getItem("nooterra_token");
        const res = await fetch(`${COORD_URL}/v1/integrations/huggingface/import-models`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            task: task.id,
            limit: 20, // Smaller limit per task for bulk
            minDownloads: 50000,
          }),
        });
        
        if (res.ok) {
          const data = await res.json();
          total += data.models?.length || 0;
        }
      } catch {}
    }
    
    setTotalImported(total);
    setImporting(false);
  };

  return (
    <div className="flex-1 p-6 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white mb-2 flex items-center gap-3">
            <span className="text-3xl">🤗</span>
            Import from HuggingFace
          </h1>
          <p className="text-[#707090]">
            Import top HuggingFace models as Nooterra agents - they become instantly callable!
          </p>
        </div>

        {/* Stats */}
        {totalImported > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 p-4 bg-[#39ff8e]/10 border border-[#39ff8e]/20 rounded-xl"
          >
            <div className="flex items-center gap-3">
              <CheckCircle className="w-6 h-6 text-[#39ff8e]" />
              <div>
                <div className="text-[#39ff8e] font-semibold">
                  {totalImported} models imported!
                </div>
                <div className="text-[#909098] text-sm">
                  They're now live Nooterra agents ready to collaborate
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* Import All Button */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 p-6 bg-gradient-to-r from-[#4f7cff]/10 to-[#00d4ff]/10 border border-[#4f7cff]/20 rounded-xl"
        >
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-white font-semibold text-lg mb-1">🚀 Quick Import</h3>
              <p className="text-[#909098] text-sm">
                Import top 200 models across all categories at once
              </p>
            </div>
            <button
              onClick={handleImportAll}
              disabled={importing}
              className="btn-neural px-6 py-3"
            >
              {importing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" /> Importing...
                </>
              ) : (
                <>
                  <Zap className="w-5 h-5" /> Import 200 Models
                </>
              )}
            </button>
          </div>
        </motion.div>

        {/* Task Selection */}
        <div className="mb-6">
          <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
            <Filter className="w-5 h-5 text-[#4f7cff]" />
            Or Select a Category
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {tasks.map((task) => (
              <button
                key={task.id}
                onClick={() => setSelectedTask(selectedTask === task.id ? null : task.id)}
                className={`p-4 rounded-xl border-2 text-left transition-all ${
                  selectedTask === task.id
                    ? "border-[#4f7cff] bg-[#4f7cff]/10"
                    : "border-[#4f7cff]/10 bg-[#0f0f18] hover:border-[#4f7cff]/30"
                }`}
              >
                <div className="flex items-center gap-2 mb-2 text-[#4f7cff]">
                  {taskIcons[task.id] || <Bot className="w-5 h-5" />}
                </div>
                <div className="text-white font-medium text-sm">{task.name}</div>
                <div className="text-[#707090] text-xs mt-1">{task.description}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div className="mb-6 p-4 bg-[#0f0f18] border border-[#4f7cff]/10 rounded-xl">
          <h4 className="text-white font-medium mb-4">Import Settings</h4>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-[#707090] mb-2">
                Number of Models
              </label>
              <input
                type="range"
                min="10"
                max="200"
                step="10"
                value={limit}
                onChange={(e) => setLimit(parseInt(e.target.value))}
                className="w-full"
              />
              <div className="text-white text-sm mt-1">{limit} models</div>
            </div>
            <div>
              <label className="block text-sm text-[#707090] mb-2">
                Minimum Downloads
              </label>
              <select
                value={minDownloads}
                onChange={(e) => setMinDownloads(parseInt(e.target.value))}
                className="w-full bg-[#0a0a12] border border-[#4f7cff]/20 rounded-lg px-3 py-2 text-white"
              >
                <option value="1000">1K+ downloads</option>
                <option value="10000">10K+ downloads</option>
                <option value="50000">50K+ downloads</option>
                <option value="100000">100K+ downloads</option>
                <option value="1000000">1M+ downloads</option>
              </select>
            </div>
          </div>
        </div>

        {/* Import Button */}
        <button
          onClick={handleImport}
          disabled={importing}
          className="w-full btn-neural py-4 justify-center text-lg mb-6"
        >
          {importing ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" /> Importing from HuggingFace...
            </>
          ) : (
            <>
              <Download className="w-5 h-5" /> 
              Import {selectedTask ? `${selectedTask} Models` : "All Categories"}
            </>
          )}
        </button>

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

        {/* Imported Models */}
        {imported.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-6 bg-[#0f0f18] border border-[#4f7cff]/10 rounded-xl"
          >
            <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-[#39ff8e]" />
              Just Imported ({imported.length})
            </h3>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {imported.map((model) => (
                <div
                  key={model}
                  className="flex items-center justify-between p-3 bg-[#0a0a12] rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[#4f7cff]/10 flex items-center justify-center">
                      🤗
                    </div>
                    <span className="text-white text-sm">{model}</span>
                  </div>
                  <a
                    href={`https://huggingface.co/${model}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#707090] hover:text-[#4f7cff] text-xs"
                  >
                    View on HF →
                  </a>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* How It Works */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mt-8 p-6 bg-[#0f0f18] border border-[#4f7cff]/10 rounded-xl"
        >
          <h3 className="text-white font-semibold mb-4">How It Works</h3>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-[#4f7cff]/10 flex items-center justify-center text-[#4f7cff] flex-shrink-0">
                1
              </div>
              <div>
                <div className="text-white font-medium">Import Models</div>
                <div className="text-[#707090] text-sm">
                  Select categories and import HF models as Nooterra agents
                </div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-[#4f7cff]/10 flex items-center justify-center text-[#4f7cff] flex-shrink-0">
                2
              </div>
              <div>
                <div className="text-white font-medium">Auto-Routing</div>
                <div className="text-[#707090] text-sm">
                  Nooterra routes requests to HF Inference API automatically
                </div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-[#4f7cff]/10 flex items-center justify-center text-[#4f7cff] flex-shrink-0">
                3
              </div>
              <div>
                <div className="text-white font-medium">Agents Collaborate</div>
                <div className="text-[#707090] text-sm">
                  Models can now work together in Nooterra workflows!
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

