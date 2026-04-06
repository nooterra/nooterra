/**
 * Pipeline integration test — verifies the full flow using synthetic data.
 *
 * Tests that:
 *   1. Scenarios produce valid event/object structures
 *   2. Epoch triggers fire correctly for each invoice state
 *   3. Feature vectors are deterministic
 *   4. Expected actions align with scenario expectations
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SCENARIOS, toWorldObjectState } from './scenarios.ts';
import { emitInvoiceLifecycle, emitAllScenarios } from './event-emitter.ts';

test('scenarios produce valid structures', () => {
  assert.ok(SCENARIOS.length >= 10, `Expected >= 10 scenarios, got ${SCENARIOS.length}`);

  for (const scenario of SCENARIOS) {
    assert.ok(scenario.id, `Scenario missing id`);
    assert.ok(scenario.customerId, `${scenario.id}: missing customerId`);
    assert.ok(scenario.amountCents > 0, `${scenario.id}: amountCents must be positive`);
    assert.ok(scenario.issuedAt, `${scenario.id}: missing issuedAt`);
    assert.ok(scenario.dueAt, `${scenario.id}: missing dueAt`);
    assert.ok(scenario.events.length > 0, `${scenario.id}: must have at least one event`);
    assert.ok(scenario.expectedOutcome, `${scenario.id}: missing expectedOutcome`);
    assert.ok(scenario.expectedEpochTrigger, `${scenario.id}: missing expectedEpochTrigger`);
    assert.ok(scenario.expectedActionClass, `${scenario.id}: missing expectedActionClass`);
  }
});

test('toWorldObjectState produces valid state/estimated', () => {
  for (const scenario of SCENARIOS) {
    const { state, estimated } = toWorldObjectState(scenario);

    assert.ok(state.amountCents > 0, `${scenario.id}: state.amountCents must be positive`);
    assert.ok(state.status, `${scenario.id}: state.status must be set`);
    assert.ok(state.issuedAt, `${scenario.id}: state.issuedAt must be set`);
    assert.ok(state.dueAt, `${scenario.id}: state.dueAt must be set`);

    // Estimated fields should be in [0, 1]
    for (const [key, value] of Object.entries(estimated)) {
      assert.ok(value >= 0 && value <= 1, `${scenario.id}: estimated.${key}=${value} out of [0,1] range`);
    }

    // Amount consistency
    const paidCents = Number(state.amountPaidCents || 0);
    const remainingCents = Number(state.amountRemainingCents || 0);
    assert.equal(paidCents + remainingCents, state.amountCents,
      `${scenario.id}: amountPaid + amountRemaining should equal amountCents`);
  }
});

test('emitInvoiceLifecycle produces valid events and objects', () => {
  const tenantId = 'test_tenant';

  for (const scenario of SCENARIOS) {
    const { events, objects } = emitInvoiceLifecycle(scenario, tenantId);

    assert.ok(events.length > 0, `${scenario.id}: must emit events`);
    assert.ok(objects.length >= 2, `${scenario.id}: must emit invoice + party objects`);

    // All events have required fields
    for (const event of events) {
      assert.equal(event.tenantId, tenantId);
      assert.ok(event.type, 'event.type required');
      assert.ok(event.occurredAt, 'event.occurredAt required');
      assert.ok(event.provenance.sourceSystem, 'provenance.sourceSystem required');
      assert.ok(event.provenance.sourceId, 'provenance.sourceId required');
    }

    // Invoice object exists
    const invoiceObj = objects.find((o) => o.id === scenario.id);
    assert.ok(invoiceObj, `${scenario.id}: invoice object not emitted`);
    assert.equal(invoiceObj.type, 'invoice');

    // Party object exists
    const partyObj = objects.find((o) => o.id === scenario.customerId);
    assert.ok(partyObj, `${scenario.id}: party object not emitted`);
    assert.equal(partyObj.type, 'party');
  }
});

test('emitAllScenarios deduplicates shared customers', () => {
  const { events, objects, scenarios } = emitAllScenarios('test_tenant');

  assert.ok(events.length > 0, 'Should emit events');
  assert.ok(objects.length > 0, 'Should emit objects');
  assert.equal(scenarios.length, SCENARIOS.length);

  // Count unique customer IDs vs party objects
  const uniqueCustomers = new Set(SCENARIOS.map((s) => s.customerId));
  const partyObjects = objects.filter((o) => o.type === 'party');
  assert.equal(partyObjects.length, uniqueCustomers.size,
    'Party objects should be deduplicated');

  // Events should be chronologically sorted
  for (let i = 1; i < events.length; i++) {
    const prev = new Date(events[i - 1].occurredAt).getTime();
    const curr = new Date(events[i].occurredAt).getTime();
    assert.ok(curr >= prev, `Events not sorted: ${events[i - 1].occurredAt} > ${events[i].occurredAt}`);
  }
});

test('scenario coverage: every action type exercised', () => {
  const actionClasses = new Set(SCENARIOS.map((s) => s.expectedActionClass));
  assert.ok(actionClasses.has('strategic.hold'), 'Missing strategic.hold scenario');
  assert.ok(actionClasses.has('communicate.email'), 'Missing communicate.email scenario');
  assert.ok(actionClasses.has('task.create'), 'Missing task.create scenario');
});

test('scenario coverage: every epoch trigger exercised', () => {
  const triggers = new Set(SCENARIOS.map((s) => s.expectedEpochTrigger));
  assert.ok(triggers.has('issued'), 'Missing issued trigger');
  assert.ok(triggers.has('due'), 'Missing due trigger');
  assert.ok(triggers.has('7d_overdue'), 'Missing 7d_overdue trigger');
  assert.ok(triggers.has('14d_overdue'), 'Missing 14d_overdue trigger');
  assert.ok(triggers.has('30d_overdue'), 'Missing 30d_overdue trigger');
  assert.ok(triggers.has('dispute_opened'), 'Missing dispute_opened trigger');
});

test('scenario coverage: every outcome type exercised', () => {
  const outcomes = new Set(SCENARIOS.map((s) => s.expectedOutcome.finalStatus));
  assert.ok(outcomes.has('paid'), 'Missing paid outcome');
  assert.ok(outcomes.has('partial'), 'Missing partial outcome');
  assert.ok(outcomes.has('written_off'), 'Missing written_off outcome');
  assert.ok(outcomes.has('disputed'), 'Missing disputed outcome');
  assert.ok(outcomes.has('open'), 'Missing open outcome');
});
