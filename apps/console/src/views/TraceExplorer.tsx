import React from "react";
import { Link, useSearchParams } from "react-router-dom";

type OpsNode = {
  workflowId: string;
  name: string;
  capabilityId: string;
  agentDid: string | null;
  status: string;
  attempts: number;
  maxAttempts: number;
  startedAt: string | null;
  finishedAt: string | null;
  requiresVerification?: boolean;
  verificationStatus?: string | null;
};

type OpsReceipt = {
  nodeName: string;
  agentDid: string | null;
  capabilityId: string;
  mandateId: string | null;
  envelopeSignatureValid: boolean | null;
};

type OpsInvocation = {
  invocationId: string;
  workflowId: string;
  nodeName: string;
  capabilityId: string;
  agentDid: string | null;
  mandateId: string | null;
};

type OpsMandate = {
  mandateId: string;
  policyIds: string[];
  regionsAllow: string[];
  regionsDeny: string[];
} | null;

type OpsWorkflow = {
  id: string;
  status: string;
  payerDid: string | null;
  mandateId: string | null;
} | null;

type OpsTraceResponse = {
  traceId: string;
  workflow: OpsWorkflow;
  mandate: OpsMandate;
  nodes: OpsNode[];
  receipts: OpsReceipt[];
  invocations: OpsInvocation[];
};

