import { useEffect, useState } from 'react';
import { worldApi } from '../lib/world-api';

function MetricCard({ label, value, subtitle }) {
  return (
    <div className="bg-surface-1 border border-edge rounded-lg px-4 py-3 min-w-[140px]">
      <div className="text-2xs text-text-tertiary mb-1">{label}</div>
      <div className="text-xl font-semibold font-mono tabular-nums text-text-primary">{value}</div>
      {subtitle && <div className="text-2xs text-text-tertiary mt-1">{subtitle}</div>}
    </div>
  );
}

function EmptyBox({ status, explanation }) {
  return (
    <div className="bg-surface-1 border border-edge rounded-lg p-5 mb-8">
      {status && (
        <div className="text-xs font-medium text-text-secondary mb-1">{status}</div>
      )}
      <div className="text-text-tertiary text-xs leading-relaxed">{explanation}</div>
    </div>
  );
}

function formatRate(rate) {
  if (rate == null) return '\u2014';
  return `${(rate * 100).toFixed(1)}%`;
}

export default function OperatorScorecard() {
  const [scorecard, setScorecard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await worldApi('/v1/world/scorecard');
        if (!cancelled) {
          setScorecard(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const interval = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (loading) {
    return (
      <div className="h-full bg-surface-0 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-5 py-6">
          <div className="space-y-3">
            <div className="skeleton h-4 w-3/4"></div>
            <div className="skeleton h-3 w-1/2"></div>
            <div className="skeleton h-3 w-2/3"></div>
            <div className="skeleton h-8 w-full mt-4"></div>
            <div className="skeleton h-3 w-1/3"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full bg-surface-0 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-5 py-6">
          <p className="text-status-blocked text-sm">Error: {error}</p>
        </div>
      </div>
    );
  }

  if (!scorecard) return null;

  const { summary, outcomes } = scorecard;

  return (
    <div className="h-full bg-surface-0 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-5 py-6">

        <div className="mb-6">
          <h2 className="text-lg font-semibold text-text-primary">Judgment Scorecard</h2>
          <p className="text-2xs text-text-tertiary mt-1">
            Last 30 days — {new Date(scorecard.generatedAt).toLocaleString()}
          </p>
        </div>

        {/* Summary */}
        <div className="mb-8">
          <h3 className="text-sm font-medium text-text-primary mb-3">Summary</h3>
          <div className="flex flex-wrap gap-3">
            <MetricCard label="Total Actions" value={summary.totalActions} />
            <MetricCard
              label="Strategic Holds"
              value={summary.totalHolds}
              subtitle={formatRate(summary.holdRate)}
            />
            <MetricCard
              label="Human Overrides"
              value={summary.totalOverrides}
              subtitle={formatRate(summary.overrideRate)}
            />
          </div>
        </div>

        {/* Outcomes */}
        <div className="mb-8">
          <h3 className="text-sm font-medium text-text-primary mb-3">Outcomes</h3>
          <div className="flex flex-wrap gap-3">
            <MetricCard label="Observed" value={outcomes.observed} />
            <MetricCard label="Pending" value={outcomes.pending} />
            <MetricCard
              label="Objectives Achieved"
              value={outcomes.objectivesAchieved}
              subtitle={formatRate(outcomes.objectivesAchievedRate)}
            />
          </div>
        </div>

        {/* Uplift vs Heuristic */}
        <div className="mb-8">
          <h3 className="text-sm font-medium text-text-primary mb-3">Uplift vs Heuristic</h3>
          {scorecard.upliftComparison?.metrics ? (
            <div className="flex flex-wrap gap-3">
              {/* Real uplift metrics would go here when promoted */}
            </div>
          ) : (
            <EmptyBox
              status={
                scorecard.upliftComparison?.status === 'shadow_only'
                  ? 'Shadow Mode'
                  : scorecard.upliftComparison?.status
                  ? scorecard.upliftComparison.status
                  : 'Not Available'
              }
              explanation={scorecard.upliftComparison?.explanation}
            />
          )}
        </div>

        {/* Override Record */}
        <div className="mb-8">
          <h3 className="text-sm font-medium text-text-primary mb-3">Override Record</h3>
          <div className="flex flex-wrap gap-3 mb-2">
            <MetricCard label="Total Overrides" value={scorecard.overrideRecord?.total ?? 0} />
            {scorecard.overrideRecord?.humanBetter != null && (
              <MetricCard label="Human Better" value={scorecard.overrideRecord.humanBetter} />
            )}
            {scorecard.overrideRecord?.systemBetter != null && (
              <MetricCard label="System Better" value={scorecard.overrideRecord.systemBetter} />
            )}
          </div>
          {scorecard.overrideRecord?.humanBetter == null && scorecard.overrideRecord?.explanation && (
            <p className="text-2xs text-text-tertiary">{scorecard.overrideRecord.explanation}</p>
          )}
        </div>

        {/* Retraining */}
        <div className="mb-8">
          <h3 className="text-sm font-medium text-text-primary mb-3">Retraining</h3>
          {scorecard.retraining?.status === 'active' ? (
            <div className="flex flex-wrap gap-3">
              <MetricCard
                label="Last Retrained"
                value={new Date(scorecard.retraining.lastRetrainedAt).toLocaleDateString()}
              />
              <MetricCard label="Weeks Since" value={scorecard.retraining.weeksSinceRetrain} />
            </div>
          ) : (
            <EmptyBox
              explanation={scorecard.retraining?.explanation || 'No retraining has been performed yet.'}
            />
          )}
        </div>

        {/* Modeled Contribution */}
        <div className="mb-8">
          <h3 className="text-sm font-medium text-text-primary mb-3">Modeled Contribution</h3>
          {scorecard.modeledContribution?.metrics ? (
            <div className="flex flex-wrap gap-3">
              {/* Real modeled contribution would go here */}
            </div>
          ) : (
            <EmptyBox
              explanation={scorecard.modeledContribution?.explanation || 'Not yet available.'}
            />
          )}
        </div>

      </div>
    </div>
  );
}
