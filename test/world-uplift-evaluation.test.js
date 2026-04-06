import test from 'node:test';
import assert from 'node:assert/strict';

test('uplift evaluation report type contract', () => {
  const report = {
    reportType: 'uplift_quality',
    subjectType: 'uplift_model',
    subjectId: 'uplift_tlearner_communicate_email_v1',
    status: 'candidate',
    metrics: {
      treatmentSamples: 80,
      controlSamples: 35,
      observedLift: 0.15,
      modelLift: 0.12,
      liftStability: 0.85,
      confidenceIntervalWidth: 0.18,
      heuristicBaselineLift: 0.08,
      beatsHeuristic: true,
    },
    artifact: {
      assessment: {
        eligible: true,
        reason: 'Model lift exceeds heuristic baseline by 4pp with stable intervals',
        rolloutEligibility: 'eligible',
      },
    },
  };

  assert.equal(report.reportType, 'uplift_quality');
  assert.ok(report.metrics.treatmentSamples >= 30);
  assert.ok(report.metrics.controlSamples >= 15);
  assert.equal(typeof report.metrics.observedLift, 'number');
  assert.equal(typeof report.metrics.beatsHeuristic, 'boolean');
});

test('upsertUpliftQualityEvaluationReport is exported', async () => {
  const { upsertUpliftQualityEvaluationReport } = await import('../src/eval/evaluation-reports.ts');
  assert.equal(typeof upsertUpliftQualityEvaluationReport, 'function');
});