export default function TraceExplorer() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTraceId = searchParams.get("traceId") || "";
  const [traceIdInput, setTraceIdInput] = React.useState(initialTraceId);
  const [data, setData] = React.useState<OpsTraceResponse | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const apiKey =
    typeof window !== "undefined" ? localStorage.getItem("apiKey") || "" : "";
  const coordUrl =
    (import.meta as any).env?.VITE_COORD_URL || "https://coord.nooterra.ai";

  const loadTrace = React.useCallback(
    async (traceId: string) => {
      if (!traceId) return;
      setLoading(true);
      setError(null);
      try {
        const headers: Record<string, string> = {};
        if (apiKey) headers["x-api-key"] = apiKey;
        const res = await fetch(
          `${coordUrl}/v1/ops/trace/${encodeURIComponent(traceId)}`,
          { headers }
        );
        if (!res.ok) {
          const msg = await res.text();
          throw new Error(msg || `Failed to load trace (${res.status})`);
        }
        const json = (await res.json()) as OpsTraceResponse;
        setData(json);
      } catch (err: any) {
        console.error(err);
        setError(err.message || "Failed to load trace");
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [apiKey, coordUrl]
  );

  React.useEffect(() => {
    if (initialTraceId) {
      loadTrace(initialTraceId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTraceId]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const id = traceIdInput.trim();
    if (!id) return;
    setSearchParams({ traceId: id });
    loadTrace(id);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-secondary">
            Operations
          </div>
          <h2 className="text-xl font-semibold text-primary mt-1">
            Trace Explorer
          </h2>
          <p className="text-sm text-secondary mt-1">
            Inspect workflows, nodes, mandates, and receipts for a single trace.
          </p>
        </div>
      </div>

      <form
        onSubmit={onSubmit}
        className="flex flex-col sm:flex-row gap-3 items-start sm:items-center"
      >
        <input
          type="text"
          value={traceIdInput}
          onChange={(e) => setTraceIdInput(e.target.value)}
          placeholder="trace_..."
          className="w-full sm:max-w-md bg-abyss border border-white/10 rounded-lg px-3 py-2 text-sm text-primary placeholder:text-tertiary focus:outline-none focus:border-neural-cyan/60"
        />
        <button
          type="submit"
          className="px-4 py-2 text-xs font-medium rounded-lg border border-neural-blue/40 text-primary hover:bg-neural-blue/10 transition-colors"
          disabled={loading}
        >
          {loading ? "Loading…" : "Load trace"}
        </button>
      </form>

      {error && (
        <div className="p-3 rounded-lg bg-danger/10 border border-danger/30 text-sm text-danger">
          {error}
        </div>
      )}

      {!loading && !error && !data && (
        <div className="text-sm text-secondary">
          Enter a trace ID to inspect a workflow run.
        </div>
      )}

      {data && (
        <div className="space-y-6">
          {/* Workflow summary */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="bg-substrate border border-white/10 rounded-xl p-4 text-sm space-y-2">
              <div className="text-secondary text-xs uppercase tracking-[0.2em]">
                Workflow
              </div>
              <div>
                Trace ID:{" "}
                <span className="font-mono text-xs break-all text-primary">
                  {data.traceId}
                </span>
              </div>
              {data.workflow && (
                <>
                  <div>
                    Workflow ID:{" "}
                    <span className="font-mono text-xs break-all text-primary">
                      {data.workflow.id}
                    </span>
                  </div>
                  <div>Status: {data.workflow.status}</div>
                  <div>
                    Payer DID:{" "}
                    <span className="font-mono text-xs break-all text-secondary">
                      {data.workflow.payerDid || "—"}
                    </span>
                  </div>
                </>
              )}
            </div>

            <div className="bg-substrate border border-white/10 rounded-xl p-4 text-sm space-y-2">
              <div className="text-secondary text-xs uppercase tracking-[0.2em]">
                Mandate
              </div>
              {data.mandate ? (
                <>
                  <div>Mandate ID: {data.mandate.mandateId}</div>
                  <div>
                    Policies:{" "}
                    {data.mandate.policyIds.length
                      ? data.mandate.policyIds.join(", ")
                      : "—"}
                  </div>
                  <div>
                    Regions allow:{" "}
                    {data.mandate.regionsAllow.length
                      ? data.mandate.regionsAllow.join(", ")
                      : "—"}
                  </div>
                  <div>
                    Regions deny:{" "}
                    {data.mandate.regionsDeny.length
                      ? data.mandate.regionsDeny.join(", ")
                      : "—"}
                  </div>
                </>
              ) : (
                <div className="text-secondary text-sm">No mandate attached.</div>
              )}
            </div>
          </div>

          {/* Nodes */}
          <div className="bg-substrate border border-white/10 rounded-xl">
            <div className="px-4 py-3 border-b border-white/10 text-xs uppercase tracking-[0.2em] text-secondary">
              Nodes
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-secondary text-xs uppercase tracking-[0.2em] border-b border-white/10">
                  <tr>
                    <th className="text-left px-4 py-3">Name</th>
                    <th className="text-left px-4 py-3">Capability</th>
                    <th className="text-left px-4 py-3">Agent</th>
                    <th className="text-left px-4 py-3">Status</th>
                    <th className="text-left px-4 py-3">Attempts</th>
                    <th className="text-left px-4 py-3">Verification</th>
                  </tr>
                </thead>
                <tbody>
                  {data.nodes.map((n) => (
                    <tr
                      key={`${n.workflowId}:${n.name}`}
                      className="border-b border-white/5 hover:bg-white/5 transition-colors"
                    >
                      <td className="px-4 py-3 text-primary font-mono text-xs">
                        {n.name}
                      </td>
                      <td className="px-4 py-3 text-secondary text-xs font-mono">
                        {n.capabilityId}
                      </td>
                      <td className="px-4 py-3 text-secondary text-xs font-mono break-all">
                        {n.agentDid ? (
                          <Link
                            to={`/console/agents/${encodeURIComponent(n.agentDid)}`}
                            className="text-neural-cyan hover:underline"
                          >
                            {n.agentDid}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3 text-secondary text-sm">
                        {n.status}
                      </td>
                      <td className="px-4 py-3 text-secondary text-sm">
                        {n.attempts}/{n.maxAttempts}
                      </td>
                      <td className="px-4 py-3 text-secondary text-xs">
                        {n.requiresVerification
                          ? n.verificationStatus || "pending"
                          : "n/a"}
                      </td>
                    </tr>
                  ))}
                  {data.nodes.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-4 text-sm text-secondary text-center"
                      >
                        No nodes recorded for this trace.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Receipts */}
          <div className="bg-substrate border border-white/10 rounded-xl">
            <div className="px-4 py-3 border-b border-white/10 text-xs uppercase tracking-[0.2em] text-secondary">
              Receipts
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-secondary text-xs uppercase tracking-[0.2em] border-b border-white/10">
                  <tr>
                    <th className="text-left px-4 py-3">Node</th>
                    <th className="text-left px-4 py-3">Agent</th>
                    <th className="text-left px-4 py-3">Capability</th>
                    <th className="text-left px-4 py-3">Mandate</th>
                    <th className="text-left px-4 py-3">Signature</th>
                  </tr>
                </thead>
                <tbody>
                  {data.receipts.map((r, idx) => (
                    <tr
                      key={`${r.nodeName}:${idx}`}
                      className="border-b border-white/5 hover:bg-white/5 transition-colors"
                    >
                      <td className="px-4 py-3 text-primary font-mono text-xs">
                        {r.nodeName}
                      </td>
                      <td className="px-4 py-3 text-secondary text-xs font-mono break-all">
                        {r.agentDid ? (
                          <Link
                            to={`/console/agents/${encodeURIComponent(r.agentDid)}`}
                            className="text-neural-cyan hover:underline"
                          >
                            {r.agentDid}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3 text-secondary text-xs font-mono">
                        {r.capabilityId}
                      </td>
                      <td className="px-4 py-3 text-secondary text-xs">
                        {r.mandateId || "—"}
                      </td>
                      <td className="px-4 py-3 text-secondary text-xs">
                        {r.envelopeSignatureValid == null
                          ? "n/a"
                          : r.envelopeSignatureValid
                          ? "valid"
                          : "invalid"}
                      </td>
                    </tr>
                  ))}
                  {data.receipts.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-4 text-sm text-secondary text-center"
                      >
                        No receipts recorded for this trace.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Invocations */}
          <div className="bg-substrate border border-white/10 rounded-xl">
            <div className="px-4 py-3 border-b border-white/10 text-xs uppercase tracking-[0.2em] text-secondary">
              Invocations
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-secondary text-xs uppercase tracking-[0.2em] border-b border-white/10">
                  <tr>
                    <th className="text-left px-4 py-3">Invocation</th>
                    <th className="text-left px-4 py-3">Node</th>
                    <th className="text-left px-4 py-3">Agent</th>
                    <th className="text-left px-4 py-3">Capability</th>
                    <th className="text-left px-4 py-3">Mandate</th>
                  </tr>
                </thead>
                <tbody>
                  {data.invocations.map((i) => (
                    <tr
                      key={i.invocationId}
                      className="border-b border-white/5 hover:bg-white/5 transition-colors"
                    >
                      <td className="px-4 py-3 text-primary font-mono text-xs break-all">
                        {i.invocationId}
                      </td>
                      <td className="px-4 py-3 text-secondary text-xs font-mono">
                        {i.nodeName}
                      </td>
                      <td className="px-4 py-3 text-secondary text-xs font-mono break-all">
                        {i.agentDid ? (
                          <Link
                            to={`/console/agents/${encodeURIComponent(i.agentDid)}`}
                            className="text-neural-cyan hover:underline"
                          >
                            {i.agentDid}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3 text-secondary text-xs font-mono">
                        {i.capabilityId}
                      </td>
                      <td className="px-4 py-3 text-secondary text-xs">
                        {i.mandateId || "—"}
                      </td>
                    </tr>
                  ))}
                  {data.invocations.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-4 text-sm text-secondary text-center"
                      >
                        No invocations recorded for this trace.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

