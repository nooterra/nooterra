/**
 * Calibration Tracker — compares predictions to outcomes.
 *
 * Every prediction is logged. When the outcome is observed, the
 * calibration tracker updates the model's accuracy score.
 * Models that lose calibration are flagged.
 */

import type pg from 'pg';

export interface Prediction {
  id: string;
  tenantId: string;
  objectId: string;
  predictionType: string;     // e.g. 'paymentProbability7d'
  predictedValue: number;
  confidence: number;
  modelId: string;
  predictedAt: Date;
  // Filled when outcome observed
  outcomeValue?: number;
  outcomeAt?: Date;
  calibrationError?: number;  // |predicted - actual|
}

export interface CalibrationReport {
  modelId: string;
  predictionType: string;
  totalPredictions: number;
  withOutcomes: number;
  meanAbsoluteError: number;
  calibrationScore: number;   // 1 - MAE, higher is better
  bias: number;               // positive = overestimates, negative = underestimates
  isCalibrated: boolean;      // calibrationScore > threshold
}

/**
 * In-memory prediction store (would be backed by predictions table in production).
 */
export class CalibrationTracker {
  private predictions = new Map<string, Prediction>();
  private outcomes = new Map<string, { modelId: string; type: string; error: number }[]>();

  /** Record a prediction */
  recordPrediction(prediction: Prediction): void {
    this.predictions.set(prediction.id, prediction);
  }

  /** Record an outcome for a prediction */
  recordOutcome(predictionId: string, outcomeValue: number): void {
    const prediction = this.predictions.get(predictionId);
    if (!prediction) return;

    prediction.outcomeValue = outcomeValue;
    prediction.outcomeAt = new Date();
    prediction.calibrationError = Math.abs(prediction.predictedValue - outcomeValue);

    // Track by model
    const key = `${prediction.modelId}:${prediction.predictionType}`;
    if (!this.outcomes.has(key)) this.outcomes.set(key, []);
    this.outcomes.get(key)!.push({
      modelId: prediction.modelId,
      type: prediction.predictionType,
      error: prediction.calibrationError,
    });
  }

  /** Get calibration report for a model */
  getCalibration(modelId: string, predictionType: string): CalibrationReport {
    const key = `${modelId}:${predictionType}`;
    const results = this.outcomes.get(key) ?? [];

    const allPredictions = [...this.predictions.values()].filter(
      p => p.modelId === modelId && p.predictionType === predictionType
    );

    if (results.length === 0) {
      return {
        modelId,
        predictionType,
        totalPredictions: allPredictions.length,
        withOutcomes: 0,
        meanAbsoluteError: 0,
        calibrationScore: 0.5, // Unknown
        bias: 0,
        isCalibrated: false,
      };
    }

    const totalError = results.reduce((sum, r) => sum + r.error, 0);
    const mae = totalError / results.length;
    const calibrationScore = Math.max(0, 1 - mae);

    // Calculate bias
    const withOutcomes = allPredictions.filter(p => p.outcomeValue !== undefined);
    const totalBias = withOutcomes.reduce((sum, p) =>
      sum + (p.predictedValue - (p.outcomeValue ?? 0)), 0
    );
    const bias = withOutcomes.length > 0 ? totalBias / withOutcomes.length : 0;

    return {
      modelId,
      predictionType,
      totalPredictions: allPredictions.length,
      withOutcomes: results.length,
      meanAbsoluteError: mae,
      calibrationScore,
      bias,
      isCalibrated: calibrationScore > 0.6 && results.length >= 10,
    };
  }

  /** Get all predictions for an object */
  getObjectPredictions(objectId: string): Prediction[] {
    return [...this.predictions.values()].filter(p => p.objectId === objectId);
  }
}

/** Singleton calibration tracker */
export const calibrationTracker = new CalibrationTracker();

export interface PersistentPredictionRecord extends Prediction {
  reasoning?: string[];
  evidence?: string[];
  horizon?: string | null;
  calibrationScore?: number | null;
}

export interface PredictionHistoryRecord {
  id: string;
  tenantId: string;
  objectId: string;
  predictionType: string;
  predictedValue: number;
  confidence: number;
  modelId: string;
  horizon: string | null;
  reasoning: string[];
  evidence: string[];
  calibrationScore: number | null;
  predictedAt: Date;
  outcome: {
    value: number;
    at: Date;
    calibrationError: number;
  } | null;
}

