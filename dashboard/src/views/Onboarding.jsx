/**
 * World Runtime Onboarding — connect Stripe, materialize company state, launch governed operation.
 *
 * Step 1: Connect Stripe (OAuth) — see invoices + customers flow in
 * Step 2: Wait for the event ledger and object graph to materialize
 * Step 3: Review your company state — verify projections
 * Step 4: Launch collections in shadow mode
 *
 * This is the "first 30 minutes" experience from the Production Bible.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  CreditCard, Check, ChevronRight, Loader2,
  Users, FileText, MessageSquare, Activity, Shield,
  Zap, Eye, AlertTriangle, ArrowRight, RefreshCw,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

const API_BASE = import.meta.env.VITE_API_URL || '';

async function apiGet(path, tenantId) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'x-tenant-id': tenantId, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

async function apiPost(path, tenantId, body = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'x-tenant-id': tenantId, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: `API error: ${res.status}` }));
    throw new Error(error.error || `API error: ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

function StepIndicator({ steps, current }) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {steps.map((step, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium
            ${i < current ? 'bg-status-healthy text-white' :
              i === current ? 'bg-accent text-white' :
              'bg-surface-3 text-text-tertiary'}`}>
            {i < current ? <Check size={12} /> : i + 1}
          </div>
          <span className={`text-xs hidden md:inline ${i === current ? 'text-text-primary' : 'text-text-tertiary'}`}>
            {step}
          </span>
          {i < steps.length - 1 && (
            <div className={`w-8 h-px ${i < current ? 'bg-status-healthy' : 'bg-edge'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

function ConnectButton({ name, icon: Icon, connected, connecting, onConnect, description }) {
  return (
    <button
      onClick={onConnect}
      disabled={connected || connecting}
      className={`w-full flex items-center gap-4 p-4 rounded-lg border transition-all text-left
        ${connected
          ? 'border-status-healthy/30 bg-status-healthy-muted'
          : 'border-edge bg-surface-2 hover:border-edge-strong hover:bg-surface-3'}`}
    >
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center
        ${connected ? 'bg-status-healthy/20' : 'bg-surface-3'}`}>
        {connecting ? (
          <Loader2 size={18} className="text-accent animate-spin" />
        ) : connected ? (
          <Check size={18} className="text-status-healthy" />
        ) : (
          <Icon size={18} className="text-text-secondary" />
        )}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary">{name}</span>
          {connected && <span className="text-2xs text-status-healthy font-medium">Connected</span>}
        </div>
        <p className="text-xs text-text-secondary mt-0.5">{description}</p>
      </div>
      {!connected && !connecting && (
        <ChevronRight size={16} className="text-text-tertiary" />
      )}
    </button>
  );
}

function SyncProgress({ syncing, counts }) {
  if (!syncing && counts.total === 0) return null;

  return (
    <div className="mt-4 p-4 rounded-lg border border-edge bg-surface-1 animate-fade-in">
      <div className="flex items-center gap-2 mb-3">
        {syncing ? (
          <>
            <RefreshCw size={14} className="text-accent animate-spin" />
            <span className="text-xs font-medium text-text-primary">Syncing your data...</span>
          </>
        ) : (
          <>
            <Check size={14} className="text-status-healthy" />
            <span className="text-xs font-medium text-text-primary">Sync complete</span>
          </>
        )}
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="text-center">
          <Users size={14} className="mx-auto text-text-tertiary mb-1" />
          <span className="text-lg font-mono font-semibold text-text-primary">{counts.customers}</span>
          <p className="text-2xs text-text-tertiary">Companies</p>
        </div>
        <div className="text-center">
          <FileText size={14} className="mx-auto text-text-tertiary mb-1" />
          <span className="text-lg font-mono font-semibold text-text-primary">{counts.invoices}</span>
          <p className="text-2xs text-text-tertiary">Invoices</p>
        </div>
        <div className="text-center">
          <CreditCard size={14} className="mx-auto text-text-tertiary mb-1" />
          <span className="text-lg font-mono font-semibold text-text-primary">{counts.payments}</span>
          <p className="text-2xs text-text-tertiary">Payments</p>
        </div>
      </div>
      {syncing && (
        <div className="mt-3 h-1 bg-surface-3 rounded-full overflow-hidden">
          <div className="h-full bg-accent rounded-full animate-pulse" style={{ width: '60%' }} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step views
// ---------------------------------------------------------------------------

function StepConnect({ tenantId, onComplete }) {
  const [stripeConnected, setStripeConnected] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncCounts, setSyncCounts] = useState({ total: 0, customers: 0, invoices: 0, payments: 0 });

  // API key input state
  const [apiKey, setApiKey] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);

  // Check existing connections on mount
  useEffect(() => {
    apiGet('/v1/integrations/status', tenantId).then(data => {
      if (data.integrations?.stripe?.connected) setStripeConnected(true);
    }).catch(() => {});
  }, [tenantId]);

  // Poll for sync progress when connected
  useEffect(() => {
    if (!stripeConnected) return;
    setSyncing(true);

    const interval = setInterval(async () => {
      try {
        const stats = await apiGet('/v1/world/stats', tenantId);
        const countsByType = stats.countsByObjectType || {};
        setSyncCounts({
          total: stats.objectCount || 0,
          customers: countsByType.party || 0,
          invoices: countsByType.invoice || 0,
          payments: countsByType.payment || 0,
        });
        if ((stats.objectCount || 0) > 0) setSyncing(false);
      } catch {}
    }, 3000);

    return () => clearInterval(interval);
  }, [stripeConnected, tenantId]);

  async function handleConnect() {
    if (!apiKey.startsWith('sk_')) {
      setError('Key must start with sk_live_ or sk_test_');
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/v1/integrations/stripe/key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
        credentials: 'include',
        body: JSON.stringify({ apiKey }),
      });
      const data = await res.json();
      if (data.ok) {
        setStripeConnected(true);
      } else {
        setError(data.error || 'Connection failed');
      }
    } catch {
      setError('Network error. Try again.');
    } finally {
      setConnecting(false);
    }
  }

  const allConnected = stripeConnected;

  return (
    <div>
      <h2 className="text-xl font-semibold text-text-primary mb-2">Connect your data sources</h2>
      <p className="text-sm text-text-secondary mb-6">
        This first milestone is Stripe-first. We build the event ledger, object graph,
        and initial predictions from Stripe before adding conversation sources.
      </p>

      <div className="space-y-3">
        {stripeConnected ? (
          <div className="flex items-center gap-4 p-4 rounded-lg border border-status-healthy/30 bg-status-healthy-muted">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-status-healthy/20">
              <Check size={18} className="text-status-healthy" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-text-primary">Stripe</span>
                <span className="text-2xs text-status-healthy font-medium">Connected</span>
              </div>
              <p className="text-xs text-text-secondary mt-0.5">Invoices, payments, customers, disputes</p>
            </div>
          </div>
        ) : (
          <div className="p-4 rounded-lg border border-edge bg-surface-2 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-surface-3">
                <CreditCard size={18} className="text-text-secondary" />
              </div>
              <div>
                <p className="text-sm font-medium text-text-primary">Stripe</p>
                <p className="text-xs text-text-secondary">Invoices, payments, customers, disputes</p>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-text-secondary">Stripe Secret Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk_live_..."
                className="w-full bg-surface-1 border border-edge rounded-lg px-3 py-2 text-sm font-mono text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              />
              <p className="text-2xs text-text-tertiary">
                Find this in your Stripe Dashboard &rarr; Developers &rarr; API keys. We encrypt and store it securely.
              </p>
              {error && <p className="text-xs text-status-blocked">{error}</p>}
              <button
                onClick={handleConnect}
                disabled={connecting || !apiKey}
                className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-accent-hover transition-colors"
              >
                {connecting ? 'Validating...' : 'Connect Stripe'}
              </button>
            </div>
          </div>
        )}

        <div className="rounded-lg border border-dashed border-edge bg-surface-1 px-4 py-3">
          <p className="text-xs font-medium text-text-primary">Next source: conversations</p>
          <p className="mt-1 text-xs text-text-secondary">
            Gmail and other conversation systems stay hidden until they materialize into the world model.
          </p>
        </div>
      </div>

      <SyncProgress syncing={syncing} counts={syncCounts} />

      <button
        onClick={onComplete}
        disabled={!allConnected}
        className={`mt-6 w-full py-3 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2
          ${allConnected
            ? 'bg-accent hover:bg-accent-hover text-white'
            : 'bg-surface-3 text-text-tertiary cursor-not-allowed'}`}
      >
        Review company state <ArrowRight size={14} />
      </button>
    </div>
  );
}

function StepReview({ tenantId, onComplete }) {
  const [objects, setObjects] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet('/v1/world/objects?limit=20', tenantId).then(data => {
      setObjects(data.objects || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [tenantId]);

  const typeIcons = {
    party: Users,
    invoice: FileText,
    payment: CreditCard,
    conversation: MessageSquare,
  };

  return (
    <div>
      <h2 className="text-xl font-semibold text-text-primary mb-2">Your company state</h2>
      <p className="text-sm text-text-secondary mb-6">
        Here is the current company state projected from Stripe. This milestone does not yet claim
        cross-source conversation linking, so only live Stripe-derived objects should appear.
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={20} className="text-accent animate-spin" />
        </div>
      ) : objects.length === 0 ? (
        <div className="text-center py-12">
          <AlertTriangle size={20} className="mx-auto text-status-attention mb-2" />
          <p className="text-sm text-text-secondary">No objects found yet. Sync may still be in progress.</p>
          <button
            onClick={() => { setLoading(true); apiGet('/v1/world/objects?limit=20', tenantId).then(d => { setObjects(d.objects || []); setLoading(false); }).catch(() => setLoading(false)); }}
            className="mt-3 text-xs text-accent hover:text-accent-hover"
          >
            Refresh
          </button>
        </div>
      ) : (
        <div className="space-y-1 max-h-[400px] overflow-y-auto rounded-lg border border-edge">
          {objects.map(obj => {
            const Icon = typeIcons[obj.type] || FileText;
            const state = obj.state || {};
            const name = state.name || state.number || state.subject || obj.id;
            return (
              <div key={obj.id} className="flex items-center gap-3 px-3 py-2 hover:bg-surface-2 transition-colors">
                <Icon size={14} className="text-text-tertiary flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-text-primary truncate block">{name}</span>
                  <span className="text-2xs text-text-tertiary font-mono">{obj.type} · {obj.id.slice(0, 12)}...</span>
                </div>
                {obj.estimated && Object.keys(obj.estimated).length > 0 && (
                  <span className="text-2xs text-status-predicted px-1.5 py-0.5 rounded bg-status-predicted-muted">
                    {Object.keys(obj.estimated).length} predictions
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <button
        onClick={onComplete}
        className="mt-6 w-full py-3 rounded-lg text-sm font-medium bg-accent hover:bg-accent-hover text-white transition-all flex items-center justify-center gap-2"
      >
        Enter governed shadow mode <ArrowRight size={14} />
      </button>
    </div>
  );
}

function StepLaunch({ tenantId, onComplete }) {
  const [launching, setLaunching] = useState(false);
  const [launched, setLaunched] = useState(false);
  const [launchError, setLaunchError] = useState('');

  async function handleLaunch() {
    setLaunching(true);
    setLaunchError('');
    try {
      const result = await apiPost('/v1/world/runtimes/ar-collections', tenantId, {
        name: 'AR Collections Runtime',
      });
      try {
        const existing = JSON.parse(localStorage.getItem('nooterra_product_runtime_v1') || '{}');
        localStorage.setItem('nooterra_product_runtime_v1', JSON.stringify({
          ...existing,
          tenantId,
          workerId: result?.runtime?.workerId || null,
          executionId: result?.runtime?.executionId || null,
          runtimeTemplateId: result?.runtime?.templateId || 'ar-collections-v1',
        }));
      } catch {}
      setLaunched(true);
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : 'Failed to launch the collections runtime');
    } finally {
      setLaunching(false);
    }
  }

  return (
    <div>
      <h2 className="text-xl font-semibold text-text-primary mb-2">Launch governed collections</h2>
      <p className="text-sm text-text-secondary mb-6">
        The runtime starts in shadow mode — it proposes actions but doesn't execute them.
        You'll review every action in the gateway queue. When you're comfortable, promote it.
      </p>

      {/* Runtime config preview */}
      <div className="p-4 rounded-lg border border-edge bg-surface-1 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <Zap size={14} className="text-accent" />
          <span className="text-sm font-medium text-text-primary">Collections runtime</span>
          <span className="text-2xs px-1.5 py-0.5 rounded bg-status-attention-muted text-status-attention">Shadow mode</span>
        </div>
        <div className="space-y-2 text-xs text-text-secondary">
          <div className="flex items-center gap-2">
            <Check size={10} className="text-status-healthy" />
            <span>Queue reminder actions for known customer contacts (invoices &lt; $50K)</span>
          </div>
          <div className="flex items-center gap-2">
            <Check size={10} className="text-status-healthy" />
            <span>Read invoice and payment data</span>
          </div>
          <div className="flex items-center gap-2">
            <Shield size={10} className="text-status-attention" />
            <span>Create escalation tasks (requires your approval)</span>
          </div>
          <div className="flex items-center gap-2">
            <AlertTriangle size={10} className="text-status-blocked" />
            <span>Cannot initiate payments, issue refunds, or delete data</span>
          </div>
        </div>
      </div>

      {/* Trust explanation */}
      <div className="p-3 rounded-lg bg-surface-2 border border-edge mb-6">
        <div className="flex items-start gap-2">
          <Eye size={14} className="text-status-predicted flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs text-text-primary font-medium">How trust works</p>
            <p className="text-2xs text-text-secondary mt-0.5">
              After 20+ successful shadow executions with 85%+ procedural score, the system proposes
              promotion to supervised mode. You approve. One incident demotes immediately.
            </p>
          </div>
        </div>
      </div>

      {launched ? (
        <div className="text-center py-6">
          <div className="w-12 h-12 rounded-full bg-status-healthy/20 flex items-center justify-center mx-auto mb-3">
            <Check size={20} className="text-status-healthy" />
          </div>
          <p className="text-sm font-medium text-text-primary">Collections runtime launched in shadow mode</p>
          <p className="text-xs text-text-secondary mt-1">Check the action gateway queue to see its first proposals.</p>
          <button
            onClick={onComplete}
            className="mt-4 inline-flex items-center gap-2 text-sm text-accent hover:text-accent-hover font-medium"
          >
            Go to Command Center <ArrowRight size={14} />
          </button>
        </div>
      ) : (
        <>
          {launchError ? (
            <div className="mb-4 rounded-lg border border-status-blocked/30 bg-status-blocked-muted px-3 py-2 text-xs text-status-blocked">
              {launchError}
            </div>
          ) : null}
          <button
            onClick={handleLaunch}
            disabled={launching}
            className="w-full py-3 rounded-lg text-sm font-medium bg-accent hover:bg-accent-hover text-white transition-all flex items-center justify-center gap-2"
          >
            {launching ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Launching...
              </>
            ) : (
              <>
                Launch shadow mode <Zap size={14} />
              </>
            )}
          </button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Onboarding View
// ---------------------------------------------------------------------------

export default function Onboarding() {
  const [step, setStep] = useState(0);
  const [tenantId] = useState(() => {
    // Get tenant from localStorage (existing auth system) or generate test ID
    try {
      const runtime = JSON.parse(localStorage.getItem('nooterra_product_runtime_v1') || '{}');
      return runtime.tenantId || `tenant_${Date.now().toString(36)}`;
    } catch {
      return `tenant_${Date.now().toString(36)}`;
    }
  });

  const steps = ['Connect Stripe', 'Review state', 'Launch runtime'];

  function handleComplete() {
    // Navigate to command center
    window.location.href = '/command';
  }

  return (
    <div className="min-h-screen bg-surface-0 flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        {/* Logo */}
        <div className="flex items-center gap-2 mb-8">
          <span className="text-lg font-semibold tracking-tight text-text-primary">nooterra</span>
          <span className="text-2xs px-2 py-0.5 rounded bg-surface-3 text-text-tertiary uppercase tracking-wider">Setup</span>
        </div>

        <StepIndicator steps={steps} current={step} />

        {step === 0 && <StepConnect tenantId={tenantId} onComplete={() => setStep(1)} />}
        {step === 1 && <StepReview tenantId={tenantId} onComplete={() => setStep(2)} />}
        {step === 2 && <StepLaunch tenantId={tenantId} onComplete={handleComplete} />}
      </div>
    </div>
  );
}
