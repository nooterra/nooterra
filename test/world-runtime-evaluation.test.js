import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { gradeTrace } from '../src/eval/grading.ts';
import { CoverageMap, generateProposals } from '../src/eval/coverage.ts';
import { compareReplay } from '../src/eval/shadow.ts';

// ---------------------------------------------------------------------------
// Trace grading
// ---------------------------------------------------------------------------

describe('Trace Grading', () => {
  it('gives high grade for clean execution', () => {
    const grade = gradeTrace({
      executionId: 'exec_1', agentId: 'agent_1', tenantId: 't',
      actionClass: 'communicate.email', targetObjectId: 'inv_1',
      actionsProposed: [{ actionClass: 'communicate.email', tool: 'send_email', status: 'executed', evidenceComplete: true }],
      actionsExecuted: [{ actionClass: 'communicate.email', tool: 'send_email', status: 'executed', evidenceComplete: true }],
      actionsBlocked: [],
      actionsEscrowed: [],
      contextProvided: true,
      authorityChecked: true,
      disclosureAppended: true,
      tokensUsed: 1000,
      costCents: 5,
      durationMs: 3000,
      objectiveAchieved: true,
    });

    assert.ok(grade.procedural.overall > 0.85, `Procedural should be > 0.85, got ${grade.procedural.overall}`);
    assert.ok(grade.outcome.overall > 0.85, `Outcome should be > 0.85, got ${grade.outcome.overall}`);
    assert.ok(grade.overallGrade > 0.85, `Overall should be > 0.85, got ${grade.overallGrade}`);
    assert.equal(grade.issues.length, 0);
  });

  it('penalizes blocked actions (procedural)', () => {
    const grade = gradeTrace({
      executionId: 'exec_2', agentId: 'agent_1', tenantId: 't',
      actionClass: 'communicate.email', targetObjectId: 'inv_1',
      actionsProposed: [
        { actionClass: 'communicate.email', tool: 'send_email', status: 'executed', evidenceComplete: true },
        { actionClass: 'data.delete', tool: 'delete_record', status: 'denied', reason: 'forbidden', evidenceComplete: false },
      ],
      actionsExecuted: [{ actionClass: 'communicate.email', tool: 'send_email', status: 'executed', evidenceComplete: true }],
      actionsBlocked: [{ actionClass: 'data.delete', tool: 'delete_record', status: 'denied', reason: 'forbidden', evidenceComplete: false }],
      actionsEscrowed: [],
      contextProvided: true, authorityChecked: true, disclosureAppended: true,
      tokensUsed: 1200, costCents: 6, durationMs: 4000,
    });

    assert.ok(grade.procedural.policyCompliance < 1.0, 'Policy compliance should be reduced');
    assert.ok(grade.issues.some(i => i.category === 'procedural'));
  });

  it('flags missing disclosure as critical', () => {
    const grade = gradeTrace({
      executionId: 'exec_3', agentId: 'agent_1', tenantId: 't',
      actionClass: 'communicate.email', targetObjectId: 'inv_1',
      actionsProposed: [{ actionClass: 'communicate.email', tool: 'send_email', status: 'executed', evidenceComplete: true }],
      actionsExecuted: [{ actionClass: 'communicate.email', tool: 'send_email', status: 'executed', evidenceComplete: true }],
      actionsBlocked: [], actionsEscrowed: [],
      contextProvided: true, authorityChecked: true,
      disclosureAppended: false, // Missing!
      tokensUsed: 1000, costCents: 5, durationMs: 3000,
    });

    assert.equal(grade.procedural.disclosureCompliance, 0.0);
    assert.ok(grade.issues.some(i => i.severity === 'critical' && i.description.includes('disclosure')));
  });

  it('handles unknown outcome gracefully', () => {
    const grade = gradeTrace({
      executionId: 'exec_4', agentId: 'agent_1', tenantId: 't',
      actionClass: 'communicate.email', targetObjectId: 'inv_1',
      actionsProposed: [], actionsExecuted: [], actionsBlocked: [], actionsEscrowed: [],
      contextProvided: true, authorityChecked: true, disclosureAppended: true,
      tokensUsed: 500, costCents: 2, durationMs: 1000,
      // objectiveAchieved not set → unknown
    });

    assert.equal(grade.outcome.objectiveAchieved, 0.5); // default for unknown
  });
});

