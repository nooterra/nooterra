function badgeClass(status) {
  switch (status) {
    case "ok":
      return "border-nooterra-success/40 bg-nooterra-success/10 text-nooterra-success";
    case "warn":
      return "border-nooterra-warning/40 bg-nooterra-warning/10 text-nooterra-warning";
    case "fail":
      return "border-nooterra-error/40 bg-nooterra-error/10 text-nooterra-error";
    default:
      return "border-nooterra-border bg-black/20 text-gray-300";
  }
}

function icon(status) {
  switch (status) {
    case "ok":
      return "✓";
    case "warn":
      return "!";
    case "fail":
      return "×";
    default:
      return "·";
  }
}

export default function TruthStrip({ truth, onPick }) {
  const items = [
    { key: "chain", label: "Chain integrity", status: truth.chain?.status ?? "na", detail: truth.chain?.detail ?? "" },
    { key: "proof", label: "Proof status", status: truth.proof?.status ?? "na", detail: truth.proof?.detail ?? "" },
    { key: "ledger", label: "Ledger balanced", status: truth.ledger?.status ?? "na", detail: truth.ledger?.detail ?? "" },
    { key: "exports", label: "Exports ACKed", status: truth.exports?.status ?? "na", detail: truth.exports?.detail ?? "" },
    { key: "month", label: "Month close", status: truth.month?.status ?? "na", detail: truth.month?.detail ?? "" }
  ];

  return (
    <div className="bg-nooterra-card border border-nooterra-border rounded-xl p-4">
      <div className="flex flex-wrap gap-2">
        {items.map((it) => (
          <button
            key={it.key}
            onClick={() => onPick?.(it.key)}
            className={`px-3 py-2 rounded-lg border text-sm transition-colors hover:bg-white/5 ${badgeClass(it.status)}`}
            title={it.detail || it.label}
          >
            <span className="font-mono mr-2">{icon(it.status)}</span>
            <span className="font-medium">{it.label}</span>
            {it.detail ? <span className="ml-2 text-xs text-gray-400">{it.detail}</span> : null}
          </button>
        ))}
      </div>
      <div className="mt-2 text-xs text-gray-500">
        This is the clearinghouse bar: each badge is backed by a verifiable artifact, hash, or reconciliation output.
      </div>
    </div>
  );
}

