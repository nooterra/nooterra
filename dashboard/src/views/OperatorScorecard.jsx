import { useState, useEffect } from 'react';
import { worldApi } from '../lib/world-api';

function MetricCard({ label, value, subtitle }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 8,
      padding: '16px 20px',
      minWidth: 160,
    }}>
      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {subtitle && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>{subtitle}</div>}
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
        if (!cancelled) setScorecard(data);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  if (loading) return <div style={{ padding: 32, color: 'rgba(255,255,255,0.5)' }}>Loading scorecard...</div>;
  if (error) return <div style={{ padding: 32, color: '#f87171' }}>Error: {error}</div>;
  if (!scorecard) return null;

  const { summary, outcomes, modeledContribution } = scorecard;

  return (
    <div style={{ padding: 32, maxWidth: 900 }}>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Judgment Scorecard</h2>
      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 24 }}>
        Last 30 days — {new Date(scorecard.generatedAt).toLocaleString()}
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 32 }}>
        <MetricCard label="Total Actions" value={summary.totalActions} />
        <MetricCard label="Strategic Holds" value={summary.totalHolds} subtitle={formatRate(summary.holdRate)} />
        <MetricCard label="Human Overrides" value={summary.totalOverrides} subtitle={formatRate(summary.overrideRate)} />
      </div>

      <h3 style={{ fontSize: 16, fontWeight: 500, marginBottom: 12 }}>Outcomes</h3>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 32 }}>
        <MetricCard label="Observed" value={outcomes.observed} />
        <MetricCard label="Pending" value={outcomes.pending} />
        <MetricCard label="Objectives Achieved" value={outcomes.objectivesAchieved} subtitle={formatRate(outcomes.objectivesAchievedRate)} />
      </div>

      <h3 style={{ fontSize: 16, fontWeight: 500, marginBottom: 12 }}>Modeled Contribution</h3>
      <div style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 8,
        padding: 20,
        color: 'rgba(255,255,255,0.5)',
        fontSize: 13,
      }}>
        {modeledContribution.available
          ? 'Modeled incremental contribution data will appear here.'
          : modeledContribution.note}
      </div>
    </div>
  );
}
