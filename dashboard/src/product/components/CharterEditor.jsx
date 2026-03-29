import React, { useState } from "react";
import { S, CHARTER_SECTIONS, humanizeSchedule } from "../shared.js";
import ModelDropdown from "./ModelDropdown.jsx";

/* ===================================================================
   SchedulePicker
   =================================================================== */

const SCHEDULE_OPTIONS = [
  { label: "Continuous", value: "continuous", type: "continuous" },
  { label: "Hourly", value: "1h", type: "interval" },
  { label: "Daily at 9 AM", value: "0 9 * * *", type: "cron" },
  { label: "On demand", value: "on_demand", type: "trigger" },
  { label: "Custom cron", value: null, type: "custom" },
];

function SchedulePicker({ schedule, onScheduleChange }) {
  const [customCron, setCustomCron] = useState("");
  const [showCustom, setShowCustom] = useState(false);

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {SCHEDULE_OPTIONS.map(opt => {
          const isActive = opt.type !== "custom"
            ? (schedule?.label === opt.label || (!schedule && opt.label === "On demand"))
            : showCustom;
          return (
            <button
              key={opt.label}
              onClick={() => {
                if (opt.type === "custom") {
                  setShowCustom(true);
                } else {
                  setShowCustom(false);
                  onScheduleChange({ type: opt.type, value: opt.value, label: opt.label });
                }
              }}
              style={{
                padding: "6px 12px", fontSize: "13px", fontWeight: 500, borderRadius: 6, cursor: "pointer",
                background: isActive ? "var(--text-primary)" : "transparent",
                color: isActive ? "var(--bg-primary)" : "var(--text-secondary)",
                border: isActive ? "1px solid var(--text-primary)" : "1px solid var(--border)",
                transition: "all 150ms", fontFamily: "inherit",
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      {showCustom && (
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input
            value={customCron}
            onChange={e => setCustomCron(e.target.value)}
            placeholder="0 */2 * * *"
            style={{ ...S.input, marginBottom: 0, flex: 1, fontFamily: "var(--font-mono)", fontSize: "13px", padding: "6px 10px" }}
          />
          <button
            onClick={() => {
              if (customCron.trim()) {
                onScheduleChange({ type: "cron", value: customCron.trim(), label: humanizeSchedule(customCron.trim()) });
              }
            }}
            style={{ ...S.btnSecondary, padding: "6px 14px", fontSize: "13px" }}
          >
            Set
          </button>
        </div>
      )}
    </div>
  );
}

/* ===================================================================
   CharterEditor
   =================================================================== */

const CYCLE_ORDER = ["canDo", "askFirst", "neverDo"];

function CharterEditor({ charter, onCharterChange, workerName, onNameChange, schedule, onScheduleChange, model, onModelChange, onDeploy, deploying }) {
  const [newRuleTexts, setNewRuleTexts] = useState({ canDo: "", askFirst: "", neverDo: "" });

  function cycleRule(fromKey, ruleIndex) {
    const rule = charter[fromKey][ruleIndex];
    const nextIdx = (CYCLE_ORDER.indexOf(fromKey) + 1) % CYCLE_ORDER.length;
    const toKey = CYCLE_ORDER[nextIdx];
    const updated = { ...charter };
    updated[fromKey] = charter[fromKey].filter((_, i) => i !== ruleIndex);
    updated[toKey] = [...(charter[toKey] || []), rule];
    onCharterChange(updated);
  }

  function removeRule(key, index) {
    const updated = { ...charter };
    updated[key] = charter[key].filter((_, i) => i !== index);
    onCharterChange(updated);
  }

  function addRule(key) {
    const text = newRuleTexts[key]?.trim();
    if (!text) return;
    const updated = { ...charter };
    updated[key] = [...(charter[key] || []), text];
    onCharterChange(updated);
    setNewRuleTexts(prev => ({ ...prev, [key]: "" }));
  }

  const pillStyle = (sec) => ({
    display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px 5px 12px",
    borderRadius: 20, fontSize: "13px", lineHeight: 1.4, fontFamily: "var(--font-mono)",
    background: sec.bg, color: sec.color, border: `1px solid ${sec.color}22`,
    cursor: "pointer", transition: "all 150ms", maxWidth: "100%", wordBreak: "break-word",
    userSelect: "none",
  });

  const removeBtn = {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: 16, height: 16, borderRadius: "50%", background: "transparent", border: "none",
    cursor: "pointer", color: "inherit", fontSize: "12px", fontWeight: 700, padding: 0,
    flexShrink: 0, opacity: 0.6, transition: "opacity 150ms",
  };

  return (
    <div className="lovable-fade" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 16, overflow: "hidden" }}>
      {/* Header: Name + Schedule + Model */}
      <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "var(--green-bg)", border: "1px solid var(--green)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="6" r="3.5" stroke="var(--green)" strokeWidth="1.5" fill="none"/><path d="M2.5 16c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5" stroke="var(--green)" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>
          </div>
          <input
            value={workerName}
            onChange={e => onNameChange(e.target.value)}
            style={{
              flex: 1, fontSize: "18px", fontWeight: 700, color: "var(--text-primary)",
              background: "transparent", border: "none", outline: "none", fontFamily: "inherit",
              padding: "4px 0", borderBottom: "2px solid transparent",
              transition: "border-color 150ms",
            }}
            onFocus={e => { e.target.style.borderBottomColor = "var(--border)"; }}
            onBlur={e => { e.target.style.borderBottomColor = "transparent"; }}
            placeholder="Worker name" aria-label="Worker name"
          />
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Schedule</div>
            <SchedulePicker schedule={schedule} onScheduleChange={onScheduleChange} />
          </div>
          <div>
            <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Model</div>
            <ModelDropdown model={model} onModelChange={onModelChange} />
          </div>
        </div>
      </div>

      {/* Charter columns */}
      <div style={{ padding: "20px 24px" }}>
        <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 16 }}>
          Charter Rules
          <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, marginLeft: 8, fontSize: "11px", color: "var(--text-tertiary)" }}>
            Click a rule to cycle its category
          </span>
        </div>

        <div style={{
          fontSize: "12px", color: "var(--text-tertiary)", lineHeight: 1.6,
          padding: "10px 14px", background: "var(--bg-primary, var(--bg-100))",
          borderRadius: 8, marginBottom: 16, border: "1px solid var(--border)",
        }}>
          <strong style={{ color: "var(--text-secondary)" }}>How charters work:</strong>{" "}
          <span style={{ color: "var(--green, #5bb98c)" }}>Green rules</span> run automatically.{" "}
          <span style={{ color: "var(--amber, #c08c30)" }}>Amber rules</span> pause for your approval.{" "}
          <span style={{ color: "var(--red, #c43a3a)" }}>Red rules</span> are blocked entirely.{" "}
          Click any rule to move it between categories.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
          {CHARTER_SECTIONS.map(sec => {
            const rules = charter[sec.key] || [];
            return (
              <div key={sec.key}>
                <div style={{
                  fontSize: "12px", fontWeight: 700, color: sec.color, textTransform: "uppercase",
                  letterSpacing: "0.05em", marginBottom: 10, display: "flex", alignItems: "center", gap: 6,
                }}>
                  <span style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    width: 20, height: 20, borderRadius: "50%", background: sec.bg, fontSize: "11px", fontWeight: 700,
                  }}>
                    {sec.icon}
                  </span>
                  {sec.label}
                  <span style={{ fontSize: "11px", fontWeight: 500, opacity: 0.6 }}>({rules.length})</span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 6, minHeight: 40 }}>
                  {rules.map((rule, i) => (
                    <div
                      key={`${sec.key}-${i}`}
                      style={pillStyle(sec)}
                      onClick={() => cycleRule(sec.key, i)}
                      title={`Click to move to ${CYCLE_ORDER[(CYCLE_ORDER.indexOf(sec.key) + 1) % 3].replace(/([A-Z])/g, " $1").trim()}`}
                    >
                      <span style={{ flex: 1 }}>{rule}</span>
                      <button
                        style={removeBtn}
                        onClick={e => { e.stopPropagation(); removeRule(sec.key, i); }}
                        onMouseEnter={e => { e.currentTarget.style.opacity = "1"; }}
                        onMouseLeave={e => { e.currentTarget.style.opacity = "0.6"; }}
                        title="Remove rule"
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>

                {/* Add new rule input */}
                <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
                  <input
                    value={newRuleTexts[sec.key] || ""}
                    onChange={e => setNewRuleTexts(prev => ({ ...prev, [sec.key]: e.target.value }))}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addRule(sec.key); } }}
                    placeholder="Add rule..." aria-label={"Add " + sec.label + " rule"}
                    style={{
                      flex: 1, fontSize: "12px", padding: "5px 8px", borderRadius: 6,
                      border: "1px solid var(--border)", background: "var(--bg-primary)",
                      color: "var(--text-primary)", outline: "none", fontFamily: "var(--font-mono)",
                      transition: "border-color 150ms", boxSizing: "border-box",
                    }}
                    onFocus={e => { e.target.style.borderColor = sec.color; }}
                    onBlur={e => { e.target.style.borderColor = "var(--border)"; }}
                  />
                  <button
                    onClick={() => addRule(sec.key)}
                    style={{
                      width: 26, height: 26, borderRadius: 6, border: `1px solid ${sec.color}44`,
                      background: sec.bg, color: sec.color, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: "16px", fontWeight: 700, padding: 0, flexShrink: 0,
                    }}
                    title={`Add to ${sec.label}`}
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Deploy button */}
      <div style={{ padding: "16px 24px 20px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 12, alignItems: "center" }}>
        <div style={{ flex: 1, fontSize: "12px", color: "var(--text-tertiary)" }}>
          {(charter.canDo?.length || 0) + (charter.askFirst?.length || 0) + (charter.neverDo?.length || 0)} rules defined
        </div>
        <button
          style={{
            ...S.btnPrimary, width: "auto", padding: "12px 32px", fontSize: "15px",
            opacity: (deploying || (charter.canDo?.length || 0) + (charter.askFirst?.length || 0) + (charter.neverDo?.length || 0) === 0) ? 0.5 : 1,
            background: "var(--green)", color: "#fff",
            cursor: (charter.canDo?.length || 0) + (charter.askFirst?.length || 0) + (charter.neverDo?.length || 0) === 0 ? "not-allowed" : "pointer",
          }}
          disabled={deploying || (charter.canDo?.length || 0) + (charter.askFirst?.length || 0) + (charter.neverDo?.length || 0) === 0}
          onClick={onDeploy}
          title={(charter.canDo?.length || 0) + (charter.askFirst?.length || 0) + (charter.neverDo?.length || 0) === 0 ? "Add at least one rule before deploying" : undefined}
        >
          {deploying ? "Deploying..." : "Deploy Worker"}
        </button>
      </div>
    </div>
  );
}

export { SchedulePicker };
export default CharterEditor;