function inferBias(predictions: Array<{ predictedValue: number; outcomeValue: number }>): number {
  if (predictions.length === 0) return 0;
  const total = predictions.reduce((sum, row) => sum + (row.predictedValue - row.outcomeValue), 0);
  return total / predictions.length;
}

function parseJsonArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((value) => String(value ?? '')).filter(Boolean);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map((value) => String(value ?? '')).filter(Boolean);
    } catch {
      return [];
    }
  }
  return [];
}

export async function batchRecordPredictions(
  pool: pg.Pool,
  predictions: PersistentPredictionRecord[],
): Promise<void> {
  if (predictions.length === 0) return;

  const columns = [
    'id', 'tenant_id', 'object_id', 'prediction_type', 'predicted_value',
    'confidence', 'model_id', 'horizon', 'reasoning', 'evidence',
    'calibration_score', 'predicted_at',
  ];
  const valuesPerRow = columns.length;
  const params: unknown[] = [];
  const rowPlaceholders: string[] = [];

  for (let i = 0; i < predictions.length; i++) {
    const p = predictions[i]!;
    const offset = i * valuesPerRow;
    rowPlaceholders.push(
      `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},` +
      `$${offset + 6},$${offset + 7},$${offset + 8},$${offset + 9}::jsonb,$${offset + 10}::jsonb,` +
      `$${offset + 11},$${offset + 12})`,
    );
    params.push(
      p.id,
      p.tenantId,
      p.objectId,
      p.predictionType,
      p.predictedValue,
      p.confidence,
      p.modelId,
      p.horizon ?? null,
      JSON.stringify(p.reasoning ?? []),
      JSON.stringify(p.evidence ?? []),
      p.calibrationScore ?? null,
      p.predictedAt,
    );
  }

  await pool.query(
    `INSERT INTO world_predictions (${columns.join(', ')})
     VALUES ${rowPlaceholders.join(', ')}
     ON CONFLICT (id) DO NOTHING`,
    params,
  );
}

export async function recordPrediction(
  pool: pg.Pool,
  prediction: PersistentPredictionRecord,
): Promise<void> {
  await pool.query(
    `INSERT INTO world_predictions (
      id, tenant_id, object_id, prediction_type, predicted_value, confidence,
      model_id, horizon, reasoning, evidence, calibration_score, predicted_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12)
    ON CONFLICT (id) DO NOTHING`,
    [
      prediction.id,
      prediction.tenantId,
      prediction.objectId,
      prediction.predictionType,
      prediction.predictedValue,
      prediction.confidence,
      prediction.modelId,
      prediction.horizon ?? null,
      JSON.stringify(prediction.reasoning ?? []),
      JSON.stringify(prediction.evidence ?? []),
      prediction.calibrationScore ?? null,
      prediction.predictedAt,
    ],
  );
}

