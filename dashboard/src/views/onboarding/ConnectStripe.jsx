import { useState } from "react";
import { connectStripe } from "../../lib/employee-api";

export default function ConnectStripe({ state, update, onNext }) {
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleConnect() {
    if (!apiKey.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await connectStripe(apiKey.trim());
      update({ stripeConnected: true });
      onNext();
    } catch (err) {
      setError(err.message || "Failed to connect Stripe. Check your API key and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-xl font-semibold text-[#e8e9ed] mb-2">Connect Stripe</h2>
        <p className="text-[#8b8fa3] text-sm leading-relaxed">
          Paste your Stripe secret key. We use it read-only to scan invoices and customers. You can revoke access any time.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <label className="text-xs font-medium text-[#8b8fa3] uppercase tracking-wide">
          Stripe Secret Key
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !loading && handleConnect()}
          placeholder="sk_live_..."
          className="font-mono bg-[#13131a] border border-[#2a2d3d] rounded-lg px-4 py-3 text-sm text-[#e8e9ed] placeholder-[#4a4d5e] focus:outline-none focus:border-blue-600 transition-colors"
        />
        {error && (
          <p className="text-red-400 text-sm">{error}</p>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <button
          onClick={handleConnect}
          disabled={!apiKey.trim() || loading}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-[#2a2d3d] disabled:text-[#8b8fa3] text-white font-medium py-3 px-6 rounded-lg transition-colors text-sm"
        >
          {loading ? "Connecting..." : "Connect Stripe"}
        </button>

        <p className="text-center text-xs text-[#8b8fa3]">
          Your key is encrypted at rest and never stored in plaintext.
        </p>
      </div>
    </div>
  );
}