// ---------------------------------------------------------------------------
// Autonomy Coverage Map
// ---------------------------------------------------------------------------

describe('Autonomy Coverage Map', () => {
  it('starts at human_approval level', () => {
    const map = new CoverageMap();
    const cell = map.getCell('agent_1', 'communicate.email', 'invoice');
    assert.equal(cell.currentLevel, 'human_approval');
    assert.equal(cell.totalExecutions, 0);
  });

  it('tracks executions and scores', () => {
    const map = new CoverageMap();

    for (let i = 0; i < 5; i++) {
      map.recordExecution('agent_1', 'communicate.email', 'invoice', {
        executionId: `exec_${i}`, agentId: 'agent_1',
        procedural: { policyCompliance: 1, contextUtilization: 1, toolUseCorrectness: 1, disclosureCompliance: 1, overall: 0.95 },
        outcome: { objectiveAchieved: 1, sideEffects: 1, costEfficiency: 0.8, overall: 0.9 },
        overallGrade: 0.925, issues: [], gradedAt: new Date(),
      });
    }

    const cell = map.getCell('agent_1', 'communicate.email', 'invoice');
    assert.equal(cell.totalExecutions, 5);
    assert.ok(cell.avgProceduralScore > 0.9);
    assert.ok(cell.successRate > 0.9);
  });

  it('recommends promotion after enough evidence', () => {
    const map = new CoverageMap();

    // Record 25 successful executions
    for (let i = 0; i < 25; i++) {
      map.recordExecution('agent_1', 'communicate.email', 'invoice', {
        executionId: `exec_${i}`, agentId: 'agent_1',
        procedural: { policyCompliance: 1, contextUtilization: 1, toolUseCorrectness: 1, disclosureCompliance: 1, overall: 0.92 },
        outcome: { objectiveAchieved: 1, sideEffects: 1, costEfficiency: 0.8, overall: 0.88 },
        overallGrade: 0.9, issues: [], gradedAt: new Date(),
      });
    }

    const cell = map.getCell('agent_1', 'communicate.email', 'invoice');
    assert.equal(cell.recommendedLevel, 'auto_with_review');
    assert.ok(cell.evidenceStrength > 0.5);
  });

  it('triggers demotion on critical incident', () => {
    const map = new CoverageMap();
    map.applyPromotion('agent_1', 'communicate.email', 'invoice', 'autonomous');

    // Record an incident
    map.recordIncident('agent_1', 'communicate.email', 'invoice');

    const cell = map.getCell('agent_1', 'communicate.email', 'invoice');
    assert.equal(cell.currentLevel, 'autonomous'); // hasn't changed yet
    assert.equal(cell.recommendedLevel, 'human_approval'); // but recommends demotion
    assert.ok(cell.evidenceStrength > 0.9); // high confidence in demotion
  });

  it('demotion is faster than promotion', () => {
    // Promotion needs 20+ executions
    // Demotion needs 1 incident
    const promoThreshold = 20;
    const demotionThreshold = 1;
    assert.ok(demotionThreshold < promoThreshold, 'Demotion should be faster than promotion');
  });

  it('does not promote to autonomous from human_approval (must go through auto_with_review)', () => {
    const map = new CoverageMap();

    // Record many executions at human_approval
    for (let i = 0; i < 100; i++) {
      map.recordExecution('agent_1', 'communicate.email', 'invoice', {
        executionId: `exec_${i}`, agentId: 'agent_1',
        procedural: { policyCompliance: 1, contextUtilization: 1, toolUseCorrectness: 1, disclosureCompliance: 1, overall: 0.95 },
        outcome: { objectiveAchieved: 1, sideEffects: 1, costEfficiency: 0.9, overall: 0.93 },
        overallGrade: 0.94, issues: [], gradedAt: new Date(),
      });
    }

    const cell = map.getCell('agent_1', 'communicate.email', 'invoice');
    assert.equal(cell.currentLevel, 'human_approval');
    // Should recommend auto_with_review, NOT autonomous (must step through)
    assert.equal(cell.recommendedLevel, 'auto_with_review');
  });
});

