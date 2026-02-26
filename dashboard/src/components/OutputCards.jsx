import { useState } from "react";

import JSONViewer from "./JSONViewer.jsx";

export default function OutputCards({ outputs }) {
  const [selected, setSelected] = useState(null);

  const cards = [
    { id: "work", title: "Work Certificate", status: "success", data: outputs.workCertificate },
    { id: "settlement", title: "Settlement Statement", status: "success", data: outputs.settlementStatement },
    { id: "credit", title: "Credit Memo", status: outputs.creditMemo ? "warning" : "success", data: outputs.creditMemo }
  ];

  const creditCents = outputs.creditMemo?.credit?.amountCents ?? outputs.creditMemo?.amountCents ?? null;
  const creditUsd = Number.isSafeInteger(creditCents) ? (creditCents / 100).toFixed(2) : null;

  return (
    <div className="bg-nooterra-card border border-nooterra-border rounded-xl p-6">
      <div className="flex items-center gap-3 mb-6">
        <span className="text-2xl">Outputs</span>
        <h2 className="text-xl font-semibold">Finance-grade Artifacts</h2>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        {cards.map((card) => (
          <button
            key={card.id}
            onClick={() => setSelected(selected === card.id ? null : card.id)}
            className={`p-4 rounded-lg border-2 transition-all hover:scale-105 ${
              selected === card.id ? "border-nooterra-accent bg-nooterra-accent/10" : "border-nooterra-border hover:border-nooterra-accent/50"
            }`}
          >
            <p className="font-medium text-sm">{card.title}</p>
            <p className={`text-xs mt-1 ${card.status === "warning" ? "text-nooterra-warning" : "text-nooterra-success"}`}>
              {card.status === "warning" ? "Credit issued" : "Ready"}
            </p>
          </button>
        ))}
      </div>

      {creditUsd && (
        <div className="p-4 bg-nooterra-warning/10 border border-nooterra-warning/30 rounded-lg mb-6">
          <p className="text-nooterra-warning font-semibold text-lg">Credit issued: ${creditUsd}</p>
          <p className="text-gray-400 text-sm mt-1">Reason: SLA breach</p>
        </div>
      )}

      {selected && <JSONViewer title={cards.find((c) => c.id === selected)?.title} data={cards.find((c) => c.id === selected)?.data} />}
    </div>
  );
}
