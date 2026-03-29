import React, { useState } from "react";
import {
  WORKER_TEMPLATES,
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
  inner: { width: "100%", maxWidth: 560 },
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
    display: "block", width: "100%", padding: "14px 18px", fontSize: 15,
    background: "var(--bg-400, #ffffff)",
    border: "1px solid var(--border, #e5e3dd)", borderRadius: 10,
    color: "var(--text-100, #111110)", outline: "none", marginBottom: "1rem",
    fontFamily: "inherit", transition: "border-color 0.2s, box-shadow 0.2s",
    boxSizing: "border-box",
  },
  btn: {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    padding: "12px 24px", fontSize: 15, fontWeight: 600,
    background: "var(--text-100, #111110)", color: "var(--bg-100, #faf9f6)",
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
    cursor: "pointer", transition: "border-color 0.2s, box-shadow 0.2s",
  },
  cardSelected: {
    borderColor: "var(--text-100, #111110)",
    boxShadow: "0 0 0 1px var(--text-100, #111110)",
  },
  cardName: {
    fontSize: 15, fontWeight: 600, color: "var(--text-100, #111110)",
    marginBottom: 4,
  },
  cardDesc: {
    fontSize: 13, color: "var(--text-200, #4a4a45)", lineHeight: 1.45,
  },
  steps: {
    display: "flex", gap: 8, marginBottom: "2rem",
  },
  stepDot: (active) => ({
    width: 32, height: 4, borderRadius: 2,
    background: active ? "var(--text-100, #111110)" : "var(--border, #e5e3dd)",
    transition: "background 0.2s",
  }),
  footer: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    marginTop: "2rem", gap: 12,
  },
  integrationBtn: (connected) => ({
    display: "flex", alignItems: "center", gap: 10,
    padding: "14px 18px", borderRadius: 12, width: "100%",
    border: connected ? "1px solid var(--text-100, #111110)" : "1px solid var(--border, #e5e3dd)",
    background: connected ? "var(--bg-300, #f3f1ec)" : "var(--bg-400, #ffffff)",
    cursor: "pointer", fontFamily: "inherit", fontSize: 15, fontWeight: 500,
    color: "var(--text-100, #111110)", transition: "border-color 0.2s",
  }),
};

const INTEGRATIONS = [
  { key: "gmail", name: "Gmail", icon: "\u2709\uFE0F" },
  { key: "slack", name: "Slack", icon: "\u{1F4AC}" },
  { key: "github", name: "GitHub", icon: "\u{1F4BB}" },
];

/* ===================================================================
   Steps
   =================================================================== */

