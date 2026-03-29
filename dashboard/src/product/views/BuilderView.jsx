import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  S, ALL_MODELS, MODEL_CATEGORIES, WORKER_TEMPLATES, WORKER_API_BASE,
  workerApiRequest, saveOnboardingState, loadOnboardingState,
  parseWorkerDefinition, stripWorkerDefinitionBlock, navigate,
} from "../shared.js";
import { loadRuntimeConfig } from "../api.js";
import ModelDropdown from "../components/ModelDropdown.jsx";
import CharterDisplay from "../components/CharterDisplay.jsx";
import InlineRuleAdder from "../components/InlineRuleAdder.jsx";
import { AVAILABLE_INTEGRATIONS } from "./IntegrationsView.jsx";

/* ===================================================================
   SendArrow
   =================================================================== */

function SendArrow({ disabled, onClick }) {
  return (
    <button
      onClick={onClick} disabled={disabled} aria-label="Send"
      style={{
        width: 32, height: 32, borderRadius: "50%",
        background: disabled ? "var(--bg-hover)" : "var(--text-primary)",
        border: "none", cursor: disabled ? "default" : "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0, transition: "opacity 150ms",
        opacity: disabled ? 0.3 : 1,
      }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ display: "block" }}>
        <path d="M8 12V4M4 8l4-4 4 4" stroke={disabled ? "var(--text-tertiary)" : "var(--bg-primary)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}


/* ===================================================================
   AutoTextarea
   =================================================================== */

function AutoTextarea({ value, onChange, onKeyDown, placeholder, disabled, autoFocus, ariaLabel }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) { ref.current.style.height = "auto"; ref.current.style.height = Math.min(ref.current.scrollHeight, 160) + "px"; }
  }, [value]);
  return (
    <textarea ref={ref} value={value} onChange={onChange} onKeyDown={onKeyDown} placeholder={placeholder} disabled={disabled} autoFocus={autoFocus} rows={1} aria-label={ariaLabel || placeholder || "Message input"}
      style={{ width: "100%", padding: "14px 20px", paddingBottom: "2.75rem", fontSize: "15px", background: "transparent", border: "none", color: "var(--text-primary)", outline: "none", fontFamily: "inherit", resize: "none", lineHeight: "24px", overflow: "auto", boxSizing: "border-box" }}
    />
  );
}


/* ===================================================================
   parseOptionsBlock + OptionPicker
   =================================================================== */

function parseOptionsBlock(text) {
  const optionsMatch = text.match(/\[OPTIONS\]([\s\S]*?)\[\/OPTIONS\]/);
  if (optionsMatch) {
    const options = optionsMatch[1].trim().split('\n').filter(Boolean).map(o => o.trim());
    const displayText = text.replace(/\[OPTIONS\][\s\S]*?\[\/OPTIONS\]/, '').trim();
    return { options, displayText };
  }
  return { options: [], displayText: text };
}

