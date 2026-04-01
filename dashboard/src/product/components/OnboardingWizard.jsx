import React, { useState } from "react";
import {
  workerApiRequest, saveOnboardingState, loadOnboardingState,
} from "../shared.js";

/* ===================================================================
   Styles
   =================================================================== */

const W = {
  wrap: {
    minHeight: "100vh", display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center", padding: "2rem 1.5rem",
    background: "var(--bg-100, #faf9f6)",
    fontFamily: "var(--font-body, 'Plus Jakarta Sans', system-ui, sans-serif)",
    WebkitFontSmoothing: "antialiased",
  },
  inner: { width: "100%", maxWidth: 620 },
  heading: {
    fontSize: 28, fontWeight: 700, color: "var(--text-100, #111110)",
    marginBottom: "0.5rem", lineHeight: 1.15, letterSpacing: "-0.02em",
    fontFamily: "var(--font-display, 'Fraunces', serif)",
  },
  sub: {
    fontSize: 15, color: "var(--text-200, #4a4a45)",
    marginBottom: "2rem", lineHeight: 1.5,
  },
  input: {
    display: "block", width: "100%", padding: "18px 20px", fontSize: 16,
    background: "var(--bg-400, #ffffff)",
    border: "1px solid var(--border, #e5e3dd)", borderRadius: 12,
    color: "var(--text-100, #111110)", outline: "none", marginBottom: "1.25rem",
    fontFamily: "inherit", transition: "border-color 0.2s, box-shadow 0.2s",
    boxSizing: "border-box",
  },
  btn: {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    padding: "12px 24px", fontSize: 15, fontWeight: 600,
    background: "var(--orange, #e8712a)", color: "#fff",
    border: "none", borderRadius: 10, cursor: "pointer", fontFamily: "inherit",
    transition: "opacity 0.15s", letterSpacing: "0.01em",
  },
  btnSecondary: {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    padding: "10px 20px", fontSize: 14, fontWeight: 500,
    background: "transparent", color: "var(--text-200, #4a4a45)",
    border: "1px solid var(--border, #e5e3dd)", borderRadius: 10,
    cursor: "pointer", fontFamily: "inherit", transition: "border-color 0.15s",
  },
  card: {
    padding: "16px 18px", borderRadius: 12,
    border: "1px solid var(--border, #e5e3dd)",
    background: "var(--bg-400, #ffffff)",
    marginBottom: 10,
  },
  cardName: {
    fontSize: 15, fontWeight: 600, color: "var(--text-100, #111110)",
    marginBottom: 4,
  },
  cardDesc: {
    fontSize: 13, color: "var(--text-200, #4a4a45)", lineHeight: 1.45,
    marginBottom: 8,
  },
  pill: {
    display: "inline-block", padding: "2px 8px", fontSize: 11, fontWeight: 500,
    borderRadius: 6, marginRight: 4, marginBottom: 4, lineHeight: 1.6,
  },
  pillGreen: { background: "rgba(42,157,110,0.1)", color: "#2a9d6e" },
  pillYellow: { background: "rgba(200,160,50,0.1)", color: "#a08020" },
  pillRed: { background: "rgba(196,58,58,0.08)", color: "#c43a3a" },
  steps: {
    display: "flex", gap: 8, marginBottom: "2rem",
  },
  stepDot: (active) => ({
    width: 32, height: 4, borderRadius: 2,
    background: active ? "var(--orange, #e8712a)" : "var(--border, #e5e3dd)",
    transition: "background 0.2s",
  }),
  footer: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    marginTop: "2rem", gap: 12,
  },
  error: {
    padding: "10px 14px", marginBottom: 14, borderRadius: 8,
    background: "rgba(196,58,58,0.08)", border: "1px solid var(--red, #c43a3a)",
    color: "var(--red, #c43a3a)", fontSize: 14, lineHeight: 1.5,
  },
};

/* ===================================================================
   Step 1: Describe your business
   =================================================================== */

function DescribeStep({ description, setDescription, onGenerate, generating, error }) {
  return (
    <div>
      <h1 style={W.heading}>Describe your business in one sentence</h1>
      <p style={W.sub}>We will generate a team of AI workers tailored to your industry.</p>
      {error && <div style={W.error}>{error}</div>}
      <input
        type="text"
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="I run a plumbing company in Denver with 8 technicians"
        style={W.input}
        autoFocus
      />
      <div style={W.footer}>
        <div />
        <button
          style={{ ...W.btn, opacity: !description.trim() || generating ? 0.4 : 1 }}
          disabled={!description.trim() || generating}
          onClick={onGenerate}
        >
          {generating ? "Generating..." : "Generate My Team"}
        </button>
      </div>
    </div>
  );
}

