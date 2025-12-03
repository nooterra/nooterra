import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { RefreshCw, Play, Loader2, AlertCircle, Workflow, Plus } from "lucide-react";

interface WorkflowItem {
  id: string;
  intent?: string;
  status: string;
  created_at: string;
}

export default function Workflows() {
  const [items, setItems] = React.useState<WorkflowItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  
  // Suggest form state
  const [description, setDescription] = React.useState("");
  const [intent, setIntent] = React.useState("");
  const [maxCents, setMaxCents] = React.useState("");
  const [draft, setDraft] = React.useState<any | null>(null);
  const [suggestError, setSuggestError] = React.useState<string | null>(null);
  const [publishError, setPublishError] = React.useState<string | null>(null);
  const [suggestLoading, setSuggestLoading] = React.useState(false);
  const [publishLoading, setPublishLoading] = React.useState(false);

  const apiKey = typeof window !== "undefined" ? localStorage.getItem("apiKey") || "" : "";
  const coordUrl = (import.meta as any).env?.VITE_COORD_URL || "https://coord.nooterra.ai";
  const navigate = useNavigate();

  const fetchWorkflows = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${coordUrl}/v1/workflows`, {
        headers: apiKey ? { "x-api-key": apiKey } : {},
      });
      if (res.ok) {
        const json = await res.json();
        setItems(json.workflows || []);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to load workflows");
    } finally {
      setLoading(false);
    }
  }, [apiKey, coordUrl]);

  React.useEffect(() => {
    fetchWorkflows();
  }, [fetchWorkflows]);

  const handleSuggest = async () => {
    setSuggestError(null);
    setPublishError(null);
    setDraft(null);
    
    if (!apiKey) {
      setSuggestError("Set an API key in the Account tab first");
      return;
    }
    if (!description.trim()) {
      setSuggestError("Enter a workflow description");
      return;
    }
    
    setSuggestLoading(true);
    try {
      const res = await fetch(`${coordUrl}/v1/workflows/suggest`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { "x-api-key": apiKey } : {}),
        },
        body: JSON.stringify({
          intent: intent.trim() || undefined,
          description: description.trim(),
          maxCents: maxCents ? Number(maxCents) : undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSuggestError(json.error || "Suggest failed");
        return;
      }
      setDraft(json.draft || null);
    } catch (err: any) {
      setSuggestError(err.message || "Suggest failed");
    } finally {
      setSuggestLoading(false);
    }
  };

  const handlePublishDraft = async () => {
    if (!draft) return;
    setPublishError(null);
    
    if (!apiKey) {
      setPublishError("Set an API key first");
      return;
    }
    
    setPublishLoading(true);
    try {
      const res = await fetch(`${coordUrl}/v1/workflows/publish`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { "x-api-key": apiKey } : {}),
        },
        body: JSON.stringify({
          intent: draft.intent || undefined,
          maxCents: draft.maxCents ?? undefined,
          nodes: draft.nodes || {},
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPublishError(json.error || "Publish failed");
        return;
      }
      if (json.workflowId) {
        setDraft(null);
        setDescription("");
        setIntent("");
        setMaxCents("");
        navigate(`/console/workflows/${json.workflowId}`);
      }
    } catch (err: any) {
      setPublishError(err.message || "Publish failed");
    } finally {
      setPublishLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Create workflow */}
      <div className="card p-6">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h3 className="font-semibold text-primary flex items-center gap-2">
              <Plus className="w-4 h-4 text-[#00f0ff]" />
              Create Workflow
            </h3>
            <p className="text-sm text-secondary mt-1">
              Describe what you want to accomplish and we'll suggest a DAG of capabilities
            </p>
          </div>
          <button
            onClick={handleSuggest}
            disabled={suggestLoading || !description.trim()}
            className="btn-primary text-xs py-2 px-4 inline-flex items-center gap-2 disabled:opacity-50"
          >
            {suggestLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            Suggest DAG
          </button>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <label className="block text-xs text-tertiary mb-2">Description *</label>
            <textarea
              className="w-full bg-void border border-white/10 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-[#00f0ff]/50 transition-colors"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="E.g., Analyze sentiment of customer reviews and send a summary to Slack"
            />
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-tertiary mb-2">Intent ID (optional)</label>
              <input
                className="w-full bg-void border border-white/10 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-[#00f0ff]/50 transition-colors"
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                placeholder="my-workflow"
              />
            </div>
            <div>
              <label className="block text-xs text-tertiary mb-2">Max Budget (cents)</label>
              <input
                className="w-full bg-void border border-white/10 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-[#00f0ff]/50 transition-colors"
                value={maxCents}
                onChange={(e) => setMaxCents(e.target.value)}
                placeholder="1000"
                type="number"
              />
            </div>
          </div>
        </div>

        {suggestError && (
          <div className="mt-4 p-3 rounded-lg bg-[#ff4757]/10 border border-[#ff4757]/20 text-[#ff4757] text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            {suggestError}
          </div>
        )}

        {/* Draft preview */}
        {draft && (
          <div className="mt-6 pt-6 border-t border-white/5">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-sm font-medium text-primary">Suggested DAG</h4>
              <button
                onClick={handlePublishDraft}
                disabled={publishLoading}
                className="btn-primary text-xs py-2 px-4 inline-flex items-center gap-2 disabled:opacity-50"
              >
                {publishLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Publish Workflow"
                )}
              </button>
            </div>

            <div className="bg-void rounded-lg border border-white/5 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="text-xs text-tertiary uppercase tracking-wider border-b border-white/5">
                  <tr>
                    <th className="text-left px-4 py-3">Node</th>
                    <th className="text-left px-4 py-3">Capability</th>
                    <th className="text-left px-4 py-3">Depends On</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(draft.nodes || {}).map(([name, node]: any) => (
                    <tr key={name} className="border-b border-white/5 last:border-0">
                      <td className="px-4 py-3 font-mono text-xs text-primary">{name}</td>
                      <td className="px-4 py-3 text-secondary">{node.capabilityId}</td>
                      <td className="px-4 py-3 text-tertiary text-xs">
                        {(node.dependsOn || []).length ? node.dependsOn.join(", ") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {publishError && (
              <div className="mt-4 p-3 rounded-lg bg-[#ff4757]/10 border border-[#ff4757]/20 text-[#ff4757] text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                {publishError}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Workflows list */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-primary">Recent Workflows</h2>
          <button
            onClick={fetchWorkflows}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm text-secondary hover:text-primary bg-white/5 hover:bg-white/10 rounded-lg transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {items.length === 0 && !loading && (
          <div className="text-center py-12 card">
            <Workflow className="w-8 h-8 text-tertiary mx-auto mb-3" />
            <p className="text-secondary">No workflows yet</p>
          </div>
        )}

        {items.length > 0 && (
          <div className="space-y-2">
            {items.map((wf) => (
              <Link
                key={wf.id}
                to={`/console/workflows/${wf.id}`}
                className="block card p-4 hover:border-[#00f0ff]/20 transition-all"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-mono text-sm text-primary">{wf.id}</div>
                    <div className="text-xs text-tertiary mt-1">
                      {wf.intent || "No intent"}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <StatusBadge status={wf.status} />
                    <div className="text-xs text-tertiary">
                      {new Date(wf.created_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-[#ffb800]/10 text-[#ffb800] border-[#ffb800]/20",
    running: "bg-[#00f0ff]/10 text-[#00f0ff] border-[#00f0ff]/20",
    completed: "bg-[#b4ff39]/10 text-[#b4ff39] border-[#b4ff39]/20",
    failed: "bg-[#ff4757]/10 text-[#ff4757] border-[#ff4757]/20",
  };

  return (
    <span className={`px-2 py-1 text-xs font-medium rounded border ${styles[status] || styles.pending}`}>
      {status}
    </span>
  );
}
