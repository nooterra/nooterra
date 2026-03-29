import React, { useState, useEffect, useRef } from "react";
import { S, STATUS_COLORS, ALL_MODELS, MODEL_CATEGORIES, timeAgo, humanizeSchedule, workerApiRequest, WORKER_API_BASE } from "../shared.js";
import { loadRuntimeConfig } from "../api.js";
import CharterDisplay from "../components/CharterDisplay.jsx";
import InlineRuleAdder from "../components/InlineRuleAdder.jsx";
import { WorkerIntegrationsSection } from "./IntegrationsView.jsx";

function WorkerDetailView({ workerId, onBack, isNewDeploy }) {
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

  useEffect(() => { (async () => { try { const result = await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}`, method: "GET" }); setWorker(result?.worker || result); } catch { setWorker(null); } setLoading(false); })(); }, [workerId]);
  useEffect(() => { if (tab === "activity" && workerId) { setLogsLoading(true); (async () => { try { const result = await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}/logs`, method: "GET" }); setLogs(result?.executions || result?.items || (Array.isArray(result) ? result : [])); } catch { setLogs([]); } setLogsLoading(false); })(); } }, [tab, workerId]);
  useEffect(() => { if (!isNewDeploy || !workerId) return; const interval = setInterval(async () => { try { const result = await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}`, method: "GET" }); setWorker(result?.worker || result); if (tab === "activity") { const logResult = await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}/logs`, method: "GET" }); setLogs(logResult?.executions || logResult?.items || (Array.isArray(result) ? result : [])); } } catch { /* ignore */ } }, 2000); return () => clearInterval(interval); }, [isNewDeploy, workerId, tab]);

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
    } catch (err) {
      setError("Failed to save charter: " + (err?.message || "Unknown error"));
    }
    setSavingCharter(false);
  }

  async function handleRunNow() { setRunningAction(true); setError(""); try { await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}/run`, method: "POST" }); const result = await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}`, method: "GET" }); setWorker(result); } catch (err) { setError(err?.message || "Failed to run worker."); } setRunningAction(false); }
  async function handlePauseResume() { if (!worker) return; setRunningAction(true); setError(""); const newStatus = worker.status === "paused" ? "ready" : "paused"; try { await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}`, method: "PUT", body: { status: newStatus } }); setWorker(prev => prev ? { ...prev, status: newStatus } : prev); } catch (err) { setError(err?.message || "Failed to update worker."); } setRunningAction(false); }

  if (loading) return (<div><button style={S.backLink} onClick={onBack}>{"\u2190"} All workers</button><div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Loading...</div></div>);
  if (!worker) return (<div><button style={S.backLink} onClick={onBack}>{"\u2190"} All workers</button><div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Worker not found.</div></div>);

  const charter = typeof worker.charter === "string" ? (() => { try { return JSON.parse(worker.charter); } catch { return null; } })() : worker.charter;
  const tabs = [{ key: "charter", label: "Charter" }, { key: "chat", label: "Chat" }, { key: "activity", label: "Activity" }, { key: "integrations", label: "Integrations" }, { key: "settings", label: "Settings" }];

  return (
    <div>
      <button style={S.backLink} onClick={onBack}>{"\u2190"} All workers</button>
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "0.3rem" }}>
        <h1 style={{ ...S.pageTitle, marginBottom: 0 }}>{worker.name}</h1>
        <span style={S.statusDot(STATUS_COLORS[worker.status] || STATUS_COLORS.ready)} />
        <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>{worker.status}</span>
      </div>
      <p style={S.pageSub}>{worker.description || "No description"}</p>
      {error && <div style={S.error}>{error}</div>}

      {/* Integration setup prompt for new deploys */}
      {isNewDeploy && (
        <div style={{ padding: "16px 20px", borderRadius: 12, border: "1px solid var(--accent)", background: "var(--accent-subtle, rgba(196,97,58,0.04))", marginBottom: "1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>Connect integrations</div>
            <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: 2 }}>This worker may need access to external services to run effectively.</div>
          </div>
          <button style={{ ...S.btnSecondary, width: "auto", padding: "6px 16px", fontSize: "13px", flexShrink: 0 }} onClick={() => setTab("integrations")}>Set up</button>
        </div>
      )}

      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "2rem" }}>
        <button style={{ ...S.btnPrimary, width: "auto", opacity: runningAction ? 0.5 : 1 }} disabled={runningAction} onClick={handleRunNow}>{runningAction ? "Running..." : "Run now"}</button>
        <button style={S.btnSecondary} disabled={runningAction} onClick={handlePauseResume}>{worker.status === "paused" ? "Resume" : "Pause"}</button>
        <button style={{ ...S.btnSecondary, background: "transparent", borderStyle: "dashed" }} disabled={runningAction} onClick={async () => {
          setRunningAction(true); setError("");
          try {
            await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}/run`, method: "POST", body: { shadow: true } });
            const result = await workerApiRequest({ pathname: `/v1/workers/${encodeURIComponent(workerId)}`, method: "GET" });
            setWorker(result);
            setTab("activity");
          } catch (err) { setError(err?.message || "Failed to run shadow."); }
          setRunningAction(false);
        }}>Shadow run</button>
      </div>
      {/* Last run summary */}
      {(worker.lastRun || worker.lastRunAt) && (
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 12, marginBottom: "1.5rem",
          padding: "14px 18px", borderRadius: 10,
          border: "1px solid var(--border)", background: "var(--bg-surface, var(--bg-400))",
        }}>
          <div>
            <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Last run</div>
            <div style={{ fontSize: "14px", color: "var(--text-primary)", fontVariantNumeric: "tabular-nums", marginTop: 2 }}>
              {timeAgo(worker.lastRun || worker.lastRunAt)}
            </div>
          </div>
          {worker.stats?.totalRuns != null && (
            <div>
              <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Total runs</div>
              <div style={{ fontSize: "14px", color: "var(--text-primary)", fontVariantNumeric: "tabular-nums", marginTop: 2 }}>
                {worker.stats.totalRuns}
              </div>
            </div>
          )}
          {worker.stats?.successfulRuns != null && worker.stats?.totalRuns > 0 && (
            <div>
              <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Success rate</div>
              <div style={{ fontSize: "14px", color: "var(--green, #5bb98c)", fontVariantNumeric: "tabular-nums", marginTop: 2 }}>
                {Math.round((worker.stats.successfulRuns / worker.stats.totalRuns) * 100)}%
              </div>
            </div>
          )}
          {worker.cost != null && (
            <div>
              <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Cost this period</div>
              <div style={{ fontSize: "14px", color: "var(--text-primary)", fontVariantNumeric: "tabular-nums", marginTop: 2 }}>
                ${(typeof worker.cost === "number" ? worker.cost : 0).toFixed(2)}
              </div>
            </div>
          )}
        </div>
      )}
      <div style={{ display: "flex", gap: "4px", borderBottom: "1px solid var(--border)", marginBottom: "2rem" }}>
        {tabs.map(t => <button key={t.key} onClick={() => setTab(t.key)} style={{ padding: "0.6rem 1rem", fontSize: "14px", fontWeight: 600, color: tab === t.key ? "var(--text-primary)" : "var(--text-secondary)", background: "none", border: "none", borderBottom: tab === t.key ? "2px solid var(--accent)" : "2px solid transparent", cursor: "pointer", fontFamily: "inherit", marginBottom: -1 }}>{t.label}</button>)}
      </div>
      {tab === "charter" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Charter Rules
            </div>
            {!editingCharter ? (
              <button
                onClick={() => { setEditCharter(charter ? { ...charter } : { canDo: [], askFirst: [], neverDo: [] }); setEditingCharter(true); }}
                style={{
                  fontSize: "12px", fontWeight: 600, color: "var(--accent)",
                  background: "none", border: "none", cursor: "pointer",
                  fontFamily: "inherit", padding: "4px 8px",
                }}
              >
                Edit
              </button>
            ) : (
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={handleSaveCharter}
                  disabled={savingCharter}
                  style={{
                    fontSize: "12px", fontWeight: 600, color: "#fff",
                    background: "var(--green, #5bb98c)", border: "none",
                    borderRadius: 6, cursor: "pointer", fontFamily: "inherit",
                    padding: "4px 12px", opacity: savingCharter ? 0.5 : 1,
                  }}
                >
                  {savingCharter ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={() => { setEditingCharter(false); setEditCharter(null); }}
                  style={{
                    fontSize: "12px", fontWeight: 500, color: "var(--text-200, var(--text-secondary))",
                    background: "none", border: "1px solid var(--border)",
                    borderRadius: 6, cursor: "pointer", fontFamily: "inherit",
                    padding: "4px 12px",
                  }}
                >
                  Cancel
                </button>
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
            charter ? <CharterDisplay charter={charter} /> : <div style={{ fontSize: "13px", color: "var(--text-tertiary)" }}>No charter rules defined.</div>
          )}
        </div>
      )}
      {tab === "activity" && (
        <div>
          <style>{`
            @keyframes activity-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
            @keyframes activity-spin { to { transform: rotate(360deg); } }
            @keyframes activity-fade-slide { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
            .activity-fade-in { animation: activity-fade-slide 0.3s ease-out; }
          `}</style>

          {/* Running indicator */}
          {worker.status === "running" && (
            <div style={{
              display: "flex", alignItems: "center", gap: 8, padding: "12px 16px",
              borderRadius: 10, background: "var(--accent-subtle, rgba(196,97,58,0.04))",
              border: "1px solid var(--accent)", marginBottom: 16,
            }}>
              <div style={{
                width: 8, height: 8, borderRadius: "50%", background: "var(--accent)",
                animation: "activity-pulse 1.5s ease-in-out infinite",
              }} />
              <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--accent)" }}>Running...</span>
            </div>
          )}

          {/* Queued state for new deploys */}
          {isNewDeploy && logs.length === 0 && !logsLoading && (
            <div style={{ padding: "2rem", textAlign: "center", border: "1px dashed var(--border)", borderRadius: 12 }}>
              <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "0.5rem" }}>Your worker is queued and will run shortly.</div>
              <div style={{ width: 24, height: 24, border: "2px solid var(--border)", borderTop: "2px solid var(--accent)", borderRadius: "50%", animation: "activity-spin 1s linear infinite", margin: "1rem auto 0" }} />
            </div>
          )}

          {logsLoading && <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>Loading logs...</div>}

          {!logsLoading && logs.length === 0 && !isNewDeploy && (
            <div style={{ fontSize: "14px", color: "var(--text-secondary)" }}>No activity yet. This worker hasn't run.</div>
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
      {tab === "integrations" && (
        <div style={{ maxWidth: 480 }}>
          <WorkerIntegrationsSection workerId={workerId} />
        </div>
      )}
      {tab === "settings" && (
        <div style={{ maxWidth: 480 }}>
          <label style={S.label}>Schedule</label>
          <div style={{ fontSize: "14px", color: "var(--text-primary)", marginBottom: "1rem" }}>{humanizeSchedule(worker.schedule) || "Manual (on-demand)"}</div>
          {worker.model && (<><label style={S.label}>Model</label><div style={{ fontSize: "14px", color: "var(--text-primary)", marginBottom: "2rem" }}>{ALL_MODELS.find(m => m.id === worker.model)?.name || worker.model}</div></>)}
        </div>
      )}
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
  const abortRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  async function handleSend() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    setError("");

    const userMsg = { role: "user", content: text };
    const updatedMessages = [...messages, userMsg];
    setMessages([...updatedMessages, { role: "assistant", content: "" }]);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const runtime = loadRuntimeConfig();
      const res = await fetch(`${WORKER_API_BASE}/v1/workers/${encodeURIComponent(workerId)}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-tenant-id": runtime.tenantId },
        credentials: "include",
        body: JSON.stringify({ messages: updatedMessages }),
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
                copy[copy.length - 1] = { role: "assistant", content: fullResponse };
                return copy;
              });
            }
          } catch {}
        }
      }

      // Finalize — make sure the last message has the full content
      setMessages(prev => {
        const copy = [...prev];
        if (copy[copy.length - 1]?.role === "assistant") {
          copy[copy.length - 1] = { role: "assistant", content: fullResponse || "(No response)" };
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

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "min(60vh, 500px)" }}>
      {/* Messages */}
      <div ref={scrollRef} style={{
        flex: 1, overflowY: "auto", padding: "12px 0",
        display: "flex", flexDirection: "column", gap: 12,
      }}>
        {messages.length === 0 && (
          <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-tertiary)", fontSize: "14px" }}>
            Chat with <strong style={{ color: "var(--text-secondary)" }}>{workerName}</strong> — ask questions, give instructions, or check on their work.
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} style={{
            display: "flex",
            justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
          }}>
            <div style={{
              maxWidth: "80%", padding: "10px 14px", borderRadius: 12,
              fontSize: "14px", lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word",
              ...(msg.role === "user" ? {
                background: "var(--accent, #c4613a)",
                color: "#fff",
                borderBottomRightRadius: 4,
              } : {
                background: "var(--bg-300, var(--bg-hover))",
                color: "var(--text-primary)",
                borderBottomLeftRadius: 4,
              }),
            }}>
              {msg.content || (streaming && i === messages.length - 1 ? (
                <span style={{ opacity: 0.5 }}>Thinking...</span>
              ) : "")}
            </div>
          </div>
        ))}
      </div>

      {error && <div style={{ ...S.error, marginBottom: 8 }}>{error}</div>}

      {/* Input */}
      <div style={{
        display: "flex", gap: 8, paddingTop: 12,
        borderTop: "1px solid var(--border)",
      }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder={`Message ${workerName}...`}
          disabled={streaming}
          style={{
            flex: 1, padding: "10px 14px", fontSize: "14px",
            fontFamily: "inherit", border: "1px solid var(--border)",
            borderRadius: 8, background: "var(--bg-400, var(--bg-surface))",
            color: "var(--text-primary)", outline: "none",
            opacity: streaming ? 0.6 : 1,
          }}
          onFocus={e => { e.currentTarget.style.borderColor = "var(--accent)"; }}
          onBlur={e => { e.currentTarget.style.borderColor = "var(--border)"; }}
        />
        <button
          onClick={streaming ? () => abortRef.current?.abort() : handleSend}
          disabled={!streaming && !input.trim()}
          style={{
            ...S.btnPrimary, width: "auto", padding: "10px 20px",
            opacity: (!streaming && !input.trim()) ? 0.4 : 1,
            flexShrink: 0,
          }}
        >
          {streaming ? "Stop" : "Send"}
        </button>
      </div>
    </div>
  );
}

// Clean SVG icons — no emoji, professional like Claude/Linear/Vercel
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
        background: `${config.color}15`,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {IconFn(config.color)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "13px", fontWeight: 600, color: config.color }}>{config.label}</span>
          <span style={{ fontSize: "11px", color: "var(--text-300)", fontFamily: "var(--font-mono)" }}>
            {entry.ts ? new Date(entry.ts).toLocaleTimeString() : entry.time ? timeAgo(entry.time) : ""}
          </span>
        </div>
        <div style={{ fontSize: "13px", color: "var(--text-200)", marginTop: 2, lineHeight: 1.5, wordBreak: "break-word" }}>
          {entry.detail || entry.summary || ""}
        </div>
      </div>
    </div>
  );
}


export default WorkerDetailView;
