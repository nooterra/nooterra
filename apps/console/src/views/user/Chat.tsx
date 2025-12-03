import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useParams, useNavigate } from "react-router-dom";
import {
  Send,
  Plus,
  Bot,
  User,
  Loader2,
  Sparkles,
  Copy,
  Check,
  RotateCcw,
  Zap,
  ChevronDown,
  ArrowRight,
  Wand2,
  Code,
  FileText,
  ImageIcon,
  PenTool,
  Settings2,
  ThumbsUp,
  ThumbsDown,
  Share2,
} from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";

const COORD_URL = (import.meta as any).env?.VITE_COORD_URL || "https://coord.nooterra.ai";

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  agents?: string[];
  workflowId?: string;
  cost?: number;
  thinking?: boolean;
}

interface SuggestedPrompt {
  icon: React.ReactNode;
  title: string;
  prompt: string;
}

const suggestedPrompts: SuggestedPrompt[] = [
  {
    icon: <Code className="w-5 h-5" />,
    title: "Code Review",
    prompt: "Review this code for bugs and suggest improvements",
  },
  {
    icon: <FileText className="w-5 h-5" />,
    title: "Summarize Document",
    prompt: "Summarize the key points of this document",
  },
  {
    icon: <PenTool className="w-5 h-5" />,
    title: "Write Content",
    prompt: "Write a compelling blog post about",
  },
  {
    icon: <Wand2 className="w-5 h-5" />,
    title: "Creative Ideas",
    prompt: "Generate creative ideas for",
  },
];

