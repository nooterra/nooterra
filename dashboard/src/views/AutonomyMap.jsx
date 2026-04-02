/**
 * Autonomy Map — trust is not a number, it's a map.
 *
 * Visual grid: agents (rows) × action classes (columns).
 * Each cell shows the current autonomy level with evidence strength.
 * Click any cell to see the full evidence trail.
 */

import { useState } from 'react';
import { ChevronRight, TrendingUp, TrendingDown, Shield, X } from 'lucide-react';

// ---------------------------------------------------------------------------
// Autonomy level colors and labels
// ---------------------------------------------------------------------------

const LEVEL_CONFIG = {
  forbidden: {
    bg: 'bg-surface-3',
    border: 'border-edge',
    text: 'text-text-tertiary',
    dot: 'bg-text-tertiary',
    label: 'Forbidden',
    shortLabel: 'F',
  },
  human_approval: {
    bg: 'bg-status-blocked-muted',
    border: 'border-status-blocked/20',
    text: 'text-status-blocked',
    dot: 'bg-status-blocked',
    label: 'Human approval',
    shortLabel: 'H',
  },
  auto_with_review: {
    bg: 'bg-status-attention-muted',
    border: 'border-status-attention/20',
    text: 'text-status-attention',
    dot: 'bg-status-attention',
    label: 'Auto + review',
    shortLabel: 'R',
  },
  autonomous: {
    bg: 'bg-status-healthy-muted',
    border: 'border-status-healthy/20',
    text: 'text-status-healthy',
    dot: 'bg-status-healthy',
    label: 'Autonomous',
    shortLabel: 'A',
  },
};

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const AGENTS = [
  { id: 'collections', name: 'Collections Agent' },
  { id: 'support', name: 'Support Agent' },
  { id: 'scheduling', name: 'Scheduling Agent' },
];

const ACTION_CLASSES = [
  'communicate.email',
  'financial.invoice.read',
  'data.read',
  'task.create',
  'schedule.create',
  'financial.payment.initiate',
];

