import { useEffect, useState } from 'react';
import {
  Activity, AlertTriangle, Eye, Target, TrendingDown, TrendingUp,
} from 'lucide-react';
import { getWorldOverview } from '../lib/world-api.js';

function formatMoney(cents) {
  return `$${(Number(cents || 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function ProbabilityBar({ value, width = 'w-20' }) {
  const pct = Math.round(Number(value || 0) * 100);

  // Color stops: green at high probability, amber at mid, red at low
  const fillColor = pct > 70 ? 'bg-status-healthy'
    : pct > 40 ? 'bg-status-attention'
    : 'bg-status-blocked';
  const textColor = pct > 70 ? 'text-status-healthy'
    : pct > 40 ? 'text-status-attention'
    : 'text-status-blocked';

  return (
    <div className="flex items-center gap-2.5">
      <div className={`relative ${width} h-1 bg-surface-3 rounded-sm overflow-hidden`}>
        {/* Tick marks at 25/50/75% */}
        <span className="absolute top-0 bottom-0 left-1/4 w-px bg-surface-1/80 z-10" />
        <span className="absolute top-0 bottom-0 left-1/2 w-px bg-surface-1/80 z-10" />
        <span className="absolute top-0 bottom-0 left-3/4 w-px bg-surface-1/80 z-10" />
        <div
          className={`h-full ${fillColor} transition-all duration-300`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-xs font-mono font-medium tabular-nums ${textColor} w-8 text-right`}>{pct}%</span>
    </div>
  );
}

function MetricCard({ label, value, subtext, trend, trendDirection = 'good' }) {
  const trendColor = trendDirection === 'bad' ? 'text-status-blocked' : 'text-status-healthy';
  return (
    <div className="p-4 rounded-lg bg-surface-2 border border-edge border-t-2 border-t-edge">
      <span className="text-2xs font-semibold text-text-tertiary uppercase tracking-widest">{label}</span>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-semibold font-mono text-text-primary tabular-nums">{value}</span>
        {trend ? (
          <span className={`flex items-center gap-0.5 text-xs font-medium ${trendColor}`}>
            {trendDirection === 'bad' ? <TrendingDown size={12} /> : <TrendingUp size={12} />}
            {trend}
          </span>
        ) : null}
      </div>
      {subtext ? <p className="text-2xs text-text-tertiary mt-2 pt-2 border-t border-edge-subtle">{subtext}</p> : null}
    </div>
  );
}

function ModelHealthRow({ label, detail, value }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-edge-subtle last:border-0">
      <div className="flex items-center gap-2">
        <Target size={11} className="text-text-tertiary flex-shrink-0" />
        <span className="text-sm text-text-primary">{label}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-2xs text-text-tertiary font-mono">{detail}</span>
        <span className="text-xs font-mono font-semibold text-status-healthy">{value}</span>
      </div>
    </div>
  );
}

function EmptyPanel() {
  return (
    <div className="rounded-lg border border-edge bg-surface-1 p-6 text-center">
      <AlertTriangle size={18} className="mx-auto text-text-tertiary mb-2" />
      <p className="text-sm text-text-primary">No invoice predictions yet</p>
      <p className="text-xs text-text-secondary mt-1">
        Estimated state appears after Stripe data lands and the rule-based estimator runs.
      </p>
    </div>
  );
}

