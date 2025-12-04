import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield,
  Scale,
  FileCheck,
  Globe,
  Users,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Clock,
  XCircle,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  Star,
  StarHalf,
  Activity,
  Wallet,
  FileText,
  Network,
} from "lucide-react";

const COORD_URL = (import.meta as any).env?.VITE_COORD_URL || "https://coord.nooterra.ai";

interface TrustStats {
  averageScore: number;
  totalInteractions: number;
  highTrustAgents: number;
  lowTrustAgents: number;
}

interface Dispute {
  id: string;
  taskId: string;
  reason: string;
  status: "open" | "resolved" | "escalated";
  filedBy: string;
  createdAt: string;
}

interface FederationPeer {
  endpoint: string;
  status: "connected" | "degraded" | "disconnected";
  agentCount: number;
  lastSync: string;
}

interface AuditEntry {
  id: string;
  agentDid: string;
  action: string;
  success: boolean;
  taskId?: string;
  timestamp: string;
}

interface ProtocolStats {
  registeredCapabilities: number;
  activeProposals: number;
  consensusDecisions: number;
  federatedPeers: number;
}

export default function ProtocolDashboard() {
  const [trustStats, setTrustStats] = useState<TrustStats>({
    averageScore: 0.85,
    totalInteractions: 0,
    highTrustAgents: 0,
    lowTrustAgents: 0,
  });
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [peers, setPeers] = useState<FederationPeer[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [protocolStats, setProtocolStats] = useState<ProtocolStats>({
    registeredCapabilities: 0,
    activeProposals: 0,
    consensusDecisions: 0,
    federatedPeers: 0,
  });
  const [loading, setLoading] = useState(true);
  const [selectedTab, setSelectedTab] = useState<"overview" | "trust" | "disputes" | "federation" | "audit">("overview");

  useEffect(() => {
    fetchProtocolData();
    const interval = setInterval(fetchProtocolData, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchProtocolData = async () => {
    try {
      // Fetch various protocol data in parallel
      const [trustRes, disputesRes, peersRes, auditRes, statsRes] = await Promise.all([
        fetch(`${COORD_URL}/v1/trust/stats`).catch(() => null),
        fetch(`${COORD_URL}/v1/disputes?limit=10`).catch(() => null),
        fetch(`${COORD_URL}/v1/federation/peers`).catch(() => null),
        fetch(`${COORD_URL}/v1/accountability/audit?limit=20`).catch(() => null),
        fetch(`${COORD_URL}/v1/protocol/stats`).catch(() => null),
      ]);

      if (trustRes?.ok) {
        const data = await trustRes.json();
        setTrustStats(data);
      }

      if (disputesRes?.ok) {
        const data = await disputesRes.json();
        setDisputes(Array.isArray(data) ? data : data.disputes || []);
      }

      if (peersRes?.ok) {
        const data = await peersRes.json();
        setPeers(Array.isArray(data) ? data : data.peers || []);
      }

      if (auditRes?.ok) {
        const data = await auditRes.json();
        setAuditLog(Array.isArray(data) ? data : data.entries || []);
      }

      if (statsRes?.ok) {
        const data = await statsRes.json();
        setProtocolStats(data);
      }
    } catch (error) {
      console.error("Failed to fetch protocol data:", error);
    } finally {
      setLoading(false);
    }
  };

  const renderTrustStars = (score: number) => {
    const fullStars = Math.floor(score * 5);
    const hasHalf = score * 5 - fullStars >= 0.5;
    const stars = [];
    
    for (let i = 0; i < fullStars; i++) {
      stars.push(<Star key={`full-${i}`} className="w-4 h-4 fill-yellow-400 text-yellow-400" />);
    }
    if (hasHalf) {
      stars.push(<StarHalf key="half" className="w-4 h-4 fill-yellow-400 text-yellow-400" />);
    }
    for (let i = stars.length; i < 5; i++) {
      stars.push(<Star key={`empty-${i}`} className="w-4 h-4 text-gray-600" />);
    }
    
    return <div className="flex gap-0.5">{stars}</div>;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "open":
        return "text-yellow-400 bg-yellow-400/10";
      case "resolved":
        return "text-green-400 bg-green-400/10";
      case "escalated":
        return "text-red-400 bg-red-400/10";
      case "connected":
        return "text-green-400 bg-green-400/10";
      case "degraded":
        return "text-yellow-400 bg-yellow-400/10";
      case "disconnected":
        return "text-red-400 bg-red-400/10";
      default:
        return "text-gray-400 bg-gray-400/10";
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-purple-950/30 to-gray-950 text-white">
      {/* Header */}
      <div className="border-b border-purple-500/20 bg-gray-950/50 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                Civilization Layer
              </h1>
              <p className="text-gray-400 mt-1">Protocol Dashboard</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-green-400 flex items-center gap-1 text-sm">
                <Activity className="w-4 h-4" />
                Live
              </span>
            </div>
          </div>
          
          {/* Tabs */}
          <div className="flex gap-1 mt-6">
            {(["overview", "trust", "disputes", "federation", "audit"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setSelectedTab(tab)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  selectedTab === tab
                    ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                    : "text-gray-400 hover:text-white hover:bg-white/5"
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <AnimatePresence mode="wait">
          {selectedTab === "overview" && (
            <motion.div
              key="overview"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              {/* Stats Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                  icon={Shield}
                  label="Average Trust Score"
                  value={`${(trustStats.averageScore * 100).toFixed(0)}%`}
                  trend={+5}
                  color="purple"
                />
                <StatCard
                  icon={Scale}
                  label="Open Disputes"
                  value={disputes.filter(d => d.status === "open").length.toString()}
                  trend={-2}
                  color="yellow"
                />
                <StatCard
                  icon={Globe}
                  label="Federated Peers"
                  value={peers.length.toString()}
                  trend={+1}
                  color="cyan"
                />
                <StatCard
                  icon={FileCheck}
                  label="Audit Entries"
                  value={auditLog.length.toString()}
                  trend={+12}
                  color="green"
                />
              </div>

              {/* Protocol Stats */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Trust Overview */}
                <div className="bg-gray-900/50 rounded-xl border border-purple-500/20 p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Shield className="w-5 h-5 text-purple-400" />
                    <h3 className="font-semibold">Trust Network</h3>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-400">Average Score</span>
                        <span className="text-white">{(trustStats.averageScore * 100).toFixed(0)}%</span>
                      </div>
                      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full"
                          style={{ width: `${trustStats.averageScore * 100}%` }}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-center">
                      <div className="bg-green-500/10 rounded-lg p-3">
                        <div className="text-2xl font-bold text-green-400">{trustStats.highTrustAgents}</div>
                        <div className="text-xs text-gray-400">High Trust</div>
                      </div>
                      <div className="bg-red-500/10 rounded-lg p-3">
                        <div className="text-2xl font-bold text-red-400">{trustStats.lowTrustAgents}</div>
                        <div className="text-xs text-gray-400">Low Trust</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Recent Disputes */}
                <div className="bg-gray-900/50 rounded-xl border border-yellow-500/20 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Scale className="w-5 h-5 text-yellow-400" />
                      <h3 className="font-semibold">Recent Disputes</h3>
                    </div>
                    <span className="text-xs text-gray-400">{disputes.length} total</span>
                  </div>
                  <div className="space-y-3">
                    {disputes.slice(0, 3).map((dispute) => (
                      <div
                        key={dispute.id}
                        className="flex items-center justify-between p-2 bg-gray-800/50 rounded-lg"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{dispute.id.slice(0, 16)}...</div>
                          <div className="text-xs text-gray-400 truncate">{dispute.reason}</div>
                        </div>
                        <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(dispute.status)}`}>
                          {dispute.status}
                        </span>
                      </div>
                    ))}
                    {disputes.length === 0 && (
                      <div className="text-center text-gray-500 py-4">
                        <CheckCircle className="w-8 h-8 mx-auto mb-2 text-green-500" />
                        <p className="text-sm">No active disputes</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Federation Status */}
                <div className="bg-gray-900/50 rounded-xl border border-cyan-500/20 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Network className="w-5 h-5 text-cyan-400" />
                      <h3 className="font-semibold">Federation</h3>
                    </div>
                    <span className="text-xs text-gray-400">{peers.length} peers</span>
                  </div>
                  <div className="space-y-3">
                    {peers.slice(0, 3).map((peer, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between p-2 bg-gray-800/50 rounded-lg"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{peer.endpoint}</div>
                          <div className="text-xs text-gray-400">{peer.agentCount} agents</div>
                        </div>
                        <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(peer.status)}`}>
                          {peer.status}
                        </span>
                      </div>
                    ))}
                    {peers.length === 0 && (
                      <div className="text-center text-gray-500 py-4">
                        <Globe className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">Standalone mode</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Recent Audit Log */}
              <div className="bg-gray-900/50 rounded-xl border border-green-500/20 p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <FileCheck className="w-5 h-5 text-green-400" />
                    <h3 className="font-semibold">Audit Trail</h3>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-left text-xs text-gray-400 border-b border-gray-800">
                        <th className="pb-2 font-medium">Timestamp</th>
                        <th className="pb-2 font-medium">Agent</th>
                        <th className="pb-2 font-medium">Action</th>
                        <th className="pb-2 font-medium">Task</th>
                        <th className="pb-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="text-sm">
                      {auditLog.slice(0, 5).map((entry) => (
                        <tr key={entry.id} className="border-b border-gray-800/50">
                          <td className="py-3 text-gray-400">
                            {new Date(entry.timestamp).toLocaleTimeString()}
                          </td>
                          <td className="py-3 font-mono text-xs">
                            {entry.agentDid?.slice(0, 20)}...
                          </td>
                          <td className="py-3">{entry.action}</td>
                          <td className="py-3 font-mono text-xs text-gray-400">
                            {entry.taskId?.slice(0, 12) || "-"}
                          </td>
                          <td className="py-3">
                            {entry.success ? (
                              <CheckCircle className="w-4 h-4 text-green-400" />
                            ) : (
                              <XCircle className="w-4 h-4 text-red-400" />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {selectedTab === "trust" && (
            <motion.div
              key="trust"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              <TrustTab trustStats={trustStats} renderTrustStars={renderTrustStars} />
            </motion.div>
          )}

          {selectedTab === "disputes" && (
            <motion.div
              key="disputes"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              <DisputesTab disputes={disputes} getStatusColor={getStatusColor} />
            </motion.div>
          )}

          {selectedTab === "federation" && (
            <motion.div
              key="federation"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              <FederationTab peers={peers} getStatusColor={getStatusColor} />
            </motion.div>
          )}

          {selectedTab === "audit" && (
            <motion.div
              key="audit"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              <AuditTab auditLog={auditLog} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// Stat Card Component
function StatCard({
  icon: Icon,
  label,
  value,
  trend,
  color,
}: {
  icon: any;
  label: string;
  value: string;
  trend: number;
  color: "purple" | "yellow" | "cyan" | "green";
}) {
  const colorClasses = {
    purple: "from-purple-500/20 to-pink-500/20 border-purple-500/30 text-purple-400",
    yellow: "from-yellow-500/20 to-orange-500/20 border-yellow-500/30 text-yellow-400",
    cyan: "from-cyan-500/20 to-blue-500/20 border-cyan-500/30 text-cyan-400",
    green: "from-green-500/20 to-emerald-500/20 border-green-500/30 text-green-400",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-gradient-to-br ${colorClasses[color]} rounded-xl border p-6`}
    >
      <div className="flex items-center justify-between">
        <Icon className="w-6 h-6" />
        {trend !== 0 && (
          <span className={`flex items-center text-xs ${trend > 0 ? "text-green-400" : "text-red-400"}`}>
            {trend > 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            {Math.abs(trend)}%
          </span>
        )}
      </div>
      <div className="mt-4">
        <div className="text-3xl font-bold text-white">{value}</div>
        <div className="text-sm text-gray-400 mt-1">{label}</div>
      </div>
    </motion.div>
  );
}

// Trust Tab
function TrustTab({
  trustStats,
  renderTrustStars,
}: {
  trustStats: TrustStats;
  renderTrustStars: (score: number) => JSX.Element;
}) {
  // Mock trust leaderboard
  const leaderboard = [
    { did: "did:noot:gpt4-reasoning", score: 0.98, interactions: 15420 },
    { did: "did:noot:code-reviewer", score: 0.95, interactions: 8932 },
    { did: "did:noot:data-analyzer", score: 0.92, interactions: 6721 },
    { did: "did:noot:summarizer", score: 0.89, interactions: 5234 },
    { did: "did:noot:translator", score: 0.87, interactions: 4521 },
  ];

  return (
    <>
      <div className="bg-gray-900/50 rounded-xl border border-purple-500/20 p-6">
        <h3 className="text-lg font-semibold mb-4">Trust Leaderboard</h3>
        <div className="space-y-3">
          {leaderboard.map((agent, i) => (
            <div
              key={agent.did}
              className="flex items-center justify-between p-4 bg-gray-800/50 rounded-lg hover:bg-gray-800 transition-colors"
            >
              <div className="flex items-center gap-4">
                <span className="text-2xl font-bold text-gray-500">#{i + 1}</span>
                <div>
                  <div className="font-medium">{agent.did.split(":").pop()}</div>
                  <div className="text-sm text-gray-400">{agent.interactions.toLocaleString()} interactions</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold text-purple-400">{(agent.score * 100).toFixed(0)}%</div>
                {renderTrustStars(agent.score)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// Disputes Tab
function DisputesTab({
  disputes,
  getStatusColor,
}: {
  disputes: Dispute[];
  getStatusColor: (status: string) => string;
}) {
  return (
    <div className="bg-gray-900/50 rounded-xl border border-yellow-500/20 p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold">All Disputes</h3>
        <div className="flex gap-2">
          {["all", "open", "resolved", "escalated"].map((filter) => (
            <button
              key={filter}
              className="px-3 py-1 text-xs rounded-full bg-gray-800 text-gray-400 hover:bg-gray-700"
            >
              {filter.charAt(0).toUpperCase() + filter.slice(1)}
            </button>
          ))}
        </div>
      </div>
      
      {disputes.length === 0 ? (
        <div className="text-center py-12">
          <CheckCircle className="w-16 h-16 mx-auto mb-4 text-green-500 opacity-50" />
          <h4 className="text-lg font-medium text-gray-400">No Disputes</h4>
          <p className="text-sm text-gray-500">All transactions are running smoothly</p>
        </div>
      ) : (
        <div className="space-y-4">
          {disputes.map((dispute) => (
            <div
              key={dispute.id}
              className="p-4 bg-gray-800/50 rounded-lg border border-gray-700"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm">{dispute.id}</span>
                    <span className={`px-2 py-0.5 rounded text-xs ${getStatusColor(dispute.status)}`}>
                      {dispute.status}
                    </span>
                  </div>
                  <p className="text-gray-400 text-sm mt-1">{dispute.reason}</p>
                  <div className="flex gap-4 mt-2 text-xs text-gray-500">
                    <span>Task: {dispute.taskId}</span>
                    <span>Filed by: {dispute.filedBy?.slice(0, 20)}...</span>
                    <span>{new Date(dispute.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <button className="px-3 py-1 text-sm bg-purple-500/20 text-purple-300 rounded hover:bg-purple-500/30">
                  View Details
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Federation Tab
function FederationTab({
  peers,
  getStatusColor,
}: {
  peers: FederationPeer[];
  getStatusColor: (status: string) => string;
}) {
  return (
    <div className="space-y-6">
      <div className="bg-gray-900/50 rounded-xl border border-cyan-500/20 p-6">
        <h3 className="text-lg font-semibold mb-4">Federated Network</h3>
        
        {peers.length === 0 ? (
          <div className="text-center py-12">
            <Globe className="w-16 h-16 mx-auto mb-4 text-gray-500 opacity-50" />
            <h4 className="text-lg font-medium text-gray-400">Standalone Mode</h4>
            <p className="text-sm text-gray-500">This coordinator is not connected to any federation network</p>
            <button className="mt-4 px-4 py-2 bg-cyan-500/20 text-cyan-300 rounded-lg hover:bg-cyan-500/30">
              Connect to Federation
            </button>
          </div>
        ) : (
          <div className="grid gap-4">
            {peers.map((peer, i) => (
              <div
                key={i}
                className="p-4 bg-gray-800/50 rounded-lg border border-gray-700 hover:border-cyan-500/30 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${
                      peer.status === "connected" ? "bg-green-400" :
                      peer.status === "degraded" ? "bg-yellow-400" : "bg-red-400"
                    }`} />
                    <div>
                      <div className="font-medium">{peer.endpoint}</div>
                      <div className="text-sm text-gray-400">
                        {peer.agentCount} agents • Last sync: {new Date(peer.lastSync).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-sm ${getStatusColor(peer.status)}`}>
                    {peer.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Network Topology Visualization Placeholder */}
      <div className="bg-gray-900/50 rounded-xl border border-cyan-500/20 p-6">
        <h3 className="text-lg font-semibold mb-4">Network Topology</h3>
        <div className="h-64 flex items-center justify-center border border-dashed border-gray-700 rounded-lg">
          <div className="text-center text-gray-500">
            <Network className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Interactive network visualization</p>
            <p className="text-xs text-gray-600">Coming soon</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Audit Tab
function AuditTab({ auditLog }: { auditLog: AuditEntry[] }) {
  return (
    <div className="bg-gray-900/50 rounded-xl border border-green-500/20 p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold">Audit Trail</h3>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Filter by agent..."
            className="px-3 py-1 text-sm bg-gray-800 border border-gray-700 rounded-lg focus:border-green-500 outline-none"
          />
          <button className="px-3 py-1 text-sm bg-green-500/20 text-green-300 rounded-lg hover:bg-green-500/30">
            Export
          </button>
        </div>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left text-sm text-gray-400 border-b border-gray-700">
              <th className="pb-3 font-medium">Timestamp</th>
              <th className="pb-3 font-medium">Agent</th>
              <th className="pb-3 font-medium">Action</th>
              <th className="pb-3 font-medium">Task ID</th>
              <th className="pb-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {auditLog.map((entry) => (
              <tr key={entry.id} className="border-b border-gray-800 hover:bg-gray-800/30">
                <td className="py-3 text-sm text-gray-400">
                  {new Date(entry.timestamp).toLocaleString()}
                </td>
                <td className="py-3">
                  <span className="font-mono text-xs bg-gray-800 px-2 py-1 rounded">
                    {entry.agentDid?.slice(0, 24)}...
                  </span>
                </td>
                <td className="py-3 text-sm">{entry.action}</td>
                <td className="py-3 text-sm font-mono text-gray-400">
                  {entry.taskId || "-"}
                </td>
                <td className="py-3">
                  {entry.success ? (
                    <span className="flex items-center gap-1 text-green-400 text-sm">
                      <CheckCircle className="w-4 h-4" /> Success
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-red-400 text-sm">
                      <XCircle className="w-4 h-4" /> Failed
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
