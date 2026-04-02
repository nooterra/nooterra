import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createCollectionsAgent, createCollectionsGrant, COLLECTIONS_TOOLS } from '../src/agents/templates/ar-collections.ts';

describe('AR Collections Agent — Configuration', () => {
  it('creates agent with correct properties', () => {
    const agent = createCollectionsAgent('tenant_1', 'agent_1');
    assert.equal(agent.name, 'Collections Agent');
    assert.equal(agent.role, 'Accounts Receivable Collections Specialist');
    assert.ok(agent.actionClasses.includes('communicate.email'));
    assert.ok(agent.actionClasses.includes('financial.invoice.read'));
    assert.ok(agent.domainInstructions?.includes('AR Collections'));
    assert.ok(agent.playbook?.includes('Stage 1'));
    assert.ok(agent.playbook?.includes('Stage 2'));
    assert.ok(agent.playbook?.includes('Stage 3'));
  });

  it('creates authority grant with correct scope', () => {
    const grant = createCollectionsGrant('tenant_1', 'human_1', 'agent_1');

    // Should be allowed
    assert.ok(grant.scope.actionClasses.includes('communicate.email'));
    assert.ok(grant.scope.actionClasses.includes('financial.invoice.read'));
    assert.ok(grant.scope.actionClasses.includes('data.read'));

    // Should require approval
    assert.ok(grant.constraints.requireApproval?.includes('task.create'));

    // Should be forbidden
    assert.ok(grant.constraints.forbidden?.includes('financial.payment.initiate'));
    assert.ok(grant.constraints.forbidden?.includes('financial.refund'));
    assert.ok(grant.constraints.forbidden?.includes('data.delete'));
    assert.ok(grant.constraints.forbidden?.includes('agent.create'));

    // Disclosure required
    assert.equal(grant.constraints.disclosureRequired, true);

    // Budget
    assert.equal(grant.scope.budgetLimitCents, 50000);
    assert.equal(grant.scope.budgetPeriod, 'month');

    // Cannot delegate
    assert.equal(grant.scope.maxDelegationDepth, 0);

    // Rate limits
    assert.equal(grant.constraints.rateLimit?.maxPerHour, 20);
    assert.equal(grant.constraints.rateLimit?.maxPerDay, 100);
  });

  it('has the right tools defined', () => {
    assert.equal(COLLECTIONS_TOOLS.length, 3);

    const toolNames = COLLECTIONS_TOOLS.map(t => t.function.name);
    assert.ok(toolNames.includes('send_collection_email'));
    assert.ok(toolNames.includes('create_followup_task'));
    assert.ok(toolNames.includes('log_collection_note'));

    // send_collection_email should require urgency level
    const emailTool = COLLECTIONS_TOOLS.find(t => t.function.name === 'send_collection_email');
    assert.ok(emailTool?.function.parameters.properties.urgency);
    assert.deepEqual(emailTool?.function.parameters.properties.urgency.enum, ['friendly', 'formal', 'escalation']);
  });
});

describe('AR Collections Agent — Playbook Rules', () => {
  const agent = createCollectionsAgent('t', 'a');

  it('Stage 1: friendly reminder for 3-7 day overdue', () => {
    assert.ok(agent.playbook?.includes('Stage 1'));
    assert.ok(agent.playbook?.includes('FRIENDLY REMINDER'));
    assert.ok(agent.playbook?.includes('3-7 days overdue'));
    assert.ok(agent.playbook?.includes('Do NOT mention "overdue"'));
  });

  it('Stage 2: formal notice for 14-21 day overdue', () => {
    assert.ok(agent.playbook?.includes('Stage 2'));
    assert.ok(agent.playbook?.includes('FORMAL NOTICE'));
    assert.ok(agent.playbook?.includes('14-21 days overdue'));
  });

  it('Stage 3: escalation for 30+ days or dispute', () => {
    assert.ok(agent.playbook?.includes('Stage 3'));
    assert.ok(agent.playbook?.includes('ESCALATION'));
    assert.ok(agent.playbook?.includes('Do NOT send an email'));
    assert.ok(agent.playbook?.includes('Create a follow-up task'));
  });

  it('handles dispute detection as immediate escalation', () => {
    assert.ok(agent.playbook?.includes('dispute'));
    assert.ok(agent.playbook?.includes('Stage 3 immediately'));
  });

  it('handles cash flow mentions with empathy', () => {
    assert.ok(agent.playbook?.includes('cash flow'));
    assert.ok(agent.playbook?.includes('follow up in 7 days'));
    assert.ok(agent.playbook?.includes('do NOT escalate yet'));
  });
});

describe('AR Collections Agent — Safety Constraints', () => {
  const agent = createCollectionsAgent('t', 'a');

  it('cannot threaten legal action', () => {
    assert.ok(agent.domainInstructions?.includes('Threaten legal action'));
    assert.ok(agent.domainInstructions?.includes('requires human authorization'));
  });

  it('cannot offer payment plans or discounts', () => {
    assert.ok(agent.domainInstructions?.includes('payment plans'));
    assert.ok(agent.domainInstructions?.includes('discounts'));
  });

  it('enforces once-per-week contact limit', () => {
    assert.ok(agent.domainInstructions?.includes('more than once per week'));
  });

  it('respects business hours', () => {
    assert.ok(agent.domainInstructions?.includes('outside business hours'));
  });

  it('does not discuss other customers', () => {
    assert.ok(agent.domainInstructions?.includes('other customers'));
  });
});
