import { useEffect, useRef, useState } from "react";
import { triggerBackfill, getObjectCounts } from "../../lib/employee-api";

const MAX_POLLS = 60;
const POLL_INTERVAL_MS = 2000;

function CheckIcon() {
  return (
    <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5 8l2.5 2.5L11 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg className="w-4 h-4 text-blue-500 animate-spin" fill="none" viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" strokeDasharray="20 18" />
    </svg>
  );
}

function EmptyIcon() {
  return (
    <div className="w-4 h-4 rounded-full border border-[#2a2d3d]" />
  );
}

export default function BuildContext({ state, update, onNext, onBack }) {
  // phase: 0=connecting, 1=scanning customers, 2=building invoice history, 3=identifying overdue, 4=ready
  const [phase, setPhase] = useState(0);
  const [counts, setCounts] = useState({ customers: 0, invoices: 0 });
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);
  const pollCountRef = useRef(0);
  const timerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        await triggerBackfill();
      } catch {
        // Backfill trigger failure is non-fatal — continue polling
      }

      if (cancelled) return;
      setPhase(1);

      function poll() {
        if (cancelled) return;
        if (pollCountRef.current >= MAX_POLLS) {
          setPhase(4);
          setDone(true);
          return;
        }

        pollCountRef.current += 1;

        getObjectCounts()
          .then((data) => {
            if (cancelled) return;
            const customers = data.customers ?? data.party ?? 0;
            const invoices = data.invoices ?? 0;
            setCounts({ customers, invoices });

            if (customers > 0 && invoices > 0) {
              setPhase(4);
              setDone(true);
              return;
            }
            if (customers > 0) setPhase(2);

            timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
          })
          .catch(() => {
            if (cancelled) return;
            timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
          });
      }

      timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
    }

    start();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const steps = [
    { label: "Connecting to Stripe", detail: null },
    { label: "Scanning customers", detail: counts.customers > 0 ? `${counts.customers.toLocaleString()} found` : null },
    { label: "Building invoice history", detail: counts.invoices > 0 ? `${counts.invoices.toLocaleString()} found` : null },
    { label: "Identifying overdue accounts", detail: null },
    { label: "Ready", detail: null },
  ];

  function getStepState(index) {
    if (index < phase) return "done";
    if (index === phase) return "active";
    return "pending";
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-xl font-semibold text-[#e8e9ed] mb-2">Building context</h2>
        <p className="text-[#8b8fa3] text-sm leading-relaxed">
          {state.employeeName || "Riley"} is scanning your Stripe data to understand your accounts.
        </p>
      </div>

      <div className="border border-[#2a2d3d] rounded-xl p-5 bg-[#0f0f17] flex flex-col gap-4">
        {steps.map((step, i) => {
          const stepState = getStepState(i);
          return (
            <div key={i} className="flex items-center gap-3">
              <div className="flex-shrink-0">
                {stepState === "done" && <CheckIcon />}
                {stepState === "active" && <SpinnerIcon />}
                {stepState === "pending" && <EmptyIcon />}
              </div>
              <div className="flex-1 flex items-center justify-between gap-2">
                <span className={`text-sm ${stepState === "pending" ? "text-[#4a4d5e]" : "text-[#e8e9ed]"}`}>
                  {step.label}
                </span>
                {step.detail && (
                  <span className="text-xs text-[#8b8fa3] font-mono">{step.detail}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {error && (
        <p className="text-red-400 text-sm">{error}</p>
      )}

      <div className="flex gap-3">
        <button
          onClick={onBack}
          disabled={done}
          className="flex-1 border border-[#2a2d3d] text-[#8b8fa3] hover:text-[#e8e9ed] hover:border-[#3a3d50] disabled:opacity-40 disabled:cursor-not-allowed font-medium py-3 px-6 rounded-lg transition-colors text-sm"
        >
          Back
        </button>
        <button
          onClick={onNext}
          disabled={!done}
          className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-[#2a2d3d] disabled:text-[#8b8fa3] text-white font-medium py-3 px-6 rounded-lg transition-colors text-sm"
        >
          {done
            ? `${state.employeeName || "Riley"} is ready — activate`
            : "Scanning..."}
        </button>
      </div>
    </div>
  );
}