export default function Chat() {
  const { id: conversationId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedModel, setSelectedModel] = useState("auto");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Load conversation if ID provided
  useEffect(() => {
    if (conversationId) {
      loadConversation(conversationId);
    }
  }, [conversationId]);

  const loadConversation = async (id: string) => {
    const token = localStorage.getItem("nooterra_token");
    if (!token) return;

    try {
      const res = await fetch(`${COORD_URL}/v1/conversations/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      }
    } catch (err) {
      console.error("Failed to load conversation:", err);
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    // Add thinking indicator
    const thinkingId = (Date.now() + 1).toString();
    setMessages((prev) => [
      ...prev,
      { id: thinkingId, role: "assistant", content: "", timestamp: new Date(), thinking: true },
    ]);

    try {
      const token = localStorage.getItem("nooterra_token");
      
      // Call the workflow API
      const res = await fetch(`${COORD_URL}/v1/workflows/publish`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          intent: userMessage.content,
          maxCents: 100,
          conversationId: conversationId || undefined,
        }),
      });

      if (!res.ok) {
        throw new Error("Request failed");
      }

      const data = await res.json();
      const workflowId = data.workflowId;

      // Poll for result
      let result = null;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        
        const statusRes = await fetch(`${COORD_URL}/v1/workflows/${workflowId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        
        if (statusRes.ok) {
          const status = await statusRes.json();
          if (status.workflow?.status === "success" || status.workflow?.status === "failed") {
            result = status;
            break;
          }
        }
      }

      // Remove thinking indicator and add response
      setMessages((prev) => {
        const newMessages = prev.filter((m) => m.id !== thinkingId);
        
        if (result?.workflow?.status === "success") {
          const nodes = result.nodes || [];
          const lastNode = nodes[nodes.length - 1];
          const responseContent = 
            lastNode?.result_payload?.result?.response ||
            lastNode?.result_payload?.result?.output ||
            lastNode?.result_payload?.result?.message ||
            JSON.stringify(lastNode?.result_payload?.result || "Task completed successfully");
          
          return [
            ...newMessages,
            {
              id: Date.now().toString(),
              role: "assistant",
              content: typeof responseContent === 'string' ? responseContent : JSON.stringify(responseContent, null, 2),
              timestamp: new Date(),
              agents: nodes.map((n: any) => n.capability_id),
              workflowId,
              cost: result.workflow.total_cost_cents || 0,
            },
          ];
        } else {
          return [
            ...newMessages,
            {
              id: Date.now().toString(),
              role: "assistant",
              content: "I apologize, but I couldn't process your request. Please try again.",
              timestamp: new Date(),
              workflowId,
            },
          ];
        }
      });
    } catch (err) {
      console.error("Chat error:", err);
      setMessages((prev) => {
        const newMessages = prev.filter((m) => m.id !== thinkingId);
        return [
          ...newMessages,
          {
            id: Date.now().toString(),
            role: "assistant",
            content: "Sorry, something went wrong. Please try again.",
            timestamp: new Date(),
          },
        ];
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handlePromptClick = (prompt: string) => {
    setInput(prompt);
    inputRef.current?.focus();
  };

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          // Empty State
          <div className="flex flex-col items-center justify-center h-full p-6">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center max-w-2xl"
            >
              {/* Animated Logo */}
              <div className="relative w-24 h-24 mx-auto mb-8">
                <div className="absolute inset-0 bg-gradient-to-br from-[#4f7cff] to-[#00d4ff] rounded-2xl animate-pulse opacity-50" />
                <div className="absolute inset-2 bg-[#0a0a12] rounded-xl flex items-center justify-center">
                  <Sparkles className="w-10 h-10 text-[#4f7cff]" />
                </div>
              </div>

              <h1 className="text-3xl font-bold text-white mb-3">
                How can I help you today?
              </h1>
              <p className="text-[#707090] text-lg mb-8">
                I coordinate specialized AI agents to tackle any task.
                Just describe what you need.
              </p>

              {/* Suggested Prompts */}
              <div className="grid grid-cols-2 gap-3">
                {suggestedPrompts.map((item, i) => (
                  <motion.button
                    key={i}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.1 }}
                    onClick={() => handlePromptClick(item.prompt)}
                    className="flex items-center gap-3 p-4 bg-[#0f0f18] border border-[#4f7cff]/10 rounded-xl text-left hover:border-[#4f7cff]/30 hover:bg-[#4f7cff]/5 transition-all group"
                  >
                    <div className="w-10 h-10 rounded-lg bg-[#4f7cff]/10 flex items-center justify-center text-[#4f7cff] group-hover:bg-[#4f7cff]/20">
                      {item.icon}
                    </div>
                    <div>
                      <div className="text-white font-medium">{item.title}</div>
                      <div className="text-[#707090] text-sm truncate">{item.prompt}...</div>
                    </div>
                  </motion.button>
                ))}
              </div>
            </motion.div>
          </div>
        ) : (
          // Messages
          <div className="max-w-3xl mx-auto py-6 px-4">
            {messages.map((message, i) => (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex gap-4 mb-6 ${message.role === "user" ? "justify-end" : ""}`}
              >
                {message.role === "assistant" && (
                  <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-[#4f7cff] to-[#00d4ff] flex items-center justify-center">
                    <Bot className="w-5 h-5 text-white" />
                  </div>
                )}

                <div
                  className={`flex-1 max-w-[85%] ${
                    message.role === "user"
                      ? "bg-[#4f7cff] rounded-2xl rounded-tr-md px-4 py-3"
                      : ""
                  }`}
                >
                  {message.thinking ? (
                    <div className="flex items-center gap-2 text-[#707090]">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Coordinating agents...</span>
                    </div>
                  ) : (
                    <>
                      <div
                        className={`${
                          message.role === "user"
                            ? "text-white"
                            : "text-[#e0e0e8] prose prose-invert prose-sm max-w-none"
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{message.content}</p>
                      </div>

                      {message.role === "assistant" && (
                        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[#4f7cff]/10">
                          <button
                            onClick={() => handleCopy(message.id, message.content)}
                            className="p-1.5 text-[#707090] hover:text-white rounded-lg hover:bg-[#4f7cff]/10 transition-colors"
                          >
                            {copied === message.id ? (
                              <Check className="w-4 h-4 text-[#39ff8e]" />
                            ) : (
                              <Copy className="w-4 h-4" />
                            )}
                          </button>
                          <button className="p-1.5 text-[#707090] hover:text-white rounded-lg hover:bg-[#4f7cff]/10 transition-colors">
                            <ThumbsUp className="w-4 h-4" />
                          </button>
                          <button className="p-1.5 text-[#707090] hover:text-white rounded-lg hover:bg-[#4f7cff]/10 transition-colors">
                            <ThumbsDown className="w-4 h-4" />
                          </button>
                          <button className="p-1.5 text-[#707090] hover:text-white rounded-lg hover:bg-[#4f7cff]/10 transition-colors">
                            <RotateCcw className="w-4 h-4" />
                          </button>

                          {message.agents && message.agents.length > 0 && (
                            <div className="ml-auto flex items-center gap-1 text-xs text-[#505060]">
                              <Zap className="w-3 h-3" />
                              {message.agents.slice(0, 2).join(", ")}
                              {message.agents.length > 2 && ` +${message.agents.length - 2}`}
                            </div>
                          )}

                          {message.cost !== undefined && message.cost > 0 && (
                            <span className="text-xs text-[#4f7cff]">
                              {message.cost} NCR
                            </span>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {message.role === "user" && (
                  <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-[#4f7cff]/20 flex items-center justify-center">
                    <User className="w-5 h-5 text-[#4f7cff]" />
                  </div>
                )}
              </motion.div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="border-t border-[#4f7cff]/10 bg-[#0a0a12]/80 backdrop-blur-xl p-4">
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto">
          <div className="relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message Nooterra..."
              rows={1}
              className="w-full px-5 py-4 pr-24 bg-[#0f0f18] border border-[#4f7cff]/20 rounded-2xl text-white placeholder-[#505060] resize-none focus:outline-none focus:border-[#4f7cff]/50 focus:ring-2 focus:ring-[#4f7cff]/10 transition-all"
              style={{ minHeight: "56px", maxHeight: "200px" }}
            />
            
            <div className="absolute right-2 bottom-2 flex items-center gap-1">
              <button
                type="button"
                onClick={() => setShowSettings(!showSettings)}
                className={`p-2 rounded-lg transition-colors ${
                  showSettings ? "bg-[#4f7cff]/20 text-[#4f7cff]" : "text-[#707090] hover:text-white hover:bg-[#4f7cff]/10"
                }`}
              >
                <Settings2 className="w-5 h-5" />
              </button>
              <button
                type="submit"
                disabled={!input.trim() || isLoading}
                className={`p-2 rounded-lg transition-all ${
                  input.trim() && !isLoading
                    ? "bg-[#4f7cff] text-white hover:bg-[#3d6ae8]"
                    : "bg-[#4f7cff]/10 text-[#707090]"
                }`}
              >
                {isLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Send className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>

          {/* Settings Panel */}
          <AnimatePresence>
            {showSettings && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="pt-4 flex items-center gap-4">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-[#707090]">Mode:</span>
                    <select
                      value={selectedModel}
                      onChange={(e) => setSelectedModel(e.target.value)}
                      className="bg-[#0f0f18] border border-[#4f7cff]/20 rounded-lg px-3 py-1.5 text-white text-sm"
                    >
                      <option value="auto">Auto (Best for task)</option>
                      <option value="fast">Fast (Lower cost)</option>
                      <option value="quality">Quality (Best results)</option>
                    </select>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="mt-2 text-center text-xs text-[#505060]">
            Nooterra coordinates AI agents to complete your tasks. {user ? "Connected" : "Connect wallet to save conversations."}
          </div>
        </form>
      </div>
    </div>
  );
}
