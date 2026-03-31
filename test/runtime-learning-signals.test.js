import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSignalsFromExecution, buildSignalId } from '../services/runtime/learning-signals.js';

describe('learning signals', () => {
  it('extracts one signal per tool call with charter verdicts', () => {
    const signals = buildSignalsFromExecution({
      executionId: 'exec_1',
      workerId: 'wrk_1',
      tenantId: 'tenant_1',
      toolResults: [
        { name: 'send_email', args: { to: 'a@b.com' }, charterVerdict: 'canDo', matchedRule: null, success: true, result: 'sent' },
        { name: 'delete_file', args: { path: '/tmp' }, charterVerdict: 'askFirst', approvalDecision: 'approved', matchedRule: 'Delete requires approval', success: true, result: 'deleted' },
      ],
      blockedActions: [
        { tool: 'rm_database', args: {}, rule: 'never delete databases' },
      ],
      interruptionCode: 'awaiting_approval',
      executionOutcome: 'success',
    });

    assert.equal(signals.length, 3);
    assert.equal(signals[0].tool_name, 'send_email');
    assert.equal(signals[0].charter_verdict, 'canDo');
    assert.equal(signals[0].execution_outcome, 'success');
    assert.equal(signals[0].approval_decision, null);

    assert.equal(signals[1].tool_name, 'delete_file');
    assert.equal(signals[1].charter_verdict, 'askFirst');
    assert.equal(signals[1].approval_decision, 'approved');
    assert.equal(signals[1].matched_rule, 'Delete requires approval');
    assert.equal(signals[1].tool_success, true);
    assert.equal(signals[1].interruption_code, 'awaiting_approval');

    assert.equal(signals[2].tool_name, 'rm_database');
    assert.equal(signals[2].charter_verdict, 'neverDo');
    assert.equal(signals[2].execution_outcome, 'blocked');
    assert.equal(signals[2].matched_rule, 'never delete databases');
    assert.equal(signals[2].tool_success, false);
  });

  it('generates deterministic IDs from execution + tool + args', () => {
    const id1 = buildSignalId('exec_1', 'send_email', { to: 'a@b.com' });
    const id2 = buildSignalId('exec_1', 'send_email', { to: 'a@b.com' });
    const id3 = buildSignalId('exec_1', 'send_email', { to: 'c@d.com' });
    assert.equal(id1, id2);
    assert.notEqual(id1, id3);
  });
});
