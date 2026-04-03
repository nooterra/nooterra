import test from 'node:test';
import assert from 'node:assert/strict';

import { deduplicateByCustomer } from '../src/planner/planner.ts';

test('deduplicateByCustomer keeps only highest-priority action per customer', () => {
  const actions = [
    { targetObjectId: 'inv_1', priority: 0.9, parameters: { partyId: 'party_A' }, actionClass: 'communicate.email' },
    { targetObjectId: 'inv_2', priority: 0.7, parameters: { partyId: 'party_A' }, actionClass: 'communicate.email' },
    { targetObjectId: 'inv_3', priority: 0.8, parameters: { partyId: 'party_B' }, actionClass: 'communicate.email' },
    { targetObjectId: 'inv_4', priority: 0.6, parameters: { partyId: 'party_A' }, actionClass: 'communicate.email' },
  ];
  const deduplicated = deduplicateByCustomer(actions);

  const partyAActions = deduplicated.filter((a) => a.parameters.partyId === 'party_A');
  assert.equal(partyAActions.length, 1);
  assert.equal(partyAActions[0].targetObjectId, 'inv_1');

  const partyBActions = deduplicated.filter((a) => a.parameters.partyId === 'party_B');
  assert.equal(partyBActions.length, 1);
});

test('deduplicateByCustomer preserves strategic holds alongside outreach', () => {
  const actions = [
    { targetObjectId: 'inv_1', priority: 0.9, parameters: { partyId: 'party_A' }, actionClass: 'communicate.email' },
    { targetObjectId: 'inv_2', priority: 0.7, parameters: { partyId: 'party_A' }, actionClass: 'strategic.hold' },
  ];
  const deduplicated = deduplicateByCustomer(actions);

  const emails = deduplicated.filter((a) => a.actionClass === 'communicate.email');
  assert.equal(emails.length, 1);
});

test('deduplicateByCustomer handles null partyId without crashing', () => {
  const actions = [
    { targetObjectId: 'inv_1', priority: 0.9, parameters: { partyId: null }, actionClass: 'communicate.email' },
    { targetObjectId: 'inv_2', priority: 0.7, parameters: { partyId: null }, actionClass: 'communicate.email' },
  ];
  const deduplicated = deduplicateByCustomer(actions);
  assert.equal(deduplicated.length, 2);
});
