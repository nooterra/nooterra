/**
 * Calibration Tracker — compares predictions to outcomes.
 *
 * Every prediction is logged. When the outcome is observed, the
 * calibration tracker updates the model's accuracy score.
 * Models that lose calibration are flagged.
 */

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
