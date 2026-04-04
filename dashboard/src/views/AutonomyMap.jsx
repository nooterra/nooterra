import { useEffect, useMemo, useState } from 'react';
import { Shield, TrendingUp, X } from 'lucide-react';
import { getWorldOverview } from '../lib/world-api.js';

const LEVEL_CONFIG = {
  forbidden: {
    bg: 'bg-surface-3',
    border: 'border-edge',
    text: 'text-text-tertiary',
    dot: 'bg-text-tertiary',
    label: 'Forbidden',
  },
  human_approval: {
    bg: 'bg-status-blocked-muted',
    border: 'border-status-blocked/20',
    text: 'text-status-blocked',
    dot: 'bg-status-blocked',
    label: 'Human approval',
  },
  auto_with_review: {
    bg: 'bg-status-attention-muted',
    border: 'border-status-attention/20',
    text: 'text-status-attention',
    dot: 'bg-status-attention',
    label: 'Auto + review',
  },
  autonomous: {
    bg: 'bg-status-healthy-muted',
    border: 'border-status-healthy/20',
    text: 'text-status-healthy',
    dot: 'bg-status-healthy',
    label: 'Autonomous',
  },
};

function shortActionClass(value) {
  return String(value || '').split('.').slice(-1)[0] || value;
}

function EmptyState({ error }) {
  return (
    <div className="rounded-lg border border-edge bg-surface-1 p-6 text-center">
      <Shield size={18} className="mx-auto text-text-tertiary mb-2" />
      <p className="text-sm text-text-primary">{error || 'No autonomy evidence yet'}</p>
      <p className="text-xs text-text-secondary mt-1">
        Cells appear after governed executions are graded in the runtime.
      </p>
    </div>
  );
}

function DetailPanel({ selection, onClose }) {
  if (!selection) return null;
  const config = LEVEL_CONFIG[selection.currentLevel] || LEVEL_CONFIG.human_approval;

  return (
    <div className="animate-fade-in border-l border-edge bg-surface-1 p-5 w-80 flex-shrink-0 overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-text-primary">Coverage detail</h3>
        <button onClick={onClose} className="text-text-tertiary hover:text-text-secondary">
          <X size={14} />
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <span className="text-2xs text-text-tertiary uppercase tracking-wider">Agent</span>
          <p className="text-sm text-text-primary mt-1">{selection.agentId}</p>
        </div>
        <div>
          <span className="text-2xs text-text-tertiary uppercase tracking-wider">Action class</span>
          <p className="text-sm text-text-primary font-mono mt-1">{selection.actionClass}</p>
        </div>
        <div className={`p-3 rounded border ${config.bg} ${config.border}`}>
          <div className="text-2xs uppercase tracking-wider opacity-70">Current level</div>
          <div className={`text-sm font-medium mt-1 ${config.text}`}>{config.label}</div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="p-2 rounded bg-surface-2">
            <span className="text-2xs text-text-tertiary">Executions</span>
            <p className="text-lg font-mono font-semibold text-text-primary">{selection.totalExecutions}</p>
          </div>
          <div className="p-2 rounded bg-surface-2">
            <span className="text-2xs text-text-tertiary">Incidents</span>
            <p className="text-lg font-mono font-semibold text-text-primary">{selection.incidentCount}</p>
          </div>
        </div>
        <div className="space-y-2">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-2xs text-text-tertiary">Procedural</span>
              <span className="text-2xs font-mono text-text-primary">{Math.round(selection.avgProceduralScore * 100)}%</span>
            </div>
            <div className="h-1 bg-surface-3 rounded-full overflow-hidden">
              <div className="h-full bg-status-healthy rounded-full" style={{ width: `${Math.round(selection.avgProceduralScore * 100)}%` }} />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-2xs text-text-tertiary">Outcome</span>
              <span className="text-2xs font-mono text-text-primary">{Math.round(selection.avgOutcomeScore * 100)}%</span>
            </div>
            <div className="h-1 bg-surface-3 rounded-full overflow-hidden">
              <div className="h-full bg-accent rounded-full" style={{ width: `${Math.round(selection.avgOutcomeScore * 100)}%` }} />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-2xs text-text-tertiary">Evidence strength</span>
              <span className="text-2xs font-mono text-text-primary">{Math.round(selection.evidenceStrength * 100)}%</span>
            </div>
            <div className="h-1 bg-surface-3 rounded-full overflow-hidden">
              <div className="h-full bg-status-predicted rounded-full" style={{ width: `${Math.round(selection.evidenceStrength * 100)}%` }} />
            </div>
          </div>
        </div>
        <div className="p-3 rounded border border-edge bg-surface-2">
          <div className="text-2xs text-text-tertiary uppercase tracking-wider">Recommendation</div>
          <div className="text-sm text-text-primary mt-1">{LEVEL_CONFIG[selection.recommendedLevel]?.label || selection.recommendedLevel}</div>
          <p className="text-xs text-text-secondary mt-2">{selection.requiredForPromotion}</p>
        </div>
      </div>
    </div>
  );
}

