import { useState, useEffect } from 'react';
import { Card } from '../../components/ui/card.jsx';
import { EmptyState } from '../../components/ui/empty-state.jsx';
import { SkeletonCard } from '../../components/ui/skeleton.jsx';
import { FadeIn } from '../../components/ui/stagger.jsx';
import { AnimatedMoney } from '../../components/ui/animated-number.jsx';
import { getWorldStats, formatMoney } from '../../lib/ar-api.js';

function HorizonCard({ label, amount, low, high, confidence, delay = 0 }) {
  const range = high - low;
  const amountInRange = range > 0 ? Math.max(0, Math.min(1, (amount - low) / range)) : 0.5;

  return (
    <FadeIn delay={delay}>
      <Card>
        <div className="p-5">
          <div className="text-2xs uppercase tracking-[0.1em] text-text-tertiary font-medium mb-2">{label}</div>
          <div className="text-2xl font-mono tabular-nums font-semibold text-text-primary leading-none">
            <AnimatedMoney cents={amount} />
          </div>

          {(low > 0 || high > 0) && (
            <div className="mt-5">
              <div className="flex items-center justify-between text-2xs text-text-tertiary mb-2">
                <span>{formatMoney(low)}</span>
                <span>{formatMoney(high)}</span>
              </div>
              <div className="h-2.5 rounded-full bg-surface-3 relative overflow-hidden">
                <div
                  className="absolute top-0 h-full rounded-full transition-all duration-700"
                  style={{ left: '8%', right: '8%', background: 'var(--tw-color-accent, #4f8ff7)', opacity: 0.15 }}
                />
                <div
                  className="absolute top-0 h-full w-1.5 rounded-full transition-all duration-700"
                  style={{ left: `${8 + amountInRange * 84}%`, background: 'var(--tw-color-accent, #4f8ff7)' }}
                />
              </div>
            </div>
          )}

          {confidence != null && (
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-edge-subtle">
              <span className="text-2xs text-text-tertiary">Confidence</span>
              <span className="text-xs font-mono tabular-nums text-text-secondary">{Math.round(confidence * 100)}%</span>
            </div>
          )}
        </div>
      </Card>
    </FadeIn>
  );
}

export default function Forecast() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await getWorldStats();
        if (!cancelled) { setStats(data); setError(''); }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load forecast');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
    );
  }

  const hasData = stats?.counts?.invoice > 0;

  if (!hasData) {
    return (
      <EmptyState
        title="Forecast unavailable"
        description="The survival model needs resolved invoice outcomes to generate cash flow predictions. Forecasts will appear once the system has observed enough payment events."
      />
    );
  }

  // Placeholder forecasts — will be replaced by /v1/ar/forecast
  const forecasts = [
    { label: 'Next 7 days', amount: 0, low: 0, high: 0, confidence: null },
    { label: 'Next 30 days', amount: 0, low: 0, high: 0, confidence: null },
    { label: 'Next 90 days', amount: 0, low: 0, high: 0, confidence: null },
  ];

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-status-blocked/20 bg-status-blocked/5 px-4 py-3 text-sm text-status-blocked">{error}</div>
      )}

      <FadeIn>
        <p className="text-sm text-text-secondary">
          Predicted cash inflows based on the survival model and current invoice portfolio.
        </p>
      </FadeIn>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {forecasts.map((f, i) => (
          <HorizonCard key={f.label} {...f} delay={0.05 + i * 0.05} />
        ))}
      </div>

      <FadeIn delay={0.25}>
        <Card>
          <div className="p-5">
            <div className="text-2xs uppercase tracking-[0.1em] text-text-tertiary font-medium mb-3">
              How this works
            </div>
            <div className="space-y-2 text-xs text-text-secondary leading-relaxed">
              <p>
                Each forecast combines individual invoice survival predictions into an aggregate cash inflow estimate.
                The confidence interval widens for longer horizons.
              </p>
              <p>
                The model handles censored observations (invoices not yet resolved) and distinguishes between
                payment, write-off, and cancellation outcomes.
              </p>
            </div>
          </div>
        </Card>
      </FadeIn>
    </div>
  );
}