export async function recordObjectOutcome(
  pool: pg.Pool,
  {
    tenantId,
    objectId,
    predictionType,
    outcomeValue,
    outcomeAt = new Date(),
  }: {
    tenantId: string;
    objectId: string;
    predictionType: string;
    outcomeValue: number;
    outcomeAt?: Date;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO world_prediction_outcomes (
      prediction_id, tenant_id, object_id, prediction_type, outcome_value, outcome_at, calibration_error
    )
    SELECT
      p.id,
      p.tenant_id,
      p.object_id,
      p.prediction_type,
      $4,
      $5,
      ABS(p.predicted_value - $4)
    FROM world_predictions p
    LEFT JOIN world_prediction_outcomes o ON o.prediction_id = p.id
    WHERE p.tenant_id = $1
      AND p.object_id = $2
      AND p.prediction_type = $3
      AND o.prediction_id IS NULL
    ON CONFLICT (prediction_id) DO NOTHING`,
    [tenantId, objectId, predictionType, outcomeValue, outcomeAt],
  );
}

export async function getCalibrationReport(
  pool: pg.Pool,
  {
    modelId,
    predictionType,
    tenantId = null,
  }: {
    modelId: string;
    predictionType: string;
    tenantId?: string | null;
  },
): Promise<CalibrationReport> {
  const result = tenantId
    ? await pool.query(
      `SELECT p.predicted_value, o.outcome_value
       FROM world_predictions p
       LEFT JOIN world_prediction_outcomes o ON o.prediction_id = p.id
       WHERE p.model_id = $1 AND p.prediction_type = $2 AND p.tenant_id = $3`,
      [modelId, predictionType, tenantId],
    )
    : await pool.query(
      `SELECT p.predicted_value, o.outcome_value
       FROM world_predictions p
       LEFT JOIN world_prediction_outcomes o ON o.prediction_id = p.id
       WHERE p.model_id = $1 AND p.prediction_type = $2`,
      [modelId, predictionType],
    );

  const totalPredictions = result.rows.length;
  const resolved = result.rows
    .filter((row) => row.outcome_value !== null && row.outcome_value !== undefined)
    .map((row) => ({
      predictedValue: Number(row.predicted_value),
      outcomeValue: Number(row.outcome_value),
      error: Math.abs(Number(row.predicted_value) - Number(row.outcome_value)),
    }));

  if (resolved.length === 0) {
    return {
      modelId,
      predictionType,
      totalPredictions,
      withOutcomes: 0,
      meanAbsoluteError: 0,
      calibrationScore: 0.5,
      bias: 0,
      isCalibrated: false,
    };
  }

  const totalError = resolved.reduce((sum, row) => sum + row.error, 0);
  const meanAbsoluteError = totalError / resolved.length;
  const calibrationScore = Math.max(0, 1 - meanAbsoluteError);

  return {
    modelId,
    predictionType,
    totalPredictions,
    withOutcomes: resolved.length,
    meanAbsoluteError,
    calibrationScore,
    bias: inferBias(resolved),
    isCalibrated: calibrationScore > 0.6 && resolved.length >= 10,
  };
}

export async function listObjectPredictionHistory(
  pool: pg.Pool,
  {
    tenantId,
    objectId,
    predictionType = null,
    limit = 50,
    offset = 0,
  }: {
    tenantId: string;
    objectId: string;
    predictionType?: string | null;
    limit?: number;
    offset?: number;
  },
): Promise<{ total: number; items: PredictionHistoryRecord[] }> {
  const result = predictionType
    ? await pool.query(
      `SELECT
         p.id,
         p.tenant_id,
         p.object_id,
         p.prediction_type,
         p.predicted_value,
         p.confidence,
         p.model_id,
         p.horizon,
         p.reasoning,
         p.evidence,
         p.calibration_score,
         p.predicted_at,
         o.outcome_value,
         o.outcome_at,
         o.calibration_error
       FROM world_predictions p
       LEFT JOIN world_prediction_outcomes o ON o.prediction_id = p.id
       WHERE p.tenant_id = $1
         AND p.object_id = $2
         AND p.prediction_type = $3
       ORDER BY p.predicted_at DESC, p.id ASC`,
      [tenantId, objectId, predictionType],
    )
    : await pool.query(
      `SELECT
         p.id,
         p.tenant_id,
         p.object_id,
         p.prediction_type,
         p.predicted_value,
         p.confidence,
         p.model_id,
         p.horizon,
         p.reasoning,
         p.evidence,
         p.calibration_score,
         p.predicted_at,
         o.outcome_value,
         o.outcome_at,
         o.calibration_error
       FROM world_predictions p
       LEFT JOIN world_prediction_outcomes o ON o.prediction_id = p.id
       WHERE p.tenant_id = $1
         AND p.object_id = $2
       ORDER BY p.predicted_at DESC, p.id ASC`,
      [tenantId, objectId],
    );

  const items = result.rows.map((row) => ({
    id: String(row.id),
    tenantId: String(row.tenant_id),
    objectId: String(row.object_id),
    predictionType: String(row.prediction_type),
    predictedValue: Number(row.predicted_value),
    confidence: Number(row.confidence),
    modelId: String(row.model_id),
    horizon: row.horizon == null ? null : String(row.horizon),
    reasoning: parseJsonArray(row.reasoning),
    evidence: parseJsonArray(row.evidence),
    calibrationScore: row.calibration_score == null ? null : Number(row.calibration_score),
    predictedAt: new Date(row.predicted_at),
    outcome: row.outcome_value == null
      ? null
      : {
        value: Number(row.outcome_value),
        at: new Date(row.outcome_at),
        calibrationError: Number(row.calibration_error),
      },
  }));

  return {
    total: items.length,
    items: items.slice(offset, offset + limit),
  };
}

export async function listCalibrationReports(
  pool: pg.Pool,
  {
    tenantId,
    modelId = null,
    predictionType = null,
    limit = 50,
    offset = 0,
  }: {
    tenantId: string;
    modelId?: string | null;
    predictionType?: string | null;
    limit?: number;
    offset?: number;
  },
): Promise<{ total: number; reports: CalibrationReport[] }> {
  const result = modelId && predictionType
    ? await pool.query(
      `SELECT p.model_id, p.prediction_type, p.predicted_value, o.outcome_value
       FROM world_predictions p
       LEFT JOIN world_prediction_outcomes o ON o.prediction_id = p.id
       WHERE p.tenant_id = $1 AND p.model_id = $2 AND p.prediction_type = $3
       ORDER BY p.model_id ASC, p.prediction_type ASC, p.predicted_at DESC, p.id ASC`,
      [tenantId, modelId, predictionType],
    )
    : modelId
      ? await pool.query(
        `SELECT p.model_id, p.prediction_type, p.predicted_value, o.outcome_value
         FROM world_predictions p
         LEFT JOIN world_prediction_outcomes o ON o.prediction_id = p.id
         WHERE p.tenant_id = $1 AND p.model_id = $2
         ORDER BY p.model_id ASC, p.prediction_type ASC, p.predicted_at DESC, p.id ASC`,
        [tenantId, modelId],
      )
      : predictionType
        ? await pool.query(
          `SELECT p.model_id, p.prediction_type, p.predicted_value, o.outcome_value
           FROM world_predictions p
           LEFT JOIN world_prediction_outcomes o ON o.prediction_id = p.id
           WHERE p.tenant_id = $1 AND p.prediction_type = $2
           ORDER BY p.model_id ASC, p.prediction_type ASC, p.predicted_at DESC, p.id ASC`,
          [tenantId, predictionType],
        )
        : await pool.query(
          `SELECT p.model_id, p.prediction_type, p.predicted_value, o.outcome_value
           FROM world_predictions p
           LEFT JOIN world_prediction_outcomes o ON o.prediction_id = p.id
           WHERE p.tenant_id = $1
           ORDER BY p.model_id ASC, p.prediction_type ASC, p.predicted_at DESC, p.id ASC`,
          [tenantId],
        );

  const grouped = new Map<string, Array<{ predictedValue: number; outcomeValue: number | null }>>();
  for (const row of result.rows) {
    const key = `${String(row.model_id)}\u0000${String(row.prediction_type)}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push({
      predictedValue: Number(row.predicted_value),
      outcomeValue: row.outcome_value == null ? null : Number(row.outcome_value),
    });
  }

  const reports = [...grouped.entries()]
    .map(([key, rows]) => {
      const [groupModelId, groupPredictionType] = key.split('\u0000');
      const resolved = rows
        .filter((row) => row.outcomeValue !== null)
        .map((row) => ({
          predictedValue: row.predictedValue,
          outcomeValue: Number(row.outcomeValue),
          error: Math.abs(row.predictedValue - Number(row.outcomeValue)),
        }));

      const totalPredictions = rows.length;
      if (resolved.length === 0) {
        return {
          modelId: groupModelId!,
          predictionType: groupPredictionType!,
          totalPredictions,
          withOutcomes: 0,
          meanAbsoluteError: 0,
          calibrationScore: 0.5,
          bias: 0,
          isCalibrated: false,
        };
      }

      const totalError = resolved.reduce((sum, row) => sum + row.error, 0);
      const meanAbsoluteError = totalError / resolved.length;
      const calibrationScore = Math.max(0, 1 - meanAbsoluteError);

      return {
        modelId: groupModelId!,
        predictionType: groupPredictionType!,
        totalPredictions,
        withOutcomes: resolved.length,
        meanAbsoluteError,
        calibrationScore,
        bias: inferBias(resolved),
        isCalibrated: calibrationScore > 0.6 && resolved.length >= 10,
      };
    })
    .sort((left, right) => {
      const modelDelta = left.modelId.localeCompare(right.modelId);
      if (modelDelta !== 0) return modelDelta;
      return left.predictionType.localeCompare(right.predictionType);
    });

  return {
    total: reports.length,
    reports: reports.slice(offset, offset + limit),
  };
}
