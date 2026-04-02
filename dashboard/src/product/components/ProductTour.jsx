import React, { useState, useEffect, useCallback, useRef } from "react";

const TOUR_STORAGE_KEY = "nooterra_tour_complete";

const TOUR_STEPS = [
  {
    key: "sidebar",
    title: "Command Center",
    description: "This is your command center. Navigate between your team, inbox, and performance.",
    selector: ".app-sidebar",
    position: "right",
  },
  {
    key: "builder",
    title: "Worker Builder",
    description: "Create governed agents here. Connect your systems and they'll start observing your business.",
    selector: '[data-tour="builder"]',
    fallbackSelector: ".app-sidebar button",
    position: "right",
  },
  {
    key: "team",
    title: "Your Team",
    description: "Your agents appear here. Monitor their status, performance, and autonomy levels.",
    selector: '[data-tour="team"]',
    position: "right",
  },
  {
    key: "inbox",
    title: "Approval Inbox",
    description: "Actions that need your approval show up here. Workers pause and wait.",
    selector: '[data-tour="inbox"]',
    position: "right",
  },
  {
    key: "performance",
    title: "Performance",
    description: "Track costs, execution traces, and team health.",
    selector: '[data-tour="performance"]',
    position: "right",
  },
];

function getElementRect(step) {
  let el = document.querySelector(step.selector);
  if (!el && step.fallbackSelector) {
    el = document.querySelector(step.fallbackSelector);
  }
  if (!el) return null;
  return el.getBoundingClientRect();
}

