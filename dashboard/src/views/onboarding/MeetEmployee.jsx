import { useState } from "react";

function centsToK(cents) {
  return `$${(cents / 100000).toFixed(0)}K`;
}

function kToCents(k) {
  return k * 1000 * 100;
}

export default function MeetEmployee({ state, update, onNext, onBack }) {
  const [name, setName] = useState(state.employeeName || "Riley");

  const boundaries = state.boundaries;

  function setBoundary(key, value) {
    update({ boundaries: { ...boundaries, [key]: value } });
  }

  function handleContinue() {
    update({ employeeName: name.trim() || "Riley" });
    onNext();
  }

  const maxAutoK = boundaries.maxAutonomousAmountCents / 100000;
  const highValueK = boundaries.highValueThresholdCents / 100000;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-xl font-semibold text-[#e8e9ed] mb-2">Meet your employee</h2>
        <p className="text-[#8b8fa3] text-sm leading-relaxed">
          Set a name and configure guardrails before activating. You can change these any time.
        </p>
      </div>

      {/* Role card */}
      <div className="border border-[#2a2d3d] rounded-xl p-5 flex items-start gap-4 bg-[#0f0f17]">
        <div className="w-12 h-12 rounded-full bg-blue-600 flex items-center justify-center text-white font-semibold text-lg flex-shrink-0">
          {(name.trim() || "R")[0].toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-transparent text-[#e8e9ed] font-medium text-base w-full focus:outline-none border-b border-transparent focus:border-[#2a2d3d] pb-0.5 transition-colors"
            placeholder="Riley"
            maxLength={40}
          />
          <p className="text-[#8b8fa3] text-sm mt-0.5">Collections Specialist</p>
          <p className="text-[#8b8fa3] text-xs mt-2 leading-relaxed">
            Monitors overdue invoices, sends evidence-backed follow-ups, escalates when uncertain.
          </p>
        </div>
      </div>

      {/* Guardrail controls */}
      <div className="flex flex-col gap-6">
        <h3 className="text-sm font-medium text-[#e8e9ed]">Guardrails</h3>

        <div className="flex flex-col gap-5">
          {/* Max autonomous action */}
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <label className="text-sm text-[#8b8fa3]">Max autonomous action</label>
              <span className="text-sm font-mono text-[#e8e9ed]">{centsToK(boundaries.maxAutonomousAmountCents)}</span>
            </div>
            <input
              type="range"
              min={1}
              max={50}
              step={1}
              value={maxAutoK}
              onChange={(e) => setBoundary("maxAutonomousAmountCents", kToCents(Number(e.target.value)))}
              className="w-full accent-blue-600"
            />
            <div className="flex justify-between text-xs text-[#4a4d5e]">
              <span>$1K</span>
              <span>$50K</span>
            </div>
          </div>

          {/* Require approval over */}
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <label className="text-sm text-[#8b8fa3]">Require approval for invoices over</label>
              <span className="text-sm font-mono text-[#e8e9ed]">{centsToK(boundaries.highValueThresholdCents)}</span>
            </div>
            <input
              type="range"
              min={1}
              max={50}
              step={1}
              value={highValueK}
              onChange={(e) => setBoundary("highValueThresholdCents", kToCents(Number(e.target.value)))}
              className="w-full accent-blue-600"
            />
            <div className="flex justify-between text-xs text-[#4a4d5e]">
              <span>$1K</span>
              <span>$50K</span>
            </div>
          </div>

          {/* Max contacts per day */}
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <label className="text-sm text-[#8b8fa3]">Max contacts per day</label>
              <span className="text-sm font-mono text-[#e8e9ed]">{boundaries.maxContactsPerDay}</span>
            </div>
            <input
              type="range"
              min={10}
              max={200}
              step={10}
              value={boundaries.maxContactsPerDay}
              onChange={(e) => setBoundary("maxContactsPerDay", Number(e.target.value))}
              className="w-full accent-blue-600"
            />
            <div className="flex justify-between text-xs text-[#4a4d5e]">
              <span>10</span>
              <span>200</span>
            </div>
          </div>

          {/* Business hours only */}
          <div className="flex items-center justify-between">
            <label className="text-sm text-[#8b8fa3]">Business hours only (9am–6pm)</label>
            <button
              type="button"
              onClick={() => setBoundary("businessHoursOnly", !boundaries.businessHoursOnly)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                boundaries.businessHoursOnly ? "bg-blue-600" : "bg-[#2a2d3d]"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  boundaries.businessHoursOnly ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="flex-1 border border-[#2a2d3d] text-[#8b8fa3] hover:text-[#e8e9ed] hover:border-[#3a3d50] font-medium py-3 px-6 rounded-lg transition-colors text-sm"
        >
          Back
        </button>
        <button
          onClick={handleContinue}
          className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-medium py-3 px-6 rounded-lg transition-colors text-sm"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
