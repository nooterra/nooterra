/**
 * Prediction Dashboard — cash flow forecasts, per-invoice probabilities, DSO projections.
 *
 * Two modes: aggregate (portfolio view) and per-object (drill into one invoice).
 * Every chart shows confidence bands. Every prediction shows calibration score.
 * The visual language constantly reinforces: the system knows what it knows
 * and knows what it doesn't.
 */

import { useState } from 'react';
import {
  TrendingUp, TrendingDown, BarChart3, AlertTriangle,
  ChevronRight, Eye, Target, Activity,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const AGGREGATE_METRICS = {
  totalAR: 18700000,        // $187K in cents
  projectedCollection30d: 14200000,  // $142K
  dso: { current: 34, projected: 31, trend: -3 },
  collectionRate: { current: 0.82, projected: 0.87 },
  atRiskAmount: 4500000,    // $45K
  disputeExposure: 2850000, // $28.5K
};

const INVOICE_PREDICTIONS = [
  { id: 'inv_01HX9C', number: 'INV-2024-001', customer: 'Acme Corp', amount: 420000, daysOverdue: 18, prob7d: 0.72, prob30d: 0.89, disputeRisk: 0.08, calibration: 0.82, stage: 1 },
  { id: 'inv_01HX7D', number: 'INV-2024-002', customer: 'CloudStack Ltd', amount: 1280000, daysOverdue: 32, prob7d: 0.34, prob30d: 0.52, disputeRisk: 0.45, calibration: 0.78, stage: 3 },
  { id: 'inv_01HX6E', number: 'INV-2024-004', customer: 'DataPipe Inc', amount: 350000, daysOverdue: 7, prob7d: 0.88, prob30d: 0.95, disputeRisk: 0.02, calibration: 0.85, stage: 1 },
  { id: 'inv_01HX5F', number: 'INV-2024-005', customer: 'MetricFlow', amount: 890000, daysOverdue: 14, prob7d: 0.61, prob30d: 0.78, disputeRisk: 0.15, calibration: 0.79, stage: 2 },
  { id: 'inv_01HX4G', number: 'INV-2024-006', customer: 'Greenline', amount: 210000, daysOverdue: 5, prob7d: 0.91, prob30d: 0.97, disputeRisk: 0.01, calibration: 0.88, stage: 1 },
  { id: 'inv_01HX3H', number: 'INV-2024-007', customer: 'TechVentures', amount: 2850000, daysOverdue: 45, prob7d: 0.12, prob30d: 0.28, disputeRisk: 0.67, calibration: 0.71, stage: 3 },
];

const MODEL_HEALTH = {
  paymentPrediction: { calibration: 0.82, predictions: 847, withOutcomes: 634, mae: 0.18 },
  disputeDetection: { calibration: 0.76, predictions: 312, withOutcomes: 198, mae: 0.24 },
  churnRisk: { calibration: 0.68, predictions: 156, withOutcomes: 89, mae: 0.32 },
};

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function MetricCard({ label, value, subtext, trend, trendDirection }) {
  return (
    <div className="p-4 rounded-lg bg-surface-2 border border-edge">
      <span className="text-2xs font-medium text-text-tertiary uppercase tracking-wider">{label}</span>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="text-2xl font-semibold font-mono text-text-primary">{value}</span>
        {trend && (
          <span className={`flex items-center gap-0.5 text-xs font-medium ${
            trendDirection === 'good' ? 'text-status-healthy' :
            trendDirection === 'bad' ? 'text-status-blocked' : 'text-text-secondary'
          }`}>
            {trendDirection === 'good' ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {trend}
          </span>
        )}
      </div>
      {subtext && <p className="text-xs text-text-tertiary mt-1">{subtext}</p>}
    </div>
  );
}

function ProbabilityBar({ value, width = 'w-20' }) {
  const pct = Math.round(value * 100);
  const color = value > 0.7 ? 'bg-status-healthy' : value > 0.4 ? 'bg-status-attention' : 'bg-status-blocked';
  const textColor = value > 0.7 ? 'text-status-healthy' : value > 0.4 ? 'text-status-attention' : 'text-status-blocked';

  return (
    <div className="flex items-center gap-2">
      <div className={`${width} h-1.5 bg-surface-3 rounded-full overflow-hidden`}>
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-mono font-medium ${textColor} w-8 text-right`}>{pct}%</span>
    </div>
  );
}

function CalibrationBadge({ score }) {
  const color = score > 0.8 ? 'text-status-healthy bg-status-healthy-muted' :
                score > 0.65 ? 'text-status-attention bg-status-attention-muted' :
                'text-status-blocked bg-status-blocked-muted';
  return (
    <span className={`text-2xs font-mono px-1.5 py-0.5 rounded ${color}`} title="Model calibration score">
      cal:{(score * 100).toFixed(0)}
    </span>
  );
}

function InvoicePredictionRow({ inv }) {
  const stageLabels = { 1: 'Reminder', 2: 'Formal', 3: 'Escalate' };
  const stageColors = {
    1: 'text-status-healthy bg-status-healthy-muted',
    2: 'text-status-attention bg-status-attention-muted',
    3: 'text-status-blocked bg-status-blocked-muted',
  };

  return (
    <tr className="group hover:bg-surface-2 transition-colors cursor-pointer border-b border-edge-subtle last:border-0">
      <td className="py-2.5 px-3">
        <div>
          <span className="text-sm text-text-primary font-mono">{inv.number}</span>
          <p className="text-2xs text-text-tertiary mt-0.5">{inv.customer}</p>
        </div>
      </td>
      <td className="py-2.5 px-3 text-right">
        <span className="text-sm text-text-primary font-mono">${(inv.amount / 100).toLocaleString()}</span>
      </td>
      <td className="py-2.5 px-3 text-center">
        <span className={`text-xs font-mono ${inv.daysOverdue > 30 ? 'text-status-blocked' : inv.daysOverdue > 14 ? 'text-status-attention' : 'text-text-secondary'}`}>
          {inv.daysOverdue}d
        </span>
      </td>
      <td className="py-2.5 px-3">
        <ProbabilityBar value={inv.prob7d} />
      </td>
      <td className="py-2.5 px-3">
        <ProbabilityBar value={inv.prob30d} />
      </td>
      <td className="py-2.5 px-3">
        <ProbabilityBar value={inv.disputeRisk} />
      </td>
      <td className="py-2.5 px-3 text-center">
        <CalibrationBadge score={inv.calibration} />
      </td>
      <td className="py-2.5 px-3 text-center">
        <span className={`text-2xs px-1.5 py-0.5 rounded font-medium ${stageColors[inv.stage]}`}>
          {stageLabels[inv.stage]}
        </span>
      </td>
      <td className="py-2.5 px-3 text-right">
        <ChevronRight size={14} className="text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity inline" />
      </td>
    </tr>
  );
}

function ModelHealthRow({ name, data }) {
  const calColor = data.calibration > 0.8 ? 'text-status-healthy' :
                   data.calibration > 0.65 ? 'text-status-attention' : 'text-status-blocked';
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-2">
        <Target size={12} className="text-text-tertiary" />
        <span className="text-sm text-text-primary">{name}</span>
      </div>
      <div className="flex items-center gap-4">
        <span className="text-2xs text-text-tertiary font-mono">{data.withOutcomes}/{data.predictions} graded</span>
        <span className="text-2xs text-text-tertiary font-mono">MAE: {data.mae.toFixed(2)}</span>
        <span className={`text-xs font-mono font-medium ${calColor}`}>{(data.calibration * 100).toFixed(0)}%</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cash Flow Chart (ASCII-style — lightweight, no chart library)
// ---------------------------------------------------------------------------

function CashFlowProjection() {
  const weeks = ['W1', 'W2', 'W3', 'W4'];
  const projected = [42000, 38000, 35000, 27000]; // in dollars
  const max = Math.max(...projected);

  return (
    <div className="p-4 rounded-lg bg-surface-2 border border-edge">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-text-primary">30-Day Collection Projection</span>
        <span className="text-2xs text-status-predicted font-mono">± 15% confidence band</span>
      </div>
      <div className="flex items-end gap-2 h-24">
        {weeks.map((week, i) => {
          const height = (projected[i] / max) * 100;
          return (
            <div key={week} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-2xs font-mono text-text-primary">${(projected[i] / 1000).toFixed(0)}K</span>
              <div className="w-full relative" style={{ height: `${height}%` }}>
                {/* Confidence band */}
                <div className="absolute inset-x-0 bg-status-predicted/10 rounded-sm"
                  style={{ top: '-15%', bottom: '-15%' }} />
                {/* Bar */}
                <div className="absolute inset-0 bg-status-predicted/40 rounded-sm" />
              </div>
              <span className="text-2xs text-text-tertiary">{week}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main View
// ---------------------------------------------------------------------------

export default function PredictionDashboard() {
  const [sortBy, setSortBy] = useState('prob7d');

  const sorted = [...INVOICE_PREDICTIONS].sort((a, b) => {
    if (sortBy === 'prob7d') return a.prob7d - b.prob7d; // lowest first (most at risk)
    if (sortBy === 'amount') return b.amount - a.amount;
    if (sortBy === 'overdue') return b.daysOverdue - a.daysOverdue;
    if (sortBy === 'dispute') return b.disputeRisk - a.disputeRisk;
    return 0;
  });

  return (
    <div className="h-full bg-surface-0 overflow-y-auto">
      <div className="max-w-7xl mx-auto px-5 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-lg font-semibold text-text-primary">Predictions</h1>
            <p className="text-sm text-text-secondary mt-0.5">
              Every prediction is calibrated. Confidence bands on everything.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Eye size={14} className="text-status-predicted" />
            <span className="text-xs text-text-secondary">
              Model calibration: <span className="font-mono text-status-healthy">82%</span>
            </span>
          </div>
        </div>

        {/* Aggregate metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <MetricCard
            label="Outstanding AR"
            value={`$${(AGGREGATE_METRICS.totalAR / 100).toLocaleString()}`}
            subtext={`$${(AGGREGATE_METRICS.projectedCollection30d / 100).toLocaleString()} projected collection`}
          />
          <MetricCard
            label="DSO"
            value={`${AGGREGATE_METRICS.dso.current}d`}
            trend={`${AGGREGATE_METRICS.dso.trend}d`}
            trendDirection="good"
            subtext={`Projected: ${AGGREGATE_METRICS.dso.projected}d`}
          />
          <MetricCard
            label="Collection Rate"
            value={`${(AGGREGATE_METRICS.collectionRate.current * 100).toFixed(0)}%`}
            trend={`+${((AGGREGATE_METRICS.collectionRate.projected - AGGREGATE_METRICS.collectionRate.current) * 100).toFixed(0)}%`}
            trendDirection="good"
          />
          <MetricCard
            label="At Risk"
            value={`$${(AGGREGATE_METRICS.atRiskAmount / 100).toLocaleString()}`}
            subtext={`$${(AGGREGATE_METRICS.disputeExposure / 100).toLocaleString()} dispute exposure`}
            trend="2 invoices"
            trendDirection="bad"
          />
        </div>

        {/* Cash flow + model health side by side */}
        <div className="grid md:grid-cols-2 gap-4 mb-8">
          <CashFlowProjection />
          <div className="p-4 rounded-lg bg-surface-2 border border-edge">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-text-primary">Model Health</span>
              <Activity size={12} className="text-text-tertiary" />
            </div>
            <div className="space-y-1">
              <ModelHealthRow name="Payment prediction" data={MODEL_HEALTH.paymentPrediction} />
              <ModelHealthRow name="Dispute detection" data={MODEL_HEALTH.disputeDetection} />
              <ModelHealthRow name="Churn risk" data={MODEL_HEALTH.churnRisk} />
            </div>
          </div>
        </div>

        {/* Per-invoice predictions table */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-text-primary">Per-Invoice Predictions</h2>
            <div className="flex items-center gap-1">
              <span className="text-2xs text-text-tertiary mr-1">Sort:</span>
              {[
                { key: 'prob7d', label: 'Risk (7d)' },
                { key: 'amount', label: 'Amount' },
                { key: 'overdue', label: 'Overdue' },
                { key: 'dispute', label: 'Dispute' },
              ].map(s => (
                <button
                  key={s.key}
                  onClick={() => setSortBy(s.key)}
                  className={`px-2 py-0.5 rounded text-2xs transition-colors ${
                    sortBy === s.key ? 'bg-surface-3 text-text-primary' : 'text-text-tertiary hover:text-text-secondary'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-edge overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-surface-2">
                  <th className="text-left text-2xs font-medium text-text-tertiary uppercase tracking-wider px-3 py-2">Invoice</th>
                  <th className="text-right text-2xs font-medium text-text-tertiary uppercase tracking-wider px-3 py-2">Amount</th>
                  <th className="text-center text-2xs font-medium text-text-tertiary uppercase tracking-wider px-3 py-2">Overdue</th>
                  <th className="text-left text-2xs font-medium text-text-tertiary uppercase tracking-wider px-3 py-2">Pay (7d)</th>
                  <th className="text-left text-2xs font-medium text-text-tertiary uppercase tracking-wider px-3 py-2">Pay (30d)</th>
                  <th className="text-left text-2xs font-medium text-text-tertiary uppercase tracking-wider px-3 py-2">Dispute</th>
                  <th className="text-center text-2xs font-medium text-text-tertiary uppercase tracking-wider px-3 py-2">Cal</th>
                  <th className="text-center text-2xs font-medium text-text-tertiary uppercase tracking-wider px-3 py-2">Stage</th>
                  <th className="px-3 py-2 w-8" />
                </tr>
              </thead>
              <tbody>
                {sorted.map(inv => (
                  <InvoicePredictionRow key={inv.id} inv={inv} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
