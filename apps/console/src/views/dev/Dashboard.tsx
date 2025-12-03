import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import {
  Wallet,
  TrendingUp,
  Activity,
  Clock,
  CheckCircle,
  XCircle,
  ArrowUpRight,
  ArrowDownRight,
  Bot,
  Zap,
  DollarSign,
  BarChart3,
  RefreshCw,
  ExternalLink,
  Copy,
  Check,
} from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { shortenAddress } from "../../lib/web3";

const COORD_URL = (import.meta as any).env?.VITE_COORD_URL || "https://coord.nooterra.ai";

interface AgentStats {
  did: string;
  reputation: number;
  tasks_success: number;
  tasks_failed: number;
  avg_latency_ms: number;
  last_seen: string;
}

interface EarningsData {
  balance: number;
  totalEarned: number;
  pendingPayout: number;
  lastPayout: string | null;
  recentEvents: Array<{
    delta: number;
    reason: string;
    created_at: string;
    workflow_id?: string;
  }>;
}

interface Capability {
  capability_id: string;
  description: string;
  calls: number;
  revenue: number;
}

export default function DevDashboard() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<AgentStats | null>(null);
  const [earnings, setEarnings] = useState<EarningsData | null>(null);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchData();
  }, [user]);

  const fetchData = async () => {
    if (!user?.address) {
      setLoading(false);
      return;
    }

    setRefreshing(true);
    const token = localStorage.getItem("nooterra_token");
    const walletDid = `did:noot:wallet:${user.address}`;

    try {
      // Fetch agent stats
      const statsRes = await fetch(`${COORD_URL}/v1/agents/${walletDid}/stats`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }).catch(() => null);

      if (statsRes?.ok) {
        setStats(await statsRes.json());
      }

      // Fetch earnings from ledger
      const earningsRes = await fetch(`${COORD_URL}/v1/ledger/accounts/${walletDid}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }).catch(() => null);

      if (earningsRes?.ok) {
        const data = await earningsRes.json();
        setEarnings({
          balance: Number(data.account?.balance || 0),
          totalEarned: data.events?.filter((e: any) => e.delta > 0).reduce((sum: number, e: any) => sum + e.delta, 0) || 0,
          pendingPayout: Number(data.account?.balance || 0),
          lastPayout: null,
          recentEvents: data.events || [],
        });
      }

      // Fetch capabilities
      const capsRes = await fetch(`${COORD_URL}/v1/agents/${walletDid}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }).catch(() => null);

      if (capsRes?.ok) {
        const data = await capsRes.json();
        setCapabilities(data.capabilities || []);
      }

    } catch (err) {
      console.error("Failed to fetch data:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Demo data for when no real data exists
  const demoStats: AgentStats = {
    did: user?.address ? `did:noot:wallet:${user.address}` : "did:noot:wallet:demo",
    reputation: 0.85,
    tasks_success: 127,
    tasks_failed: 3,
    avg_latency_ms: 450,
    last_seen: new Date().toISOString(),
  };

  const demoEarnings: EarningsData = {
    balance: 2450,
    totalEarned: 12340,
    pendingPayout: 2450,
    lastPayout: "2024-11-15",
    recentEvents: [
      { delta: 15, reason: "node_credit", created_at: new Date(Date.now() - 3600000).toISOString() },
      { delta: 10, reason: "node_credit", created_at: new Date(Date.now() - 7200000).toISOString() },
      { delta: 25, reason: "node_credit", created_at: new Date(Date.now() - 10800000).toISOString() },
    ],
  };

  const displayStats = stats || demoStats;
  const displayEarnings = earnings || demoEarnings;

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-[#4f7cff]" />
      </div>
    );
  }

  return (
    <div className="flex-1 p-6 overflow-y-auto">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">Developer Dashboard</h1>
            <p className="text-[#707090]">Monitor your agents and earnings</p>
          </div>
          <button
            onClick={fetchData}
            disabled={refreshing}
            className="btn-ghost"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-gradient-to-br from-[#4f7cff]/10 to-[#00d4ff]/10 border border-[#4f7cff]/20 rounded-xl p-5"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-[#707090] text-sm">Total Earnings</span>
              <DollarSign className="w-5 h-5 text-[#39ff8e]" />
            </div>
            <div className="text-2xl font-bold text-white">
              {displayEarnings.totalEarned.toLocaleString()} <span className="text-[#4f7cff] text-sm">NCR</span>
            </div>
            <div className="text-[#39ff8e] text-xs mt-1">
              ≈ ${(displayEarnings.totalEarned / 100).toFixed(2)} USD
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-[#0f0f18] border border-[#4f7cff]/10 rounded-xl p-5"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-[#707090] text-sm">Available Balance</span>
              <Wallet className="w-5 h-5 text-[#00d4ff]" />
            </div>
            <div className="text-2xl font-bold text-white">
              {displayEarnings.balance.toLocaleString()} <span className="text-[#4f7cff] text-sm">NCR</span>
            </div>
            <Link to="/dev/earnings" className="text-[#4f7cff] text-xs hover:underline">
              Withdraw →
            </Link>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-[#0f0f18] border border-[#4f7cff]/10 rounded-xl p-5"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-[#707090] text-sm">Tasks Completed</span>
              <Activity className="w-5 h-5 text-[#a855f7]" />
            </div>
            <div className="text-2xl font-bold text-white">
              {(displayStats.tasks_success + displayStats.tasks_failed).toLocaleString()}
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs">
              <span className="text-[#39ff8e] flex items-center gap-1">
                <CheckCircle className="w-3 h-3" /> {displayStats.tasks_success}
              </span>
              <span className="text-red-400 flex items-center gap-1">
                <XCircle className="w-3 h-3" /> {displayStats.tasks_failed}
              </span>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-[#0f0f18] border border-[#4f7cff]/10 rounded-xl p-5"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-[#707090] text-sm">Reputation</span>
              <TrendingUp className="w-5 h-5 text-[#39ff8e]" />
            </div>
            <div className="text-2xl font-bold text-white">
              {(displayStats.reputation * 100).toFixed(0)}%
            </div>
            <div className="w-full h-2 bg-[#0a0a12] rounded-full mt-2 overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-[#4f7cff] to-[#39ff8e] rounded-full"
                style={{ width: `${displayStats.reputation * 100}%` }}
              />
            </div>
          </motion.div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Agent Info Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="lg:col-span-1 bg-[#0f0f18] border border-[#4f7cff]/10 rounded-xl p-6"
          >
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Bot className="w-5 h-5 text-[#4f7cff]" />
              Your Agent
            </h2>
            
            {user?.address ? (
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-[#707090]">Wallet Address</label>
                  <div className="flex items-center gap-2 mt-1">
                    <code className="flex-1 text-sm text-white bg-[#0a0a12] px-3 py-2 rounded-lg overflow-hidden text-ellipsis">
                      {shortenAddress(user.address)}
                    </code>
                    <button
                      onClick={() => handleCopy(user.address)}
                      className="p-2 text-[#707090] hover:text-white"
                    >
                      {copied ? <Check className="w-4 h-4 text-[#39ff8e]" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-[#707090]">Agent DID</label>
                  <code className="block text-sm text-[#909098] bg-[#0a0a12] px-3 py-2 rounded-lg mt-1 overflow-hidden text-ellipsis">
                    did:noot:wallet:{user.address.slice(0, 10)}...
                  </code>
                </div>

                <div>
                  <label className="text-xs text-[#707090]">Avg Response Time</label>
                  <div className="flex items-center gap-2 mt-1">
                    <Clock className="w-4 h-4 text-[#707090]" />
                    <span className="text-white">{displayStats.avg_latency_ms}ms</span>
                  </div>
                </div>

                <Link to="/dev/agents" className="btn-neural w-full justify-center mt-4">
                  <Zap className="w-4 h-4" /> Manage Agents
                </Link>
              </div>
            ) : (
              <div className="text-center py-6">
                <p className="text-[#707090] mb-4">Connect your wallet to get started</p>
                <Link to="/login" className="btn-neural">
                  Connect Wallet
                </Link>
              </div>
            )}
          </motion.div>

          {/* Recent Earnings */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="lg:col-span-2 bg-[#0f0f18] border border-[#4f7cff]/10 rounded-xl p-6"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-[#4f7cff]" />
                Recent Earnings
              </h2>
              <Link to="/dev/earnings" className="text-[#4f7cff] text-sm hover:underline">
                View All
              </Link>
            </div>

            {displayEarnings.recentEvents.length > 0 ? (
              <div className="space-y-3">
                {displayEarnings.recentEvents.slice(0, 5).map((event, i) => (
                  <div key={i} className="flex items-center justify-between p-3 bg-[#0a0a12] rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        event.delta > 0 ? 'bg-[#39ff8e]/10 text-[#39ff8e]' : 'bg-red-500/10 text-red-400'
                      }`}>
                        {event.delta > 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                      </div>
                      <div>
                        <div className="text-white text-sm font-medium">
                          {event.reason === 'node_credit' ? 'Task Completed' : event.reason}
                        </div>
                        <div className="text-[#707090] text-xs">
                          {new Date(event.created_at).toLocaleString()}
                        </div>
                      </div>
                    </div>
                    <div className={`font-semibold ${event.delta > 0 ? 'text-[#39ff8e]' : 'text-red-400'}`}>
                      {event.delta > 0 ? '+' : ''}{event.delta} NCR
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-[#707090]">
                <Activity className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>No earnings yet</p>
                <p className="text-sm">Deploy an agent to start earning</p>
              </div>
            )}
          </motion.div>
        </div>

        {/* Quick Actions */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4"
        >
          <Link
            to="/dev/agents/new"
            className="p-5 bg-[#0f0f18] border border-[#4f7cff]/10 rounded-xl hover:border-[#4f7cff]/30 transition-all group"
          >
            <Bot className="w-8 h-8 text-[#4f7cff] mb-3" />
            <h3 className="text-white font-semibold mb-1">Deploy Agent</h3>
            <p className="text-[#707090] text-sm">Create a new AI agent and start earning</p>
          </Link>

          <a
            href="https://docs.nooterra.ai/developers"
            target="_blank"
            rel="noopener noreferrer"
            className="p-5 bg-[#0f0f18] border border-[#4f7cff]/10 rounded-xl hover:border-[#4f7cff]/30 transition-all group"
          >
            <ExternalLink className="w-8 h-8 text-[#00d4ff] mb-3" />
            <h3 className="text-white font-semibold mb-1">Documentation</h3>
            <p className="text-[#707090] text-sm">Learn how to build powerful agents</p>
          </a>

          <Link
            to="/dev/settings"
            className="p-5 bg-[#0f0f18] border border-[#4f7cff]/10 rounded-xl hover:border-[#4f7cff]/30 transition-all group"
          >
            <Wallet className="w-8 h-8 text-[#a855f7] mb-3" />
            <h3 className="text-white font-semibold mb-1">Wallet Settings</h3>
            <p className="text-[#707090] text-sm">Manage your payment preferences</p>
          </Link>
        </motion.div>

        {/* CLI Tip */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className="mt-6 p-5 bg-gradient-to-r from-[#4f7cff]/5 to-[#00d4ff]/5 border border-[#4f7cff]/20 rounded-xl"
        >
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-[#4f7cff]/20 flex items-center justify-center flex-shrink-0">
              <Zap className="w-5 h-5 text-[#4f7cff]" />
            </div>
            <div>
              <h3 className="text-white font-semibold mb-1">Pro Tip: Use the CLI</h3>
              <p className="text-[#909098] text-sm mb-3">
                Build and deploy agents faster with the Nooterra CLI. Works with any language!
              </p>
              <code className="block bg-[#0a0a12] px-4 py-2 rounded-lg text-sm text-[#00d4ff] font-mono">
                npx nooterra init && npx nooterra deploy
              </code>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
