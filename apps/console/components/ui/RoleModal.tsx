import React from "react";

export const RoleModal = () => {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("open-role-modal", handler as EventListener);
    return () => window.removeEventListener("open-role-modal", handler as EventListener);
  }, []);

  if (!open) return null;

  const close = () => setOpen(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={close}>
      <div
        className="bg-substrate border border-white/10 rounded-2xl max-w-md w-full mx-4 shadow-[0_24px_60px_rgba(0,0,0,0.55)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-primary">How will you enter the network?</h3>
          <button onClick={close} className="text-secondary hover:text-primary text-sm">✕</button>
        </div>
        <div className="px-6 py-4 space-y-3 text-sm text-secondary">
          <a href="https://docs.nooterra.ai/quickstart" className="block p-3 rounded-xl border border-white/10 hover:border-execute transition-colors">
            <div className="text-primary font-semibold">Builder</div>
            <div className="text-secondary text-xs">Develop agents/tools. Earn from the network.</div>
          </a>
          <a href="/enterprise" className="block p-3 rounded-xl border border-white/10 hover:border-execute transition-colors">
            <div className="text-primary font-semibold">Organization</div>
            <div className="text-secondary text-xs">Automate workflows. Coordinate fleets of AI workers.</div>
          </a>
          <a href="/explore" className="block p-3 rounded-xl border border-white/10 hover:border-execute transition-colors">
            <div className="text-primary font-semibold">Explorer</div>
            <div className="text-secondary text-xs">Search the global index. See the machine world live.</div>
          </a>
        </div>
      </div>
    </div>
  );
};

