import { useState, useEffect, useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '../../components/ui/badge.jsx';
import { Button } from '../../components/ui/button.jsx';
import { Card } from '../../components/ui/card.jsx';
import { EmptyState } from '../../components/ui/empty-state.jsx';
import { ProgressBar } from '../../components/ui/progress-bar.jsx';
import { SkeletonRow } from '../../components/ui/skeleton.jsx';
import { Tooltip, TooltipTrigger, TooltipContent } from '../../components/ui/tooltip.jsx';
import { StaggerList, FadeIn, Collapse } from '../../components/ui/stagger.jsx';
import {
  getNBAPlan,
  getInvoiceRanking,
  formatMoney,
  formatMoneyFull,
  formatDays,
  humanizeShapFeature,
  shapDirection,
} from '../../lib/ar-api.js';
import { cn } from '../../lib/utils.js';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function OverdueBadge({ days }) {
  const variant = days < 7 ? 'success' : days < 30 ? 'warning' : 'destructive';
  return <Badge variant={variant}>{formatDays(days)} overdue</Badge>;
}

function ActionChip({ actionClass }) {
  const map = {
    'strategic.hold': { label: 'Hold', variant: 'muted' },
    'communicate.email': { label: 'Email', variant: 'default' },
    'task.create': { label: 'Escalate', variant: 'warning' },
  };
  const { label, variant } = map[actionClass] || { label: actionClass, variant: 'secondary' };
  return <Badge variant={variant}>{label}</Badge>;
}

function ShapChip({ reason }) {
  const dir = shapDirection(reason.contribution);
  const label = humanizeShapFeature(reason.feature);
  const variant = dir === 'positive' ? 'success' : dir === 'negative' ? 'destructive' : 'muted';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div>
          <Badge variant={variant} className="cursor-default">
            {dir === 'positive' && '+'}
            {dir === 'negative' && '\u2212'}
            {label}
          </Badge>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <div className="font-mono text-2xs">
          {reason.feature} = {reason.value?.toFixed(2) ?? '?'} ({reason.contribution > 0 ? '+' : ''}{reason.contribution?.toFixed(3)})
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function SurvivalBars({ survival }) {
  if (!survival) return <div className="text-2xs text-text-tertiary">No survival data</div>;
  const horizons = [
    { label: '7d', value: 1 - (survival.survival_7d ?? survival.survival7d ?? 0.5) },
    { label: '30d', value: 1 - (survival.survival_30d ?? survival.survival30d ?? 0.3) },
    { label: '90d', value: 1 - (survival.survival_90d ?? survival.survival90d ?? 0.1) },
  ];

  return (
    <div className="flex items-end gap-4">
      {horizons.map((h) => (
        <div key={h.label} className="flex flex-col items-center gap-1.5">
          <div className="w-10 h-20 bg-surface-3 rounded-md overflow-hidden flex flex-col justify-end">
            <div
              className="w-full rounded-t-sm transition-all duration-700 ease-out"
              style={{ height: `${Math.round(h.value * 100)}%`, background: 'var(--tw-color-accent, #4f8ff7)' }}
            />
          </div>
          <span className="text-2xs text-text-tertiary">{h.label}</span>
          <span className="text-2xs font-mono tabular-nums text-text-secondary font-medium">{Math.round(h.value * 100)}%</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invoice Row
// ---------------------------------------------------------------------------

function InvoiceRow({ action, rank, expanded, onToggle }) {
  const params = action.parameters || {};
  const amountCents = params.amountCents || 0;
  const daysOverdue = params.daysOverdue || 0;
  const invoiceNumber = params.invoiceNumber || action.targetObjectId?.slice(0, 12);
  const paymentProb = action.predictionConfidence ?? action.objectiveScore ?? 0.5;
  const shapReasons = action.shapReasons || [];

  return (
    <div className={cn(
      'border-b border-edge last:border-b-0 transition-colors',
      expanded && 'bg-surface-1/60',
    )}>
      <button
        onClick={onToggle}
        className="w-full text-left px-5 py-3.5 hover:bg-surface-2/40 transition-colors group"
      >
        <div className="flex items-center gap-3">
          {/* Rank */}
          <span className="shrink-0 w-6 text-2xs font-mono tabular-nums text-text-tertiary text-right">
            {rank}
          </span>

          {/* Invoice + ID */}
          <div className="min-w-0 w-36">
            <div className="text-sm font-medium text-text-primary truncate">{invoiceNumber}</div>
            <div className="text-2xs text-text-tertiary truncate mt-0.5 font-mono">{action.targetObjectId?.slice(0, 16)}</div>
          </div>

          {/* Amount */}
          <div className="shrink-0 w-24 text-right">
            <span className="text-sm font-mono tabular-nums font-semibold text-text-primary">
              {formatMoney(amountCents)}
            </span>
          </div>

          {/* Days overdue */}
          <div className="shrink-0 w-28">
            <OverdueBadge days={daysOverdue} />
          </div>

          {/* Payment probability */}
          <div className="flex-1 min-w-28 max-w-44">
            <ProgressBar value={paymentProb} size="sm" />
          </div>

          {/* Recommended action */}
          <div className="shrink-0 w-20">
            <ActionChip actionClass={action.actionClass} />
          </div>

          {/* SHAP reasons */}
          <div className="hidden xl:flex shrink-0 items-center gap-1.5 max-w-60 overflow-hidden">
            {shapReasons.slice(0, 2).map((r, i) => (
              <ShapChip key={i} reason={r} />
            ))}
          </div>

          {/* Chevron */}
          <ChevronRight
            size={14}
            className={cn(
              'shrink-0 text-text-tertiary transition-transform duration-200',
              expanded && 'rotate-90',
              'group-hover:text-text-secondary',
            )}
          />
        </div>
      </button>

      <Collapse open={expanded}>
        <InvoiceDetail action={action} />
      </Collapse>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invoice Detail (expanded panel)
// ---------------------------------------------------------------------------

function InvoiceDetail({ action }) {
  const [ranking, setRanking] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await getInvoiceRanking(action.targetObjectId);
        if (!cancelled) setRanking(data);
      } catch { /* non-critical */ }
      finally { if (!cancelled) setLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, [action.targetObjectId]);

  const candidates = ranking?.candidates || [];
  const survival = ranking?.survivalInfo;
  const params = action.parameters || {};

  return (
    <div className="px-5 pb-5">
      <Card className="overflow-hidden">
        <div className="p-5 grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Candidate ranking */}
          <div className="lg:col-span-2">
            <div className="text-2xs uppercase tracking-[0.1em] text-text-tertiary font-medium mb-3">
              Action candidates
            </div>
            {loading ? (
              <div className="space-y-2">
                <SkeletonRow />
                <SkeletonRow />
              </div>
            ) : candidates.length === 0 ? (
              <div className="text-xs text-text-tertiary">No candidates available</div>
            ) : (
              <StaggerList className="space-y-1" stagger={0.03}>
                {candidates.map((c) => (
                  <div
                    key={c.variantId}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 rounded-md text-xs transition-colors',
                      c.blocked ? 'opacity-30 line-through' : '',
                      c.rank === 1 && !c.blocked ? 'bg-accent/5 ring-1 ring-accent/10' : 'hover:bg-surface-2/40',
                    )}
                  >
                    <span className="w-5 font-mono text-text-tertiary text-right tabular-nums">{c.rank}</span>
                    <ActionChip actionClass={c.actionClass} />
                    <span className="text-text-secondary flex-1 truncate">{c.description}</span>
                    <span className="font-mono tabular-nums text-text-primary font-semibold">
                      {(c.value?.totalValue ?? c.value ?? 0).toFixed(3)}
                    </span>
                    {c.blocked && <Badge variant="destructive">blocked</Badge>}
                    {c.requiresApproval && !c.blocked && <Badge variant="warning">approval</Badge>}
                  </div>
                ))}
              </StaggerList>
            )}
          </div>

          {/* Survival + details */}
          <div className="space-y-5">
            <div>
              <div className="text-2xs uppercase tracking-[0.1em] text-text-tertiary font-medium mb-3">
                Payment forecast
              </div>
              <SurvivalBars survival={survival} />
            </div>

            <div className="border-t border-edge-subtle pt-4">
              <div className="text-2xs uppercase tracking-[0.1em] text-text-tertiary font-medium mb-2">
                Details
              </div>
              <dl className="space-y-2 text-xs">
                {[
                  ['Amount', formatMoneyFull(params.amountCents)],
                  ['Remaining', formatMoneyFull(params.amountRemainingCents)],
                  ['Overdue', formatDays(params.daysOverdue)],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <dt className="text-text-tertiary">{k}</dt>
                    <dd className="font-mono tabular-nums text-text-primary">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>

        {/* Reasoning footer */}
        {action.reasoning?.length > 0 && (
          <div className="border-t border-edge-subtle px-5 py-3 bg-surface-0/40">
            <div className="text-2xs text-text-tertiary space-y-0.5">
              {action.reasoning.map((r, i) => <div key={i}>{r}</div>)}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

const SORT_OPTIONS = [
  { id: 'priority', label: 'Urgency' },
  { id: 'amount', label: 'Amount' },
  { id: 'overdue', label: 'Days overdue' },
];

const RISK_LEVELS = ['all', 'low', 'medium', 'high'];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export default function PriorityQueue() {
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [sortBy, setSortBy] = useState('priority');
  const [filterRisk, setFilterRisk] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await getNBAPlan();
        if (!cancelled) { setPlan(data); setError(''); }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Failed to load priority queue');
          toast.error('Failed to load priority queue');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const actions = useMemo(() => {
    if (!plan?.actions) return [];
    let items = [...plan.actions];

    if (filterRisk !== 'all') {
      items = items.filter((a) => {
        const days = a.parameters?.daysOverdue || 0;
        if (filterRisk === 'low') return days < 7;
        if (filterRisk === 'medium') return days >= 7 && days < 30;
        if (filterRisk === 'high') return days >= 30;
        return true;
      });
    }

    if (sortBy === 'amount') items.sort((a, b) => (b.parameters?.amountCents || 0) - (a.parameters?.amountCents || 0));
    else if (sortBy === 'overdue') items.sort((a, b) => (b.parameters?.daysOverdue || 0) - (a.parameters?.daysOverdue || 0));

    return items;
  }, [plan, sortBy, filterRisk]);

  if (loading) {
    return (
      <div className="space-y-1 rounded-lg border border-edge overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)}
      </div>
    );
  }

  return (
    <div>
      {error && (
        <FadeIn>
          <div className="mb-4 rounded-lg border border-status-blocked/20 bg-status-blocked/5 px-4 py-3 text-sm text-status-blocked">
            {error}
          </div>
        </FadeIn>
      )}

      {/* Controls */}
      <FadeIn className="flex items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <span className="text-sm text-text-secondary font-medium">
            {actions.length} invoice{actions.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Risk filter pills */}
          <div className="flex rounded-md border border-edge overflow-hidden">
            {RISK_LEVELS.map((level) => (
              <button
                key={level}
                onClick={() => setFilterRisk(level)}
                className={cn(
                  'px-3 py-1.5 text-2xs font-medium transition-colors border-r border-edge last:border-r-0',
                  filterRisk === level
                    ? 'bg-surface-3 text-text-primary'
                    : 'text-text-tertiary hover:text-text-secondary hover:bg-surface-2/40',
                )}
              >
                {level === 'all' ? 'All' : level.charAt(0).toUpperCase() + level.slice(1)}
              </button>
            ))}
          </div>

          {/* Sort select */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="h-7 px-3 text-2xs bg-surface-1 border border-edge rounded-md text-text-secondary focus:outline-none focus:ring-1 focus:ring-accent/50"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>Sort: {opt.label}</option>
            ))}
          </select>
        </div>
      </FadeIn>

      {/* Column header */}
      <div className="flex items-center gap-3 px-5 py-2 text-2xs uppercase tracking-[0.1em] text-text-tertiary font-medium border-b border-edge">
        <span className="w-6 text-right">#</span>
        <span className="w-36">Invoice</span>
        <span className="w-24 text-right">Amount</span>
        <span className="w-28">Status</span>
        <span className="flex-1 min-w-28 max-w-44">P(pay)</span>
        <span className="w-20">Action</span>
        <span className="hidden xl:block w-60">Signals</span>
        <span className="w-4" />
      </div>

      {/* Invoice list */}
      {actions.length === 0 ? (
        <EmptyState
          title="No actionable invoices"
          description={plan ? 'All invoices are either paid or not yet overdue.' : 'Connect Stripe and run a scan to populate the collection queue.'}
          action={!plan && <Button size="sm" variant="outline">Connect Stripe</Button>}
          className="mt-2"
        />
      ) : (
        <div className="rounded-lg border border-edge overflow-hidden mt-1 bg-surface-1/20">
          {actions.map((action, i) => (
            <InvoiceRow
              key={action.id}
              action={action}
              rank={i + 1}
              expanded={expandedId === action.id}
              onToggle={() => setExpandedId(expandedId === action.id ? null : action.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
