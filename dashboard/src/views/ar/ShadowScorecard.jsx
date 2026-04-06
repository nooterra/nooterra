import { useState, useEffect } from 'react';
import { Card } from '../../components/ui/card.jsx';
import { Badge } from '../../components/ui/badge.jsx';
import { EmptyState } from '../../components/ui/empty-state.jsx';
import { MetricCard } from '../../components/ui/metric-card.jsx';
import { Skeleton, SkeletonCard } from '../../components/ui/skeleton.jsx';
import { FadeIn, StaggerList } from '../../components/ui/stagger.jsx';
import { AnimatedMoney, AnimatedPercent } from '../../components/ui/animated-number.jsx';
import { worldApi } from '../../lib/world-api.js';
import { formatMoney, formatPercent } from '../../lib/ar-api.js';

async function getShadowScorecard() {
  return worldApi('/v1/world/shadow-scorecard');
}

export default function ShadowScorecard() {
  const [scorecard, setScorecard] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await getShadowScorecard();
        if (!cancelled) { setScorecard(data); setError(''); }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load shadow scorecard');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <SkeletonCard />
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-status-blocked/20 bg-status-blocked/5 px-4 py-3 text-sm text-status-blocked">
        {error}
      </div>
    );
  }

  const s = scorecard;
  const hasData = s && s.totalRecommendations > 0;

  if (!hasData) {
    return (
      <EmptyState
        title="Shadow scorecard is building"
        description="The system is observing your invoices and making recommendations in the background. Once enough outcomes are resolved, you'll see counterfactual recovery estimates here."
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Hero — the gut punch number */}
      {s.estimatedUpliftCents > 0 && (
        <FadeIn>
          <div className="rounded-lg border border-accent/20 bg-accent/[0.03] p-8">
            <div className="text-2xs uppercase tracking-[0.12em] text-accent/60 font-medium mb-3">
              Estimated additional recovery
            </div>
            <div className="text-4xl font-mono tabular-nums font-semibold text-accent leading-none">
              <AnimatedMoney cents={s.estimatedUpliftCents} duration={1200} />
            </div>
            <p className="text-sm text-text-secondary mt-4 max-w-lg">
              Conservative estimate of cash you would have recovered by following system recommendations.
              Based on {s.resolvedRecommendations} resolved invoices over the last 30 days.
            </p>
          </div>
        </FadeIn>
      )}

      {/* Key metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Recommendations"
          value={s.totalRecommendations}
          detail={`${s.pendingRecommendations} pending`}
          delay={0.05}
        />
        <MetricCard
          label="Resolved"
          value={s.resolvedRecommendations}
          detail={`${s.invoicesActuallyPaid} paid`}
          status={s.invoicesActuallyPaid > 0 ? 'good' : undefined}
          delay={0.1}
        />
        <MetricCard
          label="Accuracy"
          value={<AnimatedPercent value={s.actionAccuracy} />}
          detail="Recommendation alignment"
          status={s.actionAccuracy > 0.7 ? 'good' : s.actionAccuracy > 0.5 ? 'warn' : 'bad'}
          delay={0.15}
        />
        <MetricCard
          label="Prediction error"
          value={s.avgPredictionError > 0 ? s.avgPredictionError.toFixed(3) : '\u2014'}
          detail="Mean absolute error"
          status={s.avgPredictionError < 0.15 ? 'good' : s.avgPredictionError < 0.3 ? 'warn' : 'bad'}
          delay={0.2}
        />
      </div>

      {/* Exposure breakdown */}
      <FadeIn delay={0.25}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <MetricCard
            label="Total exposure"
            value={<AnimatedMoney cents={s.totalExposureCents} />}
          />
          <MetricCard
            label="Actually recovered"
            value={<AnimatedMoney cents={s.recoveredCents} />}
            status="good"
          />
          <MetricCard
            label="Missed recovery"
            value={<AnimatedMoney cents={s.missedRecoveryCents} />}
            status={s.missedRecoveryCents > 0 ? 'bad' : undefined}
          />
        </div>
      </FadeIn>

      {/* By action breakdown */}
      {s.byAction?.length > 0 && (
        <FadeIn delay={0.3}>
          <Card>
            <div className="p-5">
              <div className="text-2xs uppercase tracking-[0.1em] text-text-tertiary font-medium mb-4">
                By recommended action
              </div>
              <StaggerList className="space-y-1" stagger={0.03}>
                {s.byAction.map((row) => (
                  <div key={row.actionClass} className="flex items-center gap-4 px-3 py-2.5 rounded-md hover:bg-surface-2/40 transition-colors">
                    <Badge variant="secondary" className="w-28 justify-center">{row.actionClass}</Badge>
                    <span className="text-xs text-text-secondary w-28">{row.recommended} recommended</span>
                    <span className="text-xs text-status-healthy w-16">{row.resolvedPaid} paid</span>
                    <span className="text-xs text-status-blocked w-16">{row.resolvedUnpaid} unpaid</span>
                    <div className="flex-1 flex items-center gap-4 text-2xs text-text-tertiary">
                      <span>Predicted: {formatPercent(row.avgPredictedProb)}</span>
                      <span>Actual: {formatPercent(row.avgActualRate)}</span>
                    </div>
                  </div>
                ))}
              </StaggerList>
            </div>
          </Card>
        </FadeIn>
      )}
    </div>
  );
}
