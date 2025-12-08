import React from "react";
import { useParams, Link } from "react-router-dom";

export default function AgentDetail() {
  const { did = "" } = useParams();
  const [agent, setAgent] = React.useState<any>(null);
  const [caps, setCaps] = React.useState<any[]>([]);
  const [ledger, setLedger] = React.useState<any>(null);
  const [reputation, setReputation] = React.useState<any | null>(null);
  const [signatureStats, setSignatureStats] = React.useState<{
    total: number;
    valid: number;
    invalid: number;
    invalidRatio: number;
  } | null>(null);
  const [loading, setLoading] = React.useState(true);
  const apiKey = typeof window !== "undefined" ? localStorage.getItem("apiKey") || "" : "";
  const coordUrl = import.meta.env.VITE_COORD_URL || "https://coord.nooterra.ai";

  React.useEffect(() => {
    const run = async () => {
      if (!did) return;
      setLoading(true);
      try {
        const headers = apiKey ? { "x-api-key": apiKey } : {};
        const [resMeta, resLedger, resRep, resSig] = await Promise.all([
          fetch(`${coordUrl}/v1/agents/${encodeURIComponent(did)}`, { headers }),
          fetch(`${coordUrl}/v1/ledger/accounts/${encodeURIComponent(did)}`, { headers }),
          fetch(`${coordUrl}/v1/reputation/${encodeURIComponent(did)}`, { headers }),
          fetch(`${coordUrl}/internal/envelope-signatures`),
        ]);

        if (resMeta.ok) {
          const json = await resMeta.json();
          setAgent(json.agent || null);
          setCaps(json.capabilities || []);
        } else {
          console.error("agent detail failed", await resMeta.text());
        }

        if (resLedger.ok) {
          const json = await resLedger.json();
          setLedger(json);
        } else {
          setLedger(null);
        }

        if (resRep.ok) {
          const json = await resRep.json();
          setReputation(json || null);
        } else {
          setReputation(null);
        }

        if (resSig.ok) {
          const json = await resSig.json();
          const stat =
            json?.stats?.find((s: any) => s.agentDid === did) || null;
          if (stat) {
            setSignatureStats({
              total: Number(stat.total || 0),
              valid: Number(stat.valid || 0),
              invalid: Number(stat.invalid || 0),
              invalidRatio: Number(stat.invalidRatio || 0),
            });
          } else {
            setSignatureStats(null);
          }
        } else {
          setSignatureStats(null);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [apiKey, coordUrl, did]);

  if (!did) return <div className="text-secondary">Missing agent DID</div>;
  if (loading) return <div className="text-secondary">Loading agent…</div>;
  if (!agent) return <div className="text-secondary">Agent not found.</div>;

  const schemaExampleFor = (capId: string): string | null => {
    if (capId.startsWith("cap.text.summarize")) {
      return '{ "text": "Long article text..." }';
    }
    if (capId.startsWith("cap.translate")) {
      return '{ "text": "Hallo Welt", "target_lang": "en" }';
    }
    if (capId.startsWith("cap.embedding.encode")) {
      return '{ "text": "Search query or document..." }';
    }
    if (capId.startsWith("cap.llm.chat")) {
      return '{ "messages": [{ "role": "user", "content": "Hello" }] }';
    }
    if (capId.startsWith("cap.creative.generate")) {
      return '{ "prompt": "A futuristic city at sunset" }';
    }
    if (capId.startsWith("cap.audio.transcribe")) {
      return "{ /* audio reference + config */ }";
    }
    if (capId.startsWith("cap.audio.tts")) {
      return '{ "input": "Hello world", "voice": "default" }';
    }
    return null;
  };

  const overallScore =
    reputation && reputation.overallScore != null
      ? Number(reputation.overallScore).toFixed(3)
      : agent.reputation != null
      ? Number(agent.reputation).toFixed(3)
      : "0.000";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-secondary">Agent</div>
          <div className="font-mono text-sm text-primary break-all">{agent.did}</div>
        </div>
        <Link to="/console/agents" className="text-xs text-secondary hover:text-primary underline">
          Back to Agents
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="bg-substrate border border-white/10 rounded-xl p-4 text-sm space-y-2">
          <div className="text-secondary text-xs uppercase tracking-[0.2em]">Meta</div>
          <div>Endpoint: <span className="break-all text-primary">{agent.endpoint || "—"}</span></div>
          <div>Reputation: {overallScore}</div>
          <div>Success: {agent.tasks_success ?? 0}</div>
          <div>Failed: {agent.tasks_failed ?? 0}</div>
          <div>Avg latency: {Number(agent.avg_latency_ms ?? 0).toFixed(0)} ms</div>
          <div>Availability: {agent.availability_score != null ? Number(agent.availability_score).toFixed(2) : "—"}</div>
          <div>Last seen: {agent.last_seen || "—"}</div>
        </div>

        <div className="bg-substrate border border-white/10 rounded-xl p-4 text-sm space-y-2">
          <div className="text-secondary text-xs uppercase tracking-[0.2em]">Ledger</div>
          <div>Balance: {ledger?.account?.balance ?? 0} {ledger?.account?.currency || "NCR"}</div>
          <div className="text-xs text-tertiary">Showing last 50 events.</div>
        </div>

        <div className="bg-substrate border border-white/10 rounded-xl p-4 text-sm space-y-2">
          <div className="text-secondary text-xs uppercase tracking-[0.2em]">Reputation & Signatures</div>
          {reputation ? (
            <>
              <div>Overall: {Number(reputation.overallScore ?? 0).toFixed(3)}</div>
              <div>Success rate: {Number(reputation.successRate ?? 0).toFixed(3)}</div>
              <div>Verification score: {Number(reputation.verificationScore ?? 0).toFixed(3)}</div>
              <div>PageRank: {Number(reputation.pageRank ?? 0).toFixed(3)}</div>
              <div>Tasks: {reputation.totalTasks ?? 0}</div>
            </>
          ) : (
            <div className="text-secondary text-sm">No reputation record yet.</div>
          )}
          <div className="mt-2 text-xs text-secondary">
            Envelope signatures:{" "}
            {signatureStats ? (
              <>
                {signatureStats.valid}/{signatureStats.total} valid (
                {(signatureStats.invalidRatio * 100).toFixed(1)}% invalid)
              </>
            ) : (
              "no data"
            )}
          </div>
        </div>
      </div>

      <div className="bg-substrate border border-white/10 rounded-xl">
        <div className="px-4 py-3 border-b border-white/10 text-xs uppercase tracking-[0.2em] text-secondary">
          Capabilities
        </div>
        <table className="w-full text-sm">
          <thead className="text-secondary text-xs uppercase tracking-[0.2em] border-b border-white/10">
            <tr>
              <th className="text-left px-4 py-3">Capability</th>
              <th className="text-left px-4 py-3">Description</th>
              <th className="text-left px-4 py-3">Price (cents)</th>
              <th className="text-left px-4 py-3">Example Input</th>
            </tr>
          </thead>
          <tbody>
            {caps.map((c) => (
              <tr key={c.capability_id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                <td className="px-4 py-3 text-primary font-mono text-xs">{c.capability_id}</td>
                <td className="px-4 py-3 text-secondary text-sm">{c.description || "—"}</td>
                <td className="px-4 py-3 text-secondary text-sm">{c.price_cents ?? 0}</td>
                <td className="px-4 py-3 text-secondary text-xs font-mono whitespace-pre-wrap">
                  {schemaExampleFor(c.capability_id) || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ledger?.events && (
        <div className="bg-substrate border border-white/10 rounded-xl">
          <div className="px-4 py-3 border-b border-white/10 text-xs uppercase tracking-[0.2em] text-secondary">
            Recent Ledger Events
          </div>
          <table className="w-full text-sm">
            <thead className="text-secondary text-xs uppercase tracking-[0.2em] border-b border-white/10">
              <tr>
                <th className="text-left px-4 py-3">Delta</th>
                <th className="text-left px-4 py-3">Reason</th>
                <th className="text-left px-4 py-3">Workflow</th>
                <th className="text-left px-4 py-3">Node</th>
                <th className="text-left px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {ledger.events.map((e: any, idx: number) => (
                <tr key={idx} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                  <td className="px-4 py-3 text-primary">{e.delta}</td>
                  <td className="px-4 py-3 text-secondary text-sm">{e.reason || "—"}</td>
                  <td className="px-4 py-3 text-secondary text-xs font-mono break-all">{e.workflow_id || "—"}</td>
                  <td className="px-4 py-3 text-secondary text-sm">{e.node_name || "—"}</td>
                  <td className="px-4 py-3 text-secondary text-sm">{e.created_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
