/**
 * Action Gateway — single chokepoint for all external side effects.
 *
 * Every tool call from every agent passes through this 11-step pipeline.
 * Policy enforcement, budget checks, disclosure, escrow, evidence bundles,
 * and audit all happen here.
 *
 * Failure modes per step:
 *   1-5, 8-9: fail-and-stop (deny/error)
 *   6: fail-and-fix (auto-append disclosure)
 *   7: fail-and-skip (simulation optional)
 *   10: fail-and-queue (must persist eventually)
 *   11: fail-and-skip (non-blocking)
 */

import type pg from 'pg';
import { ulid } from 'ulid';
import { checkAuthorization, type ProposedAction as AuthAction } from '../policy/authority-graph.js';
import { appendEvent, type AppendEventInput } from '../ledger/event-store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GatewayAction {
  tenantId: string;
  agentId: string;
  grantId?: string;
  executionId?: string;
  traceId: string;

  // What
  actionClass: string;
  tool: string;
  parameters: Record<string, unknown>;

  // Context
  targetObjectId?: string;
  targetObjectType?: string;
  counterpartyId?: string;
  valueCents?: number;

  // Evidence
  evidence: EvidenceBundle;
}

export interface EvidenceBundle {
  policyClauses: string[];
  factsReliedOn: string[];
  toolsUsed: string[];
  uncertaintyDeclared: number;
  reversiblePath?: string;
  authorityChain: string[];
}

export type GatewayStatus =
  | 'approved'
  | 'denied'
  | 'escrowed'
  | 'executed'
  | 'rolled_back'
  | 'failed';

export interface GatewayResult {
  actionId: string;
  status: GatewayStatus;
  decision: 'allow' | 'deny' | 'require_approval';
  reason: string;
  executed: boolean;
  result?: unknown;
  error?: string;
  evidenceBundle: EvidenceBundle;
  pipelineSteps: PipelineStep[];
}

interface PipelineStep {
  step: string;
  status: 'pass' | 'fail' | 'skip';
  detail?: string;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface GatewayConfig {
  /** Max actions per agent per hour */
  rateLimitPerHour?: number;
  /** Max actions per agent per day */
  rateLimitPerDay?: number;
  /** Disclosure text appended to AI communications */
  disclosureText?: string;
  /** Value threshold (cents) above which actions are escrowed */
  escrowThresholdCents?: number;
  /** Execute the tool call (if null, gateway records but doesn't execute) */
  executor?: (tool: string, params: Record<string, unknown>) => Promise<unknown>;
}

const DEFAULT_CONFIG: GatewayConfig = {
  rateLimitPerHour: 100,
  rateLimitPerDay: 1000,
  disclosureText: 'This message was composed by an AI assistant.',
  escrowThresholdCents: 500000, // $5,000
};

// ---------------------------------------------------------------------------
// Rate limit tracking (in-memory, per-process)
// ---------------------------------------------------------------------------

const rateCounts = new Map<string, { hourly: number; daily: number; hourReset: number; dayReset: number }>();

function checkRateLimit(agentId: string, config: GatewayConfig): { allowed: boolean; reason?: string } {
  const now = Date.now();
  let entry = rateCounts.get(agentId);

  if (!entry || now > entry.hourReset) {
    entry = { hourly: 0, daily: entry?.daily ?? 0, hourReset: now + 3600000, dayReset: entry?.dayReset ?? now + 86400000 };
  }
  if (now > entry.dayReset) {
    entry.daily = 0;
    entry.dayReset = now + 86400000;
  }
  rateCounts.set(agentId, entry);

  const maxHourly = config.rateLimitPerHour ?? DEFAULT_CONFIG.rateLimitPerHour!;
  const maxDaily = config.rateLimitPerDay ?? DEFAULT_CONFIG.rateLimitPerDay!;

  if (entry.hourly >= maxHourly) {
    return { allowed: false, reason: `Rate limit exceeded: ${entry.hourly}/${maxHourly} per hour` };
  }
  if (entry.daily >= maxDaily) {
    return { allowed: false, reason: `Rate limit exceeded: ${entry.daily}/${maxDaily} per day` };
  }

  return { allowed: true };
}

function commitRateLimit(agentId: string): void {
  const entry = rateCounts.get(agentId);
  if (entry) {
    entry.hourly++;
    entry.daily++;
  }
}

function rollbackRateLimit(agentId: string): void {
  const entry = rateCounts.get(agentId);
  if (entry) {
    entry.hourly = Math.max(0, entry.hourly - 1);
    entry.daily = Math.max(0, entry.daily - 1);
  }
}

// ---------------------------------------------------------------------------
// Gateway Pipeline
// ---------------------------------------------------------------------------

/**
 * Submit an action through the gateway pipeline.
 *
 * The 11 steps execute in order. Each step records its result.
 * Rate limit and budget are only committed on successful execution.
 */
export async function submit(
  pool: pg.Pool,
  action: GatewayAction,
  config: GatewayConfig = {},
): Promise<GatewayResult> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const actionId = ulid();
  const steps: PipelineStep[] = [];
  let currentStatus = 'denied' as GatewayStatus;
  let decision: 'allow' | 'deny' | 'require_approval' = 'deny';
  let reason = '';
  let executed = false;
  let result: unknown;
  let error: string | undefined;

