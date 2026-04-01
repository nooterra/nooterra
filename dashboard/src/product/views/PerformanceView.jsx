import React, { useState, useEffect, useRef } from "react";
import { S, timeAgo, humanizeSchedule, workerApiRequest, WORKER_API_BASE } from "../shared.js";
import { loadRuntimeConfig } from "../api.js";
import ExecutionTraceViewer from "../components/ExecutionTraceViewer.jsx";
import {
  fetchLatestWorkerExecution,
  fetchWorkerExecutionDrilldown,
  fetchWorkerOpsSnapshot,
  fetchWorkerSideEffectDetail,
} from "../worker-ops.js";

function PerformanceInsightCard({ title, subtitle, emptyText, children }) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 12,
        background: "var(--bg-400)",
        padding: 18,
        minHeight: 220,
      }}
    >
      <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
        {title}
      </div>
      {subtitle ? (
        <div style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: 14 }}>
          {subtitle}
        </div>
      ) : null}
      {children || (
        <div style={{ fontSize: "13px", color: "var(--text-tertiary)", lineHeight: 1.6 }}>
          {emptyText}
        </div>
      )}
    </div>
  );
}

function DetailActionButton({ children, ...props }) {
  return (
    <button
      {...props}
      style={{
        background: "none",
        border: "1px solid var(--border)",
        borderRadius: 6,
        padding: "4px 10px",
        fontSize: "11px",
        fontWeight: 600,
        color: "var(--text-secondary)",
        cursor: props.disabled ? "not-allowed" : "pointer",
        opacity: props.disabled ? 0.6 : 1,
        transition: "border-color 0.15s, color 0.15s",
        ...(props.style || {}),
      }}
    >
      {children}
    </button>
  );
}

