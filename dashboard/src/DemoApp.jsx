import { useEffect, useState } from "react";

import TelemetryCard from "./components/TelemetryCard.jsx";
import SLAVerification from "./components/SLAVerification.jsx";
import OutputCards from "./components/OutputCards.jsx";
import FinancePackCards from "./components/FinancePackCards.jsx";
import FinanceWorkflow from "./components/FinanceWorkflow.jsx";
import BeforeAfterPanel from "./components/BeforeAfterPanel.jsx";
import PhaseCallout from "./components/PhaseCallout.jsx";
import StoryHeader from "./components/StoryHeader.jsx";
import DemoPicker from "./components/DemoPicker.jsx";
import TruthStrip from "./components/TruthStrip.jsx";
import JobReplay from "./components/JobReplay.jsx";
import CommandCenter from "./components/CommandCenter.jsx";
import useDemoData from "./hooks/useDemoData.js";

export default function DemoApp() {
  const { telemetry, sla, outputs, money, finance, timeline, phase, runDemo, sourceLabel, scenarioId, setScenarioId, scenarios } = useDemoData();
  const [uiMode, setUiMode] = useState(() => {
    try {
      const u = new URL(window.location.href);
      const forcedTour = u.searchParams.get("tour") === "1" || u.hash === "#tour";
      if (forcedTour) return "story";
      return localStorage.getItem("settld_demo_ui_mode") || "story";
    } catch {
      return "story";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("settld_demo_ui_mode", uiMode);
    } catch {
      // ignore
    }
  }, [uiMode]);

  if (uiMode === "console") {
    return <CommandCenter scenarioId={scenarioId} setScenarioId={setScenarioId} scenarios={scenarios} onExit={() => setUiMode("story")} />;
  }

  const truth = (() => {
    if (scenarioId === "finance") {
      const reconcileOk = finance?.reconcileJson?.ok === true;
      return {
        chain: { status: "na", detail: "fixture" },
        proof: { status: reconcileOk ? "ok" : "warn", detail: reconcileOk ? "reconcile OK" : "reconcile missing" },
        ledger: { status: reconcileOk ? "ok" : "na", detail: reconcileOk ? `${finance?.reconcileJson?.entryCount ?? 0} entries` : "fixture" },
        exports: { status: finance?.journalCsvText ? "ok" : "warn", detail: finance?.journalCsvText ? "JournalCsv present" : "missing" },
        month: { status: reconcileOk ? "ok" : "na", detail: finance?.period ?? "period" }
      };
    }
    return {
      chain: { status: "ok", detail: "hash-chained" },
      proof: { status: "na", detail: "not implemented in this demo yet" },
      ledger: { status: "ok", detail: "net-zero" },
      exports: { status: "na", detail: "fixture" },
      month: { status: "na", detail: "fixture" }
    };
  })();

  return (
    <div className="demo-root">
      <div className="demo-bg demo-bg-a" aria-hidden="true" />
      <div className="demo-bg demo-bg-b" aria-hidden="true" />

      <header className="demo-topbar">
        <div>
          <p className="demo-eyebrow">Runtime Playground</p>
          <h1>Settld Demo Environment</h1>
          <p>Watch autonomous workflows produce finance-grade artifacts with deterministic verification.</p>
        </div>
        <div className="demo-top-actions">
          <button className="demo-pill-btn" onClick={() => setUiMode("console")}>Command center</button>
          <a className="demo-pill-btn" href="/">Back to site</a>
        </div>
      </header>

      <section className="demo-meta-row">
        <article>
          <span>Scenario</span>
          <strong>{scenarioId}</strong>
        </article>
        <article>
          <span>Data source</span>
          <strong>{sourceLabel}</strong>
        </article>
        <article>
          <span>Mode</span>
          <strong>{uiMode}</strong>
        </article>
      </section>

      {phase === "idle" && (
        <div className="demo-stage">
          <div className="max-w-4xl mx-auto space-y-8">
            <DemoPicker scenarioId={scenarioId} setScenarioId={setScenarioId} scenarios={scenarios} />
            <TruthStrip truth={truth} />
            <BeforeAfterPanel />
            <div className="flex justify-center">
              <button onClick={runDemo} className="demo-run-btn">
                Run Demo
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="demo-stage">
        <div className="max-w-4xl mx-auto space-y-8">
          {phase !== "idle" && (
            <div className="animate-slide-in">
              <StoryHeader telemetry={telemetry} money={money} scenarioId={scenarioId} period={finance?.period ?? null} />
            </div>
          )}

          {phase !== "idle" && (
            <div className="animate-slide-in" style={{ animationDelay: "0.05s" }}>
              <PhaseCallout phase={phase} telemetry={telemetry} money={money} scenarioId={scenarioId} />
            </div>
          )}

          {phase === "before" && (
            <div className="animate-slide-in">
              <TruthStrip truth={truth} />
              <BeforeAfterPanel />
            </div>
          )}

          {scenarioId !== "finance" && phase !== "idle" && phase !== "before" && (
            <div className="animate-slide-in">
              <TelemetryCard telemetry={telemetry} phase={phase} />
            </div>
          )}

          {scenarioId !== "finance" && phase !== "idle" && phase !== "before" && phase !== "telemetry" && phase !== "breach" && (
            <div className="flex justify-center text-settld-accent text-3xl animate-slide-in">↓</div>
          )}

          {scenarioId !== "finance" && (phase === "sla" || phase === "outputs" || phase === "complete") && (
            <div className="animate-slide-in" style={{ animationDelay: "0.2s" }}>
              <SLAVerification sla={sla} phase={phase} />
            </div>
          )}

          {scenarioId !== "finance" && (phase === "outputs" || phase === "complete") && (
            <div className="flex justify-center text-settld-accent text-3xl animate-slide-in">↓</div>
          )}

          {phase === "complete" && (
            <>
              <div className="animate-slide-in" style={{ animationDelay: "0.35s" }}>
                <TruthStrip truth={truth} />
              </div>
              <div className="animate-slide-in" style={{ animationDelay: "0.4s" }}>
                <OutputCards outputs={outputs} />
              </div>
              {scenarioId === "delivery" && (
                <div className="animate-slide-in" style={{ animationDelay: "0.43s" }}>
                  <JobReplay timeline={timeline} money={money} />
                </div>
              )}
              {scenarioId === "finance" && finance && (
                <div className="animate-slide-in" style={{ animationDelay: "0.45s" }}>
                  <FinancePackCards finance={finance} />
                </div>
              )}
              {scenarioId === "finance" && finance?.steps && (
                <div className="animate-slide-in" style={{ animationDelay: "0.48s" }}>
                  <FinanceWorkflow steps={finance.steps} />
                </div>
              )}
              <div className="animate-slide-in" style={{ animationDelay: "0.5s" }}>
                <BeforeAfterPanel />
              </div>
              <div className="flex justify-center pt-2">
                <button onClick={runDemo} className="demo-pill-btn">
                  Replay
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
