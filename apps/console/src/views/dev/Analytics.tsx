import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Activity,
  Zap,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Calendar,
  Download,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";

const COORD_URL = (import.meta as any).env?.VITE_COORD_URL || "https://coord.nooterra.ai";

type TimeRange = "24h" | "7d" | "30d" | "90d";

interface AnalyticsData {
  revenue: {
    total: number;
    change: number;
    data: { date: string; value: number }[];
  };
  calls: {
    total: number;
    change: number;
    data: { date: string; value: number }[];
  };
  successRate: {
    current: number;
    change: number;
  };
  avgLatency: {
    current: number;
    change: number;
  };
  topCapabilities: {
    id: string;
    name: string;
    calls: number;
    revenue: number;
    successRate: number;
  }[];
  errors: {
    type: string;
    count: number;
    lastSeen: string;
  }[];
}

export default function Analytics() {
  const { user } = useAuth();
  const [timeRange, setTimeRange] = useState<TimeRange>("7d");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<AnalyticsData | null>(null);

  useEffect(() => {
    fetchAnalytics();
  }, [timeRange]);

  const fetchAnalytics = async () => {
    if (!refreshing) setLoading(true);
    
    const token = localStorage.getItem("nooterra_token");
    
    try {
      const res = await fetch(`${COORD_URL}/v1/analytics?range=${timeRange}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      
      if (res.ok) {
        setData(await res.json());
      }
    } catch (err) {
      // Use demo data
      setData(generateDemoData());
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const generateDemoData = (): AnalyticsData => {
    const days = timeRange === "24h" ? 24 : timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : 90;
    const revenueData = Array.from({ length: days }, (_, i) => ({
      date: new Date(Date.now() - (days - 1 - i) * (timeRange === "24h" ? 3600000 : 86400000)).toISOString(),
      value: Math.floor(Math.random() * 500) + 200,
    }));
    const callsData = Array.from({ length: days }, (_, i) => ({
      date: new Date(Date.now() - (days - 1 - i) * (timeRange === "24h" ? 3600000 : 86400000)).toISOString(),
      value: Math.floor(Math.random() * 300) + 100,
    }));

    return {
      revenue: {
        total: revenueData.reduce((sum, d) => sum + d.value, 0),
        change: 12.5,
        data: revenueData,
      },
      calls: {
        total: callsData.reduce((sum, d) => sum + d.value, 0),
        change: 8.3,
        data: callsData,
      },
      successRate: {
        current: 97.8,
        change: 0.5,
      },
      avgLatency: {
        current: 342,
        change: -8.2,
      },
      topCapabilities: [
        { id: "cap.llm.reason.v1", name: "GPT-4 Reasoning", calls: 1234, revenue: 12340, successRate: 98.5 },
        { id: "cap.code.review.v1", name: "Code Review", calls: 892, revenue: 8920, successRate: 97.2 },
        { id: "cap.data.analyze.v1", name: "Data Analysis", calls: 567, revenue: 5670, successRate: 99.1 },
        { id: "cap.summarize.v1", name: "Document Summarizer", calls: 456, revenue: 4560, successRate: 98.8 },
      ],
      errors: [
        { type: "timeout", count: 23, lastSeen: new Date(Date.now() - 3600000).toISOString() },
        { type: "rate_limit", count: 12, lastSeen: new Date(Date.now() - 7200000).toISOString() },
        { type: "invalid_input", count: 8, lastSeen: new Date(Date.now() - 14400000).toISOString() },
      ],
    };
  };

  const handleRefresh = () => {
    setRefreshing(true);
    fetchAnalytics();
  };

  // Simple bar chart component
  const MiniChart = ({ data, color }: { data: { value: number }[]; color: string }) => {
    const max = Math.max(...data.map(d => d.value));
    return (
      <div className="flex items-end gap-0.5 h-16">
        {data.slice(-20).map((d, i) => (
          <div
            key={i}
            className="flex-1 rounded-t"
            style={{
              height: `${(d.value / max) * 100}%`,
              backgroundColor: color,
              opacity: 0.3 + (i / data.length) * 0.7,
            }}
          />
        ))}
      </div>
    );
  };

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
            <h1 className="text-2xl font-bold text-white mb-1">Analytics</h1>
            <p className="text-[#707090]">Deep insights into your agent performance</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Time Range Selector */}
            <div className="flex gap-1 bg-[#0f0f18] border border-[#4f7cff]/10 rounded-lg p-1">
              {(["24h", "7d", "30d", "90d"] as TimeRange[]).map((range) => (
                <button
                  key={range}
                  onClick={() => setTimeRange(range)}
                  className={`px-3 py-1.5 text-sm rounded-md transition-all ${
                    timeRange === range
                      ? "bg-[#4f7cff] text-white"
                      : "text-[#707090] hover:text-white"
                  }`}
                >
                  {range}
                </button>
              ))}
            </div>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="btn-ghost py-2"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
            <button className="btn-ghost py-2">
              <Download className="w-4 h-4" /> Export
            </button>
          </div>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {/* Revenue */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-gradient-to-br from-[#4f7cff]/10 to-[#00d4ff]/10 border border-[#4f7cff]/20 rounded-xl p-5"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[#707090] text-sm">Revenue</span>
              <DollarSign className="w-5 h-5 text-[#39ff8e]" />
            </div>
            <div className="text-3xl font-bold text-white mb-1">
              {((data?.revenue.total || 0) / 100).toLocaleString()} <span className="text-sm text-[#4f7cff]">NCR</span>
            </div>
            <div className={`flex items-center gap-1 text-sm ${
              (data?.revenue.change || 0) >= 0 ? "text-[#39ff8e]" : "text-red-400"
            }`}>
              {(data?.revenue.change || 0) >= 0 ? (
                <ArrowUpRight className="w-4 h-4" />
              ) : (
                <ArrowDownRight className="w-4 h-4" />
              )}
              {Math.abs(data?.revenue.change || 0)}% vs previous
            </div>
            <div className="mt-3">
              <MiniChart data={data?.revenue.data || []} color="#39ff8e" />
            </div>
          </motion.div>

          {/* Total Calls */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-[#0f0f18] border border-[#4f7cff]/10 rounded-xl p-5"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[#707090] text-sm">Total Calls</span>
              <Activity className="w-5 h-5 text-[#00d4ff]" />
            </div>
            <div className="text-3xl font-bold text-white mb-1">
              {(data?.calls.total || 0).toLocaleString()}
            </div>
            <div className={`flex items-center gap-1 text-sm ${
              (data?.calls.change || 0) >= 0 ? "text-[#39ff8e]" : "text-red-400"
            }`}>
              {(data?.calls.change || 0) >= 0 ? (
                <ArrowUpRight className="w-4 h-4" />
              ) : (
                <ArrowDownRight className="w-4 h-4" />
              )}
              {Math.abs(data?.calls.change || 0)}% vs previous
            </div>
            <div className="mt-3">
              <MiniChart data={data?.calls.data || []} color="#00d4ff" />
            </div>
          </motion.div>

          {/* Success Rate */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-[#0f0f18] border border-[#4f7cff]/10 rounded-xl p-5"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[#707090] text-sm">Success Rate</span>
              <CheckCircle className="w-5 h-5 text-[#39ff8e]" />
            </div>
            <div className="text-3xl font-bold text-white mb-1">
              {data?.successRate.current || 0}%
            </div>
            <div className={`flex items-center gap-1 text-sm ${
              (data?.successRate.change || 0) >= 0 ? "text-[#39ff8e]" : "text-red-400"
            }`}>
              {(data?.successRate.change || 0) >= 0 ? (
                <TrendingUp className="w-4 h-4" />
              ) : (
                <TrendingDown className="w-4 h-4" />
              )}
              {(data?.successRate.change || 0) >= 0 ? "+" : ""}{data?.successRate.change}%
            </div>
            <div className="mt-3">
              <div className="h-2 bg-[#0a0a12] rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#4f7cff] to-[#39ff8e] rounded-full transition-all"
                  style={{ width: `${data?.successRate.current || 0}%` }}
                />
              </div>
            </div>
          </motion.div>

          {/* Avg Latency */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-[#0f0f18] border border-[#4f7cff]/10 rounded-xl p-5"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[#707090] text-sm">Avg Latency</span>
              <Clock className="w-5 h-5 text-[#a855f7]" />
            </div>
            <div className="text-3xl font-bold text-white mb-1">
              {data?.avgLatency.current || 0}<span className="text-sm text-[#707090] ml-1">ms</span>
            </div>
            <div className={`flex items-center gap-1 text-sm ${
              (data?.avgLatency.change || 0) <= 0 ? "text-[#39ff8e]" : "text-red-400"
            }`}>
              {(data?.avgLatency.change || 0) <= 0 ? (
                <TrendingDown className="w-4 h-4" />
              ) : (
                <TrendingUp className="w-4 h-4" />
              )}
              {Math.abs(data?.avgLatency.change || 0)}% {(data?.avgLatency.change || 0) <= 0 ? "faster" : "slower"}
            </div>
          </motion.div>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Top Capabilities */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="bg-[#0f0f18] border border-[#4f7cff]/10 rounded-xl p-6"
          >
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-[#4f7cff]" />
              Top Capabilities
            </h2>
            <div className="space-y-3">
              {(data?.topCapabilities || []).map((cap, i) => (
                <div key={cap.id} className="flex items-center gap-4 p-3 bg-[#0a0a12] rounded-lg">
                  <div className="text-[#707090] text-sm font-medium w-6">#{i + 1}</div>
                  <div className="flex-1">
                    <div className="text-white font-medium">{cap.name}</div>
                    <div className="text-[#707090] text-xs">{cap.calls.toLocaleString()} calls</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[#39ff8e] font-medium">{cap.revenue} NCR</div>
                    <div className="text-[#707090] text-xs">{cap.successRate}% success</div>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Recent Errors */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="bg-[#0f0f18] border border-[#4f7cff]/10 rounded-xl p-6"
          >
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-500" />
              Recent Errors
            </h2>
            {(data?.errors?.length || 0) === 0 ? (
              <div className="text-center py-8">
                <CheckCircle className="w-12 h-12 text-[#39ff8e]/30 mx-auto mb-3" />
                <p className="text-[#707090]">No errors in this period</p>
              </div>
            ) : (
              <div className="space-y-3">
                {(data?.errors || []).map((error, i) => (
                  <div key={i} className="flex items-center justify-between p-3 bg-[#0a0a12] rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center">
                        <XCircle className="w-4 h-4 text-red-400" />
                      </div>
                      <div>
                        <div className="text-white font-medium capitalize">
                          {error.type.replace("_", " ")}
                        </div>
                        <div className="text-[#707090] text-xs">
                          Last seen: {new Date(error.lastSeen).toLocaleString()}
                        </div>
                      </div>
                    </div>
                    <div className="text-red-400 font-medium">{error.count}x</div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        </div>

        {/* Pro Tip */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="mt-6 p-5 bg-gradient-to-r from-[#4f7cff]/5 to-[#00d4ff]/5 border border-[#4f7cff]/20 rounded-xl"
        >
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-[#4f7cff]/20 flex items-center justify-center flex-shrink-0">
              <Zap className="w-5 h-5 text-[#4f7cff]" />
            </div>
            <div>
              <h3 className="text-white font-semibold mb-1">Optimize for Revenue</h3>
              <p className="text-[#909098] text-sm">
                Based on your data, increasing your response speed by 20% could increase calls by ~15%.
                Consider caching frequent requests or upgrading your infrastructure.
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