/* ===================================================================
   Step 2: Team preview
   =================================================================== */

function TeamPreviewStep({ team, onActivate, onBack, activating, error }) {
  if (!team) return null;
  return (
    <div>
      <h1 style={W.heading}>Your team for {team.businessName}</h1>
      <p style={W.sub}>
        Industry: <strong>{team.industry.replace(/_/g, " ")}</strong> — {team.workers.length} workers generated. Review and activate.
      </p>
      {error && <div style={W.error}>{error}</div>}
      <div>
        {team.workers.map((w, i) => (
          <div key={i} style={W.card}>
            <div style={W.cardName}>{w.name}</div>
            <div style={W.cardDesc}>{w.charter.goal}</div>
            <div>
              {w.charter.canDo.slice(0, 3).map((r, j) => (
                <span key={`c${j}`} style={{ ...W.pill, ...W.pillGreen }}>{r}</span>
              ))}
              {w.charter.askFirst.slice(0, 2).map((r, j) => (
                <span key={`a${j}`} style={{ ...W.pill, ...W.pillYellow }}>{r}</span>
              ))}
              {w.charter.neverDo.slice(0, 2).map((r, j) => (
                <span key={`n${j}`} style={{ ...W.pill, ...W.pillRed }}>{r}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={W.footer}>
        <button style={W.btnSecondary} onClick={onBack}>Back</button>
        <button
          style={{ ...W.btn, opacity: activating ? 0.4 : 1 }}
          disabled={activating}
          onClick={onActivate}
        >
          {activating ? "Activating..." : "Activate Team"}
        </button>
      </div>
    </div>
  );
}

/* ===================================================================
   Step 3: Success
   =================================================================== */

function SuccessStep({ onDone }) {
  return (
    <div style={{ textAlign: "center" }}>
      <h1 style={W.heading}>Your team is ready!</h1>
      <p style={W.sub}>Your AI workers have been activated and are standing by. Head to the dashboard to manage them.</p>
      <button style={W.btn} onClick={onDone}>Go to Dashboard</button>
    </div>
  );
}

/* ===================================================================
   Main wizard
   =================================================================== */

function OnboardingWizard({ onComplete }) {
  const [step, setStep] = useState(0);
  const [description, setDescription] = useState("");
  const [team, setTeam] = useState(null);
  const [createdWorkers, setCreatedWorkers] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState(null);

  async function handleGenerate() {
    if (!description.trim()) return;
    setGenerating(true);
    setError(null);
    try {
      const result = await workerApiRequest({
        pathname: "/v1/workers/generate-team",
        method: "POST",
        body: { description: description.trim() },
      });
      setTeam(result.team);
      setCreatedWorkers(result.workers || []);
      setStep(1);
    } catch (e) {
      console.error("Team generation failed:", e);
      setError("Failed to generate team. Check your connection and try again.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleActivate() {
    setActivating(true);
    setError(null);
    try {
      for (const w of createdWorkers) {
        await workerApiRequest({
          pathname: `/v1/workers/${w.id}`,
          method: "PATCH",
          body: { status: "ready" },
        });
      }
      setStep(2);
    } catch (e) {
      console.error("Activation failed:", e);
      setError("Failed to activate workers. You can activate them from the dashboard.");
    } finally {
      setActivating(false);
    }
  }

  function handleDone() {
    const existing = loadOnboardingState() || {};
    saveOnboardingState({ ...existing, onboardingComplete: true });
    if (onComplete) onComplete();
  }

  return (
    <div style={W.wrap}>
      <div style={W.inner} className="lovable-fade">
        <div style={W.steps}>
          {[0, 1, 2].map(i => (
            <div key={i} style={W.stepDot(i <= step)} />
          ))}
        </div>

        {step === 0 && (
          <DescribeStep
            description={description}
            setDescription={setDescription}
            onGenerate={handleGenerate}
            generating={generating}
            error={error}
          />
        )}
        {step === 1 && (
          <TeamPreviewStep
            team={team}
            onActivate={handleActivate}
            onBack={() => { setStep(0); setError(null); }}
            activating={activating}
            error={error}
          />
        )}
        {step === 2 && (
          <SuccessStep onDone={handleDone} />
        )}
      </div>
    </div>
  );
}

export default OnboardingWizard;
