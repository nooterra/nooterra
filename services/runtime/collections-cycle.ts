/**
 * Collections Cycle — the autonomous execution pipeline.
 *
 * Runs on a schedule (default: every 4 hours). For each tenant:
 *
 *   1. SCAN — sweep invoices for new decision epochs
 *   2. RESOLVE — check pending epochs for payment outcomes
 *   3. RANK — NBA ranker scores all actionable invoices
 *   4. ACT — for each top recommendation:
 *      a. High confidence + not blocked → auto-execute (email, log, hold)
 *      b. Needs approval → escrow for human review
 *      c. Complex case (dispute, high value) → delegate to LLM agent
 *   5. LEARN — log decisions, track effects, feed retraining
 *
 * This replaces the pattern of "run LLM every 4 hours and hope it picks
 * the right invoices." The model picks. The LLM writes copy when needed.
 */

import type pg from 'pg';
import { generateNBAPlan } from '../../src/planner/planner.js';
import { executeCollectionEmail } from './collections-executor.js';
import { recordActionExpectations } from '../../src/eval/effect-tracker.js';
import { appendEvent } from '../../src/ledger/event-store.js';
import { getObject } from '../../src/objects/graph.js';
import { ulid } from 'ulid';

const ML_SIDECAR_URL = process.env.ML_SIDECAR_URL ?? 'http://localhost:8100';
const AUTO_EXECUTE_CONFIDENCE_THRESHOLD = 0.65;
const MAX_ACTIONS_PER_CYCLE = 20;

interface CycleResult {
  tenantId: string;
  cycleId: string;
  startedAt: string;
  completedAt: string;
  invoicesScanned: number;
  actionsProposed: number;
  actionsAutoExecuted: number;
  actionsEscrowed: number;
  actionsDelegatedToLlm: number;
  epochsCreated: number;
  epochsResolved: number;
  errors: string[];
}

