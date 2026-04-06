import test from 'node:test';
import assert from 'node:assert/strict';

import { getPlanLimits, normalizePlanTier } from '../services/runtime/billing.js';

test('runtime billing plan tiers normalize legacy and product-facing aliases safely', () => {
  assert.equal(normalizePlanTier('free'), 'sandbox');
  assert.equal(normalizePlanTier('sandbox'), 'sandbox');
  assert.equal(normalizePlanTier('builder'), 'starter');
  assert.equal(normalizePlanTier('pro'), 'growth');
  assert.equal(normalizePlanTier('growth'), 'growth');
  assert.equal(normalizePlanTier('scale'), 'finance_ops');
  assert.equal(normalizePlanTier('finance_ops'), 'finance_ops');
  assert.equal(normalizePlanTier('enterprise'), 'enterprise');
  assert.equal(normalizePlanTier('unknown-plan'), 'unknown-plan');
});

test('runtime billing plan limits return unlimited enterprise capacity and safe fallback defaults', () => {
  assert.equal(getPlanLimits('enterprise').limits.maxExecutionsPerMonth, -1);
  assert.equal(getPlanLimits('growth').tier, 'growth');
  assert.equal(getPlanLimits('growth').limits.maxExecutionsPerMonth, 5000);
  assert.equal(getPlanLimits('unknown-plan').tier, 'unknown-plan');
  assert.equal(getPlanLimits('unknown-plan').limits.maxExecutionsPerMonth, 50);
});
