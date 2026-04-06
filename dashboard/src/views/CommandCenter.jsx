import { useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, Clock, Pause, Shield, TrendingUp, Zap,
} from 'lucide-react';
import { getWorldOverview } from '../lib/world-api.js';

function formatMoney(cents) {
  return `$${(Number(cents || 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatTime(value) {
  if (!value) return 'unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unavailable';
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.max(0, Math.floor(diffMs / 60000));
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

function HealthIndicator({ label, status, value, detail, trend }) {
  const styles = {
    healthy: 'text-status-healthy border-status-healthy/30 bg-status-healthy-muted border-t-status-healthy',
    attention: 'text-status-attention border-status-attention/30 bg-status-attention-muted border-t-status-attention',
    critical: 'text-status-blocked border-status-blocked/30 bg-status-blocked-muted border-t-status-blocked',
  };

  return (
    <div className={`p-4 rounded-lg border border-t-2 ${styles[status]}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-2xs font-semibold uppercase tracking-widest opacity-60">{label}</span>
        <span className={`inline-flex h-1.5 w-1.5 rounded-full ${
          status === 'healthy' ? 'bg-status-healthy' : status === 'attention' ? 'bg-status-attention' : 'bg-status-blocked'
        }`} />
      </div>
      <div className="text-3xl font-semibold font-mono tabular-nums">{value}</div>
      <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-current/10">
        <span className="text-xs opacity-60">{detail}</span>
        <span className="text-xs font-medium font-mono opacity-80">{trend}</span>
      </div>
    </div>
  );
}

function ActivityItem({ event, index }) {
  const isAgent = event.type.startsWith('agent.');
  const isFinancial = event.type.startsWith('financial.');

  const icon = isAgent
    ? <Zap size={12} className="text-status-healthy" />
    : isFinancial
    ? <TrendingUp size={12} className="text-status-predicted" />
    : <Activity size={12} className="text-text-tertiary" />;

  const accentColor = isAgent
    ? 'border-l-status-healthy'
    : isFinancial
    ? 'border-l-status-predicted'
    : 'border-l-transparent';

  const payload = event.payload || {};
  const description = payload.workerName
    ? `${payload.workerName} · ${event.type}`
    : payload.number
    ? `${event.type} · ${payload.number}`
    : event.type;

  return (
    <div className={`flex items-start gap-3 py-2.5 px-3 border-l-2 ${accentColor} ${
      index % 2 === 0 ? 'bg-surface-1/40' : ''
    } hover:bg-surface-2 transition-colors`}>
      <div className="flex-shrink-0 mt-0.5 w-5 h-5 rounded flex items-center justify-center bg-surface-3">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-text-primary truncate">{description}</div>
        <div className="flex items-center gap-2 mt-0.5 text-2xs text-text-tertiary">
          <span>{formatTime(event.timestamp)}</span>
          <span className="font-mono opacity-50">{event.id}</span>
        </div>
      </div>
    </div>
  );
}

function AttentionItem({ item }) {
  const isHigh = item.priority === 'high';
  const isMedium = item.priority === 'medium';

  const icon = item.kind === 'escrow'
    ? <Pause size={14} className="text-status-attention" />
    : isHigh
    ? <AlertTriangle size={14} className="text-status-blocked" />
    : <Shield size={14} className="text-accent" />;

  const borderColor = isHigh
    ? 'border-l-status-blocked'
    : isMedium
    ? 'border-l-status-attention'
    : 'border-l-accent';

  const bgColor = isHigh
    ? 'bg-status-blocked-muted/60'
    : isMedium
    ? 'bg-status-attention-muted/40'
    : 'bg-surface-2';

  return (
    <div className={`p-3 rounded-lg ${bgColor} border border-edge border-l-[3px] ${borderColor} transition-colors`}>
      <div className="flex items-start gap-2.5">
        <div className="flex-shrink-0 mt-0.5">{icon}</div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-text-primary font-medium leading-snug">{item.title}</p>
          <p className="text-xs text-text-secondary mt-1 leading-relaxed">{item.description || 'No additional detail available.'}</p>
        </div>
        {isHigh && (
          <span className="flex-shrink-0 text-2xs font-semibold text-status-blocked uppercase tracking-wider mt-0.5">HIGH</span>
        )}
      </div>
    </div>
  );
}