function WelcomeStep({ workspaceName, setWorkspaceName, onNext }) {
  return (
    <div>
      <h1 style={W.heading}>Welcome to Nooterra</h1>
      <p style={W.sub}>Your AI workforce starts here. Give your workspace a name to get started.</p>
      <input
        type="text"
        value={workspaceName}
        onChange={e => setWorkspaceName(e.target.value)}
        placeholder="e.g. Acme Corp"
        style={W.input}
        autoFocus
      />
      <div style={W.footer}>
        <div />
        <button
          style={{ ...W.btn, opacity: !workspaceName.trim() ? 0.4 : 1 }}
          disabled={!workspaceName.trim()}
          onClick={onNext}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

function FirstWorkerStep({ selectedTemplate, setSelectedTemplate, onNext, onBack, creating }) {
  return (
    <div>
      <h1 style={W.heading}>Create your first worker</h1>
      <p style={W.sub}>Pick a template to start with. You can customize everything later.</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {WORKER_TEMPLATES.map((tpl, i) => (
          <div
            key={tpl.name}
            style={{
              ...W.card,
              ...(selectedTemplate === i ? W.cardSelected : {}),
            }}
            onClick={() => setSelectedTemplate(i)}
            onMouseEnter={e => {
              if (selectedTemplate !== i) e.currentTarget.style.borderColor = "var(--text-300, #8a8a82)";
            }}
            onMouseLeave={e => {
              if (selectedTemplate !== i) e.currentTarget.style.borderColor = "var(--border, #e5e3dd)";
            }}
          >
            <div style={W.cardName}>{tpl.name}</div>
            <div style={W.cardDesc}>{tpl.description}</div>
          </div>
        ))}
      </div>
      <div style={W.footer}>
        <button style={W.btnSecondary} onClick={onBack}>Back</button>
        <button
          style={{ ...W.btn, opacity: selectedTemplate === null || creating ? 0.4 : 1 }}
          disabled={selectedTemplate === null || creating}
          onClick={onNext}
        >
          {creating ? "Creating..." : "Create worker"}
        </button>
      </div>
    </div>
  );
}

function ConnectStep({ onDone, onBack }) {
  const [connected, setConnected] = useState({});

  function handleConnect(key) {
    // Mark as "connected" for UI purposes -- actual OAuth would redirect
    setConnected(prev => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <div>
      <h1 style={W.heading}>Connect your tools</h1>
      <p style={W.sub}>Give your workers access to the tools they need. You can always add more later.</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {INTEGRATIONS.map(intg => (
          <button
            key={intg.key}
            style={W.integrationBtn(connected[intg.key])}
            onClick={() => handleConnect(intg.key)}
            onMouseEnter={e => {
              if (!connected[intg.key]) e.currentTarget.style.borderColor = "var(--text-300, #8a8a82)";
            }}
            onMouseLeave={e => {
              if (!connected[intg.key]) e.currentTarget.style.borderColor = "var(--border, #e5e3dd)";
            }}
          >
            <span style={{ fontSize: 20 }}>{intg.icon}</span>
            <span style={{ flex: 1, textAlign: "left" }}>{intg.name}</span>
            {connected[intg.key] && (
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--green, #2a9d6e)" }}>Connected</span>
            )}
          </button>
        ))}
      </div>
      <div style={W.footer}>
        <button style={W.btnSecondary} onClick={onBack}>Back</button>
        <div style={{ display: "flex", gap: 10 }}>
          <button style={W.btnSecondary} onClick={onDone}>Skip</button>
          <button style={W.btn} onClick={onDone}>Done</button>
        </div>
      </div>
    </div>
  );
}

/* ===================================================================
   Main wizard
   =================================================================== */

function OnboardingWizard({ onComplete }) {
  const [step, setStep] = useState(0);
  const [workspaceName, setWorkspaceName] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [creating, setCreating] = useState(false);

  async function handleCreateWorker() {
    if (selectedTemplate === null) return;
    setCreating(true);
    const tpl = WORKER_TEMPLATES[selectedTemplate];
    try {
      await workerApiRequest({
        pathname: "/v1/workers",
        method: "POST",
        body: {
          name: tpl.name,
          description: tpl.description,
          model: tpl.model,
          schedule: tpl.schedule,
          charter: tpl.charter,
        },
      });
    } catch { /* non-fatal -- worker may still be created */ }
    setCreating(false);
    setStep(2);
  }

  function handleDone() {
    const existing = loadOnboardingState() || {};
    saveOnboardingState({ ...existing, onboardingComplete: true });
    if (onComplete) onComplete();
  }

  return (
    <div style={W.wrap}>
      <div style={W.inner} className="lovable-fade">
        {/* Progress dots */}
        <div style={W.steps}>
          {[0, 1, 2].map(i => (
            <div key={i} style={W.stepDot(i <= step)} />
          ))}
        </div>

        {step === 0 && (
          <WelcomeStep
            workspaceName={workspaceName}
            setWorkspaceName={setWorkspaceName}
            onNext={() => setStep(1)}
          />
        )}
        {step === 1 && (
          <FirstWorkerStep
            selectedTemplate={selectedTemplate}
            setSelectedTemplate={setSelectedTemplate}
            onNext={handleCreateWorker}
            onBack={() => setStep(0)}
            creating={creating}
          />
        )}
        {step === 2 && (
          <ConnectStep
            onDone={handleDone}
            onBack={() => setStep(1)}
          />
        )}
      </div>
    </div>
  );
}

export default OnboardingWizard;