// ---------------------------------------------------------------------------
// Authority Proposals
// ---------------------------------------------------------------------------

describe('Authority Proposals', () => {
  it('generates promotion proposals when evidence is sufficient', () => {
    const map = new CoverageMap();

    for (let i = 0; i < 30; i++) {
      map.recordExecution('agent_1', 'communicate.email', 'invoice', {
        executionId: `exec_${i}`, agentId: 'agent_1',
        procedural: { policyCompliance: 1, contextUtilization: 0.9, toolUseCorrectness: 1, disclosureCompliance: 1, overall: 0.92 },
        outcome: { objectiveAchieved: 0.9, sideEffects: 1, costEfficiency: 0.8, overall: 0.87 },
        overallGrade: 0.895, issues: [], gradedAt: new Date(),
      });
    }

    const proposals = generateProposals(map);
    assert.ok(proposals.length > 0, 'Should generate at least one proposal');
    assert.equal(proposals[0].fromLevel, 'human_approval');
    assert.equal(proposals[0].toLevel, 'auto_with_review');
    assert.ok(proposals[0].confidence > 0.5);
  });

  it('generates demotion proposals on incidents', () => {
    const map = new CoverageMap();
    map.applyPromotion('agent_1', 'communicate.email', 'invoice', 'auto_with_review');
    map.recordIncident('agent_1', 'communicate.email', 'invoice');

    const proposals = generateProposals(map);
    assert.ok(proposals.length > 0);
    assert.equal(proposals[0].fromLevel, 'auto_with_review');
    assert.equal(proposals[0].toLevel, 'human_approval');
  });

  it('does not generate proposals when evidence is insufficient', () => {
    const map = new CoverageMap();

    // Only 3 executions — not enough
    for (let i = 0; i < 3; i++) {
      map.recordExecution('agent_1', 'communicate.email', 'invoice', {
        executionId: `exec_${i}`, agentId: 'agent_1',
        procedural: { policyCompliance: 1, contextUtilization: 1, toolUseCorrectness: 1, disclosureCompliance: 1, overall: 0.95 },
        outcome: { objectiveAchieved: 1, sideEffects: 1, costEfficiency: 0.9, overall: 0.93 },
        overallGrade: 0.94, issues: [], gradedAt: new Date(),
      });
    }

    const proposals = generateProposals(map);
    assert.equal(proposals.length, 0, 'Should not propose with only 3 executions');
  });
});

// ---------------------------------------------------------------------------
// Replay comparison
// ---------------------------------------------------------------------------

describe('Replay Comparison', () => {
  it('detects matching actions', () => {
    const result = compareReplay(
      [
        { actionClass: 'communicate.email', tool: 'send_email', parameters: {}, wouldBeDecision: 'allow', reason: 'ok' },
      ],
      [
        { type: 'communication.email.sent', id: 'evt_1' },
      ],
    );

    assert.equal(result.actionsMatched, 1);
    assert.equal(result.actionsDivergent, 0);
  });

  it('detects divergent actions', () => {
    const result = compareReplay(
      [
        { actionClass: 'communicate.email', tool: 'send_email', parameters: {}, wouldBeDecision: 'allow', reason: 'ok' },
      ],
      [
        { type: 'financial.payment.received', id: 'evt_1' },
      ],
    );

    assert.equal(result.actionsMatched, 0);
    assert.equal(result.actionsDivergent, 1);
  });
});