function OptionPicker({ options, onSubmit }) {
  const [selected, setSelected] = useState(new Set());
  function toggle(opt) {
    setSelected(prev => {
      const next = new Set(prev);
      if (opt === "Custom...") { onSubmit?.("Custom..."); return prev; }
      if (next.has(opt)) next.delete(opt); else next.add(opt);
      return next;
    });
  }
  function handleContinue() {
    if (selected.size === 0) return;
    onSubmit?.(Array.from(selected).join(", "));
  }
  return (
    <div style={{ maxWidth: "85%" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {options.filter(o => o !== "Custom...").map((opt, i) => {
          const isSelected = selected.has(opt);
          return (
            <button key={i} onClick={() => toggle(opt)} style={{
              padding: "10px 16px", fontSize: "13px", fontWeight: 500, textAlign: "left",
              color: isSelected ? "var(--text-100, var(--text-primary))" : "var(--text-200, var(--text-secondary))",
              border: isSelected ? "1.5px solid var(--accent)" : "1px solid var(--border)",
              borderRadius: 10, background: isSelected ? "var(--accent-subtle, rgba(196,97,58,0.06))" : "var(--bg-400, var(--bg-surface))",
              cursor: "pointer", fontFamily: "inherit", transition: "all 150ms",
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <div style={{
                width: 18, height: 18, borderRadius: 5, border: isSelected ? "none" : "1.5px solid var(--border-strong, var(--border))",
                background: isSelected ? "var(--accent)" : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 150ms",
              }}>
                {isSelected && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
              </div>
              {opt}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button onClick={handleContinue} disabled={selected.size === 0} style={{
          padding: "8px 20px", fontSize: "13px", fontWeight: 600,
          background: selected.size > 0 ? "var(--text-100, #111)" : "var(--bg-300, #eee)",
          color: selected.size > 0 ? "var(--bg-100, #fff)" : "var(--text-300, #999)",
          border: "none", borderRadius: 8, cursor: selected.size > 0 ? "pointer" : "default",
          fontFamily: "inherit", transition: "all 150ms",
        }}>
          Continue {selected.size > 0 && `(${selected.size})`}
        </button>
        {options.includes("Custom...") && (
          <button onClick={() => onSubmit?.("Custom...")} style={{
            padding: "8px 16px", fontSize: "13px", fontWeight: 500,
            color: "var(--text-300, var(--text-tertiary))", background: "none",
            border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
          }}>
            Type my own
          </button>
        )}
      </div>
    </div>
  );
}


/* ===================================================================
   BuilderMessage
   =================================================================== */

function BuilderMessage({ msg, isStreaming, onWorkerDefDetected, onOptionClick }) {
  const isUser = msg.role === "user";
  if (isUser) {
    return (
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.75rem" }} className="lovable-fade">
        <div style={{ maxWidth: "85%", padding: "10px 14px", borderRadius: "16px 16px 4px 16px", fontSize: "14px", lineHeight: 1.5, color: "#fff", background: "var(--text-primary)", wordBreak: "break-word" }}>{msg.content}</div>
      </div>
    );
  }
  const workerDef = msg.content ? parseWorkerDefinition(msg.content) : null;
  const rawContent = workerDef ? stripWorkerDefinitionBlock(msg.content) : msg.content;
  const { options, displayText } = parseOptionsBlock(rawContent || "");

  // Notify parent when a worker definition is detected (after streaming completes)
  useEffect(() => {
    if (workerDef && !isStreaming) {
      onWorkerDefDetected?.(workerDef);
    }
  }, [workerDef?.name, isStreaming]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", marginBottom: "0.75rem", gap: 8 }} className="lovable-fade">
      <div style={{ maxWidth: "85%", fontSize: "14px", lineHeight: 1.5, color: "var(--text-primary)", wordBreak: "break-word", whiteSpace: "pre-wrap" }}>
        {displayText}
        {isStreaming && <span style={{ display: "inline-block", width: 2, height: "1.1em", background: "var(--text-primary)", marginLeft: 1, verticalAlign: "text-bottom", animation: "blink 1s step-end infinite" }} />}
      </div>
      {options.length > 0 && !isStreaming && (
        <OptionPicker options={options} onSubmit={onOptionClick} />
      )}
    </div>
  );
}


/* ===================================================================
   BuilderInputBox
   =================================================================== */

function BuilderInputBox({ value, onChange, onSend, disabled, model, onModelChange, placeholder }) {
  const [focused, setFocused] = useState(false);
  function handleKeyDown(e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend?.(); } }
  return (
    <div style={{ position: "relative", maxWidth: 680, width: "100%" }}>
      <div
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 16, transition: "border-color 150ms, box-shadow 150ms", position: "relative", boxShadow: focused ? "var(--shadow-md)" : "var(--shadow-sm)" }}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      >
        <AutoTextarea value={value} onChange={onChange} onKeyDown={handleKeyDown} placeholder={placeholder || "Describe what you need..."} disabled={disabled} autoFocus ariaLabel="Describe what you need" style={{ paddingLeft: "1rem" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 12px 10px" }}>
          <ModelDropdown model={model} onModelChange={onModelChange} />
          <SendArrow disabled={disabled || !value.trim()} onClick={onSend} />
        </div>
      </div>
    </div>
  );
}


/* ===================================================================
   TemplateCard
   =================================================================== */

function TemplateCard({ template, onClick }) {
  return (
    <div
      style={{ padding: "14px 16px", border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg-surface)", cursor: "pointer", transition: "border-color 150ms", display: "flex", flexDirection: "column", gap: "0.4rem" }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--text-tertiary)"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; }}
      onClick={onClick}
    >
      <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>{template.name}</div>
      <div style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.5, flex: 1 }}>{template.description}</div>
    </div>
  );
}


/* ===================================================================
   TemplateCharterReview
   =================================================================== */

function TemplateCharterReview({ template, onDeploy, onCustomize, deploying }) {
  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "2rem" }} className="lovable-fade">
      <button style={S.backLink} onClick={onCustomize}>{"\u2190"} Back</button>
      <h2 style={{ ...S.pageTitle, marginBottom: "0.5rem" }}>{template.name}</h2>
      <p style={{ ...S.pageSub, marginBottom: "1.5rem" }}>{template.description}</p>
      <div style={{ padding: "1.25rem", borderRadius: 10, borderLeft: "2px solid var(--accent)", marginBottom: "2rem" }}>
        <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "1rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>What this worker can do</div>
        <CharterDisplay charter={template.charter} compact />
      </div>
      <div style={{ display: "flex", gap: "0.75rem" }}>
        <button style={{ ...S.btnPrimary, width: "auto", opacity: deploying ? 0.5 : 1 }} disabled={deploying} onClick={onDeploy}>{deploying ? "Deploying..." : "Deploy"}</button>
        <button style={S.btnSecondary} onClick={onCustomize}>Customize</button>
      </div>
    </div>
  );
}


/* ===================================================================
   TerraDotsInjector
   =================================================================== */

/* ===================================================================
   TerraformingScreen — ASCII "nooterra" being built character by character
   =================================================================== */

/* -------------------------------------------------------------------
   Pixel font — each letter is a 7-row bitmap, variable width.
   Render via SVG rects so it scales perfectly on every screen.
   ------------------------------------------------------------------- */
const PX_FONT = {
  T: [[1,1,1,1,1],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0]],
  E: [[1,1,1,1],[1,0,0,0],[1,0,0,0],[1,1,1,0],[1,0,0,0],[1,0,0,0],[1,1,1,1]],
  R: [[1,1,1,0],[1,0,0,1],[1,0,0,1],[1,1,1,0],[1,0,1,0],[1,0,0,1],[1,0,0,1]],
  A: [[0,1,1,0],[1,0,0,1],[1,0,0,1],[1,1,1,1],[1,0,0,1],[1,0,0,1],[1,0,0,1]],
  F: [[1,1,1,1],[1,0,0,0],[1,0,0,0],[1,1,1,0],[1,0,0,0],[1,0,0,0],[1,0,0,0]],
  O: [[0,1,1,0],[1,0,0,1],[1,0,0,1],[1,0,0,1],[1,0,0,1],[1,0,0,1],[0,1,1,0]],
  M: [[1,0,0,0,1],[1,1,0,1,1],[1,0,1,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1]],
  I: [[1,1,1],[0,1,0],[0,1,0],[0,1,0],[0,1,0],[0,1,0],[1,1,1]],
  N: [[1,0,0,0,1],[1,1,0,0,1],[1,0,1,0,1],[1,0,0,1,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1]],
  G: [[0,1,1,1],[1,0,0,0],[1,0,0,0],[1,0,1,1],[1,0,0,1],[1,0,0,1],[0,1,1,0]],
};

function buildPixelGrid(word) {
  const letters = word.split("").map(ch => PX_FONT[ch]);
  const rows = 7;
  const grid = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    letters.forEach((letter, li) => {
      if (li > 0) row.push(0); // 1-col gap between letters
      row.push(...letter[r]);
    });
    grid.push(row);
  }
  return grid;
}

const BLOCK_COLOR = "#faf3eb";

