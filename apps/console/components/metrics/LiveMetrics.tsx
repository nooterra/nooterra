import React from "react";
import { Activity, Users, Zap, Clock } from "lucide-react";

export const LiveMetrics = () => {
  const [metrics, setMetrics] = React.useState<{
    agents: number;
    workflows: number;
    capabilities: number;
    avgLatency: number;
  } | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);

  const coordUrl = (import.meta as any).env?.VITE_COORD_URL || "https://coord.nooterra.ai";

  React.useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const [agentsRes, workflowsRes] = await Promise.all([
          fetch(`${coordUrl}/v1/agents/overview`).catch(() => null),
          fetch(`${coordUrl}/v1/workflows?limit=100`).catch(() => null),
        ]);

        let agents = 0;
        let capabilities = 0;
        let avgLatency = 0;
        let workflows = 0;

        if (agentsRes?.ok) {
          const data = await agentsRes.json();
          agents = data.agents?.length || 0;
          capabilities = data.agents?.reduce((sum: number, a: any) => 
            sum + (a.capabilities_count || 0), 0) || 0;
          avgLatency = data.agents?.reduce((sum: number, a: any) => 
            sum + (a.avg_latency_ms || 0), 0) / (agents || 1) || 0;
        }

        if (workflowsRes?.ok) {
          const data = await workflowsRes.json();
          workflows = data.workflows?.length || 0;
        }

        setMetrics({ agents, workflows, capabilities, avgLatency });
        setError(false);
      } catch (err) {
        console.error("Failed to fetch metrics:", err);
        setError(true);
      } finally {
        setLoading(false);
      }
    };

    fetchMetrics();
    const interval = setInterval(fetchMetrics, 30000);
    return () => clearInterval(interval);
  }, [coordUrl]);

  const cards = [
    {
      label: "Neural Agents",
      value: metrics?.agents ?? "—",
      icon: Users,
      color: "#4f7cff",
    },
    {
      label: "Capabilities",
      value: metrics?.capabilities ?? "—",
      icon: Zap,
      color: "#a855f7",
    },
    {
      label: "Workflows",
      value: metrics?.workflows ?? "—",
      icon: Activity,
      color: "#00d4ff",
    },
    {
      label: "Avg Latency",
      value: metrics?.avgLatency ? `${Math.round(metrics.avgLatency)}ms` : "—",
      icon: Clock,
      color: "#39ff8e",
    },
  ];

  return (
    <section className="py-24 px-6 relative overflow-hidden">
      <div className="absolute inset-0 bg-neural-void" />
      <div className="absolute inset-0 bg-neural-glow opacity-50" />
      
      <div className="max-w-6xl mx-auto relative z-10">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-3 mb-6">
            <div className="synapse-node synapse-active" />
            <span className="text-xs font-medium text-tertiary uppercase tracking-[0.2em]">
              Noosphere Telemetry
            </span>
          </div>
          <h2 className="text-3xl md:text-4xl font-bold text-primary mb-4">
            Network Vitals
          </h2>
          <p className="text-secondary max-w-xl mx-auto">
            Real-time metrics from the coordination layer.
            {error && " (Cached data — reconnecting...)"}
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
          {cards.map((card) => (
            <div
              key={card.label}
              className="card-neural p-6 group"
            >
              {/* Top accent */}
              <div 
                className="absolute top-0 left-0 right-0 h-[2px] rounded-t-2xl opacity-50 group-hover:opacity-100 transition-opacity"
                style={{ background: `linear-gradient(90deg, ${card.color}, transparent)` }}
              />
              
              <div className="flex items-center justify-between mb-4">
                <div 
                  className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{ 
                    background: `${card.color}15`,
                    border: `1px solid ${card.color}20`,
                  }}
                >
                  <card.icon className="w-5 h-5" style={{ color: card.color }} />
                </div>
                {loading && (
                  <div 
                    className="w-3 h-3 rounded-full border-2 border-t-transparent animate-spin"
                    style={{ borderColor: `${card.color}50`, borderTopColor: 'transparent' }}
                  />
                )}
              </div>
              
              <div 
                className="text-3xl font-bold mb-1 transition-colors"
                style={{ color: loading ? '#6b7280' : card.color }}
              >
                {loading ? "..." : card.value}
              </div>
              <div className="text-xs text-tertiary uppercase tracking-wider">
                {card.label}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-10 text-center">
          <p className="text-xs text-tertiary">
            Streaming from <code className="text-neural-blue/60">coord.nooterra.ai</code> • 
            Auto-refresh every 30s
          </p>
        </div>
      </div>
    </section>
  );
};
