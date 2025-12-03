import React from "react";
import { useParams } from "react-router-dom";

export default function WorkflowDetail() {
  const { id } = useParams();
  const [data, setData] = React.useState<any | null>(null);
  const [selectionLogs, setSelectionLogs] = React.useState<any[] | null>(null);
  const [openNodeName, setOpenNodeName] = React.useState<string | null>(null);
  const apiKey = typeof window !== "undefined" ? localStorage.getItem("apiKey") || "" : "";
  const coordUrl = import.meta.env.VITE_COORD_URL || "https://coord.nooterra.ai";

  React.useEffect(() => {
    if (!id) return;
    const run = async () => {
      try {
        const res = await fetch(`${coordUrl}/v1/workflows/${id}`, {
          headers: apiKey ? { "x-api-key": apiKey } : {},
        });
        if (res.ok) {
          const json = await res.json();
          setData(json);
        }
      } catch (err) {
        console.error(err);
      }
    };
    run();
  }, [id, apiKey, coordUrl]);

  React.useEffect(() => {
    if (!id) return;
    const run = async () => {
      try {
        const res = await fetch(`${coordUrl}/v1/workflows/${id}/selection-log`, {
          headers: apiKey ? { "x-api-key": apiKey } : {},
        });
        if (!res.ok) {
          setSelectionLogs(null);
          return;
        }
        const json = await res.json();
        setSelectionLogs(json.logs || []);
      } catch (err) {
        console.error(err);
        setSelectionLogs(null);
      }
    };
    run();
  }, [id, apiKey, coordUrl]);

  if (!data) {
    return <div className="text-secondary">Loading workflow…</div>;
  }

  const { workflow, nodes } = data;

  const logsByNode: Record<string, any[]> = {};
  if (selectionLogs && Array.isArray(selectionLogs)) {
    for (const log of selectionLogs) {
      const name = log.node_name || log.nodeName;
      if (!name) continue;
      if (!logsByNode[name]) logsByNode[name] = [];
      logsByNode[name].push(log);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Workflow {workflow.id}</h2>
          <p className="text-secondary text-sm">Intent: {workflow.intent || "—"}</p>
          <p className="text-secondary text-sm">
            Payer: {workflow.payer_did || "—"} · Budget:{" "}
            {workflow.max_cents != null ? `${workflow.max_cents}¢` : "—"} · Spent:{" "}
            {workflow.spent_cents != null ? `${workflow.spent_cents}¢` : "0¢"}
          </p>
        </div>
        <div className="text-sm text-secondary">Status: {workflow.status}</div>
      </div>

      <div className="bg-substrate border border-white/10 rounded-xl">
        <table className="w-full text-sm">
          <thead className="text-secondary text-xs uppercase tracking-[0.2em] border-b border-white/10">
            <tr>
              <th className="text-left px-4 py-3">Node</th>
              <th className="text-left px-4 py-3">Capability</th>
              <th className="text-left px-4 py-3">Agent</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Verify</th>
              <th className="text-left px-4 py-3">Attempts</th>
              <th className="text-left px-4 py-3">Started</th>
              <th className="text-left px-4 py-3">Finished</th>
              <th className="text-left px-4 py-3">Why this agent?</th>
            </tr>
          </thead>
          <tbody>
            {nodes?.map((n: any) => (
              <tr key={n.name} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                <td className="px-4 py-3 font-mono text-xs text-primary">{n.name}</td>
                <td className="px-4 py-3 text-secondary text-sm">{n.capability_id}</td>
                <td className="px-4 py-3 text-secondary text-sm">{n.agent_did || "—"}</td>
                <td className="px-4 py-3 text-secondary text-sm">{n.status}</td>
                <td className="px-4 py-3 text-secondary text-sm">
                  {n.requires_verification ? n.verification_status || "pending" : "n/a"}
                </td>
                <td className="px-4 py-3 text-secondary text-sm">{n.attempts}/{n.max_attempts}</td>
                <td className="px-4 py-3 text-secondary text-sm">{n.started_at || "—"}</td>
                <td className="px-4 py-3 text-secondary text-sm">{n.finished_at || "—"}</td>
                <td className="px-4 py-3 text-secondary text-xs">
                  {logsByNode[n.name] && logsByNode[n.name].length > 0 ? (
                    <button
                      className="underline hover:text-primary"
                      onClick={() => setOpenNodeName(openNodeName === n.name ? null : n.name)}
                    >
                      {openNodeName === n.name ? "Hide" : "Explain"}
                    </button>
                  ) : (
                    <span className="text-[11px] text-secondary/70">n/a</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {openNodeName && logsByNode[openNodeName] && (
        <div className="bg-substrate border border-execute/60 rounded-xl p-4 text-xs space-y-3">
          {(() => {
            const logs = logsByNode[openNodeName];
            const latest = logs[logs.length - 1];
            const candidates = latest?.candidates || [];
            const filtered = latest?.filtered || [];
            const allowedDids = new Set<string>(
              Array.isArray(filtered) ? filtered.map((f: any) => f.did).filter(Boolean) : []
            );
            const policy = latest?.policy || null;
            return (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-secondary">
                      Agent selection for node
                    </div>
                    <div className="text-primary text-sm">{openNodeName}</div>
                  </div>
                  <button
                    className="text-[11px] text-secondary hover:text-primary underline"
                    onClick={() => setOpenNodeName(null)}
                  >
                    Close
                  </button>
                </div>
                <div className="text-secondary">
                  <div>Capability: <span className="font-mono">{latest?.capability_id || latest?.capabilityId}</span></div>
                  <div>Chosen agent: <span className="font-mono">{latest?.chosen_agent_did || "none"}</span></div>
                  <div className="mt-1">
                    <span className="opacity-80">Policy snapshot: </span>
                    {policy ? (
                      <code className="bg-void/60 px-1 py-0.5 rounded">
                        {JSON.stringify({
                          minReputation: policy.minReputation,
                          allowUnsigned: policy.allowUnsigned,
                          allowedCapabilities: policy.allowedCapabilities,
                          blockedCapabilities: policy.blockedCapabilities,
                        })}
                      </code>
                    ) : (
                      <span className="italic text-secondary/80">default (no explicit policy)</span>
                    )}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead className="border-b border-white/10 text-secondary">
                      <tr>
                        <th className="text-left px-2 py-2">Agent DID</th>
                        <th className="text-left px-2 py-2">Score</th>
                        <th className="text-left px-2 py-2">Rep</th>
                        <th className="text-left px-2 py-2">Avail</th>
                        <th className="text-left px-2 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {candidates.map((c: any) => (
                        <tr key={c.did} className="border-b border-white/5">
                          <td className="px-2 py-1 font-mono">{c.did}</td>
                          <td className="px-2 py-1">{c.score != null ? c.score.toFixed(3) : "—"}</td>
                          <td className="px-2 py-1">{c.rep != null ? c.rep.toFixed(3) : "—"}</td>
                          <td className="px-2 py-1">{c.avail != null ? c.avail.toFixed(3) : "—"}</td>
                          <td className="px-2 py-1">
                            {allowedDids.has(c.did)
                              ? c.did === (latest?.chosen_agent_did || latest?.chosenAgentDid)
                                ? "selected"
                                : "eligible"
                              : "filtered out"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
