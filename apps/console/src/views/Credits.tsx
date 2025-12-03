import React from "react";
import { RefreshCw, Wallet, ArrowUpRight, ArrowDownLeft, Clock } from "lucide-react";

interface LedgerAccount {
  id: number;
  owner_did: string;
  balance: number;
  currency: string;
  created_at: string;
}

interface LedgerEvent {
  delta: number;
  reason?: string;
  workflow_id?: string;
  node_name?: string;
  created_at: string;
}

export default function Credits() {
  const [accounts, setAccounts] = React.useState<LedgerAccount[]>([]);
  const [selectedDid, setSelectedDid] = React.useState<string | null>(null);
  const [selectedAccount, setSelectedAccount] = React.useState<LedgerAccount | null>(null);
  const [events, setEvents] = React.useState<LedgerEvent[]>([]);
  const [loading, setLoading] = React.useState(true);

  const apiKey = typeof window !== "undefined" ? localStorage.getItem("apiKey") || "" : "";
  const coordUrl = (import.meta as any).env?.VITE_COORD_URL || "https://coord.nooterra.ai";

  const fetchAccounts = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${coordUrl}/v1/ledger/accounts?limit=100`, {
        headers: apiKey ? { "x-api-key": apiKey } : {},
      });
      if (res.ok) {
        const json = await res.json();
        const list = json.accounts || [];
        setAccounts(list);
        if (!selectedDid && list.length) {
          setSelectedDid(list[0].owner_did);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [apiKey, coordUrl, selectedDid]);

  React.useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  React.useEffect(() => {
    const fetchAccountDetails = async () => {
      if (!selectedDid) return;
      try {
        const res = await fetch(`${coordUrl}/v1/ledger/accounts/${encodeURIComponent(selectedDid)}`, {
          headers: apiKey ? { "x-api-key": apiKey } : {},
        });
        if (res.ok) {
          const json = await res.json();
          setSelectedAccount(json.account || null);
          setEvents(json.events || []);
        }
      } catch (err) {
        console.error(err);
      }
    };
    fetchAccountDetails();
  }, [apiKey, coordUrl, selectedDid]);

  // Calculate totals
  const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0);
  const totalAccounts = accounts.length;

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid md:grid-cols-3 gap-4">
        <div className="card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-[#00f0ff]/10 flex items-center justify-center">
              <Wallet className="w-5 h-5 text-[#00f0ff]" />
            </div>
          </div>
          <div className="text-2xl font-bold text-primary">{totalBalance.toLocaleString()}</div>
          <div className="text-xs text-tertiary uppercase tracking-wider mt-1">Total Credits (NCR)</div>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-[#b4ff39]/10 flex items-center justify-center">
              <ArrowUpRight className="w-5 h-5 text-[#b4ff39]" />
            </div>
          </div>
          <div className="text-2xl font-bold text-primary">{totalAccounts}</div>
          <div className="text-xs text-tertiary uppercase tracking-wider mt-1">Active Accounts</div>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-[#ff2d92]/10 flex items-center justify-center">
              <Clock className="w-5 h-5 text-[#ff2d92]" />
            </div>
          </div>
          <div className="text-2xl font-bold text-primary">{events.length}</div>
          <div className="text-xs text-tertiary uppercase tracking-wider mt-1">Recent Transactions</div>
        </div>
      </div>

      {/* Accounts list */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-primary">Ledger Accounts</h2>
          <button
            onClick={fetchAccounts}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm text-secondary hover:text-primary bg-white/5 hover:bg-white/10 rounded-lg transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {accounts.length === 0 && !loading && (
          <div className="text-center py-12 card">
            <Wallet className="w-8 h-8 text-tertiary mx-auto mb-3" />
            <p className="text-secondary">No accounts found</p>
          </div>
        )}

        {accounts.length > 0 && (
          <div className="grid lg:grid-cols-2 gap-6">
            {/* Account list */}
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-white/5 text-xs text-tertiary uppercase tracking-wider">
                Select Account
              </div>
              <div className="divide-y divide-white/5 max-h-[400px] overflow-y-auto">
                {accounts.map((account) => {
                  const isActive = account.owner_did === selectedDid;
                  return (
                    <button
                      key={account.id}
                      onClick={() => setSelectedDid(account.owner_did)}
                      className={`w-full text-left px-4 py-3 transition-colors ${
                        isActive ? "bg-[#00f0ff]/5" : "hover:bg-white/[0.02]"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs text-primary truncate max-w-[200px]">
                          {account.owner_did}
                        </span>
                        <span className={`text-sm font-medium ${
                          account.balance > 0 ? "text-[#b4ff39]" : "text-secondary"
                        }`}>
                          {account.balance.toLocaleString()} {account.currency || "NCR"}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Account details */}
            {selectedAccount && (
              <div className="card overflow-hidden">
                <div className="px-4 py-3 border-b border-white/5">
                  <div className="text-xs text-tertiary uppercase tracking-wider mb-1">Account</div>
                  <div className="font-mono text-sm text-primary truncate">
                    {selectedAccount.owner_did}
                  </div>
                  <div className="text-lg font-bold text-primary mt-2">
                    {selectedAccount.balance.toLocaleString()} {selectedAccount.currency || "NCR"}
                  </div>
                </div>

                <div className="px-4 py-3 border-b border-white/5 text-xs text-tertiary uppercase tracking-wider">
                  Recent Events
                </div>

                {events.length === 0 ? (
                  <div className="p-4 text-center text-secondary text-sm">
                    No transactions yet
                  </div>
                ) : (
                  <div className="divide-y divide-white/5 max-h-[300px] overflow-y-auto">
                    {events.map((event, i) => (
                      <div key={i} className="px-4 py-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className={`font-medium ${
                            event.delta > 0 ? "text-[#b4ff39]" : "text-[#ff4757]"
                          }`}>
                            {event.delta > 0 ? "+" : ""}{event.delta}
                          </span>
                          <span className="text-xs text-tertiary">
                            {new Date(event.created_at).toLocaleString()}
                          </span>
                        </div>
                        <div className="text-xs text-secondary">
                          {event.reason || "Settlement"}
                        </div>
                        {event.workflow_id && (
                          <div className="text-xs text-tertiary mt-1 font-mono">
                            {event.workflow_id.slice(0, 8)}... / {event.node_name || "—"}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