function DrilldownCard({ title, children }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg-400)", padding: 16 }}>
      <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function JsonPreview({ value }) {
  if (value == null) return <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>No payload recorded.</div>;
  return (
    <pre style={{
      margin: 0,
      padding: "12px 14px",
      borderRadius: 10,
      border: "1px solid var(--border)",
      background: "var(--bg-300, var(--bg-hover))",
      color: "var(--text-secondary)",
      fontSize: "12px",
      lineHeight: 1.5,
      overflowX: "auto",
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
      maxHeight: 320,
      overflowY: "auto",
    }}>
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function PerformanceView() {
  const [workers, setWorkers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [opsLoading, setOpsLoading] = useState(true);
  const [opsSnapshot, setOpsSnapshot] = useState(null);
  const [selectedExecution, setSelectedExecution] = useState(null);
  const [selectedSideEffect, setSelectedSideEffect] = useState(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const fetchingRef = useRef(false);

  async function loadWorkers() {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const [workersResult, opsResult] = await Promise.allSettled([
        workerApiRequest({ pathname: "/v1/workers", method: "GET" }),
        fetchWorkerOpsSnapshot({ request: workerApiRequest, days: 30, limit: 5 }),
      ]);

      if (workersResult.status === "fulfilled") {
        const result = workersResult.value;
        setWorkers(result?.workers || result?.items || (Array.isArray(result) ? result : []));
      } else {
        setWorkers([]);
      }

      if (opsResult.status === "fulfilled") {
        setOpsSnapshot(opsResult.value);
      } else {
        setOpsSnapshot(null);
      }
    } finally {
      setLoading(false);
      setOpsLoading(false);
      fetchingRef.current = false;
    }
  }

  useEffect(() => {
    loadWorkers();
    const interval = setInterval(loadWorkers, 60000);
    return () => clearInterval(interval);
  }, []);

  const [liveStream, setLiveStream] = useState(false);
  const abortRef = useRef(null);

  // Clean up SSE stream on unmount
  useEffect(() => {
    return () => { if (abortRef.current) abortRef.current.abort(); };
  }, []);

  function closeDrilldowns() {
    if (abortRef.current) abortRef.current.abort();
    setLiveStream(false);
    setSelectedExecution(null);
    setSelectedSideEffect(null);
  }

  function startSSEStream(workerId, execId, workerName) {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const runtime = loadRuntimeConfig();
    const url = `${WORKER_API_BASE}/v1/workers/${workerId}/executions/${execId}/stream`;

    setLiveStream(true);
    setSelectedExecution(prev => ({ ...(prev || {}), workerName, _streaming: true }));

    (async () => {
      try {
        const response = await fetch(url, {
          headers: { "x-tenant-id": runtime.tenantId },
          signal: controller.signal,
        });
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop(); // keep incomplete line in buffer

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const event = JSON.parse(line.slice(6));
                setSelectedExecution(prev => {
                  if (!prev) return prev;
                  const activity = [...(prev.activity || []), event];
                  return { ...prev, activity };
                });
                // End stream on terminal events
                if (event.type === "complete" || event.type === "error") {
                  setLiveStream(false);
                  controller.abort();
                  return;
                }
              } catch { /* ignore malformed SSE data */ }
            }
          }
        }
      } catch (err) {
        if (err.name !== "AbortError") {
          setLiveStream(false);
        }
      }
    })();
  }

  async function handleViewTrace(worker) {
    if (abortRef.current) abortRef.current.abort();
    setLiveStream(false);
    setTraceLoading(true);
    try {
      const result = await fetchLatestWorkerExecution({
        request: workerApiRequest,
        workerId: worker.id,
      });
      const activity = result?.activity || result?.events || [];
      const exec = {
        ...result,
        workerName: worker.name,
        activity,
      };
      setSelectedSideEffect(null);
      setSelectedExecution(exec);

      // If worker is running and execution is in progress, open SSE stream
      const lastEvent = activity[activity.length - 1];
      const isTerminal = lastEvent?.type === "complete" || lastEvent?.type === "error";
      if (worker.status === "running" && result?.id && !isTerminal) {
        startSSEStream(worker.id, result.id, worker.name);
      }
    } catch {
      setSelectedExecution({
        workerName: worker.name,
        activity: [],
      });
    }
    setTraceLoading(false);
  }

  async function openExecutionDrilldown({ workerId, workerName, executionId, workerStatus = null }) {
    if (!workerId || !executionId) return;
    if (abortRef.current) abortRef.current.abort();
    setLiveStream(false);
    setTraceLoading(true);
    try {
      const result = await fetchWorkerExecutionDrilldown({
        request: workerApiRequest,
        workerId,
        executionId,
      });
      const activity = result?.activity || result?.events || [];
      setSelectedSideEffect(null);
      setSelectedExecution({
        ...result,
        workerName: result?.workerName || workerName,
        activity,
      });

      const lastEvent = activity[activity.length - 1];
      const isTerminal = lastEvent?.type === "complete" || lastEvent?.type === "error";
      if (workerStatus === "running" && result?.id && !isTerminal) {
        startSSEStream(workerId, result.id, result?.workerName || workerName);
      }
    } catch {
      setSelectedExecution({
        workerName,
        activity: [],
      });
    }
    setTraceLoading(false);
  }

  async function openSideEffectDrilldown({ workerId, workerName, sideEffectId }) {
    if (!workerId || !sideEffectId) return;
    if (abortRef.current) abortRef.current.abort();
    setLiveStream(false);
    setTraceLoading(true);
    try {
      const result = await fetchWorkerSideEffectDetail({
        request: workerApiRequest,
        workerId,
        sideEffectId,
      });
      setSelectedExecution(null);
      setSelectedSideEffect({
        ...result?.sideEffect,
        workerId,
        workerName: result?.workerName || workerName,
      });
    } catch {
      setSelectedSideEffect({
        workerId,
        workerName,
      });
    }
    setTraceLoading(false);
  }

  function findWorker(workerId) {
    return workers.find((worker) => worker.id === workerId) || null;
  }

  async function handleInspectRiskWorker(item) {
    const worker = findWorker(item.workerId) || { id: item.workerId, name: item.workerName, status: null };
    if (item.latestExecutionId) {
      return openExecutionDrilldown({
        workerId: item.workerId,
        workerName: item.workerName,
        executionId: item.latestExecutionId,
        workerStatus: worker.status,
      });
    }
    return handleViewTrace(worker);
  }

  async function handleInspectVerifierFailure(failure) {
    const worker = findWorker(failure.workerId) || { id: failure.workerId, name: failure.workerName, status: null };
    if (failure.executionId) {
      return openExecutionDrilldown({
        workerId: failure.workerId,
        workerName: failure.workerName,
        executionId: failure.executionId,
        workerStatus: worker.status,
      });
    }
    return handleViewTrace(worker);
  }

  async function handleInspectReplay(replay) {
    const worker = findWorker(replay.workerId) || { id: replay.workerId, name: replay.workerName, status: null };
    if (replay.executionId) {
      return openExecutionDrilldown({
        workerId: replay.workerId,
        workerName: replay.workerName,
        executionId: replay.executionId,
        workerStatus: worker.status,
      });
    }
    if (replay.sideEffectId) {
      return openSideEffectDrilldown({
        workerId: replay.workerId,
        workerName: replay.workerName,
        sideEffectId: replay.sideEffectId,
      });
    }
  }

  if (loading) return (
    <div>
      <h1 style={S.pageTitle}>Performance</h1>
      <p style={S.pageSub}>Loading metrics...</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {[1, 2, 3, 4].map(i => (
          <div key={i} style={{ height: i === 1 ? 80 : 56, borderRadius: 8, background: "var(--bg-300, var(--bg-hover))", animation: "skeletonPulse 1.5s ease-in-out infinite", animationDelay: `${i * 0.15}s` }} />
        ))}
      </div>
    </div>
  );

  if (workers.length === 0) return (
    <div>
      <h1 style={S.pageTitle}>Performance</h1>
      <p style={S.pageSub}>Track your team's output, cost, and health.</p>
      <div style={{ textAlign: 'center', padding: '3rem 1.5rem', color: 'var(--text-secondary, #999)' }}>
        <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📊</div>
        <div style={{ fontSize: '0.95rem', fontWeight: 500 }}>No execution data yet</div>
        <div style={{ fontSize: '0.85rem', marginTop: '0.25rem', opacity: 0.7 }}>Run a worker to see performance metrics</div>
      </div>
    </div>
  );

  /* ── Trace detail view ───────────────────────────────────────────── */
  if (selectedExecution) {
    return (
      <div>
        <h1 style={S.pageTitle}>Performance</h1>
        <p style={S.pageSub}>
          Execution trace for <strong>{selectedExecution.workerName}</strong>
        </p>
        {(selectedExecution.verificationReport || selectedExecution.interruption || selectedExecution.approvals?.length || selectedExecution.sideEffects?.length) ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, marginBottom: 20 }}>
            <DrilldownCard title="Verification">
              <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
                {selectedExecution.verificationReport?.businessOutcome || "No verifier result"}
              </div>
              {selectedExecution.interruption?.code ? (
                <div style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.5, marginTop: 8 }}>
                  Interruption: {selectedExecution.interruption.code}
                  {selectedExecution.interruption?.detail ? ` · ${selectedExecution.interruption.detail}` : ""}
                </div>
              ) : null}
              {Array.isArray(selectedExecution.verificationReport?.assertions) && selectedExecution.verificationReport.assertions.length > 0 ? (
                <div style={{ marginTop: 10 }}>
                  {selectedExecution.verificationReport.assertions
                    .filter((assertion) => assertion && assertion.passed === false)
                    .slice(0, 4)
                    .map((assertion, index) => (
                      <div key={`${assertion.type || "assertion"}:${index}`} style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.5, marginTop: index === 0 ? 0 : 6 }}>
                        {assertion.type || "failed_assertion"}
                        {assertion.evidence ? ` · ${assertion.evidence}` : ""}
                      </div>
                    ))}
                </div>
              ) : (
                <div style={{ fontSize: "12px", color: "var(--text-tertiary)", marginTop: 8 }}>
                  No failed assertions recorded.
                </div>
              )}
            </DrilldownCard>

            <DrilldownCard title="Approvals">
              {Array.isArray(selectedExecution.approvals) && selectedExecution.approvals.length > 0 ? (
                selectedExecution.approvals.map((approval) => (
                  <div key={approval.id || `${approval.toolName}:${approval.createdAt || "approval"}`} style={{ paddingTop: 8, marginTop: 8, borderTop: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>{approval.toolName || approval.action || "Approval"}</div>
                      <div style={{ fontSize: "11px", color: "var(--text-tertiary)", textTransform: "uppercase" }}>{approval.status || "unknown"}</div>
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.5, marginTop: 4 }}>
                      {approval.matchedRule || "No matched rule"}
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: 6 }}>
                      {approval.decidedAt ? `Decided ${timeAgo(approval.decidedAt)}` : approval.createdAt ? `Requested ${timeAgo(approval.createdAt)}` : "No timestamp"}
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>No approvals tied to this execution.</div>
              )}
            </DrilldownCard>

            <DrilldownCard title="Side effects">
              {Array.isArray(selectedExecution.sideEffects) && selectedExecution.sideEffects.length > 0 ? (
                selectedExecution.sideEffects.map((sideEffect) => (
                  <div key={sideEffect.id || `${sideEffect.toolName}:${sideEffect.target || "side-effect"}`} style={{ paddingTop: 8, marginTop: 8, borderTop: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>{sideEffect.toolName}</div>
                      <div style={{ fontSize: "11px", color: "var(--text-tertiary)", textTransform: "uppercase" }}>{sideEffect.status || "unknown"}</div>
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.5, marginTop: 4 }}>
                      {sideEffect.target || "No target"}{sideEffect.providerRef ? ` · ${sideEffect.providerRef}` : ""}
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: 6 }}>
                      {Number(sideEffect.replayCount || 0) > 0 ? `${sideEffect.replayCount} replay${Number(sideEffect.replayCount) === 1 ? "" : "s"}` : "No replay"}
                      {sideEffect.error ? ` · ${sideEffect.error}` : ""}
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>No outbound side effects recorded for this execution.</div>
              )}
            </DrilldownCard>
          </div>
        ) : null}
        <ExecutionTraceViewer
          execution={selectedExecution}
          activity={selectedExecution.activity}
          live={liveStream}
          onClose={closeDrilldowns}
        />
      </div>
    );
  }

  if (selectedSideEffect) {
    return (
      <div>
        <h1 style={S.pageTitle}>Performance</h1>
        <p style={S.pageSub}>
          Side-effect journal entry for <strong>{selectedSideEffect.workerName}</strong>
        </p>
        <div style={{ marginBottom: 16 }}>
          <DetailActionButton onClick={closeDrilldowns}>
            &larr; Back
          </DetailActionButton>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
          <DrilldownCard title="Journal entry">
            <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
              {selectedSideEffect.toolName || "Unknown tool"}
            </div>
            <div style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.6, marginTop: 8 }}>
              Status: {selectedSideEffect.status || "unknown"}
            </div>
            <div style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.6 }}>
              Target: {selectedSideEffect.target || "none"}
            </div>
            <div style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.6 }}>
              Provider ref: {selectedSideEffect.providerRef || "none"}
            </div>
            <div style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.6 }}>
              Idempotency key: {selectedSideEffect.idempotencyKey || "none"}
            </div>
            <div style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.6 }}>
              Replay count: {Number(selectedSideEffect.replayCount || 0)}
            </div>
            {selectedSideEffect.error ? (
              <div style={{ fontSize: "12px", color: "var(--red, #c43a3a)", lineHeight: 1.6, marginTop: 8 }}>
                {selectedSideEffect.error}
              </div>
            ) : null}
          </DrilldownCard>

          <DrilldownCard title="Request payload">
            <JsonPreview value={selectedSideEffect.requestJson} />
          </DrilldownCard>

          <DrilldownCard title="Provider response">
            <JsonPreview value={selectedSideEffect.responseJson} />
          </DrilldownCard>
        </div>
      </div>
    );
  }

  /* ── Main performance view ───────────────────────────────────────── */
  const totalWorkers = workers.length;
  const activeWorkers = workers.filter(w => w.status === "running").length;
  const totalRuns = workers.reduce((sum, w) => sum + (w.totalRuns || w.total_runs || w.stats?.totalRuns || 0), 0);
  const totalCost = workers.reduce((sum, w) => sum + (typeof w.cost === "number" ? w.cost : 0), 0);
  const errorWorkers = workers.filter(w => w.status === "error").length;

  const stats = [
    { label: "Workers", value: totalWorkers },
    { label: "Active", value: activeWorkers },
    { label: "Total runs", value: totalRuns.toLocaleString() },
    { label: "Total cost", value: `$${totalCost.toFixed(2)}` },
    { label: "Errors", value: errorWorkers },
  ];

  const operatorStats = [
    { label: "At risk", value: opsLoading ? "\u2014" : String(opsSnapshot?.summary?.atRiskWorkers ?? 0) },
    { label: "Pending approvals", value: opsLoading ? "\u2014" : String(opsSnapshot?.summary?.pendingApprovals ?? 0) },
    { label: "Verifier failures", value: opsLoading ? "\u2014" : String(opsSnapshot?.summary?.verifierFailures ?? 0) },
    { label: "Replay count", value: opsLoading ? "\u2014" : String(opsSnapshot?.summary?.replayCount ?? 0) },
    { label: "Unstable rules", value: opsLoading ? "\u2014" : String(opsSnapshot?.summary?.unstableRules ?? 0) },
    { label: "Promotable", value: opsLoading ? "\u2014" : String(opsSnapshot?.summary?.promotionCandidates ?? 0) },
  ];

  const topRiskWorkers = Array.isArray(opsSnapshot?.topRiskWorkers) ? opsSnapshot.topRiskWorkers : [];
  const verifierFailures = Array.isArray(opsSnapshot?.verifierFailures) ? opsSnapshot.verifierFailures : [];
  const sideEffectReplays = Array.isArray(opsSnapshot?.sideEffectReplays) ? opsSnapshot.sideEffectReplays : [];
  const topUnstableRules = Array.isArray(opsSnapshot?.topUnstableRules) ? opsSnapshot.topUnstableRules.slice(0, 4) : [];
  const topPromotionCandidates = Array.isArray(opsSnapshot?.topPromotionCandidates) ? opsSnapshot.topPromotionCandidates.slice(0, 4) : [];
  const operatorWarnings = Array.isArray(opsSnapshot?.warnings) ? opsSnapshot.warnings : [];

  const costSorted = [...workers].filter(w => typeof w.cost === "number" && w.cost > 0).sort((a, b) => b.cost - a.cost);
  const maxCost = costSorted.length > 0 ? costSorted[0].cost : 1;

  const healthColor = (status) => {
    if (status === "running") return "var(--green, #2a9d6e)";
    if (status === "paused") return "var(--amber, #c08c30)";
    if (status === "error") return "var(--red, #c43a3a)";
    return "var(--text-300, #8a8a84)";
  };

  return (
    <div>
      <h1 style={S.pageTitle}>Performance</h1>
      <p style={S.pageSub}>Track your team's output, cost, and health.</p>

      {/* Summary stats strip */}
      <div style={{ display: "flex", gap: 1, background: "var(--border)", borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)", marginBottom: 32 }}>
        {stats.map(stat => (
          <div key={stat.label} style={{ flex: 1, padding: "20px 16px", background: "var(--bg-400)", minWidth: 0 }}>
            <div style={{ fontSize: "24px", fontWeight: 700, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums", fontFamily: "var(--font-display, 'Fraunces', serif)" }}>{stat.value}</div>
            <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 4 }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {(opsLoading || opsSnapshot?.available) && (
        <div style={{ marginBottom: 40 }}>
          <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
            Operator signals
          </div>
          <div style={{ display: "flex", gap: 1, background: "var(--border)", borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)", marginBottom: 16, flexWrap: "wrap" }}>
            {operatorStats.map((stat) => (
              <div key={stat.label} style={{ flex: 1, minWidth: 140, padding: "16px 14px", background: "var(--bg-400)" }}>
                <div style={{ fontSize: "22px", fontWeight: 700, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums", fontFamily: "var(--font-display, 'Fraunces', serif)" }}>
                  {stat.value}
                </div>
                <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 4 }}>
                  {stat.label}
                </div>
              </div>
            ))}
          </div>

          {operatorWarnings.length > 0 && (
            <div style={{ marginBottom: 16, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-300, var(--bg-hover))", color: "var(--text-secondary)", fontSize: "13px", lineHeight: 1.5 }}>
              Operator telemetry is partially degraded: {operatorWarnings.map((warning) => `${warning.source}: ${warning.message}`).join(" | ")}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
            <PerformanceInsightCard
              title="Risk queue"
              subtitle={`Workers that currently need attention across the last ${opsSnapshot?.lookbackDays ?? 30} days.`}
              emptyText={opsLoading ? "Loading risk queue..." : "No workers currently need intervention."}
            >
              {topRiskWorkers.length > 0 ? (
                <div>
                  {topRiskWorkers.map((item) => (
                    <div key={item.workerId} style={{ padding: "12px 0", borderTop: "1px solid var(--border)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                        <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>{item.workerName}</div>
                        <div style={{ fontSize: "12px", color: "var(--text-tertiary)", fontVariantNumeric: "tabular-nums" }}>Risk {item.riskScore}</div>
                      </div>
                      <div style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.5, marginTop: 4 }}>
                        {Array.isArray(item.reasons) && item.reasons.length > 0 ? item.reasons.join(" · ") : "Needs operator review"}
                      </div>
                      <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: 6 }}>
                        {item.lastRunAt ? `Last run ${timeAgo(item.lastRunAt)}` : "No recent run"}
                      </div>
                      <div style={{ marginTop: 10 }}>
                        <DetailActionButton
                          onClick={() => handleInspectRiskWorker(item)}
                          disabled={traceLoading}
                        >
                          Inspect
                        </DetailActionButton>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </PerformanceInsightCard>

            <PerformanceInsightCard
              title="Verifier failures"
              subtitle="Recent executions whose verification receipts failed closed."
              emptyText={opsLoading ? "Loading verifier failures..." : "No recent verifier failures."}
            >
              {verifierFailures.length > 0 ? (
                <div>
                  {verifierFailures.map((failure) => (
                    <div key={`${failure.workerId}:${failure.executionId || failure.startedAt || "failure"}`} style={{ padding: "12px 0", borderTop: "1px solid var(--border)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                        <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>{failure.workerName}</div>
                        <div style={{ fontSize: "12px", color: "var(--red, #c43a3a)", textTransform: "uppercase" }}>{failure.businessOutcome || "failed"}</div>
                      </div>
                      <div style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.5, marginTop: 4 }}>
                        {Array.isArray(failure.failedAssertions) && failure.failedAssertions.length > 0
                          ? failure.failedAssertions
                              .slice(0, 2)
                              .map((assertion) => assertion?.type || "failed_assertion")
                              .join(" · ")
                          : "Verification failed without assertion detail"}
                      </div>
                      <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: 6 }}>
                        {failure.startedAt ? `Started ${timeAgo(failure.startedAt)}` : "No execution timestamp"}
                      </div>
                      <div style={{ marginTop: 10 }}>
                        <DetailActionButton
                          onClick={() => handleInspectVerifierFailure(failure)}
                          disabled={traceLoading}
                        >
                          Inspect
                        </DetailActionButton>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </PerformanceInsightCard>

            <PerformanceInsightCard
              title="Replay activity"
              subtitle="Outbound actions deduplicated and replayed through the side-effect journal."
              emptyText={opsLoading ? "Loading replay activity..." : "No recent replayed side effects."}
            >
              {sideEffectReplays.length > 0 ? (
                <div>
                  {sideEffectReplays.map((replay) => (
                    <div key={`${replay.workerId}:${replay.toolName}:${replay.lastReplayedAt || "replay"}`} style={{ padding: "12px 0", borderTop: "1px solid var(--border)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                        <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>{replay.workerName}</div>
                        <div style={{ fontSize: "12px", color: "var(--text-tertiary)", fontVariantNumeric: "tabular-nums" }}>{replay.replayCount} replay{Number(replay.replayCount) === 1 ? "" : "s"}</div>
                      </div>
                      <div style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.5, marginTop: 4 }}>
                        {replay.toolName}{replay.target ? ` · ${replay.target}` : ""}
                      </div>
                      <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: 6 }}>
                        {replay.lastReplayedAt ? `Last replay ${timeAgo(replay.lastReplayedAt)}` : "No replay timestamp"}
                      </div>
                      <div style={{ marginTop: 10 }}>
                        <DetailActionButton
                          onClick={() => handleInspectReplay(replay)}
                          disabled={traceLoading || (!replay.executionId && !replay.sideEffectId)}
                        >
                          Inspect
                        </DetailActionButton>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </PerformanceInsightCard>

            <PerformanceInsightCard
              title="Charter drift"
              subtitle="Rules trending unstable alongside the best autonomy-promotion candidates."
              emptyText={opsLoading ? "Loading charter drift..." : "No unstable rules or promotion candidates right now."}
            >
              {topUnstableRules.length > 0 || topPromotionCandidates.length > 0 ? (
                <div>
                  {topUnstableRules.length > 0 && (
                    <div>
                      <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
                        Unstable rules
                      </div>
                      {topUnstableRules.map((rule) => (
                        <div key={`${rule.workerId}:${rule.rule}`} style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
                          <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>{rule.workerName}</div>
                          <div style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.5, marginTop: 4 }}>{rule.rule}</div>
                          <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: 6 }}>
                            {Number(rule.denied || 0)} denied · {Number(rule.failedSignals || 0)} failed
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {topPromotionCandidates.length > 0 && (
                    <div style={{ marginTop: topUnstableRules.length > 0 ? 16 : 0 }}>
                      <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
                        Promotion candidates
                      </div>
                      {topPromotionCandidates.map((candidate) => (
                        <div key={`${candidate.workerId}:${candidate.action}`} style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                            <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>{candidate.workerName}</div>
                            <div style={{ fontSize: "12px", color: "var(--green, #2a9d6e)", fontVariantNumeric: "tabular-nums" }}>
                              {Math.round(Number(candidate.confidence || 0) * 100)}%
                            </div>
                          </div>
                          <div style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.5, marginTop: 4 }}>{candidate.action}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </PerformanceInsightCard>
          </div>
        </div>
      )}

      {/* Worker performance table */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>Worker performance</div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ padding: "8px 0", fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", textAlign: "left", borderBottom: "1px solid var(--border)" }}>Status</th>
              <th style={{ padding: "8px 0", fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", textAlign: "left", borderBottom: "1px solid var(--border)" }}>Worker</th>
              <th style={{ padding: "8px 0", fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", textAlign: "right", borderBottom: "1px solid var(--border)", minWidth: 60 }}>Runs</th>
              <th style={{ padding: "8px 0", fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", textAlign: "right", borderBottom: "1px solid var(--border)", minWidth: 60 }}>Cost</th>
              <th style={{ padding: "8px 0", fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", textAlign: "right", borderBottom: "1px solid var(--border)", minWidth: 60 }}>Trace</th>
            </tr>
          </thead>
          <tbody>
            {workers.map(w => {
              const runs = w.totalRuns || w.total_runs || w.stats?.totalRuns || 0;
              const cost = typeof w.cost === "number" ? w.cost : 0;
              const lastRun = w.lastRun || w.lastRunAt || w.last_run_at;
              return (
                <tr key={w.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "14px 12px 14px 0", verticalAlign: "middle" }}>
                    <span style={S.statusDot(healthColor(w.status))} />
                  </td>
                  <td style={{ padding: "14px 0", verticalAlign: "middle" }}>
                    <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.name}</div>
                    <div style={{ fontSize: "12px", color: "var(--text-tertiary)", marginTop: 2 }}>
                      {w.status}{w.schedule ? ` \u00b7 ${humanizeSchedule(w.schedule)}` : ""}
                    </div>
                  </td>
                  <td style={{ padding: "14px 0", fontSize: "13px", color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums", textAlign: "right", minWidth: 60, verticalAlign: "middle" }}>
                    <div>{runs} runs</div>
                    <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: 1 }}>{lastRun ? timeAgo(lastRun) : "\u2014"}</div>
                  </td>
                  <td style={{ padding: "14px 0", fontSize: "13px", color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums", textAlign: "right", minWidth: 60, verticalAlign: "middle" }}>
                    ${cost.toFixed(2)}
                  </td>
                  <td style={{ padding: "14px 0", textAlign: "right", verticalAlign: "middle" }}>
                    <button
                      onClick={() => handleViewTrace(w)}
                      disabled={traceLoading}
                      style={{
                        background: "none", border: "1px solid var(--border)", borderRadius: 6,
                        padding: "4px 10px", fontSize: "11px", fontWeight: 600,
                        color: "var(--text-secondary)", cursor: "pointer",
                        transition: "border-color 0.15s, color 0.15s",
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--accent, var(--product-accent))"; e.currentTarget.style.color = "var(--text-primary)"; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-secondary)"; }}
                    >
                      View trace
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Cost breakdown */}
      {costSorted.length > 0 && (
        <div>
          <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>Cost breakdown</div>
          <div>
            {costSorted.map(w => (
              <div key={w.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: "14px", fontWeight: 500, color: "var(--text-primary)" }}>{w.name}</span>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>${w.cost.toFixed(2)}</span>
                </div>
                <div style={{ height: 4, borderRadius: 2, background: "var(--bg-300, var(--bg-hover))", overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 2, background: "var(--accent)", width: `${(w.cost / maxCost) * 100}%`, transition: "width 0.3s ease" }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default PerformanceView;