export default function PredictionDashboard() {
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState('');
  const [sortBy, setSortBy] = useState('risk');

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
        if (!cancelled) setError(err.message || 'Failed to load predictions');
      }
    }

    load();
    const interval = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const aggregate = overview?.aggregatePredictions || {
    totalOutstandingCents: 0,
    projectedCollection30dCents: 0,
    atRiskAmountCents: 0,
    disputeExposureCents: 0,
    overdueCount: 0,
  };

  const predictions = [...(overview?.invoicePredictions || [])].sort((left, right) => {
    if (sortBy === 'amount') return right.amountRemainingCents - left.amountRemainingCents;
    if (sortBy === 'overdue') return right.daysOverdue - left.daysOverdue;
    if (sortBy === 'dispute') return right.disputeRisk - left.disputeRisk;
    return left.paymentProbability7d - right.paymentProbability7d;
  });

  return (
    <div className="h-full bg-surface-0 overflow-y-auto">
      <div className="max-w-7xl mx-auto px-5 py-6">
        {error ? (
          <div className="mb-6 rounded-lg border border-status-blocked/30 bg-status-blocked-muted px-4 py-3 text-sm text-status-blocked">
            {error}
          </div>
        ) : null}

        <div className="flex items-center justify-end mb-4">
          <div className="flex items-center gap-2">
            <Eye size={14} className="text-status-predicted" />
            <span className="text-xs text-text-secondary">
              Rule-based predictions from observed state and event history
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <MetricCard
            label="Outstanding AR"
            value={formatMoney(aggregate.totalOutstandingCents)}
            subtext={`${aggregate.overdueCount || 0} overdue invoices`}
          />
          <MetricCard
            label="Projected 30d"
            value={formatMoney(aggregate.projectedCollection30dCents)}
            trend={`${Math.round(((aggregate.projectedCollection30dCents || 0) / Math.max(1, aggregate.totalOutstandingCents || 1)) * 100)}%`}
          />
          <MetricCard
            label="At Risk"
            value={formatMoney(aggregate.atRiskAmountCents)}
            trendDirection="bad"
            trend={`${overview?.aggregatePredictions?.atRiskCount || 0} invoices`}
          />
          <MetricCard
            label="Dispute Exposure"
            value={formatMoney(aggregate.disputeExposureCents)}
            subtext="weighted by current dispute risk"
            trendDirection="bad"
          />
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-8">
          <div className="p-4 rounded-lg bg-surface-2 border border-edge">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-text-primary">Projection summary</span>
              <Activity size={12} className="text-text-tertiary" />
            </div>
            <div className="space-y-2">
              <ModelHealthRow
                label="Collections coverage"
                detail={`${overview?.counts?.byObjectType?.invoice || 0} invoices`}
                value={`${overview?.coverage?.summary?.totalCells || 0} cells`}
              />
              <ModelHealthRow
                label="Escrow pressure"
                detail={`${overview?.escrow?.count || 0} queued`}
                value={`${overview?.plan?.actionCount || 0} planned`}
              />
              <ModelHealthRow
                label="Prediction basis"
                detail="rule inference"
                value="live"
              />
            </div>
          </div>
          <div className="p-4 rounded-lg bg-surface-2 border border-edge">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-text-primary">Interpretation</span>
              <Target size={12} className="text-text-tertiary" />
            </div>
            <p className="text-sm text-text-secondary leading-6">
              This milestone exposes real observed and estimated invoice state. It does not claim
              statistical model calibration or causal intervention effects yet.
            </p>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-edge-subtle">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-text-tertiary">Per-invoice Predictions</h2>
            <div className="flex items-center gap-0.5 bg-surface-2 rounded p-0.5 border border-edge">
              {[
                ['risk', 'Risk'],
                ['amount', 'Amount'],
                ['overdue', 'Overdue'],
                ['dispute', 'Dispute'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setSortBy(key)}
                  className={`px-2.5 py-1 rounded text-2xs font-medium transition-all duration-100 ${
                    sortBy === key
                      ? 'bg-surface-4 text-text-primary shadow-sm'
                      : 'text-text-tertiary hover:text-text-secondary'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {predictions.length === 0 ? (
            <EmptyPanel />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-edge">
              <table className="w-full border-collapse">
                <thead className="bg-surface-1">
                  <tr className="border-b border-edge-subtle">
                    <th className="py-2.5 px-3 text-left text-2xs font-medium uppercase tracking-wider text-text-tertiary">Invoice</th>
                    <th className="py-2.5 px-3 text-right text-2xs font-medium uppercase tracking-wider text-text-tertiary">Outstanding</th>
                    <th className="py-2.5 px-3 text-center text-2xs font-medium uppercase tracking-wider text-text-tertiary">Overdue</th>
                    <th className="py-2.5 px-3 text-left text-2xs font-medium uppercase tracking-wider text-text-tertiary">Pay 7d</th>
                    <th className="py-2.5 px-3 text-left text-2xs font-medium uppercase tracking-wider text-text-tertiary">Pay 30d</th>
                    <th className="py-2.5 px-3 text-left text-2xs font-medium uppercase tracking-wider text-text-tertiary">Dispute</th>
                    <th className="py-2.5 px-3 text-left text-2xs font-medium uppercase tracking-wider text-text-tertiary">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {predictions.map((invoice) => (
                    <tr key={invoice.id} className="border-b border-edge-subtle last:border-0 hover:bg-surface-2 transition-colors duration-100">
                      <td className="py-3 px-3">
                        <div>
                          <span className="text-sm text-text-primary font-mono">{invoice.number}</span>
                          <p className="text-2xs text-text-tertiary mt-0.5 font-mono opacity-50">{invoice.id}</p>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right text-sm text-text-primary font-mono tabular-nums">{formatMoney(invoice.amountRemainingCents)}</td>
                      <td className="py-3 px-3 text-center">
                        <span className={`text-xs font-mono tabular-nums ${invoice.daysOverdue > 0 ? 'text-status-attention' : 'text-text-secondary'}`}>
                          {invoice.daysOverdue}d
                        </span>
                      </td>
                      <td className="py-3 px-3"><ProbabilityBar value={invoice.paymentProbability7d} /></td>
                      <td className="py-3 px-3"><ProbabilityBar value={invoice.paymentProbability30d} /></td>
                      <td className="py-3 px-3"><ProbabilityBar value={invoice.disputeRisk} /></td>
                      <td className="py-3 px-3">
                        <span className={`text-2xs px-1.5 py-0.5 rounded font-semibold uppercase tracking-wider ${
                          invoice.status === 'overdue'
                            ? 'bg-status-attention-muted text-status-attention'
                            : 'bg-surface-3 text-text-secondary'
                        }`}>
                          {invoice.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
