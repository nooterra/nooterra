import { useState } from "react";
import ConnectStripe from "./ConnectStripe";
import MeetEmployee from "./MeetEmployee";
import BuildContext from "./BuildContext";
import Activate from "./Activate";

const DEFAULT_BOUNDARIES = {
  maxAutonomousAmountCents: 500000,   // $5,000
  maxContactsPerDay: 100,
  highValueThresholdCents: 500000,    // $5,000
  businessHoursOnly: true,
};

const STEPS = [
  { id: "connect-stripe", label: "Connect" },
  { id: "meet-employee", label: "Configure" },
  { id: "build-context", label: "Scan" },
  { id: "activate", label: "Activate" },
];

export default function SetupFlow() {
  const [step, setStep] = useState(0);
  const [flowState, setFlowState] = useState({
    stripeConnected: false,
    employeeName: "Riley",
    boundaries: { ...DEFAULT_BOUNDARIES },
    objectCounts: null,
    employeeId: null,
  });

  function update(partial) {
    setFlowState((prev) => ({ ...prev, ...partial }));
  }

  function onNext() {
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function onBack() {
    setStep((s) => Math.max(s - 1, 0));
  }

  const stepProps = { state: flowState, update, onNext, onBack };

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="mb-8 text-center">
          <p className="text-xs font-medium text-[#8b8fa3] uppercase tracking-widest mb-6">Nooterra</p>

          {/* Progress dots */}
          <div className="flex items-center justify-center gap-2">
            {STEPS.map((s, i) => (
              <div key={s.id} className="flex items-center gap-2">
                <div
                  className={`w-2 h-2 rounded-full transition-colors ${
                    i < step
                      ? "bg-blue-500"
                      : i === step
                      ? "bg-blue-600"
                      : "bg-[#2a2d3d]"
                  }`}
                />
                {i < STEPS.length - 1 && (
                  <div className={`w-8 h-px ${i < step ? "bg-blue-500" : "bg-[#2a2d3d]"}`} />
                )}
              </div>
            ))}
          </div>

          <p className="text-xs text-[#8b8fa3] mt-3">
            Step {step + 1} of {STEPS.length} — {STEPS[step].label}
          </p>
        </div>

        {/* Step card */}
        <div className="border border-[#2a2d3d] rounded-2xl p-8 bg-[#0d0d14]">
          {step === 0 && <ConnectStripe {...stepProps} />}
          {step === 1 && <MeetEmployee {...stepProps} />}
          {step === 2 && <BuildContext {...stepProps} />}
          {step === 3 && <Activate {...stepProps} />}
        </div>
      </div>
    </div>
  );
}