export default function ProductTour({ onComplete }) {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const [targetRect, setTargetRect] = useState(null);
  const rafRef = useRef(null);

  // Check localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(TOUR_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.tourComplete) {
          onComplete?.();
          return;
        }
      }
    } catch { /* ignore */ }
    // Small delay so the shell fully renders before we position tooltips
    const timer = setTimeout(() => setVisible(true), 600);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Track target element position — event-driven, not a perpetual RAF loop
  const updatePosition = useCallback(() => {
    if (!visible) return;
    const currentStep = TOUR_STEPS[step];
    if (!currentStep) return;
    // Use a single RAF to batch with browser paint, then stop
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const rect = getElementRect(currentStep);
      setTargetRect(rect);
      rafRef.current = null;
    });
  }, [step, visible]);

  useEffect(() => {
    if (!visible) return;
    // Initial measurement
    updatePosition();

    // Recalculate on resize / scroll
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    // ResizeObserver on the target element if available
    let observer = null;
    const currentStep = TOUR_STEPS[step];
    if (currentStep && typeof ResizeObserver !== "undefined") {
      const el = document.querySelector(currentStep.selector)
        || (currentStep.fallbackSelector && document.querySelector(currentStep.fallbackSelector));
      if (el) {
        observer = new ResizeObserver(updatePosition);
        observer.observe(el);
      }
    }

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      if (observer) observer.disconnect();
    };
  }, [updatePosition, visible, step]);

  function completeTour() {
    try {
      localStorage.setItem(TOUR_STORAGE_KEY, JSON.stringify({ tourComplete: true }));
    } catch { /* ignore */ }
    setVisible(false);
    onComplete?.();
  }

  function handleNext() {
    if (step >= TOUR_STEPS.length - 1) {
      completeTour();
    } else {
      setStep(step + 1);
    }
  }

  function handleSkip() {
    completeTour();
  }

  if (!visible) return null;

  const currentStep = TOUR_STEPS[step];
  const isLast = step === TOUR_STEPS.length - 1;

  // Calculate tooltip position
  let tooltipStyle = {
    position: "fixed",
    zIndex: 10001,
    transition: "top 250ms ease, left 250ms ease",
  };

  if (targetRect) {
    // Position to the right of the target
    const tooltipWidth = 320;
    const gap = 16;

    if (currentStep.position === "right") {
      tooltipStyle.left = Math.min(targetRect.right + gap, window.innerWidth - tooltipWidth - 16);
      tooltipStyle.top = Math.max(16, targetRect.top + targetRect.height / 2 - 60);
    } else {
      tooltipStyle.left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
      tooltipStyle.top = targetRect.bottom + gap;
    }
  } else {
    // Fallback: center of screen
    tooltipStyle.left = "50%";
    tooltipStyle.top = "50%";
    tooltipStyle.transform = "translate(-50%, -50%)";
  }

  // Highlight overlay dimensions
  const highlightStyle = targetRect ? {
    position: "fixed",
    zIndex: 10000,
    left: targetRect.left - 4,
    top: targetRect.top - 4,
    width: targetRect.width + 8,
    height: targetRect.height + 8,
    borderRadius: 12,
    boxShadow: "0 0 0 4000px rgba(0, 0, 0, 0.45), 0 0 20px 4px rgba(196, 97, 58, 0.3)",
    pointerEvents: "none",
    transition: "all 300ms ease",
  } : null;

  return (
    <>
      <style>{`
        @keyframes tour-pulse {
          0%, 100% { box-shadow: 0 0 0 4000px rgba(0, 0, 0, 0.45), 0 0 20px 4px rgba(196, 97, 58, 0.3); }
          50% { box-shadow: 0 0 0 4000px rgba(0, 0, 0, 0.45), 0 0 28px 8px rgba(196, 97, 58, 0.5); }
        }
        @keyframes tour-fade-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Highlight cutout */}
      {highlightStyle && (
        <div style={{ ...highlightStyle, animation: "tour-pulse 2s ease-in-out infinite" }} />
      )}

      {/* Backdrop click to skip */}
      <div
        onClick={handleSkip}
        style={{
          position: "fixed", inset: 0, zIndex: 9999,
          cursor: "pointer",
        }}
      />

      {/* Tooltip card */}
      <div style={{
        ...tooltipStyle,
        width: 320,
        background: "var(--bg-400, #1a1a1a)",
        border: "1px solid var(--border, #333)",
        borderRadius: 14,
        boxShadow: "0 12px 40px rgba(0, 0, 0, 0.4)",
        padding: "20px",
        animation: "tour-fade-in 0.3s ease-out",
      }}>
        {/* Step indicator */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: 12,
        }}>
          <span style={{
            fontSize: "11px", fontWeight: 700, color: "var(--accent, #c4613a)",
            textTransform: "uppercase", letterSpacing: "0.06em",
          }}>
            Step {step + 1} of {TOUR_STEPS.length}
          </span>
          <div style={{ display: "flex", gap: 4 }}>
            {TOUR_STEPS.map((_, i) => (
              <div key={i} style={{
                width: 6, height: 6, borderRadius: "50%",
                background: i <= step ? "var(--accent, #c4613a)" : "var(--border, #333)",
                transition: "background 200ms",
              }} />
            ))}
          </div>
        </div>

        {/* Title */}
        <div style={{
          fontSize: "15px", fontWeight: 700, color: "var(--text-100, #fff)",
          marginBottom: 6,
        }}>
          {currentStep.title}
        </div>

        {/* Description */}
        <div style={{
          fontSize: "13px", color: "var(--text-200, #aaa)",
          lineHeight: 1.55, marginBottom: 20,
        }}>
          {currentStep.description}
        </div>

        {/* Buttons */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button
            onClick={handleSkip}
            style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: "13px", color: "var(--text-300, #666)",
              fontFamily: "inherit", padding: "4px 8px",
              transition: "color 150ms",
            }}
            onMouseEnter={e => { e.currentTarget.style.color = "var(--text-200, #aaa)"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "var(--text-300, #666)"; }}
          >
            Skip tour
          </button>
          <button
            onClick={handleNext}
            style={{
              background: "var(--accent, #c4613a)", color: "#fff",
              border: "none", borderRadius: 8, padding: "8px 20px",
              fontSize: "13px", fontWeight: 600, cursor: "pointer",
              fontFamily: "inherit", transition: "opacity 150ms",
            }}
            onMouseEnter={e => { e.currentTarget.style.opacity = "0.85"; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
          >
            {isLast ? "Finish" : "Next"}
          </button>
        </div>
      </div>
    </>
  );
}