const MOCK_COVERAGE = {
  'collections:communicate.email': { level: 'auto_with_review', executions: 52, procedural: 0.94, outcome: 0.87, incidents: 0, strength: 0.72, recommended: 'autonomous' },
  'collections:financial.invoice.read': { level: 'autonomous', executions: 187, procedural: 0.98, outcome: 0.95, incidents: 0, strength: 0.95 },
  'collections:data.read': { level: 'autonomous', executions: 203, procedural: 0.97, outcome: 0.93, incidents: 0, strength: 0.95 },
  'collections:task.create': { level: 'human_approval', executions: 8, procedural: 0.91, outcome: 0.75, incidents: 0, strength: 0.4 },
  'collections:schedule.create': { level: 'forbidden', executions: 0, procedural: 0, outcome: 0, incidents: 0, strength: 0 },
  'collections:financial.payment.initiate': { level: 'forbidden', executions: 0, procedural: 0, outcome: 0, incidents: 0, strength: 0 },
  'support:communicate.email': { level: 'human_approval', executions: 14, procedural: 0.88, outcome: 0.79, incidents: 1, strength: 0.35 },
  'support:data.read': { level: 'auto_with_review', executions: 45, procedural: 0.92, outcome: 0.86, incidents: 0, strength: 0.6 },
  'scheduling:schedule.create': { level: 'human_approval', executions: 6, procedural: 0.85, outcome: 0.7, incidents: 0, strength: 0.3 },
  'scheduling:communicate.email': { level: 'human_approval', executions: 3, procedural: 0.9, outcome: 0.8, incidents: 0, strength: 0.15 },
};

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function Cell({ agentId, actionClass, onSelect }) {
  const key = `${agentId}:${actionClass}`;
  const data = MOCK_COVERAGE[key];

  if (!data) {
    // No coverage data — empty cell
    return (
      <td className="p-1">
        <div className="h-10 rounded bg-surface-1 border border-edge-subtle" />
      </td>
    );
  }

  const config = LEVEL_CONFIG[data.level];
  // Brightness based on evidence strength
  const opacity = Math.max(0.3, data.strength);

  return (
    <td className="p-1">
      <button
        onClick={() => onSelect({ agentId, actionClass, ...data })}
        className={`w-full h-10 rounded border ${config.bg} ${config.border}
          hover:ring-1 hover:ring-accent/30 transition-all duration-100
          flex items-center justify-center gap-1.5 group`}
        style={{ opacity }}
        title={`${config.label} — ${data.executions} executions, ${(data.procedural * 100).toFixed(0)}% procedural`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
        <span className={`text-2xs font-mono font-medium ${config.text}`}>
          {data.executions > 0 ? data.executions : '—'}
        </span>
        {data.recommended && data.recommended !== data.level && (
          <TrendingUp size={10} className="text-status-healthy opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </button>
    </td>
  );
}

function DetailPanel({ selection, onClose }) {
  if (!selection) return null;

  const config = LEVEL_CONFIG[selection.level];

  return (
    <div className="animate-fade-in border-l border-edge bg-surface-1 p-5 w-80 flex-shrink-0 overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-text-primary">Coverage Detail</h3>
        <button onClick={onClose} className="text-text-tertiary hover:text-text-secondary">
          <X size={14} />
        </button>
      </div>

      <div className="space-y-4">
        {/* Agent + Action */}
        <div>
          <span className="text-2xs text-text-tertiary uppercase tracking-wider">Agent</span>
          <p className="text-sm text-text-primary mt-0.5">
            {AGENTS.find(a => a.id === selection.agentId)?.name}
          </p>
        </div>
        <div>
          <span className="text-2xs text-text-tertiary uppercase tracking-wider">Action class</span>
          <p className="text-sm text-text-primary font-mono mt-0.5">{selection.actionClass}</p>
        </div>

        {/* Current level */}
        <div className={`p-3 rounded border ${config.bg} ${config.border}`}>
          <span className="text-2xs uppercase tracking-wider opacity-70">Current level</span>
          <p className={`text-sm font-medium mt-0.5 ${config.text}`}>{config.label}</p>
        </div>

        {/* Evidence */}
        <div className="space-y-2">
          <span className="text-2xs text-text-tertiary uppercase tracking-wider">Evidence</span>
          <div className="grid grid-cols-2 gap-2">
            <div className="p-2 rounded bg-surface-2">
              <span className="text-2xs text-text-tertiary">Executions</span>
              <p className="text-lg font-mono font-semibold text-text-primary">{selection.executions}</p>
            </div>
            <div className="p-2 rounded bg-surface-2">
              <span className="text-2xs text-text-tertiary">Incidents</span>
              <p className={`text-lg font-mono font-semibold ${selection.incidents > 0 ? 'text-status-blocked' : 'text-text-primary'}`}>
                {selection.incidents}
              </p>
            </div>
          </div>

          {/* Score bars */}
          <div className="space-y-2 mt-3">
            <ScoreBar label="Procedural" value={selection.procedural} threshold={0.85} />
            <ScoreBar label="Outcome" value={selection.outcome} threshold={0.75} />
            <ScoreBar label="Evidence" value={selection.strength} threshold={0.5} />
          </div>
        </div>

        {/* Recommendation */}
        {selection.recommended && selection.recommended !== selection.level && (
          <div className="p-3 rounded border border-status-healthy/20 bg-status-healthy-muted">
            <div className="flex items-center gap-1.5 mb-1">
              <TrendingUp size={12} className="text-status-healthy" />
              <span className="text-xs font-medium text-status-healthy">Promotion recommended</span>
            </div>
            <p className="text-xs text-text-secondary">
              {selection.executions} executions with {(selection.procedural * 100).toFixed(0)}% procedural score.
              Recommending: {LEVEL_CONFIG[selection.recommended]?.label}.
            </p>
            <button className="mt-2 text-xs font-medium text-status-healthy hover:underline">
              Approve promotion
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ScoreBar({ label, value, threshold }) {
  const pct = (value * 100).toFixed(0);
  const meetsThreshold = value >= threshold;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-2xs text-text-tertiary">{label}</span>
        <span className={`text-2xs font-mono font-medium ${meetsThreshold ? 'text-status-healthy' : 'text-text-secondary'}`}>
          {pct}%
        </span>
      </div>
      <div className="h-1 bg-surface-3 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${meetsThreshold ? 'bg-status-healthy' : 'bg-text-tertiary'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main View
// ---------------------------------------------------------------------------

export default function AutonomyMap() {
  const [selection, setSelection] = useState(null);

  const shortActionClass = (ac) => ac.split('.').pop();

  return (
    <div className="flex h-[calc(100vh-3rem)]">
      <div className="flex-1 overflow-auto p-5">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-lg font-semibold text-text-primary">Autonomy Map</h1>
            <p className="text-sm text-text-secondary mt-0.5">
              Trust earned from evidence. Click any cell for details.
            </p>
          </div>
          <div className="flex items-center gap-4">
            {Object.entries(LEVEL_CONFIG).map(([level, config]) => (
              <div key={level} className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-sm ${config.dot}`} />
                <span className="text-2xs text-text-tertiary">{config.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="text-left p-1 pb-2">
                  <span className="text-2xs font-medium text-text-tertiary uppercase tracking-wider">Agent</span>
                </th>
                {ACTION_CLASSES.map(ac => (
                  <th key={ac} className="p-1 pb-2 text-center min-w-[80px]">
                    <span className="text-2xs font-mono text-text-tertiary">{shortActionClass(ac)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {AGENTS.map(agent => (
                <tr key={agent.id}>
                  <td className="p-1 pr-3">
                    <span className="text-sm text-text-primary whitespace-nowrap">{agent.name}</span>
                  </td>
                  {ACTION_CLASSES.map(ac => (
                    <Cell
                      key={`${agent.id}:${ac}`}
                      agentId={agent.id}
                      actionClass={ac}
                      onSelect={setSelection}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail panel */}
      {selection && <DetailPanel selection={selection} onClose={() => setSelection(null)} />}
    </div>
  );
}