function TerraformingScreen({ onCancel, mode }) {
  const [msgIndex, setMsgIndex] = useState(0);
  const [showMessages, setShowMessages] = useState(false);
  const [cycle, setCycle] = useState(0);

  const grid = useMemo(() => buildPixelGrid("TERRAFORMING"), []);
  const totalCols = grid[0].length;
  const totalRows = grid.length;

  // Inject Tetris drop keyframes
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = `
      @keyframes blockDrop {
        0% { transform: translateY(-200px); opacity: 0; }
        35% { opacity: 0.7; }
        72% { transform: translateY(4px); opacity: 1; }
        88% { transform: translateY(-2px); }
        100% { transform: translateY(0); opacity: 1; }
      }
      @keyframes blockFadeOut {
        0% { transform: translateY(0); opacity: 1; }
        100% { transform: translateY(40px); opacity: 0; }
      }
    `;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  // Show status messages after first drop settles
  useEffect(() => {
    const t = setTimeout(() => setShowMessages(true), 2200);
    return () => clearTimeout(t);
  }, []);

  // Compute max delay for the current drop so we know when it finishes
  const maxDelay = useMemo(() => {
    let max = 0;
    for (let r = 0; r < totalRows; r++) {
      for (let c = 0; c < totalCols; c++) {
        if (!grid[r][c]) continue;
        const d = c * 14 + (totalRows - 1 - r) * 55 + ((r * 7 + c * 13) % 23) * 4;
        if (d > max) max = d;
      }
    }
    return max;
  }, [grid, totalRows, totalCols]);

  // Loop: after all blocks land + a pause, restart the animation
  useEffect(() => {
    const dropDuration = maxDelay + 650; // last block delay + animation duration
    const pauseAfterLand = 1800;
    const t = setTimeout(() => setCycle(c => c + 1), dropDuration + pauseAfterLand);
    return () => clearTimeout(t);
  }, [cycle, maxDelay]);

  const messages = mode === "worker"
    ? ["Analyzing your task...", "Designing charter rules...", "Choosing the right model...", "Setting permissions...", "Activating worker..."]
    : ["Understanding your business...", "Designing worker roles...", "Setting permissions and boundaries...", "Configuring schedules...", "Terraforming your team..."];

  useEffect(() => {
    if (!showMessages) return;
    const id = setInterval(() => setMsgIndex(p => (p + 1) % messages.length), 4000);
    return () => clearInterval(id);
  }, [showMessages, messages.length]);

  // Pre-compute block positions + staggered delays
  const blocks = useMemo(() => {
    const result = [];
    for (let r = 0; r < totalRows; r++) {
      for (let c = 0; c < totalCols; c++) {
        if (!grid[r][c]) continue;
        const colDelay = c * 14;
        const rowBonus = (totalRows - 1 - r) * 55;
        const jitter = ((r * 7 + c * 13) % 23) * 4;
        result.push({ r, c, delay: colDelay + rowBonus + jitter });
      }
    }
    return result;
  }, [grid, totalRows, totalCols]);

  const blockSize = 0.82;
  const gap = (1 - blockSize) / 2;

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", minHeight: "100%",
      padding: "2rem 1rem",
      background: "#c4613a",
    }}>
      <div style={{ width: "100%", maxWidth: 880, textAlign: "center" }}>
        {/* Pixel-block TERRAFORMING — SVG scales to any screen, re-keyed to restart animation */}
        <svg
          key={cycle}
          viewBox={`0 0 ${totalCols} ${totalRows}`}
          style={{ width: "100%", height: "auto", display: "block", margin: "0 auto 36px" }}
          aria-label="Terraforming"
          role="img"
        >
          {blocks.map(({ r, c, delay }) => (
            <rect
              key={`${r}-${c}`}
              x={c + gap}
              y={r + gap}
              width={blockSize}
              height={blockSize}
              rx={0.06}
              fill={BLOCK_COLOR}
              style={{
                animation: `blockDrop 0.65s ${delay}ms cubic-bezier(0.22, 1, 0.36, 1) both`,
              }}
            />
          ))}
        </svg>

        {/* Status message — fades in after blocks land */}
        <p style={{
          fontSize: "clamp(12px, 2vw, 15px)",
          color: "rgba(255,255,255,0.75)",
          lineHeight: 1.6,
          minHeight: "1.6em",
          opacity: showMessages ? 1 : 0,
          transition: "opacity 600ms ease",
          fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
          letterSpacing: "0.02em",
        }}>
          {messages[msgIndex]}
        </p>

        <button
          onClick={onCancel}
          style={{
            marginTop: 20, background: "none", border: "none",
            color: "rgba(255,255,255,0.55)", fontSize: "13px", cursor: "pointer",
            fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
            textDecoration: "underline", textUnderlineOffset: "3px",
            opacity: showMessages ? 1 : 0,
            transition: "opacity 600ms ease",
          }}
        >Cancel</button>
      </div>
    </div>
  );
}


/* ===================================================================
   ModeToggle
   =================================================================== */

function ModeToggle({ mode, onChange }) {
  const isWorker = mode === "worker";
  return (
    <div
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        background: "var(--bg-200)",
        border: "1px solid var(--border)",
        borderRadius: 100,
        padding: 3,
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      {/* Sliding indicator */}
      <div
        style={{
          position: "absolute",
          top: 3,
          left: 3,
          width: "calc(50% - 3px)",
          height: "calc(100% - 6px)",
          background: "var(--bg-400)",
          borderRadius: 100,
          boxShadow: "0 1px 3px rgba(0,0,0,0.08), 0 1px 1px rgba(0,0,0,0.04)",
          transform: isWorker ? "translateX(100%)" : "translateX(0)",
          transition: "transform 220ms cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      />
      {["team", "worker"].map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          style={{
            position: "relative",
            zIndex: 1,
            padding: "6px 20px",
            fontSize: "13px",
            fontWeight: mode === m ? 600 : 500,
            fontFamily: "inherit",
            color: mode === m ? "var(--text-100)" : "var(--text-300)",
            background: "transparent",
            border: "none",
            borderRadius: 100,
            cursor: "pointer",
            transition: "color 200ms ease",
            letterSpacing: "-0.01em",
            lineHeight: 1,
          }}
        >
          {m === "team" ? "Team" : "Worker"}
        </button>
      ))}
    </div>
  );
}