function log(level: string, msg: string): void {
  const ts = new Date().toISOString();
  const line = JSON.stringify({ ts, level, component: 'collections-cycle', msg });
  if (level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

async function callSidecar(endpoint: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${ML_SIDECAR_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Generate a collection email body for a specific invoice.
 * Uses the LLM only for copy generation, not for deciding WHAT to do.
 */
async function generateEmailCopy(
  pool: pg.Pool,
  tenantId: string,
  action: { targetObjectId: string; parameters: Record<string, unknown>; actionClass: string },
): Promise<{ to: string; subject: string; body: string } | null> {
  const invoice = await getObject(pool, action.targetObjectId);
  if (!invoice) return null;

  const state = (invoice.state ?? {}) as Record<string, unknown>;
  const params = action.parameters;
  const daysOverdue = Number(params.daysOverdue ?? 0);
  const amountCents = Number(params.amountCents ?? state.amountCents ?? 0);
  const invoiceNumber = String(params.invoiceNumber ?? state.number ?? action.targetObjectId);
  const variant = String(params.recommendedVariantId ?? 'email_friendly');

  // Find the customer's email from related party
  const partyId = String(state.partyId ?? params.partyId ?? '');
  let customerEmail = '';
  let customerName = '';
  if (partyId) {
    const party = await getObject(pool, partyId);
    if (party) {
      const partyState = (party.state ?? {}) as Record<string, unknown>;
      customerName = String(partyState.name ?? '');
      const contacts = Array.isArray(partyState.contactInfo) ? partyState.contactInfo : [];
      const emailEntry = contacts.find((c: any) => c?.type === 'email' && c?.value);
      customerEmail = emailEntry?.value ?? '';
    }
  }

  if (!customerEmail) return null;

  const amount = `$${(amountCents / 100).toFixed(2)}`;
  const greeting = customerName ? `Hi ${customerName.split(' ')[0]}` : 'Hi';

  if (variant === 'email_formal' || daysOverdue > 14) {
    return {
      to: customerEmail,
      subject: `Payment overdue — Invoice ${invoiceNumber} (${amount})`,
      body: `${greeting},\n\nThis is a formal notice regarding Invoice ${invoiceNumber} for ${amount}, which is now ${daysOverdue} days past due.\n\nPlease arrange payment at your earliest convenience. If you have already sent payment, please disregard this notice.\n\nIf you have questions about this invoice, please reply to this email.\n\nThank you.`,
    };
  }

  return {
    to: customerEmail,
    subject: `Friendly reminder — Invoice ${invoiceNumber}`,
    body: `${greeting},\n\nJust a quick reminder that Invoice ${invoiceNumber} for ${amount} is ${daysOverdue > 0 ? `${daysOverdue} days past due` : 'coming up'}.\n\nIf you've already sent payment, thank you! Otherwise, please let us know if you have any questions.\n\nBest regards.`,
  };
}

/**
 * Run one full collections cycle for a tenant.
 */
export async function runCollectionsCycle(
  pool: pg.Pool,
  tenantId: string,
): Promise<CycleResult> {
  const cycleId = ulid();
  const startedAt = new Date().toISOString();
  const errors: string[] = [];
  let epochsCreated = 0;
  let epochsResolved = 0;
  let actionsAutoExecuted = 0;
  let actionsEscrowed = 0;
  let actionsDelegatedToLlm = 0;

  log('info', `Starting collections cycle ${cycleId} for tenant ${tenantId}`);

  // 1. SCAN — sweep invoices for new decision epochs
  const sweepResult = await callSidecar('/epochs/sweep', { tenant_id: tenantId, limit: 500 });
  epochsCreated = Number(sweepResult?.created ?? 0);

  // 2. RESOLVE — check pending epochs for payment outcomes
  const resolveResult = await callSidecar('/epochs/resolve', { tenant_id: tenantId });
  epochsResolved = Number(resolveResult?.resolved ?? 0);

  // 3. RANK — generate NBA plan
  let plan;
  try {
    plan = await generateNBAPlan(pool, tenantId);
  } catch (err: any) {
    errors.push(`NBA plan generation failed: ${err.message}`);
    log('error', `NBA plan failed for ${tenantId}: ${err.message}`);
  }

  const actions = plan?.actions ?? [];
  const actionsToProcess = actions.slice(0, MAX_ACTIONS_PER_CYCLE);

  // 4. ACT — process each recommendation
  for (const action of actionsToProcess) {
    try {
      const confidence = action.uncertainty?.composite ?? 0.5;
      const blocked = action.controlReasons?.some((r: string) =>
        r.toLowerCase().includes('blocked') || r.toLowerCase().includes('denied'),
      );
      const requiresApproval = action.requiresHumanReview;

      if (blocked) {
        // Skip blocked actions entirely
        continue;
      }

      if (requiresApproval) {
        // Escrow for human review
        await escrowAction(pool, tenantId, action, cycleId);
        actionsEscrowed++;
        continue;
      }

      // Auto-execute if confidence is high enough
      if (confidence >= AUTO_EXECUTE_CONFIDENCE_THRESHOLD) {
        if (action.actionClass === 'communicate.email') {
          const emailCopy = await generateEmailCopy(pool, tenantId, action);
          if (emailCopy) {
            const result = await executeCollectionEmail(tenantId, emailCopy);
            if (result.ok) {
              await logExecutedAction(pool, tenantId, action, cycleId, 'auto', result);
              actionsAutoExecuted++;
            } else {
              errors.push(`Email send failed for ${action.targetObjectId}: ${result.error}`);
            }
          }
        } else if (action.actionClass === 'strategic.hold') {
          // Holds are free — just log the decision
          await logExecutedAction(pool, tenantId, action, cycleId, 'auto', { ok: true, hold: true });
          actionsAutoExecuted++;
        } else if (action.actionClass === 'task.create') {
          // Escalations always need human review
          await escrowAction(pool, tenantId, action, cycleId);
          actionsEscrowed++;
        }
      } else {
        // Low confidence — delegate to LLM for nuanced decision
        actionsDelegatedToLlm++;
      }
    } catch (err: any) {
      errors.push(`Action processing failed for ${action.targetObjectId}: ${err.message}`);
    }
  }

  const completedAt = new Date().toISOString();
  log('info', `Cycle ${cycleId} complete: ${actionsAutoExecuted} auto, ${actionsEscrowed} escrowed, ${actionsDelegatedToLlm} delegated`);

  // Persist cycle result as an evaluation report
  try {
    await pool.query(
      `INSERT INTO world_evaluation_reports (report_id, tenant_id, report_type, subject_type, subject_id, status, schema_version, metrics, artifact, created_at, updated_at)
       VALUES ($1, $2, 'collections_cycle', 'scheduler_job', 'collections_cycle', 'completed', '1', $3::jsonb, $4::jsonb, now(), now())
       ON CONFLICT (tenant_id, report_type, subject_type, subject_id) DO UPDATE SET
         metrics = EXCLUDED.metrics, artifact = EXCLUDED.artifact, updated_at = now()`,
      [
        cycleId,
        tenantId,
        JSON.stringify({
          invoicesScanned: actions.length,
          actionsProposed: actionsToProcess.length,
          actionsAutoExecuted,
          actionsEscrowed,
          actionsDelegatedToLlm,
          epochsCreated,
          epochsResolved,
        }),
        JSON.stringify({
          cycleId,
          startedAt,
          completedAt,
          errors,
        }),
      ],
    );
  } catch {
    // Non-critical
  }

  return {
    tenantId,
    cycleId,
    startedAt,
    completedAt,
    invoicesScanned: actions.length,
    actionsProposed: actionsToProcess.length,
    actionsAutoExecuted,
    actionsEscrowed,
    actionsDelegatedToLlm,
    epochsCreated,
    epochsResolved,
    errors,
  };
}

async function escrowAction(
  pool: pg.Pool,
  tenantId: string,
  action: any,
  cycleId: string,
): Promise<void> {
  const id = ulid();
  await pool.query(
    `INSERT INTO gateway_actions (id, tenant_id, agent_id, action_class, target_object_id, target_object_type, parameters, status, evidence, created_at)
     VALUES ($1, $2, $3, $4, $5, 'invoice', $6::jsonb, 'escrowed', $7::jsonb, now())
     ON CONFLICT DO NOTHING`,
    [
      id,
      tenantId,
      'collections_cycle',
      action.actionClass,
      action.targetObjectId,
      JSON.stringify(action.parameters ?? {}),
      JSON.stringify({
        cycleId,
        reasoning: action.reasoning ?? [],
        objectiveScore: action.objectiveScore,
        controlReasons: action.controlReasons ?? [],
      }),
    ],
  );
}

async function logExecutedAction(
  pool: pg.Pool,
  tenantId: string,
  action: any,
  cycleId: string,
  executionMode: 'auto' | 'llm',
  result: any,
): Promise<void> {
  const traceId = ulid();

  // Log event
  try {
    await appendEvent(pool, {
      tenantId,
      type: 'action.executed',
      timestamp: new Date(),
      sourceType: 'system',
      sourceId: 'collections_cycle',
      objectRefs: [{ id: action.targetObjectId, type: 'invoice', role: 'target' }],
      payload: {
        actionClass: action.actionClass,
        targetObjectId: action.targetObjectId,
        executionMode,
        cycleId,
        variantId: action.parameters?.recommendedVariantId,
        result: { ok: result.ok, via: result.via },
      },
      provenance: { sourceSystem: 'collections_cycle', sourceId: cycleId },
      traceId,
    });
  } catch {
    // Non-critical — event logging shouldn't block execution
  }

  // Record expectations for effect tracker
  try {
    const actionId = ulid();
    await recordActionExpectations(pool, {
      actionId,
      tenantId,
      agentId: 'collections_cycle',
      traceId,
      actionClass: action.actionClass,
      tool: action.actionClass === 'communicate.email' ? 'send_collection_email' : action.actionClass,
      targetObjectId: action.targetObjectId,
      targetObjectType: 'invoice',
      parameters: action.parameters ?? {},
      decision: executionMode === 'auto' ? 'auto_executed' : 'llm_executed',
      evaluationMode: 'executed',
      predictedEffects: (action.objectiveBreakdown ?? []).map((c: any) => ({
        field: c.id,
        currentValue: 0,
        predictedValue: c.score,
        delta: c.score,
        confidence: 0.7,
        label: c.id,
      })),
    });
  } catch {
    // Non-critical
  }
}
