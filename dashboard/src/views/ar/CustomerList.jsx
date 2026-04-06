import { useState, useEffect, useMemo } from 'react';
import { Badge } from '../../components/ui/badge.jsx';
import { EmptyState } from '../../components/ui/empty-state.jsx';
import { Button } from '../../components/ui/button.jsx';
import { SkeletonRow } from '../../components/ui/skeleton.jsx';
import { FadeIn, StaggerList } from '../../components/ui/stagger.jsx';
import { StatusBar } from '../../components/ui/progress-bar.jsx';
import { getCustomers, formatMoney } from '../../lib/ar-api.js';
import { cn } from '../../lib/utils.js';

function reliabilityBadge(score) {
  if (score >= 0.7) return { variant: 'success', label: 'Reliable' };
  if (score >= 0.4) return { variant: 'warning', label: 'Mixed' };
  return { variant: 'destructive', label: 'At risk' };
}

function trendLabel(slope) {
  if (slope < -0.5) return { text: 'Faster', cls: 'text-status-healthy' };
  if (slope > 0.5) return { text: 'Slower', cls: 'text-status-blocked' };
  return { text: 'Stable', cls: 'text-text-tertiary' };
}

export default function CustomerList() {
  const [customers, setCustomers] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState('reliability');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await getCustomers({ limit: 200 });
        if (!cancelled) {
          setCustomers(Array.isArray(data) ? data : data.objects || []);
          setError('');
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load customers');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  function handleSort(key) {
    if (sortKey === key) setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  const sorted = useMemo(() => {
    const items = customers.map((c) => ({
      id: c.id,
      name: (c.state || {}).name || c.id,
      type: (c.state || {}).type || 'customer',
      reliability: Number((c.estimated || {}).paymentReliability || 0.5),
      churnRisk: Number((c.estimated || {}).churnRisk || 0),
      daysToPaySlope: Number((c.estimated || {}).daysToPaySlope || 0),
    }));
    items.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortKey === 'reliability') cmp = a.reliability - b.reliability;
      else if (sortKey === 'trend') cmp = a.daysToPaySlope - b.daysToPaySlope;
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return items;
  }, [customers, sortKey, sortDir]);

  if (loading) {
    return (
      <div className="rounded-lg border border-edge overflow-hidden">
        {Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)}
      </div>
    );
  }

  const columns = [
    { key: 'name', label: 'Customer', w: 'flex-1 text-left' },
    { key: 'reliability', label: 'Reliability', w: 'w-32 text-center' },
    { key: 'trend', label: 'Pay trend', w: 'w-24 text-center' },
  ];

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-lg border border-status-blocked/20 bg-status-blocked/5 px-4 py-3 text-sm text-status-blocked">{error}</div>
      )}

      <FadeIn className="flex items-baseline justify-between mb-4">
        <span className="text-sm text-text-secondary font-medium">{sorted.length} customers</span>
      </FadeIn>

      {sorted.length === 0 ? (
        <EmptyState
          title="No customers yet"
          description="Connect Stripe to import customer data and start building payment profiles."
          action={<Button size="sm" variant="outline">Connect Stripe</Button>}
        />
      ) : (
        <div className="rounded-lg border border-edge overflow-hidden">
          {/* Header */}
          <div className="flex items-center bg-surface-2/30 border-b border-edge px-5 py-2.5">
            {columns.map((col) => (
              <button
                key={col.key}
                onClick={() => handleSort(col.key)}
                className={cn(
                  'text-2xs uppercase tracking-[0.1em] text-text-tertiary hover:text-text-secondary transition-colors font-medium',
                  col.w,
                )}
              >
                {col.label}
                {sortKey === col.key && (
                  <span className="ml-1 opacity-50">{sortDir === 'desc' ? '\u2193' : '\u2191'}</span>
                )}
              </button>
            ))}
          </div>

          <StaggerList stagger={0.02}>
            {sorted.map((customer, i) => {
              const rel = reliabilityBadge(customer.reliability);
              const trend = trendLabel(customer.daysToPaySlope);
              return (
                <div
                  key={customer.id}
                  className="flex items-center px-5 py-3 border-b border-edge last:border-b-0 hover:bg-surface-2/30 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-text-primary truncate">{customer.name}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <StatusBar value={customer.reliability} status={customer.reliability >= 0.7 ? 'success' : customer.reliability >= 0.4 ? 'warning' : 'danger'} className="w-16" />
                      <span className="text-2xs font-mono tabular-nums text-text-tertiary">{Math.round(customer.reliability * 100)}%</span>
                    </div>
                  </div>
                  <div className="w-32 flex justify-center">
                    <Badge variant={rel.variant}>{rel.label}</Badge>
                  </div>
                  <div className="w-24 text-center">
                    <span className={cn('text-xs font-medium', trend.cls)}>{trend.text}</span>
                  </div>
                </div>
              );
            })}
          </StaggerList>
        </div>
      )}
    </div>
  );
}
