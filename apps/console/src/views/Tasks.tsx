import React from "react";
import { RefreshCw, ListTodo, CheckCircle, Clock, XCircle } from "lucide-react";

interface Task {
  id: string;
  description?: string;
  winner_did?: string;
  status: string;
  created_at?: string;
}

export default function Tasks() {
  const [tasks, setTasks] = React.useState<Task[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const apiKey = typeof window !== "undefined" ? localStorage.getItem("apiKey") || "" : "";
  const coordUrl = (import.meta as any).env?.VITE_COORD_URL || "https://coord.nooterra.ai";

  const fetchTasks = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${coordUrl}/v1/tasks`, {
        headers: apiKey ? { "x-api-key": apiKey } : {},
      });
      const json = await res.json();
      setTasks(json.tasks || []);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }, [apiKey, coordUrl]);

  React.useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-primary">Tasks</h2>
          <p className="text-sm text-secondary mt-1">
            Individual task nodes from workflows
          </p>
        </div>
        <button
          onClick={fetchTasks}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm text-secondary hover:text-primary bg-white/5 hover:bg-white/10 rounded-lg transition-all disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-[#ff4757]/10 border border-[#ff4757]/20 text-[#ff4757] text-sm">
          {error}
        </div>
      )}

      {loading && tasks.length === 0 && (
        <div className="text-center py-12">
          <div className="w-8 h-8 border-2 border-[#00f0ff] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-secondary">Loading tasks...</p>
        </div>
      )}

      {!loading && tasks.length === 0 && !error && (
        <div className="text-center py-16 card">
          <ListTodo className="w-12 h-12 text-tertiary mx-auto mb-4" />
          <h3 className="text-lg font-medium text-primary mb-2">No tasks yet</h3>
          <p className="text-secondary text-sm">
            Tasks will appear here when workflows are executed
          </p>
        </div>
      )}

      {tasks.length > 0 && (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead className="bg-surface border-b border-white/5">
              <tr className="text-xs text-tertiary uppercase tracking-wider">
                <th className="text-left px-4 py-3">Task ID</th>
                <th className="text-left px-4 py-3">Description</th>
                <th className="text-left px-4 py-3">Winner</th>
                <th className="text-left px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {tasks.map((task) => (
                <tr key={task.id} className="hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-primary">{task.id}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-secondary">
                      {task.description || "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-tertiary">
                      {task.winner_did || "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <TaskStatus status={task.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TaskStatus({ status }: { status: string }) {
  const config: Record<string, { icon: typeof CheckCircle; color: string; bg: string }> = {
    success: { icon: CheckCircle, color: "text-[#b4ff39]", bg: "bg-[#b4ff39]/10" },
    completed: { icon: CheckCircle, color: "text-[#b4ff39]", bg: "bg-[#b4ff39]/10" },
    pending: { icon: Clock, color: "text-[#ffb800]", bg: "bg-[#ffb800]/10" },
    running: { icon: Clock, color: "text-[#00f0ff]", bg: "bg-[#00f0ff]/10" },
    failed: { icon: XCircle, color: "text-[#ff4757]", bg: "bg-[#ff4757]/10" },
  };

  const { icon: Icon, color, bg } = config[status] || config.pending;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${color} ${bg}`}>
      <Icon className="w-3 h-3" />
      {status}
    </span>
  );
}
