import React from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import Navbar from "../../components/ui/Navbar";
import { Key, AlertCircle } from "lucide-react";

export default function ConsoleLayout() {
  const location = useLocation();
  
  const tabs = [
    { label: "Agents", to: "/console/agents" },
    { label: "Tasks", to: "/console/tasks" },
    { label: "Workflows", to: "/console/workflows" },
    { label: "Network", to: "/console/network" },
    { label: "Health", to: "/console/health" },
    { label: "Credits", to: "/console/credits" },
    { label: "Account", to: "/console/account" },
  ];

  return (
    <div className="min-h-screen bg-abyss text-primary">
      <Navbar />
      
      <div className="max-w-7xl mx-auto px-6 pt-24 pb-16">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-primary">Noosphere Console</h1>
            <p className="text-sm text-secondary mt-1">
              Monitor agents, workflows, and network activity
            </p>
          </div>
          <ApiKeyModal />
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 p-1 bg-substrate rounded-xl mb-8 w-fit border border-neural-blue/10">
          {tabs.map((tab) => {
            const isActive = location.pathname === tab.to || 
              (tab.to !== "/console" && location.pathname.startsWith(tab.to));
            return (
              <Link
                key={tab.to}
                to={tab.to}
                className={`px-5 py-2.5 text-sm font-medium rounded-lg transition-all duration-300 ${
                  isActive
                    ? "bg-neural-blue/20 text-neural-cyan shadow-glow-blue/20"
                    : "text-secondary hover:text-primary hover:bg-white/5"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>

        {/* Content */}
        <Outlet />
      </div>
    </div>
  );
}

function ApiKeyModal() {
  const [key, setKey] = React.useState(() => 
    typeof window !== "undefined" ? localStorage.getItem("apiKey") || "" : ""
  );
  const [open, setOpen] = React.useState(false);

  const save = () => {
    if (typeof window !== "undefined") {
      localStorage.setItem("apiKey", key.trim());
    }
    setOpen(false);
  };

  const hasKey = key.length > 0;

  return (
    <div className="relative">
      <button
        className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-300 ${
          hasKey
            ? "bg-neural-green/10 text-neural-green border border-neural-green/20 shadow-glow-green/10"
            : "bg-substrate text-secondary border border-neural-blue/20 hover:border-neural-blue/40"
        }`}
        onClick={() => setOpen(true)}
      >
        <Key className="w-4 h-4" />
        {hasKey ? "Key Connected" : "Connect Key"}
      </button>

      {open && (
        <div 
          className="fixed inset-0 z-50 bg-abyss/90 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <div 
            className="glass-panel rounded-2xl p-6 w-full max-w-md border border-neural-blue/20"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-4 mb-6">
              <div 
                className="w-12 h-12 rounded-xl flex items-center justify-center"
                style={{ 
                  background: 'linear-gradient(135deg, rgba(79,124,255,0.15), transparent)',
                  border: '1px solid rgba(79,124,255,0.25)',
                }}
              >
                <Key className="w-6 h-6 text-neural-blue" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-primary">API Key</h3>
                <p className="text-sm text-secondary mt-1">
                  Connect to protected noosphere endpoints
                </p>
              </div>
            </div>

            <input
              className="w-full bg-abyss border border-neural-blue/20 rounded-lg px-4 py-3 text-sm text-primary placeholder:text-tertiary focus:outline-none focus:border-neural-cyan/50 transition-colors"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Enter your API key..."
              type="password"
            />

            <div className="flex items-center gap-3 mt-6">
              <button
                onClick={() => setOpen(false)}
                className="flex-1 px-4 py-2.5 text-sm text-secondary hover:text-primary transition-colors rounded-lg border border-white/10 hover:border-white/20"
              >
                Cancel
              </button>
              <button onClick={save} className="flex-1 btn-neural py-2.5">
                Connect
              </button>
            </div>

            {!hasKey && (
              <div className="mt-5 flex items-start gap-3 p-4 rounded-xl bg-neural-purple/10 border border-neural-purple/20">
                <AlertCircle className="w-5 h-5 text-neural-purple flex-shrink-0" />
                <p className="text-xs text-neural-purple/90">
                  Create an account in the Account tab to generate an API key
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