function EmptyPanel({ title, detail }) {
  return (
    <div className="rounded-lg border border-edge bg-surface-1 p-6 text-center">
      <Clock size={18} className="mx-auto text-text-tertiary mb-2" />
      <p className="text-sm text-text-primary">{title}</p>
      <p className="text-xs text-text-secondary mt-1">{detail}</p>
    </div>
  );
}

export default function CommandCenter() {
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const next = await getWorldOverview();
        if (!cancelled) {
          setOverview(next);
          setError('');
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load world overview');
      }
    }

    load();
    const interval = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const metrics = useMemo(() => overview?.aggregatePredictions || {
    totalOutstandingCents: 0,
    projectedCollection30dCents: 0,
    atRiskAmountCents: 0,
    overdueCount: 0,
  }, [overview]);

  const counts = overview?.counts || { totalObjects: 0, totalEvents: 0, escrowedActions: 0 };
  const coverage = overview?.coverage?.summary || { totalCells: 0, autonomousCells: 0 };
  const recentActivity = overview?.recentActivity || [];
  const attention = overview?.topAttention || [];

  return (
    <div className="h-full bg-surface-0 overflow-y-auto">
      <div className="max-w-7xl mx-auto px-5 py-6">
        {error ? (
          <div className="mb-6 rounded-lg border border-status-blocked/30 bg-status-blocked-muted px-4 py-3 text-sm text-status-blocked">
            {error}
          </div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <HealthIndicator
            label="Event Ledger"
            status={counts.totalEvents > 0 ? 'healthy' : 'attention'}
            value={counts.totalEvents.toLocaleString()}
            detail={`${counts.totalObjects.toLocaleString()} objects projected`}
            trend={`${coverage.totalCells} autonomy cells`}
          />
          <HealthIndicator
            label="Collections Forecast"
            status={metrics.atRiskAmountCents > 0 ? 'attention' : 'healthy'}
            value={formatMoney(metrics.projectedCollection30dCents)}
            detail={`${formatMoney(metrics.totalOutstandingCents)} outstanding`}
            trend={`${metrics.overdueCount || 0} overdue`}
          />
          <HealthIndicator
            label="Action Gateway"
            status={counts.escrowedActions > 0 ? 'attention' : 'healthy'}
            value={String(counts.escrowedActions || 0)}
            detail={`${coverage.autonomousCells || 0} autonomous cells`}
            trend={`${formatMoney(metrics.atRiskAmountCents)} at risk`}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3">
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-edge-subtle">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-text-tertiary">Event Ledger</h2>
              <span className="text-2xs text-text-tertiary font-mono">{recentActivity.length} events</span>
            </div>
            {recentActivity.length === 0 ? (
              <EmptyPanel
                title="No events in the ledger yet"
                detail="Connect Stripe in setup to start building the world model."
              />
            ) : (
              <div className="rounded-lg border border-edge overflow-hidden">
                {recentActivity.map((event, index) => <ActivityItem key={event.id} event={event} index={index} />)}
              </div>
            )}
          </div>

          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-edge-subtle">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-text-tertiary">Attention</h2>
              {attention.length > 0 && (
                <span className="text-2xs font-mono font-semibold text-status-attention bg-status-attention/10 px-1.5 py-0.5 rounded">{attention.length}</span>
              )}
            </div>
            {attention.length === 0 ? (
              <EmptyPanel
                title="Nothing is queued"
                detail="No escrowed actions or high-priority planner recommendations are active."
              />
            ) : (
              <div className="space-y-3">
                {attention.map((item) => <AttentionItem key={item.id} item={item} />)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export { CommandCenter };