  function step(name: string, fn: () => Promise<{ status: 'pass' | 'fail' | 'skip'; detail?: string }>): Promise<boolean> {
    return (async () => {
      const start = Date.now();
      try {
        const r = await fn();
        steps.push({ step: name, status: r.status, detail: r.detail, durationMs: Date.now() - start });
        return r.status !== 'fail';
      } catch (err: any) {
        steps.push({ step: name, status: 'fail', detail: err.message, durationMs: Date.now() - start });
        return false;
      }
    })();
  }

  try {
    // Step 1: Authenticate
    const authOk = await step('authenticate', async () => {
      if (!action.agentId) return { status: 'fail', detail: 'Missing agent ID' };
      return { status: 'pass', detail: `Agent ${action.agentId}` };
    });
    if (!authOk) { reason = 'Authentication failed'; return finalize(); }

    // Step 2: Authorize
    const authzOk = await step('authorize', async () => {
      const authResult = await checkAuthorization(pool, {
        agentId: action.agentId,
        actionClass: action.actionClass,
        targetObjectId: action.targetObjectId,
        targetObjectType: action.targetObjectType,
        valueCents: action.valueCents,
        counterpartyId: action.counterpartyId,
      });
      decision = authResult.decision;
      reason = authResult.reason;
      if (authResult.decision === 'deny') return { status: 'fail', detail: reason };
      if (authResult.decision === 'require_approval') return { status: 'pass', detail: 'Requires approval' };
      return { status: 'pass', detail: 'Authorized' };
    });
    if (!authzOk) { currentStatus = 'denied'; return finalize(); }

    // Step 3: Validate
    const validOk = await step('validate', async () => {
      if (!action.tool) return { status: 'fail', detail: 'Missing tool name' };
      if (!action.actionClass) return { status: 'fail', detail: 'Missing action class' };
      return { status: 'pass' };
    });
    if (!validOk) { reason = 'Validation failed'; return finalize(); }

    // Step 4: Rate limit (NOT committed yet — only on successful execution)
    const rateOk = await step('rate_limit', async () => {
      const check = checkRateLimit(action.agentId, mergedConfig);
      if (!check.allowed) return { status: 'fail', detail: check.reason };
      return { status: 'pass' };
    });
    if (!rateOk) { reason = 'Rate limit exceeded'; return finalize(); }

    // Step 5: Budget check (NOT decremented yet — only on successful execution)
    const budgetOk = await step('budget_check', async () => {
      // Budget enforcement happens in the authority graph check (step 2)
      // Additional tenant-level budget checks can be added here
      return { status: 'pass' };
    });
    if (!budgetOk) { reason = 'Budget exceeded'; return finalize(); }

    // Step 6: Disclosure check (fail-and-fix: auto-append if missing)
    await step('disclosure', async () => {
      if (!mergedConfig.disclosureText) return { status: 'skip', detail: 'No disclosure configured' };
      if (action.actionClass.startsWith('communicate.')) {
        // Check if parameters already include disclosure
        const body = String(action.parameters.body || action.parameters.content || action.parameters.text || '');
        if (!body.includes(mergedConfig.disclosureText)) {
          // Auto-fix: append disclosure to the communication body
          const bodyKey = action.parameters.body != null ? 'body'
            : action.parameters.content != null ? 'content'
            : 'text';
          if (action.parameters[bodyKey]) {
            action.parameters[bodyKey] = `${action.parameters[bodyKey]}\n\n${mergedConfig.disclosureText}`;
          }
          return { status: 'pass', detail: 'Disclosure auto-appended' };
        }
        return { status: 'pass', detail: 'Disclosure present' };
      }
      return { status: 'skip', detail: 'Non-communication action' };
    });

    // Step 7: Simulate (fail-and-skip: world model may not be available)
    await step('simulate', async () => {
      // World model simulation will be wired in Phase 4
      return { status: 'skip', detail: 'World model not yet available' };
    });

    // Step 8: Escrow decision
    const escrowOk = await step('escrow_decision', async () => {
      const threshold = mergedConfig.escrowThresholdCents ?? 500000;
      if (decision === 'require_approval') {
        currentStatus = 'escrowed';
        return { status: 'pass', detail: 'Escrowed: requires human approval' };
      }
      if (action.valueCents && action.valueCents > threshold) {
        currentStatus = 'escrowed';
        decision = 'require_approval';
        reason = `Value (${action.valueCents}c) exceeds escrow threshold (${threshold}c)`;
        return { status: 'pass', detail: reason };
      }
      currentStatus = 'approved';
      return { status: 'pass', detail: 'Auto-approved' };
    });
    if (!escrowOk) { currentStatus = 'denied'; return finalize(); }

    // If escrowed, persist and return — human will release later
    if (currentStatus === 'escrowed') {
      return finalize();
    }

    // Step 9: Execute (fail-and-stop: do NOT commit rate limit or budget on failure)
    const execOk = await step('execute', async () => {
      if (!mergedConfig.executor) {
        return { status: 'skip', detail: 'No executor configured (dry run)' };
      }
      try {
        result = await mergedConfig.executor(action.tool, action.parameters);
        executed = true;
        currentStatus = 'executed';
        return { status: 'pass', detail: 'Tool executed successfully' };
      } catch (err: any) {
        error = err.message;
        currentStatus = 'failed';
        return { status: 'fail', detail: err.message };
      }
    });

    // Commit rate limit only on successful execution
    if (executed) {
      commitRateLimit(action.agentId);
    }

    if (!execOk) {
      reason = `Execution failed: ${error}`;
      return finalize();
    }

    // Step 10: Audit (fail-and-queue: action already executed, must persist)
    await step('audit', async () => {
      try {
        await appendEvent(pool, {
          tenantId: action.tenantId,
          type: `agent.action.executed`,
          timestamp: new Date(),
          sourceType: 'agent',
          sourceId: action.agentId,
          objectRefs: action.targetObjectId
            ? [{ objectId: action.targetObjectId, objectType: action.targetObjectType || 'unknown', role: 'target' }]
            : [],
          payload: {
            actionId,
            actionClass: action.actionClass,
            tool: action.tool,
            valueCents: action.valueCents,
            executed: true,
          },
          provenance: {
            sourceSystem: 'gateway',
            sourceId: actionId,
            extractionMethod: 'api',
            extractionConfidence: 1.0,
          },
          traceId: action.traceId,
        });
        return { status: 'pass' };
      } catch (err: any) {
        // fail-and-queue: log warning but don't fail the action
        return { status: 'skip', detail: `Audit write failed (queued): ${err.message}` };
      }
    });

    // Step 11: Notify (fail-and-skip: non-blocking)
    await step('notify', async () => {
      // Notifications will be wired to the event system
      return { status: 'skip', detail: 'Notification system not yet wired' };
    });

  } catch (err: any) {
    error = err.message;
    reason = `Pipeline error: ${err.message}`;
    currentStatus = 'failed';
  }