export default function AutonomyMap() {
  const [overview, setOverview] = useState(null);
  const [selection, setSelection] = useState(null);
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
        if (!cancelled) setError(err.message || 'Failed to load autonomy coverage');
      }
    }

    load();
    const interval = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const cells = overview?.coverage?.cells || [];
  const agents = useMemo(() => [...new Set(cells.map((cell) => cell.agentId))].sort(), [cells]);
  const actionClasses = useMemo(() => [...new Set(cells.map((cell) => cell.actionClass))].sort(), [cells]);
  const cellMap = useMemo(() => new Map(cells.map((cell) => [`${cell.agentId}:${cell.actionClass}`, cell])), [cells]);

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-auto p-5">
        <div className="flex items-center justify-between mb-6">
          <p className="text-sm text-text-secondary">
            Evidence from real graded executions, not synthetic trust scores.
          </p>
          <div className="flex items-center gap-4">
            {Object.entries(LEVEL_CONFIG).map(([level, config]) => (
              <div key={level} className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-sm ${config.dot}`} />
                <span className="text-2xs text-text-tertiary">{config.label}</span>
              </div>
            ))}
          </div>
        </div>

        {error ? (
          <EmptyState error={error} />
        ) : cells.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="text-left p-1 pb-2">
                    <span className="text-2xs font-medium text-text-tertiary uppercase tracking-wider">Agent</span>
                  </th>
                  {actionClasses.map((actionClass) => (
                    <th key={actionClass} className="p-1 pb-2 text-center min-w-[88px]">
                      <span className="text-2xs font-mono text-text-tertiary">{shortActionClass(actionClass)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {agents.map((agentId) => (
                  <tr key={agentId}>
                    <td className="p-1 pr-3">
                      <span className="text-sm text-text-primary whitespace-nowrap">{agentId}</span>
                    </td>
                    {actionClasses.map((actionClass) => {
                      const cell = cellMap.get(`${agentId}:${actionClass}`);
                      if (!cell) {
                        return (
                          <td key={`${agentId}:${actionClass}`} className="p-1">
                            <div className="h-10 rounded bg-surface-1 border border-edge-subtle" />
                          </td>
                        );
                      }

                      const config = LEVEL_CONFIG[cell.currentLevel] || LEVEL_CONFIG.human_approval;
                      return (
                        <td key={`${agentId}:${actionClass}`} className="p-1">
                          <button
                            onClick={() => setSelection(cell)}
                            className={`w-full h-10 rounded border ${config.bg} ${config.border} flex items-center justify-center gap-1.5`}
                            title={`${config.label} · ${cell.totalExecutions} executions`}
                            aria-label={`${agentId} / ${shortActionClass(actionClass)}: ${config.label}, ${cell.totalExecutions} executions`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
                            <span className={`text-2xs font-mono font-medium ${config.text}`}>{cell.totalExecutions}</span>
                            {cell.recommendedLevel !== cell.currentLevel ? (
                              <TrendingUp size={10} className="text-status-healthy" />
                            ) : null}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <DetailPanel selection={selection} onClose={() => setSelection(null)} />
    </div>
  );
}
