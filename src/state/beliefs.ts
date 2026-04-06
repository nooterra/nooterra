/**
 * Belief Store — maintains beliefs about hidden state with confidence and provenance.
 *
 * Every estimated field on a WorldObject has an underlying Belief that tracks:
 * - What we believe the value is
 * - How confident we are
 * - What evidence supports this belief
 * - How accurate this type of estimate has been historically (calibration)
 */

import type pg from 'pg';

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

function rowToBelief(row: any): Belief {
  return {
    objectId: row.object_id,
    field: row.field,
    value: Number(row.value),
    confidence: Number(row.confidence),
    method: row.method,
    evidence: typeof row.evidence === 'string' ? JSON.parse(row.evidence) : (row.evidence ?? []),
    calibration: Number(row.calibration),
    estimatedAt: new Date(row.estimated_at),
  };
}

export function beliefsToEstimatedFields(beliefs: Belief[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const belief of beliefs) {
    result[belief.field] = belief.value;
  }
  return result;
}

export async function persistBelief(
  pool: pg.Pool,
  tenantId: string,
  belief: Belief,
): Promise<void> {
  await pool.query(
    `INSERT INTO world_beliefs (
      tenant_id, object_id, field, value, confidence, method, evidence, calibration, estimated_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,now())
    ON CONFLICT (tenant_id, object_id, field) DO UPDATE SET
      value = EXCLUDED.value,
      confidence = EXCLUDED.confidence,
      method = EXCLUDED.method,
      evidence = EXCLUDED.evidence,
      calibration = EXCLUDED.calibration,
      estimated_at = EXCLUDED.estimated_at,
      updated_at = now()`,
    [
      tenantId,
      belief.objectId,
      belief.field,
      belief.value,
      belief.confidence,
      belief.method,
      JSON.stringify(belief.evidence ?? []),
      belief.calibration,
      belief.estimatedAt,
    ],
  );
}

export async function batchPersistBeliefs(
  pool: pg.Pool,
  tenantId: string,
  beliefs: Belief[],
): Promise<void> {
  if (beliefs.length === 0) return;

  const columns = [
    'tenant_id', 'object_id', 'field', 'value', 'confidence',
    'method', 'evidence', 'calibration', 'estimated_at', 'updated_at',
  ];
  const valuesPerRow = columns.length;
  const params: unknown[] = [];
  const rowPlaceholders: string[] = [];

  for (let i = 0; i < beliefs.length; i++) {
    const b = beliefs[i]!;
    const offset = i * valuesPerRow;
    rowPlaceholders.push(
      `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},` +
      `$${offset + 6},$${offset + 7}::jsonb,$${offset + 8},$${offset + 9},now())`,
    );
    params.push(
      tenantId,
      b.objectId,
      b.field,
      b.value,
      b.confidence,
      b.method,
      JSON.stringify(b.evidence ?? []),
      b.calibration,
      b.estimatedAt,
    );
  }

  await pool.query(
    `INSERT INTO world_beliefs (${columns.join(', ')})
     VALUES ${rowPlaceholders.join(', ')}
     ON CONFLICT (tenant_id, object_id, field) DO UPDATE SET
       value = EXCLUDED.value,
       confidence = EXCLUDED.confidence,
       method = EXCLUDED.method,
       evidence = EXCLUDED.evidence,
       calibration = EXCLUDED.calibration,
       estimated_at = EXCLUDED.estimated_at,
       updated_at = now()`,
    params,
  );
}

export async function loadObjectBeliefs(
  pool: pg.Pool,
  tenantId: string,
  objectId: string,
): Promise<Belief[]> {
  const result = await pool.query(
    `SELECT object_id, field, value, confidence, method, evidence, calibration, estimated_at
     FROM world_beliefs
     WHERE tenant_id = $1 AND object_id = $2
     ORDER BY field ASC`,
    [tenantId, objectId],
  );
  return result.rows.map(rowToBelief);
}
