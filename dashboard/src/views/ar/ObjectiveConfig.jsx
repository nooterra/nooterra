import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button.jsx';
import { Card } from '../../components/ui/card.jsx';
import { Badge } from '../../components/ui/badge.jsx';
import { FadeIn, StaggerList } from '../../components/ui/stagger.jsx';
import { Skeleton } from '../../components/ui/skeleton.jsx';
import { worldApi } from '../../lib/world-api.js';
import { cn } from '../../lib/utils.js';

const TEMPLATES = [
  {
    id: 'aggressive',
    name: 'Aggressive recovery',
    description: 'Maximize cash with frequent outreach. Best for high-volume, low-touch.',
    weights: { cash_acceleration: 0.55, dispute_minimization: 0.15, churn_minimization: 0.10, review_load_minimization: 0.10, relationship_preservation: 0.10 },
  },
  {
    id: 'balanced',
    name: 'Balanced',
    description: 'Balance cash recovery with relationship health. The default.',
    weights: { cash_acceleration: 0.40, dispute_minimization: 0.20, churn_minimization: 0.20, review_load_minimization: 0.10, relationship_preservation: 0.10 },
  },
  {
    id: 'relationship_first',
    name: 'Relationship first',
    description: 'Prioritize retention over immediate recovery. High-value accounts.',
    weights: { cash_acceleration: 0.25, dispute_minimization: 0.20, churn_minimization: 0.30, review_load_minimization: 0.05, relationship_preservation: 0.20 },
  },
];

const OBJECTIVE_LABELS = {
  cash_acceleration: 'Cash acceleration',
  dispute_minimization: 'Dispute avoidance',
  churn_minimization: 'Churn prevention',
  review_load_minimization: 'Review load',
  relationship_preservation: 'Relationship',
};

function WeightSlider({ id, label, value, onChange }) {
  return (
    <div className="flex items-center gap-4 group">
      <div className="w-36 text-sm text-text-secondary group-hover:text-text-primary transition-colors">{label}</div>
      <div className="flex-1 relative">
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(value * 100)}
          onChange={(e) => onChange(id, Number(e.target.value) / 100)}
          className="w-full h-1.5 appearance-none bg-surface-3 rounded-full accent-accent cursor-pointer"
        />
      </div>
      <span className="w-12 text-right text-sm font-mono tabular-nums text-text-primary font-medium">
        {Math.round(value * 100)}%
      </span>
    </div>
  );
}

export default function ObjectiveConfig() {
  const [objectives, setObjectives] = useState(null);
  const [weights, setWeights] = useState({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTemplate, setActiveTemplate] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await worldApi('/v1/world/objectives');
        if (!cancelled) {
          setObjectives(data);
          const w = {};
          for (const obj of (data.objectives || [])) w[obj.id] = obj.weight;
          setWeights(w);
          // Detect which template matches
          for (const t of TEMPLATES) {
            const match = Object.entries(t.weights).every(([k, v]) => Math.abs((w[k] || 0) - v) < 0.02);
            if (match) { setActiveTemplate(t.id); break; }
          }
        }
      } catch { /* handled */ }
      finally { if (!cancelled) setLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  function handleWeightChange(id, value) {
    setWeights((prev) => ({ ...prev, [id]: value }));
    setActiveTemplate(null);
  }

  function applyTemplate(template) {
    setWeights({ ...template.weights });
    setActiveTemplate(template.id);
  }

  async function handleSave() {
    if (!objectives) return;
    setSaving(true);
    try {
      await worldApi('/v1/world/objectives', {
        method: 'PUT',
        body: {
          tenantId: objectives.tenantId,
          objectives: objectives.objectives.map((obj) => ({ ...obj, weight: weights[obj.id] ?? obj.weight })),
          constraints: objectives.constraints || [],
        },
      });
      toast.success('Strategy weights saved');
    } catch (err) {
      toast.error(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  const totalWeight = Object.values(weights).reduce((s, v) => s + v, 0);
  const isValid = Math.abs(totalWeight - 1.0) < 0.02;

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
        </div>
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Strategy templates */}
      <FadeIn>
        <div className="text-2xs uppercase tracking-[0.1em] text-text-tertiary font-medium mb-3">
          Strategy presets
        </div>
        <StaggerList className="grid grid-cols-1 md:grid-cols-3 gap-3" stagger={0.04}>
          {TEMPLATES.map((template) => (
            <button
              key={template.id}
              onClick={() => applyTemplate(template)}
              className={cn(
                'text-left p-4 rounded-lg border transition-all duration-150',
                activeTemplate === template.id
                  ? 'border-accent/40 bg-accent/[0.04] ring-1 ring-accent/20'
                  : 'border-edge hover:border-edge-strong hover:bg-surface-2/30',
              )}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-medium text-text-primary">{template.name}</span>
                {activeTemplate === template.id && <Badge variant="default">Active</Badge>}
              </div>
              <p className="text-2xs text-text-tertiary leading-relaxed">{template.description}</p>
            </button>
          ))}
        </StaggerList>
      </FadeIn>

      {/* Weight sliders */}
      <FadeIn delay={0.15}>
        <Card>
          <div className="p-5">
            <div className="text-2xs uppercase tracking-[0.1em] text-text-tertiary font-medium mb-5">
              Objective weights
            </div>
            <div className="space-y-5">
              {Object.entries(OBJECTIVE_LABELS).map(([id, label]) => (
                <WeightSlider key={id} id={id} label={label} value={weights[id] ?? 0} onChange={handleWeightChange} />
              ))}
            </div>

            <div className="flex items-center justify-between mt-6 pt-4 border-t border-edge-subtle">
              <div className="flex items-center gap-3">
                <span className={cn(
                  'text-xs font-mono tabular-nums',
                  isValid ? 'text-text-secondary' : 'text-status-blocked',
                )}>
                  Total: {Math.round(totalWeight * 100)}%
                </span>
                {!isValid && <Badge variant="destructive">Must sum to 100%</Badge>}
              </div>
              <Button onClick={handleSave} disabled={saving || !isValid} size="sm">
                {saving ? 'Saving...' : 'Save weights'}
              </Button>
            </div>
          </div>
        </Card>
      </FadeIn>
    </div>
  );
}
