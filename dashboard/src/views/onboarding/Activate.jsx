import { useEffect, useState } from "react";
import { hireEmployee } from "../../lib/employee-api";

export default function Activate({ state, update }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function activate() {
    setLoading(true);
    setError(null);
    try {
      const result = await hireEmployee({
        roleId: "ar-collections",
        employeeName: state.employeeName || "Riley",
        boundaries: state.boundaries,
      });
      const employeeId = result?.employee?.id;
      update({ employeeId });
      window.history.pushState({}, "", `/employees/${employeeId}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (err) {
      setError(err.message || "Activation failed. Please try again.");
      setLoading(false);
    }
  }

  useEffect(() => {
    activate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="flex flex-col gap-8">
        <div>
          <h2 className="text-xl font-semibold text-[#e8e9ed] mb-2">Activation failed</h2>
          <p className="text-[#8b8fa3] text-sm leading-relaxed">{error}</p>
        </div>
        <button
          onClick={activate}
          className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium py-3 px-6 rounded-lg transition-colors text-sm"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 items-center text-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-blue-600 flex items-center justify-center">
          <svg className="w-6 h-6 text-white animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
          </svg>
        </div>
        <div>
          <h2 className="text-xl font-semibold text-[#e8e9ed]">
            Activating {state.employeeName || "Riley"}...
          </h2>
          <p className="text-[#8b8fa3] text-sm mt-1">
            Setting up guardrails and starting first scan...
          </p>
        </div>
      </div>
    </div>
  );
}
