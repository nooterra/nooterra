/**
 * Belief Store — maintains beliefs about hidden state with confidence and provenance.
 *
 * Every estimated field on a WorldObject has an underlying Belief that tracks:
 * - What we believe the value is
 * - How confident we are
 * - What evidence supports this belief
 * - How accurate this type of estimate has been historically (calibration)
 */

export interface Belief {
  objectId: string;
  field: string;
  value: number;
  confidence: number;
  method: 'direct_observation' | 'rule_inference' | 'statistical' | 'default_prior';
  evidence: string[];
  calibration: number;  // 0-1: how accurate this estimator has been
  estimatedAt: Date;
}

/**
 * In-memory belief cache per object.
 * Persisted to the object's `estimated` JSONB field.
 */
export class BeliefStore {
  private beliefs = new Map<string, Map<string, Belief>>();

  /** Set or update a belief */
  setBelief(belief: Belief): void {
    if (!this.beliefs.has(belief.objectId)) {
      this.beliefs.set(belief.objectId, new Map());
    }
    this.beliefs.get(belief.objectId)!.set(belief.field, belief);
  }

  /** Get a specific belief */
  getBelief(objectId: string, field: string): Belief | undefined {
    return this.beliefs.get(objectId)?.get(field);
  }

  /** Get all beliefs for an object */
  getObjectBeliefs(objectId: string): Belief[] {
    const objectBeliefs = this.beliefs.get(objectId);
    if (!objectBeliefs) return [];
    return [...objectBeliefs.values()];
  }

  /** Convert beliefs to the `estimated` JSONB for storage on WorldObject */
  toEstimatedFields(objectId: string): Record<string, number> {
    const result: Record<string, number> = {};
    const objectBeliefs = this.beliefs.get(objectId);
    if (!objectBeliefs) return result;
    for (const [field, belief] of objectBeliefs) {
      result[field] = belief.value;
    }
    return result;
  }

  /** Clear beliefs for an object (e.g., on re-estimation) */
  clearObject(objectId: string): void {
    this.beliefs.delete(objectId);
  }
}
