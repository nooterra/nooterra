import React, { useState, useEffect, useRef, useCallback } from "react";
import { S, STATUS_COLORS, ALL_MODELS, MODEL_CATEGORIES, timeAgo, humanizeSchedule, workerApiRequest, WORKER_API_BASE } from "../shared.js";
import { loadRuntimeConfig } from "../api.js";
import CharterDisplay from "../components/CharterDisplay.jsx";
import InlineRuleAdder from "../components/InlineRuleAdder.jsx";
import { WorkerIntegrationsSection } from "./IntegrationsView.jsx";
import FileUploadZone from "../components/FileUploadZone.jsx";

function WorkerDetailView({ workerId, onBack, isNewDeploy, addToast }) {
  const [worker, setWorker] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(isNewDeploy ? "activity" : "charter");
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [runningAction, setRunningAction] = useState(false);
  const [error, setError] = useState("");
  const [editingCharter, setEditingCharter] = useState(false);
  const [editCharter, setEditCharter] = useState(null);
  const [savingCharter, setSavingCharter] = useState(false);

  const toast = useCallback((msg, type = "info") => {
    if (addToast) addToast({ message: msg, type });
  }, [addToast]);

  useEffect(() => { (async () => { try { const result = await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}`, method: "GET" }); setWorker(result?.worker || result); } catch { setWorker(null); } setLoading(false); })(); }, [workerId]);
  useEffect(() => { if (tab === "activity" && workerId) { setLogsLoading(true); (async () => { try { const result = await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}/logs`, method: "GET" }); setLogs(result?.executions || result?.items || (Array.isArray(result) ? result : [])); } catch { setLogs([]); } setLogsLoading(false); })(); } }, [tab, workerId]);
  useEffect(() => { if (!isNewDeploy || !workerId) return; const interval = setInterval(async () => { try { const result = await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}`, method: "GET" }); setWorker(result?.worker || result); if (tab === "activity") { const logResult = await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}/logs`, method: "GET" }); setLogs(logResult?.executions || logResult?.items || (Array.isArray(logResult) ? logResult : [])); } } catch { /* ignore */ } }, 2000); return () => clearInterval(interval); }, [isNewDeploy, workerId, tab]);

  async function handleSaveCharter() {
    if (!editCharter || savingCharter) return;
    setSavingCharter(true);
    try {
      await workerApiRequest({
        pathname: `/v1/workers/${encodeURIComponent(workerId)}`,
        method: "PUT",
        body: { charter: JSON.stringify(editCharter) },
      });
      setWorker(prev => prev ? { ...prev, charter: JSON.stringify(editCharter) } : prev);
      setEditingCharter(false);
      setError("");
      toast("Charter saved", "success");
    } catch (err) {
      setError("Failed to save charter: " + (err?.message || "Unknown error"));
      toast("Failed to save charter", "error");
    }
    setSavingCharter(false);
  }

  async function handleRunNow(shadow = false) {
    setRunningAction(true); setError("");
    try {
      await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}/run`, method: "POST", body: shadow ? { shadow: true } : undefined });
      toast(shadow ? "Shadow run queued" : "Worker queued", "success");
      const result = await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}`, method: "GET" });
      setWorker(result?.worker || result);
      if (shadow) setTab("activity");
    } catch (err) {
      setError(err?.message || "Failed to run worker.");
      toast(err?.message || "Failed to run", "error");
    }
    setRunningAction(false);
  }

  async function handlePauseResume() {
    if (!worker) return;
    setRunningAction(true); setError("");
    const newStatus = worker.status === "paused" ? "ready" : "paused";
    try {
      await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}`, method: "PUT", body: { status: newStatus } });
      setWorker(prev => prev ? { ...prev, status: newStatus } : prev);
      toast(newStatus === "paused" ? "Worker paused" : "Worker resumed", "success");
    } catch (err) {
      setError(err?.message || "Failed to update worker.");
      toast("Failed to update status", "error");
    }
    setRunningAction(false);
  }

  async function handleUpdateSettings(field, value) {
    try {
      await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}`, method: "PUT", body: { [field]: value } });
      setWorker(prev => prev ? { ...prev, [field]: value } : prev);
      toast("Settings saved", "success");
    } catch (err) {
      toast("Failed to save: " + (err?.message || ""), "error");
    }
  }

  if (loading) return (
    <div>
      <button style={S.backLink} onClick={onBack}>{"\u2190"} All workers</button>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 16 }}>
        <div style={{ height: 28, width: 200, borderRadius: 6, background: "var(--bg-300)", animation: "shimmer 1.5s ease-in-out infinite" }} />
        <div style={{ height: 16, width: 300, borderRadius: 4, background: "var(--bg-300)", animation: "shimmer 1.5s ease-in-out infinite", animationDelay: "0.15s" }} />
        <div style={{ height: 40, width: "100%", borderRadius: 10, background: "var(--bg-300)", animation: "shimmer 1.5s ease-in-out infinite", animationDelay: "0.3s" }} />
      </div>
    </div>
  );
  if (!worker) return (<div><button style={S.backLink} onClick={onBack}>{"\u2190"} All workers</button><div style={{ fontSize: "14px", color: "var(--text-secondary)", marginTop: 16 }}>Worker not found.</div></div>);

  const charter = typeof worker.charter === "string" ? (() => { try { return JSON.parse(worker.charter); } catch { return null; } })() : worker.charter;
  const stats = typeof worker.stats === "string" ? (() => { try { return JSON.parse(worker.stats); } catch { return null; } })() : worker.stats;
  const tabs = [{ key: "charter", label: "Charter" }, { key: "chat", label: "Chat" }, { key: "activity", label: "Activity" }, { key: "files", label: "Files" }, { key: "integrations", label: "Integrations" }, { key: "settings", label: "Settings" }];

  return (
    <div>
      <style>{`
        @keyframes shimmer { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.7; } }
        @keyframes activity-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes activity-spin { to { transform: rotate(360deg); } }
        @keyframes activity-fade-slide { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .activity-fade-in { animation: activity-fade-slide 0.3s ease-out; }
        .tab-content-enter { animation: tabFadeIn 0.2s ease-out; }
        @keyframes tabFadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes typingDot { 0%, 80%, 100% { opacity: 0.3; } 40% { opacity: 1; } }
      `}</style>

      <button style={S.backLink} onClick={onBack}>{"\u2190"} All workers</button>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.3rem" }}>
        <h1 style={{ ...S.pageTitle, marginBottom: 0 }}>{worker.name}</h1>
        <span style={{
          fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em",
          color: STATUS_COLORS[worker.status] || STATUS_COLORS.ready,
          padding: "2px 8px", borderRadius: 4,
          background: `color-mix(in srgb, ${STATUS_COLORS[worker.status] || STATUS_COLORS.ready} 12%, transparent)`,
        }}>
          {worker.status}
        </span>
      </div>
      <p style={S.pageSub}>{worker.description || "No description"}</p>

      {error && (
        <div style={{ ...S.error, display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <span>{error}</span>
          <button onClick={() => setError("")} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", fontSize: "14px", opacity: 0.7 }}>&times;</button>
        </div>
      )}

      {/* Integration setup prompt for new deploys */}
      {isNewDeploy && (
        <div style={{ padding: "14px 18px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-surface, var(--bg-400))", marginBottom: "1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            <div>
              <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>Connect integrations</div>
              <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: 1 }}>This worker needs access to external services to take real actions.</div>
            </div>
          </div>
          <button style={{ ...S.btnSecondary, width: "auto", padding: "6px 16px", fontSize: "13px", flexShrink: 0 }} onClick={() => setTab("integrations")}>Set up</button>
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        <button style={{ ...S.btnPrimary, width: "auto", opacity: runningAction ? 0.5 : 1, transition: "opacity 150ms" }} disabled={runningAction} onClick={() => handleRunNow(false)}>
          {runningAction ? "Queuing..." : "Run now"}
        </button>
        <button style={{ ...S.btnSecondary, transition: "opacity 150ms" }} disabled={runningAction} onClick={handlePauseResume}>
          {worker.status === "paused" ? "Resume" : "Pause"}
        </button>
        <button style={{ ...S.btnSecondary, background: "transparent", borderStyle: "dashed", transition: "opacity 150ms" }} disabled={runningAction} onClick={() => handleRunNow(true)}>
          Shadow run
        </button>
      </div>

      {/* Stats strip */}
      {(stats?.totalRuns > 0 || worker.last_run_at || worker.lastRun) && (
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 0, marginBottom: "1.5rem",
          borderRadius: 10, border: "1px solid var(--border)", overflow: "hidden",
        }}>
          {[
            { label: "Last run", value: timeAgo(worker.lastRun || worker.last_run_at) || "Never" },
            stats?.totalRuns != null ? { label: "Runs", value: stats.totalRuns.toLocaleString() } : null,
            stats?.successfulRuns != null && stats?.totalRuns > 0 ? { label: "Success", value: `${Math.round((stats.successfulRuns / stats.totalRuns) * 100)}%`, color: "var(--green, #2a9d6e)" } : null,
            worker.cost != null ? { label: "Cost", value: `$${(typeof worker.cost === "number" ? worker.cost : 0).toFixed(2)}` } : null,
          ].filter(Boolean).map((stat, i) => (
            <div key={i} style={{ flex: 1, minWidth: 80, padding: "12px 16px", borderLeft: i > 0 ? "1px solid var(--border)" : "none", background: "var(--bg-surface, var(--bg-400))" }}>
              <div style={{ fontSize: "10px", fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{stat.label}</div>
              <div style={{ fontSize: "15px", fontWeight: 600, color: stat.color || "var(--text-primary)", fontVariantNumeric: "tabular-nums", marginTop: 2 }}>{stat.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div role="tablist" style={{ display: "flex", gap: "2px", borderBottom: "1px solid var(--border)", marginBottom: "1.5rem" }}>
        {tabs.map(t => (
          <button key={t.key} role="tab" id={`tab-${t.key}`} aria-selected={tab === t.key} onClick={() => setTab(t.key)} style={{
            padding: "0.6rem 1rem", fontSize: "13px", fontWeight: 600,
            color: tab === t.key ? "var(--text-primary)" : "var(--text-tertiary)",
            background: "none", border: "none",
            borderBottom: tab === t.key ? "2px solid var(--accent)" : "2px solid transparent",
            cursor: "pointer", fontFamily: "inherit", marginBottom: -1,
            transition: "color 150ms, border-color 150ms",
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content with entrance animation */}
      <div key={tab} className="tab-content-enter" role="tabpanel" aria-labelledby={`tab-${tab}`}>

      {tab === "charter" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Charter Rules
            </div>
            {!editingCharter ? (
              <button
                onClick={() => { setEditCharter(charter ? { ...charter } : { canDo: [], askFirst: [], neverDo: [] }); setEditingCharter(true); }}
                style={{ fontSize: "12px", fontWeight: 600, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: "4px 8px" }}
              >Edit</button>
            ) : (
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={handleSaveCharter} disabled={savingCharter} style={{
                  fontSize: "12px", fontWeight: 600, color: "var(--bg-100)", background: "var(--green, #5bb98c)",
                  border: "none", borderRadius: 6, cursor: "pointer", fontFamily: "inherit",
                  padding: "4px 12px", opacity: savingCharter ? 0.5 : 1, transition: "opacity 150ms",
                }}>
                  {savingCharter ? "Saving..." : "Save"}
                </button>
                <button onClick={() => { setEditingCharter(false); setEditCharter(null); }} style={{
                  fontSize: "12px", fontWeight: 500, color: "var(--text-secondary)",
                  background: "none", border: "1px solid var(--border)", borderRadius: 6,
                  cursor: "pointer", fontFamily: "inherit", padding: "4px 12px",
                }}>Cancel</button>
              </div>
            )}
          </div>

          {editingCharter && editCharter ? (
            <div>
              {[
                { key: "canDo", label: "Handles on its own", color: "var(--green, #5bb98c)" },
                { key: "askFirst", label: "Asks you first", color: "var(--amber, #c08c30)" },
                { key: "neverDo", label: "Never does", color: "var(--red, #c43a3a)" },
              ].map(sec => {
                const rules = editCharter[sec.key] || [];
                return (
                  <div key={sec.key} style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: sec.color, marginBottom: 6 }}>
                      {sec.label} ({rules.length})
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {rules.map((rule, i) => (
                        <div key={i} style={{
                          display: "flex", alignItems: "center", gap: 6,
                          padding: "5px 10px", borderRadius: 6, fontSize: "13px",
                          borderLeft: `3px solid ${sec.color}`, color: "var(--text-200)",
                          background: "var(--bg-100, rgba(0,0,0,0.02))",
                        }}>
                          <span style={{ flex: 1, lineHeight: 1.5 }}>{rule}</span>
                          <button
                            onClick={() => {
                              const updated = { ...editCharter };
                              updated[sec.key] = rules.filter((_, ri) => ri !== i);
                              setEditCharter(updated);
                            }}
                            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-300)", fontSize: "14px", padding: "0 2px", opacity: 0.6 }}
                            aria-label={`Remove rule: ${rule}`}
                          >&times;</button>
                        </div>
                      ))}
                    </div>
                    <InlineRuleAdder color={sec.color} label={sec.label} onAdd={(text) => {
                      const updated = { ...editCharter };
                      updated[sec.key] = [...(editCharter[sec.key] || []), text];
                      setEditCharter(updated);
                    }} />
                  </div>
                );
              })}
            </div>
          ) : (
            charter ? <CharterDisplay charter={charter} /> : (
              <div style={{ padding: "2rem", textAlign: "center", border: "1px dashed var(--border)", borderRadius: 12 }}>
                <div style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: 8 }}>No charter rules defined yet.</div>
                <button onClick={() => { setEditCharter({ canDo: [], askFirst: [], neverDo: [] }); setEditingCharter(true); }} style={{ ...S.btnSecondary, width: "auto", fontSize: "13px", padding: "6px 16px" }}>Add rules</button>
              </div>
            )
          )}
        </div>
      )}

      {tab === "activity" && (
        <div>
          {/* Running indicator */}
          {worker.status === "running" && (
            <div style={{
              display: "flex", alignItems: "center", gap: 8, padding: "10px 14px",
              borderRadius: 8, background: "var(--accent-subtle, rgba(196,97,58,0.04))",
              border: "1px solid var(--accent)", marginBottom: 16,
            }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)", animation: "activity-pulse 1.5s ease-in-out infinite" }} />
              <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--accent)" }}>Running...</span>
            </div>
          )}

          {isNewDeploy && logs.length === 0 && !logsLoading && (
            <div style={{ padding: "2.5rem", textAlign: "center", border: "1px dashed var(--border)", borderRadius: 12 }}>
              <div style={{ width: 24, height: 24, border: "2px solid var(--border)", borderTop: "2px solid var(--accent)", borderRadius: "50%", animation: "activity-spin 1s linear infinite", margin: "0 auto 1rem" }} />
              <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>Queued</div>
              <div style={{ fontSize: "13px", color: "var(--text-tertiary)" }}>Your worker will run shortly.</div>
            </div>
          )}

          {logsLoading && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[1, 2, 3].map(i => (
                <div key={i} style={{ display: "flex", gap: 12, padding: "10px 0" }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: "var(--bg-300)", animation: "shimmer 1.5s ease-in-out infinite", animationDelay: `${i * 0.1}s` }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ height: 14, width: 80, borderRadius: 4, background: "var(--bg-300)", animation: "shimmer 1.5s ease-in-out infinite", animationDelay: `${i * 0.1}s`, marginBottom: 6 }} />
                    <div style={{ height: 12, width: "60%", borderRadius: 4, background: "var(--bg-300)", animation: "shimmer 1.5s ease-in-out infinite", animationDelay: `${i * 0.1 + 0.05}s` }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!logsLoading && logs.length === 0 && !isNewDeploy && (
            <div style={{ textAlign: 'center', padding: '3rem 1.5rem', color: 'var(--text-secondary, #999)' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📝</div>
              <div style={{ fontSize: '0.95rem', fontWeight: 500 }}>No activity yet</div>
              <div style={{ fontSize: '0.85rem', marginTop: '0.25rem', opacity: 0.7 }}>This worker hasn't run yet</div>
            </div>
          )}

          {logs.length > 0 && (
            <div>
              {logs.map((entry, i) => (
                <ActivityLogEntry key={entry.id || entry.ts || i} entry={entry} isNew={isNewDeploy && i >= logs.length - 3} />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "chat" && (
        <WorkerChat workerId={workerId} workerName={worker.name} model={worker.model} />
      )}

      {tab === "files" && (
        <div style={{ maxWidth: 520 }}>
          <FileUploadZone workerId={workerId} addToast={addToast} />
        </div>
      )}

      {tab === "integrations" && (
        <div style={{ maxWidth: 480 }}>
          <WorkerIntegrationsSection workerId={workerId} />
        </div>
      )}

      {tab === "settings" && (
        <SettingsTab worker={worker} onUpdate={handleUpdateSettings} />
      )}

      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings Tab — editable model picker + schedule display
// ---------------------------------------------------------------------------

function SettingsTab({ worker, onUpdate }) {
  const [selectedModel, setSelectedModel] = useState(worker.model || "");
  const [saving, setSaving] = useState(false);
  const modelInfo = ALL_MODELS.find(m => m.id === selectedModel);

  // Chain config
  const workerChain = typeof worker.chain === "string" ? (() => { try { return JSON.parse(worker.chain); } catch { return null; } })() : worker.chain;
  const [chainTarget, setChainTarget] = useState(workerChain?.onComplete || "");
  const [chainPassResult, setChainPassResult] = useState(workerChain?.passResult ?? true);
  const [chainWorkers, setChainWorkers] = useState([]);
  const [chainSaving, setChainSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const result = await workerApiRequest({ pathname: "/v1/workers", method: "GET" });
        const all = result?.workers || result?.items || (Array.isArray(result) ? result : []);
        setChainWorkers(all.filter(w => w.id !== worker.id && w.status !== "archived"));
      } catch { setChainWorkers([]); }
    })();
  }, [worker.id]);

  async function handleChainSave() {
    setChainSaving(true);
    const chainValue = chainTarget ? { onComplete: chainTarget, passResult: chainPassResult } : null;
    await onUpdate("chain", chainValue);
    setChainSaving(false);
  }

  async function handleModelChange(newModel) {
    setSelectedModel(newModel);
    setSaving(true);
    await onUpdate("model", newModel);
    setSaving(false);
  }

  return (
    <div style={{ maxWidth: 520 }}>
      <div style={{ marginBottom: 24 }}>
        <label style={{ ...S.label, marginBottom: 8, display: "block" }}>Model</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {MODEL_CATEGORIES.map(cat => {
            const models = ALL_MODELS.filter(m => m.category === cat.key);
            if (models.length === 0) return null;
            return (
              <div key={cat.key}>
                <div style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-tertiary)", padding: "8px 0 4px" }}>{cat.label}</div>
                {models.map(m => (
                  <button key={m.id} onClick={() => handleModelChange(m.id)} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    width: "100%", padding: "8px 12px", borderRadius: 6,
                    border: m.id === selectedModel ? "1px solid var(--accent)" : "1px solid transparent",
                    background: m.id === selectedModel ? "var(--accent-subtle, rgba(196,97,58,0.04))" : "transparent",
                    cursor: "pointer", fontFamily: "inherit", textAlign: "left",
                    transition: "background 100ms, border-color 100ms",
                  }}
                  onMouseEnter={e => { if (m.id !== selectedModel) e.currentTarget.style.background = "var(--bg-hover, var(--bg-300))"; }}
                  onMouseLeave={e => { if (m.id !== selectedModel) e.currentTarget.style.background = "transparent"; }}
                  >
                    <div>
                      <span style={{ fontSize: "13px", fontWeight: m.id === selectedModel ? 600 : 400, color: "var(--text-primary)" }}>{m.name}</span>
                      <span style={{ fontSize: "11px", color: "var(--text-tertiary)", marginLeft: 8 }}>{m.provider}</span>
                    </div>
                    <span style={{ fontSize: "12px", color: "var(--text-tertiary)", fontVariantNumeric: "tabular-nums" }}>{m.price}/M</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ marginBottom: 24 }}>
        <label style={{ ...S.label, marginBottom: 4, display: "block" }}>Schedule</label>
        <div style={{ fontSize: "14px", color: "var(--text-primary)" }}>{humanizeSchedule(worker.schedule) || "Manual (on-demand)"}</div>
        <div style={{ fontSize: "12px", color: "var(--text-tertiary)", marginTop: 2 }}>Schedule changes coming soon. Use the builder to set a schedule.</div>
      </div>

      {/* Execution Chain */}
      <div style={{ marginBottom: 24 }}>
        <label style={{ ...S.label, marginBottom: 8, display: "block" }}>Execution Chain</label>
        <div style={{ fontSize: "12px", color: "var(--text-tertiary)", marginBottom: 8 }}>After this worker completes, automatically run another worker.</div>
        <select
          value={chainTarget}
          onChange={(e) => setChainTarget(e.target.value)}
          style={{
            width: "100%", padding: "8px 12px", borderRadius: 8,
            border: "1px solid var(--border)", background: "var(--bg-surface, var(--bg-400))",
            color: "var(--text-primary)", fontSize: "13px", fontFamily: "inherit",
            cursor: "pointer", appearance: "auto",
          }}
        >
          <option value="">None (no chain)</option>
          {chainWorkers.map(w => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>

        {chainTarget && (
          <div style={{ marginTop: 10 }}>
            <label style={{
              display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
              fontSize: "13px", color: "var(--text-secondary)",
            }}>
              <input
                type="checkbox"
                checked={chainPassResult}
                onChange={(e) => setChainPassResult(e.target.checked)}
                style={{ accentColor: "var(--accent)" }}
              />
              Pass result as context to next worker
            </label>

            {/* Visual chain display */}
            <div style={{
              display: "flex", alignItems: "center", gap: 8, marginTop: 12,
              padding: "10px 14px", borderRadius: 8,
              background: "var(--bg-surface, var(--bg-400))", border: "1px solid var(--border)",
            }}>
              <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>{worker.name}</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
              </svg>
              <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--accent)" }}>
                {chainWorkers.find(w => w.id === chainTarget)?.name || chainTarget}
              </span>
            </div>
          </div>
        )}

        <button
          onClick={handleChainSave}
          disabled={chainSaving}
          style={{
            marginTop: 10, padding: "6px 16px", borderRadius: 6, fontSize: "13px",
            fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
            background: "var(--accent)", color: "#fff", border: "none",
            opacity: chainSaving ? 0.5 : 1, transition: "opacity 150ms",
          }}
        >
          {chainSaving ? "Saving..." : "Save chain"}
        </button>
      </div>

      <div style={{ marginBottom: 24 }}>
        <label style={{ ...S.label, marginBottom: 4, display: "block" }}>Worker ID</label>
        <div style={{ fontSize: "13px", color: "var(--text-tertiary)", fontFamily: "var(--font-mono, monospace)", padding: "6px 10px", background: "var(--bg-300, var(--bg-hover))", borderRadius: 6, userSelect: "all" }}>{worker.id}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Worker Chat — conversational interface to a specific worker
// ---------------------------------------------------------------------------

function WorkerChat({ workerId, workerName, model }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!streaming && inputRef.current) inputRef.current.focus();
  }, [streaming]);

  async function handleSend() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    setError("");

    const now = new Date().toISOString();
    const userMsg = { role: "user", content: text, ts: now };
    const updatedMessages = [...messages, userMsg];
    setMessages([...updatedMessages, { role: "assistant", content: "", ts: now }]);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const runtime = loadRuntimeConfig();
      const res = await fetch(`${WORKER_API_BASE}/v1/workers/${encodeURIComponent(workerId)}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-tenant-id": runtime.tenantId },
        credentials: "include",
        body: JSON.stringify({ messages: updatedMessages.map(m => ({ role: m.role, content: m.content })) }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullResponse = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") break;
          try {
            const p = JSON.parse(data);
            if (p.error) { setError(p.error); break; }
            const d = p.choices?.[0]?.delta?.content || "";
            if (d) {
              fullResponse += d;
              setMessages(prev => {
                const copy = [...prev];
                copy[copy.length - 1] = { role: "assistant", content: fullResponse, ts: now };
                return copy;
              });
            }
          } catch {}
        }
      }

      setMessages(prev => {
        const copy = [...prev];
        if (copy[copy.length - 1]?.role === "assistant") {
          copy[copy.length - 1] = { role: "assistant", content: fullResponse || "(No response)", ts: new Date().toISOString() };
        }
        return copy;
      });
    } catch (err) {
      if (err.name !== "AbortError") {
        setError(err.message || "Chat failed");
        setMessages(prev => prev.filter(m => !(m.role === "assistant" && m.content === "")));
      }
    }

    setStreaming(false);
    abortRef.current = null;
  }

  function handleCopy(text) {
    navigator.clipboard?.writeText(text);
  }

  const modelName = ALL_MODELS.find(m => m.id === model)?.name || model?.split("/").pop() || "AI";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "min(65vh, 560px)" }}>
      <div ref={scrollRef} style={{
        flex: 1, overflowY: "auto", padding: "8px 0",
        display: "flex", flexDirection: "column", gap: 16,
      }}>
        {messages.length === 0 && (
          <div style={{ padding: "3rem 1rem", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 48, height: 48, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center",
              background: "var(--accent-subtle, rgba(196,97,58,0.06))", border: "1px solid var(--border)",
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>Chat with {workerName}</div>
              <div style={{ fontSize: "13px", color: "var(--text-tertiary)", maxWidth: 320, lineHeight: 1.5 }}>
                Ask questions, give instructions, or check on their work. This worker uses its charter and memory to respond.
              </div>
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} style={{
            display: "flex", flexDirection: "column",
            alignItems: msg.role === "user" ? "flex-end" : "flex-start",
            gap: 4,
          }}>
            {/* Sender label */}
            <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", paddingLeft: 4, paddingRight: 4 }}>
              {msg.role === "user" ? "You" : workerName}
            </div>
            {/* Bubble */}
            <div style={{
              maxWidth: "85%", padding: "10px 14px", borderRadius: 12,
              fontSize: "14px", lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word",
              position: "relative",
              ...(msg.role === "user" ? {
                background: "var(--accent, #c4613a)", color: "var(--bg-100)", borderBottomRightRadius: 4,
              } : {
                background: "var(--bg-300, var(--bg-hover))", color: "var(--text-primary)", borderBottomLeftRadius: 4,
              }),
            }}>
              {msg.content || (streaming && i === messages.length - 1 ? (
                <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
                  {[0, 1, 2].map(d => (
                    <span key={d} style={{
                      width: 5, height: 5, borderRadius: "50%",
                      background: "var(--text-tertiary)",
                      animation: `typingDot 1.4s ease-in-out ${d * 0.2}s infinite`,
                    }} />
                  ))}
                </span>
              ) : "")}
            </div>
            {/* Timestamp + copy */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 4, paddingRight: 4 }}>
              {msg.ts && (
                <span style={{ fontSize: "10px", color: "var(--text-tertiary)", fontVariantNumeric: "tabular-nums" }}>
                  {new Date(msg.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
              {msg.role === "assistant" && msg.content && !streaming && (
                <button onClick={() => handleCopy(msg.content)} style={{
                  background: "none", border: "none", cursor: "pointer", padding: 0,
                  color: "var(--text-tertiary)", fontSize: "10px", opacity: 0.6,
                  display: "flex", alignItems: "center", gap: 3,
                }}
                onMouseEnter={e => { e.currentTarget.style.opacity = "1"; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = "0.6"; }}
                aria-label="Copy message"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  Copy
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {error && <div style={{ ...S.error, marginBottom: 8, fontSize: "13px" }}>{error}</div>}

      {/* Input */}
      <div style={{
        display: "flex", gap: 8, paddingTop: 12,
        borderTop: "1px solid var(--border)",
        alignItems: "flex-end",
      }}>
        <div style={{ flex: 1, position: "relative" }}>
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder={`Message ${workerName}...`}
            disabled={streaming}
            style={{
              width: "100%", padding: "10px 14px", fontSize: "14px",
              fontFamily: "inherit", border: "1px solid var(--border)",
              borderRadius: 10, background: "var(--bg-400, var(--bg-surface))",
              color: "var(--text-primary)", outline: "none", boxSizing: "border-box",
              transition: "border-color 150ms, opacity 150ms",
              opacity: streaming ? 0.5 : 1,
            }}
            onFocus={e => { e.currentTarget.style.borderColor = "var(--accent)"; }}
            onBlur={e => { e.currentTarget.style.borderColor = "var(--border)"; }}
          />
          {!streaming && (
            <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontSize: "10px", color: "var(--text-tertiary)", opacity: 0.5, pointerEvents: "none" }}>
              Enter
            </span>
          )}
        </div>
        <button
          onClick={streaming ? () => abortRef.current?.abort() : handleSend}
          disabled={!streaming && !input.trim()}
          style={{
            ...S.btnPrimary, width: "auto", padding: "10px 18px",
            opacity: (!streaming && !input.trim()) ? 0.3 : 1,
            flexShrink: 0, transition: "opacity 150ms",
            ...(streaming ? { background: "var(--red, #c43a3a)" } : {}),
          }}
        >
          {streaming ? "Stop" : "Send"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity Log
// ---------------------------------------------------------------------------

const ActivityIcons = {
  play: (c) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>,
  sparkle: (c) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4"/></svg>,
  zap: (c) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
  tool: (c) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>,
  check: (c) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
  shield: (c) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  pause: (c) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>,
  alert: (c) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
  x: (c) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  refresh: (c) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>,
  eye: (c) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
  brain: (c) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>,
  dot: (c) => <svg width="14" height="14" viewBox="0 0 24 24" fill={c}><circle cx="12" cy="12" r="4"/></svg>,
};

function ActivityLogEntry({ entry, isNew }) {
  const typeConfig = {
    start: { icon: "play", color: "var(--green, #5bb98c)", label: "Started" },
    llm_call: { icon: "sparkle", color: "var(--accent, #c4613a)", label: "Thinking" },
    llm_response: { icon: "sparkle", color: "var(--accent, #c4613a)", label: "Response" },
    tools_loaded: { icon: "zap", color: "var(--text-300)", label: "Tools" },
    tool_calls: { icon: "tool", color: "var(--accent, #c4613a)", label: "Tool calls" },
    tool_exec: { icon: "tool", color: "var(--accent, #c4613a)", label: "Executing" },
    tool_result: { icon: "check", color: "var(--green, #2a9d6e)", label: "Result" },
    charter_block: { icon: "shield", color: "var(--red, #c43a3a)", label: "Blocked" },
    charter_approval: { icon: "pause", color: "var(--amber, #c08c30)", label: "Approval" },
    charter_warn: { icon: "alert", color: "var(--amber, #c08c30)", label: "Warning" },
    anomaly_detected: { icon: "alert", color: "var(--red, #c43a3a)", label: "Anomaly" },
    error: { icon: "x", color: "var(--red, #c43a3a)", label: "Error" },
    loop_limit: { icon: "refresh", color: "var(--amber, #c08c30)", label: "Loop limit" },
    shadow: { icon: "eye", color: "var(--text-200, #a3a39d)", label: "Shadow mode" },
    shadow_tool: { icon: "eye", color: "var(--text-200, #a3a39d)", label: "Would execute" },
    shadow_completed: { icon: "check", color: "var(--text-200, #a3a39d)", label: "Shadow complete" },
    memory: { icon: "brain", color: "var(--accent, #c4613a)", label: "Memory" },
    cost_cap: { icon: "alert", color: "var(--red, #c43a3a)", label: "Cost cap" },
    rate_limited: { icon: "pause", color: "var(--amber, #c08c30)", label: "Rate limited" },
  };

  const config = typeConfig[entry.type] || { icon: "dot", color: "var(--text-300)", label: entry.type || "Event" };
  const IconFn = ActivityIcons[config.icon] || ActivityIcons.dot;

  return (
    <div className={isNew ? "activity-fade-in" : ""} style={{
      display: "flex", gap: 12, padding: "10px 0",
      borderBottom: "1px solid var(--border)",
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: 8, flexShrink: 0,
        background: `color-mix(in srgb, ${config.color} 10%, transparent)`,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {IconFn(config.color)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "13px", fontWeight: 600, color: config.color }}>{config.label}</span>
          <span style={{ fontSize: "11px", color: "var(--text-tertiary)", fontFamily: "var(--font-mono, monospace)", fontVariantNumeric: "tabular-nums" }}>
            {entry.ts ? new Date(entry.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : entry.time ? timeAgo(entry.time) : ""}
          </span>
        </div>
        <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: 2, lineHeight: 1.5, wordBreak: "break-word" }}>
          {entry.detail || entry.summary || ""}
        </div>
      </div>
    </div>
  );
}


export default WorkerDetailView;
