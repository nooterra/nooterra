import { useState, useEffect } from 'react';
import { Card, CardContent } from '../../components/ui/card.jsx';
import { MetricCard } from '../../components/ui/metric-card.jsx';
import { Badge } from '../../components/ui/badge.jsx';
import { EmptyState } from '../../components/ui/empty-state.jsx';
import { SkeletonCard } from '../../components/ui/skeleton.jsx';
import { FadeIn } from '../../components/ui/stagger.jsx';
import { AnimatedMoney, AnimatedPercent } from '../../components/ui/animated-number.jsx';
import { StatusBar } from '../../components/ui/progress-bar.jsx';
import { getScorecard, formatMoney } from '../../lib/ar-api.js';

export default function Performance() {
  const [scorecard, setScorecard] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await getScorecard();
        if (!cancelled) { setScorecard(data); setError(''); }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load performance data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
    );
  }

  const m = scorecard || {};
  const recovered = m.totalRecoveredCents || 0;
  const actionsExecuted = m.actionsExecuted || 0;
  const avgDtp = m.avgDaysToPay || 0;
  const autonomy = m.autonomousCoverage || 0;
  const accuracy = m.modelAccuracy || 0;
  const epochCount = m.epochCount || 0;
  const modelFamily = m.modelFamily || 'Rule inference';

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-status-blocked/20 bg-status-blocked/5 px-4 py-3 text-sm text-status-blocked">
          {error}
        </div>
      )}

      {/* Key metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Cash recovered"
          value={<AnimatedMoney cents={recovered} />}
          detail="Last 30 days"
          status={recovered > 0 ? 'good' : undefined}
          delay={0}
        />
        <MetricCard
          label="Actions taken"
          value={actionsExecuted}
          detail="Emails + escalations"
          status={actionsExecuted > 0 ? 'accent' : undefined}
          delay={0.05}
        />
        <MetricCard
          label="Avg days to pay"
          value={avgDtp > 0 ? `${Math.round(avgDtp)}d` : '\u2014'}
          detail="Across resolved invoices"
          status={avgDtp > 0 && avgDtp < 30 ? 'good' : avgDtp > 45 ? 'warn' : undefined}
          delay={0.1}
        />
        <MetricCard
          label="Autonomous coverage"
          value={autonomy > 0 ? <AnimatedPercent value={autonomy} /> : '\u2014'}
          detail="Actions without approval"
          status={autonomy > 0.5 ? 'good' : undefined}
          delay={0.15}
        />
      </div>

      {/* Model performance */}
      <FadeIn delay={0.2}>
        <Card>
          <div className="p-5">
            <div className="text-2xs uppercase tracking-[0.1em] text-text-tertiary font-medium mb-5">
              Model performance
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div>
                <div className="text-xs text-text-tertiary mb-1.5">Prediction accuracy</div>
                <div className="text-xl font-mono tabular-nums text-text-primary font-semibold">
                  {accuracy > 0 ? <AnimatedPercent value={accuracy} /> : 'Collecting data'}
                </div>
                {accuracy > 0 && (
                  <StatusBar
                    value={accuracy}
                    status={accuracy > 0.7 ? 'success' : accuracy > 0.5 ? 'warning' : 'danger'}
                    className="mt-2"
                  />
                )}
                <div className="text-2xs text-text-tertiary mt-2">Brier score on resolved predictions</div>
              </div>

              <div>
                <div className="text-xs text-text-tertiary mb-1.5">Training data</div>
                <div className="text-xl font-mono tabular-nums text-text-primary font-semibold">
                  {epochCount} <span className="text-sm text-text-secondary font-normal">epochs</span>
                </div>
                <div className="text-2xs text-text-tertiary mt-2">Point-in-time decision snapshots</div>
              </div>

              <div>
                <div className="text-xs text-text-tertiary mb-1.5">Active model</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-lg text-text-primary font-medium">{modelFamily}</span>
                  <Badge variant={modelFamily === 'catboost' ? 'success' : 'muted'}>
                    {modelFamily === 'catboost' ? 'ML' : modelFamily === 'logistic_regression' ? 'ML' : 'Rules'}
                  </Badge>
                </div>
                <div className="text-2xs text-text-tertiary mt-2">
                  {modelFamily === 'catboost' ? 'CatBoost with SHAP explanations' : 'Upgrading automatically as data grows'}
                </div>
              </div>
            </div>
          </div>
        </Card>
      </FadeIn>

      {/* Activity */}
      <FadeIn delay={0.25}>
        <Card>
          <div className="p-5">
            <div className="text-2xs uppercase tracking-[0.1em] text-text-tertiary font-medium mb-3">
              System status
            </div>
            {actionsExecuted === 0 ? (
              <EmptyState
                title="Observation mode"
                description="The system is watching your invoices and building prediction accuracy before recommending actions. This typically takes 2-4 weeks of data."
              />
            ) : (
              <p className="text-xs text-text-secondary">
                {actionsExecuted} actions executed across {epochCount} decision epochs.
                The system is actively learning from outcomes.
              </p>
            )}
          </div>
        </Card>
      </FadeIn>
    </div>
  );
}
