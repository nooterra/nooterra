import { useEffect, useState } from 'react';
import {
  CheckCircle2, ChevronRight, Edit3, FileText, Mail, Pause, XCircle,
} from 'lucide-react';
import { getEscrowQueue, releaseEscrow } from '../lib/world-api.js';

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function formatTime(value) {
  if (!value) return 'unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unavailable';
  return date.toLocaleString();
}

function RiskBadge({ action }) {
  const evidence = parseJson(action.evidence, {});
  const uncertainty = Number(evidence?.uncertaintyDeclared ?? 0);
  const risk = uncertainty >= 0.3 || Number(action.value_cents || 0) >= 500000 ? 'high'
    : uncertainty >= 0.15 ? 'medium'
    : 'low';
  const styles = {
    low: 'bg-status-healthy-muted text-status-healthy border border-status-healthy/20',
    medium: 'bg-status-attention-muted text-status-attention border border-status-attention/30',
    high: 'bg-status-blocked-muted text-status-blocked border border-status-blocked/40',
  };
  return (
    <span className={`text-2xs font-semibold px-2 py-0.5 rounded uppercase tracking-wider ${styles[risk]}`}>
      {risk}
    </span>
  );
}

function ActionCard({ action, onResolve, busy }) {
  const [expanded, setExpanded] = useState(false);
  const parameters = parseJson(action.parameters, {});
  const evidence = parseJson(action.evidence, {});
  const actionClass = String(action.action_class || '');
  const isEmail = actionClass.startsWith('communicate.email');

  // Derive risk level for left-border accent
  const uncertainty = Number(evidence?.uncertaintyDeclared ?? 0);
  const riskLevel = uncertainty >= 0.3 || Number(action.value_cents || 0) >= 500000 ? 'high'
    : uncertainty >= 0.15 ? 'medium'
    : 'low';
  const riskBorder = riskLevel === 'high' ? 'border-l-status-blocked'
    : riskLevel === 'medium' ? 'border-l-status-attention'
    : 'border-l-edge';

  return (
    <div className={`rounded-lg border bg-surface-1 border-edge border-l-[3px] ${riskBorder}`}>
      <div className="p-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex-shrink-0 w-8 h-8 rounded bg-surface-3 flex items-center justify-center mt-0.5">
            {isEmail ? <Mail size={14} className="text-text-secondary" /> : <FileText size={14} className="text-text-secondary" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-text-primary">{actionClass || 'Escrowed action'}</span>
              <RiskBadge action={action} />
            </div>
            <p className="text-xs text-text-secondary mt-0.5">
              {action.target_object_type || 'object unavailable'} · {action.target_object_id || 'target unavailable'}
            </p>
            <div className="flex items-center gap-3 mt-1 text-2xs text-text-tertiary">
              <span className="font-mono">{action.tool || 'tool unavailable'}</span>
              <span className="opacity-60">{formatTime(action.created_at)}</span>
            </div>
          </div>
        </div>

        {isEmail ? (
          <div className="mt-3 p-3 rounded bg-surface-0 border border-edge-subtle">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xs text-text-tertiary w-12 flex-shrink-0">To</span>
              <span className="text-xs text-text-primary font-mono">{parameters.to || 'unavailable'}</span>
            </div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xs text-text-tertiary w-12 flex-shrink-0">Subject</span>
              <span className="text-xs text-text-primary">{parameters.subject || 'unavailable'}</span>
            </div>
            <div className="border-t border-edge-subtle pt-2 mt-1">
              <p className="text-xs text-text-secondary whitespace-pre-line leading-relaxed">
                {parameters.body || 'Body unavailable from the escrow record.'}
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-3 p-3 rounded bg-surface-0 border border-edge-subtle">
            <div className="text-2xs text-text-tertiary uppercase tracking-widest mb-2">Parameters</div>
            <pre className="text-xs text-text-secondary whitespace-pre-wrap break-all">
              {JSON.stringify(parameters, null, 2)}
            </pre>
          </div>
        )}

        {/* Evidence bundle toggle */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1.5 mt-3 text-2xs text-text-tertiary hover:text-text-secondary transition-colors group"
        >
          <ChevronRight
            size={12}
            className={`transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
          />
          <span className="group-hover:underline underline-offset-2">Evidence bundle</span>
        </button>

        {/* Smooth expand/collapse */}
        <div className={`overflow-hidden transition-all duration-200 ${expanded ? 'max-h-96 opacity-100 mt-3' : 'max-h-0 opacity-0'}`}>
          <div className="space-y-3 pt-0.5">
            <div>
              <span className="text-2xs text-text-tertiary uppercase tracking-widest">Policy clauses</span>
              <div className="mt-1.5 text-xs text-text-secondary leading-relaxed">
                {(evidence.policyClauses || []).length > 0 ? (evidence.policyClauses || []).join(' · ') : 'Unavailable'}
              </div>
            </div>
            <div>
              <span className="text-2xs text-text-tertiary uppercase tracking-widest">Facts relied on</span>
              <div className="mt-1.5 text-xs text-text-secondary leading-relaxed">
                {(evidence.factsReliedOn || []).length > 0 ? (evidence.factsReliedOn || []).join(' · ') : 'Unavailable'}
              </div>
            </div>
            <div>
              <span className="text-2xs text-text-tertiary uppercase tracking-widest">Authority chain</span>
              <div className="mt-1.5 text-xs text-text-secondary font-mono">
                {(evidence.authorityChain || []).length > 0 ? (evidence.authorityChain || []).join(' → ') : 'Unavailable'}
              </div>
            </div>
            <div className="text-2xs text-text-tertiary pt-1 border-t border-edge-subtle">
              Declared uncertainty:{' '}
              <span className="font-mono font-medium text-text-secondary">
                {evidence.uncertaintyDeclared != null ? `${Math.round(Number(evidence.uncertaintyDeclared) * 100)}%` : 'Unavailable'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Action footer */}
      <div className="flex items-center gap-2 px-4 py-3 border-t border-edge-subtle bg-surface-0/60 rounded-b-lg">
        <button
          onClick={() => onResolve(action.id, 'execute')}
          disabled={busy}
          aria-label={`Approve action: ${action.action_class || action.id}`}
          className="flex items-center gap-1.5 px-4 py-2 rounded text-xs font-semibold bg-status-healthy/20 text-status-healthy border border-status-healthy/25 hover:bg-status-healthy/30 hover:border-status-healthy/40 transition-all duration-150 disabled:opacity-40"
        >
          <CheckCircle2 size={13} /> Approve
        </button>
        <button
          onClick={() => onResolve(action.id, 'reject')}
          disabled={busy}
          aria-label={`Reject action: ${action.action_class || action.id}`}
          className="flex items-center gap-1.5 px-4 py-2 rounded text-xs font-semibold bg-status-blocked/10 text-status-blocked border border-status-blocked/25 hover:bg-status-blocked/20 hover:border-status-blocked/40 transition-all duration-150 disabled:opacity-40"
        >
          <XCircle size={13} /> Reject
        </button>
        <span className="flex items-center gap-1.5 px-3 py-2 rounded text-xs text-text-tertiary bg-surface-2 border border-edge ml-auto">
          <Edit3 size={12} /> Modify unavailable
        </span>
      </div>
    </div>
  );
}

export default function ApprovalQueue() {
  const [actions, setActions] = useState([]);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  async function load() {
    try {
      const next = await getEscrowQueue();
      setActions(Array.isArray(next) ? next : []);
      setError('');
    } catch (err) {
      setActions([]);
      setError(err.message || 'Failed to load escrow queue');
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, []);

  async function handleResolve(actionId, decision) {
    setBusyId(actionId);
    try {
      await releaseEscrow(actionId, decision);
      await load();
    } catch (err) {
      setError(err.message || 'Failed to resolve escrow action');
    } finally {
      setBusyId('');
    }
  }

  return (
    <div className="h-full bg-surface-0 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-5 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-sm font-medium text-text-primary">Action gateway queue</h2>
            <p className="text-xs text-text-secondary mt-1">
              Real escrowed actions from the gateway. Missing fields are shown as unavailable instead of being invented.
            </p>
          </div>
          <div className="text-2xs text-text-tertiary font-mono">{actions.length} queued</div>
        </div>

        {error ? (
          <div className="mb-4 rounded-lg border border-status-blocked/30 bg-status-blocked-muted px-4 py-3 text-sm text-status-blocked">
            {error}
          </div>
        ) : null}

        {actions.length === 0 ? (
          <div className="rounded-lg border border-edge bg-surface-1 p-6 text-center">
            <Pause size={18} className="mx-auto text-text-tertiary mb-2" />
            <p className="text-sm text-text-primary">No escrowed actions</p>
            <p className="text-xs text-text-secondary mt-1">
              The action gateway is clear. New governed actions will appear here when they require approval.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {actions.map((action) => (
              <ActionCard
                key={action.id}
                action={action}
                busy={busyId === action.id}
                onResolve={handleResolve}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
