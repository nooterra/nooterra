import React from "react";

type Project = {
  id: number;
  name: string;
  payerDid: string;
  createdAt: string;
};

type ApiKey = {
  id: number;
  projectId: number;
  label: string | null;
  createdAt: string;
  revokedAt: string | null;
};

export default function Account() {
  const coordUrl = import.meta.env.VITE_COORD_URL || "https://coord.nooterra.ai";
  const [token, setToken] = React.useState<string>(() => (typeof window !== "undefined" ? localStorage.getItem("authToken") || "" : ""));
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [mode, setMode] = React.useState<"login" | "signup">("login");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [me, setMe] = React.useState<{ id: number; email: string; projects: Project[] } | null>(null);
  const [apiKeys, setApiKeys] = React.useState<ApiKey[]>([]);
  const [selectedProjectId, setSelectedProjectId] = React.useState<number | null>(null);
  const [creatingKey, setCreatingKey] = React.useState(false);
  const [newKeyLabel, setNewKeyLabel] = React.useState("");
  const [newKeyPlain, setNewKeyPlain] = React.useState<string | null>(null);
  const [policy, setPolicy] = React.useState<any | null>(null);
  const [policyLoading, setPolicyLoading] = React.useState(false);
  const [policyError, setPolicyError] = React.useState<string | null>(null);
  const [policySaving, setPolicySaving] = React.useState(false);
  const [usage, setUsage] = React.useState<any | null>(null);
  const [usageLoading, setUsageLoading] = React.useState(false);
  const [usageError, setUsageError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const run = async () => {
      if (!token) {
        setMe(null);
        setApiKeys([]);
        return;
      }
      try {
        const headers = { Authorization: `Bearer ${token}` };
        const resMe = await fetch(`${coordUrl}/auth/me`, { headers });
        if (!resMe.ok) {
          console.error("auth/me failed", await resMe.text());
          setMe(null);
          setApiKeys([]);
          return;
        }
        const meJson = await resMe.json();
        setMe(meJson);
        if (!selectedProjectId && meJson.projects && meJson.projects.length) {
          setSelectedProjectId(meJson.projects[0].id);
        }

        const resKeys = await fetch(`${coordUrl}/v1/api-keys`, { headers });
        if (resKeys.ok) {
          const keysJson = await resKeys.json();
          setApiKeys(keysJson.apiKeys || []);
        } else {
          setApiKeys([]);
        }
      } catch (err) {
        console.error(err);
      }
    };
    run();
  }, [token, coordUrl, selectedProjectId]);

  React.useEffect(() => {
    const loadPolicy = async () => {
      if (!token || !selectedProjectId) {
        setPolicy(null);
        setPolicyError(null);
        return;
      }
      setPolicyLoading(true);
      setPolicyError(null);
      try {
        const headers = { Authorization: `Bearer ${token}` };
        const res = await fetch(`${coordUrl}/v1/projects/${selectedProjectId}/policy`, { headers });
        if (!res.ok) {
          const txt = await res.text();
          console.error("policy load failed", txt);
          setPolicy(null);
          return;
        }
        const json = await res.json();
        setPolicy(json.rules || {});
      } catch (err) {
        console.error(err);
        setPolicyError("Failed to load policy");
        setPolicy(null);
      } finally {
        setPolicyLoading(false);
      }
    };
    loadPolicy();
  }, [token, coordUrl, selectedProjectId]);

  React.useEffect(() => {
    const loadUsage = async () => {
      if (!token || !selectedProjectId) {
        setUsage(null);
        setUsageError(null);
        return;
      }
      setUsageLoading(true);
      setUsageError(null);
      try {
        const headers = { Authorization: `Bearer ${token}` };
        const res = await fetch(`${coordUrl}/v1/projects/${selectedProjectId}/usage?windowDays=30`, {
          headers,
        });
        if (!res.ok) {
          const txt = await res.text();
          console.error("usage load failed", txt);
          setUsage(null);
          return;
        }
        const json = await res.json();
        setUsage(json);
      } catch (err) {
        console.error(err);
        setUsageError("Failed to load usage");
        setUsage(null);
      } finally {
        setUsageLoading(false);
      }
    };
    loadUsage();
  }, [token, coordUrl, selectedProjectId]);

  const handleAuth = async () => {
    setLoading(true);
    setError(null);
    setNewKeyPlain(null);
    try {
      const res = await fetch(`${coordUrl}/auth/${mode === "login" ? "login" : "signup"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || "Authentication failed");
        return;
      }
      if (mode === "signup") {
        // Switch to login after successful signup
        setMode("login");
        setError("Signup succeeded. Please log in.");
        return;
      }
      if (!json.token) {
        setError("No token returned");
        return;
      }
      if (typeof window !== "undefined") {
        localStorage.setItem("authToken", json.token);
      }
      setToken(json.token);
      setEmail("");
      setPassword("");
      setError(null);
    } catch (err: any) {
      console.error(err);
      setError("Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("authToken");
    }
    setToken("");
    setMe(null);
    setApiKeys([]);
    setSelectedProjectId(null);
    setNewKeyPlain(null);
  };

  const handleCreateKey = async () => {
    if (!token || !selectedProjectId) return;
    setCreatingKey(true);
    setError(null);
    setNewKeyPlain(null);
    try {
      const res = await fetch(`${coordUrl}/v1/api-keys`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ projectId: selectedProjectId, label: newKeyLabel || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || "Failed to create API key");
        return;
      }
      if (json.key) {
        setNewKeyPlain(json.key);
        if (typeof window !== "undefined") {
          localStorage.setItem("apiKey", json.key);
        }
      }
      // refresh keys
      const resKeys = await fetch(`${coordUrl}/v1/api-keys`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resKeys.ok) {
        const keysJson = await resKeys.json();
        setApiKeys(keysJson.apiKeys || []);
      }
      setNewKeyLabel("");
    } catch (err) {
      console.error(err);
      setError("Failed to create API key");
    } finally {
      setCreatingKey(false);
    }
  };

  const handleSetConsoleKey = (key: string) => {
    if (typeof window !== "undefined") {
      localStorage.setItem("apiKey", key);
    }
  };

  const handlePolicyChange = (field: string, value: any) => {
    setPolicy((prev: any) => ({ ...(prev || {}), [field]: value }));
  };

  const handlePolicySave = async () => {
    if (!token || !selectedProjectId) return;
    setPolicySaving(true);
    setPolicyError(null);
    try {
      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      };
      const res = await fetch(`${coordUrl}/v1/projects/${selectedProjectId}/policy`, {
        method: "PUT",
        headers,
        body: JSON.stringify(policy || {}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPolicyError(json.error || "Failed to save policy");
        return;
      }
      setPolicy(json.rules || {});
    } catch (err) {
      console.error(err);
      setPolicyError("Failed to save policy");
    } finally {
      setPolicySaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Account & API Keys</h2>

      {!token && (
        <div className="bg-substrate border border-white/10 rounded-xl p-4 space-y-4">
          <div className="flex gap-4 text-sm">
            <button
              className={`px-3 py-1 rounded ${mode === "login" ? "bg-execute text-void" : "bg-void border border-white/20 text-secondary"}`}
              onClick={() => setMode("login")}
            >
              Log In
            </button>
            <button
              className={`px-3 py-1 rounded ${mode === "signup" ? "bg-execute text-void" : "bg-void border border-white/20 text-secondary"}`}
              onClick={() => setMode("signup")}
            >
              Sign Up
            </button>
          </div>
          <div className="space-y-3 text-sm">
            <input
              type="email"
              className="w-full bg-void border border-white/10 rounded px-3 py-2"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              type="password"
              className="w-full bg-void border border-white/10 rounded px-3 py-2"
              placeholder="Password (min 8 chars)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {error && <div className="text-red-400 text-xs">{error}</div>}
            <button
              className="bg-execute text-void px-4 py-2 rounded text-sm"
              onClick={handleAuth}
              disabled={loading}
            >
              {loading ? "Please wait..." : mode === "login" ? "Log In" : "Sign Up"}
            </button>
          </div>
        </div>
      )}

      {token && me && (
        <>
          <div className="bg-substrate border border-white/10 rounded-xl p-4 text-sm flex items-center justify-between">
            <div>
              <div className="font-mono text-xs text-secondary">Signed in as</div>
              <div className="text-primary">{me.email}</div>
            </div>
            <button className="text-xs text-secondary hover:text-primary underline" onClick={handleLogout}>
              Log out
            </button>
          </div>

          <div className="bg-substrate border border-white/10 rounded-xl p-4 text-sm space-y-3">
            <div className="text-xs uppercase tracking-[0.2em] text-secondary mb-1">Projects</div>
            {me.projects.length === 0 && <div className="text-secondary text-sm">No projects yet.</div>}
            {me.projects.length > 0 && (
              <div className="space-y-2">
                {me.projects.map((p) => {
                  const active = p.id === selectedProjectId;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setSelectedProjectId(p.id)}
                      className={`w-full text-left px-3 py-2 rounded border text-xs ${
                        active ? "border-execute bg-execute/10 text-primary" : "border-white/10 text-secondary hover:border-execute/60"
                      }`}
                    >
                      <div className="font-mono text-[10px] tracking-[0.18em] uppercase">{p.name}</div>
                      <div className="mt-1 truncate text-[11px]">Payer DID: {p.payerDid}</div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="bg-substrate border border-white/10 rounded-xl p-4 text-sm space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-secondary mb-1">API Keys</div>
                <div className="text-[11px] text-secondary">
                  Use these keys as <code className="font-mono">x-api-key</code> from your agents or apps.
                </div>
              </div>
              <button
                onClick={handleCreateKey}
                disabled={creatingKey || !selectedProjectId}
                className="text-xs bg-execute text-void px-3 py-2 rounded disabled:opacity-40"
              >
                {creatingKey ? "Creating..." : "Create Key"}
              </button>
            </div>

            <div className="space-y-2">
              {apiKeys.length === 0 && <div className="text-secondary text-sm">No API keys yet.</div>}
              {apiKeys.map((k) => (
                <div key={k.id} className="border border-white/10 rounded px-3 py-2 flex items-center justify-between gap-3">
                  <div className="text-xs text-secondary">
                    <div className="font-mono text-[10px] uppercase">Key #{k.id}</div>
                    <div className="text-[11px]">Project ID: {k.projectId}</div>
                    <div className="text-[11px]">Label: {k.label || "—"}</div>
                    <div className="text-[11px]">Created: {k.createdAt}</div>
                    {k.revokedAt && <div className="text-[11px] text-red-400">Revoked: {k.revokedAt}</div>}
                  </div>
                </div>
              ))}
            </div>

            {newKeyPlain && (
              <div className="mt-4 bg-void border border-execute/60 rounded px-3 py-3 text-xs">
                <div className="text-secondary mb-1">
                  New API Key (shown once). Store this somewhere safe. It will not be shown again.
                </div>
                <div className="font-mono break-all text-primary mb-2">{newKeyPlain}</div>
                <div className="flex gap-3">
                  <button
                    className="text-[11px] underline text-secondary hover:text-primary"
                    onClick={() => handleSetConsoleKey(newKeyPlain)}
                  >
                    Set as Console API Key
                  </button>
                  {navigator.clipboard && (
                    <button
                      className="text-[11px] underline text-secondary hover:text-primary"
                      onClick={() => navigator.clipboard.writeText(newKeyPlain)}
                    >
                      Copy to clipboard
                    </button>
                  )}
                </div>
              </div>
            )}

            {error && <div className="text-red-400 text-xs mt-2">{error}</div>}
          </div>

          {selectedProjectId && (
            <div className="bg-substrate border border-white/10 rounded-xl p-4 text-sm space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-[0.2em] text-secondary mb-1">
                    Usage &amp; Credits (last 30 days)
                  </div>
                  <div className="text-[11px] text-secondary">
                    Shows how much this project has spent and on which capabilities.
                  </div>
                </div>
                {usageLoading && (
                  <div className="text-[11px] text-secondary">Loading…</div>
                )}
              </div>
              {usageError && <div className="text-red-400 text-xs mb-1">{usageError}</div>}
              {usage && (
                <>
                  <div className="flex flex-wrap gap-4 text-xs">
                    <div>
                      <div className="text-secondary">Payer DID</div>
                      <div className="font-mono text-[11px] break-all">{usage.payerDid}</div>
                    </div>
                    <div>
                      <div className="text-secondary">Balance</div>
                      <div className="text-primary">
                        {usage.balance} {usage.currency || "NCR"}
                      </div>
                    </div>
                    <div>
                      <div className="text-secondary">Total debits (window)</div>
                      <div className="text-primary">
                        {usage.totalDebits} {usage.currency || "NCR"}
                      </div>
                    </div>
                    <div>
                      <div className="text-secondary">Window</div>
                      <div className="text-primary">{usage.windowDays} days</div>
                    </div>
                  </div>
                  {(usage.maxWorkflowsPerDay || usage.maxConcurrentWorkflows || usage.maxSpendPerWorkflowCents) && (
                    <div className="mt-3 flex flex-wrap gap-4 text-[11px]">
                      <div>
                        <div className="text-secondary">Workflows (last 24h)</div>
                        <div className="text-primary">
                          {usage.workflowsLast24h ?? 0}
                          {usage.maxWorkflowsPerDay
                            ? ` / ${usage.maxWorkflowsPerDay}`
                            : " (unlimited)"}
                        </div>
                      </div>
                      <div>
                        <div className="text-secondary">Concurrent workflows</div>
                        <div className="text-primary">
                          {usage.concurrentWorkflows ?? 0}
                          {usage.maxConcurrentWorkflows
                            ? ` / ${usage.maxConcurrentWorkflows}`
                            : " (unlimited)"}
                        </div>
                      </div>
                      <div>
                        <div className="text-secondary">Max spend per workflow</div>
                        <div className="text-primary">
                          {usage.maxSpendPerWorkflowCents
                            ? `${usage.maxSpendPerWorkflowCents} ¢`
                            : "Unlimited"}
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="mt-3 border border-white/10 rounded">
                    <table className="w-full text-xs">
                      <thead className="text-secondary border-b border-white/10">
                        <tr>
                          <th className="text-left px-3 py-2">Capability</th>
                          <th className="text-left px-3 py-2">Spend</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(usage.byCapability || []).map((c: any) => (
                          <tr key={c.capabilityId} className="border-b border-white/5">
                            <td className="px-3 py-2 text-secondary font-mono">{c.capabilityId}</td>
                            <td className="px-3 py-2 text-primary">
                              {c.spend} {usage.currency || "NCR"}
                            </td>
                          </tr>
                        ))}
                        {(!usage.byCapability || usage.byCapability.length === 0) && (
                          <tr>
                            <td className="px-3 py-2 text-secondary" colSpan={2}>
                              No debits for this window.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {selectedProjectId && (
            <div className="bg-substrate border border-white/10 rounded-xl p-4 text-sm space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-[0.2em] text-secondary mb-1">Policy</div>
                  <div className="text-[11px] text-secondary">
                    Constrain which agents and capabilities this project can use.
                  </div>
                </div>
                <button
                  onClick={handlePolicySave}
                  disabled={policySaving || policyLoading}
                  className="text-xs bg-execute text-void px-3 py-2 rounded disabled:opacity-40"
                >
                  {policySaving ? "Saving..." : "Save Policy"}
                </button>
              </div>
              {policyLoading && (
                <div className="text-[11px] text-secondary">Loading policy…</div>
              )}
              {!policyLoading && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                  <div className="space-y-2">
                    <label className="block text-[11px] text-secondary">
                      Minimum Reputation
                      <input
                        className="mt-1 w-full bg-void border border-white/10 rounded px-3 py-2 text-sm"
                        type="number"
                        step="0.01"
                        min={0}
                        max={1}
                        value={policy?.minReputation ?? ""}
                        onChange={(e) =>
                          handlePolicyChange(
                            "minReputation",
                            e.target.value === "" ? undefined : Number(e.target.value)
                          )
                        }
                        placeholder="0.6"
                      />
                    </label>
                    <label className="inline-flex items-center gap-2 text-[11px] text-secondary mt-2">
                      <input
                        type="checkbox"
                        className="w-3 h-3"
                        checked={policy?.allowUnsigned ?? false}
                        onChange={(e) => handlePolicyChange("allowUnsigned", e.target.checked)}
                      />
                      <span>Allow unsigned agents (no public key)</span>
                    </label>
                    <label className="inline-flex items-center gap-2 text-[11px] text-secondary mt-2">
                      <input
                        type="checkbox"
                        className="w-3 h-3"
                        checked={policy?.autoVerifySummaries ?? true}
                        onChange={(e) => handlePolicyChange("autoVerifySummaries", e.target.checked)}
                      />
                      <span>Auto-verify summarization nodes</span>
                    </label>
                    <label className="inline-flex items-center gap-2 text-[11px] text-secondary mt-2">
                      <input
                        type="checkbox"
                        className="w-3 h-3"
                        checked={policy?.autoVerifyTranslations ?? true}
                        onChange={(e) => handlePolicyChange("autoVerifyTranslations", e.target.checked)}
                      />
                      <span>Auto-verify translation nodes</span>
                    </label>
                    <label className="inline-flex items-center gap-2 text-[11px] text-secondary mt-2">
                      <input
                        type="checkbox"
                        className="w-3 h-3"
                        checked={policy?.autoVerifyCode ?? true}
                        onChange={(e) => handlePolicyChange("autoVerifyCode", e.target.checked)}
                      />
                      <span>Auto-verify code-related nodes</span>
                    </label>
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[11px] text-secondary">
                      Allowed Capabilities (patterns, one per line, e.g. <code>cap.weather.*</code>)
                      <textarea
                        className="mt-1 w-full bg-void border border-white/10 rounded px-3 py-2 text-xs"
                        rows={3}
                        value={(policy?.allowedCapabilities || []).join("\n")}
                        onChange={(e) =>
                          handlePolicyChange(
                            "allowedCapabilities",
                            e.target.value
                              .split("\n")
                              .map((s) => s.trim())
                              .filter((s) => s.length > 0)
                          )
                        }
                      />
                    </label>
                    <label className="block text-[11px] text-secondary">
                      Blocked Capabilities (patterns, one per line)
                      <textarea
                        className="mt-1 w-full bg-void border border-white/10 rounded px-3 py-2 text-xs"
                        rows={3}
                        value={(policy?.blockedCapabilities || []).join("\n")}
                        onChange={(e) =>
                          handlePolicyChange(
                            "blockedCapabilities",
                            e.target.value
                              .split("\n")
                              .map((s) => s.trim())
                              .filter((s) => s.length > 0)
                          )
                        }
                      />
                    </label>
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[11px] text-secondary">
                      Allowed Agent DIDs (one per line)
                      <textarea
                        className="mt-1 w-full bg-void border border-white/10 rounded px-3 py-2 text-xs"
                        rows={3}
                        value={(policy?.allowedAgentDids || []).join("\n")}
                        onChange={(e) =>
                          handlePolicyChange(
                            "allowedAgentDids",
                            e.target.value
                              .split("\n")
                              .map((s) => s.trim())
                              .filter((s) => s.length > 0)
                          )
                        }
                      />
                    </label>
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[11px] text-secondary">
                      Blocked Agent DIDs (one per line)
                      <textarea
                        className="mt-1 w-full bg-void border border-white/10 rounded px-3 py-2 text-xs"
                        rows={3}
                        value={(policy?.blockedAgentDids || []).join("\n")}
                        onChange={(e) =>
                          handlePolicyChange(
                            "blockedAgentDids",
                            e.target.value
                              .split("\n")
                              .map((s) => s.trim())
                              .filter((s) => s.length > 0)
                          )
                        }
                      />
                    </label>
                  </div>
                </div>
              )}
              {policyError && <div className="text-red-400 text-xs mt-2">{policyError}</div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
