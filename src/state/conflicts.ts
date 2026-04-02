/**
 * Conflict Detection — finds and tracks contradictions between data sources.
 *
 * When multiple sources (Stripe, QuickBooks, Gmail) report different values
 * for the same field, a Conflict is created. Some auto-resolve (newer wins).
 * Others require domain logic or human resolution.
 */

export interface Conflict {
  id: string;
  objectId: string;
  objectType: string;
  field: string;
  values: ConflictValue[];
  autoResolvable: boolean;
  suggestedResolution?: ConflictValue;
  resolvedAt?: Date;
  resolvedBy?: string;
  resolution?: 'newer_wins' | 'higher_confidence' | 'human' | 'domain_rule';
}

export interface ConflictValue {
  source: string;
  value: unknown;
  observedAt: Date;
  confidence: number;
}

/**
 * Detect conflicts between two source observations for the same field.
 */
export function detectConflict(
  objectId: string,
  objectType: string,
  field: string,
  existing: { source: string; value: unknown; observedAt: Date; confidence: number },
  incoming: { source: string; value: unknown; observedAt: Date; confidence: number },
): Conflict | null {
  // No conflict if values are equal
  if (valuesEqual(existing.value, incoming.value)) return null;

  // No conflict if from the same source (just an update)
  if (existing.source === incoming.source) return null;

  const values = [
    { source: existing.source, value: existing.value, observedAt: existing.observedAt, confidence: existing.confidence },
    { source: incoming.source, value: incoming.value, observedAt: incoming.observedAt, confidence: incoming.confidence },
  ];

  // Try auto-resolution
  const autoResolution = tryAutoResolve(values);

  return {
    id: `conflict_${objectId}_${field}_${Date.now()}`,
    objectId,
    objectType,
    field,
    values,
    autoResolvable: autoResolution !== null,
    suggestedResolution: autoResolution ?? undefined,
    resolution: autoResolution ? (autoResolution === values[1] ? 'newer_wins' : 'higher_confidence') : undefined,
  };
}

/**
 * Try to auto-resolve a conflict.
 * Strategy: newer observation wins, unless the older one has significantly higher confidence.
 */
function tryAutoResolve(values: ConflictValue[]): ConflictValue | null {
  if (values.length !== 2) return null;

  const [a, b] = values;
  if (!a || !b) return null;

  // If confidence difference is large (>0.3), trust the higher-confidence source
  const confidenceDiff = Math.abs(a.confidence - b.confidence);
  if (confidenceDiff > 0.3) {
    return a.confidence > b.confidence ? a : b;
  }

  // Otherwise, newer observation wins
  return a.observedAt > b.observedAt ? a : b;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 0.001;
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase().trim() === b.toLowerCase().trim();
  return JSON.stringify(a) === JSON.stringify(b);
}