/* ===================================================================
   BuilderView
   =================================================================== */

function BuilderView({ onComplete, onViewWorker, userName, isFirstTime }) {
  const [phase, setPhase] = useState("input"); // "input" | "generating" | "team"
  const [description, setDescription] = useState("");
  const [builderMode, setBuilderMode] = useState("team"); // "team" | "worker"
  const [teamProposal, setTeamProposal] = useState(null);
  const [expandedCard, setExpandedCard] = useState(null);
  const [activating, setActivating] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [connectedIntegrations, setConnectedIntegrations] = useState(new Set());
  const [connectingIntegration, setConnectingIntegration] = useState(null);
  const [deploySuccess, setDeploySuccess] = useState(false);
  const textareaRef = useRef(null);

  // Persist team proposal to sessionStorage so it survives app switches / reloads
  const TEAM_SESSION_KEY = "nooterra_team_draft";

  useEffect(() => {
    if (teamProposal && phase === "team") {
      try { sessionStorage.setItem(TEAM_SESSION_KEY, JSON.stringify({ teamProposal, description, phase })); } catch {}
    }
  }, [teamProposal, phase, description]);

  // Restore team draft on mount
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(TEAM_SESSION_KEY) || "null");
      if (saved?.teamProposal?.workers?.length > 0 && phase === "input") {
        setTeamProposal(saved.teamProposal);
        setDescription(saved.description || "");
        setPhase("team");
      }
    } catch {}
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Check which integrations are already connected
  async function refreshIntegrationStatus() {
    try {
      const result = await workerApiRequest({ pathname: "/v1/integrations/status", method: "GET" });
      if (result?.integrations) {
        const connected = new Set(
          Object.entries(result.integrations)
            .filter(([, v]) => v.connected)
            .map(([k]) => k.toLowerCase())
        );
        setConnectedIntegrations(connected);
        setConnectingIntegration(null); // Clear "Waiting..." state
      }
    } catch { /* ignore */ }
  }

  // Refresh integration status when entering team phase or when window regains focus
  useEffect(() => {
    if (phase !== "team") return;
    refreshIntegrationStatus();
    function onFocus() { refreshIntegrationStatus(); }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [phase]);

  function parseTeamProposal(text) {
    const match = text.match(/\[TEAM_PROPOSAL\]([\s\S]*?)\[\/TEAM_PROPOSAL\]/);
    if (!match) return null;
    const block = match[1];
    const lines = block.split("\n").map(l => l.trim()).filter(Boolean);
    let teamName = "";
    let summary = "";
    const workers = [];
    let current = null;
    for (const line of lines) {
      const [key, ...rest] = line.split(":");
      const k = key.trim().toLowerCase();
      const v = rest.join(":").trim();
      if (k === "team_name") { teamName = v; }
      else if (k === "summary" && !current) { summary = v; }
      else if (k === "worker") { if (current) workers.push(current); current = { role: v, title: "", description: "", canDo: [], askFirst: [], neverDo: [], schedule: "continuous", model: "", integrations: [] }; }
      else if (current && k === "title") current.title = v;
      else if (current && k === "description") current.description = v;
      else if (current && k === "cando") current.canDo = v.split(",").map(s => s.trim()).filter(Boolean);
      else if (current && k === "askfirst") current.askFirst = v.split(",").map(s => s.trim()).filter(Boolean);
      else if (current && k === "neverdo") current.neverDo = v.split(",").map(s => s.trim()).filter(Boolean);
      else if (current && k === "schedule") current.schedule = v;
      else if (current && k === "model") current.model = v;
      else if (current && k === "integrations") current.integrations = v.split(",").map(s => s.trim()).filter(Boolean);
    }
    if (current) workers.push(current);
    if (workers.length === 0) return null;
    return { teamName: teamName || "Your Team", summary, workers };
  }

  async function handleGo() {
    const text = description.trim();
    if (!text) return;
    setPhase("generating");
    setError("");

    const runtime = loadRuntimeConfig();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    // Worker mode: wrap the prompt to request a single worker, not a team
    const chatContent = builderMode === "worker"
      ? `Create a SINGLE worker (not a team) for this task: ${text}\n\nRespond with a [WORKER_DEFINITION] block containing: Name, CanDo, AskFirst, NeverDo, Schedule, Model. Do NOT wrap in [TEAM_PROPOSAL].`
      : text;

    try {
      const res = await fetch("/__nooterra/v1/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-tenant-id": runtime.tenantId },
        credentials: "include",
        body: JSON.stringify({ messages: [{ role: "user", content: chatContent }] }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error("AI service unavailable");

      // Read SSE stream
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
          try { const p = JSON.parse(data); const d = p.choices?.[0]?.delta?.content || ""; if (d) fullResponse += d; } catch {}
        }
      }

      // Worker mode: try single worker definition first
      if (builderMode === "worker") {
        const workerDef = parseWorkerDefinition(fullResponse);
        if (workerDef) {
          setTeamProposal({
            teamName: workerDef.name || "New Worker",
            summary: "",
            workers: [{
              role: workerDef.name || "New Worker",
              title: "",
              description: description,
              canDo: workerDef.canDo || [],
              askFirst: workerDef.askFirst || [],
              neverDo: workerDef.neverDo || [],
              schedule: workerDef.schedule || "on_demand",
              model: workerDef.model || "anthropic/claude-haiku-4.5",
              integrations: [],
            }],
          });
          setPhase("team");
          return;
        }
      }

      // Parse team from AI response
      const aiTeam = parseTeamProposal(fullResponse);
      if (aiTeam && aiTeam.workers.length > 0) {
        setTeamProposal(aiTeam);
        setPhase("team");
        return;
      }

      throw new Error(builderMode === "worker" ? "Couldn't create that worker. Try being more specific about what it should do." : "Could not generate team. Try describing your business in more detail.");
    } catch (err) {
      setError(err?.name === "AbortError" ? "Lost connection to Nooterra. Retrying..." : (err?.message || "Couldn't build your team. Check your connection and try again."));
      setPhase("input");
    } finally {
      clearTimeout(timeout);
    }
  }

  function handleExampleClick(text) {
    setDescription(text);
  }

  function handleTemplateSelect(template) {
    const workerProposal = {
      teamName: template.name,
      summary: template.description,
      workers: [{
        role: template.name,
        title: template.description,
        description: template.description,
        canDo: [...template.charter.canDo],
        askFirst: [...template.charter.askFirst],
        neverDo: [...template.charter.neverDo],
        model: template.model,
        schedule: template.schedule,
        integrations: template.integrations,
      }],
    };
    setTeamProposal(workerProposal);
    setPhase("team");
  }

  function goBackToPhase1() {
    setPhase("input");
    setTeamProposal(null);
    setExpandedCard(null);
    setError("");
  }

  async function handleActivate() {
    if (!teamProposal || activating) return;
    setActivating(true);
    setError("");
    try {
      for (const worker of teamProposal.workers) {
        const charter = {
          canDo: worker.canDo || [],
          askFirst: worker.askFirst || [],
          neverDo: worker.neverDo || [],
        };
        const scheduleValue = worker.schedule === "continuous" ? "continuous" : (worker.schedule || "0 9 * * *");
        await workerApiRequest({
          pathname: "/v1/workers", method: "POST",
          body: {
            name: worker.role,
            description: worker.description || "",
            charter: JSON.stringify(charter),
            schedule: scheduleValue,
            model: worker.model || "openai/gpt-5.4-mini",
          },
        });
      }
      saveOnboardingState({ buyer: loadOnboardingState()?.buyer || null, sessionExpected: true, completed: true });
      try { sessionStorage.removeItem(TEAM_SESSION_KEY); } catch {}
      setDeploySuccess(true);
      setTimeout(() => { onComplete?.(); }, 1500);
    } catch (err) {
      setError("Couldn't deploy this team. Check your connection and try again.");
    }
    setActivating(false);
  }

  // =============================================
  // DEPLOY SUCCESS STATE
  // =============================================
  if (deploySuccess) {
    return (
      <div className="deploy-success" style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", minHeight: "100%", padding: "2rem",
        background: "var(--bg-100, #faf9f6)",
      }}>
        <div style={{
          width: 56, height: 56, borderRadius: "50%",
          background: "var(--green-bg, rgba(42,157,110,0.08))",
          border: "2px solid var(--green, #2a9d6e)",
          display: "flex", alignItems: "center", justifyContent: "center",
          marginBottom: 20,
        }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--green, #2a9d6e)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h2 style={{
          fontSize: "1.5rem", fontWeight: 700, color: "var(--text-100, var(--text-primary))",
          fontFamily: "var(--font-display, 'Fraunces', serif)",
          marginBottom: 8,
        }}>
          Team deployed
        </h2>
        <p style={{ fontSize: "14px", color: "var(--text-300, var(--text-secondary))", textAlign: "center", maxWidth: 320 }}>
          Your workers are warming up. You'll see activity in your inbox shortly.
        </p>
      </div>
    );
  }

  // =============================================
  // GENERATING STATE — ASCII "nooterra" build animation
  // =============================================
  if (phase === "generating") {
    return <TerraformingScreen onCancel={goBackToPhase1} mode={builderMode} />;
  }

  // =============================================
  // PHASE 1: INPUT
  // =============================================
  if (phase === "input") {
    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        minHeight: "100%", padding: "clamp(3rem, 10vh, 6rem) 2rem 2rem",
        background: "var(--bg-100, #faf9f6)",
      }}>
        <div style={{ maxWidth: 580, width: "100%", textAlign: "center" }}>
          <div style={{ marginBottom: 28 }}>
            <ModeToggle mode={builderMode} onChange={setBuilderMode} />
          </div>
          <h1 style={{
            fontSize: "clamp(1.75rem, 3vw, 2.5rem)", fontWeight: 800,
            letterSpacing: "-0.03em", color: "var(--text-100)",
            marginBottom: 12, lineHeight: 1.15,
            fontFamily: "var(--font-display, 'Fraunces', serif)",
          }}>
            {builderMode === "team" ? "What are we terraforming?" : "Activate a worker"}
          </h1>
          <p style={{ fontSize: "15px", color: "var(--text-300)", marginBottom: 40 }}>
            {builderMode === "team" ? "Describe your business. We'll do the rest." : "Describe what this worker should do."}
          </p>

          <textarea
            ref={textareaRef}
            value={description}
            onChange={e => setDescription(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleGo(); }
            }}
            placeholder={builderMode === "team" ? "e.g. We're a plumbing company in Denver with 8 technicians..." : "e.g. Monitor our Stripe dashboard and alert me about failed payments..."}
            rows={3}
            aria-label="Describe your business"
            style={{
              display: "block", width: "100%", padding: "16px 18px",
              fontSize: "16px", lineHeight: 1.6, fontFamily: "inherit",
              border: "1px solid var(--border)", borderRadius: 12,
              background: "var(--bg-400)", color: "var(--text-100)",
              outline: "none", resize: "vertical", boxSizing: "border-box",
              transition: "border-color 150ms",
            }}
            onFocus={e => { e.currentTarget.style.borderColor = "var(--border-strong, var(--accent))"; }}
            onBlur={e => { e.currentTarget.style.borderColor = "var(--border)"; }}
          />

          <button
            onClick={handleGo}
            disabled={!description.trim()}
            style={{
              display: "block", width: "100%", padding: "14px 24px",
              fontSize: "14px", fontWeight: 700, marginTop: 12,
              background: "var(--text-100)", color: "var(--bg-100)",
              border: "none", borderRadius: 10, cursor: "pointer",
              fontFamily: "inherit", transition: "opacity 150ms",
              opacity: description.trim() ? 1 : 0.35,
            }}
          >
            {builderMode === "team" ? "Build my team \u2192" : "Build worker \u2192"}
          </button>

          {builderMode === "team" && (
            <div style={{ marginTop: 24, color: "var(--text-300)", fontSize: "13px", lineHeight: 2 }}>
              {["Plumbing company in Denver with 8 techs", "Gem restoration studio in LA", "Shopify store selling supplements"].map((example, i) => (
                <span key={example}>
                  {i > 0 && <span style={{ margin: "0 6px" }}>&middot;</span>}
                  <span
                    onClick={() => handleExampleClick(example)}
                    style={{
                      cursor: "pointer", textDecoration: "underline",
                      textDecorationColor: "var(--border)", textUnderlineOffset: "3px",
                      transition: "color 120ms",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.color = "var(--text-100)"; }}
                    onMouseLeave={e => { e.currentTarget.style.color = "var(--text-300)"; }}
                  >{example}</span>
                </span>
              ))}
            </div>
          )}

          {builderMode === "worker" && (
            <div style={{ marginTop: 32 }}>
              <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-300)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
                Or start from a template
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10, textAlign: "left" }}>
                {WORKER_TEMPLATES.map((tpl) => (
                  <div
                    key={tpl.name}
                    onClick={() => handleTemplateSelect(tpl)}
                    style={{
                      padding: "14px 16px", border: "1px solid var(--border)", borderRadius: 10,
                      background: "var(--bg-400, var(--bg-surface))", cursor: "pointer",
                      transition: "border-color 150ms, box-shadow 150ms",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--border-strong, var(--border))"; e.currentTarget.style.boxShadow = "var(--shadow-sm)"; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.boxShadow = "none"; }}
                  >
                    <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-100, var(--text-primary))", marginBottom: 4 }}>{tpl.name}</div>
                    <div style={{ fontSize: "12px", color: "var(--text-300, var(--text-tertiary))", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{tpl.description}</div>
                    <div style={{ fontSize: "11px", color: "var(--text-300)", fontFamily: "var(--font-mono)", marginTop: 8 }}>
                      {tpl.charter.canDo.length} auto · {tpl.charter.askFirst.length} approval · {tpl.integrations.join(", ")}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // =============================================
  // PHASE 2: TEAM REVIEW
  // =============================================
  const workers = teamProposal?.workers || [];

  return (
    <div style={{
      minHeight: "100%", padding: "2rem 1.5rem", background: "var(--bg-100, #faf9f6)",
      overflowY: "auto",
    }}>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>

        {/* Back button */}
        <button
          onClick={goBackToPhase1}
          style={{
            background: "none", border: "none", cursor: "pointer",
            fontSize: "13px", fontWeight: 500, color: "var(--text-300)",
            padding: 0, fontFamily: "inherit", transition: "color 120ms",
          }}
          onMouseEnter={e => { e.currentTarget.style.color = "var(--text-100)"; }}
          onMouseLeave={e => { e.currentTarget.style.color = "var(--text-300)"; }}
        >
          &larr; Start over
        </button>

        {/* Team header */}
        <div style={{ marginBottom: 40, marginTop: 16 }}>
          <h1 style={{
            fontSize: "clamp(1.5rem, 3vw, 2rem)", fontWeight: 800,
            letterSpacing: "-0.03em", color: "var(--text-100)",
            lineHeight: 1.15,
            fontFamily: "var(--font-display, 'Fraunces', serif)",
          }}>
            {teamProposal?.teamName || "Your Team"}
          </h1>
          <p style={{ fontSize: "14px", color: "var(--text-300)", marginTop: 6, lineHeight: 1.6 }}>
            {teamProposal?.summary || `${workers.length} workers ready to deploy`}
          </p>
        </div>

        {/* Worker cards grid */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 16,
        }}>
          {workers.map((worker, idx) => {
            const isExpanded = expandedCard === idx;
            const canDoCount = (worker.canDo || []).length;
            const askFirstCount = (worker.askFirst || []).length;
            const neverDoCount = (worker.neverDo || []).length;

            return (
              <div
                key={idx}
                onClick={() => setExpandedCard(isExpanded ? null : idx)}
                style={{
                  border: "1px solid var(--border)", borderRadius: 12,
                  background: "var(--bg-400)", padding: 24, cursor: "pointer",
                  transition: "box-shadow 200ms, border-color 200ms",
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.boxShadow = "var(--shadow-sm, 0 1px 4px rgba(0,0,0,0.06))";
                  e.currentTarget.style.borderColor = "var(--border-strong, var(--border))";
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.boxShadow = "none";
                  e.currentTarget.style.borderColor = "var(--border)";
                }}
              >
                <div style={{ fontSize: "18px", fontWeight: 700, color: "var(--text-100)", marginBottom: 6 }}>
                  {worker.role}
                </div>
                <div style={{
                  fontSize: "13px", color: "var(--text-200)", marginBottom: 12,
                  lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical", overflow: "hidden",
                }}>
                  {worker.title || worker.description || ""}
                </div>
                <div style={{
                  fontSize: "12px", fontFamily: "var(--font-mono)",
                  color: "var(--text-300)",
                }}>
                  {canDoCount} autonomous &middot; {askFirstCount} approval &middot; {neverDoCount} blocked
                </div>

                {/* Model badge */}
                {worker.model && (
                  <div style={{
                    display: "inline-block", marginTop: 10, padding: "3px 10px",
                    fontSize: "11px", fontFamily: "var(--font-mono)",
                    color: "var(--text-200)", background: "var(--bg-100, rgba(0,0,0,0.06))",
                    borderRadius: 6, fontWeight: 500,
                  }}>
                    {ALL_MODELS.find(m => m.id === worker.model)?.name || worker.model}
                  </div>
                )}

                {/* Integration pills */}
                {(worker.integrations || []).length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                    {worker.integrations.map((intg, ii) => (
                      <span key={ii} style={{
                        fontSize: "11px", padding: "2px 8px", borderRadius: 5,
                        border: "1px solid var(--border)", color: "var(--text-300)",
                        fontFamily: "var(--font-mono)",
                      }}>{intg}</span>
                    ))}
                  </div>
                )}

                {/* Expanded inline editor */}
                {isExpanded && (
                  <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}
                       onClick={e => e.stopPropagation()}>
                    {/* Editable name */}
                    <input
                      value={worker.role}
                      onChange={e => {
                        const updated = { ...teamProposal };
                        updated.workers = [...updated.workers];
                        updated.workers[idx] = { ...worker, role: e.target.value };
                        setTeamProposal(updated);
                      }}
                      style={{
                        fontSize: "16px", fontWeight: 700, color: "var(--text-100)",
                        background: "transparent", border: "none", borderBottom: "1px solid var(--border)",
                        outline: "none", width: "100%", padding: "4px 0", marginBottom: 8,
                        fontFamily: "inherit",
                      }}
                    />
                    {/* Editable description */}
                    <textarea
                      value={worker.description || worker.title || ""}
                      onChange={e => {
                        const updated = { ...teamProposal };
                        updated.workers = [...updated.workers];
                        updated.workers[idx] = { ...worker, description: e.target.value, title: e.target.value };
                        setTeamProposal(updated);
                      }}
                      rows={2}
                      style={{
                        fontSize: "13px", color: "var(--text-200)", width: "100%",
                        background: "transparent", border: "1px solid var(--border)",
                        borderRadius: 6, padding: "6px 8px", outline: "none", resize: "vertical",
                        fontFamily: "inherit", lineHeight: 1.5, marginBottom: 12, boxSizing: "border-box",
                      }}
                    />
                    {/* Charter rules editor */}
                    {[
                      { key: "canDo", label: "Acts on its own", color: "var(--green, #5bb98c)" },
                      { key: "askFirst", label: "Asks you first", color: "var(--amber, #d4a843)" },
                      { key: "neverDo", label: "Never does", color: "var(--red, #c97055)" },
                    ].map(sec => {
                      const rules = worker[sec.key] || [];
                      return (
                        <div key={sec.key} style={{ marginBottom: 14 }}>
                          <div style={{
                            fontSize: "11px", fontWeight: 600, textTransform: "uppercase",
                            letterSpacing: "0.08em", color: sec.color,
                            marginBottom: 6, fontFamily: "var(--font-mono)",
                          }}>{sec.label}</div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            {rules.map((rule, ri) => (
                              <div key={ri} style={{
                                display: "flex", alignItems: "center", gap: 6,
                                padding: "4px 8px", borderRadius: 6,
                                borderLeft: `3px solid ${sec.color}`, fontSize: "13px",
                                color: "var(--text-200)", background: "var(--bg-100, rgba(0,0,0,0.02))",
                              }}>
                                <span style={{ flex: 1, lineHeight: 1.5 }}>{rule}</span>
                                <button
                                  onClick={() => {
                                    const updated = { ...teamProposal };
                                    updated.workers = [...updated.workers];
                                    const w = { ...worker };
                                    w[sec.key] = rules.filter((_, i) => i !== ri);
                                    updated.workers[idx] = w;
                                    setTeamProposal(updated);
                                  }}
                                  style={{
                                    background: "none", border: "none", cursor: "pointer",
                                    color: "var(--text-300)", fontSize: "14px", padding: "0 2px",
                                    flexShrink: 0, opacity: 0.6,
                                  }}
                                  title="Remove rule"
                                >&times;</button>
                              </div>
                            ))}
                          </div>
                          <InlineRuleAdder
                            color={sec.color}
                            label={sec.label}
                            onAdd={(text) => {
                              const updated = { ...teamProposal };
                              updated.workers = [...updated.workers];
                              const w = { ...worker };
                              w[sec.key] = [...(rules), text];
                              updated.workers[idx] = w;
                              setTeamProposal(updated);
                            }}
                          />
                        </div>
                      );
                    })}
                    {/* Model selector */}
                    <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
                      <div style={{
                        fontSize: "11px", fontWeight: 600, textTransform: "uppercase",
                        letterSpacing: "0.08em", color: "var(--text-300)",
                        marginBottom: 8, fontFamily: "var(--font-mono)",
                      }}>Model</div>
                      <select
                        value={worker.model || ""}
                        onClick={e => e.stopPropagation()}
                        onChange={e => {
                          e.stopPropagation();
                          const updated = { ...teamProposal };
                          updated.workers = [...updated.workers];
                          updated.workers[idx] = { ...worker, model: e.target.value };
                          setTeamProposal(updated);
                        }}
                        style={{
                          width: "100%", padding: "8px 12px", fontSize: "13px",
                          fontFamily: "var(--font-mono)", background: "var(--bg-100, var(--bg-400))",
                          color: "var(--text-100)", border: "1px solid var(--border)",
                          borderRadius: 8, outline: "none", cursor: "pointer",
                          appearance: "auto",
                        }}
                      >
                        {MODEL_CATEGORIES.map(cat => (
                          <optgroup key={cat.key} label={cat.label}>
                            {ALL_MODELS.filter(m => m.category === cat.key).map(m => (
                              <option key={m.id} value={m.id}>{m.name} — {m.price}</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Integrations section — derived from worker integrations */}
        {(() => {
          const allIntegrations = new Map();
          for (const w of workers) {
            for (const intg of (w.integrations || [])) {
              if (!allIntegrations.has(intg)) allIntegrations.set(intg, []);
              allIntegrations.get(intg).push(w.role);
            }
          }
          if (allIntegrations.size === 0) return null;

          function isIntgConnected(intg) {
            const key = intg.toLowerCase().replace(/[\s_-]+/g, "");
            for (const c of connectedIntegrations) {
              if (c.replace(/[\s_-]+/g, "") === key) return true;
            }
            return false;
          }

          const connectedCount = [...allIntegrations.keys()].filter(isIntgConnected).length;
          const totalCount = allIntegrations.size;

          return (
            <div style={{ marginTop: 48 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <h2 style={{
                  fontSize: "15px", fontWeight: 700, textTransform: "uppercase",
                  letterSpacing: "0.08em", color: "var(--text-300)", margin: 0,
                }}>Integrations needed</h2>
                <span style={{
                  fontSize: "12px", fontWeight: 600, fontFamily: "var(--font-mono)",
                  color: connectedCount === totalCount ? "var(--green, #5bb98c)" : "var(--text-300)",
                }}>
                  {connectedCount}/{totalCount} connected
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[...allIntegrations.entries()].map(([intg, roles]) => {
                  const connected = isIntgConnected(intg);
                  const isConnecting = connectingIntegration === intg;
                  return (
                    <div key={intg} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "14px 18px", borderRadius: 10,
                      border: connected ? "1px solid var(--green, #5bb98c)" : "1px solid var(--border)",
                      background: connected ? "rgba(91,185,140,0.04)" : "var(--bg-400)",
                      transition: "border-color 200ms, background 200ms",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        {connected && (
                          <div style={{
                            width: 20, height: 20, borderRadius: "50%",
                            background: "var(--green, #5bb98c)", display: "flex",
                            alignItems: "center", justifyContent: "center", flexShrink: 0,
                          }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                          </div>
                        )}
                        <div>
                          <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-100)" }}>
                            {intg.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                          </div>
                          <div style={{ fontSize: "12px", color: connected ? "var(--green, #5bb98c)" : "var(--text-300)", marginTop: 2 }}>
                            {connected ? "Connected" : `Used by ${roles.join(", ")}`}
                          </div>
                        </div>
                      </div>
                      <div style={{ flexShrink: 0, marginLeft: 16 }}>
                        {connected ? (
                          <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--green, #5bb98c)" }}>Ready</span>
                        ) : (
                          <button
                            onClick={() => {
                              const runtime = loadRuntimeConfig();
                              const tenantId = runtime?.tenantId || "";
                              const intgKey = intg.toLowerCase().replace(/\s+/g, "_");
                              const match = AVAILABLE_INTEGRATIONS.find(a =>
                                a.key === intgKey || a.key === intg || a.name.toLowerCase() === intg.toLowerCase()
                              );
                              if (match && match.authType === "oauth") {
                                setConnectingIntegration(intg);
                                window.open(
                                  WORKER_API_BASE + match.oauthUrl + "?tenantId=" + encodeURIComponent(tenantId),
                                  "nooterra_oauth",
                                  "width=600,height=700,popup=yes"
                                );
                              } else {
                                navigate("/integrations");
                              }
                            }}
                            style={{
                              padding: "6px 14px", fontSize: "12px", fontWeight: 600,
                              border: "1px solid var(--border)", borderRadius: 8,
                              background: isConnecting ? "var(--bg-300)" : "transparent",
                              color: isConnecting ? "var(--text-300)" : "var(--text-200)",
                              cursor: "pointer", fontFamily: "inherit", transition: "all 120ms",
                            }}
                          >
                            {isConnecting ? "Waiting..." : "Connect"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Error */}
        {error && (
          <div style={{ marginTop: 16, fontSize: "14px", color: "var(--red, #c97055)", textAlign: "center" }}>{error}</div>
        )}

        {/* Integration warning + Activate button */}
        {(() => {
          const allIntgs = new Set();
          for (const w of workers) for (const intg of (w.integrations || [])) allIntgs.add(intg);
          const unconnectedIntgs = [...allIntgs].filter(intg => {
            const key = intg.toLowerCase().replace(/[\s_-]+/g, "");
            for (const c of connectedIntegrations) { if (c.replace(/[\s_-]+/g, "") === key) return false; }
            return true;
          });
          const hasUnconnected = unconnectedIntgs.length > 0;

          return (
            <div style={{ marginTop: 40, textAlign: "center", paddingBottom: 40 }}>
              {hasUnconnected && !showConfirm && (
                <div style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  padding: "10px 16px", borderRadius: 8, marginBottom: 16,
                  background: "var(--amber-bg, rgba(192,140,48,0.08))",
                  border: "1px solid var(--amber, #c08c30)",
                  fontSize: "13px", color: "var(--amber, #c08c30)", fontWeight: 500,
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                  Connect integrations above for your workers to function
                </div>
              )}
              {!showConfirm ? (
                <div>
                  <button
                    onClick={() => setShowConfirm(true)}
                    style={{
                      padding: "14px 48px", fontSize: "15px", fontWeight: 700,
                      background: "var(--text-100)", color: "var(--bg-100)",
                      border: "none", borderRadius: 10, cursor: "pointer",
                      fontFamily: "inherit", transition: "opacity 150ms",
                    }}
                  >
                    {hasUnconnected ? "Deploy anyway" : "Activate Team"}
                  </button>
                </div>
              ) : (
                <div style={{
                  display: "inline-flex", flexDirection: "column", alignItems: "center",
                  gap: 12, padding: "20px 32px", borderRadius: 12,
                  border: "1px solid var(--border)", background: "var(--bg-400)",
                }}>
                  <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-100)" }}>
                    Deploy {workers.length} worker{workers.length !== 1 ? "s" : ""}?
                  </div>
                  {hasUnconnected && (
                    <div style={{ fontSize: "12px", color: "var(--amber, #c08c30)", maxWidth: 280 }}>
                      {unconnectedIntgs.length} integration{unconnectedIntgs.length !== 1 ? "s" : ""} not connected. Workers may not function fully.
                    </div>
                  )}
                  <div style={{ fontSize: "13px", color: "var(--text-300)" }}>
                    All workers start in learning mode. You approve every action.
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={handleActivate}
                      disabled={activating}
                      style={{
                        padding: "10px 32px", fontSize: "14px", fontWeight: 700,
                        background: "var(--green, #5bb98c)", color: "#fff",
                        border: "none", borderRadius: 8, cursor: "pointer",
                        fontFamily: "inherit", opacity: activating ? 0.5 : 1,
                      }}
                    >
                      {activating ? "Deploying..." : "Yes, deploy"}
                    </button>
                    <button
                      onClick={() => setShowConfirm(false)}
                      style={{
                        padding: "10px 20px", fontSize: "14px",
                        background: "transparent", color: "var(--text-200)",
                        border: "1px solid var(--border)", borderRadius: 8,
                        cursor: "pointer", fontFamily: "inherit",
                      }}
                    >Cancel</button>
                  </div>
                </div>
              )}
              <p style={{ fontSize: "12px", color: "var(--text-300)", marginTop: 8 }}>
                All workers start in learning mode. You approve actions until they earn trust.
              </p>
            </div>
          );
        })()}
      </div>
    </div>
  );
}


export default BuilderView;
