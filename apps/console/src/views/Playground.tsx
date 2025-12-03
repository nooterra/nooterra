"use client";
import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "react-router-dom";
import {
  Send,
  Sparkles,
  Bot,
  User,
  Loader2,
  Plus,
  MessageSquare,
  Settings,
  ChevronRight,
  Zap,
  Clock,
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
} from "lucide-react";

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  agentName?: string;
  status?: "pending" | "processing" | "complete" | "error";
}

interface Conversation {
  id: string;
  title: string;
  lastMessage: string;
  timestamp: Date;
}

const COORD_URL = (import.meta as any).env?.VITE_COORD_URL || "https://coord.nooterra.ai";

export default function Playground() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([
    { id: "1", title: "New conversation", lastMessage: "Start chatting...", timestamp: new Date() },
  ]);
  const [activeConversation, setActiveConversation] = useState("1");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const currentWorkflowIdRef = useRef<string | null>(null);
  const processingMessageIdRef = useRef<string | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    const url = `${COORD_URL}/v1/events/stream`;
    const es = new EventSource(url);

    const updateStatus = (text: string) => {
      const id = processingMessageIdRef.current;
      if (!id) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, content: text } : m))
      );
    };

    const makeHandler = (eventName: string) => (ev: MessageEvent) => {
      const activeWorkflow = currentWorkflowIdRef.current;
      if (!activeWorkflow) return;
      try {
        const data = JSON.parse(ev.data);
        const wfId = data.workflowId || data.taskId;
        if (wfId !== activeWorkflow) return;
        const node = data.nodeId || data.nodeName || "";
        if (eventName === "NODE_DISPATCHED") {
          updateStatus(`🚀 Running ${node || "workflow"}...`);
        } else if (eventName === "NODE_SUCCESS") {
          updateStatus(`✅ Node ${node} completed`);
        } else if (eventName === "NODE_FAILED") {
          updateStatus(`⚠️ Node ${node} failed`);
        }
      } catch {
        // ignore malformed events
      }
    };

    es.addEventListener("NODE_DISPATCHED", makeHandler("NODE_DISPATCHED"));
    es.addEventListener("NODE_SUCCESS", makeHandler("NODE_SUCCESS"));
    es.addEventListener("NODE_FAILED", makeHandler("NODE_FAILED"));

    return () => {
      es.close();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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

    // Add processing message
    const processingId = (Date.now() + 1).toString();
    setMessages((prev) => [
      ...prev,
      {
        id: processingId,
        role: "system",
        content: "Finding the best agent for your request...",
        timestamp: new Date(),
        status: "processing",
      },
    ]);
    processingMessageIdRef.current = processingId;

    try {
      // Step 1: Update status - analyzing request
      setMessages((prev) => 
        prev.map((m) => 
          m.id === processingId 
            ? { ...m, content: "🔍 Analyzing your request..." }
            : m
        )
      );
      
      // Step 2: Search for relevant agents based on intent
      const discoverRes = await fetch(
        `${COORD_URL}/v1/discover?q=${encodeURIComponent(userMessage.content)}&limit=10`,
        {
          headers: { "x-api-key": "playground-free-tier" },
        }
      );
      
      let availableAgents: any[] = [];
      if (discoverRes.ok) {
        const discoverData = await discoverRes.json();
        availableAgents = discoverData.results || [];
      }
      
      // Step 3: Update status - found agents
      setMessages((prev) => 
        prev.map((m) => 
          m.id === processingId 
            ? { ...m, content: "🤖 Processing..." }
            : m
        )
      );
      
      // Step 4: Ask coordinator to suggest a workflow based on this request
      const suggestRes = await fetch(`${COORD_URL}/v1/workflows/suggest`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "playground-free-tier",
        },
        body: JSON.stringify({
          intent: userMessage.content,
          description: userMessage.content,
          maxCents: 50,
        }),
      });

      if (!suggestRes.ok) {
        const errorText = await suggestRes.text();
        console.error("Workflow suggest failed:", suggestRes.status, errorText);
        throw new Error(`Suggest API error: ${suggestRes.status}`);
      }

      const suggestData = await suggestRes.json();
      const draft = suggestData.draft;

      if (!draft || !draft.nodes || Object.keys(draft.nodes).length === 0) {
        throw new Error("No workflow draft returned");
      }

      // Step 5: Publish the suggested workflow so the dispatcher can execute agents
      const publishRes = await fetch(`${COORD_URL}/v1/workflows/publish`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "x-api-key": "playground-free-tier",
        },
        body: JSON.stringify({
          intent: draft.intent || userMessage.content,
          payerDid: "did:noot:playground",
          maxCents: typeof draft.maxCents === "number" ? draft.maxCents : 50,
          nodes: draft.nodes,
        }),
      });

      if (!publishRes.ok) {
        const errorText = await publishRes.text();
        console.error("Workflow publish failed:", publishRes.status, errorText);
        let parsed: any = null;
        try {
          parsed = JSON.parse(errorText);
        } catch {
          // non-JSON error; fall back to generic path below
        }
        if (parsed && parsed.error === "quota_exceeded") {
          const kind = parsed.kind as string | undefined;
          let human = "Project quota exceeded. Please try again later or upgrade your plan.";
          if (kind === "workflows_per_day") {
            human = `Daily workflow limit reached (${parsed.used}/${parsed.limit}). Try again tomorrow or increase your quota.`;
          } else if (kind === "concurrent_workflows") {
            human = `Too many workflows running at once (${parsed.used}/${parsed.limit}). Wait for some to finish, then retry.`;
          } else if (kind === "max_spend_per_workflow") {
            human = `Requested workflow budget (${parsed.requested}¢) exceeds the maximum allowed per workflow (${parsed.limit}¢). Reduce the budget or upgrade your plan.`;
          }
          // Replace processing message with a clear quota explanation
          setMessages((prev) => prev.filter((m) => m.id !== processingId));
          setMessages((prev) => [
            ...prev,
            {
              id: Date.now().toString(),
              role: "system",
              content: human,
              timestamp: new Date(),
              status: "error",
            },
          ]);
          return;
        }
        throw new Error(`Publish API error: ${publishRes.status}`);
      }

      const data = await publishRes.json();
      const workflowId = data.workflowId;

      if (!workflowId) {
        throw new Error("No workflow ID returned");
      }
      currentWorkflowIdRef.current = workflowId;

      // Poll for result
      let result = null;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const statusRes = await fetch(`${COORD_URL}/v1/workflows/${workflowId}`, {
          headers: { "x-api-key": "playground-free-tier" },
        });
        
        if (!statusRes.ok) continue;
        
        const status = await statusRes.json();
        const nodes: any[] = status.nodes || [];
        if (nodes.length === 0) continue;

        // Choose a "terminal" node (no other node depends on it) as the primary result
        const dependents = new Set<string>();
        for (const n of nodes) {
          const deps: string[] = n.depends_on || [];
          for (const d of deps) {
            dependents.add(d);
          }
        }
        const terminalNodes = nodes.filter((n) => !dependents.has(n.name));
        const primaryNode = terminalNodes[0] || nodes[0];

        if (primaryNode.status === "success") {
          result = primaryNode.result_payload;
          break;
        } else if (primaryNode.status === "failed" || primaryNode.status === "failed_timeout") {
          throw new Error("Workflow failed to process request");
        }
      }

      // Remove processing message and add response
      setMessages((prev) => prev.filter((m) => m.id !== processingId));

      const responseText =
        result?.response ||
        result?.output ||
        result?.result ||
        result?.text ||
        (typeof result === "string" ? result : null);
      
      if (responseText) {
        // Determine agent name from workflow status (preferred) or default
        let agentLabel = "Nooterra";
        try {
          const statusRes = await fetch(`${COORD_URL}/v1/workflows/${workflowId}`, {
            headers: { "x-api-key": "playground-free-tier" },
          });
          if (statusRes.ok) {
            const status = await statusRes.json();
            const nodes: any[] = status.nodes || [];
            if (nodes.length > 0) {
              const dependents = new Set<string>();
              for (const n of nodes) {
                const deps: string[] = n.depends_on || [];
                for (const d of deps) dependents.add(d);
              }
              const terminalNodes = nodes.filter((n) => !dependents.has(n.name));
              const primaryNode = terminalNodes[0] || nodes[0];
              if (primaryNode.agent_did) {
                agentLabel = primaryNode.agent_did.split(":").pop() || agentLabel;
              }
            }
          }
        } catch {
          if (availableAgents.length > 0) {
            agentLabel = availableAgents[0].did.split(":").pop() || agentLabel;
          }
        }
        
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now().toString(),
            role: "assistant",
            content: typeof responseText === 'string' ? responseText : JSON.stringify(responseText, null, 2),
            timestamp: new Date(),
            agentName: `Orchestrator → ${agentLabel}`,
            status: "complete",
          },
        ]);
        
        // Update conversation title based on first message
        if (messages.length === 0) {
          const title = userMessage.content.slice(0, 30) + (userMessage.content.length > 30 ? "..." : "");
          setConversations((prev) =>
            prev.map((c) =>
              c.id === activeConversation
                ? { ...c, title, lastMessage: responseText.slice(0, 50) }
                : c
            )
          );
        }
      } else {
        throw new Error("No response received from agent");
      }
    } catch (error) {
      setMessages((prev) => prev.filter((m) => m.id !== processingId));
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "system",
          content: "Sorry, I couldn't process your request. Please try again.",
          timestamp: new Date(),
          status: "error",
        },
      ]);
    } finally {
      currentWorkflowIdRef.current = null;
      processingMessageIdRef.current = null;
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const startNewConversation = () => {
    const newId = Date.now().toString();
    setConversations((prev) => [
      { id: newId, title: "New conversation", lastMessage: "Start chatting...", timestamp: new Date() },
      ...prev,
    ]);
    setActiveConversation(newId);
    setMessages([]);
  };

  return (
    <div className="h-screen bg-black flex overflow-hidden">
      {/* Sidebar */}
      <AnimatePresence mode="wait">
        {sidebarOpen && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 280, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="h-full border-r border-white/10 bg-neutral-950 flex flex-col"
          >
            {/* Sidebar Header */}
            <div className="p-4 border-b border-white/10">
              <Link to="/" className="flex items-center gap-2 text-white mb-4">
                <ArrowLeft className="w-4 h-4" />
                <span className="text-sm">Back to Home</span>
              </Link>
              <button
                onClick={startNewConversation}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white text-sm font-medium transition-colors"
              >
                <Plus className="w-4 h-4" />
                New Chat
              </button>
            </div>

            {/* Conversations List */}
            <div className="flex-1 overflow-y-auto p-2">
              {conversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => setActiveConversation(conv.id)}
                  className={`w-full text-left p-3 rounded-lg mb-1 transition-colors ${
                    activeConversation === conv.id
                      ? "bg-white/10 text-white"
                      : "text-neutral-400 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 flex-shrink-0" />
                    <span className="text-sm truncate">{conv.title}</span>
                  </div>
                </button>
              ))}
            </div>

            {/* Sidebar Footer */}
            <div className="p-4 border-t border-white/10">
              <div className="flex items-center gap-2 text-xs text-neutral-500">
                <Zap className="w-3 h-3 text-emerald-500" />
                <span>Free tier active</span>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-14 border-b border-white/10 bg-neutral-950/50 backdrop-blur-xl flex items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 rounded-lg hover:bg-white/10 text-neutral-400 hover:text-white transition-colors"
            >
              <ChevronRight className={`w-5 h-5 transition-transform ${sidebarOpen ? "rotate-180" : ""}`} />
            </button>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-violet-500 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <div>
                <h1 className="text-sm font-medium text-white">Nooterra Playground</h1>
                <p className="text-xs text-neutral-500">Multi-agent AI coordination</p>
              </div>
            </div>
          </div>
          <Link
            to="/signup"
            className="px-4 py-2 rounded-lg bg-white text-black text-sm font-medium hover:bg-neutral-200 transition-colors"
          >
            Upgrade
          </Link>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center p-8">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-violet-500/20 border border-white/10 flex items-center justify-center mb-6">
                <Sparkles className="w-8 h-8 text-cyan-400" />
              </div>
              <h2 className="text-2xl font-semibold text-white mb-2">How can I help you?</h2>
              <p className="text-neutral-400 text-center max-w-md mb-8">
                Ask me anything and I'll coordinate the right AI agents to help you.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg w-full">
                {[
                  "Explain quantum computing simply",
                  "Write a haiku about technology",
                  "Summarize the key AI trends in 2024",
                  "Help me brainstorm startup ideas",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => setInput(suggestion)}
                    className="p-4 rounded-xl bg-white/5 border border-white/10 text-left text-sm text-neutral-300 hover:bg-white/10 hover:border-white/20 transition-all"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto p-4">
              {messages.map((message) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`mb-6 ${message.role === "user" ? "flex justify-end" : ""}`}
                >
                  {message.role === "user" ? (
                    <div className="max-w-[80%] bg-cyan-500/20 border border-cyan-500/30 rounded-2xl rounded-tr-sm px-4 py-3">
                      <p className="text-white">{message.content}</p>
                    </div>
                  ) : message.role === "assistant" ? (
                    <div className="flex gap-3">
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center flex-shrink-0">
                        <Bot className="w-4 h-4 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        {message.agentName && (
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-medium text-violet-400">{message.agentName}</span>
                            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                          </div>
                        )}
                        <div className="bg-white/5 border border-white/10 rounded-2xl rounded-tl-sm px-4 py-3">
                          <p className="text-neutral-200 whitespace-pre-wrap">{message.content}</p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-neutral-500">
                      {message.status === "processing" && (
                        <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                      )}
                      {message.status === "error" && (
                        <AlertCircle className="w-4 h-4 text-red-400" />
                      )}
                      <span>{message.content}</span>
                    </div>
                  )}
                </motion.div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-white/10 bg-neutral-950/50 backdrop-blur-xl p-4">
          <form onSubmit={handleSubmit} className="max-w-3xl mx-auto">
            <div className="relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Message Nooterra..."
                rows={1}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 pr-12 text-white placeholder-neutral-500 resize-none focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition-all"
                style={{ minHeight: "48px", maxHeight: "200px" }}
              />
              <button
                type="submit"
                disabled={!input.trim() || isLoading}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg bg-cyan-500 text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-cyan-400 transition-colors"
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            </div>
            <p className="text-xs text-neutral-500 mt-2 text-center">
              Free tier: Using open-source models • <Link to="/signup" className="text-cyan-400 hover:underline">Upgrade</Link> for premium agents
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
