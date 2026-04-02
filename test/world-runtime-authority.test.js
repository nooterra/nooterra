import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { charterToGrantInput, ruleToActionClass, charterDecisionMatches } from '../src/policy/charter-shim.ts';

describe('Charter → AuthorityGrant shim', () => {
  describe('ruleToActionClass', () => {
    it('maps common charter rules to action classes', () => {
      assert.equal(ruleToActionClass('Send emails'), 'communicate.email');
      assert.equal(ruleToActionClass('send email'), 'communicate.email');
      assert.equal(ruleToActionClass('Make payments'), 'financial.payment.initiate');
      assert.equal(ruleToActionClass('Delete data'), 'data.delete');
      assert.equal(ruleToActionClass('Create tasks'), 'task.create');
      assert.equal(ruleToActionClass('Schedule meetings'), 'communicate.meeting');
      assert.equal(ruleToActionClass('delegate tasks'), 'agent.delegate');
    });

    it('handles partial matches', () => {
      assert.equal(ruleToActionClass('Send emails to customers under $5000'), 'communicate.email');
      assert.equal(ruleToActionClass('Make payment for invoices'), 'financial.payment.initiate');
    });

    it('falls back to legacy action class for unknown rules', () => {
      const result = ruleToActionClass('do something weird');
      assert.ok(result.startsWith('legacy.'));
      assert.equal(result, 'legacy.do_something_weird');
    });

    it('handles case-insensitive matching', () => {
      assert.equal(ruleToActionClass('SEND EMAILS'), 'communicate.email');
      assert.equal(ruleToActionClass('Send Emails'), 'communicate.email');
    });
  });

  describe('charterToGrantInput', () => {
    it('converts a full charter to a grant input', () => {
      const charter = {
        role: 'Collections Agent',
        canDo: ['Send emails', 'Read invoices'],
        askFirst: ['Make payments'],
        neverDo: ['Delete data'],
        maxDailyRuns: 100,
      };

      const grant = charterToGrantInput('tenant_1', 'human_1', 'agent_1', charter);

      assert.equal(grant.tenantId, 'tenant_1');
      assert.equal(grant.grantorType, 'human');
      assert.equal(grant.grantorId, 'human_1');
      assert.equal(grant.granteeId, 'agent_1');

      // Scope should contain canDo + askFirst action classes
      assert.ok(grant.scope.actionClasses.includes('communicate.email'));
      assert.ok(grant.scope.actionClasses.includes('financial.invoice.read'));
      assert.ok(grant.scope.actionClasses.includes('financial.payment.initiate'));

      // Constraints should have requireApproval and forbidden
      assert.ok(grant.constraints.requireApproval?.includes('financial.payment.initiate'));
      assert.ok(grant.constraints.forbidden?.includes('data.delete'));

      // Rate limit from charter
      assert.equal(grant.constraints.rateLimit?.maxPerDay, 100);
    });

    it('handles empty charter', () => {
      const grant = charterToGrantInput('t', 'h', 'a', {});
      assert.deepEqual(grant.scope.actionClasses, []);
      assert.deepEqual(grant.constraints.forbidden, []);
      assert.deepEqual(grant.constraints.requireApproval, []);
    });
  });

  describe('charterDecisionMatches', () => {
    it('validates canDo → allow', () => {
      assert.ok(charterDecisionMatches('canDo', 'allow'));
      assert.ok(!charterDecisionMatches('canDo', 'deny'));
      assert.ok(!charterDecisionMatches('canDo', 'require_approval'));
    });

    it('validates askFirst → require_approval', () => {
      assert.ok(charterDecisionMatches('askFirst', 'require_approval'));
      assert.ok(!charterDecisionMatches('askFirst', 'allow'));
    });

    it('validates neverDo → deny', () => {
      assert.ok(charterDecisionMatches('neverDo', 'deny'));
      assert.ok(!charterDecisionMatches('neverDo', 'allow'));
    });

    it('validates unknown → deny or require_approval', () => {
      assert.ok(charterDecisionMatches('unknown', 'deny'));
      assert.ok(charterDecisionMatches('unknown', 'require_approval'));
      assert.ok(!charterDecisionMatches('unknown', 'allow'));
    });
  });
});

describe('Authority attenuation', () => {
  it('child scope is intersection of parent scope', () => {
    // This tests the conceptual invariant — full DB test requires pg
    const parentActions = ['communicate.email', 'financial.invoice.read', 'financial.payment.initiate'];
    const requestedActions = ['communicate.email', 'data.delete']; // data.delete not in parent

    const attenuated = requestedActions.filter(ac => parentActions.includes(ac));

    assert.deepEqual(attenuated, ['communicate.email']);
    assert.ok(!attenuated.includes('data.delete'), 'Cannot delegate authority you do not have');
  });

  it('child constraints are union of parent + child', () => {
    const parentForbidden = ['data.delete'];
    const childForbidden = ['agent.create'];

    const merged = [...new Set([...parentForbidden, ...childForbidden])];

    assert.ok(merged.includes('data.delete'), 'Parent forbidden carries to child');
    assert.ok(merged.includes('agent.create'), 'Child forbidden is added');
  });
});
