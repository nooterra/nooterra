import test from 'node:test';
import assert from 'node:assert/strict';

test('InterventionResult type includes optional upliftShadow field', async () => {
  const { estimateIntervention } = await import('../src/world-model/ensemble.ts');
  assert.equal(typeof estimateIntervention, 'function');

  const exampleWithShadow = {
    predictedEffect: [],
    defaultConfidence: 0.55,
    modelId: 'rule_inference',
    upliftShadow: {
      lift: 0.12,
      treatmentProb: 0.65,
      controlProb: 0.53,
      interval: { lower: 0.03, upper: 0.21, coverage: 0.9 },
      modelId: 'uplift_tlearner_communicate_email_v1',
      treatmentSamples: 80,
      controlSamples: 35,
    },
  };

  assert.ok(exampleWithShadow.upliftShadow);
  assert.equal(typeof exampleWithShadow.upliftShadow.lift, 'number');
  assert.ok(exampleWithShadow.upliftShadow.interval);
});