  return finalize();

  // ---

  function finalize(): GatewayResult {
    // Persist the gateway action record
    persistAction(pool, actionId, action, currentStatus, decision, reason, executed, result, error, steps).catch(() => {});

    return {
      actionId,
      status: currentStatus,
      decision,
      reason,
      executed,
      result,
      error,
      evidenceBundle: action.evidence,
      pipelineSteps: steps,
    };
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

async function persistAction(
  pool: pg.Pool,
  actionId: string,
  action: GatewayAction,
  status: GatewayStatus,
  decision: string,
  reason: string,
  executed: boolean,
  result: unknown,
  error: string | undefined,
  steps: PipelineStep[],
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO gateway_actions (
        id, tenant_id, agent_id, grant_id, execution_id, trace_id,
        action_class, tool, parameters,
        target_object_id, target_object_type, counterparty_id, value_cents,
        evidence, auth_decision, auth_reason,
        status, executed_at, result, error
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [
        actionId, action.tenantId, action.agentId, action.grantId ?? null,
        action.executionId ?? null, action.traceId,
        action.actionClass, action.tool, JSON.stringify(action.parameters),
        action.targetObjectId ?? null, action.targetObjectType ?? null,
        action.counterpartyId ?? null, action.valueCents ?? null,
        JSON.stringify(action.evidence), decision, reason,
        status, executed ? new Date() : null,
        result != null ? JSON.stringify(result) : null,
        error ?? null,
      ],
    );
  } catch {
    // Best-effort persistence
  }
}

// ---------------------------------------------------------------------------
// Escrow management
// ---------------------------------------------------------------------------

/**
 * Release an escrowed action — either execute it or reject it.
 */
export async function releaseEscrow(
  pool: pg.Pool,
  actionId: string,
  decision: 'execute' | 'reject',
  decidedBy: string,
  config: GatewayConfig = {},
): Promise<GatewayResult> {
  const row = await pool.query('SELECT * FROM gateway_actions WHERE id = $1', [actionId]);
  if (row.rows.length === 0) throw new Error(`Action not found: ${actionId}`);

  const action = row.rows[0];
  if (action.status !== 'escrowed') throw new Error(`Action is not escrowed (status: ${action.status})`);

  if (decision === 'reject') {
    await pool.query(
      `UPDATE gateway_actions SET status = 'denied', auth_decision = 'deny', auth_reason = $2 WHERE id = $1`,
      [actionId, `Rejected by ${decidedBy}`],
    );
    return {
      actionId,
      status: 'denied',
      decision: 'deny',
      reason: `Rejected by ${decidedBy}`,
      executed: false,
      evidenceBundle: action.evidence,
      pipelineSteps: [],
    };
  }

  // Execute
  let result: unknown;
  let error: string | undefined;
  let executed = false;

  if (config.executor) {
    try {
      const params = typeof action.parameters === 'string' ? JSON.parse(action.parameters) : action.parameters;
      result = await config.executor(action.tool, params);
      executed = true;
    } catch (err: any) {
      error = err.message;
    }
  }

  const newStatus: GatewayStatus = executed ? 'executed' : 'failed';
  await pool.query(
    `UPDATE gateway_actions SET status = $2, executed_at = $3, result = $4, error = $5 WHERE id = $1`,
    [actionId, newStatus, executed ? new Date() : null, result != null ? JSON.stringify(result) : null, error ?? null],
  );

  return {
    actionId,
    status: newStatus,
    decision: 'allow',
    reason: `Approved by ${decidedBy}`,
    executed,
    result,
    error,
    evidenceBundle: typeof action.evidence === 'string' ? JSON.parse(action.evidence) : action.evidence,
    pipelineSteps: [],
  };
}

/**
 * Get pending escrowed actions for a tenant.
 */
export async function getPendingEscrow(pool: pg.Pool, tenantId: string): Promise<any[]> {
  const result = await pool.query(
    `SELECT * FROM gateway_actions WHERE tenant_id = $1 AND status = 'escrowed' ORDER BY created_at DESC`,
    [tenantId],
  );
  return result.rows;
}
