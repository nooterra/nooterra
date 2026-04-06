import test from 'node:test';
import assert from 'node:assert/strict';

import { getActionType } from '../src/core/action-registry.ts';
import { computeUncertaintyProfile } from '../src/core/uncertainty.ts';

test('uncertainty profile: external-effect actions degrade safely when sidecar signals are unavailable', () => {
  const profile = computeUncertaintyProfile({
    actionType: getActionType('communicate.email'),
    beliefs: [
      {
        objectId: 'inv_1',
        field: 'paymentProbability7d',
        value: 0.38,
        confidence: 0.62,
        method: 'rule_inference',
        evidence: ['invoice:overdue'],
        calibration: 0.78,
        estimatedAt: new Date('2026-04-02T10:00:00.000Z'),
      },
    ],
    predictions: [
      {
        objectId: 'inv_1',
        predictionType: 'paymentProbability7d',
        value: 0.38,
        confidence: 0.62,
        modelId: 'rule_inference',
        reasoning: ['sidecar unavailable'],
        calibrationScore: 0.78,
      },
    ],
    extractionConfidence: 1,
    relationshipConfidence: 0.8,
    interventionConfidence: 0.55,
    policyConfidence: 1,
  });

  assert.equal(profile.humanReviewRequired, true);
  assert.equal(profile.abstainRecommended, false);
  assert.match(profile.reasons.join(' '), /sidecar_unavailable_external_effect/);
});

test('uncertainty profile: drift or OOD forces abstention', () => {
  const profile = computeUncertaintyProfile({
    actionType: getActionType('communicate.email'),
    beliefs: [],
    predictions: [
      {
        objectId: 'inv_1',
        predictionType: 'paymentProbability7d',
        value: 0.4,
        confidence: 0.8,
        modelId: 'rule_inference',
        reasoning: [],
        calibrationScore: 0.82,
        driftDetected: true,
        inDistribution: false,
      },
    ],
    extractionConfidence: 1,
    relationshipConfidence: 1,
    interventionConfidence: 0.8,
    policyConfidence: 1,
  });

  assert.equal(profile.abstainRecommended, true);
  assert.equal(profile.driftDetected, true);
  assert.equal(profile.outOfDistribution, true);
});

