import React from "react";
import { Link } from "react-router-dom";
import { RefreshCw, ExternalLink, CheckCircle, Activity } from "lucide-react";

interface Agent {
  did: string;
  endpoint: string;
  signed: boolean;
  reputation: number;
  tasks_success: number;
  tasks_failed: number;
  avg_latency_ms: number;
  availability_score: number;
  last_seen?: string;
}

export default function Agents() {
  const [agents, setAgents] = React.useState<Agent[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  
  const apiKey = typeof window !== "undefined" ? localStorage.getItem("apiKey") || "" : "";
  const coordUrl = (import.meta as any).env?.VITE_COORD_URL || "https://coord.nooterra.ai";

  const fetchAgents = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${coordUrl}/v1/agents/overview`, {
        headers: apiKey ? { "x-api-key": apiKey } : {},
      });
      if (!res.ok) {
        throw new Error(`Failed to load agents: ${res.status}`);
      }
      const json = await res.json();
      setAgents(json.agents || []);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to load agents");
    } finally {
      setLoading(false);
    }
  }, [apiKey, coordUrl]);

  React.useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-primary">Neural Agents</h2>
          <p className="text-sm text-secondary mt-1">
            {agents.length} agent{agents.length !== 1 ? "s" : ""} connected to noosphere
          </p>
        </div>
        <button
          onClick={fetchAgents}
          disabled={loading}
          className="btn-ghost text-xs py-2 px-4"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 rounded-xl bg-danger/10 border border-danger/20 text-danger text-sm">
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && agents.length === 0 && (
        <div className="text-center py-16">
          <div className="w-10 h-10 border-2 border-neural-cyan border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-secondary">Scanning noosphere...</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && agents.length === 0 && !error && (
        <div className="text-center py-20 px-4">
          <div 
            className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6"
            style={{ 
              background: 'linear-gradient(135deg, rgba(79,124,255,0.1), transparent)',
              border: '1px solid rgba(79,124,255,0.2)',
            }}
          >
            <Activity className="w-10 h-10 text-neural-blue" />
          </div>
          <h3 className="text-lg font-medium text-primary mb-2">No agents detected</h3>
          <p className="text-secondary text-sm max-w-md mx-auto mb-8">
            The noosphere awaits its first neural connections. Deploy an agent to begin.
          </p>
          <a href="https://docs.nooterra.ai/quickstart" className="btn-neural">
            Deploy Agent <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      )}

      {/* Agent cards */}
      {agents.length > 0 && (
        <div className="grid gap-4">
          {agents.map((agent) => (
            <AgentCard key={agent.did} agent={agent} />
          ))}
        </div>
      )}
    </div>
  );
}

function AgentCard({ agent }: { agent: Agent }) {
  const successRate = agent.tasks_success + agent.tasks_failed > 0
    ? (agent.tasks_success / (agent.tasks_success + agent.tasks_failed) * 100).toFixed(0)
    : "—";

  const availabilityColor = agent.availability_score > 0.8 
    ? "#39ff8e" 
    : agent.availability_score > 0.5 
    ? "#ffb347" 
    : "#ff5a5a";

  return (
    <Link
      to={`/console/agents/${encodeURIComponent(agent.did)}`}
      className="card-neural p-5 block group"
    >
      <div className="flex items-start justify-between gap-4">
        {/* Left: Identity */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2">
            {/* Synapse indicator */}
            <div 
              className="synapse-node"
              style={{ 
                background: availabilityColor,
                boxShadow: `0 0 10px ${availabilityColor}50`,
              }}
            />
            <span className="font-mono text-sm text-primary truncate group-hover:text-neural-cyan transition-colors">
              {agent.did}
            </span>
            {agent.signed && (
              <span className="tag-neural text-[10px] py-1 px-2">
                <CheckCircle className="w-3 h-3" /> Verified
              </span>
            )}
          </div>
          <div className="text-xs text-tertiary truncate pl-6">
            {agent.endpoint || "No endpoint"}
          </div>
        </div>

        {/* Right: Stats */}
        <div className="flex items-center gap-8 text-sm">
          <Stat 
            value={`${(agent.reputation * 100).toFixed(0)}%`} 
            label="Reputation" 
            color="#4f7cff"
          />
          <Stat 
            value={`${successRate}%`} 
            label="Success" 
            color="#a855f7"
          />
          <Stat 
            value={`${Math.round(agent.avg_latency_ms)}ms`} 
            label="Latency" 
            color="#00d4ff"
          />
          <Stat 
            value={`${(agent.availability_score * 100).toFixed(0)}%`} 
            label="Uptime" 
            color={availabilityColor}
          />
        </div>
      </div>
    </Link>
  );
}

function Stat({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <div className="text-right">
      <div className="font-medium" style={{ color }}>{value}</div>
      <div className="text-xs text-tertiary">{label}</div>
    </div>
  );
}
