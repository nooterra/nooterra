import React, { useState, useEffect, useCallback } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  Clock,
  DollarSign,
  RefreshCw,
  TrendingUp,
  XCircle,
  Zap,
  Server,
  BarChart3,
} from "lucide-react";

const COORD_URL = (import.meta as any).env?.VITE_COORD_URL || "https://coord.nooterra.ai";

interface CounterMetric {
  name: string;
  description: string;
  values: Record<string, number>;
}

interface HistogramSummary {
  count: number;
  sum: number;
  avg: number;
  min: number;
  max: number;
}

interface HistogramMetric {
  name: string;
  description: string;
  summaries: Record<string, HistogramSummary>;
}

interface MetricsData {
  timestamp: string;
  counters: Record<string, CounterMetric>;
  histograms: Record<string, HistogramMetric>;
}

export default function MetricsDashboard() {
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchMetrics = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${COORD_URL}/v1/metrics`);
      if (!res.ok) throw new Error("Failed to fetch metrics");
      const data = await res.json();
      setMetrics(data);
      setLastUpdated(new Date());
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 10000);
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  const getCounterValue = (name: string, labels?: Record<string, string>): number => {
    if (!metrics?.counters?.[name]) return 0;
    const counter = metrics.counters[name];
    if (!labels) {
      return Object.values(counter.values).reduce((a, b) => a + b, 0);
    }
    const labelStr = Object.entries(labels)
      .map(([k, v]) => `${k}="${v}"`)
      .sort()
      .join(",");
    return counter.values[labelStr] || 0;
  };

  const getHistogramAvg = (name: string): number => {
    if (!metrics?.histograms?.[name]) return 0;
    const hist = metrics.histograms[name];
    const summaries = Object.values(hist.summaries);
    if (summaries.length === 0) return 0;
    const totalSum = summaries.reduce((a, b) => a + b.sum, 0);
    const totalCount = summaries.reduce((a, b) => a + b.count, 0);
    return totalCount > 0 ? totalSum / totalCount : 0;
  };

  // Calculate key metrics
  const totalFaults = getCounterValue("faults");
  const timeoutFaults = getCounterValue("faults", { type: "timeout", blamed: "agent" });
  const errorFaults = getCounterValue("faults", { type: "error", blamed: "agent" });
  const schemaFaults = getCounterValue("faults", { type: "schema_violation", blamed: "agent" });
  
  const recoverySuccess = getCounterValue("recovery_attempts", { outcome: "success" });
  const recoveryFailed = getCounterValue("recovery_attempts", { outcome: "failed" });
  const recoveryRate = recoverySuccess + recoveryFailed > 0 
    ? (recoverySuccess / (recoverySuccess + recoveryFailed) * 100) 
    : 100;

  const paymentsSuccess = getCounterValue("payments_success");
  const paymentsFailed = getCounterValue("payments_failed");
  const successRate = paymentsSuccess + paymentsFailed > 0
    ? (paymentsSuccess / (paymentsSuccess + paymentsFailed) * 100)
    : 100;

  const budgetReserved = getCounterValue("budget_reserved");
  const budgetConsumed = getCounterValue("budget_consumed");
  
  const avgLatency = getHistogramAvg("dispatch_latency") * 1000; // Convert to ms

  const circuitBreakerTrips = getCounterValue("circuit_breaker_trips");

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <BarChart3 className="text-green-400" />
              Network Metrics
            </h1>
            <p className="text-gray-400 mt-1">
              Real-time observability for the Nooterra network
            </p>
          </div>
          <button
            onClick={fetchMetrics}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-500/50 rounded-lg p-4 mb-6">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {/* Overview Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <MetricCard
            icon={<CheckCircle className="text-green-400" />}
            title="Success Rate"
            value={`${successRate.toFixed(1)}%`}
            subtitle={`${paymentsSuccess} successful / ${paymentsFailed} failed`}
            color="green"
          />
          <MetricCard
            icon={<Clock className="text-blue-400" />}
            title="Avg Latency"
            value={`${avgLatency.toFixed(0)}ms`}
            subtitle="Dispatch to completion"
            color="blue"
          />
          <MetricCard
            icon={<AlertTriangle className="text-yellow-400" />}
            title="Total Faults"
            value={totalFaults.toString()}
            subtitle={`${timeoutFaults} timeout, ${errorFaults} error, ${schemaFaults} schema`}
            color="yellow"
          />
          <MetricCard
            icon={<Zap className="text-purple-400" />}
            title="Recovery Rate"
            value={`${recoveryRate.toFixed(1)}%`}
            subtitle={`${recoverySuccess} recovered / ${recoveryFailed} failed`}
            color="purple"
          />
        </div>

        {/* Budget & Health */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Budget Section */}
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
            <h2 className="text-xl font-semibold flex items-center gap-2 mb-4">
              <DollarSign className="text-green-400" />
              Budget Flow
            </h2>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Reserved</span>
                <span className="font-mono text-lg">{(budgetReserved / 100).toFixed(2)} NCR</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Consumed</span>
                <span className="font-mono text-lg text-green-400">{(budgetConsumed / 100).toFixed(2)} NCR</span>
              </div>
              <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-green-500 to-green-400"
                  style={{ width: budgetReserved > 0 ? `${(budgetConsumed / budgetReserved) * 100}%` : '0%' }}
                />
              </div>
            </div>
          </div>

          {/* Circuit Breaker Section */}
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
            <h2 className="text-xl font-semibold flex items-center gap-2 mb-4">
              <Server className="text-orange-400" />
              Circuit Breaker
            </h2>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Total Trips</span>
                <span className="font-mono text-lg">{circuitBreakerTrips}</span>
              </div>
              {circuitBreakerTrips > 0 ? (
                <div className="bg-orange-900/30 border border-orange-500/50 rounded-lg p-3">
                  <p className="text-orange-400 text-sm">
                    ⚠️ Some agents have triggered circuit breakers due to high failure rates
                  </p>
                </div>
              ) : (
                <div className="bg-green-900/30 border border-green-500/50 rounded-lg p-3">
                  <p className="text-green-400 text-sm">
                    ✓ All circuits healthy - no agents are currently blocked
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Fault Breakdown */}
        <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-8">
          <h2 className="text-xl font-semibold flex items-center gap-2 mb-4">
            <XCircle className="text-red-400" />
            Fault Breakdown
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <FaultTypeCard
              type="Timeout"
              count={timeoutFaults}
              total={totalFaults}
              description="Agent exceeded deadline"
              color="yellow"
            />
            <FaultTypeCard
              type="Error"
              count={errorFaults}
              total={totalFaults}
              description="HTTP 5xx or explicit error"
              color="red"
            />
            <FaultTypeCard
              type="Schema Violation"
              count={schemaFaults}
              total={totalFaults}
              description="Output failed validation"
              color="purple"
            />
          </div>
        </div>

        {/* Raw Counters */}
        {metrics?.counters && Object.keys(metrics.counters).length > 0 && (
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
            <h2 className="text-xl font-semibold flex items-center gap-2 mb-4">
              <Activity className="text-cyan-400" />
              All Counters
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-800">
                    <th className="text-left py-2 px-4">Metric</th>
                    <th className="text-left py-2 px-4">Labels</th>
                    <th className="text-right py-2 px-4">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(metrics.counters).flatMap(([name, counter]) =>
                    Object.entries(counter.values).map(([labels, value]) => (
                      <tr key={`${name}-${labels}`} className="border-b border-gray-800/50 hover:bg-gray-800/50">
                        <td className="py-2 px-4 font-mono text-cyan-300">{counter.name}</td>
                        <td className="py-2 px-4 font-mono text-gray-400">{labels || "(none)"}</td>
                        <td className="py-2 px-4 text-right font-mono">{value.toLocaleString()}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-6 text-center text-gray-500 text-sm">
          {lastUpdated && (
            <p>Last updated: {lastUpdated.toLocaleTimeString()}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricCard({ 
  icon, 
  title, 
  value, 
  subtitle, 
  color 
}: { 
  icon: React.ReactNode; 
  title: string; 
  value: string; 
  subtitle: string;
  color: "green" | "blue" | "yellow" | "purple" | "red";
}) {
  const colorClasses = {
    green: "bg-green-900/30 border-green-500/30",
    blue: "bg-blue-900/30 border-blue-500/30",
    yellow: "bg-yellow-900/30 border-yellow-500/30",
    purple: "bg-purple-900/30 border-purple-500/30",
    red: "bg-red-900/30 border-red-500/30",
  };

  return (
    <div className={`rounded-xl p-4 border ${colorClasses[color]}`}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-gray-400 text-sm">{title}</span>
      </div>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-gray-500 text-xs mt-1">{subtitle}</p>
    </div>
  );
}

function FaultTypeCard({
  type,
  count,
  total,
  description,
  color,
}: {
  type: string;
  count: number;
  total: number;
  description: string;
  color: "yellow" | "red" | "purple";
}) {
  const percentage = total > 0 ? (count / total) * 100 : 0;
  
  const colorClasses = {
    yellow: "from-yellow-500 to-yellow-400",
    red: "from-red-500 to-red-400",
    purple: "from-purple-500 to-purple-400",
  };

  return (
    <div className="bg-gray-800/50 rounded-lg p-4">
      <div className="flex justify-between items-center mb-2">
        <span className="font-medium">{type}</span>
        <span className="font-mono text-lg">{count}</span>
      </div>
      <p className="text-gray-500 text-xs mb-3">{description}</p>
      <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full bg-gradient-to-r ${colorClasses[color]}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <p className="text-gray-500 text-xs mt-1">{percentage.toFixed(1)}% of total</p>
    </div>
  );
}
