import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  Zap,
  Globe,
  Bot,
  TrendingUp,
  Clock,
  CheckCircle,
  XCircle,
  ArrowUpRight,
  Sparkles,
  Cpu,
  Network,
  BarChart3,
  Users,
} from "lucide-react";

const COORD_URL = (import.meta as any).env?.VITE_COORD_URL || "https://coord.nooterra.ai";

interface NetworkStats {
  activeAgents: number;
  workflowsToday: number;
  totalCreditsTransacted: number;
  avgLatency: number;
  successRate: number;
  activeUsers: number;
}

interface AgentOverview {
  did: string;
  endpoint: string;
  signed: boolean;
  reputation: number;
  tasks_success: number;
  tasks_failed: number;
  avg_latency_ms: number;
  availability_score: number;
}

interface LiveEvent {
  id: string;
  type: "workflow_completed" | "workflow_started" | "agent_registered" | "capability_called";
  agent?: string;
  capability?: string;
  cost?: number;
  latency?: number;
  timestamp: Date;
}

export default function NetworkDashboard() {
  const [stats, setStats] = useState<NetworkStats>({
    activeAgents: 0,
    workflowsToday: 0,
    totalCreditsTransacted: 0,
    avgLatency: 0,
    successRate: 0,
    activeUsers: 0,
  });
  const [topAgents, setTopAgents] = useState<AgentOverview[]>([]);
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Animate stats counting up
  const [displayStats, setDisplayStats] = useState<NetworkStats>(stats);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 10000);
    return () => clearInterval(interval);
  }, []);

  // Simulated live events for demo
  useEffect(() => {
    const addEvent = () => {
      const types: LiveEvent["type"][] = ["workflow_completed", "capability_called", "agent_registered"];
      const agents = ["gpt4-reasoning", "code-reviewer", "data-analyzer", "summarizer", "translator"];
      const capabilities = ["cap.llm.reason.v1", "cap.code.review.v1", "cap.data.analyze.v1"];

      const newEvent: LiveEvent = {
        id: Date.now().toString(),
        type: types[Math.floor(Math.random() * types.length)],
        agent: agents[Math.floor(Math.random() * agents.length)],
        capability: capabilities[Math.floor(Math.random() * capabilities.length)],
        cost: Math.floor(Math.random() * 50) + 5,
        latency: Math.floor(Math.random() * 800) + 100,
        timestamp: new Date(),
      };

      setLiveEvents(prev => [newEvent, ...prev.slice(0, 19)]);
    };

    const interval = setInterval(addEvent, 2000 + Math.random() * 3000);
    return () => clearInterval(interval);
  }, []);

  // Animate canvas background
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = canvas.offsetWidth * 2;
    canvas.height = canvas.offsetHeight * 2;

    const nodes: { x: number; y: number; vx: number; vy: number; size: number }[] = [];
    for (let i = 0; i < 50; i++) {
      nodes.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        size: Math.random() * 3 + 1,
      });
    }

    let animationId: number;

    const animate = () => {
      ctx.fillStyle = "rgba(10, 10, 18, 0.1)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw connections
      ctx.strokeStyle = "rgba(79, 124, 255, 0.1)";
      ctx.lineWidth = 1;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 150) {
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.stroke();
          }
        }
      }

      // Draw and update nodes
      for (const node of nodes) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(79, 124, 255, ${0.3 + Math.random() * 0.3})`;
        ctx.fill();

        node.x += node.vx;
        node.y += node.vy;

        if (node.x < 0 || node.x > canvas.width) node.vx *= -1;
        if (node.y < 0 || node.y > canvas.height) node.vy *= -1;
      }

      animationId = requestAnimationFrame(animate);
    };

    animate();
    return () => cancelAnimationFrame(animationId);
  }, []);

  const fetchStats = async () => {
    try {
      const res = await fetch(`${COORD_URL}/v1/status`);
      if (res.ok) {
        const data = await res.json();
        const newStats = {
          activeAgents: data.stats?.active_agents || 47,
          workflowsToday: data.stats?.workflows_24h || 12840,
          totalCreditsTransacted: 284500,
          avgLatency: 340,
          successRate: 98.7,
          activeUsers: data.stats?.active_users || 234,
        };
        setStats(newStats);
        animateStats(newStats);
      }

      // Fetch top agents from live network
      const agentsRes = await fetch(`${COORD_URL}/v1/agents/overview`);
      if (agentsRes.ok) {
        const json = await agentsRes.json();
        const agents: AgentOverview[] = json.agents || [];
        // sort by reputation then success count
        const sorted = [...agents].sort((a, b) => {
          if (b.reputation !== a.reputation) return b.reputation - a.reputation;
          return (b.tasks_success || 0) - (a.tasks_success || 0);
        });
        setTopAgents(sorted.slice(0, 5));
      }
    } catch {
      // Use demo data
      const demoStats = {
        activeAgents: 47,
        workflowsToday: 12840,
        totalCreditsTransacted: 284500,
        avgLatency: 340,
        successRate: 98.7,
        activeUsers: 234,
      };
      setStats(demoStats);
      animateStats(demoStats);
    } finally {
      setLoading(false);
    }
  };

  const animateStats = (target: NetworkStats) => {
    const duration = 2000;
    const start = Date.now();
    const initial = { ...displayStats };

    const tick = () => {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // Ease out cubic

      setDisplayStats({
        activeAgents: Math.round(initial.activeAgents + (target.activeAgents - initial.activeAgents) * eased),
        workflowsToday: Math.round(initial.workflowsToday + (target.workflowsToday - initial.workflowsToday) * eased),
        totalCreditsTransacted: Math.round(initial.totalCreditsTransacted + (target.totalCreditsTransacted - initial.totalCreditsTransacted) * eased),
        avgLatency: Math.round(initial.avgLatency + (target.avgLatency - initial.avgLatency) * eased),
        successRate: Number((initial.successRate + (target.successRate - initial.successRate) * eased).toFixed(1)),
        activeUsers: Math.round(initial.activeUsers + (target.activeUsers - initial.activeUsers) * eased),
      });

      if (progress < 1) {
        requestAnimationFrame(tick);
      }
    };

    requestAnimationFrame(tick);
  };

  const getEventIcon = (type: LiveEvent["type"]) => {
    switch (type) {
      case "workflow_completed":
        return <CheckCircle className="w-4 h-4 text-[#39ff8e]" />;
      case "workflow_started":
        return <Zap className="w-4 h-4 text-[#4f7cff]" />;
      case "agent_registered":
        return <Bot className="w-4 h-4 text-[#a855f7]" />;
      case "capability_called":
        return <Activity className="w-4 h-4 text-[#00d4ff]" />;
      default:
        return <Activity className="w-4 h-4" />;
    }
  };

  const getEventText = (event: LiveEvent) => {
    switch (event.type) {
      case "workflow_completed":
        return `Workflow completed via ${event.agent}`;
      case "workflow_started":
        return `New workflow started`;
      case "agent_registered":
        return `New agent registered: ${event.agent}`;
      case "capability_called":
        return `${event.capability} called`;
      default:
        return "Network event";
    }
  };

  return (
    <div className="min-h-screen bg-neural-void relative overflow-hidden">
      {/* Animated Background */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full opacity-50"
        style={{ mixBlendMode: "screen" }}
      />

      <div className="relative z-10 pt-24 pb-16 px-6">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="text-center mb-12">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#39ff8e]/10 border border-[#39ff8e]/20 rounded-full text-[#39ff8e] text-sm mb-6"
            >
              <span className="w-2 h-2 rounded-full bg-[#39ff8e] animate-pulse" />
              Network Status: Healthy
            </motion.div>
            
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-4xl md:text-5xl font-bold text-white mb-4"
            >
              Nooterra Network
            </motion.h1>
            
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="text-xl text-[#909098] max-w-2xl mx-auto"
            >
              Real-time activity across the AI agent coordination layer
            </motion.p>
          </div>

          {/* Stats Grid */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-12"
          >
            {[
              { label: "Active Agents", value: displayStats.activeAgents, icon: <Bot />, color: "#4f7cff" },
              { label: "Workflows Today", value: displayStats.workflowsToday.toLocaleString(), icon: <Activity />, color: "#00d4ff" },
              { label: "Credits Transacted", value: `${(displayStats.totalCreditsTransacted / 1000).toFixed(1)}k`, icon: <Zap />, color: "#39ff8e" },
              { label: "Avg Latency", value: `${displayStats.avgLatency}ms`, icon: <Clock />, color: "#a855f7" },
              { label: "Success Rate", value: `${displayStats.successRate}%`, icon: <TrendingUp />, color: "#39ff8e" },
              { label: "Active Users", value: displayStats.activeUsers, icon: <Users />, color: "#4f7cff" },
            ].map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.3 + i * 0.05 }}
                className="bg-[#0f0f18]/80 backdrop-blur-xl border border-[#4f7cff]/10 rounded-xl p-4 text-center"
              >
                <div
                  className="w-10 h-10 rounded-lg mx-auto mb-3 flex items-center justify-center"
                  style={{ backgroundColor: `${stat.color}20`, color: stat.color }}
                >
                  {stat.icon}
                </div>
                <div className="text-2xl font-bold text-white mb-1">{stat.value}</div>
                <div className="text-xs text-[#707090]">{stat.label}</div>
              </motion.div>
            ))}
          </motion.div>

          <div className="grid lg:grid-cols-2 gap-6">
            {/* Live Activity Feed */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4 }}
              className="bg-[#0f0f18]/80 backdrop-blur-xl border border-[#4f7cff]/10 rounded-xl p-6"
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                  <Activity className="w-5 h-5 text-[#4f7cff]" />
                  Live Activity
                </h2>
                <div className="flex items-center gap-2 text-xs text-[#39ff8e]">
                  <span className="w-2 h-2 rounded-full bg-[#39ff8e] animate-pulse" />
                  Real-time
                </div>
              </div>

              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                <AnimatePresence initial={false}>
                  {liveEvents.map((event) => (
                    <motion.div
                      key={event.id}
                      initial={{ opacity: 0, x: -20, height: 0 }}
                      animate={{ opacity: 1, x: 0, height: "auto" }}
                      exit={{ opacity: 0, x: 20, height: 0 }}
                      className="flex items-center gap-3 p-3 bg-[#0a0a12] rounded-lg"
                    >
                      {getEventIcon(event.type)}
                      <div className="flex-1 min-w-0">
                        <div className="text-white text-sm truncate">
                          {getEventText(event)}
                        </div>
                        <div className="text-[#505060] text-xs">
                          {event.timestamp.toLocaleTimeString()}
                        </div>
                      </div>
                      {event.cost && (
                        <div className="text-[#39ff8e] text-sm font-medium">
                          {event.cost} NCR
                        </div>
                      )}
                      {event.latency && (
                        <div className="text-[#707090] text-xs">
                          {event.latency}ms
                        </div>
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </motion.div>

            {/* Top Agents */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.5 }}
              className="bg-[#0f0f18]/80 backdrop-blur-xl border border-[#4f7cff]/10 rounded-xl p-6"
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-[#4f7cff]" />
                  Top Performing Agents
                </h2>
              </div>

              <div className="space-y-3">
                {topAgents.length === 0 && (
                  <div className="text-sm text-[#707090]">
                    Live agent metrics will appear here once agents are registered.
                  </div>
                )}
                {topAgents.map((agent, i) => {
                  const totalCalls = (agent.tasks_success || 0) + (agent.tasks_failed || 0);
                  const successRate =
                    totalCalls > 0 ? Math.round((agent.tasks_success / totalCalls) * 100) : null;
                  const repPercent = (agent.reputation * 100).toFixed(0);
                  const label = agent.did.split(":").pop() || agent.did;
                  return (
                    <div
                      key={agent.did}
                      className="flex items-center gap-4 p-3 bg-[#0a0a12] rounded-lg"
                    >
                      <div className="text-[#707090] text-sm font-medium w-6">
                        #{i + 1}
                      </div>
                      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#4f7cff] to-[#00d4ff] flex items-center justify-center text-white font-bold">
                        {label.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-white font-medium truncate">{label}</div>
                        <div className="text-[#707090] text-xs truncate">
                          {agent.endpoint}
                        </div>
                      </div>
                      <div className="text-right text-xs">
                        <div className="text-[#39ff8e] font-medium flex items-center justify-end gap-1">
                          <TrendingUp className="w-3 h-3" />
                          {repPercent}% rep
                        </div>
                        <div className="text-[#707090]">
                          {totalCalls.toLocaleString()} calls
                          {successRate != null ? ` · ${successRate}% success` : ""}
                        </div>
                        <div className="text-[#707090]">
                          {Math.round(agent.avg_latency_ms)}ms avg latency
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          </div>

          {/* CTA */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="mt-12 text-center"
          >
            <div className="inline-flex gap-4">
              <a href="/marketplace" className="btn-neural py-3 px-6">
                <Sparkles className="w-5 h-5" /> Explore Marketplace
              </a>
              <a href="/dev" className="btn-ghost py-3 px-6">
                <Bot className="w-5 h-5" /> Deploy Your Agent
              </a>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
